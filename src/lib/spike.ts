// Phase 0 data spike: proves each free source answers from wherever this runs
// (laptop or a Vercel function) and that its data is usable.
import { nameKey } from "./names";
import {
  fetchEspnInjuries,
  fetchGameLogsForDate,
  fetchPlayerDirectory,
  type Player,
} from "./sources/espn";
import { chatJson, llmConfigFromEnv } from "./sources/llm";
import { fetchReport, findLatestReport, parseInjuryReport, type InjuryReport } from "./sources/nbaInjuryReport";

// A completed 2025-26 game day and its 5:00 PM ET report: known-good reference data.
const REFERENCE_DATE = "20260315";
const REFERENCE_REPORT_URL =
  "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-03-15_05_00PM.pdf";

export type CheckResult = {
  name: string;
  ok: boolean;
  skipped?: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
};

async function check(name: string, fn: () => Promise<{ ok: boolean; skipped?: boolean; detail?: unknown }>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return { name, ms: Date.now() - start, ...r };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

function matchReport(report: InjuryReport, directory: Player[]) {
  const byKey = new Map(directory.map((p) => [nameKey(p.name), p]));
  const unmatched = report.entries.filter((e) => !byKey.has(nameKey(e.playerName)));
  return {
    entries: report.entries.length,
    matched: report.entries.length - unmatched.length,
    matchRate: report.entries.length ? +(1 - unmatched.length / report.entries.length).toFixed(3) : null,
    unmatched: unmatched.map((e) => `${e.playerName} (${e.team})`),
  };
}

export async function runSpike(now = new Date()) {
  let directory: Player[] = [];

  const checks: CheckResult[] = [];

  checks.push(
    await check("espn.playerDirectory", async () => {
      directory = await fetchPlayerDirectory();
      const teams = new Set(directory.map((p) => p.teamAbbr));
      const noPosition = directory.filter((p) => !p.position).map((p) => p.name);
      return {
        ok: teams.size === 30 && directory.length >= 400,
        detail: {
          teams: teams.size,
          players: directory.length,
          noPosition,
          sampleDAL: directory.filter((p) => p.teamAbbr === "DAL").map((p) => `${p.name} ${p.position}`),
        },
      };
    }),
  );

  checks.push(
    await check("espn.gameLogs", async () => {
      const { games, lines } = await fetchGameLogsForDate(REFERENCE_DATE);
      const startersPerTeam = new Map<string, number>();
      for (const l of lines) if (l.starter) startersPerTeam.set(`${l.eventId}:${l.teamAbbr}`, (startersPerTeam.get(`${l.eventId}:${l.teamAbbr}`) ?? 0) + 1);
      const badStarterCounts = [...startersPerTeam].filter(([, n]) => n !== 5);
      return {
        ok: games.length > 0 && lines.length > 0 && badStarterCounts.length === 0,
        detail: {
          date: REFERENCE_DATE,
          games: games.length,
          lines: lines.length,
          played: lines.filter((l) => !l.didNotPlay).length,
          badStarterCounts,
          sample: lines.find((l) => l.name === "Cooper Flagg") ?? lines[0],
        },
      };
    }),
  );

  let reference: InjuryReport | null = null;
  checks.push(
    await check("nba.injuryReport.reference", async () => {
      reference = await parseInjuryReport(await fetchReport(REFERENCE_REPORT_URL));
      return {
        ok: reference.entries.length === 142 && reference.warnings.length === 0,
        detail: {
          url: REFERENCE_REPORT_URL,
          reportTime: reference.reportTime,
          entries: reference.entries.length,
          notSubmitted: reference.notSubmitted.length,
          warnings: reference.warnings,
        },
      };
    }),
  );

  checks.push(
    await check("nba.injuryReport.latest", async () => {
      const latest = await findLatestReport(now);
      if (!latest) return { ok: true, skipped: true, detail: "No report published in the last 4 hours (normal off game days)." };
      const report = await parseInjuryReport(latest.bytes);
      return {
        ok: report.warnings.length === 0,
        detail: {
          url: latest.url,
          reportTime: report.reportTime,
          entries: report.entries.length,
          warnings: report.warnings,
          ...(directory.length ? { match: matchReport(report, directory) } : {}),
        },
      };
    }),
  );

  checks.push(
    await check("nameMatching.reference", async () => {
      if (!reference || !directory.length) return { ok: false, detail: "Needs the directory and reference report." };
      // March names vs an October directory: misses here are mostly real roster churn.
      const m = matchReport(reference, directory);
      return { ok: (m.matchRate ?? 0) >= 0.8, detail: m };
    }),
  );

  checks.push(
    await check("espn.injuries", async () => {
      const injuries = await fetchEspnInjuries();
      return {
        ok: injuries.length > 0,
        detail: { count: injuries.length, withId: injuries.filter((i) => i.espnId).length, sample: injuries.slice(0, 3) },
      };
    }),
  );

  checks.push(
    await check("llm.nextUp", async () => {
      const config = llmConfigFromEnv();
      if (!config) return { ok: false, skipped: true, detail: "Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to run this check." };
      const candidates = ["Naji Marshall", "Zaccharie Risacher", "Santi Aldama", "P.J. Washington"];
      const out = await chatJson<{ beneficiaries: { name: string; type: string; reason: string }[] }>(
        config,
        "You rank NBA players who gain fantasy value when a teammate is ruled out. " +
          "Only choose from the candidate list. Reply with JSON: " +
          '{"beneficiaries":[{"name":string,"type":"starter_replacement"|"bench_minutes"|"starter_usage","reason":string}]} ' +
          "with 1 to 3 entries and a one-sentence reason each.",
        `Dallas Mavericks. Ruled out: Cooper Flagg (F, starter). Candidates: ${candidates.join(", ")}.`,
      );
      const names = out.beneficiaries?.map((b) => b.name) ?? [];
      const invented = names.filter((n) => !candidates.includes(n));
      return {
        ok: names.length >= 1 && names.length <= 3 && invented.length === 0,
        detail: { model: config.model, beneficiaries: out.beneficiaries, invented },
      };
    }),
  );

  return {
    ranAt: now.toISOString(),
    runtime: process.env.VERCEL ? `vercel (${process.env.VERCEL_REGION ?? "unknown region"})` : "local",
    ok: checks.every((c) => c.ok || c.skipped),
    checks,
  };
}
