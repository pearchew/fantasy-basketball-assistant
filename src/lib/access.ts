// Invite-only access. Anyone with an account (created by the admin on the People page) can sign
// in; the admin also manages people and spends the manual next-up allowance.

/** The admin's address: ADMIN_EMAIL, or ALLOWED_EMAIL from the single-user days. */
export function adminEmail(): string | null {
  const raw = process.env.ADMIN_EMAIL || process.env.ALLOWED_EMAIL;
  return raw?.trim().toLowerCase() || null;
}

export function isAdmin(email: unknown): boolean {
  const admin = adminEmail();
  return !!admin && typeof email === "string" && email.trim().toLowerCase() === admin;
}

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
