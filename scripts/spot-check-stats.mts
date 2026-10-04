// Phase 4 acceptance check: `npm run spot-check-stats -- [season]` (default: latest stored).
// Compares our season averages, computed from stored box scores, with ESPN's
// official season averages for five players. Agreement within rounding passes.
import { createClient } from "@supabase/supabase-js";
import { currentSeason, toPlayerStats, type WindowRow } from "../src/lib/stats";

const PLAYERS = ["Cooper Flagg", "Shai Gilgeous-Alexander", "Nikola Jokic", "Jalen Brunson", "Naji Marshall"];

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const season = Number(process.argv[2]) || (await currentSeason(db));
if (!season) throw new Error("No regular-season games stored.");

const { data: found } = await db.from("game_logs").select("player_id, player_name").in("player_name", PLAYERS).eq("season", season).limit(1000);
const ids = new Map((found ?? []).map((r) => [r.player_name, r.player_id]));

const { data, error } = await db.rpc("player_stat_windows", { p_ids: [...ids.values()], p_season: season });
if (error) throw error;
const ours = toPlayerStats(data as WindowRow[]);

type Espn = { categories: { name: string; labels: string[]; statistics: { season: { year: number }; stats: string[] }[] }[] };

let failures = 0;
for (const name of PLAYERS) {
  const id = ids.get(name);
  if (!id) {
    console.log(`SKIP ${name}: no ${season} games stored`);
    continue;
  }
  const espn = (await (await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/stats?season=${season}&seasontype=2`)).json()) as Espn;
  const avg = espn.categories.find((c) => c.name === "averages")!;
  const line = avg.statistics.find((s) => s.season.year === season)!.stats;
  const ref = (label: string) => line[avg.labels.indexOf(label)];
  const made = (label: string) => Number(ref(label).split("-")[0]);

  const s = ours[id].windows.find((w) => w.size === 0)!;
  const checks: [string, number, number, number][] = [
    // [stat, ours, ESPN, tolerance]: ESPN prints one decimal, so allow rounding.
    ["GP", s.games, Number(ref("GP")), 0],
    // Box scores give whole minutes; ESPN averages exact seconds, so minutes can drift by under 0.1.
    ["MIN", s.min, Number(ref("MIN")), 0.11],
    ["PTS", s.pts, Number(ref("PTS")), 0.051],
    ["REB", s.reb, Number(ref("REB")), 0.051],
    ["AST", s.ast, Number(ref("AST")), 0.051],
    ["STL", s.stl, Number(ref("STL")), 0.051],
    ["BLK", s.blk, Number(ref("BLK")), 0.051],
    ["TO", s.tov, Number(ref("TO")), 0.051],
    ["3PM", s.tpm, made("3PT"), 0.051],
    ["FG%", (s.fgPct ?? 0) * 100, Number(ref("FG%")), 0.051],
    ["FT%", (s.ftPct ?? 0) * 100, Number(ref("FT%")), 0.051],
  ];
  const bad = checks.filter(([, a, b, tol]) => Math.abs(a - b) > tol);
  failures += bad.length ? 1 : 0;
  console.log(`${bad.length ? "FAIL" : "PASS"} ${name}: ${checks.map(([k, a]) => `${k} ${k === "GP" ? a : a.toFixed(1)}`).join(" · ")}`);
  for (const [k, a, b] of bad) console.log(`       ${k}: ours ${a.toFixed(2)} vs ESPN ${b}`);
}
console.log(failures ? `\n${failures} player(s) differ.` : "\nAll match ESPN's official season averages.");
process.exitCode = failures ? 1 : 0;
