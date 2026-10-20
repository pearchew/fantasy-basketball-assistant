// Sign in without email: `npm run login-link` (local) or `npm run login-link -- https://<deployment>`.
// Uses the secret key to mint a one-time link for the admin and opens it in the default browser.
// With `--email someone@x.com` (who must already have access) it prints the link to send them
// instead: opening it here would sign you in as them.
// The link carries a token hash, not a PKCE code, so it works in any browser.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = args.indexOf("--email");
const email = flag === -1 ? (process.env.ADMIN_EMAIL || process.env.ALLOWED_EMAIL) : args[flag + 1];
const base = (args.find((a, i) => !a.startsWith("--") && (flag === -1 || i !== flag + 1)) ?? "http://localhost:3000").replace(/\/$/, "");
if (!email) throw new Error("Set ADMIN_EMAIL in .env.local or pass --email");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error) throw error;

const url = `${base}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`;
if (flag === -1) {
  execFileSync("open", [url]);
  console.log(`Opened a one-time sign-in link for ${email} at ${base}. It expires in an hour.`);
} else {
  console.log(`One-time sign-in link for ${email} (works once, in any browser, for about an hour):\n${url}`);
}
