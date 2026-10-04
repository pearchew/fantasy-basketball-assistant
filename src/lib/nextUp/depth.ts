// Depth chart built from box scores: who starts, and the minutes order behind them.

export type LogLine = {
  event_id: string;
  player_id: string;
  player_name: string;
  team_abbr: string;
  game_date: string;
  starter: boolean;
  did_not_play: boolean;
  min: number;
};

export type RosterPlayer = { id: string; name: string; position: string };

export type DepthPlayer = {
  id: string;
  name: string;
  position: string; // G, F, C, or "" if unknown
  gp: number; // games played in the window
  starts: number;
  mpg: number;
  starter: boolean;
  /** No games for this team yet: stats come from his recent games elsewhere. */
  newArrival: boolean;
};

export type DepthChart = { team: string; window: string[]; players: DepthPlayer[] };

export const WINDOW = 10;

const played = (l: LogLine) => !l.did_not_play && l.min > 0;

/** Distinct event ids, newest first. */
export function teamGames(lines: LogLine[]): string[] {
  const dates = new Map<string, string>();
  for (const l of lines) dates.set(l.event_id, l.game_date);
  return [...dates].sort((a, b) => b[1].localeCompare(a[1]) || b[0].localeCompare(a[0])).map(([id]) => id);
}

function summarize(lines: LogLine[]) {
  const p = lines.filter(played);
  const starts = p.filter((l) => l.starter).length;
  const minutes = p.reduce((n, l) => n + l.min, 0);
  return { gp: p.length, starts, mpg: p.length ? minutes / p.length : 0 };
}

/**
 * `teamLogs`: this team's lines from games before the target game.
 * `roster`: the current roster (live use). Without it (backtests), the roster is
 * whoever appeared in the team's five most recent games.
 * `elsewhere`: recent lines with other teams, for players new to this team.
 */
export function buildDepthChart(input: {
  team: string;
  teamLogs: LogLine[];
  roster?: RosterPlayer[];
  positions: Map<string, string>;
  elsewhere?: Map<string, LogLine[]>;
}): DepthChart {
  const window = teamGames(input.teamLogs).slice(0, WINDOW);
  const inWindow = new Set(window);
  const byPlayer = new Map<string, LogLine[]>();
  for (const l of input.teamLogs) {
    if (!inWindow.has(l.event_id)) continue;
    const list = byPlayer.get(l.player_id) ?? [];
    list.push(l);
    byPlayer.set(l.player_id, list);
  }

  let roster = input.roster;
  if (!roster) {
    const recent = new Set(window.slice(0, 5));
    const seen = new Map<string, string>();
    for (const l of input.teamLogs) if (recent.has(l.event_id)) seen.set(l.player_id, l.player_name);
    roster = [...seen].map(([id, name]) => ({ id, name, position: input.positions.get(id) ?? "" }));
  }

  const players = roster.map((r): DepthPlayer => {
    const own = byPlayer.get(r.id) ?? [];
    let stats = summarize(own);
    let newArrival = false;
    if (stats.gp === 0 && input.elsewhere?.get(r.id)?.length) {
      const recent = [...input.elsewhere.get(r.id)!].sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, WINDOW);
      stats = summarize(recent);
      newArrival = stats.gp > 0;
    }
    return {
      id: r.id,
      name: r.name,
      position: r.position || input.positions.get(r.id) || "",
      ...stats,
      starter: stats.gp > 0 && stats.starts / stats.gp >= 0.5,
      newArrival,
    };
  });
  players.sort((a, b) => Number(b.starter) - Number(a.starter) || b.mpg - a.mpg);
  return { team: input.team, window, players };
}

/**
 * For the team's games in the last `lookback` where `playerId` did not play:
 * how often each other player started, and how often he started when `playerId` did play.
 */
export function startsWithAndWithout(playerId: string, teamLogs: LogLine[], lookback = 20) {
  const games = teamGames(teamLogs).slice(0, lookback);
  const inLookback = new Set(games);
  const playedIn = new Set(teamLogs.filter((l) => l.player_id === playerId && played(l)).map((l) => l.event_id));
  const missed = games.filter((g) => !playedIn.has(g));
  const missedSet = new Set(missed);
  const whenSat = new Map<string, number>();
  const whenPlayed = new Map<string, number>();
  for (const l of teamLogs) {
    if (!inLookback.has(l.event_id) || l.player_id === playerId || !l.starter) continue;
    const m = missedSet.has(l.event_id) ? whenSat : whenPlayed;
    m.set(l.player_id, (m.get(l.player_id) ?? 0) + 1);
  }
  return { missed: missed.length, played: games.length - missed.length, whenSat, whenPlayed };
}
