import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInjuryReport, reportUrlFor } from "../src/lib/sources/nbaInjuryReport";

const fixture = new Uint8Array(readFileSync(new URL("./fixtures/Injury-Report_2026-03-15_05_00PM.pdf", import.meta.url)));

describe("parseInjuryReport", () => {
  it("reads every player row and not-submitted team in the report", async () => {
    const r = await parseInjuryReport(fixture);
    expect(r.reportTime).toBe("03/15/26 05:00 PM");
    // Counted by hand from the raw PDF rows.
    expect(r.entries).toHaveLength(142);
    expect(r.notSubmitted).toHaveLength(9);
    expect(r.warnings).toEqual([]);
  });

  it("carries game and team context down to rows where it is blank", async () => {
    const r = await parseInjuryReport(fixture);
    const irving = r.entries.find((e) => e.playerName === "Kyrie Irving")!;
    expect(irving).toMatchObject({
      gameDate: "2026-03-15",
      gameTime: "03:30 (ET)",
      matchup: "DAL@CLE",
      team: "Dallas Mavericks",
      status: "out",
      reason: "Injury/Illness - Left Knee; Surgery",
    });
  });

  it("reassembles reasons that wrap above and below the player row", async () => {
    const r = await parseInjuryReport(fixture);
    expect(r.entries.find((e) => e.playerName === "Thomas Sorber")?.reason).toBe(
      "Injury/Illness - Right ACL; Surgical Recovery",
    );
    expect(r.entries.find((e) => e.playerName === "Jalen Williams")?.reason).toBe(
      "Injury/Illness - Right Hamstring; Strain",
    );
  });

  it("flips names with suffixes and rejoins hyphenated words", async () => {
    const r = await parseInjuryReport(fixture);
    expect(r.entries.find((e) => e.playerRaw === "Lively II, Dereck")?.playerName).toBe("Dereck Lively II");
    expect(r.entries.find((e) => e.playerName === "Moussa Cisse")?.reason).toBe("G League - Two-Way");
    expect(r.entries.find((e) => e.playerName === "Isaiah Hartenstein")?.reason).toBe("");
  });
});

describe("reportUrlFor", () => {
  it("floors to the 15-minute slot in US Eastern time", () => {
    // 21:07 UTC on 15 Mar 2026 is 17:07 EDT.
    expect(reportUrlFor(new Date("2026-03-15T21:07:00Z"))).toBe(
      "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-03-15_05_00PM.pdf",
    );
    // 16:44 UTC on 3 Jan 2027 is 11:44 EST.
    expect(reportUrlFor(new Date("2027-01-03T16:44:00Z"))).toBe(
      "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2027-01-03_11_30AM.pdf",
    );
  });
});
