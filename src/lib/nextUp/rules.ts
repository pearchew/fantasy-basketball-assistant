// Rule-based next-up candidates. Always available; the model only reorders and rewords them.
import type { DepthChart, DepthPlayer, startsWithAndWithout } from "./depth";

export type BeneficiaryType = "starter_replacement" | "bench_minutes" | "starter_usage" | "loses_minutes";

export type Beneficiary = {
  player_id: string;
  name: string;
  position: string;
  type: BeneficiaryType;
  reason: string;
  /** The absent or returning players this call is about. */
  for_ids: string[];
  questionable: boolean;
};

export type Subject = { id: string; name: string; position: string };
export type SatStats = ReturnType<typeof startsWithAndWithout>;

const NEIGHBOURS: Record<string, string[]> = { G: ["F"], F: ["G", "C"], C: ["F"] };
const POSITION_NAME: Record<string, string> = { G: "guard", F: "forward", C: "center" };
const posName = (p: string) => POSITION_NAME[p] ?? "player";
const minutes = (p: DepthPlayer) => `${Math.round(p.mpg)} min a game`;
const byMinutes = (a: DepthPlayer, b: DepthPlayer) => b.mpg - a.mpg;
const samePos = (pos: string) => (p: DepthPlayer) => !!pos && p.position === pos;
const nearPos = (pos: string) => (p: DepthPlayer) => (NEIGHBOURS[pos] ?? []).includes(p.position);

type Candidate = Omit<Beneficiary, "questionable">;

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
  const out: Candidate[] = [];
  const add = (p: DepthPlayer | undefined, type: BeneficiaryType, reason: string) => {
    if (p && !out.some((c) => c.player_id === p.id)) {
      out.push({ player_id: p.id, name: p.name, position: p.position, type, reason, for_ids: [absent.id] });
    }
  };

  if (absent.starter) {
    const fillIn = [...bench].sort((a, b) => (sat.whenSat.get(b.id) ?? 0) - (sat.whenSat.get(a.id) ?? 0) || b.mpg - a.mpg)[0];
    const filled = fillIn && (sat.whenSat.get(fillIn.id) ?? 0) > 0;
    const rep = filled ? fillIn : (bench.filter(samePos(pos)).sort(byMinutes)[0] ?? [...bench].sort(byMinutes)[0]);
    add(
      rep,
      "starter_replacement",
      filled
        ? `Started ${sat.whenSat.get(rep.id)} of the ${sat.missed} recent games ${absent.name} missed.`
        : `Top ${posName(rep?.position ?? pos)} off the bench (${rep ? minutes(rep) : ""}), first in line to start for ${absent.name}.`,
    );
  }
  // Wide on purpose: the rule answer takes the top three, the model chooses from all of these.
  for (const p of bench.filter(samePos(pos)).sort(byMinutes).slice(0, 3)) {
    add(p, "bench_minutes", `Backup ${posName(pos)} (${minutes(p)}) in line for more of ${absent.name}'s minutes.`);
  }
  for (const p of [...starters.filter(samePos(pos)).sort(byMinutes).slice(0, 3), ...starters.filter(nearPos(pos)).sort(byMinutes).slice(0, 2)]) {
    add(p, "starter_usage", `Starting ${posName(p.position)} likely to take on more of ${absent.name}'s shots and touches.`);
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
  const out: Candidate[] = [];
  const add = (p: DepthPlayer, reason: string) => {
    if (!out.some((c) => c.player_id === p.id)) {
      out.push({ player_id: p.id, name: p.name, position: p.position, type: "loses_minutes", reason, for_ids: [back.id] });
    }
  };
  const lift = (p: DepthPlayer) =>
    (sat.whenSat.get(p.id) ?? 0) / Math.max(sat.missed, 1) - (sat.whenPlayed.get(p.id) ?? 0) / Math.max(sat.played, 1);
  for (const p of pool.filter((p) => lift(p) > 0.3).sort((a, b) => lift(b) - lift(a)).slice(0, 2)) {
    add(p, `Started ${sat.whenSat.get(p.id)} of the ${sat.missed} games ${back.name} missed; likely back to the bench.`);
  }
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
  const empty: SatStats = { missed: 0, played: 0, whenSat: new Map(), whenPlayed: new Map() };

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
      if (TYPE_STRENGTH.indexOf(c.type) < TYPE_STRENGTH.indexOf(prev.type)) Object.assign(prev, { type: c.type, reason: c.reason });
    }
  }
  return { beneficiaries: [...merged.values()], candidates };
}
