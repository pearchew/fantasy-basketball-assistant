// Recent form: averages over the last 7, 14 and 30 games played and the whole season.
import type { SupabaseClient } from "@supabase/supabase-js";

export const WINDOWS = [
  { size: 7, label: "Last 7" },
  { size: 14, label: "Last 14" },
  { size: 30, label: "Last 30" },
  { size: 0, label: "Season" },
] as const;

export type StatWindow = {
  size: number; // 0 = season
  label: string;
  games: number;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; tov: number;
  fga: number; fta: number;
  /** Total makes / total attempts across the window; null with no attempts. */
  fgPct: number | null;
  ftPct: number | null;
};

export type PlayerStats = { windows: StatWindow[]; lastGame: string };

export type StatsLookup =
  | { ok: true; season: number; seasonLabel: string; byPlayer: Record<string, PlayerStats> }
  | { ok: false; error: string };

/** ESPN season year 2027 -> "2026-27". */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season % 100).padStart(2, "0")}`;
}

export type WindowRow = {
  player_id: string;
  window_size: number;
  games: number;
  last_game: string;
  min: number | string; pts: number | string; reb: number | string; ast: number | string; stl: number | string;
  blk: number | string; tpm: number | string; tov: number | string; fga: number | string; fta: number | string;
  fgm_total: number; fga_total: number; ftm_total: number; fta_total: number;
};

/** Database rows -> per-player windows in display order (Postgres numerics arrive as strings). */
export function toPlayerStats(rows: WindowRow[]): Record<string, PlayerStats> {
  const out: Record<string, PlayerStats> = {};
  for (const r of rows) {
    const p = (out[r.player_id] ??= { windows: [], lastGame: r.last_game });
    if (r.last_game > p.lastGame) p.lastGame = r.last_game;
    const meta = WINDOWS.find((w) => w.size === r.window_size);
    if (!meta) continue;
    const n = (v: number | string) => Number(v) || 0;
    p.windows.push({
      size: meta.size,
      label: meta.label,
      games: r.games,
      min: n(r.min), pts: n(r.pts), reb: n(r.reb), ast: n(r.ast), stl: n(r.stl), blk: n(r.blk), tpm: n(r.tpm), tov: n(r.tov),
      fga: n(r.fga), fta: n(r.fta),
      fgPct: r.fga_total ? r.fgm_total / r.fga_total : null,
      ftPct: r.fta_total ? r.ftm_total / r.fta_total : null,
    });
  }
  const order = (w: StatWindow) => WINDOWS.findIndex((x) => x.size === w.size);
  for (const p of Object.values(out)) p.windows.sort((a, b) => order(a) - order(b));
  return out;
}

export type StatKey = "min" | "pts" | "reb" | "ast" | "stl" | "blk" | "tpm" | "tov" | "fgPct" | "ftPct";

/**
 * "up" / "down" when a window is clearly better / worse than the season:
 * 10% for counting stats (turnovers inverted), 3 points for percentages.
 * Needs at least 3 games in the window and 5 in the season.
 */
export function trend(w: StatWindow, season: StatWindow, key: StatKey): "up" | "down" | null {
  if (w.size === 0 || w.games < 3 || season.games < 5) return null;
  const a = w[key];
  const b = season[key];
  if (a === null || b === null) return null;
  let diff: number;
  if (key === "fgPct" || key === "ftPct") diff = Math.abs(a - b) >= 0.03 ? a - b : 0;
  else diff = b > 0 && Math.abs(a - b) / b >= 0.1 && Math.abs(a - b) >= 0.3 ? a - b : 0;
  if (diff === 0) return null;
  const better = key === "tov" ? diff < 0 : diff > 0;
  return better ? "up" : "down";
}

/** The latest regular season with any games stored. */
export async function currentSeason(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("games")
    .select("season")
    .eq("season_type", 2)
    .order("season", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0]?.season ?? null;
}

/** Stats for these players, or an error to show in place of the panel. Never throws. */
export async function loadStats(supabase: SupabaseClient, playerIds: string[]): Promise<StatsLookup> {
  try {
    const season = await currentSeason(supabase);
    if (season === null) return { ok: false, error: "No box scores stored yet." };
    const ids = [...new Set(playerIds)];
    const byPlayer: Record<string, PlayerStats> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.rpc("player_stat_windows", { p_ids: ids.slice(i, i + 200), p_season: season });
      if (error) throw error;
      Object.assign(byPlayer, toPlayerStats(data as WindowRow[]));
    }
    return { ok: true, season, seasonLabel: seasonLabel(season), byPlayer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
