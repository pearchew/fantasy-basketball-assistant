import { redo } from "@/lib/nextUp/redo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// The feed's "Update next-up calls" button. Body {"action": "start"} reserves the run's
// Gemini calls and runs the first batch; {"action": "continue"} runs the next batch once a
// minute has passed. Signed-in only.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action === "continue" ? "continue" : "start";
  try {
    return Response.json(await redo(createAdminClient(), action));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
