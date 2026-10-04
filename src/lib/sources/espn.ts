// ESPN's public site API: undocumented, free, no key. Used for the player
// directory, league-wide box scores (game logs) and as a secondary injury feed.
import { fetchJson, mapLimit } from "./http";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export type Player = {
  espnId: string;
  name: string;
  position: string; // NBA-listed: G, F, C (ESPN collapses combos to one letter)
  teamId: string;
  teamAbbr: string;
};

export type Team = { id: string; abbr: string; name: string };

export type GameSummary = {
  eventId: string;
  date: string; // ISO tip-off time
  status: string; // e.g. STATUS_FINAL, STATUS_SCHEDULED
  home: string;
  away: string;
};

export type BoxLine = {
  eventId: string;
  espnId: string;
  name: string;
  teamAbbr: string;
  starter: boolean;
  didNotPlay: boolean;
  min: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
};

export type EspnInjury = {
  espnId: string | null;
  name: string;
  teamAbbr: string | null;
  status: string;
  comment: string;
  date: string;
};

type TeamsResponse = {
  sports: { leagues: { teams: { team: { id: string; abbreviation: string; displayName: string } }[] }[] }[];
};

export async function fetchTeams(): Promise<Team[]> {
  const d = await fetchJson<TeamsResponse>(`${BASE}/teams`);
  return d.sports[0].leagues[0].teams.map(({ team }) => ({
    id: team.id,
    abbr: team.abbreviation,
    name: team.displayName,
  }));
}

type RosterResponse = {
  athletes: { id: string; displayName: string; position?: { abbreviation: string } }[];
};

export async function fetchRoster(team: Team): Promise<Player[]> {
  const d = await fetchJson<RosterResponse>(`${BASE}/teams/${team.id}/roster`);
  return d.athletes.map((a) => ({
    espnId: a.id,
    name: a.displayName,
    position: a.position?.abbreviation ?? "",
    teamId: team.id,
    teamAbbr: team.abbr,
  }));
}

/** Every rostered player in the league, including two-way and 10-day contracts. */
export async function fetchPlayerDirectory(): Promise<Player[]> {
  const teams = await fetchTeams();
  const rosters = await mapLimit(teams, 6, fetchRoster);
  return rosters.flat();
}

type ScoreboardResponse = {
  events: {
    id: string;
    date: string;
    status: { type: { name: string } };
    competitions: { competitors: { homeAway: "home" | "away"; team: { abbreviation: string } }[] }[];
  }[];
};

/** Games on a date, `yyyymmdd` in US Eastern. */
export async function fetchScoreboard(yyyymmdd: string): Promise<GameSummary[]> {
  const d = await fetchJson<ScoreboardResponse>(`${BASE}/scoreboard?dates=${yyyymmdd}`);
  return d.events.map((e) => {
    const side = (h: string) =>
      e.competitions[0].competitors.find((c) => c.homeAway === h)?.team.abbreviation ?? "";
    return { eventId: e.id, date: e.date, status: e.status.type.name, home: side("home"), away: side("away") };
  });
}

type SummaryResponse = {
  boxscore: {
    players?: {
      team: { abbreviation: string };
      statistics: {
        labels: string[];
        athletes: {
          athlete: { id: string; displayName: string };
          starter: boolean;
          didNotPlay?: boolean;
          stats: string[];
        }[];
      }[];
    }[];
  };
};

function makesAttempts(s: string | undefined): [number, number] {
  const [m, a] = (s ?? "0-0").split("-").map(Number);
  return [m || 0, a || 0];
}

export async function fetchBoxScore(eventId: string): Promise<BoxLine[]> {
  const d = await fetchJson<SummaryResponse>(`${BASE}/summary?event=${eventId}`);
  const lines: BoxLine[] = [];
  for (const side of d.boxscore.players ?? []) {
    const table = side.statistics[0];
    const col = (name: string) => table.labels.indexOf(name);
    for (const a of table.athletes) {
      const s = a.stats;
      const num = (label: string) => Number(s[col(label)]) || 0;
      const [fgm, fga] = makesAttempts(s[col("FG")]);
      const [tpm, tpa] = makesAttempts(s[col("3PT")]);
      const [ftm, fta] = makesAttempts(s[col("FT")]);
      lines.push({
        eventId,
        espnId: a.athlete.id,
        name: a.athlete.displayName,
        teamAbbr: side.team.abbreviation,
        starter: a.starter,
        didNotPlay: Boolean(a.didNotPlay) || s.length === 0,
        min: num("MIN"),
        pts: num("PTS"),
        fgm, fga, tpm, tpa, ftm, fta,
        reb: num("REB"),
        ast: num("AST"),
        stl: num("STL"),
        blk: num("BLK"),
        tov: num("TO"),
      });
    }
  }
  return lines;
}

/** League-wide game logs for every completed game on a date. */
export async function fetchGameLogsForDate(yyyymmdd: string): Promise<{ games: GameSummary[]; lines: BoxLine[] }> {
  const games = (await fetchScoreboard(yyyymmdd)).filter((g) => g.status === "STATUS_FINAL");
  const boxes = await mapLimit(games, 4, (g) => fetchBoxScore(g.eventId));
  return { games, lines: boxes.flat() };
}

type InjuriesResponse = {
  injuries: {
    injuries: {
      status: string;
      shortComment?: string;
      date: string;
      athlete: { displayName: string; team?: { abbreviation: string }; links?: { href: string }[] };
    }[];
  }[];
};

export async function fetchEspnInjuries(): Promise<EspnInjury[]> {
  const d = await fetchJson<InjuriesResponse>(`${BASE}/injuries`);
  return d.injuries.flatMap((t) =>
    t.injuries.map((i) => ({
      espnId: i.athlete.links?.map((l) => l.href.match(/\/id\/(\d+)/)?.[1]).find(Boolean) ?? null,
      name: i.athlete.displayName,
      teamAbbr: i.athlete.team?.abbreviation ?? null,
      status: i.status,
      comment: i.shortComment ?? "",
      date: i.date,
    })),
  );
}
