import { describe, expect, it } from "vitest";
import type { FeedUpdate } from "../src/lib/feed";
import { change, hasOnOff, myGains, pickSeason, tableFor, toOnOff, type SeasonSplit, type Side, type SplitRow } from "../src/lib/onOff";

const SUBJECT = "kyrie";
const TEAM = "DAL";

/** A database row: the subject's own count when `teammate` is null. */
function row(season: number, teammate: string | null, sat: boolean, games: number, stats: Partial<SplitRow> = {}): SplitRow {
  return {
    subject_id: SUBJECT, team_abbr: TEAM, season, teammate_id: teammate, teammate_name: teammate && teammate.toUpperCase(), sat, games,
    starts: teammate ? 0 : null,
    min: teammate ? 20 : null, pts: teammate ? 10 : null, reb: null, ast: null, stl: null, blk: null, tpm: null, tov: null,
    fgm: null, fga: null, ftm: null, fta: null,
    ...stats,
  };
}

const update = (over: Partial<FeedUpdate> = {}): FeedUpdate => ({
  id: 1, gameDate: "2026-11-01", gameTime: "07:30 PM", matchup: "DAL@PHX", teamName: "Dallas Mavericks", teamAbbr: TEAM,
  playerId: SUBJECT, playerName: "Kyrie Irving", status: "out", reason: "Injury/Illness - Left Knee; ACL", rawText: "",
  reportTime: "", changedAt: "", ongoing: false, returning: false, history: [], heldOn: [], ...over,
});

describe("toOnOff", () => {
  const rows = [
    row(2027, null, true, 1),
    row(2027, null, false, 4),
    row(2026, null, true, 8),
    row(2026, null, false, 24),
    // Christie: big minutes jump without him.
    row(2026, "christie", true, 8, { min: "31.2", pts: "14.1", starts: 6, fgm: 30, fga: 64, ftm: 0, fta: 0 }),
    row(2026, "christie", false, 24, { min: "21.8", pts: "8.9", starts: 2, fgm: 70, fga: 160 }),
    // Flagg: starts either way, small change.
    row(2026, "flagg", true, 8, { min: 36, pts: 22.4, starts: 8 }),
    row(2026, "flagg", false, 24, { min: 34.8, pts: 19.1, starts: 24 }),
    // Thin: only two games without him, bigger jump than Christie.
    row(2026, "thin", true, 2, { min: 30 }),
    row(2026, "thin", false, 20, { min: 10 }),
    // Joined after he got hurt: no games with him.
    row(2026, "late", true, 5, { min: 25 }),
  ];
  const data = toOnOff(rows, [2027, 2026])[`${SUBJECT}|${TEAM}`];
  const last = data.seasons.find((s) => s.season === 2026)!;

  it("counts the games he sat and played per season", () => {
    expect(data.seasons.map((s) => [s.label, s.sat, s.played])).toEqual([
      ["2026-27", 1, 4],
      ["2025-26", 8, 24],
    ]);
  });

  it("opens on last season until he has sat 3+ games this season", () => {
    expect(data.defaultSeason).toBe(2026);
  });

  it("sorts by minutes gained, with thin samples and one-sided rows last", () => {
    expect(last.rows.map((r) => r.playerId)).toEqual(["christie", "flagg", "thin", "late"]);
  });

  it("drops seasons he didn't spend with the team, keeping one when there are none", () => {
    const one = toOnOff([row(2026, null, true, 82)], [2027, 2026])[`${SUBJECT}|${TEAM}`];
    expect(one.seasons.map((s) => s.season)).toEqual([2026]);
    expect(one.defaultSeason).toBe(2026);
  });

  it("turns database numerics into per-game sides with weighted shooting", () => {
    const c = last.rows[0];
    expect(c.without).toMatchObject({ games: 8, starts: 6, min: 31.2, pts: 14.1, fga: 8 });
    expect(c.without!.fgPct).toBeCloseTo(30 / 64);
    expect(c.without!.ftPct).toBeNull();
    expect(c.with!.fgPct).toBeCloseTo(70 / 160);
    expect(last.rows[3].with).toBeNull();
  });
});

