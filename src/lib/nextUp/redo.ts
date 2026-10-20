// Manual "update next-up calls": redo answers built before their team's latest box score,
// within a daily Gemini allowance, in batches the free tier's per-minute limit allows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, easternDate } from "../time";
import { loadAnswers, loadGroups, updateNextUp, type Group, type StoredAnswer } from "./store";

export const REDO_PURPOSE = "next_up_redo";
/** Gemini calls a batch may make: under the free tier's ~8-10 a minute. */
export const BATCH_CALLS = 8;
/** Gap between batches, so each lands in a fresh rate-limit minute. */
export const BATCH_GAP_MS = 60_000;

/** Gemini calls per day reserved for manual updates (the automatic flow has its own share). */
export function redoDailyLimit(): number {
  const n = Number(process.env.NEXT_UP_REDO_DAILY_CALLS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

export type RedoStatus = {
  /** Answers built before their team's latest game: one Gemini call each to redo. */
  stale: number;
  /** Answers already flagged and waiting for their batch. */
  pending: number;
  /** Cost of one run, in Gemini calls (= stale answers). */
  callsPerRun: number;
  limit: number;
  used: number;
  /** Full runs today's remaining allowance covers at the current cost. */
  runsLeft: number;
  /** When the next batch may start (pending work only). */
  nextBatchAt: string | null;
};

/**
 * Which answers are out of date, and what a run would cost. An answer is out of date when
 * its team has a finished game after the box scores it used (and before the game it's for).
 */
export function planRedo(input: {
  groups: Pick<Group, "key" | "team" | "gameDate">[];
  answers: Map<string, Pick<StoredAnswer, "computed_through" | "needs_recompute">>;
  /** Finished games per team (ESPN abbreviation -> game dates). */
  teamGames: Map<string, string[]>;
  used: number;
  limit: number;
}): { staleKeys: string[]; pending: number; callsPerRun: number; runsLeft: number } {
  const staleKeys: string[] = [];
  let pending = 0;
  for (const g of input.groups) {
    const a = input.answers.get(g.key);
    if (!a) continue; // never computed: the automatic flow handles it
    if (a.needs_recompute) {
      pending++;
      continue;
    }
    const latest = (input.teamGames.get(g.team) ?? []).filter((d) => d < g.gameDate).sort().at(-1);
    if (latest && (!a.computed_through || latest > a.computed_through)) staleKeys.push(g.key);
  }
  const callsPerRun = staleKeys.length;
  const remaining = Math.max(0, input.limit - input.used);
  return { staleKeys, pending, callsPerRun, runsLeft: callsPerRun ? Math.floor(remaining / callsPerRun) : 0 };
}

async function finishedGamesByTeam(db: SupabaseClient, since: string): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from("games")
    .select("game_date, home_abbr, away_abbr")
    .eq("status", "STATUS_FINAL")
    .neq("season_type", 1)
    .gte("game_date", since);
  if (error) throw error;
  const out = new Map<string, string[]>();
  for (const g of data ?? []) {
    for (const team of [g.home_abbr, g.away_abbr]) out.set(team, [...(out.get(team) ?? []), g.game_date]);
  }
  return out;
}

async function budgetRow(db: SupabaseClient, day: string) {
  const { data, error } = await db
    .from("model_budget")
    .select("calls_used, last_batch_at")
    .eq("day", day)
    .eq("purpose", REDO_PURPOSE)
    .maybeSingle();
  if (error) throw error;
  return { used: data?.calls_used ?? 0, lastBatchAt: (data?.last_batch_at as string | null) ?? null };
}

async function snapshot(db: SupabaseClient, now: Date) {
  const today = easternDate(now);
  const groups = await loadGroups(db, today);
  const [answers, teamGames, budget] = await Promise.all([
    loadAnswers(db, groups),
    finishedGamesByTeam(db, addDays(today, -30)),
    budgetRow(db, today),
  ]);
  const limit = redoDailyLimit();
  return { today, groups, budget, limit, plan: planRedo({ groups, answers, teamGames, used: budget.used, limit }) };
}

function toStatus(s: Awaited<ReturnType<typeof snapshot>>): RedoStatus {
  const next = s.plan.pending && s.budget.lastBatchAt ? new Date(new Date(s.budget.lastBatchAt).getTime() + BATCH_GAP_MS) : null;
  return {
    stale: s.plan.staleKeys.length,
    pending: s.plan.pending,
    callsPerRun: s.plan.callsPerRun,
    limit: s.limit,
    used: s.budget.used,
    runsLeft: s.plan.runsLeft,
    nextBatchAt: next?.toISOString() ?? null,
  };
}

/** For the feed: what an update would cost and how many are left today. Never throws. */
export async function redoStatus(db: SupabaseClient, now = new Date()): Promise<RedoStatus | null> {
  try {
    return toStatus(await snapshot(db, now));
  } catch {
    return null;
  }
}

async function runBatch(admin: SupabaseClient, today: string, now: Date) {
  await admin.from("model_budget").update({ last_batch_at: now.toISOString() }).eq("day", today).eq("purpose", REDO_PURPOSE);
  return updateNextUp(admin, today, { modelBudget: BATCH_CALLS });
}

export type RedoResult = { status: RedoStatus; message: string; batch?: Awaited<ReturnType<typeof updateNextUp>> };

/**
 * `start`: reserves the run's calls (refused if they don't fit today's allowance), flags the
 * out-of-date answers and runs the first batch. `continue`: runs the next batch once a minute
 * has passed. Calls are only reserved at start.
 */
export async function redo(admin: SupabaseClient, action: "start" | "continue", now = new Date()): Promise<RedoResult> {
  let s = await snapshot(admin, now);

  if (action === "start") {
    if (s.plan.pending) return { status: toStatus(s), message: "An update is already running." };
    const cost = s.plan.callsPerRun;
    if (!cost) return { status: toStatus(s), message: "Next-up calls are already up to date." };
    const { data: total, error } = await admin.rpc("reserve_model_calls", {
      p_day: s.today,
      p_purpose: REDO_PURPOSE,
      p_calls: cost,
      p_limit: s.limit,
    });
    if (error) throw error;
    if (total === null) {
      return { status: toStatus(s), message: `Not enough of today's ${s.limit} Gemini calls left for ${cost} more.` };
    }
    for (let i = 0; i < s.plan.staleKeys.length; i += 50) {
      const { error: e } = await admin
        .from("next_up")
        .update({ needs_recompute: true, model_attempts: 0 })
        .in("group_key", s.plan.staleKeys.slice(i, i + 50));
      if (e) throw e;
    }
  } else {
    if (!s.plan.pending) return { status: toStatus(s), message: "Nothing waiting." };
    const wait = s.budget.lastBatchAt ? new Date(s.budget.lastBatchAt).getTime() + BATCH_GAP_MS - now.getTime() : 0;
    if (wait > 0) return { status: toStatus(s), message: `Next batch in ${Math.ceil(wait / 1000)} s.` };
  }

  const batch = await runBatch(admin, s.today, now);
  s = await snapshot(admin, now);
  const left = s.plan.pending;
  return {
    status: toStatus(s),
    batch,
    message: left ? `Updated a batch; ${left} more after a one-minute pause.` : "All next-up calls updated.",
  };
}
