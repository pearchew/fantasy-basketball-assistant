# PRD: Fantasy Basketball Assistant (v3, as built)

Oct 4, 2026 · @Pierson

> **About this revision.** v3 records what was built in Phases 0–4. Each feature lists its requirements as shipped and each acceptance criterion's measured result. Decisions made during the build are marked **[built]**. The few claims still unverified are marked **[verify]**. The change history at the end covers v1 → v2 (review) and v2 → v3 (build).

Live app: https://fantasy-basketball-assistant-five.vercel.app · Code: `pearchew/fantasy-basketball-assistant` (private)

## Status

| Phase | Status | Acceptance result |
| --- | --- | --- |
| 0. Data spike | Done | Every source returns real data from a deployed Vercel function (iad1). The latest-report check skips until the first regular-season game day. |
| 1. Teams | Done | Add or drop takes about 1 s; a player on two teams shows both names; trades update through the daily sync. |
| 2. Feed | Done | 142 of 142 rows on a real game-day report parsed and matched, or listed for review. Live game day pending (season starts about Oct 20). |
| 3. Next-up | Done | Backtest 18/20 (90%) with rules only and with rules + model, against a 70% target; rules alone 441/486 (91%) across every 2025-26 starter absence. The Cooper Flagg example names Risacher and Marshall. |
| 4. Stats | Done | 5 of 5 players match ESPN's official 2025-26 season averages. |

## Summary

A personal tool that watches NBA injury news and tells me which players stand to gain, starting with the ones on any of my fantasy teams or watchlist. It does not know who is a free agent in each league: "unowned" means not on any of my teams.

Before, that meant refreshing a news feed, working out who absorbs the minutes, then checking recent form on another site. The tool collapses those three steps into one view: who is out, who is next up, and how those players have been playing.

## Goals and non-goals

**Goals**

- Keep an up-to-date roster for each of my fantasy teams, editable in seconds.
- Surface injury and inactive news soon after the source publishes it.
- For each player ruled out, name the likely beneficiaries and say why.
- For each player returning from absence, name the players likely to lose minutes.
- Show recent form for any player over the last 7, 14 and 30 games.
- Cost nothing to build or run: free data, free hosting on Vercel and Supabase, no paid APIs.

**Non-goals for v1**

- Syncing automatically with my fantasy platform. The roster is entered by hand.
- Statistical projections. Next-up calls are reasoned inferences, not model outputs.
- Setting lineups, proposing trades or making waiver claims on my behalf. No alerts, and no tracking of who is a free agent in each league.
- Open sign-up. **[built]** Access is invite-only: the admin gives specific people access (see Access); each gets their own teams and watchlist.
- Category-specific advice per league format. The stats panel is the same for every team.

## Core user flow

1. The NBA publishes an injury report (every 15 minutes on game days).
2. The tool parses it into structured updates: player, team, status, reason, game.
3. It works out who benefits, or who loses out on a return, from the team's depth chart.
4. It checks each name against all my teams and the watchlist.
5. I open the tool and see the updates grouped by game, the next-up calls and their recent stats side by side.
6. I act on my fantasy platform: start, sit, add or drop.
7. If I add or drop someone, I update that team's roster in the tool.

## Access

- **[built]** Invite-only. The admin (`ADMIN_EMAIL`) gives people access on a People page: it creates the account and a one-time sign-in link to send them, with no email involved. Each person has their own teams, rosters and watchlist. The injury feed, next-up calls and stats are shared, so more people cost no extra model calls.
- Sign in with a Supabase email magic link, sent to existing accounts only. Unknown addresses get the same "check your inbox" reply.
- **[built]** Supabase's built-in email allows only a few messages an hour. Two workarounds: the People page's "New sign-in link", and `npm run login-link` for the admin. Both mint a one-time link with the secret key instead of sending email.
- **[built]** New sign-ups are switched off in Supabase, so accounts are only created by the admin.
- **[built]** The manual "Update next-up calls" button and its daily Gemini allowance are admin-only.
- Row-level security on every table: my teams, rosters and watchlist are readable and writable only by my account. Shared data (players, injury updates, games, next-up) is read-only for signed-in users and written only by server jobs with the secret key. Anonymous requests are refused on every table and function.
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

