import { ingestGameLogs } from "@/lib/gameLogIngest";
import { ingestLatestReport } from "@/lib/injuryIngest";
import { updateNextUp } from "@/lib/nextUp/store";
import { syncPlayers } from "@/lib/playerSync";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, easternDate } from "@/lib/time";

// Vercel Hobby with Fluid compute allows up to 300 s; slow free-tier model replies need the room.
export const maxDuration = 300;

async function run<T>(fn: () => Promise<T>) {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Vercel Cron, once a day (10:00 UTC, after the last West Coast games end).
// Each job runs even if an earlier one fails. Also keeps Supabase active.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const players = await run(() => syncPlayers(admin));
  const gameLogs = await run(() => ingestGameLogs(admin, addDays(easternDate(), -1)));
  const injuryReport = await run(() => ingestLatestReport(admin, { force: true }));
  // After the new box scores, so depth charts include last night's games.
  const nextUp = await run(() => updateNextUp(admin, easternDate()));
  const ok = players.ok && gameLogs.ok && injuryReport.ok && nextUp.ok;
  return Response.json({ ok, players, gameLogs, injuryReport, nextUp }, { status: ok ? 200 : 500 });
}
