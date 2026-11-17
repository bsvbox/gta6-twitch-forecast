# bsvbox/gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/bsvbox/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/bsvbox/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day (19 Nov 2026, UTC), as five quantiles per hour (5%, 25%, 50%, 75%, 95%), from the first hour's viewer count.

The model is calibrated on the release-day curves of 38 past big game launches (the case's own comparables): for each hour it regresses the log-ratio to hour 1 on the log of hour 1's size, because small first hours explode and big first hours barely move. The median is floored at the big-launch median so a huge first hour never forecasts a shrinking day, and the spread narrows when the first hour is big (that regime is tight) and widens when it is small (that regime is wild). Deterministic, offline, Node standard library only.

Practice score (local, same pinball loss on the log scale as the grader): **0.193** mean over the four practice launches, against the house baseline's 0.387.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=4eqvbahr&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
