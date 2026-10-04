// One-off player directory sync from this machine: `npm run sync-players`.
import { createClient } from "@supabase/supabase-js";
import { syncPlayers } from "../src/lib/playerSync";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
console.log(await syncPlayers(admin));
