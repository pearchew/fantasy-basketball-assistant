import { describe, expect, it } from "vitest";
import { assembleDashboard, type DirectoryPlayer } from "../src/lib/dashboard";
import { MIN_DIRECTORY_SIZE, planPlayerSync } from "../src/lib/playerSync";
import { searchPlayers } from "../src/lib/search";
import type { Player } from "../src/lib/sources/espn";

function league(n: number, overrides: Partial<Player>[] = []): Player[] {
  const players = Array.from({ length: n }, (_, i) => ({
    espnId: String(i + 1),
    name: `Player ${i + 1}`,
    position: "G",
    teamId: "1",
    teamAbbr: "ATL",
  }));
  overrides.forEach((o, i) => Object.assign(players[i], o));
  return players;
}

describe("planPlayerSync", () => {
  it("upserts everyone fetched and deactivates players who left every roster", () => {
    const fetched = league(MIN_DIRECTORY_SIZE, [{ name: "Luka Dončić", teamAbbr: "LAL" }]);
    const plan = planPlayerSync(fetched, ["1", "2", "9999"]);
    expect(plan.upserts).toHaveLength(MIN_DIRECTORY_SIZE);
    expect(plan.upserts[0]).toMatchObject({ espn_id: "1", name_key: "luka doncic", team_abbr: "LAL", active: true });
    expect(plan.deactivate).toEqual(["9999"]);
  });

  it("picks up a trade as a team change on the same stable ID", () => {
    const plan = planPlayerSync(league(MIN_DIRECTORY_SIZE, [{ espnId: "traded", teamAbbr: "DAL" }]), ["traded"]);
    expect(plan.upserts.find((r) => r.espn_id === "traded")?.team_abbr).toBe("DAL");
    expect(plan.deactivate).toEqual([]);
  });

  it("refuses a suspiciously small fetch instead of deactivating the league", () => {
    expect(() => planPlayerSync(league(20), ["1"])).toThrow(/refusing to sync/);
  });
});

describe("assembleDashboard", () => {
  const players = [
    { espn_id: "1", name: "Cooper Flagg", position: "F", team_abbr: "DAL", active: true },
    { espn_id: "2", name: "Naji Marshall", position: "F", team_abbr: "DAL", active: true },
    { espn_id: "3", name: "Retired Guy", position: "G", team_abbr: null, active: false },
  ];
  const d = assembleDashboard({
    teams: [
      { id: "b", name: "Roto League", format: "roto" },
      { id: "a", name: "Work League", format: "h2h_9cat" },
    ],
    spots: [
      { team_id: "a", player_id: "1" },
      { team_id: "b", player_id: "1" },
      { team_id: "a", player_id: "3" },
    ],
    watch: [{ player_id: "2" }],
    players,
  });

  it("shows every team a player is on, wherever he appears", () => {
    const names = (id: string) => d.rosters[id].find((p) => p.espnId === "1")!.onTeams.map((t) => t.name);
    expect(names("a")).toEqual(["Roto League", "Work League"]);
    expect(names("b")).toEqual(["Roto League", "Work League"]);
  });

  it("keeps inactive players on rosters but out of autocomplete", () => {
    expect(d.rosters.a.map((p) => p.name)).toEqual(["Cooper Flagg", "Retired Guy"]);
    expect(d.directory.map((p) => p.espnId)).toEqual(["1", "2"]);
  });

  it("marks watchlisted players and sorts teams by name", () => {
    expect(d.watchlist.map((p) => [p.name, p.watchlisted, p.onTeams.length])).toEqual([["Naji Marshall", true, 0]]);
    expect(d.teams.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("searchPlayers", () => {
  const dir: DirectoryPlayer[] = ["Jalen Brunson", "Jalen Williams", "Jaylen Brown", "Luka Dončić", "Dereck Lively II"].map(
    (name, i) => ({ espnId: String(i), name, position: "G", teamAbbr: "X", active: true }),
  );
  const names = (q: string) => searchPlayers(dir, q).map((p) => p.name);

  it("matches word prefixes in any order, ignoring accents", () => {
    expect(names("jal")).toEqual(["Jalen Brunson", "Jalen Williams"]);
    expect(names("j bru")).toEqual(["Jalen Brunson"]);
    expect(names("doncic")).toEqual(["Luka Dončić"]);
    expect(names("lively")).toEqual(["Dereck Lively II"]);
  });

  it("ranks first-name matches ahead of surname matches", () => {
    const d2 = [...dir, { espnId: "9", name: "Bruce Brown", position: "G", teamAbbr: "X", active: true }];
    expect(searchPlayers(d2, "br").map((p) => p.name)).toEqual(["Bruce Brown", "Jalen Brunson", "Jaylen Brown"]);
  });

  it("returns nothing for an empty query", () => {
    expect(names("  ")).toEqual([]);
  });
});