## Feature 3: Next-up inference

For every player ruled out (out or doubtful), the tool names who is likely to gain minutes or usage and gives a one-sentence reason. For every player returning, it names who is likely to lose minutes.

**Requirements (as built)**

- **Depth chart from box scores:**
  - The window is the team's last 10 games, from the current season once it has 3 games, excluding preseason.
  - A starter is a player who started at least half the games he played in the window. Order within a position follows minutes per game.
  - Players new to a team use their recent minutes with their previous team.
- **Candidate rules, in order:**
  1. For a starter, the bench player who started most often when he sat (in the team's last 20 games), or failing that the top bench player at his position.
  2. Bench players at his position.
  3. Starters at his position or a neighbouring one (G↔F↔C) who take on more usage.
  4. **[built]** Any player with a clear measured jump while he sat (+4 minutes or +2.5 usage a game), at any position.

  **[built] With/without splits:** for every teammate, the per-game change in minutes, shots (FGA), usage (FGA + 0.44 FTA + TOV) and points in the team's last 20 games, comparing games the player missed with games he played. A split counts with 3+ games on each side. Games a teammate wasn't on the box score are left out; a "did not play" counts as zero. Measured gains rank candidates within each rule, and appear in the reasons, in the model's prompt and in the feed.

  The rules supply about 6–8 candidates. The rule answer is the strongest of each type, up to three.
- **Returns:** a player moving from out or doubtful to probable or available, within a game or since his previous game. Losers are players who started more while he sat, players whose minutes or usage clearly rose while he sat, and backups at his position.
- **Model:** Gemini `gemini-3.5-flash-lite` (free tier) orders the candidates and writes the reasons. It sees the depth chart, each candidate's rule note (e.g. "started 3 of the 4 games he missed") and any with/without split, and is told to prefer measured gains over position alone.
  - Any name not among that player's candidates is rejected.
  - A player the model leaves without a valid call gets the rule answer.
  - Reasons are cut to one sentence; initials such as "P.J." are kept.
  - Malformed JSON is retried once.
- **Storage:** one answer per (NBA team, game, set of absent and returning players). The model is called again only when that set changes.
- **[built] Free-tier rate limits:** at most 8 model calls per refresh, and the model stops for the rest of the run at the first 429. Remaining games get the rule answer straight away and are upgraded on a later refresh, up to 3 model attempts.
- Out and doubtful players are never named; questionable players are flagged; G League assignments are not treated as absences.
- Each call is labelled: into the starting lineup, more bench minutes, more usage, or loses minutes. Ownership is marked as my team names, Watchlist or Unowned.

**Acceptance criteria**

| Criterion | Result |
| --- | --- |
| Every out or doubtful update has at least one named beneficiary with a one-sentence reason | Rules fall back to the busiest available player when no positional candidate exists. The model never leaves an absent player uncovered |
| No beneficiary is himself out or doubtful for the same game | Excluded before candidates are built; the model can only pick from candidates. Unit-tested |
| Backtest: in at least 70% of 15–20 past absences, a named beneficiary beats his 14-game minutes average | 20 regular-starter absences from 2025-26, using only earlier box scores: **rules 18/20 (90%)**, **rules + model 18/20 (90%)**. Both misses are honest: one named replacement also sat that night (unknowable without that night's report), one where everyone named played slightly below average. Rules alone across all 486 starter absences: **441/486 (91%)** |
| (Added) Per named player, leaving out anyone who sat that night: how often he beats his 14-game minutes and usage averages | Rules, all 486 absences: 65% beat minutes, 63% beat usage, +2.7 min and +1.8 usage a game on average (64% / 62% / +2.5 / +1.7 before splits). In the 191 absences with 3+ earlier missed games: 69% / 64% / +3.2 / +1.9 (67% / 63% / +2.7 / +1.7 before splits). On the 20-absence sample: rules 61% / 53%, rules + model 58% / 51% with 4 of 20 model calls failing on a busy API. The model doesn't yet beat the rules; it mostly rewords them |
| The Cooper Flagg example names Marshall and Risacher, or explains why not | With the 2026-27 Dallas roster: Risacher into the starting lineup, Marshall more usage |

## Feature 4: Recent player stats

**Requirements (as built)**

- Averages over the last 7, 14 and 30 games played, next to the season average, computed in Postgres (`player_stat_windows`) from stored box scores.
- **[built]** "Current season" is the latest regular season with games stored, labelled e.g. "2025-26". Before 2026-27 starts the panels show 2025-26, and they switch automatically after the first regular-season game is loaded.
- Columns: games played, minutes, points, rebounds, assists, steals, blocks, threes made, turnovers, FG% and FT%, with FGA and FTA per game in brackets.
- Percentages are total makes divided by total attempts over the window.
- A collapsed line shows recent form ("Last 14: 25.6 pts · 2.9 reb · 8.1 ast · 35.9 min"), opening into the full table. Green or red marks a window clearly above or below the season (10% for counting stats, 3 points for percentages, turnovers reversed, at least 3 games).
- Shown on rostered players and the watchlist (Teams page), and on my players and every next-up name (feed).
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
| Next-up reasoning | Gemini `gemini-3.5-flash-lite`, OpenAI-compatible endpoint | Free tier, about 8–10 calls a minute. Groq is a drop-in swap through settings |
| Hosting | Vercel Hobby | One cron job a day (10:00 UTC, imprecise timing) |
| Database | Supabase Free | Pauses after 7 idle days; the daily job keeps it active |

**Ruled out in Phase 0:** `stats.nba.com` / `nba_api` (timed out even from a home connection), `cdn.nba.com` live data (403 on every request), balldontlie (box scores cost $9.99 a month), the X API ($0.005 per post read).

**Cost rule.** Nothing needs a card on file. If a source starts charging, it is swapped out, not paid for.

## Risks and known limitations

- **Slower news:** the official report trails Underdog, so some late scratches will be missed before tip-off.
- **Early-season depth charts:** until each team has about 10 games (about three weeks), depth charts lean on last season's final games and new arrivals' old-team minutes. Early calls rely more on the model's own knowledge.
- **Box-score lag:** depth charts lag rotation changes by a game or two. A player's first game after a trade is the weakest case.
- **Unofficial ESPN API:** it is free and keyless but undocumented, so it could change without notice. Each source sits behind its own adapter for easy swapping.
- **Free tiers change:** Gemini's per-minute limit already shapes the refresh budget, and limits can tighten again.
- **Email sign-in:** the built-in sender is rate limited; `npm run login-link` is the workaround. A custom SMTP sender (e.g. Resend's free tier) would fix it for good.
- **Supabase pause:** the daily job runs all year, so the project should never sit idle for 7 days. **[verify]** that a scheduled query counts as activity.

## Phasing

| Phase | What shipped | Done when | Result |
| --- | --- | --- | --- |
| 0. Data spike | Source adapters; `/api/spike` and `npm run spike` checks | Each source returns real data from a deployed Vercel function | Passed from Vercel iad1 |
| 1. Teams | Login, teams, rosters, watchlist, daily player sync | Rebuild all teams in under 10 minutes | Met |
| 2. Feed | Report ingest, history, matching, game-grouped feed, time zones, refresh, archive; league-wide game logs (2025-26 backfilled: 1,327 games, 34,881 player lines) | Feature 2 accuracy criterion met on one game day | Met on 2026-03-15 data; live confirmation pending |
| 3. Next-up | Depth charts, rules, model, storage, return calls, feed display, backtest | Backtest meets 70% and the Flagg example is sensible | 90% / 90% (rules 91% on all 486 absences); Flagg example passes |
| 4. Stats | Stat windows, panels on Teams and feed, All-Star and Cup final exclusion, spot check | 5-player spot check matches a reference | 5 of 5 |
| Later | Roster sync from fantasy platforms; category advice per league format; alerts | Out of scope for v1 | |

## Open items

- [ ] On the first regular-season game day (about Oct 20), run `/api/spike` and confirm `nba.injuryReport.latest` passes rather than skips, and that the feed fills within 10 minutes of opening.
- [ ] **[verify]** Supabase counts the daily job's queries as activity (no pause over a quiet week).
- [ ] After about three weeks of the season, re-run `npm run backtest-nextup -- --season 2027` on 2026-27 data.
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
