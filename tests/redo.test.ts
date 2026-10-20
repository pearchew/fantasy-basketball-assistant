import { describe, expect, it } from "vitest";
import { planRedo } from "../src/lib/nextUp/redo";

const group = (key: string, team: string, gameDate = "2026-11-05") => ({ key, team, gameDate });
const answer = (computed_through: string | null, needs_recompute = false) => ({ computed_through, needs_recompute });

describe("planRedo", () => {
  const teamGames = new Map([
    ["DAL", ["2026-11-01", "2026-11-03"]],
    ["BOS", ["2026-11-02"]],
    ["LAL", ["2026-11-03", "2026-11-05"]], // the Nov 5 game is the one the call is for
  ]);

  it("flags answers built before the team's latest game, and only those", () => {
    const plan = planRedo({
      groups: [group("dal", "DAL"), group("bos", "BOS"), group("lal", "LAL"), group("new", "NY")],
      answers: new Map([
        ["dal", answer("2026-11-01")], // DAL played Nov 3 since: out of date
        ["bos", answer("2026-11-02")], // already has BOS's latest game
        ["lal", answer("2026-11-03")], // only a same-day game since: not counted
      ]),
      teamGames,
      used: 0,
      limit: 60,
    });
    expect(plan.staleKeys).toEqual(["dal"]);
    expect(plan.callsPerRun).toBe(1);
  });

  it("treats answers with no recorded box-score date as out of date", () => {
    const plan = planRedo({ groups: [group("bos", "BOS")], answers: new Map([["bos", answer(null)]]), teamGames, used: 0, limit: 60 });
    expect(plan.staleKeys).toEqual(["bos"]);
  });

  it("counts answers already waiting for a batch separately", () => {
    const plan = planRedo({ groups: [group("dal", "DAL")], answers: new Map([["dal", answer("2026-11-01", true)]]), teamGames, used: 0, limit: 60 });
    expect(plan).toMatchObject({ staleKeys: [], pending: 1, callsPerRun: 0 });
  });

  it("works out the runs today's allowance still covers", () => {
    const groups = Array.from({ length: 20 }, (_, i) => group(`g${i}`, "DAL"));
    const answers = new Map(groups.map((g) => [g.key, answer("2026-11-01")]));
    expect(planRedo({ groups, answers, teamGames, used: 0, limit: 60 }).runsLeft).toBe(3);
    expect(planRedo({ groups, answers, teamGames, used: 20, limit: 60 }).runsLeft).toBe(2);
    expect(planRedo({ groups, answers, teamGames, used: 45, limit: 60 }).runsLeft).toBe(0); // 15 left, run needs 20
  });

  it("has nothing to run when everything is up to date", () => {
    const plan = planRedo({ groups: [group("bos", "BOS")], answers: new Map([["bos", answer("2026-11-02")]]), teamGames, used: 0, limit: 60 });
    expect(plan).toMatchObject({ callsPerRun: 0, runsLeft: 0 });
  });
});
