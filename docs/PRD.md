# PRD: Fantasy Basketball Assistant (v4, as built)

Oct 4, 2026 · @Pierson

> **About this revision.** v3 recorded what was built in Phases 0–4. v4 (Oct 20, 2026) replaces Feature 3's named next-up calls and Gemini with on/off splits: for each injured player, every teammate's numbers in the games he sat versus the games he played. Each feature lists its requirements as shipped and each acceptance criterion's measured result. Decisions made during the build are marked **[built]**. The few claims still unverified are marked **[verify]**. The change history at the end covers v1 → v2 (review), v2 → v3 (build) and v3 → v4.

Live app: https://fantasy-basketball-assistant-five.vercel.app · Code: `pearchew/fantasy-basketball-assistant` (private)

## Status

| Phase | Status | Acceptance result |
| --- | --- | --- |
| 0. Data spike | Done | Every source returns real data from a deployed Vercel function (iad1). The latest-report check skips until the first regular-season game day. |
| 1. Teams | Done | Add or drop takes about 1 s; a player on two teams shows both names; trades update through the daily sync. |
| 2. Feed | Done | 142 of 142 rows on a real game-day report parsed and matched, or listed for review. Live game day pending (season starts about Oct 20). |
| 3. On/off splits | Done (v4) | The database function matches a plain recomputation from box scores for 6 players across 2 seasons; about 0.3 s for a full day's injured players. Replaced the v3 next-up calls (backtest 90%), which named players but added little the numbers didn't show. |
| 4. Stats | Done | 5 of 5 players match ESPN's official 2025-26 season averages. |

## Summary

A personal tool that watches NBA injury news and tells me which players stand to gain, starting with the ones on any of my fantasy teams or watchlist. It does not know who is a free agent in each league: "unowned" means not on any of my teams.

Before, that meant refreshing a news feed, working out who absorbs the minutes, then checking recent form on another site. The tool collapses those three steps into one view: who is out, how his teammates did when he sat before, and how those players have been playing.

## Goals and non-goals

**Goals**

- Keep an up-to-date roster for each of my fantasy teams, editable in seconds.
- Surface injury and inactive news soon after the source publishes it.
- For each player ruled out, show how every teammate did in the games he sat versus the games he played.
- For each player returning from absence, show the same numbers, read as the gains likely to shrink.
- Show recent form for any player over the last 7, 14 and 30 games.
- Cost nothing to build or run: free data, free hosting on Vercel and Supabase, no paid APIs.

**Non-goals for v1**

- Syncing automatically with my fantasy platform. The roster is entered by hand.
- Statistical projections or named picks. **[built]** The tool shows measured splits and recent form; the judgement stays mine.
- Setting lineups, proposing trades or making waiver claims on my behalf. No alerts, and no tracking of who is a free agent in each league.
- Open sign-up. **[built]** Access is invite-only: the admin gives specific people access (see Access); each gets their own teams and watchlist.
- Category-specific advice per league format. The stats panel is the same for every team.

## Core user flow

1. The NBA publishes an injury report (every 15 minutes on game days).
2. The tool parses it into structured updates: player, team, status, reason, game.
3. For each player out, doubtful, questionable or returning, it splits his teammates' box scores by whether he played.
4. It checks each name against all my teams and the watchlist.
5. I open the tool and see the updates grouped by game, each with its on/off table, and any teammate's recent stats a tap away.
6. I act on my fantasy platform: start, sit, add or drop.
7. If I add or drop someone, I update that team's roster in the tool.

## Access

- **[built]** Invite-only. The admin (`ADMIN_EMAIL`) gives people access on a People page: it creates the account and a one-time sign-in link to send them, with no email involved. Each person has their own teams, rosters and watchlist. The injury feed, on/off splits and stats are shared.
- Sign in with a Supabase email magic link, sent to existing accounts only. Unknown addresses get the same "check your inbox" reply.
- **[built]** Supabase's built-in email allows only a few messages an hour. Two workarounds: the People page's "New sign-in link", and `npm run login-link` for the admin. Both mint a one-time link with the secret key instead of sending email.
- **[built]** New sign-ups are switched off in Supabase, so accounts are only created by the admin.
- Row-level security on every table: my teams, rosters and watchlist are readable and writable only by my account. Shared data (players, injury updates, games) is read-only for signed-in users and written only by server jobs with the secret key. Anonymous requests are refused on every table and function.
- The refresh endpoint needs a signed-in session. It fetches the report at most once per 10 minutes when called automatically, and at most once a minute when I press **Refresh**.
- Scheduled and diagnostic endpoints (`/api/cron/daily`, `/api/spike`) need their own bearer secrets.

