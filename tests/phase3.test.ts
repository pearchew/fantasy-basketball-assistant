import { describe, expect, it } from "vitest";
import { buildDepthChart, startsWithAndWithout, type LogLine } from "../src/lib/nextUp/depth";
import { buildPrompt, oneSentence, validateModelCalls } from "../src/lib/nextUp/model";
import { ruleBeneficiaries, type SatStats } from "../src/lib/nextUp/rules";
import { groupsFromUpdates, type GroupUpdate } from "../src/lib/nextUp/store";

// A small team: two guards, three forwards, a center. Game g1 is the most recent.
const players = {
  pg: { id: "pg", name: "Point Guard", position: "G" },
  sg: { id: "sg", name: "Shooting Guard", position: "G" },
  g6: { id: "g6", name: "Sixth Guard", position: "G" },
  sf: { id: "sf", name: "Star Forward", position: "F" },
  pf: { id: "pf", name: "Power Forward", position: "F" },
  bf: { id: "bf", name: "Bench Forward", position: "F" },
  fill: { id: "fill", name: "Fill In", position: "F" },
  c: { id: "c", name: "Big Center", position: "C" },
};
const positions = new Map(Object.values(players).map((p) => [p.id, p.position]));

function game(n: number, lineup: Record<string, [boolean, number]>): LogLine[] {
  return Object.entries(lineup).map(([id, [starter, min]]) => ({
    event_id: `g${n}`,
    player_id: id,
    player_name: players[id as keyof typeof players].name,
    team_abbr: "TST",
    game_date: `2026-01-${String(30 - n).padStart(2, "0")}`,
    starter,
    did_not_play: min === 0,
    min,
  }));
}

const usual = { pg: [true, 34], sg: [true, 30], sf: [true, 36], pf: [true, 30], c: [true, 28], g6: [false, 22], bf: [false, 18], fill: [false, 8] } as Record<string, [boolean, number]>;
// Star Forward sat games 3 and 4; Fill In started both.
const withoutStar = { ...usual, sf: [false, 0], fill: [true, 30] } as Record<string, [boolean, number]>;
const logs = [1, 2, 5, 6, 7, 8, 9, 10].flatMap((n) => game(n, usual)).concat([3, 4].flatMap((n) => game(n, withoutStar)));
const roster = Object.values(players);

describe("buildDepthChart", () => {
  const depth = buildDepthChart({ team: "TST", teamLogs: logs, roster, positions });

  it("marks starters by start rate in games played and orders by minutes", () => {
    expect(depth.window).toHaveLength(10);
    expect(depth.players.filter((p) => p.starter).map((p) => p.id).sort()).toEqual(["c", "pf", "pg", "sf", "sg"]);
    const fill = depth.players.find((p) => p.id === "fill")!;
    expect(fill).toMatchObject({ gp: 10, starts: 2, starter: false });
    expect(fill.mpg).toBeCloseTo((8 * 8 + 30 * 2) / 10);
  });

  it("borrows recent minutes from another team for a new arrival", () => {
    const newcomer = { id: "new", name: "New Guy", position: "G" };
    const elsewhere = new Map([["new", [{ ...game(1, usual)[0], player_id: "new", team_abbr: "OTH", starter: true, min: 31 }]]]);
    const d = buildDepthChart({ team: "TST", teamLogs: logs, roster: [...roster, newcomer], positions, elsewhere });
    expect(d.players.find((p) => p.id === "new")).toMatchObject({ newArrival: true, starter: true, mpg: 31 });
  });
});

describe("startsWithAndWithout", () => {
  it("counts who started in the games a player missed", () => {
    const s = startsWithAndWithout("sf", logs);
    expect(s.missed).toBe(2);
    expect(s.whenSat.get("fill")).toBe(2);
    expect(s.whenPlayed.get("fill") ?? 0).toBe(0);
  });
});

