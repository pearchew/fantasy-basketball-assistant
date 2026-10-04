# Fantasy Basketball Assistant

A personal tool that watches NBA injury news and tells me which players stand to gain. See [docs/PRD.md](docs/PRD.md).

**Status:** Phase 1 (teams and rosters). Phase 0 findings are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

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

1. Run [`supabase/migrations/0001_teams_and_rosters.sql`](supabase/migrations/0001_teams_and_rosters.sql) in the Supabase SQL editor.
2. In Authentication → URL Configuration, set the Site URL to the Vercel URL and add `http://localhost:3000/**` and `https://<deployment>/**` as redirect URLs.
3. Load the player directory: `npm run sync-players`. After that, Vercel Cron runs `/api/cron/sync-players` daily at 10:00 UTC.
4. After your first sign-in, turn off "Allow new users to sign up" in Authentication → Sign In / Providers.

## Phase 0 check on Vercel

Deploy, set `SPIKE_SECRET` (and the `LLM_*` variables) in the Vercel project, then:

```bash
curl -s -H "Authorization: Bearer $SPIKE_SECRET" https://<deployment>/api/spike
```
