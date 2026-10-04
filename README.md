# Fantasy Basketball Assistant

A personal tool that watches NBA injury news and tells me which players stand to gain. See [docs/PRD.md](docs/PRD.md).

**Status:** Phases 0–4 complete (v1). Phase 0 findings are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

## Stack

Next.js 16 (App Router) on Vercel Hobby, Supabase Free (from Phase 1). Every data source is free with no card on file.

| Need | Source | Code |
| --- | --- | --- |
| Injury news | NBA official injury report PDF, every 15 min on game days | `src/lib/sources/nbaInjuryReport.ts` |
| Player directory, game logs | ESPN public site API | `src/lib/sources/espn.ts` |
| Secondary injury feed | ESPN public site API | `src/lib/sources/espn.ts` |
| Next-up reasoning | Any OpenAI-compatible free tier (Gemini or Groq) | `src/lib/sources/llm.ts` |

## Develop

```bash
npm install
cp .env.example .env.local   # then fill in values
npm test                     # parser and name-matching tests
npm run spike                # Phase 0 checks from this machine
npm run dev
```

## Supabase setup (once)

1. Run each file in [`supabase/migrations/`](supabase/migrations/) in order in the Supabase SQL editor.
2. In Authentication → URL Configuration, set the Site URL to the Vercel URL and add `http://localhost:3000/**` and `https://<deployment>/**` as redirect URLs.
3. Load the player directory (`npm run sync-players`) and past game logs (`npm run backfill-logs -- 2025-10-21 2026-06-20`). After that, Vercel Cron runs `/api/cron/daily` at 10:00 UTC: player sync, yesterday's game logs, and an injury report check.
4. To sign in without waiting for an email (the free plan sends only a few per hour): `npm run login-link` for localhost, or `npm run login-link -- https://<deployment>`.
5. After your first sign-in, turn off "Allow new users to sign up" in Authentication → Sign In / Providers.

## How the feed refreshes

Opening the feed shows saved data straight away. If the last check is over 10 minutes old, the page calls `POST /api/refresh`, which fetches the newest official report (published every 15 minutes on game days), merges it into one row per player and game, and reloads the page. The server allows one fetch per 10 minutes however often the page is opened. `/?date=YYYY-MM-DD` shows a past game day from the archive.

## Next-up inference

For each team-game with someone out, doubtful or returning, rules build a depth chart from the team's last 10 box scores (current season once it has 3 games) and pick candidates: whoever started when the player sat, bench players at his position, then starters at or next to it. Gemini orders them and writes the reasons; any name outside the candidate list is rejected and the rule answer is used instead. Answers are stored per (team, game, set of absent and returning players), so the model is called again only when that set changes. Free-tier rate limits: at most 8 model calls per refresh; the rest get the rule answer and are upgraded on a later refresh.

`npm run backtest-nextup` (add `-- --model` to include Gemini) replays 20 past starter absences from 2025-26 and checks whether a named player beat his 14-game minutes average. Oct 4, 2026: rules 18/20, rules + model 18/20; target 14/20.

## Recent stats

Rostered players, the watchlist and every next-up name show averages over their last 7, 14 and 30 games played next to the season average, computed in Postgres (`player_stat_windows`) from stored box scores. "Current season" is the latest regular season with games stored. FG% and FT% are total makes over attempts. ESPN labels the All-Star games and the NBA Cup final as regular season; they're stored with `counts_for_stats = false` and left out, matching official stats.

`npm run spot-check-stats` compares five players' season averages with ESPN's official numbers (Oct 4, 2026: all five match for 2025-26; minutes can differ by under 0.1 because box scores give whole minutes).

## Phase 0 check on Vercel

Deploy, set `SPIKE_SECRET` (and the `LLM_*` variables) in the Vercel project, then:

```bash
curl -s -H "Authorization: Bearer $SPIKE_SECRET" https://<deployment>/api/spike
```
