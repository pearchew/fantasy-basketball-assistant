import { addDays } from "./time";

/** "YYYY-MM-DD" for `iso` in time zone `tz`. */
export function localDate(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "7:30 PM BST" */
export function clock(iso: string | Date, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** "Today", "Tomorrow", "Yesterday" or "Thu, Oct 23": the day `iso` falls on in `tz`. */
export function dayLabel(iso: string | Date, tz: string, now = new Date()): string {
  const day = localDate(iso, tz);
  const today = localDate(now, tz);
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

/** "Today 7:30 PM BST" */
export function when(iso: string | Date, tz: string, now = new Date()): string {
  return `${dayLabel(iso, tz, now)} ${clock(iso, tz)}`;
}

/** Label for an Eastern game date ("YYYY-MM-DD"), independent of time zone: "Sun, Mar 15". */
export function gameDateLabel(gameDate: string): string {
  return new Date(`${gameDate}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** "just now", "4 min ago", "2 h ago", "3 days ago" */
export function ago(iso: string, now = new Date()): string {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
