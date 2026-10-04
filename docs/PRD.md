# PRD: Fantasy Basketball Assistant (v2)

Oct 4, 2026 · @Pierson

> **About this revision.** v2 builds on the original PRD. Lines that changed or are new are marked **[v2]**. Claims not yet checked against a live source are marked **[verify]**. A changelog at the end maps each review point to the edit it produced.

## Summary

A personal tool that watches NBA injury news and tells me which players stand to gain. It starts with the ones on any of my fantasy teams or watchlist. **[v2]** It does not know who is a free agent in each league; "unowned" means not on any of my teams.

Today that means refreshing a news feed, working out who absorbs the minutes, then checking recent form on another site. The tool collapses those three steps into one view: who is out, who is next up, and how those players have been playing.

## Goals and non-goals

**Goals**

- Keep an up-to-date roster for each of my fantasy teams, editable in seconds.
- Surface injury and inactive news soon after the source publishes it.
- For each player ruled out, name the likely beneficiaries and say why.
- **[v2]** For each player returning from absence, name the players likely to lose minutes.
- Show recent form for any player over the last 7, 14 and 30 games.
- Cost nothing to build or run: free data, free hosting on Vercel and Supabase, no paid APIs.

**Non-goals for v1**

- Syncing automatically with my fantasy platform. The roster is entered by hand.
- Statistical projections. Next-up calls are reasoned inferences, not model outputs.
- Setting lineups, proposing trades or making waiver claims on my behalf. No alerts, and no tracking of who is a free agent in each league.
- Supporting other users. One person, several teams. **[v2]** The app is still deployed publicly, so it needs a login (see Access).
- **[v2]** Category-specific advice per league format. The stats panel is the same for every team.

## Core user flow

One loop covers the main use: news arrives, the tool reasons about it, I decide what to do.

1. A news source reports that a player is out, doubtful or returning.
2. The tool parses the report into a structured update: player, team, status, game date.
3. It works out who benefits, or who loses out on a return, using the team's current depth chart.
4. It checks each name against all my teams and shows which of them, if any, the player is on.
5. I open the tool and see the update, the beneficiaries and their recent stats side by side.
6. I act on my fantasy platform: start, sit, add or drop.
7. If I add or drop someone, I update that team's roster in the tool.

## Access **[v2]**

- Sign in with a Supabase email magic link. Both are free.
- Row-level security on every table limits reads and writes to my account.
- The refresh endpoint requires a signed-in session and runs at most once per 10 minutes, however often it is called. This protects the free model and data quotas.

## Feature 1: Teams and rosters

I can keep several fantasy teams, each with its own roster, and add or remove players on any of them.

**Requirements**

- Create, rename and delete teams. Each team has a name. **[v2]** The head-to-head 9-cat or roto format is stored as a label only; nothing in v1 depends on it.
- Switch between teams in one click, or view all teams together.
- Search for a player by name with autocomplete, then add them to a chosen team in one click.
- Remove a player from a team in one click.
- The same player can sit on more than one team.
- Each player is stored with a stable ID, NBA team and position, so name clashes and trades do not break matching.
- **[v2]** The player directory comes from one named free source, refreshed by the daily job. It must include rookies, two-way and 10-day contracts. The source is chosen in Phase 0.
- **[v2]** Position is taken from that directory source. It is NBA-listed position (G, F, C and combinations), not fantasy-platform eligibility.
- Teams and rosters persist between sessions.
- One shared watchlist holds players I do not own but want to track.

**Acceptance criteria**

- Adding or dropping a player takes under 10 seconds.
- A player on two of my teams shows both team names wherever he appears.
- When a rostered player changes NBA team, his team updates by the next daily refresh without me re-entering him.

## Feature 2: Injury and inactive feed

The tool pulls player availability news from a free source and turns each report into a structured update.

**Requirements**

