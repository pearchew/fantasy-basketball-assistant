import { describe, expect, it } from "vitest";
import { buildDepthChart, isReliable, startsWithAndWithout, type LogLine } from "../src/lib/nextUp/depth";
import { buildPrompt } from "../src/lib/nextUp/model";
import { ruleBeneficiaries } from "../src/lib/nextUp/rules";

const roster = [
  { id: "star", name: "Star Guard", position: "G" },
  { id: "g2", name: "Second Guard", position: "G" },
  { id: "f1", name: "Big Forward", position: "F" },
  { id: "f2", name: "Wing Forward", position: "F" },
  { id: "c1", name: "Center One", position: "C" },
  { id: "bg", name: "Bench Guard", position: "G" },
  { id: "bc", name: "Bench Center", position: "C" },
  { id: "hurt", name: "Hurt Forward", position: "F" },
];
const positions = new Map(roster.map((p) => [p.id, p.position]));

type Cell = [starter: boolean, min: number, fga: number];
function game(n: number, cells: Record<string, Cell>): LogLine[] {
  return Object.entries(cells).map(([id, [starter, min, fga]]) => ({
    event_id: `g${String(n).padStart(2, "0")}`,
    player_id: id,
    player_name: roster.find((r) => r.id === id)!.name,
    team_abbr: "TST",
    game_date: `2026-01-${String(n).padStart(2, "0")}`,
    starter,
    did_not_play: min === 0,
    min,
    pts: fga,
    fga,
    fta: 2,
    tov: 1,
  }));
}

// Games 1-6: Star plays. Games 7-10: Star sits; the Bench Center (a different position) jumps
// from 8 to 20 minutes, Big Forward takes 6 more shots. Hurt Forward is injured (no line) in
// games 7-9 and plays 0 (DNP) in game 10.
const withStar: Record<string, Cell> = {
  star: [true, 36, 20], g2: [true, 32, 12], f1: [true, 30, 10], f2: [true, 28, 8], c1: [true, 26, 7],
  bg: [false, 14, 5], bc: [false, 8, 2], hurt: [false, 10, 4],
};
const rest = Object.fromEntries(Object.entries(withStar).filter(([id]) => id !== "star" && id !== "hurt"));
const withoutStar: Record<string, Cell> = { ...rest, bg: [true, 30, 9], f1: [true, 32, 16], bc: [false, 20, 6] };
const logs = [
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => game(n, withStar)),
  ...[7, 8, 9].flatMap((n) => game(n, withoutStar)),
  ...game(10, { ...withoutStar, hurt: [false, 0, 0] }),
];

describe("startsWithAndWithout splits", () => {
  const sat = startsWithAndWithout("star", logs);

  it("compares per-game averages in games he missed against games he played", () => {
    expect(sat.missed).toBe(4);
    const f1 = sat.splits.get("f1")!;
    expect(f1).toMatchObject({ gamesWithout: 4, gamesWith: 6 });
    expect(f1.min).toBeCloseTo(2);
    expect(f1.fga).toBeCloseTo(6);
    expect(f1.usage).toBeCloseTo(6); // free throws and turnovers unchanged
    expect(sat.splits.get("bc")!.min).toBeCloseTo(12);
  });

  it("counts a 'did not play' as zero but leaves out games a teammate wasn't on the box score", () => {
    const hurt = sat.splits.get("hurt")!;
    expect(hurt.gamesWithout).toBe(1); // only game 10, as a DNP
    expect(hurt.min).toBeCloseTo(-10);
    expect(isReliable(hurt)).toBe(false);
    expect(isReliable(sat.splits.get("f1"))).toBe(true);
  });
});

describe("rules with splits", () => {
  // Depth chart from the games before the Star's absence, so he's a starter there.
  const depth = buildDepthChart({ team: "TST", teamLogs: logs, roster, positions });
  const sat = new Map([["star", startsWithAndWithout("star", logs)]]);
  const r = ruleBeneficiaries({
    absent: [{ id: "star", name: "Star Guard", position: "G" }],
    returning: [],
    depth,
    sat,
    unavailable: new Set(["star"]),
    questionable: new Set(),
  });
  const candidates = r.candidates.get("star")!;

  it("names a clear jump at another position, with the numbers in the reason", () => {
    const bc = candidates.find((c) => c.player_id === "bc")!;
    expect(bc.type).toBe("bench_minutes");
    expect(bc.reason).toMatch(/\+12\.0 min, \+4\.0 shots/);
    expect(bc.split).toMatchObject({ vs: "star", games: 4, min: 12 });
  });

  it("ranks starters by their measured usage gain", () => {
    const usage = candidates.filter((c) => c.type === "starter_usage").map((c) => c.player_id);
    expect(usage[0]).toBe("f1"); // +6 shots beats the guard's +0
  });

  it("gives the model the split numbers", () => {
    const prompt = buildPrompt({
      depth,
      gameLabel: "TST vs OTH",
      absent: [{ id: "star", name: "Star Guard", position: "G", status: "out" }],
      returning: [],
      candidates: r.candidates,
      questionable: new Set(),
    });
    expect(prompt).toContain("{split, 4 games without: +12.0 min, +4.0 FGA, +4.0 usage, +4.0 pts per game}");
  });
});
