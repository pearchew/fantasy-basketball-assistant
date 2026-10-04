import type { SupabaseClient } from "@supabase/supabase-js";

export type LeagueFormat = "h2h_9cat" | "roto";
export const FORMAT_LABELS: Record<LeagueFormat, string> = { h2h_9cat: "H2H 9-cat", roto: "Roto" };

export type Team = { id: string; name: string; format: LeagueFormat };

export type DirectoryPlayer = {
  espnId: string;
  name: string;
  position: string;
  teamAbbr: string | null;
  active: boolean;
};

/** A player as shown anywhere in the app, with every place I hold him. */
export type OwnedPlayer = DirectoryPlayer & {
  onTeams: { id: string; name: string }[];
  watchlisted: boolean;
};

export type Dashboard = {
  teams: Team[];
  rosters: Record<string, OwnedPlayer[]>; // team id -> players
  watchlist: OwnedPlayer[];
  directory: DirectoryPlayer[]; // active players, for autocomplete
};

type PlayerRow = { espn_id: string; name: string; position: string; team_abbr: string | null; active: boolean };

export function assembleDashboard(input: {
  teams: Team[];
  spots: { team_id: string; player_id: string }[];
  watch: { player_id: string }[];
  players: PlayerRow[];
}): Dashboard {
  const players = new Map<string, DirectoryPlayer>(
    input.players.map((p) => [
      p.espn_id,
      { espnId: p.espn_id, name: p.name, position: p.position, teamAbbr: p.team_abbr, active: p.active },
    ]),
  );
  const teamName = new Map(input.teams.map((t) => [t.id, t.name]));
  const watched = new Set(input.watch.map((w) => w.player_id));

  const teamsByPlayer = new Map<string, { id: string; name: string }[]>();
  for (const s of input.spots) {
    const list = teamsByPlayer.get(s.player_id) ?? [];
    list.push({ id: s.team_id, name: teamName.get(s.team_id) ?? "?" });
    teamsByPlayer.set(s.player_id, list);
  }
  for (const list of teamsByPlayer.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const owned = (id: string): OwnedPlayer | null => {
    const p = players.get(id);
    return p ? { ...p, onTeams: teamsByPlayer.get(id) ?? [], watchlisted: watched.has(id) } : null;
  };
  const byName = (a: OwnedPlayer, b: OwnedPlayer) => a.name.localeCompare(b.name);

  const rosters: Record<string, OwnedPlayer[]> = Object.fromEntries(input.teams.map((t) => [t.id, []]));
  for (const s of input.spots) {
    const p = owned(s.player_id);
    if (p) rosters[s.team_id]?.push(p);
  }
  for (const list of Object.values(rosters)) list.sort(byName);

  return {
    teams: [...input.teams].sort((a, b) => a.name.localeCompare(b.name)),
    rosters,
    watchlist: input.watch.map((w) => owned(w.player_id)).filter((p): p is OwnedPlayer => !!p).sort(byName),
    directory: [...players.values()].filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function loadDashboard(supabase: SupabaseClient): Promise<Dashboard> {
  const columns = "espn_id, name, position, team_abbr, active";
  const [teams, spots, watch, active] = await Promise.all([
    supabase.from("fantasy_teams").select("id, name, format"),
    supabase.from("roster_spots").select("team_id, player_id"),
    supabase.from("watchlist").select("player_id"),
    // ~450-650 rostered players: well inside PostgREST's 1,000-row page.
    supabase.from("players").select(columns).eq("active", true),
  ]);
  for (const r of [teams, spots, watch, active]) if (r.error) throw r.error;

  // Players I hold who have since left the league still need to resolve.
  const activeIds = new Set(active.data!.map((p) => p.espn_id));
  const held = [...new Set([...spots.data!, ...watch.data!].map((r) => r.player_id))];
  const missing = held.filter((id) => !activeIds.has(id));
  let inactive: PlayerRow[] = [];
  if (missing.length) {
    const r = await supabase.from("players").select(columns).in("espn_id", missing);
    if (r.error) throw r.error;
    inactive = r.data as PlayerRow[];
  }

  return assembleDashboard({
    teams: teams.data as Team[],
    spots: spots.data!,
    watch: watch.data!,
    players: [...(active.data as PlayerRow[]), ...inactive],
  });
}
