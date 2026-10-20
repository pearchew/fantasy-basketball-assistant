// The model reorders and explains the rule candidates. It can never add a player.
import { nameKey } from "../names";
import { chatJson, type LlmConfig } from "../sources/llm";
import type { DepthChart } from "./depth";
import type { Beneficiary, BeneficiaryType, Subject } from "./rules";

type Candidate = Omit<Beneficiary, "questionable">;

const SYSTEM = `You are an NBA analyst helping a fantasy basketball manager decide who to start or pick up.
For one team's game you get its depth chart (from recent box scores), who is out or doubtful, who is returning, and a candidate list for each of those players.
For each OUT player, choose 2 or 3 players who gain (1 only if there is a single candidate), only from that player's candidates, best first.
Each candidate comes with a rule note. A note saying the player started games this player missed is direct evidence: keep that player unless he is clearly unavailable.
Some candidates also have a with/without split: his per-game change in minutes, shots (FGA), usage (FGA + 0.44 FTA + TOV) and points in the team's recent games this player missed, against the games he played (3+ games each side). Treat a clear rise as strong evidence and a clear fall as evidence against; prefer measured gains over position alone. Mention the numbers in the reason when you rely on them.
For each RETURNING player, choose 0 to 2 players who lose minutes, only from that player's candidates.
Types: "starter_replacement" (moves into the starting lineup), "bench_minutes" (more minutes off the bench), "starter_usage" (an existing starter takes on more shots and touches), "loses_minutes" (only for returning players).
Use what you know about roles and positions, but the depth chart decides who is on the team.
Each reason is one specific sentence under 25 words.
Reply with JSON only: {"calls":[{"for":"<out or returning player's name>","name":"<candidate name>","type":"<type>","reason":"<sentence>"}]}`;

const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}`;
const splitText = (s: NonNullable<Candidate["split"]>) =>
  `${signed(s.min)} min, ${signed(s.fga)} FGA, ${signed(s.usage)} usage, ${signed(s.pts)} pts per game`;

export function buildPrompt(input: {
  depth: DepthChart;
  gameLabel: string;
  absent: (Subject & { status: string })[];
  returning: Subject[];
  candidates: Map<string, Candidate[]>;
  questionable: Set<string>;
}): string {
  const rotation = input.depth.players
    .filter((p) => p.mpg > 0)
    .map((p) => `${p.starter ? "starter" : "bench  "} ${p.position || "?"} ${p.name}: ${p.mpg.toFixed(1)} min, started ${p.starts} of ${p.gp}${p.newArrival ? " (new to team; stats from previous team)" : ""}${input.questionable.has(p.id) ? " [questionable]" : ""}`)
    .join("\n");
  const list = (s: Subject) =>
    (input.candidates.get(s.id) ?? [])
      .map((c) => `\n    - ${c.name} [${c.type}] ${c.reason}${c.split ? ` {split, ${c.split.games} games without: ${splitText(c.split)}}` : ""}`)
      .join("") || " (none)";
  return [
    `Team: ${input.depth.team}. Game: ${input.gameLabel}.`,
    `Depth chart, last ${input.depth.window.length} games:\n${rotation}`,
    input.absent.length ? `OUT:\n${input.absent.map((a) => `- ${a.name} (${a.status}). Candidates:${list(a)}`).join("\n")}` : "",
    input.returning.length ? `RETURNING:\n${input.returning.map((r) => `- ${r.name}. Candidates:${list(r)}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const TYPES: BeneficiaryType[] = ["starter_replacement", "bench_minutes", "starter_usage", "loses_minutes"];
const STRENGTH: BeneficiaryType[] = ["starter_replacement", "starter_usage", "bench_minutes", "loses_minutes"];

/** First sentence, without splitting initials or suffixes ("P.J.", "Jr."): a break needs two lowercase letters before it. */
export function oneSentence(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.split(/(?<=[a-z]{2}[.!?])\s+(?=[A-Z])/)[0].slice(0, 220);
}

type ModelCall = { for?: unknown; name?: unknown; type?: unknown; reason?: unknown };

/**
 * Keeps only calls naming a listed candidate for a listed subject. Any absent
 * player left without a valid call gets the rule answer for that player.
 */
export function validateModelCalls(input: {
  calls: ModelCall[];
  absent: Subject[];
  returning: Subject[];
  candidates: Map<string, Candidate[]>;
  rulePicks: Beneficiary[];
  questionable: Set<string>;
}): { beneficiaries: Beneficiary[]; rejected: string[] } {
  const subjects = [...input.absent.map((s) => ({ ...s, returning: false })), ...input.returning.map((s) => ({ ...s, returning: true }))];
  const subjectByKey = new Map(subjects.map((s) => [nameKey(s.name), s]));
  const rejected: string[] = [];
  const perSubject = new Map<string, Beneficiary[]>();

  for (const call of Array.isArray(input.calls) ? input.calls : []) {
    const subject = subjectByKey.get(nameKey(String(call.for ?? "")));
    const candidate = subject && input.candidates.get(subject.id)?.find((c) => nameKey(c.name) === nameKey(String(call.name ?? "")));
    if (!subject || !candidate) {
      rejected.push(`${String(call.name)} for ${String(call.for)}`);
      continue;
    }
    let type = TYPES.includes(call.type as BeneficiaryType) ? (call.type as BeneficiaryType) : candidate.type;
    if (subject.returning !== (type === "loses_minutes")) type = candidate.type;
    const list = perSubject.get(subject.id) ?? [];
    if (list.length >= (subject.returning ? 2 : 3) || list.some((b) => b.player_id === candidate.player_id)) continue;
    list.push({
      ...candidate,
      type,
      reason: oneSentence(String(call.reason ?? "")) || candidate.reason,
      for_ids: [subject.id],
      questionable: input.questionable.has(candidate.player_id),
    });
    perSubject.set(subject.id, list);
  }

  for (const a of input.absent) {
    if (!perSubject.get(a.id)?.length) {
      perSubject.set(a.id, input.rulePicks.filter((b) => b.for_ids.includes(a.id)).map((b) => ({ ...b, for_ids: [a.id] })));
    }
  }

  const merged = new Map<string, Beneficiary>();
  for (const list of perSubject.values()) {
    for (const b of list) {
      const prev = merged.get(b.player_id);
      if (!prev) merged.set(b.player_id, { ...b });
      else {
        prev.for_ids = [...new Set([...prev.for_ids, ...b.for_ids])];
        if (STRENGTH.indexOf(b.type) < STRENGTH.indexOf(prev.type)) Object.assign(prev, { type: b.type, reason: b.reason });
      }
    }
  }
  return { beneficiaries: [...merged.values()], rejected };
}

/** One retry when the reply isn't valid JSON; other errors (rate limits, outages) go to the caller. */
export async function askModel(config: LlmConfig, prompt: string): Promise<ModelCall[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await chatJson<{ calls?: ModelCall[] }>(config, SYSTEM, prompt);
      return out.calls ?? [];
    } catch (e) {
      if (!(e instanceof SyntaxError) || attempt >= 2) throw e;
    }
  }
}
