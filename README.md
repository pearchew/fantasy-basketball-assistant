# Fantasy Team Injury Tracker

A personal tool that watches NBA injury news and tells me which players stand to gain, starting with the ones on my fantasy teams.

It collapses three chores into one view:
1. **Who is out:** the NBA's official injury report, parsed and grouped by game.
2. **Who gains:** for each injured player, how every current teammate did in the games he sat versus the games he played (on/off splits).
3. **How they've been playing:** averages over the last 7, 14 and 30 games next to the season average.

Live app: https://fantasy-basketball-assistant-five.vercel.app (invite-only)<br>
Product requirements, decisions and acceptance results: **[docs/PRD.md](docs/PRD.md)** · Data-source research: [docs/phase-0-findings.md](docs/phase-0-findings.md)

Everything runs on free tiers with no card on file: Vercel Hobby, Supabase Free, ESPN's public site API and the NBA's injury report PDFs.

---

## Contents

- [Architecture](#architecture)
- [Workflows](#workflows)
- [Function reference](#function-reference)
- [HTTP routes](#http-routes)
- [Scripts](#scripts)
- [Database](#database)
- [Setup](#setup)
- [Testing and checks](#testing-and-checks)
- [Project structure](#project-structure)

## Architecture

```mermaid
flowchart LR
  subgraph Sources
    NBA[NBA injury report PDF<br/>every 15 min on game days]
    ESPN[ESPN site API<br/>rosters, scoreboards, box scores]
  end

  subgraph Vercel["Next.js on Vercel"]
    Cron["/api/cron/daily<br/>10:00 UTC"]
    Refresh["/api/refresh<br/>on open or button"]
    Pages["Pages: / feed, /teams"]
    Actions[Server actions<br/>teams, rosters, watchlist]
  end

  subgraph Supabase["Supabase Postgres (RLS)"]
    Players[(players)]
    Teams[(fantasy_teams<br/>roster_spots<br/>watchlist)]
    Updates[(injury_updates<br/>ingest_state)]
    Logs[(games<br/>game_logs)]
    Fn[[player_stat_windows<br/>on_off_splits]]
  end

  ESPN --> Cron
  NBA --> Cron
  NBA --> Refresh
  Cron --> Players & Logs & Updates
  Refresh --> Updates
  Actions --> Teams
  Players & Teams & Updates --> Pages
  Logs --> Fn --> Pages
```

**Design principles**

- **Every source sits behind its own adapter** in `src/lib/sources/`, so a source that changes or starts charging can be swapped out.
- **Ingest is idempotent:** re-running any job upserts the same rows.
- **The pure logic is unit-tested:** parsing, matching, merging, on/off shaping and stats are pure functions.
- **Numbers, not guesses:** the feed shows measured with/without splits and recent form; it doesn't name winners for you.
- **Derived numbers are computed when the page loads,** in Postgres, so they always include last night's games and there's nothing to keep in sync.
- **Pages never wait on the network:** they render saved data and refresh in the background.

## Workflows

### 1. Opening the feed

```mermaid
sequenceDiagram
  participant B as Browser
  participant P as Feed page (/)
  participant R as /api/refresh
  participant DB as Supabase
  participant NBA as NBA report
  B->>P: GET /
  P->>DB: loadFeed() + loadOnOff() + loadStats()
  P-->>B: saved data, grouped by game, in my time zone
  alt last check > 10 min ago (or Refresh pressed)
    B->>R: POST {manual}
    R->>DB: claim the refresh window
    R->>NBA: findLatestReport()
    R->>DB: upsert injury_updates
    R-->>B: result
    B->>P: router.refresh()
  end
```

1. **`FeedPage`** (`src/app/page.tsx`) reads the time zone cookie (`timeZoneFrom`).
2. It calls **`loadFeed`**, which:
   - loads upcoming `injury_updates`, my teams and the watchlist
   - builds the view with **`buildFeed`**: games ordered by tip-off (`gameStartUtc`) and my players pinned
3. **`loadOnOff`** fetches on/off splits for everyone out, doubtful, questionable or returning (see workflow 3). **`tableFor`** shapes each table for its game, and **`myGains`** picks out "your players who gain".
4. **`loadStats`** fetches recent form for my players and every teammate in a table, 200 players per database call. The form is handed to the browser once (`StatsProvider`) rather than with each table.
5. **`RefreshControls`** (client) calls `POST /api/refresh`:
   - automatically, when `isStale` says the last check is over 10 minutes old
   - on demand, when I press **Refresh**
6. Once the refresh finishes, the page reloads its data.

### 2. Injury report ingest: `ingestLatestReport` (`src/lib/injuryIngest.ts`)

1. **Claim the refresh window.** An atomic update on `ingest_state` allows one fetch per 10 minutes (1 minute for a manual refresh). The cron job forces it.
2. **`findLatestReport`** walks back through 15-minute URL slots (`reportUrlFor`) until a report exists. It gives up after 4 hours: no report means no games.
3. If the URL is the one already ingested, it stops with status `unchanged`.
4. **`parseInjuryReport`** reads the PDF with `unpdf`:
   - groups text into rows by position and finds columns from the header
   - carries the date, matchup and team down to the rows that leave them blank
   - stitches wrapped reasons back together
   - records the printed rows as `rawText`
5. It loads the player directory (`indexDirectory`) and ESPN team names, then matches each name with **`matchPlayer`**: same team first, then a unique name league-wide.
6. **`planInjuryUpserts`** merges the report into one row per (player, game):
   - **New rows:** first-seen time and one history item.
   - **Changes:** a new history item and a new `changed_at`.
   - **Repeats:** the report time only.
   - **Older reports:** skipped.
   - **Flags:** `ongoing` (same status as the previous game) and `is_returning` (from out or doubtful to probable or available).
7. Upserts the rows and records the report URL and time in `ingest_state`.

### 3. On/off splits: `loadOnOff` (`src/lib/onOff.ts`)

For each injured player, how his teammates did in the team's games he sat versus the games he played.

1. **Who gets a table** (`hasOnOff`): matched players who are out, doubtful or questionable (not G League assignments), or returning. Out, doubtful and returning tables open by default; questionable ones start collapsed.
2. **The Postgres function `on_off_splits(players, teams, seasons, before)`** does the work in one call per 60 players, over this season and last, using regular-season games that count for stats and were played before the day being viewed:
   - **His games:** if he played for another team that season, the team's games from his first appearance for it. If he played for this team, the whole season. With no games anywhere, the whole of the season under way (hurt since opening night), but nothing for an earlier season, when he may not have been in the league.
   - **Sat or played:** he sat a game unless he has a box-score line with minutes in it.
   - **Teammates:** current active roster only. Each teammate's averages on each side cover the games he was on the box score (a "did not play" counts as zero), so his own absences don't skew them. Starts are counted, and FG% and FT% are total makes over attempts.
3. **`toOnOff`** turns the rows into one table per player and season, sorted by minutes gained. Rows with 3+ games on both sides come first, then thin ones (`MIN_GAMES`). Seasons he didn't spend with the team are dropped.
4. **`pickSeason`** chooses the season the table opens on: this season once he's sat 3+ games in it, otherwise the latest earlier season he sat any. A toggle switches seasons.
5. **`tableFor`** drops teammates who are out or doubtful for the same game, and tags questionable ones and my players.
6. **`myGains`** finds "your players who gain": my players with 3+ games each way who gained at least 3 minutes or 3 points a game (`isClearGain`) while an out or doubtful teammate sat.
7. **`OnOffTable`** (client) shows per-game averages when he sat, with the change from when he played underneath. **`change`** colours clear gains green and drops red, on the same scale as the recent-form table. Tapping a name opens his last 7 / 14 / 30 / season (`StatsTable`).
8. Never throws: on error, each table says the splits are unavailable.

### 4. Daily job: `GET /api/cron/daily` (Vercel Cron, 10:00 UTC)

Each step runs even if an earlier one fails, and the response reports each step's result.

1. **`syncPlayers`:** `fetchPlayerDirectory` loads all 30 ESPN rosters, `planPlayerSync` plans the upserts and inactive marks (refusing a fetch under 350 players), and the plan is written to `players`.
2. **`ingestGameLogs(yesterday)`:** `fetchScoreboard` lists completed games and `fetchBoxScore` loads each one. Rows go to `games` and `game_logs`, tagged with season type and `counts_for_stats` (false for All-Star games and the NBA Cup final).
3. **`ingestLatestReport({ force: true })`**

The job also keeps the free Supabase project from pausing.

### 5. Recent stats: `loadStats` (`src/lib/stats.ts`)

1. **`currentSeason`** finds the latest regular season with games stored.
2. Calls the Postgres function **`player_stat_windows(ids, season)`**, 200 players per call. Over games played that count for stats, it returns 7-, 14- and 30-game and season averages, plus make and attempt totals.
3. **`toPlayerStats`** turns rows into windows, with FG% and FT% as total makes over total attempts.
4. **`StatsPanel`** shows a one-line summary that opens into the table (`StatsTable`, also used inside on/off tables). **`trend`** colours windows clearly above or below the season average.
5. Never throws: on error, the panel says stats are unavailable.

### 6. Teams, rosters and the watchlist (`src/app/actions.ts`)

- **`TeamsPage`** calls `loadDashboard` → `assembleDashboard` to get teams, rosters, the watchlist and the directory for autocomplete. For each player it records every team he's on.
- **`PlayerSearch`** filters the directory in the browser with `searchPlayers` (word prefixes, accents ignored). Enter or a click calls `addToTeam` or `addToWatchlist`.
- **`PlayerTable`** removes players with `removeFromTeam` or `removeFromWatchlist` and shows `StatsPanel` rows.
- **`TeamForms`**: `createTeam`, `updateTeam` (name and format) and `deleteTeam`.
- Every server action checks the session (`signedInClient`) before writing. Row-level security enforces ownership again in the database.

### 7. Access and sign-in (invite-only)

- **Admin:** `ADMIN_EMAIL` (falling back to `ALLOWED_EMAIL`), checked by **`isAdmin`** (`src/lib/access.ts`). The admin sees **People**.
- **Inviting:** on **People** (`/people`, admin only), **`inviteUser`** creates the account with `generateLink({ type: "invite" })` and returns a one-time `token_hash` link to copy and send. No email is sent. For someone who already has access, it returns a fresh sign-in link instead.
- **Signing in:** **`sendMagicLink`** emails a link to existing accounts only (`shouldCreateUser: false`). Unknown addresses get the same "check your inbox" reply. **`/auth/callback`** exchanges a `code` (PKCE) or verifies a `token_hash` (`invite` or `magiclink`), then redirects to `/`.
- **Without email:** **`npm run login-link`** mints and opens a one-time link for the admin. `-- --email friend@x.com` prints one to send instead. Both avoid the built-in email rate limit.
- **Sign-ups stay off in Supabase,** so accounts are only ever created by the admin.
- **What each person has:** their own teams, rosters and watchlist (row-level security), and the shared feed, on/off splits and stats.
- **`updateSession`** (`src/lib/supabase/proxy.ts`, run by `src/proxy.ts`) refreshes the session cookie on every page request and redirects signed-out visitors to `/login`.

### 8. Time zone

- **`TimeZoneControl`** (client) writes the browser's zone to the `tz` cookie, keeps it in sync unless one was picked by hand (`tz_manual`), and offers a selector.
- **`timeZoneFrom`** reads the cookies on the server, so the first render already shows local times. The formatters in `format.ts` (`clock`, `dayLabel`, `when`, `localDate`) take the zone as an argument.

## Function reference

### Data sources: `src/lib/sources/`

| Function | File | What it does |
| --- | --- | --- |
| `fetchWithTimeout`, `fetchJson` | `http.ts` | Fetch with a browser-like User-Agent, a timeout and no caching |
| `mapLimit` | `http.ts` | Runs async work over a list with bounded concurrency |
| `reportUrlFor` | `nbaInjuryReport.ts` | URL of the injury report for the 15-minute Eastern slot containing a time |
| `findLatestReport` | `nbaInjuryReport.ts` | Walks back slot by slot to the newest published report (16 slots max) |
| `fetchReport` | `nbaInjuryReport.ts` | Downloads a report PDF |
| `parseInjuryReport` | `nbaInjuryReport.ts` | PDF → entries, not-submitted teams and warnings, by page layout |
| `fetchTeams`, `fetchRoster`, `fetchPlayerDirectory` | `espn.ts` | ESPN teams and rosters → the player directory (IDs, names, positions, teams) |
| `fetchScoreboard` | `espn.ts` | Games on a date with status, season, season type and competition type |
| `fetchBoxScore` | `espn.ts` | One game's player lines: starter flag, minutes, counting stats, makes and attempts |
| `fetchGameLogsForDate` | `espn.ts` | Every completed game's box score for a date |
| `fetchEspnInjuries` | `espn.ts` | ESPN's injury list (secondary feed; used in Phase 0 checks) |

### Core logic: `src/lib/`

| Function | File | What it does |
| --- | --- | --- |
| `nameKey` | `names.ts` | Matching key: accents, punctuation and suffixes removed, lowercased |
| `flipReportName` | `names.ts` | "Lively II, Dereck" → "Dereck Lively II" |
| `easternDate`, `addDays`, `compactDate` | `time.ts` | Eastern calendar dates and date arithmetic |
| `easternToUtc` | `time.ts` | Eastern wall-clock time → instant (handles daylight saving) |
| `parseReportTime` | `time.ts` | "03/15/26 05:00 PM" → instant |
| `gameStartUtc` | `time.ts` | "07:30 (ET)" on a game date → tip-off instant (12 is noon, others PM) |
| `localDate`, `clock`, `dayLabel`, `when`, `ago`, `gameDateLabel` | `format.ts` | Display formatting in a given time zone |
| `timeZoneFrom`, `isValidTimeZone` | `timezone.ts` | Reads and validates the display time zone from cookies |
| `planPlayerSync`, `syncPlayers` | `playerSync.ts` | Directory sync plan (upserts and inactive marks, with a size guard) and its database write |
| `matchPlayer`, `indexDirectory`, `updateKey` | `injuryIngest.ts` | Report name → ESPN ID; the (player, game) key |
| `planInjuryUpserts` | `injuryIngest.ts` | Merges a report into stored updates: history, flags, ordering safety |
| `ingestLatestReport` | `injuryIngest.ts` | Rate-limited fetch, parse, match and upsert of the newest report |
| `ingestGameLogs` | `gameLogIngest.ts` | Stores a date's games and box-score lines |
| `assembleDashboard`, `loadDashboard` | `dashboard.ts` | Teams, rosters, watchlist and directory, with every team each player is on |
| `searchPlayers` | `search.ts` | Autocomplete: word-prefix match, first-name matches first |
| `buildFeed`, `loadFeed`, `isStale` | `feed.ts` | Feed view model: games by tip-off, my players, unmatched names; who holds whom |
| `hasOnOff`, `loadOnOff`, `toOnOff`, `pickSeason` | `onOff.ts` | Which updates get a table; splits from `on_off_splits`, sorted, with the opening season |
| `tableFor`, `myGains`, `isClearGain`, `change` | `onOff.ts` | Per-game table (same-game absences dropped, tags added); my clear gains; colouring |
| `seasonLabel`, `currentSeason`, `toPlayerStats`, `trend`, `loadStats` | `stats.ts` | Stat windows, percentages, trend colouring, never-throwing loader |
| `runSpike` | `spike.ts` | Phase 0 source checks (directory, box scores, report, matching) |

### Server actions and auth helpers

| Function | File | What it does |
| --- | --- | --- |
| `createTeam`, `updateTeam`, `deleteTeam` | `src/app/actions.ts` | Team management (name 1–60 characters; format h2h_9cat or roto) |
| `addToTeam`, `removeFromTeam` | `src/app/actions.ts` | Roster changes (adding the same player twice is ignored) |
| `addToWatchlist`, `removeFromWatchlist` | `src/app/actions.ts` | Watchlist changes |
| `sendMagicLink`, `signOut` | `src/app/actions.ts` | Sign-in links for existing accounts only; sign-out |
| `inviteUser` | `src/app/actions.ts` | Admin: creates an account (or reuses one) and returns a one-time sign-in link |
| `adminEmail`, `isAdmin`, `isEmail` | `src/lib/access.ts` | Who the admin is; email shape check |
| `createClient` | `src/lib/supabase/server.ts` | Supabase client acting as the signed-in user (RLS applies) |
| `createAdminClient` | `src/lib/supabase/admin.ts` | Secret-key client for jobs (bypasses RLS; server only) |
| `updateSession` | `src/lib/supabase/proxy.ts` | Session refresh and sign-in redirect for every page |

### UI components: `src/components/`

| Component | What it shows |
| --- | --- |
| `AppHeader` | Injuries / Teams (/ People for the admin) navigation and sign-out |
| `RefreshControls` | Automatic refresh when stale, plus the Refresh button |
| `UpdateItem` | One injury update with history, report text, ownership and its on/off table |
| `OnOffTable` | Teammates when he sat vs played: season toggle, show all, tap a name for recent form |
| `StatusBadge`, `OwnerTags` | Status and "which of my teams" tags |
| `StatsPanel`, `StatsTable` | Recent form: summary line and window table |
| `StatsProvider` | Hands the page's recent form to on/off tables once |
| `PlayerSearch` | Autocomplete add-player box |
| `PlayerTable` | A roster or the watchlist, with remove buttons and stats rows |
| `NewTeamForm`, `NewTeamButton`, `TeamSettings` | Create, rename, change format, delete |
| `TimeZoneControl` | Time zone detection and selector |

## HTTP routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /` | Session | Injury feed (`?date=YYYY-MM-DD` for a past day) |
| `GET /teams` | Session | Teams, rosters and watchlist (`?view=all`, `?view=watchlist` or `?view=<team id>`) |
| `GET /people` | Admin | Who has access; give access and copy one-time sign-in links |
| `GET /login` | None | Sign-in form |
| `GET /auth/callback` | One-time link | Completes sign-in |
| `POST /api/refresh` | Session | Ingests the newest report. Body `{"manual": true}` for the 1-minute window |
| `GET /api/cron/daily` | `Bearer $CRON_SECRET` | Daily job (Vercel Cron sends the header) |
| `GET /api/spike` | `Bearer $SPIKE_SECRET` | Phase 0 source checks from the server |

## Scripts

Run them from the project folder; each reads `.env.local`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Local app at http://localhost:3000 |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run build` | ESLint / production build (includes type checks) |
| `npm run spike` | Phase 0 source checks from this machine; add `-- --json` for details |
| `npm run login-link` | Opens a one-time admin sign-in link for localhost; add `-- https://<deployment>` for the live app, or `--email friend@x.com` to print a link to send |
| `npm run sync-players` | Loads or refreshes the player directory now |
| `npm run backfill-logs -- 2025-10-21 2026-06-20` | Loads box scores for a date range (safe to re-run) |
| `npm run spot-check-stats` | Compares 5 players' season averages with ESPN's official numbers |
| `npm run spot-check-onoff` | Recomputes on/off splits from raw box scores and compares them with `on_off_splits`; add player names to choose who |

## Database

Migrations live in `supabase/migrations/`. Run them in order in the Supabase SQL editor.

| Object | Written by | Contents |
| --- | --- | --- |
| `players` | daily sync | ESPN directory: ID, name, `name_key`, position, team, active |
| `fantasy_teams`, `roster_spots`, `watchlist` | me (server actions) | My teams, rosters and watchlist; owner-only RLS |
| `injury_updates` | refresh, cron | One row per (player, game): status, reason, raw text, history, `ongoing`, `is_returning` |
| `ingest_state` | refresh, cron | Rate-limit window, last report URL and time, last error |
| `games`, `game_logs` | cron, backfill | Box scores with season, season type, competition type, `counts_for_stats` |
| `player_stat_windows(ids, season)` | function | 7-, 14- and 30-game and season averages over games played that count for stats |
| `on_off_splits(players, teams, seasons, before)` | function | Each current teammate's per-game averages in the games a player sat and played |
| `next_up`, `model_budget` | (unused) | Left from the old Gemini next-up calls; `0007_on_off.sql` has the commands to drop them |

Signed-in users can read the shared tables; only the secret key writes them. Anonymous access is refused everywhere.

## Setup

1. **Install:** Node 20+, then `npm install`.
2. **Supabase:** create a free project and run the migrations in order. Under Authentication → URL Configuration, set the Site URL to your deployment and add `http://localhost:3000/**` and `https://<deployment>/**` as redirect URLs.
3. **Settings:** `cp .env.example .env.local` and fill in:

   | Variable | Where it comes from |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (public) |
   | `SUPABASE_SECRET_KEY` | Same page, Secret keys (`sb_secret_…`, server only) |
   | `ADMIN_EMAIL` | The admin's address (manages people). `ALLOWED_EMAIL` still works |
   | `CRON_SECRET`, `SPIKE_SECRET` | `openssl rand -hex 32` each |

4. **Load data:**
   - `npm run sync-players`
   - `npm run backfill-logs -- <season start> <yesterday>` (last season too, for on/off tables early in the season)
5. **Deploy:** import the repo in Vercel and add the same variables. Make the two `NEXT_PUBLIC_` ones *Config* and the rest *Secret*. `vercel.json` schedules the daily job.
6. **Sign in and lock down:**
   - Create your own account once: run `npm run login-link -- https://<deployment>`, or temporarily allow sign-ups and use the email link.
   - Turn off **Allow new users to sign up** in Supabase.
   - Invite people from **People**.

## Testing and checks

- **Unit tests (`npm test`, 56):**
  - report parsing against a real PDF (`tests/fixtures/`)
  - name matching, Eastern time and daylight saving, update merging and history
  - feed grouping and time zones
  - player sync, dashboard and search
  - on/off shaping, season choice, same-game exclusions, my gains and colouring
  - stat windows and trends
- **Acceptance checks:** `npm run spike` (sources), `npm run spot-check-stats` (5 of 5 match ESPN) and `npm run spot-check-onoff` (the database function matches a plain recomputation). Results are recorded in [docs/PRD.md](docs/PRD.md).

## Project structure

```
src/
  app/                  pages, server actions, API routes
    page.tsx            injury feed
    teams/page.tsx      teams, rosters, watchlist
    login/, auth/       sign-in
    api/                refresh, cron/daily, spike
  components/           UI components
  lib/
    sources/            NBA report, ESPN, HTTP adapters
    supabase/           server, admin and proxy clients
    *.ts                ingest, feed, on/off, stats, dashboard, time, formatting
  proxy.ts              session refresh and sign-in gate (Next 16 proxy)
scripts/                one-off and acceptance scripts
supabase/migrations/    database schema, in order
tests/                  unit tests and the PDF fixture
docs/                   PRD and Phase 0 findings
```