## Feature 1: Teams and rosters

**Requirements (as built)**

- Create, rename and delete teams. Each team has a name and a format label (H2H 9-cat or roto); nothing depends on the format in v1.
- Switch between teams in one click, see all teams together, or open the shared watchlist.
- Search players with autocomplete. Every typed word must start a word of the name, and accents are ignored ("j bru" finds Jalen Brunson, "doncic" finds Dončić). Enter or a click adds the player to the chosen team or the watchlist.
- Remove a player in one click.
- The same player can be on several teams. Wherever he appears, every team he's on (and the watchlist) is shown.
- Players are keyed by ESPN player ID, with NBA team and position from ESPN rosters.
- **[built]** The player directory syncs daily from ESPN team rosters (all 30, including two-way players). A player missing from every roster is marked inactive, never deleted, so rosters still show him with a "not on an NBA roster" tag. A fetch returning fewer than 350 players is refused rather than marking the league inactive.
- Position is ESPN's NBA-listed position, collapsed to G, F or C.

**Acceptance criteria**

| Criterion | Result |
| --- | --- |
| Adding or dropping a player takes under 10 seconds | About 1 s per add or drop, measured locally |
| A player on two of my teams shows both team names wherever he appears | Confirmed in use and covered by unit tests |
| A rostered player who changes NBA team updates by the next daily refresh | The sync keys on the stable ESPN ID and updates his team; unit-tested. The daily job runs at 10:00 UTC |
| Phase 1: rebuild all my teams in under 10 minutes | Met in use; not formally timed |

## Feature 2: Injury and inactive feed

**Requirements (as built)**

- Source: the NBA's official injury report, a PDF table republished every 15 minutes on game days at `ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MM{AM|PM}.pdf`. It needs a browser-like User-Agent. No reports are published in preseason.
- Parsed by layout, with no language model: rows are grouped by position on the page and columns found from the header. The parser handles reasons that wrap above and below a row, suffixes before the comma ("Lively II, Dereck"), date, matchup and team cells left blank on repeat rows, and teams that haven't yet submitted.
- Extracts game date, tip-off, matchup, team, player, status (out, doubtful, questionable, probable, available) and reason. Rows with an unknown status become parse warnings, never silent drops.
- Name matching: names are normalised (order, accents, punctuation, suffixes), then matched to a directory player on the same team, or to a unique name league-wide. Ambiguous or unknown names are kept and listed for review.
- One update per (player, game). Repeat reports update it and append to its status history (e.g. questionable → out), with first-seen and last-changed times. An older report never overwrites newer data.
- The original printed row is stored and shown next to each parsed update, with its report time.
- **[built]** The feed is grouped by game. Every game is a dropdown, closed by default, ordered by tip-off from earliest to latest, under day headings. The summary line shows tip-off, out/doubtful/questionable/probable counts, and markers when my players are involved or gain. Inside, updates are grouped by team (away first), worst status first, G League and two-way assignments last. This replaced the v2 layout ("new and changed first, unchanged absences collapsed by team").
- My players are pinned above the games ("Your players"), along with my players named as gaining ("Your players who gain").
- **[built]** Times are shown in my time zone, detected from the browser and kept in sync when I travel, or chosen by hand.
- Updates for games already played are archived; `/?date=YYYY-MM-DD` shows a past game day.
- Refresh: saved data shows straight away. If the last check is over 10 minutes old, the page fetches the newest report in the background and reloads. **[built]** A **Refresh** button fetches on demand, at most once a minute. The daily job also checks.

**Acceptance criteria**

