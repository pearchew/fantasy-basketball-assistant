import { ingestLatestReport } from "@/lib/injuryIngest";
import { updateNextUp } from "@/lib/nextUp/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { easternDate } from "@/lib/time";

// Vercel Hobby with Fluid compute allows up to 300 s; slow free-tier model replies need the room.
export const maxDuration = 300;

// Called by the feed when its data is over 10 minutes old, or by the Refresh button
// (`{"manual": true}`, allowed once a minute). Signed-in only.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "unauthorized" }, { status: 401 });

  const manual = (await request.json().catch(() => ({})))?.manual === true;
  const admin = createAdminClient();
  try {
    const report = await ingestLatestReport(admin, { manual });
    // New absences need next-up calls; earlier model failures get retried.
    const nextUp = report.status === "skipped" ? null : await updateNextUp(admin, easternDate());
    return Response.json({ ...report, nextUp });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
