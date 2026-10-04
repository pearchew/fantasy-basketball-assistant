// Daily player directory sync: ESPN rosters -> public.players.
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameKey } from "./names";
import { fetchPlayerDirectory, type Player } from "./sources/espn";

// A full league is ~450-600 rostered players. Anything far below that is a bad
// fetch, and syncing it would mark most of the league as inactive.
export const MIN_DIRECTORY_SIZE = 350;

export type PlayerRow = {
  espn_id: string;
  name: string;
  name_key: string;
  position: string;
  team_abbr: string | null;
  active: boolean;
  updated_at: string;
};

export type SyncPlan = {
  upserts: PlayerRow[];
  /** Previously active players no longer on any NBA roster. Kept, never deleted, so rosters still resolve. */
  deactivate: string[];
};

export function planPlayerSync(fetched: Player[], activeIds: string[], now = new Date()): SyncPlan {
  if (fetched.length < MIN_DIRECTORY_SIZE) {
    throw new Error(`ESPN returned ${fetched.length} players (expected at least ${MIN_DIRECTORY_SIZE}); refusing to sync`);
  }
  const updatedAt = now.toISOString();
  const byId = new Map<string, PlayerRow>();
  for (const p of fetched) {
    byId.set(p.espnId, {
      espn_id: p.espnId,
      name: p.name,
      name_key: nameKey(p.name),
      position: p.position,
      team_abbr: p.teamAbbr,
      active: true,
      updated_at: updatedAt,
    });
  }
  return {
    upserts: [...byId.values()],
    deactivate: activeIds.filter((id) => !byId.has(id)),
  };
}

export async function syncPlayers(admin: SupabaseClient) {
  const fetched = await fetchPlayerDirectory();
  const { data: active, error: readError } = await admin.from("players").select("espn_id").eq("active", true);
  if (readError) throw readError;

  const plan = planPlayerSync(fetched, (active ?? []).map((r) => r.espn_id));

  const { error: upsertError } = await admin.from("players").upsert(plan.upserts, { onConflict: "espn_id" });
  if (upsertError) throw upsertError;

  if (plan.deactivate.length) {
    const { error } = await admin
      .from("players")
      .update({ active: false, team_abbr: null, updated_at: new Date().toISOString() })
      .in("espn_id", plan.deactivate);
    if (error) throw error;
  }
  return { upserted: plan.upserts.length, deactivated: plan.deactivate.length };
}
