// Rule-based next-up candidates. Always available; the model only reorders and rewords them.
import { isReliable, type DepthChart, type DepthPlayer, type Split, type startsWithAndWithout } from "./depth";

export type BeneficiaryType = "starter_replacement" | "bench_minutes" | "starter_usage" | "loses_minutes";

/** Per-game change in the games the absent player missed (or, for a returner, while he was out). */
export type SplitSummary = { vs: string; games: number; min: number; fga: number; usage: number; pts: number };

export type Beneficiary = {
  player_id: string;
  name: string;
  position: string;
  type: BeneficiaryType;
  reason: string;
  /** The absent or returning players this call is about. */
  for_ids: string[];
  questionable: boolean;
  /** With/without evidence, when there are enough games on both sides. */
  split?: SplitSummary;
};

export type Subject = { id: string; name: string; position: string };
export type SatStats = ReturnType<typeof startsWithAndWithout>;

/** A clear jump while the player sat: enough to name someone whatever his position. */
export const JUMP_MIN = 4;
export const JUMP_USAGE = 2.5;

const NEIGHBOURS: Record<string, string[]> = { G: ["F"], F: ["G", "C"], C: ["F"] };
const POSITION_NAME: Record<string, string> = { G: "guard", F: "forward", C: "center" };
const posName = (p: string) => POSITION_NAME[p] ?? "player";
const minutes = (p: DepthPlayer) => `${Math.round(p.mpg)} min a game`;
const byMinutes = (a: DepthPlayer, b: DepthPlayer) => b.mpg - a.mpg;
const samePos = (pos: string) => (p: DepthPlayer) => !!pos && p.position === pos;
const nearPos = (pos: string) => (p: DepthPlayer) => (NEIGHBOURS[pos] ?? []).includes(p.position);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

type Candidate = Omit<Beneficiary, "questionable">;

/** `vs`: the absent or returning player the split is about. */
function summary(s: Split, vs: string): SplitSummary {
  const r = (n: number) => Math.round(n * 10) / 10;
  return { vs, games: s.gamesWithout, min: r(s.min), fga: r(s.fga), usage: r(s.usage), pts: r(s.pts) };
}

/** "+6.1 min, +4.2 shots and +5.0 pts a game in the 5 recent games Flagg missed" */
function evidence(s: Split, who: string, verb = "missed"): string {
  return `${signed(s.min)} min, ${signed(s.fga)} shots and ${signed(s.pts)} pts a game in the ${s.gamesWithout} recent games ${who} ${verb}`;
}

function find(depth: DepthChart, s: Subject): DepthPlayer {
  return (
    depth.players.find((p) => p.id === s.id) ?? {
      id: s.id, name: s.name, position: s.position, gp: 0, starts: 0, mpg: 0, starter: false, newArrival: false,
    }
  );
}

