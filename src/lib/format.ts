import { addDays } from "./time";

const ZONE = "America/New_York";

/** "5:30 PM ET" */
export function easternClock(iso: string): string {
  return `${new Date(iso).toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" })} ET`;
}

/** "Today", "Tomorrow" or "Wed, Oct 22" for an Eastern "YYYY-MM-DD". */
export function gameDayLabel(gameDate: string, today: string): string {
  if (gameDate === today) return "Today";
  if (gameDate === addDays(today, 1)) return "Tomorrow";
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
