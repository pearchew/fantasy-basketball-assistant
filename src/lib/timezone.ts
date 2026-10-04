// Display time zone: auto-detected from the browser, or chosen by hand. Stored in cookies
// so server-rendered pages can format times correctly on the first paint.
export const TZ_COOKIE = "tz";
/** Set when the zone was chosen by hand; otherwise the browser's zone is kept in sync. */
export const TZ_MANUAL_COOKIE = "tz_manual";
export const DEFAULT_TZ = "America/New_York";

export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type TimeZoneSetting = { tz: string; manual: boolean; known: boolean };

/** Reads the setting from request cookies (pass `cookies()` from next/headers). */
export function timeZoneFrom(cookies: { get(name: string): { value: string } | undefined }): TimeZoneSetting {
  const raw = cookies.get(TZ_COOKIE)?.value;
  const tz = raw ? decodeURIComponent(raw) : undefined;
  const known = isValidTimeZone(tz);
  return { tz: known ? tz : DEFAULT_TZ, manual: cookies.get(TZ_MANUAL_COOKIE)?.value === "1", known };
}
