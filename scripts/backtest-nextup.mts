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
    .select("event_id, player_id, player_name, team_abbr, game_date, starter, did_not_play, min")
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

let hits = 0;
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

  // Did any named player beat his own average over his previous 14 games played?
  const results = picks.map((b) => {
    const history = (byPlayer.get(b.player_id) ?? []).filter((l) => l.game_date < c.date).sort((x, y) => y.game_date.localeCompare(x.game_date)).slice(0, 14);
    const avg = history.length ? history.reduce((n, l) => n + l.min, 0) / history.length : 0;
    const tonight = logs.find((l) => l.event_id === c.eventId && l.player_id === b.player_id)?.min ?? 0;
    return { b, avg, tonight, up: tonight > avg };
  });
  const hit = results.some((r) => r.up);
  if (hit) hits++;
  console.log(`${hit ? "HIT " : "MISS"} ${c.date} ${c.team}: ${c.absent.map((a) => a.name).join(" + ")} out`);
  for (const r of results) console.log(`       ${r.up ? "↑" : " "} ${r.b.name} (${r.b.type}): ${r.tonight} min vs ${r.avg.toFixed(1)} avg`);
}
const rate = sample.length ? hits / sample.length : 0;
if (config) console.log(`\nModel failures (fell back to rules): ${modelFailures}`);
console.log(`\n${hits}/${sample.length} = ${(rate * 100).toFixed(0)}% (target 70%) → ${rate >= 0.7 ? "PASS" : "FAIL"}`);
