// gta6-twitch-ccu-forecast-01: forecast GTA VI's launch-day Twitch viewers,
// hour by hour, as five quantiles an hour (Node 22, standard library only).
//
// The program reads one case (/input/<id>.in) and writes one forecast
// (/output/<id>.out) with 23 rows, hours 2..24, each five quantiles of that
// hour's viewer count at levels 0.05, 0.25, 0.5, 0.75 and 0.95.
//
// The model is calibrated on the case's own comparables: the release-day
// curves of past big game launches. For each hour h it fits, across the
// comparables, an ordinary least-squares line of the log-ratio
// L_h = ln(viewers_h / viewers_1) on log10(viewers_1):
//
//   L_h ~ a_h + b_h * log10(p1)
//
// The slope is strongly negative at the day's peak (about -2.1): a launch
// whose first hour is small explodes later, one whose first hour is already
// huge barely moves. That is mechanical, not magic: the day's peak audience
// in absolute viewers is roughly the same size across launches, while the
// first hour's print depends on which time zones had unlocked by 01:00 UTC.
//
// Two guards keep the line honest where the data thins out:
//   - Big-launch floor: the median is never below the median log-ratio of
//     the comparables whose first hour was at least 50,000 viewers, so a
//     huge first hour never forecasts a shrinking day.
//   - Size-adaptive spread: the spread is the residuals' MAD sigma, scaled
//     from 1.0 when the first hour is small (that regime is wild) down to
//     0.65 when it is big (that regime is tight).
//
// Quantiles are q_tau(h) = p1 * exp(mu_h + z_tau * sigma_h * scale), with
// z the standard normal's quantile at each level. Everything is
// deterministic: no clock, no randomness, no network, no reading beyond the
// case file. If a case carries no usable comparable curve, or no hour-1
// print, the program falls back to the house persistence baseline, so the
// case stays valid.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** The spread of the house persistence baseline, in log units per root hour. */
const BASELINE_SIGMA = 0.15;
/** A comparable counts as a big launch from this many hour-1 viewers. */
const BIG_LAUNCH = 50000;
/** A comparable's curve must cover at least this many of hours 2..24. */
const MIN_COVERED_HOURS = 18;
/** A regression needs at least this many comparable curves for the hour. */
const MIN_CURVES = 8;

interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  hourly: HourlyPoint[];
}

interface Case {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The median of a non-empty list of numbers. */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** The tau-quantile of a list, linear interpolation on the sorted values. */
const quantile = (xs: number[], tau: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return s[lo] * (1 - (pos - lo)) + s[hi] * (pos - lo);
};

/** Format a millisecond timestamp as an ISO UTC string without millis. */
const isoHour = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00:00Z`;
};

/**
 * One comparable's log-ratio curve, or null when it cannot be used: it is
 * not a launch (the target's own pre-release history), its hour-1 print is
 * missing or below one viewer, or it covers too few of hours 2..24.
 */
const ratioCurve = (
  comp: Comparable,
): { v1: number; logRatio: Array<number | null> } | null => {
  if (comp.unlock !== undefined && comp.unlock.startsWith('Not a launch')) return null;
  const byHour = new Map<string, number>();
  for (const p of comp.hourly) {
    if (typeof p.viewers === 'number' && p.viewers >= 0) byHour.set(p.from, p.viewers);
  }
  const t0 = Date.parse(comp.day_start);
  if (Number.isNaN(t0)) return null;
  const v1 = byHour.get(isoHour(t0));
  if (v1 === undefined || v1 < 1) return null;
  const logRatio: Array<number | null> = [];
  let covered = 0;
  for (let h = 1; h <= 24; h++) {
    const v = byHour.get(isoHour(t0 + (h - 1) * 3600_000));
    if (v === undefined || v < 1) {
      logRatio.push(null);
    } else {
      logRatio.push(Math.log(v / v1));
      if (h >= 2) covered++;
    }
  }
  if (covered < MIN_COVERED_HOURS) return null;
  return { v1, logRatio };
};

/** Least squares of y on x; returns intercept, slope and residuals. */
const ols = (xs: number[], ys: number[]): { a: number; b: number; resid: number[] } => {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  return { a, b, resid: ys.map((y, i) => y - (a + b * xs[i])) };
};

/** The spread scale: 1.0 for a small first hour, 0.65 for a big one. */
const spreadScale = (p1: number): number =>
  0.65 + 0.35 / (1 + Math.exp((Math.log10(p1) - 4.7) / 0.25));

/** The house persistence baseline's quantiles for one hour (the fallback). */
const baselineQuantiles = (p1: number, h: number): number[] =>
  Z.map((z) => round2(p1 * Math.exp(z * BASELINE_SIGMA * Math.sqrt(h - 1))));

/** The forecast of one case: 23 rows, hours 2..24, five quantiles each. */
const forecastCase = (c: Case): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${c.id} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const curves = c.comparables.map(ratioCurve).filter((r) => r !== null);

  const hours = c.forecast.map(({ hour }) => {
    const h = hour;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const curve of curves) {
      const l = curve.logRatio[h - 1];
      if (l !== null) {
        xs.push(Math.log10(curve.v1));
        ys.push(l);
      }
    }
    if (xs.length < MIN_CURVES) return { hour: h, q: baselineQuantiles(p1, h) };

    const { a, b, resid } = ols(xs, ys);
    const absResid = resid.map((r) => Math.abs(r)).sort((x, y) => x - y);
    const sigma = Math.max(1.4826 * median(absResid), 0.05);
    let mu = a + b * Math.log10(p1);
    const big = curves
      .filter((curve) => curve.v1 >= BIG_LAUNCH)
      .map((curve) => curve.logRatio[h - 1])
      .filter((l): l is number => l !== null);
    if (big.length > 0) mu = Math.max(mu, median(big));
    const scale = spreadScale(p1);
    const q = Z.map((z) => {
      const v = round2(p1 * Math.exp(mu + z * sigma * scale));
      return Math.min(1e9, Math.max(0.01, v));
    });
    // Non-decreasing by construction; enforce it after rounding anyway.
    for (let i = 1; i < q.length; i++) q[i] = Math.max(q[i], q[i - 1]);
    return { hour: h, q };
  });
  return hours;
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
