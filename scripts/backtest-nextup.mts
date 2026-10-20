// Phase 3 acceptance test: `npm run backtest-nextup -- [--model] [--n 20] [--season 2026]`.
// Finds past games a regular starter missed, makes the next-up call using only
// earlier box scores, and checks whether at least one named player beat his
// own 14-game minutes average that night. PRD target: at least 70%.
import { createClient } from "@supabase/supabase-js";
import { buildDepthChart, startsWithAndWithout, teamGames, type LogLine } from "../src/lib/nextUp/depth";
import { askModel, buildPrompt, validateModelCalls } from "../src/lib/nextUp/model";
import { ruleBeneficiaries, type Beneficiary, type SatStats } from "../src/lib/nextUp/rules";
import { llmConfigFromEnv } from "../src/lib/sources/llm";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const useModel = process.argv.includes("--model");
const sampleSize = Number(arg("n", "20"));
const season = Number(arg("season", "2026"));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

// All regular-season lines, paged (PostgREST returns at most 1,000 rows per request).
const logs: LogLine[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("game_logs")
    .select("event_id, player_id, player_name, team_abbr, game_date, starter, did_not_play, min, pts, fga, fta, tov")
    .eq("season", season)
    .eq("season_type", 2)
    .order("event_id")
    .order("player_id")
    .range(from, from + 999);
  if (error) throw error;
  logs.push(...(data as LogLine[]));
  if (data.length < 1000) break;
}
const { data: dir } = await db.from("players").select("espn_id, position");
const positions = new Map((dir ?? []).map((p) => [p.espn_id, p.position]));
console.log(`Loaded ${logs.length} lines.`);

const played = (l: LogLine) => !l.did_not_play && l.min > 0;
const byTeam = new Map<string, LogLine[]>();
for (const l of logs) byTeam.set(l.team_abbr, [...(byTeam.get(l.team_abbr) ?? []), l]);
const byPlayer = new Map<string, LogLine[]>();
for (const l of logs) if (played(l)) byPlayer.set(l.player_id, [...(byPlayer.get(l.player_id) ?? []), l]);

type Case = { team: string; eventId: string; date: string; absent: { id: string; name: string }[] };
const cases: Case[] = [];
for (const [team, lines] of byTeam) {
  const games = teamGames(lines).reverse(); // oldest first
  const dateOf = new Map(lines.map((l) => [l.event_id, l.game_date]));
  const linesOf = new Map<string, LogLine[]>();
  for (const l of lines) linesOf.set(l.event_id, [...(linesOf.get(l.event_id) ?? []), l]);
  for (let i = 15; i < games.length - 10; i++) {
    const prev = games.slice(i - 10, i);
    const next = new Set(games.slice(i + 1, i + 11));
    const starts = new Map<string, { n: number; name: string }>();
    for (const g of prev) for (const l of linesOf.get(g) ?? []) if (l.starter && played(l)) starts.set(l.player_id, { n: (starts.get(l.player_id)?.n ?? 0) + 1, name: l.player_name });
    const tonight = new Set((linesOf.get(games[i]) ?? []).filter(played).map((l) => l.player_id));
    // A regular starter (8+ of the last 10) who sat tonight and plays for this team again soon: a real absence, not a trade.
    const absent = [...starts]
      .filter(([id, s]) => s.n >= 8 && !tonight.has(id) && lines.some((l) => l.player_id === id && next.has(l.event_id) && played(l)))
      .map(([id, s]) => ({ id, name: s.name }));
    if (absent.length) cases.push({ team, eventId: games[i], date: dateOf.get(games[i])!, absent });
  }
}
cases.sort((a, b) => a.date.localeCompare(b.date) || a.team.localeCompare(b.team));
const step = Math.max(1, Math.floor(cases.length / sampleSize));
const sample = cases.filter((_, i) => i % step === 0).slice(0, sampleSize);
console.log(`${cases.length} starter absences found; testing ${sample.length}${useModel ? " with the model" : " with rules only"}.\n`);

const config = useModel ? llmConfigFromEnv() : null;
if (useModel && !config) throw new Error("--model needs LLM_* settings in .env.local");

// Usage proxy: shots plus trips to the line plus turnovers (the numerator of usage rate).
const usage = (l: Pick<LogLine, "fga" | "fta" | "tov">) => l.fga + 0.44 * l.fta + l.tov;

