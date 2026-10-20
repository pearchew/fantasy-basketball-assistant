// On/off splits: how an injured player's teammates did in the games he sat versus the games he played.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isGLeague, type FeedUpdate } from "./feed";
import type { InjuryStatus } from "./sources/nbaInjuryReport";
import { seasonLabel } from "./stats";

/** Per-game averages on one side of the split. */
export type Side = {
  games: number;
  starts: number;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; tov: number;
  fga: number; fta: number;
  /** Total makes / total attempts; null with no attempts. */
  fgPct: number | null;
  ftPct: number | null;
};

export type OnOffRow = {
  playerId: string;
  name: string;
  /** Null when he wasn't on the box score for any game on that side. */
  without: Side | null;
  with: Side | null;
};

export type SeasonSplit = { season: number; label: string; sat: number; played: number; rows: OnOffRow[] };

/** One injured player's splits, newest season first. */
export type OnOff = { seasons: SeasonSplit[]; defaultSeason: number };

export type OnOffLookup = { ok: true; bySubject: Record<string, OnOff> } | { ok: false; error: string };

export type SplitRow = {
  subject_id: string;
  team_abbr: string;
  season: number;
  teammate_id: string | null;
  teammate_name: string | null;
  sat: boolean;
  games: number;
  starts: number | null;
  min: number | string | null; pts: number | string | null; reb: number | string | null; ast: number | string | null;
  stl: number | string | null; blk: number | string | null; tpm: number | string | null; tov: number | string | null;
  fgm: number | null; fga: number | null; ftm: number | null; fta: number | null;
};

/** Enough games on a side to read anything into it. */
export const MIN_GAMES = 3;

export const subjectKey = (playerId: string, team: string) => `${playerId}|${team}`;

/** Updates that get a table: out, doubtful, questionable (if he sits) or returning, on an NBA roster. */
export function hasOnOff(u: FeedUpdate): u is FeedUpdate & { playerId: string; teamAbbr: string } {
  return !!u.playerId && !!u.teamAbbr && !isGLeague(u) && (u.returning || ["out", "doubtful", "questionable"].includes(u.status));
}

function side(r: SplitRow): Side {
  const n = (v: number | string | null) => Number(v) || 0;
  const fga = r.fga ?? 0;
  const fta = r.fta ?? 0;
  return {
    games: r.games,
    starts: r.starts ?? 0,
    min: n(r.min), pts: n(r.pts), reb: n(r.reb), ast: n(r.ast), stl: n(r.stl), blk: n(r.blk), tpm: n(r.tpm), tov: n(r.tov),
    fga: r.games ? fga / r.games : 0,
    fta: r.games ? fta / r.games : 0,
    fgPct: fga ? (r.fgm ?? 0) / fga : null,
    ftPct: fta ? (r.ftm ?? 0) / fta : null,
  };
}

/** Minutes gained when he sat; null without games on both sides. */
export const minutesGain = (r: OnOffRow) => (r.without && r.with ? r.without.min - r.with.min : null);

const solid = (r: OnOffRow) => (r.without?.games ?? 0) >= MIN_GAMES && (r.with?.games ?? 0) >= MIN_GAMES;

/** Biggest minutes gain first; rows with enough games on both sides ahead of thin ones. */
function byGain(a: OnOffRow, b: OnOffRow) {
  return Number(solid(b)) - Number(solid(a)) || (minutesGain(b) ?? -Infinity) - (minutesGain(a) ?? -Infinity) || (b.with?.min ?? 0) - (a.with?.min ?? 0);
}

/**
 * This season once he has sat 3+ games in it; otherwise the latest earlier season he sat
 * any; otherwise this season (the table then shows what little there is, or says he hasn't missed a game).
 */
export function pickSeason(seasons: SeasonSplit[]): number {
  const [latest, ...earlier] = seasons;
  if (latest.sat >= MIN_GAMES) return latest.season;
  return (earlier.find((s) => s.sat > 0) ?? latest).season;
}

/** Database rows -> one OnOff per subject key, for these seasons (newest first). */
export function toOnOff(rows: SplitRow[], seasons: number[]): Record<string, OnOff> {
  const subjects = new Map<string, Map<number, SeasonSplit & { byId: Map<string, OnOffRow> }>>();
  for (const r of rows) {
    const key = subjectKey(r.subject_id, r.team_abbr);
    let bySeason = subjects.get(key);
    if (!bySeason) {
      bySeason = new Map(seasons.map((s) => [s, { season: s, label: seasonLabel(s), sat: 0, played: 0, rows: [], byId: new Map() }]));
      subjects.set(key, bySeason);
    }
    const split = bySeason.get(r.season);
    if (!split) continue;
    if (r.teammate_id === null) {
      if (r.sat) split.sat = r.games;
      else split.played = r.games;
      continue;
    }
    let row = split.byId.get(r.teammate_id);
    if (!row) {
      row = { playerId: r.teammate_id, name: r.teammate_name ?? "", without: null, with: null };
      split.byId.set(r.teammate_id, row);
    }
    row[r.sat ? "without" : "with"] = side(r);
  }
  const out: Record<string, OnOff> = {};
  for (const [key, bySeason] of subjects) {
    const list = seasons.map((s) => {
      const { byId, ...split } = bySeason.get(s)!;
      return { ...split, rows: [...byId.values()].sort(byGain) };
    });
    // Only seasons he spent with the team; at least one, so the table can say there's nothing.
    const shown = list.filter((s) => s.sat + s.played > 0);
    out[key] = { seasons: shown.length ? shown : list.slice(0, 1), defaultSeason: pickSeason(shown.length ? shown : list) };
  }
  return out;
}