/** Ordered candidates for one absent player, best first, at most one entry per player. */
export function candidatesForAbsent(subject: Subject, depth: DepthChart, excluded: Set<string>, sat: SatStats): Candidate[] {
  const absent = find(depth, subject);
  const pos = absent.position;
  const pool = depth.players.filter((p) => p.id !== absent.id && !excluded.has(p.id) && p.mpg > 0);
  const bench = pool.filter((p) => !p.starter);
  const starters = pool.filter((p) => p.starter);
  const split = (p: DepthPlayer) => sat.splits.get(p.id);
  const reliable = (p: DepthPlayer) => (isReliable(split(p)) ? split(p) : undefined);
  // Measured gains first (when there are enough games), then normal minutes.
  const byGain = (key: "min" | "usage") => (a: DepthPlayer, b: DepthPlayer) =>
    (reliable(b)?.[key] ?? 0) - (reliable(a)?.[key] ?? 0) || b.mpg - a.mpg;

  const out: Candidate[] = [];
  const add = (p: DepthPlayer | undefined, type: BeneficiaryType, reason: string) => {
    if (!p || out.some((c) => c.player_id === p.id)) return;
    const s = reliable(p);
    out.push({ player_id: p.id, name: p.name, position: p.position, type, reason, for_ids: [absent.id], ...(s ? { split: summary(s, absent.id) } : {}) });
  };

  if (absent.starter) {
    const fillIn = [...bench].sort((a, b) => (sat.whenSat.get(b.id) ?? 0) - (sat.whenSat.get(a.id) ?? 0) || byGain("min")(a, b))[0];
    const filled = fillIn && (sat.whenSat.get(fillIn.id) ?? 0) > 0;
    const rep = filled ? fillIn : (bench.filter(samePos(pos)).sort(byGain("min"))[0] ?? [...bench].sort(byGain("min"))[0]);
    const s = rep && reliable(rep);
    add(
      rep,
      "starter_replacement",
      filled
        ? `Started ${sat.whenSat.get(rep.id)} of the ${sat.missed} recent games ${absent.name} missed${s ? ` (${signed(s.min)} min, ${signed(s.fga)} shots a game)` : ""}.`
        : s
          ? `Top ${posName(rep.position)} off the bench and first in line to start: ${evidence(s, absent.name)}.`
          : `Top ${posName(rep?.position ?? pos)} off the bench (${rep ? minutes(rep) : ""}), first in line to start for ${absent.name}.`,
    );
  }
  // Wide on purpose: the rule answer takes the top three, the model chooses from all of these.
  for (const p of bench.filter(samePos(pos)).sort(byGain("min")).slice(0, 3)) {
    const s = reliable(p);
    add(p, "bench_minutes", s ? `Backup ${posName(pos)}: ${evidence(s, absent.name)}.` : `Backup ${posName(pos)} (${minutes(p)}) in line for more of ${absent.name}'s minutes.`);
  }
  // Same position first, then neighbours; a measured usage gain moves a player up (sort is stable).
  const usageCandidates = [...starters.filter(samePos(pos)).sort(byGain("usage")).slice(0, 3), ...starters.filter(nearPos(pos)).sort(byGain("usage")).slice(0, 2)]
    .sort((a, b) => (reliable(b)?.usage ?? 0) - (reliable(a)?.usage ?? 0));
  for (const p of usageCandidates) {
    const s = reliable(p);
    add(
      p,
      "starter_usage",
      s ? `Starting ${posName(p.position)}: ${evidence(s, absent.name)}.` : `Starting ${posName(p.position)} likely to take on more of ${absent.name}'s shots and touches.`,
    );
  }
  // Clear jumps at any position: the box scores say they gained, whatever the depth chart says.
  const jumped = pool
    .filter((p) => {
      const s = reliable(p);
      return s && (s.min >= JUMP_MIN || s.usage >= JUMP_USAGE) && !out.some((c) => c.player_id === p.id);
    })
    .sort(byGain("usage"))
    .slice(0, 2);
  for (const p of jumped) {
    add(p, p.starter ? "starter_usage" : "bench_minutes", `${p.starter ? "Starter" : "Reserve"} who stepped up: ${evidence(reliable(p)!, absent.name)}.`);
  }
  // Nobody at or near the position: fall back to the busiest bench player.
  if (!out.length) {
    const p = [...bench].sort(byMinutes)[0] ?? [...starters].sort(byMinutes)[0];
    add(p, p?.starter ? "starter_usage" : "bench_minutes", `Most-used ${p?.starter ? "starter" : "reserve"} available (${p ? minutes(p) : ""}) with ${absent.name} out.`);
  }
  return out;
}