| Criterion | Result |
| --- | --- |
| Within 10 minutes of opening the tool, it shows every update in the most recent report | By design: the refresh on open fetches the newest 15-minute report. To confirm on the first live game day |
| Every row in a day's report matches a player ID or appears on the review list, and at least 98 in 100 statuses match the source | 2026-03-15 5:00 PM report: 142 of 142 rows parsed (checked by hand against the raw PDF), 9 of 9 not-submitted teams found, 126 matched, the 16 others listed for review (all roster changes since March, not format errors). Statuses are read verbatim from a fixed column |
| Free-text source criteria | Not applicable: the source is the official report |

## Feature 3: On/off splits

**[built v4]** For every player out, doubtful, questionable or returning, the tool shows how each current teammate did in the team's games he sat versus the games he played. It names no winners: the numbers are the answer.

**Requirements (as built)**

- **Which games:** regular-season games that count for stats, played before the day being viewed, this season and last.
  - If he played for another team that season, only the team's games since his first appearance for it. Otherwise the whole season, so a player hurt since opening night has sat every game.
  - He sat a game unless he has a box-score line with minutes.
- **Which teammates:** the current active roster. A teammate's averages on each side cover the games he was on the box score; a "did not play" counts as zero, so his own absences don't skew the split.
- **What's shown, per game:** starts, MIN, PTS, REB, AST, STL, BLK, 3PM, TO, FG% and FT% (total makes over attempts). The top line is the average when he sat; under it, the change from when he played. Clear gains are green and drops red, on the same bar as the recent-form table (10% and 0.3 for counting stats, turnovers inverted; 3 points for percentages).
- **Order:** biggest minutes gain first, with rows that have 3+ games on both sides ahead of thin ones (marked *). The top 6 show; the rest are a tap away.
- **Season:** opens on this season once he's sat 3+ games in it, otherwise the latest earlier season he sat. A toggle switches. Seasons he didn't spend with the team aren't offered.
- **Same game:** teammates out or doubtful for the same game are left out; questionable ones and my players are tagged.
- **Recent form:** tapping a teammate opens his last 7 / 14 / 30 / season table (Feature 4).
- **Questionable players:** the table starts collapsed ("if he sits"). Out, doubtful and returning tables start open.
- **Your players who gain:** my players with 3+ games each way who gained at least 3 minutes or 3 points a game while an out or doubtful teammate sat. Listed at the top of the feed and counted on each game.
- **Computed on load** by the Postgres function `on_off_splits`, so it always includes last night's games. There is nothing stored to go stale and no model to call.

**Acceptance criteria**

| Criterion | Result |
| --- | --- |
| The database function returns the same splits as a plain recomputation from box scores | `npm run spot-check-onoff`: Irving, Haliburton, Tatum, Leonard, Flagg and Davis, both seasons, all match (games, minutes, points, rebounds, turnovers, shots) |
| Fast enough to compute on every page load | About 0.3 s for all 17 players on the Oct 20–21 report; about 0.35 s for one player |
| A player out since opening night still gets a table | Irving and Haliburton (out all 2025-26): 82 games sat, every current teammate listed |
| No teammate out or doubtful for the same game is shown | Dropped before display. Unit-tested |
| Readable on a phone | Table scrolls sideways with names pinned; the page itself doesn't scroll sideways at 375 px |

## Feature 4: Recent player stats

**Requirements (as built)**

- Averages over the last 7, 14 and 30 games played, next to the season average, computed in Postgres (`player_stat_windows`) from stored box scores.
- **[built]** "Current season" is the latest regular season with games stored, labelled e.g. "2025-26". Before 2026-27 starts the panels show 2025-26, and they switch automatically after the first regular-season game is loaded.
- Columns: games played, minutes, points, rebounds, assists, steals, blocks, threes made, turnovers, FG% and FT%, with FGA and FTA per game in brackets.
- Percentages are total makes divided by total attempts over the window.
- A collapsed line shows recent form ("Last 14: 25.6 pts · 2.9 reb · 8.1 ast · 35.9 min"), opening into the full table. Green or red marks a window clearly above or below the season (10% for counting stats, 3 points for percentages, turnovers reversed, at least 3 games).
- Shown on rostered players and the watchlist (Teams page), on my players in the feed, and for every teammate in an on/off table (tap his name).
- Short windows show their real game count. Players without games show "No games played in 2025-26 yet". If stats can't load, the panel says so and the rest of the page works.
- Game logs are loaded league-wide, one scoreboard call plus one call per game for each date, and stored.
- **[built]** ESPN labels the All-Star games and the NBA Cup championship as "regular season". Both are tagged by competition type and left out of stats, matching official numbers. Cup group games, quarterfinals and semifinals count.

