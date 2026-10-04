// Official injury report -> public.injury_updates, one row per (player, game).
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameKey } from "./names";
import { fetchTeams } from "./sources/espn";
import { findLatestReport, parseInjuryReport, type InjuryEntry, type InjuryStatus } from "./sources/nbaInjuryReport";
import { addDays, parseReportTime } from "./time";

/** At most one fetch of the report per window, however often the app is opened. */
export const REFRESH_WINDOW_MS = 10 * 60_000;
/** A refresh I ask for by hand may run sooner, but not more than once a minute. */
export const MANUAL_REFRESH_WINDOW_MS = 60_000;

export type DirectoryEntry = { espn_id: string; name_key: string; team_abbr: string | null };

export type HistoryItem = { status: InjuryStatus; reason: string; report_time: string };

export type UpdateRow = {
  update_key: string;
  game_date: string;
  game_time: string;
  matchup: string;
  team_name: string;
  team_abbr: string | null;
  player_id: string | null;
  player_name: string;
  status: InjuryStatus;
  reason: string;
  raw_text: string;
  report_time: string;
  first_seen_at: string;
  changed_at: string;
  ongoing: boolean;
  /** Moved from out/doubtful to probable/available, within this game's reports or since his previous game. */
  is_returning: boolean;
  history: HistoryItem[];
};

export type ExistingUpdate = Pick<
  UpdateRow,
  "update_key" | "status" | "reason" | "report_time" | "first_seen_at" | "changed_at" | "history" | "ongoing" | "is_returning"
>;

const ABSENT: InjuryStatus[] = ["out", "doubtful"];
const PLAYING: InjuryStatus[] = ["probable", "available"];

/** A player's update for an earlier game, used to spot ongoing absences. */
export type PriorUpdate = { player_id: string; game_date: string; status: InjuryStatus; reason: string };

/**
 * Report name -> ESPN id. Prefers a directory player with the same name on the
 * same team; falls back to a unique name league-wide (covers a trade the
 * directory hasn't caught up with). Ambiguous or unknown names stay unmatched.
 */
export function matchPlayer(playerName: string, teamAbbr: string | null, directory: Map<string, DirectoryEntry[]>): string | null {
  const candidates = directory.get(nameKey(playerName)) ?? [];
  const sameTeam = candidates.filter((c) => c.team_abbr === teamAbbr);
  if (sameTeam.length === 1) return sameTeam[0].espn_id;
  if (candidates.length === 1) return candidates[0].espn_id;
  return null;
}

export function indexDirectory(rows: DirectoryEntry[]): Map<string, DirectoryEntry[]> {
  const index = new Map<string, DirectoryEntry[]>();
  for (const r of rows) {
    const list = index.get(r.name_key) ?? [];
    list.push(r);
    index.set(r.name_key, list);
  }
  return index;
}

export function updateKey(gameDate: string, team: string, playerId: string | null, playerName: string): string {
  return `${gameDate}|${team}|${playerId ?? `unmatched:${nameKey(playerName)}`}`;
}

/**
 * Merges one report into the stored updates. New (player, game) pairs are
 * inserted; a changed status or reason appends to history. A report older than
 * what is stored for a row never overwrites it.
 */
export function planInjuryUpserts(input: {
  entries: InjuryEntry[];
  reportTime: Date;
  teamAbbrByName: Map<string, string>;
  directory: Map<string, DirectoryEntry[]>;
  existing: Map<string, ExistingUpdate>;
  prior: PriorUpdate[];
}): { rows: UpdateRow[]; changed: number; unmatched: string[] } {
  const reportTime = input.reportTime.toISOString();
  const rows: UpdateRow[] = [];
  const unmatched: string[] = [];
  let changed = 0;

  // Latest known update per player, advanced as this report's games are processed in date order.
  const lastByPlayer = new Map<string, PriorUpdate>();
  for (const p of [...input.prior].sort((a, b) => a.game_date.localeCompare(b.game_date))) lastByPlayer.set(p.player_id, p);

  const entries = [...input.entries].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  for (const e of entries) {
    const teamAbbr = input.teamAbbrByName.get(e.team) ?? null;
    const playerId = matchPlayer(e.playerName, teamAbbr, input.directory);
    if (!playerId) unmatched.push(`${e.playerName} (${e.team})`);

    const key = updateKey(e.gameDate, teamAbbr ?? e.team, playerId, e.playerName);
    const prev = input.existing.get(key);
    // Timestamps come back from Postgres as "+00:00", not "Z": compare as dates.
    if (prev && new Date(prev.report_time) > input.reportTime) continue;

    const before = playerId ? lastByPlayer.get(playerId) : undefined;
    const earlier = before && before.game_date < e.gameDate ? before : undefined;
    const ongoing = !!earlier && earlier.status === e.status && earlier.reason === e.reason;
    const isChange = !prev || prev.status !== e.status || prev.reason !== e.reason;
    if (isChange) changed++;
    const history = isChange
      ? [...(prev?.history ?? []), { status: e.status, reason: e.reason, report_time: reportTime }]
      : prev!.history;
    const returning =
      PLAYING.includes(e.status) &&
      (history.some((h) => ABSENT.includes(h.status)) || (!!earlier && ABSENT.includes(earlier.status)));

    rows.push({
      update_key: key,
      game_date: e.gameDate,
      game_time: e.gameTime,
      matchup: e.matchup,
      team_name: e.team,
      team_abbr: teamAbbr,
      player_id: playerId,
      player_name: e.playerName,
      status: e.status,
      reason: e.reason,
      raw_text: e.rawText,
      report_time: reportTime,
      first_seen_at: prev?.first_seen_at ?? reportTime,
      changed_at: isChange ? reportTime : prev!.changed_at,
      ongoing: prev && !isChange ? prev.ongoing : ongoing,
      is_returning: prev && !isChange ? prev.is_returning : returning,
      history,
    });
    if (playerId) lastByPlayer.set(playerId, { player_id: playerId, game_date: e.gameDate, status: e.status, reason: e.reason });
  }
  return { rows, changed, unmatched };
}

