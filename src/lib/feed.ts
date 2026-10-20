import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryItem } from "./injuryIngest";
import type { InjuryStatus } from "./sources/nbaInjuryReport";
import { REFRESH_WINDOW_MS } from "./injuryIngest";
import { gameStartUtc } from "./time";

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
  returning: boolean;
  history: HistoryItem[];
  /** Where I hold this player, if anywhere. */
  heldOn: string[];
};

/** One game's updates, both teams. */
export type Game = {
  key: string;
  gameDate: string;
  matchup: string; // "DAL@CLE"
  /** Tip-off as an ISO instant; null if the report's time couldn't be read. */
  start: string | null;
  teams: { name: string; abbr: string | null; updates: FeedUpdate[] }[];
  counts: Partial<Record<InjuryStatus, number>>;
  /** Updates about my players. */
  mine: number;
};

export type Feed = {
  /** Updates about players I hold, worst status first. */
  mine: FeedUpdate[];
  /** Every update, grouped by game, earliest tip-off first. */
  games: Game[];
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

export const isGLeague = (u: Pick<FeedUpdate, "reason">) => /^G League/i.test(u.reason);

/** Within a team: worst status first, G League and two-way assignments last. */
const inTeamOrder = (a: FeedUpdate, b: FeedUpdate) =>
  Number(isGLeague(a)) - Number(isGLeague(b)) || severity(a.status) - severity(b.status) || a.playerName.localeCompare(b.playerName);

/** Groups upcoming-game updates by game and pulls out what concerns my players. */
export function buildFeed(updates: FeedUpdate[]): Feed {
  const games = new Map<string, Game & { order: Map<string, number> }>();
  const mine: FeedUpdate[] = [];
  const unmatched: FeedUpdate[] = [];

  for (const u of updates) {
    const key = `${u.gameDate}|${u.matchup}`;
    let game = games.get(key);
    if (!game) {
      const start = gameStartUtc(u.gameDate, u.gameTime);
      game = { key, gameDate: u.gameDate, matchup: u.matchup, start: start?.toISOString() ?? null, teams: [], counts: {}, mine: 0, order: new Map() };
      games.set(key, game);
    }
    let team = game.teams.find((t) => t.name === u.teamName);
    if (!team) {
      team = { name: u.teamName, abbr: u.teamAbbr, updates: [] };
      game.teams.push(team);
    }
    team.updates.push(u);
    // The report lists the away team first; ids follow report order.
    game.order.set(u.teamName, Math.min(game.order.get(u.teamName) ?? Infinity, u.id));
    if (!isGLeague(u)) game.counts[u.status] = (game.counts[u.status] ?? 0) + 1;

    if (u.heldOn.length) {
      mine.push(u);
      game.mine++;
    }
    if (!u.playerId) unmatched.push(u);
  }

  const startOf = (g: Game) => g.start ?? `${g.gameDate}T23:59:59Z`;
  const sortedGames = [...games.values()]
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.matchup.localeCompare(b.matchup))
    .map(({ order, ...g }) => {
      g.teams.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
      for (const t of g.teams) t.updates.sort(inTeamOrder);
      return g;
    });
  const gameStart = new Map(sortedGames.map((g, i) => [g.key, i]));
  const gameIndex = (u: FeedUpdate) => gameStart.get(`${u.gameDate}|${u.matchup}`) ?? 0;

  return {
    mine: mine.sort((a, b) => severity(a.status) - severity(b.status) || gameIndex(a) - gameIndex(b) || a.playerName.localeCompare(b.playerName)),
    games: sortedGames,
    unmatched: unmatched.sort((a, b) => a.playerName.localeCompare(b.playerName)),
  };
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
  is_returning: boolean;
  history: HistoryItem[];
};

/** Updates for games from `fromDate` on, or for exactly that date when `onlyDate` is set (archive view). */
export async function loadFeed(
  supabase: SupabaseClient,
  fromDate: string,
  { onlyDate = false }: { onlyDate?: boolean } = {},
): Promise<{ feed: Feed; state: IngestState; heldOn: Record<string, string[]> }> {
  let query = supabase
    .from("injury_updates")
    .select("id, game_date, game_time, matchup, team_name, team_abbr, player_id, player_name, status, reason, raw_text, report_time, changed_at, ongoing, is_returning, history")
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

  const rows = updates.data as Row[];
  const feed = buildFeed(
    rows.map((r) => ({
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
      returning: r.is_returning,
      history: r.history,
      heldOn: (r.player_id && heldOn.get(r.player_id)?.slice().sort()) || [],
    })),
  );
  const s = state.data;
  return {
    feed,
    heldOn: Object.fromEntries([...heldOn].map(([id, list]) => [id, list.slice().sort()])),
    state: {
      lastAttemptAt: s?.last_attempt_at ?? null,
      lastSuccessAt: s?.last_success_at ?? null,
      lastReportTime: s?.last_report_time ?? null,
      lastError: s?.last_error ?? null,
    },
  };
}