**Acceptance criteria**

| Criterion | Result |
| --- | --- |
| Stats reflect the previous night's games by the next morning | The daily job at 10:00 UTC loads yesterday's box scores; verified on the live site |
| Averages match a reference for 5 spot-checked players | `npm run spot-check-stats`: Flagg, Gilgeous-Alexander, Jokić, Brunson and Marshall all match ESPN's official 2025-26 averages (Brunson's 74 games and 26.0 points independently confirmed). Minutes can differ by under 0.1 because box scores give whole minutes |

## Data sources

| Need | Source | Notes |
| --- | --- | --- |
| Injury news | NBA official injury report (PDF) | Every 15 minutes on game days; works from Vercel; browser-like User-Agent needed |
| Player directory | ESPN public site API, team rosters | Stable IDs, positions, two-way players. Undocumented API |
| Box scores (stats and depth charts) | ESPN public site API, scoreboard and game summary | Starter flag, full counting stats, season type and competition type |
| Secondary injury feed | ESPN public site API | Checked in Phase 0; not used by the app yet |
| Hosting | Vercel Hobby | One cron job a day (10:00 UTC, imprecise timing) |
| Database | Supabase Free | Pauses after 7 idle days; the daily job keeps it active |

**Ruled out in Phase 0:** `stats.nba.com` / `nba_api` (timed out even from a home connection), `cdn.nba.com` live data (403 on every request), balldontlie (box scores cost $9.99 a month), the X API ($0.005 per post read).

**Cost rule.** Nothing needs a card on file. If a source starts charging, it is swapped out, not paid for.

## Risks and known limitations