export type IngestResult =
  | { status: "skipped"; reason: string }
  | { status: "no-report" | "unchanged"; url?: string }
  | { status: "ingested"; url: string; reportTime: string; entries: number; changed: number; unmatched: string[]; warnings: string[] };

/** Claims the refresh window atomically; false if another refresh ran within it. */
async function claimWindow(admin: SupabaseClient, now: Date, windowMs: number): Promise<boolean> {
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const { data, error } = await admin
    .from("ingest_state")
    .update({ last_attempt_at: now.toISOString() })
    .eq("job", "injury_report")
    .lt("last_attempt_at", cutoff)
    .select("job");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function ingestLatestReport(
  admin: SupabaseClient,
  { now = new Date(), force = false, manual = false }: { now?: Date; force?: boolean; manual?: boolean } = {},
): Promise<IngestResult> {
  const windowMs = manual ? MANUAL_REFRESH_WINDOW_MS : REFRESH_WINDOW_MS;
  if (force) {
    await admin.from("ingest_state").update({ last_attempt_at: now.toISOString() }).eq("job", "injury_report");
  } else if (!(await claimWindow(admin, now, windowMs))) {
    return { status: "skipped", reason: manual ? "refreshed less than a minute ago" : "refreshed within the last 10 minutes" };
  }

  try {
    const result = await ingest(admin, now);
    await admin
      .from("ingest_state")
      .update({ last_success_at: now.toISOString(), last_error: null })
      .eq("job", "injury_report");
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("ingest_state").update({ last_error: message }).eq("job", "injury_report");
    throw e;
  }
}

async function ingest(admin: SupabaseClient, now: Date): Promise<IngestResult> {
  const latest = await findLatestReport(now);
  if (!latest) return { status: "no-report" };

  const { data: state } = await admin.from("ingest_state").select("last_report_url").eq("job", "injury_report").single();
  if (state?.last_report_url === latest.url) return { status: "unchanged", url: latest.url };

  const report = await parseInjuryReport(latest.bytes);
  const reportTime = (report.reportTime && parseReportTime(report.reportTime)) || now;
  const dates = [...new Set(report.entries.map((e) => e.gameDate))].sort();

  const [teams, players, existing] = await Promise.all([
    fetchTeams(),
    admin.from("players").select("espn_id, name_key, team_abbr").eq("active", true),
    dates.length
      ? admin
          .from("injury_updates")
          .select("update_key, status, reason, report_time, first_seen_at, changed_at, history, ongoing, is_returning")
          .in("game_date", dates)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (players.error) throw players.error;
  if (existing.error) throw existing.error;

  const directory = indexDirectory(players.data as DirectoryEntry[]);
  const teamAbbrByName = new Map(teams.map((t) => [t.name, t.abbr]));

  // Earlier games for players in this report, to mark repeat absences as ongoing.
  const matchedIds = [
    ...new Set(
      report.entries
        .map((e) => matchPlayer(e.playerName, teamAbbrByName.get(e.team) ?? null, directory))
        .filter((id): id is string => !!id),
    ),
  ];
  let prior: PriorUpdate[] = [];
  if (matchedIds.length) {
    const r = await admin
      .from("injury_updates")
      .select("player_id, game_date, status, reason")
      .in("player_id", matchedIds)
      .gte("game_date", addDays(dates[0], -7))
      .lt("game_date", dates[0]);
    if (r.error) throw r.error;
    prior = r.data as PriorUpdate[];
  }

  const plan = planInjuryUpserts({
    entries: report.entries,
    reportTime,
    teamAbbrByName,
    directory,
    existing: new Map((existing.data as ExistingUpdate[]).map((r) => [r.update_key, r])),
    prior,
  });

  if (plan.rows.length) {
    const { error } = await admin.from("injury_updates").upsert(plan.rows, { onConflict: "update_key" });
    if (error) throw error;
  }
  await admin
    .from("ingest_state")
    .update({ last_report_url: latest.url, last_report_time: reportTime.toISOString() })
    .eq("job", "injury_report");

  return {
    status: "ingested",
    url: latest.url,
    reportTime: reportTime.toISOString(),
    entries: report.entries.length,
    changed: plan.changed,
    unmatched: plan.unmatched,
    warnings: report.warnings,
  };
}