- Ingest availability news from a free source. Underdog NBA on X stays the reference for speed and format, but X charges per post read, so it is out unless a free route turns up.
- **[v2]** The v1 source is assumed to be the NBA's official injury report, a structured table published at set times. **[verify]** Check its format and publishing schedule in Phase 0. If a free-text source is used instead, the free-text criteria below apply.
- Extract player, team, status (out, doubtful, questionable, probable, available), reason and the game it applies to.
- **[v2]** Match each name to a stable player ID. Normalise the order ("Last, First"), suffixes (Jr., III) and accents (Jokić, Dončić). Names that fail to match go to a review list and are never dropped silently.
- **[v2]** Collapse repeat reports into one update per (player, game). Keep the status history, for example questionable → out, and show the latest status.
- Show updates newest first, with players from any of my teams or the watchlist pinned to the top and tagged with the team name.
- **[v2]** Show new and changed statuses first. Collapse long-term absences whose status has not changed since the last report into one line per team.
- **[v2]** Archive an update once its game has been played.
- Keep the original text or table row, and its timestamp, alongside the parsed update so I can check it.
- **[v2]** Refresh when I open the tool if the data is more than 10 minutes old, plus one scheduled refresh a day. Cached data shows straight away while the refresh runs in the background, and the page updates when it finishes. Opening the tool never waits on ingest or the model.

**Acceptance criteria**

- **[v2]** Within 10 minutes of opening the tool, it shows every update in the most recent report the source published.
- **[v2]** Official report: every row in a day's game-day reports matches a player ID or appears on the review list, and at least 98 in 100 statuses match the source.
- **[v2]** Free-text source only: posts that are not about availability, such as starting lineups or scores, are tagged or filtered out, and at least 9 in 10 statuses are correct.

## Feature 3: Next-up inference

For every player ruled out, the tool names who is likely to gain minutes or usage and gives a one-line reason. **[v2]** For every player returning, it names who is likely to lose minutes.

This is a judgement call, not a projection, and it does not need stats to justify it. Example: if Cooper Flagg sits, Naji Marshall gains as the likely starter in his place, and Risacher gains as a player sharing that position.

**Requirements**

- Generate one to three beneficiaries per absent player.
- **[v2]** Candidate rules, in order:
  1. Next man at the position: the bench player who most often starts when this starter sits, or failing that the highest-minute bench player at the same position.
  2. Bench players who share the position.
  3. Starters at a neighbouring position who take on more usage, for example the main ball handler when a guard sits.
- A free-tier language model orders the candidates and writes the one-line reason. If the model is unavailable, the rule output is shown as is.
- **[v2]** The model's answer is accepted only if every name it returns is one of the rule candidates. Any other name means the rule output is shown instead.
- **[v2]** The depth chart comes from box scores, not a depth-chart site. Starters are whoever started most of the team's last 10 games, and the order within each position follows minutes per game over the same games. A player traded mid-season is grouped with his new team from his first game there. Before he has played a game for them, he is placed by position.
- Label each beneficiary by type: direct replacement in the starting lineup, more minutes off the bench, or more usage for an existing starter.
- Mark each beneficiary with the teams of mine he is on, or as watchlisted or unowned.
- When several players on one NBA team are out, reason about them together rather than one at a time.
- **[v2]** Inference is stored per (NBA team, game, set of absent players). The model is called again only when that set changes, such as a new absence or a return. The result covers every absent player on that team at once.
- **[v2]** Out and doubtful players are never named as beneficiaries. Questionable players can be named but carry a "questionable" flag.
- **[v2]** Returns: when a player moves from out or doubtful to probable or available, run the same rules in reverse and name one to three players likely to lose minutes. Label them "loses minutes on return."

**Acceptance criteria**

- Every out or doubtful update has at least one named beneficiary and a reason of one sentence.
- No beneficiary is a player who is himself listed as out or doubtful for the same game.
- **[v2]** Backtest on 15–20 past absences from the current or previous season. In at least 70% of absences, at least one named beneficiary plays more minutes in that game than his 14-game average.
- The Cooper Flagg example names Marshall and Risacher, or explains why not, without any extra prompting.

## Feature 4: Recent player stats

