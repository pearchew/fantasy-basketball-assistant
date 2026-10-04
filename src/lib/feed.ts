import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryItem } from "./injuryIngest";
import type { InjuryStatus } from "./sources/nbaInjuryReport";
import { REFRESH_WINDOW_MS } from "./injuryIngest";

export const STATUS_ORDER: InjuryStatus[] = ["out", "doubtful", "questionable", "probable", "available"];

export type FeedUpdate = {
  id: number;
  gameDate: string;
  gameTime: string;
  matchup: string;
  teamName: string;
  teamAbbr: string | null;
  playerId: string | null;
  playerName: string;
  status: InjuryStatus;
  reason: string;
  rawText: string;
  reportTime: string;
  changedAt: string;
  ongoing: boolean;
  history: HistoryItem[];
  /** Where I hold this player, if anywhere. */
  heldOn: string[];
};

export type Feed = {
  mine: FeedUpdate[];
  newAndChanged: FeedUpdate[];
  /** Unchanged repeat absences, collapsed per NBA team. */
  ongoingByTeam: { team: string; updates: FeedUpdate[] }[];
  gLeague: FeedUpdate[];
  /** Names the report printed that matched no directory player. */
  unmatched: FeedUpdate[];
};

export type IngestState = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastReportTime: string | null;
  lastError: string | null;
};

const severity = (s: InjuryStatus) => STATUS_ORDER.indexOf(s);
const byChangeThenSeverity = (a: FeedUpdate, b: FeedUpdate) =>
  b.changedAt.localeCompare(a.changedAt) || severity(a.status) - severity(b.status) || a.playerName.localeCompare(b.playerName);

export const isGLeague = (u: Pick<FeedUpdate, "reason">) => /^G League/i.test(u.reason);

/** Splits upcoming-game updates into the feed's sections. Every update lands in exactly one. */
export function buildFeed(updates: FeedUpdate[]): Feed {
  const feed: Feed = { mine: [], newAndChanged: [], ongoingByTeam: [], gLeague: [], unmatched: [] };
  const ongoing = new Map<string, FeedUpdate[]>();

  for (const u of updates) {
    if (u.heldOn.length) feed.mine.push(u);
    else if (!u.playerId) feed.unmatched.push(u);
    else if (isGLeague(u)) feed.gLeague.push(u);
    else if (u.ongoing && u.history.length === 1) {
      const list = ongoing.get(u.teamName) ?? [];
      list.push(u);
      ongoing.set(u.teamName, list);
    } else feed.newAndChanged.push(u);
  }

  feed.mine.sort((a, b) => severity(a.status) - severity(b.status) || byChangeThenSeverity(a, b));
  feed.newAndChanged.sort(byChangeThenSeverity);
  feed.gLeague.sort((a, b) => a.teamName.localeCompare(b.teamName) || a.playerName.localeCompare(b.playerName));
  feed.unmatched.sort((a, b) => a.playerName.localeCompare(b.playerName));
  feed.ongoingByTeam = [...ongoing]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, list]) => ({ team, updates: list.sort((a, b) => a.playerName.localeCompare(b.playerName)) }));
  return feed;
}

export function isStale(state: IngestState, now = new Date()): boolean {
  return !state.lastAttemptAt || now.getTime() - new Date(state.lastAttemptAt).getTime() > REFRESH_WINDOW_MS;
}

type Row = {
  id: number;
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
  changed_at: string;
  ongoing: boolean;
  history: HistoryItem[];
};

/** Updates for games from `fromDate` on, or for exactly that date when `onlyDate` is set (archive view). */
export async function loadFeed(
  supabase: SupabaseClient,
  fromDate: string,
  { onlyDate = false }: { onlyDate?: boolean } = {},
): Promise<{ feed: Feed; state: IngestState }> {
  let query = supabase
    .from("injury_updates")
    .select("id, game_date, game_time, matchup, team_name, team_abbr, player_id, player_name, status, reason, raw_text, report_time, changed_at, ongoing, history")
    .gte("game_date", fromDate);
  if (onlyDate) query = query.lte("game_date", fromDate);
  const [updates, state, teams, spots, watch] = await Promise.all([
    query.order("changed_at", { ascending: false }).limit(1000),
    supabase.from("ingest_state").select("last_attempt_at, last_success_at, last_report_time, last_error").eq("job", "injury_report").maybeSingle(),
    supabase.from("fantasy_teams").select("id, name"),
    supabase.from("roster_spots").select("team_id, player_id"),
    supabase.from("watchlist").select("player_id"),
  ]);
  for (const r of [updates, state, teams, spots, watch]) if (r.error) throw r.error;

  const teamName = new Map(teams.data!.map((t) => [t.id as string, t.name as string]));
  const heldOn = new Map<string, string[]>();
  for (const s of spots.data!) {
    const list = heldOn.get(s.player_id) ?? [];
    list.push(teamName.get(s.team_id) ?? "?");
    heldOn.set(s.player_id, list);
  }
  for (const w of watch.data!) heldOn.set(w.player_id, [...(heldOn.get(w.player_id) ?? []), "Watchlist"]);

  const feed = buildFeed(
    (updates.data as Row[]).map((r) => ({
      id: r.id,
      gameDate: r.game_date,
      gameTime: r.game_time,
      matchup: r.matchup,
      teamName: r.team_name,
      teamAbbr: r.team_abbr,
      playerId: r.player_id,
      playerName: r.player_name,
      status: r.status,
      reason: r.reason,
      rawText: r.raw_text,
      reportTime: r.report_time,
      changedAt: r.changed_at,
      ongoing: r.ongoing,
      history: r.history,
      heldOn: (r.player_id && heldOn.get(r.player_id)?.sort()) || [],
    })),
  );
  const s = state.data;
  return {
    feed,
    state: {
      lastAttemptAt: s?.last_attempt_at ?? null,
      lastSuccessAt: s?.last_success_at ?? null,
      lastReportTime: s?.last_report_time ?? null,
      lastError: s?.last_error ?? null,
    },
  };
}
