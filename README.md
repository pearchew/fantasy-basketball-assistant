# Fantasy Basketball Assistant

A personal tool that watches NBA injury news and tells me which players stand to gain. See [docs/PRD.md](docs/PRD.md).

**Status:** Phase 0 (data spike). Findings are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

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

## Phase 0 check on Vercel

Deploy, set `SPIKE_SECRET` (and the `LLM_*` variables) in the Vercel project, then:

```bash
curl -s -H "Authorization: Bearer $SPIKE_SECRET" https://<deployment>/api/spike
```
