import { ingestLatestReport } from "@/lib/injuryIngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Called by the feed page when its data is over 10 minutes old. Signed-in only;
// the ingest itself allows one fetch per 10 minutes however often this is hit.
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await ingestLatestReport(createAdminClient()));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
