import { snapshotForm } from "@/lib/form";
import { ingestGameLogs } from "@/lib/gameLogIngest";
import { ingestLatestReport } from "@/lib/injuryIngest";
import { syncPlayers } from "@/lib/playerSync";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, easternDate } from "@/lib/time";

export const maxDuration = 60;

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
  const today = easternDate();
  const gameLogs = await run(() => ingestGameLogs(admin, addDays(today, -1)));
  // Risers and droppers through last night's games, for the Monitoring tab.
  const form = await run(() => snapshotForm(admin, today));
  const injuryReport = await run(() => ingestLatestReport(admin, { force: true }));
  const ok = players.ok && gameLogs.ok && form.ok && injuryReport.ok;
  return Response.json({ ok, players, gameLogs, form, injuryReport }, { status: ok ? 200 : 500 });
}
