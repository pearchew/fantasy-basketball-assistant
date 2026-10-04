# Phase 0 findings: data sources

Oct 4, 2026. Run `npm run spike` to repeat the local checks. `/api/spike` runs the same checks from a Vercel function.

## Results

| Check | Local | Vercel (iad1) | Notes |
| --- | --- | --- | --- |
| Player directory (ESPN) | Pass | Pass | 30 teams, 605 players; all have a position |
| Game logs (ESPN box scores) | Pass | Pass | 15 Mar 2026: 7 games, 182 lines; every team has exactly 5 starters |
| Official injury report, reference PDF | Pass | Pass | 142 entries and 9 not-submitted teams, both matching a hand count |
| Official injury report, latest | Skip | Skip | Preseason; nothing published in the last 4 hours |
| Name matching, report to directory | Pass | Pass | 126 of 142 (89%). All 16 misses are roster churn since March, not format errors |
| ESPN injury feed | Pass | Pass | 60 entries, all with ESPN IDs |
| Language model, next-up | Pass | Pass | `gemini-3.5-flash-lite`, about 1 s. On the Cooper Flagg example it named Marshall as the starting replacement and Washington for more usage, with no invented names |

## Decisions

**Injury news: the NBA's official injury report.**
- *URL:* `https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MM{AM|PM}.pdf`.
- *Publishing:* a new report every 15 minutes on game days, timestamped in US Eastern time. That cadence meets the PRD's 10-minute freshness target to within one slot.
- *Access:* it needs a browser-like `User-Agent`, and plain curl gets a 403.
- *Format change:* the 2024-25 season used the hourly `_05PM` format.
- *Parsing:* it's a positioned table, so the parser works by layout and needs no language model. It handles:
  - wrapped reasons
  - suffixes placed before the comma
  - date, matchup and team cells left blank on repeat rows
  - teams marked "NOT YET SUBMITTED"

**Player directory, game logs and depth chart: ESPN's public site API.**
- *Directory:* the roster endpoint gives stable IDs, names and position, and it includes two-way players.
- *Game logs:* the box-score endpoint has a `starter` flag and full counting stats, so it can feed both the depth chart and Feature 4.
- *Request cost:* a full game night is one scoreboard call plus one call per game.
- *Positions:* ESPN collapses positions to one letter (G, F, C), so the "next man at position" rule works at that level.
- *Terms risk:* the API is undocumented. Its terms risk is lower than scraping HTML, but it is not zero.

**Ruled out:**
- *`stats.nba.com` (`nba_api`):* timed out even from a home connection.
- *`cdn.nba.com` live data:* returned 403 to every request.
- *balldontlie:* the free tier has no box scores or stats, and those cost $9.99 a month.

**Language model: Gemini `gemini-3.5-flash-lite` through the OpenAI-compatible endpoint.** Chosen because it's a stable release, not a preview, and Flash-Lite has the most generous free daily limit. Groq remains a drop-in swap through env settings. Both have free tiers with no card on file. Limits change often, so check them in the console:
- Gemini Flash-Lite: about 500 requests a day.
- Groq: about 1,000 a day.

A busy game day needs a few dozen calls, one per change in the set of absent players on a team.

## Outcome

Phase 0 is done. On Oct 4, 2026, every check passed from a Vercel Hobby function in `iad1`, with the same numbers as the local run, so Vercel's addresses are not blocked by any chosen source. The whole run took about 4 s.

One follow-up: on the first regular-season game day, rerun `/api/spike` and confirm `nba.injuryReport.latest` passes rather than skips.
