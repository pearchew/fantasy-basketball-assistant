import { describe, expect, it } from "vitest";
import { buildFeed, isStale, type FeedUpdate } from "../src/lib/feed";
import {
  indexDirectory,
  matchPlayer,
  planInjuryUpserts,
  type ExistingUpdate,
  type UpdateRow,
} from "../src/lib/injuryIngest";
import type { InjuryEntry } from "../src/lib/sources/nbaInjuryReport";
import { when } from "../src/lib/format";
import { timeZoneFrom } from "../src/lib/timezone";
import { addDays, easternDate, easternToUtc, gameStartUtc, parseReportTime } from "../src/lib/time";

describe("time", () => {
  it("converts Eastern wall-clock times across daylight saving", () => {
    expect(easternToUtc("2026-03-15", 17, 0).toISOString()).toBe("2026-03-15T21:00:00.000Z"); // EDT
    expect(easternToUtc("2026-12-01", 19, 30).toISOString()).toBe("2026-12-02T00:30:00.000Z"); // EST
  });

  it("parses the report header time", () => {
    expect(parseReportTime("03/15/26 05:00 PM")?.toISOString()).toBe("2026-03-15T21:00:00.000Z");
    expect(parseReportTime("01/03/27 12:15 AM")?.toISOString()).toBe("2027-01-03T05:15:00.000Z");
    expect(parseReportTime("not a time")).toBeNull();
  });

  it("gives the Eastern calendar date, which lags UTC late at night", () => {
    expect(easternDate(new Date("2026-11-02T03:30:00Z"))).toBe("2026-11-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

const directory = indexDirectory([
  { espn_id: "1", name_key: "kyrie irving", team_abbr: "DAL" },
  { espn_id: "2", name_key: "dereck lively", team_abbr: "DAL" },
  { espn_id: "3", name_key: "jalen williams", team_abbr: "OKC" },
  { espn_id: "4", name_key: "jalen williams", team_abbr: "DEN" }, // hypothetical namesake
  { espn_id: "5", name_key: "luka doncic", team_abbr: "LAL" },
]);

describe("matchPlayer", () => {
  it("matches across suffixes and accents, preferring the same team", () => {
    expect(matchPlayer("Dereck Lively II", "DAL", directory)).toBe("2");
    expect(matchPlayer("Luka Dončić", "LAL", directory)).toBe("5");
    expect(matchPlayer("Jalen Williams", "OKC", directory)).toBe("3");
  });

  it("follows a unique name to a new team, but leaves ambiguous names unmatched", () => {
    expect(matchPlayer("Kyrie Irving", "BKN", directory)).toBe("1");
    expect(matchPlayer("Jalen Williams", "MIA", directory)).toBeNull();
    expect(matchPlayer("Nobody Known", "DAL", directory)).toBeNull();
  });
});

function entry(over: Partial<InjuryEntry>): InjuryEntry {
  return {
    gameDate: "2026-11-02",
    gameTime: "07:30 (ET)",
    matchup: "DAL@CLE",
    team: "Dallas Mavericks",
    playerRaw: "Irving, Kyrie",
    playerName: "Kyrie Irving",
    status: "questionable",
    reason: "Injury/Illness - Left Knee; Soreness",
    rawText: "Irving, Kyrie Questionable Injury/Illness - Left Knee; Soreness",
    ...over,
  };
}

const teamAbbrByName = new Map([["Dallas Mavericks", "DAL"]]);
const plan = (entries: InjuryEntry[], reportTime: string, existing: UpdateRow[] = [], prior: UpdateRow[] = []) =>
  planInjuryUpserts({
    entries,
    reportTime: new Date(reportTime),
    teamAbbrByName,
    directory,
    existing: new Map(existing.map((r) => [r.update_key, r as ExistingUpdate])),
    prior: prior.map((r) => ({ player_id: r.player_id!, game_date: r.game_date, status: r.status, reason: r.reason })),
  });

describe("planInjuryUpserts", () => {
  const first = plan([entry({})], "2026-11-02T17:00:00Z");

  it("inserts a new (player, game) with one history item", () => {
    expect(first.changed).toBe(1);
    expect(first.rows[0]).toMatchObject({
      update_key: "2026-11-02|DAL|1",
      player_id: "1",
      status: "questionable",
      first_seen_at: "2026-11-02T17:00:00.000Z",
      changed_at: "2026-11-02T17:00:00.000Z",
      ongoing: false,
    });
    expect(first.rows[0].history).toHaveLength(1);
  });

  it("appends history when the status changes and keeps the first-seen time", () => {
    const later = plan([entry({ status: "out" })], "2026-11-02T21:00:00Z", first.rows);
    expect(later.changed).toBe(1);
    expect(later.rows[0].history.map((h) => h.status)).toEqual(["questionable", "out"]);
    expect(later.rows[0].first_seen_at).toBe("2026-11-02T17:00:00.000Z");
    expect(later.rows[0].changed_at).toBe("2026-11-02T21:00:00.000Z");
  });

  it("does not count a repeat as a change", () => {
    const repeat = plan([entry({})], "2026-11-02T18:00:00Z", first.rows);
    expect(repeat.changed).toBe(0);
    expect(repeat.rows[0].changed_at).toBe("2026-11-02T17:00:00.000Z");
    expect(repeat.rows[0].report_time).toBe("2026-11-02T18:00:00.000Z");
  });

  it("ignores a report older than what is stored", () => {
    const stored = { ...first.rows[0], report_time: "2026-11-02T20:00:00+00:00" };
    expect(plan([entry({ status: "out" })], "2026-11-02T19:00:00Z", [stored]).rows).toEqual([]);
  });

  it("marks a repeat absence from the previous game as ongoing", () => {
    const yesterday = plan([entry({ gameDate: "2026-11-01", status: "out", reason: "Left Knee; Surgery" })], "2026-11-01T17:00:00Z");
    const today = plan([entry({ status: "out", reason: "Left Knee; Surgery" })], "2026-11-02T17:00:00Z", [], yesterday.rows);
    expect(today.rows[0].ongoing).toBe(true);
    const different = plan([entry({ status: "doubtful" })], "2026-11-02T17:00:00Z", [], yesterday.rows);
    expect(different.rows[0].ongoing).toBe(false);
  });

  it("chains games within one report and keys unmatched names separately", () => {
    const r = plan(
      [
        entry({ gameDate: "2026-11-03", status: "out", reason: "Surgery" }),
        entry({ gameDate: "2026-11-02", status: "out", reason: "Surgery" }),
        entry({ playerName: "Mystery Man", playerRaw: "Man, Mystery" }),
      ],
      "2026-11-02T17:00:00Z",
    );
    const byKey = Object.fromEntries(r.rows.map((x) => [x.update_key, x]));
    expect(byKey["2026-11-02|DAL|1"].ongoing).toBe(false);
    expect(byKey["2026-11-03|DAL|1"].ongoing).toBe(true);
    expect(byKey["2026-11-02|DAL|unmatched:mystery man"].player_id).toBeNull();
    expect(r.unmatched).toEqual(["Mystery Man (Dallas Mavericks)"]);
  });
});

function update(over: Partial<FeedUpdate>): FeedUpdate {
  return {
    id: Math.floor(Math.random() * 1e9),
    gameDate: "2026-11-02",
    gameTime: "07:30 (ET)",
    matchup: "DAL@CLE",
    teamName: "Dallas Mavericks",
    teamAbbr: "DAL",
    playerId: "1",
    playerName: "Kyrie Irving",
    status: "out",
    reason: "Injury/Illness - Knee",
    rawText: "",
    reportTime: "2026-11-02T17:00:00Z",
    changedAt: "2026-11-02T17:00:00Z",
    ongoing: false,
    returning: false,
    history: [{ status: "out", reason: "", report_time: "" }],
    heldOn: [],
    nextUp: null,
    ...over,
  };
}

describe("buildFeed", () => {
  const feed = buildFeed([
    update({ id: 10, playerName: "Late Home", matchup: "LAL@GSW", gameTime: "10:00 (ET)", teamName: "Golden State Warriors", teamAbbr: "GS" }),
    update({ id: 9, playerName: "Late Away", matchup: "LAL@GSW", gameTime: "10:00 (ET)", teamName: "Los Angeles Lakers", teamAbbr: "LAL" }),
    update({ id: 1, playerName: "Early Questionable", status: "questionable", heldOn: ["CP"] }),
    update({ id: 2, playerName: "Early Out", heldOn: ["CP", "Watchlist"] }),
    update({ id: 3, playerName: "Two Way", reason: "G League - Two-Way" }),
    update({ id: 4, playerName: "Who", playerId: null }),
    update({ id: 5, playerName: "Noon Game", matchup: "NYK@BOS", gameTime: "12:00 (ET)", teamName: "New York Knicks", teamAbbr: "NY" }),
    update({ id: 6, playerName: "Tomorrow", gameDate: "2026-11-03", gameTime: "01:00 (ET)" }),
  ]);
  const names = (list: FeedUpdate[]) => list.map((u) => u.playerName);

  it("orders games by tip-off: noon, then 7:30 PM, then 10 PM, then the next day", () => {
    expect(feed.games.map((g) => g.matchup + " " + g.gameDate)).toEqual([
      "NYK@BOS 2026-11-02",
      "DAL@CLE 2026-11-02",
      "LAL@GSW 2026-11-02",
      "DAL@CLE 2026-11-03",
    ]);
    expect(feed.games[0].start).toBe("2026-11-02T17:00:00.000Z"); // noon EST
    expect(feed.games[2].start).toBe("2026-11-03T03:00:00.000Z"); // 10 PM EST
  });

  it("lists the away team first and, within a team, worst status first with G League last", () => {
    expect(feed.games[2].teams.map((t) => t.name)).toEqual(["Los Angeles Lakers", "Golden State Warriors"]);
    expect(names(feed.games[1].teams[0].updates)).toEqual(["Early Out", "Who", "Early Questionable", "Two Way"]);
  });

  it("counts statuses (ignoring G League) and my players per game", () => {
    expect(feed.games[1].counts).toEqual({ out: 2, questionable: 1 });
    expect(feed.games[1].mine).toBe(2);
  });

  it("still pins my players, worst status first, and lists unmatched names for review", () => {
    expect(names(feed.mine)).toEqual(["Early Out", "Early Questionable"]);
    expect(names(feed.unmatched)).toEqual(["Who"]);
  });
});

describe("time zones", () => {
  it("reads the report's 12-hour tip-off times as afternoon or evening Eastern", () => {
    expect(gameStartUtc("2026-03-15", "01:00 (ET)")?.toISOString()).toBe("2026-03-15T17:00:00.000Z");
    expect(gameStartUtc("2026-12-25", "12:00 (ET)")?.toISOString()).toBe("2026-12-25T17:00:00.000Z");
    expect(gameStartUtc("2026-11-02", "10:30 (ET)")?.toISOString()).toBe("2026-11-03T03:30:00.000Z");
    expect(gameStartUtc("2026-11-02", "TBD")).toBeNull();
  });

  it("formats a tip-off in the viewer's zone, including the date rolling over", () => {
    const tip = "2026-11-03T00:30:00.000Z"; // 7:30 PM EST on Nov 2
    const now = new Date("2026-11-02T15:00:00Z");
    expect(when(tip, "America/New_York", now)).toBe("Today 7:30 PM EST");
    expect(when(tip, "Europe/London", now)).toBe("Tomorrow 12:30 AM GMT");
    expect(when(tip, "America/Los_Angeles", now)).toBe("Today 4:30 PM PST");
  });

  it("validates the time zone cookie and falls back to Eastern", () => {
    const jar = (v?: string, manual?: string) => ({
      get: (n: string) => (n === "tz" && v ? { value: v } : n === "tz_manual" && manual ? { value: manual } : undefined),
    });
    expect(timeZoneFrom(jar("Europe%2FLondon"))).toEqual({ tz: "Europe/London", manual: false, known: true });
    expect(timeZoneFrom(jar("Not/AZone", "1"))).toEqual({ tz: "America/New_York", manual: true, known: false });
    expect(timeZoneFrom(jar())).toEqual({ tz: "America/New_York", manual: false, known: false });
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-02T17:00:00Z");
  const state = (lastAttemptAt: string | null) => ({ lastAttemptAt, lastSuccessAt: null, lastReportTime: null, lastError: null });
  it("is stale after 10 minutes or when never refreshed", () => {
    expect(isStale(state(null), now)).toBe(true);
    expect(isStale(state("2026-11-02T16:49:00Z"), now)).toBe(true);
    expect(isStale(state("2026-11-02T16:55:00Z"), now)).toBe(false);
  });
});
