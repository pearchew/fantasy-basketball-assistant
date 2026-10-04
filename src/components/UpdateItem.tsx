import type { FeedUpdate } from "@/lib/feed";
import { easternClock, gameDayLabel } from "@/lib/format";
import { easternDate } from "@/lib/time";

const STATUS_STYLE: Record<FeedUpdate["status"], string> = {
  out: "bg-danger text-white",
  doubtful: "bg-accent text-white",
  questionable: "bg-accent-soft text-accent",
  probable: "border border-border text-foreground",
  available: "border border-border text-muted",
};

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: FeedUpdate["status"] }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{label(status)}</span>;
}

export function UpdateItem({ u, today }: { u: FeedUpdate; today: string }) {
  const trail = u.history.map((h) => label(h.status));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={u.status} />
        <span className="font-medium">{u.playerName}</span>
        <span className="text-sm text-muted">
          {u.teamAbbr ?? u.teamName} · {u.matchup} · {gameDayLabel(u.gameDate, today)} {u.gameTime}
        </span>
        {u.heldOn.map((t) => (
          <span key={t} className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
            {t}
          </span>
        ))}
      </div>
      {u.reason && <p className="mt-1 text-sm">{u.reason}</p>}
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">
          {trail.length > 1 ? `${trail.join(" → ")} · ` : ""}changed {gameDayLabel(easternDate(new Date(u.changedAt)), today).toLowerCase()} {easternClock(u.changedAt)} · report text
        </summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-background p-2 font-mono">{u.rawText}</pre>
        <p className="mt-1">From the report published {easternClock(u.reportTime)}.</p>
      </details>
    </li>
  );
}
