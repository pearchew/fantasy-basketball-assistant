import { describe, expect, it } from "vitest";
import { seasonLabel, toPlayerStats, trend, type StatWindow, type WindowRow } from "../src/lib/stats";

function row(over: Partial<WindowRow>): WindowRow {
  return {
    player_id: "1", window_size: 0, games: 40, last_game: "2026-04-10",
    min: "30", pts: "20", reb: "6", ast: "5", stl: "1", blk: "0.5", tpm: "2", tov: "2.5", fga: "15", fta: "5",
    fgm_total: 300, fga_total: 600, ftm_total: 160, fta_total: 200,
    ...over,
  };
}

describe("toPlayerStats", () => {
  const stats = toPlayerStats([
    row({ window_size: 0 }),
    row({ window_size: 7, games: 7, pts: "25.5", fgm_total: 70, fga_total: 120, last_game: "2026-04-12" }),
    row({ window_size: 30, games: 30 }),
    row({ window_size: 14, games: 14, fta_total: 0, ftm_total: 0 }),
    row({ player_id: "2", window_size: 7, games: 3 }),
  ]);

  it("orders windows 7, 14, 30, season and parses Postgres numerics", () => {
    expect(stats["1"].windows.map((w) => w.label)).toEqual(["Last 7", "Last 14", "Last 30", "Season"]);
    expect(stats["1"].windows[0].pts).toBe(25.5);
    expect(stats["1"].lastGame).toBe("2026-04-12");
  });

  it("computes percentages as total makes over total attempts, null with no attempts", () => {
    expect(stats["1"].windows[0].fgPct).toBeCloseTo(70 / 120);
    expect(stats["1"].windows[3].ftPct).toBe(0.8);
    expect(stats["1"].windows[1].ftPct).toBeNull();
  });

  it("keeps a short window's real game count", () => {
    expect(stats["2"].windows[0].games).toBe(3);
  });
});

describe("trend", () => {
  const w = (over: Partial<StatWindow>): StatWindow => ({
    size: 7, label: "Last 7", games: 7, min: 30, pts: 20, reb: 6, ast: 5, stl: 1, blk: 0.5, tpm: 2, tov: 2.5,
    fga: 15, fta: 5, fgPct: 0.48, ftPct: 0.8, ...over,
  });
  const season = w({ size: 0, label: "Season", games: 40 });

  it("flags clear rises and falls against the season", () => {
    expect(trend(w({ pts: 24 }), season, "pts")).toBe("up");
    expect(trend(w({ pts: 17 }), season, "pts")).toBe("down");
    expect(trend(w({ pts: 21 }), season, "pts")).toBeNull(); // 5%: noise
  });

  it("treats more turnovers as worse and uses points for percentages", () => {
    expect(trend(w({ tov: 3.5 }), season, "tov")).toBe("down");
    expect(trend(w({ fgPct: 0.52 }), season, "fgPct")).toBe("up");
    expect(trend(w({ fgPct: 0.5 }), season, "fgPct")).toBeNull();
  });

  it("ignores tiny bases and small samples", () => {
    expect(trend(w({ blk: 0.7 }), season, "blk")).toBeNull(); // +0.2 is under the 0.3 floor
    expect(trend(w({ games: 2, pts: 30 }), season, "pts")).toBeNull();
    expect(trend(season, season, "pts")).toBeNull();
  });
});

describe("seasonLabel", () => {
  it("turns ESPN's season year into the usual label", () => {
    expect(seasonLabel(2026)).toBe("2025-26");
    expect(seasonLabel(2027)).toBe("2026-27");
  });
});
