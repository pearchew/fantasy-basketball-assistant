// Sign in without email: `npm run login-link` (local) or `npm run login-link -- https://<deployment>`.
// Uses the secret key to mint a one-time link for ALLOWED_EMAIL and opens it in the default browser.
// The link carries a token hash, not a PKCE code, so it works in any browser.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const email = process.env.ALLOWED_EMAIL;
if (!email) throw new Error("Set ALLOWED_EMAIL in .env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error) throw error;

const url = `${base}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`;
execFileSync("open", [url]);
console.log(`Opened a one-time sign-in link for ${email} at ${base}. It expires in an hour.`);