let hits = 0;
let usageHits = 0;
let named = 0;
let namedSat = 0;
let namedWithSplit = 0;
let casesWithEvidence = 0;
// Same measures, for absences with with/without history only.
const ev = { named: 0, upMin: 0, upUsage: 0, minGain: 0, usageGain: 0 };
let namedUpMin = 0;
let namedUpUsage = 0;
let minGain = 0;
let usageGain = 0;
let modelFailures = 0;
for (const c of sample) {
  const before = (byTeam.get(c.team) ?? []).filter((l) => l.game_date < c.date);
  const depth = buildDepthChart({ team: c.team, teamLogs: before, positions });
  const absent = c.absent.map((a) => ({ id: a.id, name: a.name, position: positions.get(a.id) ?? "" }));
  const sat = new Map<string, SatStats>(absent.map((a) => [a.id, startsWithAndWithout(a.id, before)]));
  const rules = ruleBeneficiaries({ absent, returning: [], depth, sat, unavailable: new Set(absent.map((a) => a.id)), questionable: new Set() });
  let picks: Beneficiary[] = rules.beneficiaries;
  if (config) {
    // Stay under the free tier's per-minute limit.
    await new Promise((r) => setTimeout(r, 7000));
    try {
      const calls = await askModel(config, buildPrompt({ depth, gameLabel: c.date, absent: absent.map((a) => ({ ...a, status: "out" })), returning: [], candidates: rules.candidates, questionable: new Set() }));
      picks = validateModelCalls({ calls, absent, returning: [], candidates: rules.candidates, rulePicks: rules.beneficiaries, questionable: new Set() }).beneficiaries;
    } catch (e) {
      modelFailures++;
      console.log(`       (model failed, using rules: ${e instanceof Error ? e.message : e})`);
    }
  }

  // Did named players beat their own averages over their previous 14 games played?
  const results = picks.map((b) => {
    const history = (byPlayer.get(b.player_id) ?? []).filter((l) => l.game_date < c.date).sort((x, y) => y.game_date.localeCompare(x.game_date)).slice(0, 14);
    const avg = history.length ? history.reduce((n, l) => n + l.min, 0) / history.length : 0;
    const avgUsage = history.length ? history.reduce((n, l) => n + usage(l), 0) / history.length : 0;
    const line = logs.find((l) => l.event_id === c.eventId && l.player_id === b.player_id);
    const tonight = line?.min ?? 0;
    const tonightUsage = line ? usage(line) : 0;
    // Didn't play: most likely out himself, which the live app would know from the report.
    const sat = !line || line.did_not_play || line.min === 0;
    return { b, avg, tonight, up: tonight > avg, avgUsage, tonightUsage, upUsage: tonightUsage > avgUsage, sat };
  });
  const hit = results.some((r) => r.up);
  // Enough history to compare with and without: the absent player missed 3+ of the team's last 20.
  const hasEvidence = [...sat.values()].some((s) => s.missed >= 3);
  if (hasEvidence) {
    casesWithEvidence++;
    for (const r of results) {
      if (r.sat) continue;
      ev.named++;
      if (r.up) ev.upMin++;
      if (r.upUsage) ev.upUsage++;
      ev.minGain += r.tonight - r.avg;
      ev.usageGain += r.tonightUsage - r.avgUsage;
    }
  }
  if (hit) hits++;
  if (results.some((r) => r.upUsage)) usageHits++;
  for (const r of results) {
    if (r.sat) {
      namedSat++;
      continue;
    }
    named++;
    if (r.b.split) namedWithSplit++;
    if (r.up) namedUpMin++;
    if (r.upUsage) namedUpUsage++;
    minGain += r.tonight - r.avg;
    usageGain += r.tonightUsage - r.avgUsage;
  }
  console.log(`${hit ? "HIT " : "MISS"} ${c.date} ${c.team}: ${c.absent.map((a) => a.name).join(" + ")} out`);
  for (const r of results) {
    console.log(`       ${r.up ? "↑" : " "}${r.upUsage ? "↑" : " "} ${r.b.name} (${r.b.type}): ${r.tonight} min vs ${r.avg.toFixed(1)} avg · usage ${r.tonightUsage.toFixed(1)} vs ${r.avgUsage.toFixed(1)}`);
  }
}
const rate = sample.length ? hits / sample.length : 0;
if (config) console.log(`\nModel failures (fell back to rules): ${modelFailures}`);
const pct = (n: number, d: number) => `${d ? ((n / d) * 100).toFixed(0) : 0}%`;
console.log(`\nNamed players who played: ${named} (${namedSat} more sat out that night, left out) · beat minutes avg ${pct(namedUpMin, named)} · beat usage avg ${pct(namedUpUsage, named)} · mean gain ${(minGain / Math.max(named, 1)).toFixed(1)} min, ${(usageGain / Math.max(named, 1)).toFixed(1)} usage`);
console.log(`Named players backed by a with/without split: ${namedWithSplit}/${named} · absences with 3+ earlier missed games: ${casesWithEvidence}/${sample.length}`);
console.log(`  …in those ${casesWithEvidence} absences: ${ev.named} named · beat minutes avg ${pct(ev.upMin, ev.named)} · beat usage avg ${pct(ev.upUsage, ev.named)} · mean gain ${(ev.minGain / Math.max(ev.named, 1)).toFixed(1)} min, ${(ev.usageGain / Math.max(ev.named, 1)).toFixed(1)} usage`);
console.log(`Absences with a named player above his usage avg: ${usageHits}/${sample.length} = ${pct(usageHits, sample.length)}`);
console.log(`\n${hits}/${sample.length} = ${(rate * 100).toFixed(0)}% (target 70%) → ${rate >= 0.7 ? "PASS" : "FAIL"}`);
