// Loads game logs for a range of Eastern dates: `npm run backfill-logs -- 2025-10-21 2026-04-12`.
// One date at a time to stay polite to ESPN; safe to re-run.
import { createClient } from "@supabase/supabase-js";
import { ingestGameLogs } from "../src/lib/gameLogIngest";
import { addDays } from "../src/lib/time";

const [from, to = from] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "")) throw new Error("Usage: npm run backfill-logs -- YYYY-MM-DD [YYYY-MM-DD]");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
let games = 0;
let lines = 0;
for (let d = from; d <= to; d = addDays(d, 1)) {
  const r = await ingestGameLogs(admin, d);
  games += r.games;
  lines += r.lines;
  if (r.games) console.log(`${d}: ${r.games} games, ${r.lines} lines`);
}
console.log(`Done: ${games} games, ${lines} lines from ${from} to ${to}.`);
