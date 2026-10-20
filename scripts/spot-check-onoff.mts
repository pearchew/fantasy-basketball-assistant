// On/off check: `npm run spot-check-onoff -- [player name ...]`.
// Recomputes the with/without splits straight from the stored box scores, in plain code, and
// compares them with what the database function (on_off_splits) returns. Default players are
// starters who missed games in 2025-26.
import { createClient } from "@supabase/supabase-js";
import { toOnOff, type Side, type SplitRow } from "../src/lib/onOff";
import { currentSeason } from "../src/lib/stats";
import { easternDate } from "../src/lib/time";

const NAMES = process.argv.slice(2).length ? process.argv.slice(2) : ["Kyrie Irving", "Kawhi Leonard", "Jayson Tatum", "Tyrese Haliburton"];

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const season = await currentSeason(db);
if (!season) throw new Error("No regular-season games stored.");
const seasons = [season, season - 1];
const before = easternDate();

type Line = {
  event_id: string; player_id: string; game_date: string; season: number; starter: boolean; did_not_play: boolean;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; tov: number;
  fgm: number; fga: number; ftm: number; fta: number;
};

async function teamLines(team: string): Promise<Line[]> {
  const out: Line[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("game_logs")
      .select("event_id, player_id, game_date, season, starter, did_not_play, min, pts, reb, ast, stl, blk, tpm, tov, fgm, fga, ftm, fta")
      .eq("team_abbr", team)
      .in("season", seasons)
      .eq("season_type", 2)
      .eq("counts_for_stats", true)
      .lt("game_date", before)
      .order("event_id")
      .order("player_id")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Line[]));
    if (data.length < 1000) return out;
  }
}

/** The same splits, the long way round. */
function recompute(subject: string, lines: Line[], roster: Set<string>, s: number, elsewhere: boolean) {
  const mine = lines.filter((l) => l.season === s);
  // Traded in that season: from his first game here. Otherwise the whole season.
  const first = mine.filter((l) => !elsewhere || l.player_id === subject).map((l) => l.game_date).sort()[0];
  if (!first) return null;
  const games = new Map<string, boolean>(); // event -> sat
  for (const l of mine) if (l.game_date >= first) games.set(l.event_id, games.get(l.event_id) ?? true);
  for (const l of mine) if (l.player_id === subject && !l.did_not_play && l.min > 0 && games.has(l.event_id)) games.set(l.event_id, false);
  const sides = new Map<string, Line[]>();
  for (const l of mine) {
    if (l.player_id === subject || !roster.has(l.player_id) || !games.has(l.event_id)) continue;
    const k = `${l.player_id}|${games.get(l.event_id)}`;
    sides.set(k, [...(sides.get(k) ?? []), l]);
  }
  const avg = (ls: Line[], k: keyof Line) => ls.reduce((n, l) => n + (!l.did_not_play && l.min > 0 ? (l[k] as number) : 0), 0) / ls.length;
  const sat = [...games.values()].filter(Boolean).length;
  return {
    sat,
    played: games.size - sat,
    sides: new Map([...sides].map(([k, ls]) => [k, { games: ls.length, min: avg(ls, "min"), pts: avg(ls, "pts"), reb: avg(ls, "reb"), tov: avg(ls, "tov"), fga: avg(ls, "fga") }])),
  };
}

let failures = 0;
for (const name of NAMES) {
  const { data: p } = await db.from("players").select("espn_id, team_abbr").eq("name", name).maybeSingle();
  if (!p?.team_abbr) {
    console.log(`SKIP ${name}: not on an NBA roster`);
    continue;
  }
  const [{ data, error }, lines, { data: rosterRows }, { data: away }] = await Promise.all([
    db.rpc("on_off_splits", { p_players: [p.espn_id], p_teams: [p.team_abbr], p_seasons: seasons, p_before: before }),
    teamLines(p.team_abbr),
    db.from("players").select("espn_id").eq("team_abbr", p.team_abbr).eq("active", true),
    db.from("game_logs").select("season").eq("player_id", p.espn_id).neq("team_abbr", p.team_abbr).eq("season_type", 2).in("season", seasons),
  ]);
  if (error) throw error;
  const roster = new Set((rosterRows ?? []).map((r) => r.espn_id));
  const onOff = toOnOff(data as SplitRow[], seasons)[`${p.espn_id}|${p.team_abbr}`];

  for (const s of seasons) {
    // Seasons without a game for the team are hidden from the toggle.
    const ours = onOff?.seasons.find((x) => x.season === s) ?? { label: String(s), sat: 0, played: 0, rows: [] };
    const ref = recompute(p.espn_id, lines, roster, s, (away ?? []).some((r) => r.season === s));
    const problems: string[] = [];
    if ((ours?.sat ?? 0) !== (ref?.sat ?? 0) || (ours?.played ?? 0) !== (ref?.played ?? 0)) {
      problems.push(`games: function ${ours?.sat}/${ours?.played} vs ${ref?.sat}/${ref?.played}`);
    }
    for (const r of ours?.rows ?? []) {
      for (const [side, v] of [["true", r.without], ["false", r.with]] as [string, Side | null][]) {
        const want = ref?.sides.get(`${r.playerId}|${side}`);
        if (!v && !want) continue;
        if (!v || !want) {
          problems.push(`${r.name} ${side === "true" ? "without" : "with"}: missing on one side`);
          continue;
        }
        for (const k of ["games", "min", "pts", "reb", "tov", "fga"] as const) {
          if (Math.abs(v[k] - want[k]) > 1e-6) problems.push(`${r.name} ${k}: ${v[k]} vs ${want[k]}`);
        }
      }
    }
    if ((ours?.rows.length ?? 0) * 2 < (ref?.sides.size ?? 0)) problems.push("teammates missing from the function's answer");
    failures += problems.length ? 1 : 0;
    const top = ours?.rows[0];
    const gain = top?.without && top.with ? ` · top: ${top.name} ${(top.without.min - top.with.min).toFixed(1)} min` : "";
    console.log(`${problems.length ? "FAIL" : "PASS"} ${name} (${p.team_abbr}) ${ours?.label}: sat ${ours?.sat}, played ${ours?.played}, ${ours?.rows.length} teammates${gain}`);
    for (const m of problems.slice(0, 5)) console.log(`       ${m}`);
  }
}
console.log(failures ? `\n${failures} check(s) differ.` : "\nThe database function matches a plain recomputation.");
process.exitCode = failures ? 1 : 0;
