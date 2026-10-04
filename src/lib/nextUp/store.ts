// Keeps public.next_up in step with the injury updates: one answer per
// (team, game, set of absent and returning players), computed once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLimit } from "../sources/http";
import { llmConfigFromEnv } from "../sources/llm";
import type { InjuryStatus } from "../sources/nbaInjuryReport";
import { buildDepthChart, startsWithAndWithout, type LogLine } from "./depth";
import { askModel, buildPrompt, validateModelCalls } from "./model";
import { ruleBeneficiaries, type Beneficiary, type SatStats, type Subject } from "./rules";

export type GroupUpdate = {
  game_date: string;
  matchup: string;
  team_abbr: string | null;
  player_id: string | null;
  player_name: string;
  status: InjuryStatus;
  reason: string;
  is_returning: boolean;
};

export type Group = {
  key: string;
  gameDate: string;
  team: string;
  matchup: string;
  absent: (Subject & { status: InjuryStatus })[];
  returning: Subject[];
  questionable: string[];
};

const MAX_MODEL_ATTEMPTS = 3;

/** Team-game groups that need an answer: anyone out/doubtful (not G League) or returning. */
export function groupsFromUpdates(updates: GroupUpdate[], positions: Map<string, string>): Group[] {
  const byGame = new Map<string, GroupUpdate[]>();
  for (const u of updates) {
    if (!u.team_abbr || !u.player_id) continue;
    const k = `${u.game_date}|${u.team_abbr}`;
    byGame.set(k, [...(byGame.get(k) ?? []), u]);
  }
  const groups: Group[] = [];
  for (const [k, list] of byGame) {
    const [gameDate, team] = k.split("|");
    const subject = (u: GroupUpdate) => ({ id: u.player_id!, name: u.player_name, position: positions.get(u.player_id!) ?? "" });
    const absent = list
      .filter((u) => (u.status === "out" || u.status === "doubtful") && !/^G League/i.test(u.reason))
      .map((u) => ({ ...subject(u), status: u.status }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const returning = list.filter((u) => u.is_returning).map(subject).sort((a, b) => a.id.localeCompare(b.id));
    if (!absent.length && !returning.length) continue;
    groups.push({
      key: `${gameDate}|${team}|${absent.map((a) => a.id).join(",")}|${returning.map((r) => r.id).join(",")}`,
      gameDate,
      team,
      matchup: list[0].matchup,
      absent,
      returning,
      questionable: list.filter((u) => u.status === "questionable").map((u) => u.player_id!),
    });
  }
  return groups;
}

const LOG_COLUMNS = "event_id, player_id, player_name, team_abbr, game_date, starter, did_not_play, min, season";

/** Box scores for a team's recent games, preferring the current season once it has three games. */
async function teamLogs(admin: SupabaseClient, team: string, beforeDate: string): Promise<LogLine[]> {
  const { data, error } = await admin
    .from("game_logs")
    .select(LOG_COLUMNS)
    .eq("team_abbr", team)
    .neq("season_type", 1)
    .lt("game_date", beforeDate)
    .order("game_date", { ascending: false })
    .limit(800);
  if (error) throw error;
  const rows = data as (LogLine & { season: number })[];
  const latest = Math.max(...rows.map((r) => r.season));
  const current = rows.filter((r) => r.season === latest);
  return new Set(current.map((r) => r.event_id)).size >= 3 ? current : rows;
}

async function computeGroup(admin: SupabaseClient, g: Group, useModel: boolean) {
  const [{ data: roster, error: rosterError }, logs] = await Promise.all([
    admin.from("players").select("espn_id, name, position").eq("team_abbr", g.team).eq("active", true),
    teamLogs(admin, g.team, g.gameDate),
  ]);
  if (rosterError) throw rosterError;

  // Players new to the team: borrow their recent minutes from elsewhere.
  const withTeamGames = new Set(logs.map((l) => l.player_id));
  const newcomers = roster!.map((r) => r.espn_id).filter((id) => !withTeamGames.has(id));
  const elsewhere = new Map<string, LogLine[]>();
  if (newcomers.length) {
    const { data, error } = await admin
      .from("game_logs")
      .select(LOG_COLUMNS)
      .in("player_id", newcomers)
      .neq("season_type", 1)
      .lt("game_date", g.gameDate)
      .order("game_date", { ascending: false })
      .limit(newcomers.length * 12);
    if (error) throw error;
    for (const l of data as LogLine[]) elsewhere.set(l.player_id, [...(elsewhere.get(l.player_id) ?? []), l]);
  }

  const depth = buildDepthChart({
    team: g.team,
    teamLogs: logs,
    roster: roster!.map((r) => ({ id: r.espn_id, name: r.name, position: r.position })),
    positions: new Map(roster!.map((r) => [r.espn_id, r.position])),
    elsewhere,
  });
  const sat = new Map<string, SatStats>([...g.absent, ...g.returning].map((s) => [s.id, startsWithAndWithout(s.id, logs)]));
  const questionable = new Set(g.questionable);
  const rules = ruleBeneficiaries({
    absent: g.absent,
    returning: g.returning,
    depth,
    sat,
    unavailable: new Set(g.absent.map((a) => a.id)),
    questionable,
  });

  const config = llmConfigFromEnv();
  if (!useModel || !config) return { beneficiaries: rules.beneficiaries, source: "rules" as const, model: null, modelError: null, tried: false };
  try {
    const calls = await askModel(
      config,
      buildPrompt({ depth, gameLabel: `${g.matchup} on ${g.gameDate}`, absent: g.absent, returning: g.returning, candidates: rules.candidates, questionable }),
    );
    const v = validateModelCalls({ calls, absent: g.absent, returning: g.returning, candidates: rules.candidates, rulePicks: rules.beneficiaries, questionable });
    return {
      beneficiaries: v.beneficiaries,
      source: "model" as const,
      model: config.model,
      modelError: v.rejected.length ? `rejected: ${v.rejected.join("; ")}` : null,
      tried: true,
    };
  } catch (e) {
    return { beneficiaries: rules.beneficiaries, source: "rules" as const, model: null, modelError: e instanceof Error ? e.message : String(e), tried: true };
  }
}

/**
 * Computes answers for new groups (and retries model failures), within a model-call budget.
 * Gemini's free tier allows roughly 8-10 calls a minute: groups past the budget get the rule
 * answer now and the model's on a later refresh.
 */
export async function updateNextUp(admin: SupabaseClient, fromDate: string, { modelBudget = 8 } = {}) {
  const { data: updates, error } = await admin
    .from("injury_updates")
    .select("game_date, matchup, team_abbr, player_id, player_name, status, reason, is_returning")
    .gte("game_date", fromDate);
  if (error) throw error;
  const ids = [...new Set((updates as GroupUpdate[]).map((u) => u.player_id).filter((id): id is string => !!id))];
  const positions = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("players").select("espn_id, position").in("espn_id", ids.slice(i, i + 200));
    for (const p of data ?? []) positions.set(p.espn_id, p.position);
  }

  const groups = groupsFromUpdates(updates as GroupUpdate[], positions);
  const existing = new Map<string, { source: string; model_attempts: number }>();
  for (let i = 0; i < groups.length; i += 50) {
    const { data, error: e } = await admin
      .from("next_up")
      .select("group_key, source, model_attempts")
      .in("group_key", groups.slice(i, i + 50).map((g) => g.key));
    if (e) throw e;
    for (const r of data ?? []) existing.set(r.group_key, r);
  }

  const hasModel = !!llmConfigFromEnv();
  const todo = groups.filter((g) => {
    const row = existing.get(g.key);
    return !row || (hasModel && row.source === "rules" && row.model_attempts < MAX_MODEL_ATTEMPTS);
  });

  let budget = modelBudget;
  const summary = { groups: groups.length, computed: 0, model: 0, rules: 0, errors: [] as string[] };
  await mapLimit(todo, 3, async (g) => {
    const useModel = budget-- > 0;
    try {
      const r = await computeGroup(admin, g, useModel);
      // Rate limited: stop calling the model for the rest of this run.
      if (r.modelError?.startsWith("429")) budget = 0;
      const attempts = (existing.get(g.key)?.model_attempts ?? 0) + (r.tried ? 1 : 0);
      const { error: e } = await admin.from("next_up").upsert(
        {
          group_key: g.key,
          game_date: g.gameDate,
          team_abbr: g.team,
          absent_ids: g.absent.map((a) => a.id),
          returning_ids: g.returning.map((r) => r.id),
          beneficiaries: r.beneficiaries satisfies Beneficiary[],
          source: r.source,
          model: r.model,
          model_error: r.modelError,
          model_attempts: attempts,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "group_key" },
      );
      if (e) throw e;
      summary.computed++;
      summary[r.source]++;
    } catch (e) {
      summary.errors.push(`${g.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return summary;
}
