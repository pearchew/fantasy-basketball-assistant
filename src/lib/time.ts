// NBA schedules, game dates and injury reports all run on US Eastern time.
const ZONE = "America/New_York";

function easternParts(instant: Date): Record<"year" | "month" | "day" | "hour" | "minute", number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Calendar date in US Eastern, "YYYY-MM-DD". */
export function easternDate(instant = new Date()): string {
  const p = easternParts(instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" -> "YYYYMMDD" (ESPN's date format). */
export function compactDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The instant at which Eastern wall-clock time `isoDate hour:minute` occurs. */
export function easternToUtc(isoDate: string, hour: number, minute: number): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hour, minute);
  // Guess with the offset at `wanted`, then correct once (handles DST changes).
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = easternParts(new Date(guess));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - seen;
  }
  return new Date(guess);
}

/** Parses the report header time, e.g. "03/15/26 05:00 PM" (Eastern). */
export function parseReportTime(printed: string): Date | null {
  const m = printed.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mm, dd, yy, hh, min, ampm] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const hour = (Number(hh) % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
  return easternToUtc(`${year}-${mm}-${dd}`, hour, Number(min));
}
