// Monitoring: risers and droppers from the daily form snapshot (form_flags in 0008).
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentSeason } from "./stats";

/** Thresholds the page offers, in the player's own game-to-game standard deviations. */
export const THRESHOLDS = [0.5, 1] as const;
export const DEFAULT_THRESHOLD = 1;

/** How a game is valued: all 9 categories, or the 7 counting ones (no FG% or FT%). */
export type Categories = "9cat" | "7cat";
export const CATEGORY_LABELS: Record<Categories, string> = { "9cat": "All 9 categories", "7cat": "No FG% / FT%" };

export type FormFlag = {
  playerId: string;
  name: string;
  teamAbbr: string;
  side: "riser" | "dropper";
  baseline: "season" | "last_season";
  baselineRank: number;
  zPrev10: number;
  zBaseline: number;
  valueLast3: number;
  valuePrev10: number;
  valueBaseline: number;
  minLast3: number;
  minBaseline: number;
  /** Category -> change in its z-score per game, last 3 minus the window. + is better (turnovers reversed). */
  driversPrev10: Drivers;
  driversBaseline: Drivers;
};

export type Drivers = Record<string, number>;

export type FormRow = {
  player_id: string;
  player_name: string;
  team_abbr: string;
  side: "riser" | "dropper";
  baseline: "season" | "last_season";
  baseline_rank: number;
  z_prev10: number | string;
  z_baseline: number | string;
  value_last3: number | string;
  value_prev10: number | string;
  value_baseline: number | string;
  min_last3: number | string;
  min_baseline: number | string;
  drivers_prev10: Drivers;
  drivers_baseline: Drivers;
};

export function toFormFlag(r: FormRow): FormFlag {
  return {
    playerId: r.player_id,
    name: r.player_name,
    teamAbbr: r.team_abbr,
    side: r.side,
    baseline: r.baseline,
    baselineRank: r.baseline_rank,
    zPrev10: Number(r.z_prev10),
    zBaseline: Number(r.z_baseline),
    valueLast3: Number(r.value_last3),
    valuePrev10: Number(r.value_prev10),
    valueBaseline: Number(r.value_baseline),
    minLast3: Number(r.min_last3),
    minBaseline: Number(r.min_baseline),
    driversPrev10: r.drivers_prev10,
    driversBaseline: r.drivers_baseline,
  };
}

/** The categories that moved most in the flag's direction, biggest first. */
export function leaders(drivers: Drivers, side: FormFlag["side"], count = 2): { cat: string; delta: number }[] {
  const sign = side === "riser" ? 1 : -1;
  return Object.entries(drivers)
    .map(([cat, delta]) => ({ cat, delta: Number(delta) }))
    .filter((d) => d.delta * sign > 0)
    .sort((a, b) => (b.delta - a.delta) * sign)
    .slice(0, count);
}

/** The smaller of the two gaps: how strongly a player clears the threshold. */
export const strength = (f: FormFlag) => Math.min(Math.abs(f.zPrev10), Math.abs(f.zBaseline));

/**
 * A value of 0 is an average rotation player. Risers count when their last 3 games got there;
 * droppers when they were there before the slump. Filters out deep-bench noise either way.
 */
export const rosterable = (f: FormFlag) => (f.side === "riser" ? f.valueLast3 : f.valueBaseline) >= 0;

/** Risers and droppers clearing `threshold`, strongest first. */
export function pickFlags(flags: FormFlag[], threshold: number, everyone: boolean) {
  const shown = flags
    .filter((f) => strength(f) >= threshold && (everyone || rosterable(f)))
    .sort((a, b) => strength(b) - strength(a) || a.name.localeCompare(b.name));
  return { risers: shown.filter((f) => f.side === "riser"), droppers: shown.filter((f) => f.side === "dropper") };
}

export type MonitoringLookup = { ok: true; date: string | null; flags: FormFlag[] } | { ok: false; error: string };

/** The latest snapshot's flags under one valuation. Never throws. */
export async function loadMonitoring(supabase: SupabaseClient, categories: Categories): Promise<MonitoringLookup> {
  try {
    const latest = await supabase.from("form_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1);
    if (latest.error) throw latest.error;
    const date: string | undefined = latest.data[0]?.snapshot_date;
    if (!date) return { ok: true, date: null, flags: [] };
    const { data, error } = await supabase.from("form_snapshots").select("*").eq("snapshot_date", date).eq("categories", categories);
    if (error) throw error;
    return { ok: true, date, flags: (data as FormRow[]).map(toFormFlag) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stores the snapshot, both valuations, for games before `isoDate` (US Eastern). Run after the day's box scores load. */
export async function snapshotForm(admin: SupabaseClient, isoDate: string) {
  const season = await currentSeason(admin);
  if (season === null) return { date: isoDate, flagged: 0 };
  const { data, error } = await admin.rpc("refresh_form_snapshot", { p_date: isoDate, p_season: season });
  if (error) throw error;
  return { date: isoDate, season, flagged: data as number };
}