/** Splits for these updates' players over this season and last, from games before `before`. Never throws. */
export async function loadOnOff(supabase: SupabaseClient, updates: FeedUpdate[], season: number | null, before: string): Promise<OnOffLookup> {
  if (season === null) return { ok: false, error: "No box scores stored yet." };
  try {
    const subjects = new Map<string, { id: string; team: string }>();
    for (const u of updates) if (hasOnOff(u)) subjects.set(subjectKey(u.playerId, u.teamAbbr), { id: u.playerId, team: u.teamAbbr });
    const list = [...subjects.values()];
    const seasons = [season, season - 1];
    const bySubject: Record<string, OnOff> = {};
    for (let i = 0; i < list.length; i += 60) {
      const chunk = list.slice(i, i + 60);
      const { data, error } = await supabase.rpc("on_off_splits", {
        p_players: chunk.map((s) => s.id),
        p_teams: chunk.map((s) => s.team),
        p_seasons: seasons,
        p_before: before,
      });
      if (error) throw error;
      Object.assign(bySubject, toOnOff(data as SplitRow[], seasons));
    }
    // Players with no games for the team in either season still get an (empty) entry.
    for (const key of subjects.keys()) bySubject[key] ??= emptyOnOff(seasons);
    return { ok: true, bySubject };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function emptyOnOff(seasons: number[]): OnOff {
  return { seasons: [{ season: seasons[0], label: seasonLabel(seasons[0]), sat: 0, played: 0, rows: [] }], defaultSeason: seasons[0] };
}

/** A teammate row as shown under one update: owner tags and his status for that game. */
export type TableRow = OnOffRow & { heldOn: string[]; status: InjuryStatus | null };
export type TableSeason = Omit<SeasonSplit, "rows"> & { rows: TableRow[] };
export type OnOffTableData = { seasons: TableSeason[]; defaultSeason: number };

/**
 * What one update's table shows: teammates who are out or doubtful for the same game are
 * left out (they can't gain), and the rest carry owner tags and any questionable status.
 */
export function tableFor(
  onOff: OnOff,
  statuses: Record<string, InjuryStatus>,
  heldOn: Record<string, string[]>,
): OnOffTableData {
  return {
    defaultSeason: onOff.defaultSeason,
    seasons: onOff.seasons.map((s) => ({
      ...s,
      rows: s.rows
        .filter((r) => statuses[r.playerId] !== "out" && statuses[r.playerId] !== "doubtful")
        .map((r) => ({ ...r, heldOn: heldOn[r.playerId] ?? [], status: statuses[r.playerId] ?? null })),
    })),
  };
}

/** A player I hold who did clearly better when an injured teammate sat. */
export type Gain = { row: TableRow; season: TableSeason; because: FeedUpdate };

/** Clear gain: 3+ games on each side and +3 minutes or +3 points a game. */
export const GAIN_MIN = 3;
export const GAIN_PTS = 3;

export function isClearGain(r: OnOffRow): boolean {
  if (!r.without || !r.with || !solid(r)) return false;
  return r.without.min - r.with.min >= GAIN_MIN || r.without.pts - r.with.pts >= GAIN_PTS;
}

/** My players who gain from an out or doubtful teammate, in the season each table opens on. */
export function myGains(update: FeedUpdate, table: OnOffTableData): Gain[] {
  if (update.returning || (update.status !== "out" && update.status !== "doubtful")) return [];
  const season = table.seasons.find((s) => s.season === table.defaultSeason)!;
  return season.rows.filter((r) => r.heldOn.length && isClearGain(r)).map((row) => ({ row, season, because: update }));
}

export type StatKey = "min" | "pts" | "reb" | "ast" | "stl" | "blk" | "tpm" | "tov" | "fgPct" | "ftPct";

/**
 * "up" / "down" when the side without him is clearly better / worse: the same bar as the
 * recent-form table (10% and 0.3 for counting stats, turnovers inverted; 3 points for percentages).
 */
export function change(key: StatKey, without: Side, withHim: Side): "up" | "down" | null {
  const a = without[key];
  const b = withHim[key];
  if (a === null || b === null) return null;
  let diff: number;
  if (key === "fgPct" || key === "ftPct") diff = Math.abs(a - b) >= 0.03 ? a - b : 0;
  else diff = Math.abs(a - b) >= 0.3 && (b === 0 || Math.abs(a - b) / b >= 0.1) ? a - b : 0;
  if (diff === 0) return null;
  return (key === "tov" ? diff < 0 : diff > 0) ? "up" : "down";
}