describe("pickSeason", () => {
  const split = (season: number, sat: number): SeasonSplit => ({ season, label: "", sat, played: 10, rows: [] });
  it("prefers this season once he has sat 3 games in it", () => {
    expect(pickSeason([split(2027, 3), split(2026, 20)])).toBe(2027);
    expect(pickSeason([split(2027, 2), split(2026, 20)])).toBe(2026);
  });
  it("stays on this season when he never sat", () => {
    expect(pickSeason([split(2027, 0), split(2026, 0)])).toBe(2027);
    expect(pickSeason([split(2027, 1), split(2026, 0)])).toBe(2027);
  });
});

describe("tableFor and myGains", () => {
  const rows = [
    row(2026, null, true, 8),
    row(2026, null, false, 24),
    row(2026, "christie", true, 8, { min: 31.2, pts: 14.1 }),
    row(2026, "christie", false, 24, { min: 21.8, pts: 8.9 }),
    row(2026, "lively", true, 8, { min: 28, pts: 12 }),
    row(2026, "lively", false, 24, { min: 22, pts: 9 }),
    row(2026, "flagg", true, 8, { min: 36, pts: 21 }),
    row(2026, "flagg", false, 24, { min: 35, pts: 19.5 }),
  ];
  const data = toOnOff(rows, [2027, 2026])[`${SUBJECT}|${TEAM}`];
  const table = tableFor(data, { lively: "out", christie: "questionable" }, { christie: ["My League"], flagg: ["My League"] });
  const season = table.seasons.find((s) => s.season === 2026)!;

  it("drops teammates who are out for the same game and tags the rest", () => {
    expect(season.rows.map((r) => [r.playerId, r.status, r.heldOn])).toEqual([
      ["christie", "questionable", ["My League"]],
      ["flagg", null, ["My League"]],
    ]);
  });

  it("names my players with a clear gain only, and only for out or doubtful players", () => {
    expect(myGains(update(), table).map((g) => g.row.playerId)).toEqual(["christie"]);
    expect(myGains(update({ status: "questionable" }), table)).toEqual([]);
    expect(myGains(update({ returning: true, status: "available" }), table)).toEqual([]);
  });
});

describe("hasOnOff", () => {
  it("covers out, doubtful, questionable and returning players on an NBA roster", () => {
    expect(hasOnOff(update())).toBe(true);
    expect(hasOnOff(update({ status: "questionable" }))).toBe(true);
    expect(hasOnOff(update({ status: "probable" }))).toBe(false);
    expect(hasOnOff(update({ status: "available", returning: true }))).toBe(true);
    expect(hasOnOff(update({ reason: "G League - Two-Way" }))).toBe(false);
    expect(hasOnOff(update({ playerId: null }))).toBe(false);
  });
});

describe("change", () => {
  const side = (over: Partial<Side>): Side => ({
    games: 5, starts: 0, min: 20, pts: 10, reb: 4, ast: 2, stl: 1, blk: 0.5, tpm: 1, tov: 2, fga: 8, fta: 2, fgPct: 0.45, ftPct: 0.8, ...over,
  });
  it("marks clear gains and drops, with turnovers inverted", () => {
    expect(change("pts", side({ pts: 14 }), side({}))).toBe("up");
    expect(change("pts", side({ pts: 10.5 }), side({}))).toBeNull();
    expect(change("tov", side({ tov: 3 }), side({}))).toBe("down");
    expect(change("fgPct", side({ fgPct: 0.41 }), side({}))).toBe("down");
    expect(change("blk", side({ blk: 0.4 }), side({ blk: 0 }))).toBe("up");
  });
});
