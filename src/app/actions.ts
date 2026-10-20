"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LeagueFormat } from "@/lib/dashboard";
import { isAdmin, isEmail } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string; id?: string };

const FORMATS: LeagueFormat[] = ["h2h_9cat", "roto"];

/** Server Actions are reachable by direct POST: check the session in every one. RLS backs this up. */
async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw new Error("Not signed in");
  return supabase;
}

function cleanName(raw: unknown): string | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

function message(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "You already have a team with that name.";
  return error.message;
}

export async function createTeam(name: string, format: LeagueFormat): Promise<ActionResult> {
  const supabase = await signedInClient();
  const clean = cleanName(name);
  if (!clean) return { error: "Team name must be 1–60 characters." };
  if (!FORMATS.includes(format)) return { error: "Unknown format." };
  const { data, error } = await supabase.from("fantasy_teams").insert({ name: clean, format }).select("id").single();
  if (error) return { error: message(error) };
  refresh();
  return { id: data.id };
}

export async function updateTeam(id: string, name: string, format: LeagueFormat): Promise<ActionResult> {
  const supabase = await signedInClient();
  const clean = cleanName(name);
  if (!clean) return { error: "Team name must be 1–60 characters." };
  if (!FORMATS.includes(format)) return { error: "Unknown format." };
  const { error } = await supabase.from("fantasy_teams").update({ name: clean, format }).eq("id", id);
  if (error) return { error: message(error) };
  refresh();
  return {};
}

export async function deleteTeam(id: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  const { error } = await supabase.from("fantasy_teams").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function addToTeam(teamId: string, playerId: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  const { error } = await supabase
    .from("roster_spots")
    .upsert({ team_id: teamId, player_id: playerId }, { onConflict: "team_id,player_id", ignoreDuplicates: true });
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function removeFromTeam(teamId: string, playerId: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  const { error } = await supabase.from("roster_spots").delete().eq("team_id", teamId).eq("player_id", playerId);
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function addToWatchlist(playerId: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  const { error } = await supabase
    .from("watchlist")
    .upsert({ player_id: playerId }, { onConflict: "owner_id,player_id", ignoreDuplicates: true });
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function removeFromWatchlist(playerId: string): Promise<ActionResult> {
  const supabase = await signedInClient();
  const { error } = await supabase.from("watchlist").delete().eq("player_id", playerId);
  if (error) return { error: error.message };
  refresh();
  return {};
}

export type LoginState = { sent?: boolean; error?: string };

async function requestOrigin(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address." };

  // Invite-only: links go to existing accounts only, never creating one. Unknown addresses get
  // the same reply, so the form can't be used to find out who has access.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/callback`, shouldCreateUser: false },
  });
  if (error && error.code !== "otp_disabled" && !/signups? not allowed/i.test(error.message)) return { error: error.message };
  return { sent: true };
}

/** Admin only: the server action's caller must be signed in as the admin. */
async function adminCaller() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!isAdmin(data?.claims?.email)) throw new Error("Only the admin can manage people.");
}

export type InviteResult = { link?: string; created?: boolean; error?: string };

/**
 * Admin: gives `email` access and returns a one-time sign-in link to send them (no email is
 * sent). Creates the account if needed; for an existing account it's a fresh sign-in link.
 */
export async function inviteUser(rawEmail: string): Promise<InviteResult> {
  await adminCaller();
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address." };

  const admin = createAdminClient();
  let created = true;
  let { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  if (error && (error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message))) {
    created = false;
    ({ data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email }));
  }
  if (error || !data?.properties?.hashed_token) return { error: error?.message ?? "Couldn't create a link." };

  const type = created ? "invite" : "magiclink";
  refresh();
  return { created, link: `${await requestOrigin()}/auth/callback?token_hash=${data.properties.hashed_token}&type=${type}` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