Where data is available, any player in the tool shows averages over his last 7, 14 and 30 games next to his season average.

**Requirements**

- Windows are counted in games played, not calendar days, so a player returning from injury is not shown with an empty week.
- **[v2]** Windows use the current regular season only. Early in the season they show what exists, with the game count.
- Show minutes, points, rebounds, assists, steals, blocks, threes made, turnovers, field goal % and free throw %. **[v2]** Also show field goal attempts and free throw attempts per game.
- **[v2]** Percentages are total makes divided by total attempts across the window, never the average of each game's percentage.
- Show the season average beside each window so a rise or fall is obvious.
- Stats appear on rostered players, watchlisted players and every beneficiary named by the next-up inference.
- If a player has fewer games than the window, show what exists and state the game count.
- If stats cannot be fetched, the rest of the tool still works and the stats panel says so.
- **[v2]** Game logs are fetched league-wide, one request per date where the source allows it, and stored. Windows are computed from the stored logs, not fetched per player.

**Acceptance criteria**

- Stats reflect games completed the previous night by the next morning. **[v2]** The daily job is scheduled around 10:00 UTC, after the last West Coast games finish. Refresh-on-open is the backstop because Vercel Hobby cron timing is imprecise.
- Averages match the box scores on a reference site for a spot-checked sample of 5 players.

## Data sources and risks

Every source must be free. That rules out the official X API and makes the news feed the weakest part of the tool.

