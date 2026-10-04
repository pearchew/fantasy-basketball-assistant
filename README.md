# Fantasy Basketball Assistant

A personal tool that watches NBA injury news and tells me which players stand to gain. See [docs/PRD.md](docs/PRD.md).

**Status:** Phase 2 (injury feed). Phase 0 findings are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

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

## Phase 0 check on Vercel

Deploy, set `SPIKE_SECRET` (and the `LLM_*` variables) in the Vercel project, then:

```bash
curl -s -H "Authorization: Bearer $SPIKE_SECRET" https://<deployment>/api/spike
```