/** Players likely to lose minutes when `subject` returns: who started or played up while he sat. */
export function candidatesForReturner(subject: Subject, depth: DepthChart, excluded: Set<string>, sat: SatStats): Candidate[] {
  const back = find(depth, subject);
  const pool = depth.players.filter((p) => p.id !== back.id && !excluded.has(p.id) && p.mpg > 0);
  const reliable = (p: DepthPlayer) => {
    const s = sat.splits.get(p.id);
    return isReliable(s) ? s : undefined;
  };
  const out: Candidate[] = [];
  const add = (p: DepthPlayer, reason: string) => {
    if (out.some((c) => c.player_id === p.id)) return;
    const s = reliable(p);
    out.push({ player_id: p.id, name: p.name, position: p.position, type: "loses_minutes", reason, for_ids: [back.id], ...(s ? { split: summary(s, back.id) } : {}) });
  };
  const lift = (p: DepthPlayer) =>
    (sat.whenSat.get(p.id) ?? 0) / Math.max(sat.missed, 1) - (sat.whenPlayed.get(p.id) ?? 0) / Math.max(sat.played, 1);
  for (const p of pool.filter((p) => lift(p) > 0.3).sort((a, b) => lift(b) - lift(a)).slice(0, 2)) {
    add(p, `Started ${sat.whenSat.get(p.id)} of the ${sat.missed} games ${back.name} missed; likely back to the bench.`);
  }
  const rose = pool
    .filter((p) => {
      const s = reliable(p);
      return s && (s.min >= JUMP_MIN || s.usage >= JUMP_USAGE) && !out.some((c) => c.player_id === p.id);
    })
    .sort((a, b) => reliable(b)!.min - reliable(a)!.min)
    .slice(0, 2);
  for (const p of rose) add(p, `Played ${evidence(reliable(p)!, back.name, "missed")}; that shrinks with him back.`);
  for (const p of pool.filter((p) => !p.starter).filter(samePos(back.position)).sort(byMinutes).slice(0, 2)) {
    add(p, `Backup ${posName(back.position)} (${minutes(p)}) whose minutes shrink with ${back.name} back.`);
  }
  return out;
}

const TYPE_STRENGTH: BeneficiaryType[] = ["starter_replacement", "starter_usage", "bench_minutes", "loses_minutes"];

/** The rule answer for a team's game: up to three calls per subject, merged across subjects. */
export function ruleBeneficiaries(input: {
  absent: Subject[];
  returning: Subject[];
  depth: DepthChart;
  sat: Map<string, SatStats>;
  /** Out or doubtful for this game: never named. */
  unavailable: Set<string>;
  questionable: Set<string>;
}): { beneficiaries: Beneficiary[]; candidates: Map<string, Candidate[]> } {
  const excluded = new Set([...input.unavailable, ...input.returning.map((r) => r.id)]);
  const candidates = new Map<string, Candidate[]>();
  const empty: SatStats = { missed: 0, played: 0, whenSat: new Map(), whenPlayed: new Map(), splits: new Map() };

  for (const a of input.absent) candidates.set(a.id, candidatesForAbsent(a, input.depth, excluded, input.sat.get(a.id) ?? empty));
  for (const r of input.returning) {
    candidates.set(r.id, candidatesForReturner(r, input.depth, new Set(input.unavailable), input.sat.get(r.id) ?? empty));
  }

  const merged = new Map<string, Beneficiary>();
  for (const [, list] of candidates) {
    // One of each type first, then fill to three.
    const picks: Candidate[] = [];
    for (const t of TYPE_STRENGTH) {
      const c = list.find((x) => x.type === t);
      if (c) picks.push(c);
    }
    for (const c of list) if (picks.length < 3 && !picks.includes(c)) picks.push(c);
    for (const c of picks.slice(0, 3)) {
      const prev = merged.get(c.player_id);
      if (!prev) {
        merged.set(c.player_id, { ...c, for_ids: [...c.for_ids], questionable: input.questionable.has(c.player_id) });
        continue;
      }
      prev.for_ids = [...new Set([...prev.for_ids, ...c.for_ids])];
      if (TYPE_STRENGTH.indexOf(c.type) < TYPE_STRENGTH.indexOf(prev.type)) {
        Object.assign(prev, { type: c.type, reason: c.reason, split: c.split });
      }
    }
  }
  return { beneficiaries: [...merged.values()], candidates };
}
