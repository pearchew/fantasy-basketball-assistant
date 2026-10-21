import { describe, expect, it } from "vitest";
import { leaders, pickFlags, rosterable, strength, toFormFlag, type FormFlag, type FormRow } from "../src/lib/form";

const flag = (name: string, over: Partial<FormFlag> = {}): FormFlag => ({
  playerId: name, name, teamAbbr: "DAL", side: "riser", baseline: "season", baselineRank: 120,
  zPrev10: 1.2, zBaseline: 1.1, valueLast3: 2, valuePrev10: -1, valueBaseline: -0.5, minLast3: 30, minBaseline: 24,
  driversPrev10: {}, driversBaseline: {},
  ...over,
});

describe("toFormFlag", () => {
  it("turns Postgres numerics into numbers", () => {
    const row: FormRow = {
      player_id: "1", player_name: "Ayo Dosunmu", team_abbr: "CHI", side: "riser", baseline: "last_season", baseline_rank: 145,
      z_prev10: "2.21", z_baseline: "1.94", value_last3: "7.90", value_prev10: "-1.10", value_baseline: "-1.20",
      min_last3: "28.3", min_baseline: 26, drivers_prev10: { PTS: 1.4 }, drivers_baseline: { PTS: 1.9 },
    };
    expect(toFormFlag(row)).toMatchObject({ name: "Ayo Dosunmu", baseline: "last_season", zPrev10: 2.21, zBaseline: 1.94, minBaseline: 26 });
  });
});

describe("strength", () => {
  it("is the smaller of the two gaps, ignoring sign", () => {
    expect(strength(flag("a", { zPrev10: 2.5, zBaseline: 0.7 }))).toBe(0.7);
    expect(strength(flag("b", { side: "dropper", zPrev10: -0.9, zBaseline: -1.4 }))).toBe(0.9);
  });
});

describe("rosterable", () => {
  it("judges risers on their last 3 games and droppers on their baseline", () => {
    expect(rosterable(flag("bench", { valueLast3: -3.8, valueBaseline: -9 }))).toBe(false);
    expect(rosterable(flag("breakout", { valueLast3: 0.4, valueBaseline: -6 }))).toBe(true);
    expect(rosterable(flag("slump", { side: "dropper", valueLast3: -7, valueBaseline: 0.8 }))).toBe(true);
    expect(rosterable(flag("never", { side: "dropper", valueLast3: -9, valueBaseline: -3 }))).toBe(false);
  });
});

describe("pickFlags", () => {
  const flags = [
    flag("Weak", { zPrev10: 0.6, zBaseline: 0.7 }),
    flag("Strong", { zPrev10: 2.2, zBaseline: 1.9 }),
    flag("Bench", { zPrev10: 3.1, zBaseline: 3.1, valueLast3: -3.8, valueBaseline: -9.1 }),
    flag("Slump", { side: "dropper", zPrev10: -1.4, zBaseline: -1.4, valueLast3: -7, valueBaseline: 0.8 }),
    flag("Mild slump", { side: "dropper", zPrev10: -0.8, zBaseline: -0.6, valueLast3: -4, valueBaseline: 1 }),
  ];

  it("keeps players clearing the threshold, strongest first, rosterable only by default", () => {
    const { risers, droppers } = pickFlags(flags, 1, false);
    expect(risers.map((f) => f.name)).toEqual(["Strong"]);
    expect(droppers.map((f) => f.name)).toEqual(["Slump"]);
  });

  it("shows deep-bench players when asked for everyone", () => {
    const { risers, droppers } = pickFlags(flags, 0.5, true);
    expect(risers.map((f) => f.name)).toEqual(["Bench", "Strong", "Weak"]);
    expect(droppers.map((f) => f.name)).toEqual(["Slump", "Mild slump"]);
  });
});

describe("leaders", () => {
  // John Collins on Jan 12, 2026: last 3 games vs the 10 before them.
  const collins = { TO: 0.08, "3PM": 1.89, AST: -0.53, BLK: 2.26, "FG%": 2.13, "FT%": -1.62, PTS: 0.92, REB: 0.93, STL: 1.8 };

  it("names the biggest gains for a riser", () => {
    expect(leaders(collins, "riser")).toEqual([{ cat: "BLK", delta: 2.26 }, { cat: "FG%", delta: 2.13 }]);
  });

  it("names the biggest drops for a dropper", () => {
    expect(leaders(collins, "dropper")).toEqual([{ cat: "FT%", delta: -1.62 }, { cat: "AST", delta: -0.53 }]);
  });

  it("skips categories that moved the other way", () => {
    expect(leaders({ PTS: -0.4, REB: 0.2 }, "riser", 3)).toEqual([{ cat: "REB", delta: 0.2 }]);
  });
});