| Need | Option | What to know |
| --- | --- | --- |
| Injury news | NBA's official injury report | Free and authoritative, but published on a fixed schedule and slower than Underdog. Likely v1 source. **[verify]** Format and schedule. |
| Injury news | Injury pages on free sports sites | Free to read. Scraping may breach their terms and breaks when pages change. Fallback only. |
| Injury news | Underdog NBA via the official X API | Ruled out: pay-per-use at $0.005 per post read. [X pricing](https://docs.x.com/x-api/getting-started/pricing) |
| Injury news | Scraping the X profile page | Free but fragile, needs a logged-in session and is likely against X's terms. Not recommended. |
| Depth charts | **[v2]** Built from box scores | **[v2]** Starters and minutes order come from stored game logs, so no separate source is needed. The cost is that Phase 3 now depends on the stats source. |
| Player directory | **[v2]** Chosen in Phase 0 | **[v2]** Needed for autocomplete, stable IDs, positions and trades. Refreshed daily. |
| Player stats | A free NBA stats API or library | Game logs are enough to compute every window. **[v2] [verify]** stats.nba.com, which `nba_api` uses, is said to block cloud server addresses, and balldontlie may have moved game logs to a paid tier. Test both from a Vercel function in Phase 0. |
| Next-up inference | Depth-chart rules plus a language model on a free tier | Rules pick candidates and always work. The model adds ordering and reasons, one call per (team, game, set of absent players). Provider not yet chosen. **[v2] [verify]** The free tier must not need a card on file. |
| Hosting | Vercel Hobby for the app and functions | Free. Scheduled jobs run once a day at most, at an imprecise time, so the tool also refreshes on open. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Database | Supabase Free | Holds teams, rosters, parsed updates and cached stats. A free project is paused after 7 days of low activity and can be restored for 90 days. [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing.md) |

**Cost rule.** Nothing in the tool may need a card on file. If a source starts charging, it is swapped out, not paid for.

**Other risks**

- Slower news: free sources trail Underdog, so some late scratches will be missed before tip-off.
- Parsing errors: a misread status leads to a bad start or sit decision. Showing the original text beside the parsed update limits the damage.
- Stale depth charts: the inference is only as good as the roster data it is given. **[v2]** Building the depth chart from box scores lags rotation changes by a game or two. A player's first game after a trade is the weakest case.
- Free tiers change: limits can tighten or vanish, so each source should be easy to swap.
- **[v2]** Off-season pause: the daily job runs all year, including the off-season, so the project should never sit idle for 7 days. **[verify]** Check that a database query from the job counts as activity for Supabase.

## MVP scope and phasing

The MVP is the smallest version that answers "who is out and who benefits" for my team. **[v2]** The inference now reads its depth chart from stored game logs, so stats ingestion moves ahead of next-up. Only the stats display stays in Phase 4.

| Phase | What ships | Done when |
| --- | --- | --- |
| **[v2]** 0. Data spike | Confirm free, card-free sources for the player directory, game logs (called from a Vercel function) and the injury report. Pick the language model. | Each source returns real data from a deployed Vercel function, and the choices are written into this PRD. |
| 1. Teams | Login. Create teams. Add, remove and persist players on each. Watchlist. Daily player directory refresh. | I can rebuild all my teams in the tool in under 10 minutes. |
| 2. Feed | Ingest reports from one free source and parse them into structured updates. **[v2]** Ingest and store league-wide game logs. | **[v2]** The Feature 2 accuracy criterion for the chosen source is met on one game day. |
| 3. Next-up | Beneficiaries, reasons and return losers for each changed status, flagged against all my teams. | **[v2]** The backtest meets the Feature 3 target, and the Cooper Flagg example names sensible players. |
| 4. Stats | Last 7, 14 and 30 game averages with season comparison. | Numbers match a reference site on a 5-player spot check. |
| Later | Syncing rosters from the fantasy platforms. Category advice per league format. | Out of scope for now. |

## Open questions

- [ ] ~~How many roto teams are there, and which categories does each roto league count?~~ **[v2]** Deferred: nothing in v1 depends on league format.
- [ ] Does Underdog NBA publish anywhere with a free feed, or is the official injury report the v1 source?
- [ ] Which free-tier language model, and what are its daily limits? Does it need a card on file?
- [x] ~~Which free source supplies depth charts, and how often does it update?~~ **[v2]** Built from box scores (see Feature 3).
- [ ] **[v2]** Which free source supplies the player directory and game logs, and does it work from Vercel?
- [ ] **[v2]** What is the official injury report's publishing schedule on game days?

## Changelog from v1 **[v2]**

Numbers refer to the review points. Point 1 is gone: it questioned whether Risacher plays for Dallas, but he joined the Mavericks in a three-team trade, so the example stands.

| # | Issue | Change |
| --- | --- | --- |
| 2 | Storing the model result per update clashes with reasoning about teammates together | Inference is stored per (team, game, set of absent players) |
| 3 | No rule produces the "more usage for a starter" type | Third candidate rule added |
| 4 | Summary promised "available to pick up" | Reworded to "on my teams or watchlist" |
| 5 | Feed criteria written for tweets | Separate criteria for the official report and for free-text sources |
| 6 | No depth chart source | Built from box scores; game-log ingestion moved to Phase 2 |
| 7 | Stats source unverified | New Phase 0 data spike |
| 8 | No access control | New Access section |
| 9 | Returns not handled | Return losers added to Feature 3 |
| 10 | Merge rule undefined | Merge key is (player, game), with status history kept |
| 11 | Long-term injuries crowd the feed | Changed statuses first, unchanged ones collapsed, updates archived after the game |
| 12 | Name matching unspecified | Normalisation rules and a review list |
| 13 | No player directory source | Directory requirement and open question added |
| 14 | Model output unchecked | Model names must come from the rule candidates |
| 15 | "Out" undefined for beneficiaries | Out and doubtful excluded; questionable flagged |
| 16 | Positions undefined | NBA-listed position from the directory |
| 17 | Refresh-on-open could stall | Cached data first, refresh in the background |
| 18 | Phase 3 test was subjective | Backtest target added |
| 19 | Percentage averages ambiguous | Makes ÷ attempts; FGA and FTA shown |
| 20 | Early-season windows undefined | Current regular season only |
| 21 | Cron timing | Scheduled around 10:00 UTC, refresh-on-open as backstop |
| 22 | Format field unused | Label only; roto question deferred |
| 23 | Off-season pause | Daily job runs all year **[verify]** |
| 24 | Card on file for the model | Added to the open question **[verify]** |