describe("ruleBeneficiaries", () => {
  const depth = buildDepthChart({ team: "TST", teamLogs: logs, roster, positions });
  const sat = new Map<string, SatStats>([["sf", startsWithAndWithout("sf", logs)]]);
  const run = (unavailable: string[], questionable: string[] = []) =>
    ruleBeneficiaries({ absent: [players.sf], returning: [], depth, sat, unavailable: new Set(["sf", ...unavailable]), questionable: new Set(questionable) });

  it("names the player who started when the starter sat, then bench and starter usage", () => {
    const r = run([]);
    const byType = Object.fromEntries(r.beneficiaries.map((b) => [b.type, b.player_id]));
    expect(byType.starter_replacement).toBe("fill");
    expect(byType.bench_minutes).toBe("bf");
    expect(byType.starter_usage).toBe("pf");
    expect(r.beneficiaries.find((b) => b.player_id === "fill")!.reason).toMatch(/Started 2 of the 2/);
  });

  it("never names an out or doubtful player, and flags questionable ones", () => {
    const r = run(["fill"], ["bf"]);
    expect(r.beneficiaries.some((b) => b.player_id === "fill")).toBe(false);
    expect(r.beneficiaries.find((b) => b.player_id === "bf")?.questionable).toBe(true);
  });

  it("names who loses minutes when a player returns", () => {
    const r = ruleBeneficiaries({ absent: [], returning: [players.sf], depth, sat, unavailable: new Set(), questionable: new Set() });
    expect(r.beneficiaries[0]).toMatchObject({ player_id: "fill", type: "loses_minutes" });
  });
});

describe("validateModelCalls", () => {
  const depth = buildDepthChart({ team: "TST", teamLogs: logs, roster, positions });
  const sat = new Map<string, SatStats>([["sf", startsWithAndWithout("sf", logs)]]);
  const rules = ruleBeneficiaries({ absent: [players.sf], returning: [], depth, sat, unavailable: new Set(["sf"]), questionable: new Set() });
  const validate = (calls: object[]) =>
    validateModelCalls({ calls, absent: [players.sf], returning: [], candidates: rules.candidates, rulePicks: rules.beneficiaries, questionable: new Set() });

  it("keeps listed candidates in the model's order and rejects invented names", () => {
    const v = validate([
      { for: "Star Forward", name: "Bench Forward", type: "starter_replacement", reason: "He starts. More text here." },
      { for: "Star Forward", name: "LeBron James", type: "bench_minutes", reason: "Invented." },
      { for: "Star Forward", name: "Power Forward", type: "loses_minutes", reason: "Wrong type for an absence." },
    ]);
    expect(v.beneficiaries.map((b) => [b.player_id, b.type])).toEqual([
      ["bf", "starter_replacement"],
      ["pf", "starter_usage"],
    ]);
    expect(v.beneficiaries[0].reason).toBe("He starts.");
    expect(v.rejected).toEqual(["LeBron James for Star Forward"]);
  });

  it("falls back to the rules when the model names nobody valid", () => {
    expect(validate([{ for: "Star Forward", name: "Nobody" }]).beneficiaries).toEqual(rules.beneficiaries);
    expect(validate([]).beneficiaries.length).toBeGreaterThan(0);
  });

  it("lists every candidate with its rule note in the prompt", () => {
    const prompt = buildPrompt({ depth, gameLabel: "TST vs OTH", absent: [{ ...players.sf, status: "out" }], returning: [], candidates: rules.candidates, questionable: new Set() });
    expect(prompt).toContain("Star Forward (out)");
    expect(prompt).toContain("Fill In [starter_replacement] Started 2 of the 2");
  });
});

describe("oneSentence", () => {
  it("keeps initials and suffixes intact", () => {
    expect(oneSentence("P.J. Washington takes more shots. Second sentence.")).toBe("P.J. Washington takes more shots.");
    expect(oneSentence("Jaren Jackson Jr. starts at center. Extra.")).toBe("Jaren Jackson Jr. starts at center.");
  });
});

describe("groupsFromUpdates", () => {
  const u = (over: Partial<GroupUpdate>): GroupUpdate => ({
    game_date: "2026-11-02", matchup: "TST@OTH", team_abbr: "TST", player_id: "sf", player_name: "Star Forward",
    status: "out", reason: "Injury/Illness - Knee", returning: false, ...over,
  });

  it("keys a team-game by its sorted absent and returning players, ignoring G League and unmatched rows", () => {
    const groups = groupsFromUpdates(
      [
        u({ player_id: "pg", player_name: "Point Guard", status: "doubtful" }),
        u({}),
        u({ player_id: "g6", player_name: "Sixth Guard", status: "available", returning: true }),
        u({ player_id: "bf", player_name: "Bench Forward", status: "questionable" }),
        u({ player_id: "two", player_name: "Two Way", reason: "G League - Two-Way" }),
        u({ player_id: null, player_name: "Unknown" }),
      ],
      positions,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("2026-11-02|TST|pg,sf|g6");
    expect(groups[0].questionable).toEqual(["bf"]);
  });

  it("skips team-games with nobody out or returning", () => {
    expect(groupsFromUpdates([u({ status: "questionable" })], positions)).toEqual([]);
  });
});