- **Slower news:** the official report trails Underdog, so some late scratches will be missed before tip-off.
- **Early-season samples:** for the first weeks, most tables open on last season, when rosters and roles were different. New arrivals have no split with their new team until they've played games beside him.
- **Small samples:** a few games either side can swing a split. Thin rows are marked and sorted last.
- **Long absences:** a player out all season has no "with him" games, so his table shows teammates' season numbers without a comparison.
- **Unofficial ESPN API:** it is free and keyless but undocumented, so it could change without notice. Each source sits behind its own adapter for easy swapping.
- **Free tiers change:** Supabase and Vercel limits could tighten; nothing depends on a model any more.
- **Email sign-in:** the built-in sender is rate limited; `npm run login-link` is the workaround. A custom SMTP sender (e.g. Resend's free tier) would fix it for good.
- **Supabase pause:** the daily job runs all year, so the project should never sit idle for 7 days. **[verify]** that a scheduled query counts as activity.

## Phasing

| Phase | What shipped | Done when | Result |
| --- | --- | --- | --- |
| 0. Data spike | Source adapters; `/api/spike` and `npm run spike` checks | Each source returns real data from a deployed Vercel function | Passed from Vercel iad1 |
| 1. Teams | Login, teams, rosters, watchlist, daily player sync | Rebuild all teams in under 10 minutes | Met |
| 2. Feed | Report ingest, history, matching, game-grouped feed, time zones, refresh, archive; league-wide game logs (2025-26 backfilled: 1,327 games, 34,881 player lines) | Feature 2 accuracy criterion met on one game day | Met on 2026-03-15 data; live confirmation pending |
| 3. Next-up (v3) | Depth charts, rules, model, storage, return calls, feed display, backtest | Backtest meets 70% and the Flagg example is sensible | 90% / 90% (rules 91% on all 486 absences); Flagg example passes. Replaced in v4 |
| 3. On/off splits (v4) | `on_off_splits`, tables in the feed, season toggle, my gains, spot check | Function matches a plain recomputation | 6 of 6 players, both seasons |
| 4. Stats | Stat windows, panels on Teams and feed, All-Star and Cup final exclusion, spot check | 5-player spot check matches a reference | 5 of 5 |
| Later | Roster sync from fantasy platforms; category advice per league format; alerts | Out of scope for v1 | |

## Open items

- [ ] On the first regular-season game day (about Oct 20), run `/api/spike` and confirm `nba.injuryReport.latest` passes rather than skips, and that the feed fills within 10 minutes of opening.
- [ ] **[verify]** Supabase counts the daily job's queries as activity (no pause over a quiet week).
- [x] ~~Which source for injury news, depth charts, the player directory and stats; which model; the report's schedule?~~ Resolved in Phase 0 (see Data sources).
- [ ] ~~How many roto teams, and which categories?~~ Deferred: nothing in v1 depends on league format.

## Change history

**v1 → v2 (review, Oct 4, 2026).** Twenty-three changes from a pre-build review:
- inference stored per (team, game, absent set)
- a third candidate rule for starter usage
- "unowned" instead of "available to pick up"
- feed criteria for the official report
- depth charts built from box scores, with game logs moved to Phase 2
- a Phase 0 data spike
- an Access section
- return calls
- merging per (player, game) with history
- collapsing long-term absences
- name normalisation and a review list
- a player directory requirement
- model output restricted to candidates
- out and doubtful excluded, questionable flagged
- positions from the directory
- background refresh
- a backtest target
- percentages as makes over attempts
- current-season windows
- cron at 10:00 UTC
- the format field as a label only
- a year-round daily job
- no card for the model

**v2 → v3 (build, Oct 4, 2026).**

| Area | Decision |
| --- | --- |
| Sign-in | Added `login-link` script to bypass the email rate limit; sign-ups disabled |
| Feed layout | Grouped by game in closed dropdowns ordered by tip-off, replacing "new and changed first / unchanged collapsed"; my players stay pinned |
| Time zone | Auto-detected from the browser or chosen by hand; applied to every time shown |
| Refresh | Manual Refresh button, at most once a minute; automatic refresh stays at 10 minutes |
| Archive | `/?date=` shows any past game day |
| Next-up candidates | Widened to about 6–8 per player so the model has real choice; rule notes shown to the model (lifted the model's backtest from 16/20 to 18/20) |
| Model limits | At most 8 calls per refresh, stop at the first 429, retry later up to 3 times |
| Slow model replies | Free-tier Gemini took 25–45 s a call on 2026-10-20 (normally about 1 s) and sometimes returned 503. Model timeout 50 s, refresh, daily and update routes allowed 300 s (the Hobby maximum), and a run stops starting model calls once one might not finish; those games keep the rules answer until a later run |
| Depth window | Current season once it has 3 games; otherwise the most recent games |
| Stats season | "Current" means the latest regular season with games stored |
| Official games | All-Star games and the NBA Cup final excluded from stats (found by the spot check) |
| Data quality | ESPN's unidentified "did not play" placeholder rows are skipped |
| Database | `returning` is reserved in Postgres, so the column is `is_returning` |

**v3 → v4 (Oct 20, 2026).** Named next-up calls replaced by on/off splits.

| Area | Decision |
| --- | --- |
| What Feature 3 shows | Every teammate's numbers when the player sat versus played, in place of up to three named players with a one-sentence reason. The reasons added little for picking players; the splits are what I act on |
| Gemini | Removed. In the last backtest (20 absences) it did no better than the rules: 58% of named players beat their minutes average with Gemini, 61% without. Free-tier replies took 25–45 s, and 4 of 20 calls failed with 503s |
| Freshness | Computed on page load from box scores, so the "Update next-up calls" button, its daily allowance and stored calls are gone |
| Seasons | This season and last, with a toggle; long absences count from opening night |
| Old tables | `next_up` and `model_budget` are no longer used; `0007_on_off.sql` lists the commands to drop them |
| v3 results kept for the record | Rules alone: 441/486 starter absences (91%) had a named player beat his 14-game minutes; 65% of named players beat their minutes and 63% their usage. The splits were the strongest signal in those rules |
