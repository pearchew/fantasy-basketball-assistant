import type { FeedUpdate, NextUpCall } from "@/lib/feed";
import { when } from "@/lib/format";
import { gameStartUtc } from "@/lib/time";

const STATUS_STYLE: Record<FeedUpdate["status"], string> = {
  out: "bg-danger text-white",
  doubtful: "bg-accent text-white",
  questionable: "bg-accent-soft text-accent",
  probable: "border border-border text-foreground",
  available: "border border-border text-muted",
};

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export const TYPE_LABEL: Record<NextUpCall["type"], string> = {
  starter_replacement: "Into the starting lineup",
  bench_minutes: "More bench minutes",
  starter_usage: "More usage",
  loses_minutes: "Loses minutes",
};

export function OwnerTags({ heldOn }: { heldOn: string[] }) {
  if (!heldOn.length) return <span className="text-xs text-muted">Unowned</span>;
  return (
    <>
      {heldOn.map((t) => (
        <span key={t} className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
          {t}
        </span>
      ))}
    </>
  );
}

function NextUp({ u }: { u: FeedUpdate }) {
  if (!u.nextUp) return null;
  const title = u.returning ? "With him back, losing minutes:" : "Next up:";
  return (
    <div className="mt-2 rounded-lg bg-background px-3 py-2">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
      {u.nextUp.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Working out who benefits; refresh in a moment.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {u.nextUp.map((b) => (
            <li key={b.player_id} className="text-sm">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{b.name}</span>
                <span className="text-xs text-muted">{TYPE_LABEL[b.type]}</span>
                <OwnerTags heldOn={b.heldOn} />
                {b.questionable && <StatusBadge status="questionable" />}
              </span>
              <span className="text-muted">{b.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: FeedUpdate["status"] }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{label(status)}</span>;
}

/** One player's update. `showGame` adds the matchup and tip-off, for lists outside a game's dropdown. */
export function UpdateItem({ u, tz, showGame = false }: { u: FeedUpdate; tz: string; showGame?: boolean }) {
  const trail = u.history.map((h) => label(h.status));
  const tip = gameStartUtc(u.gameDate, u.gameTime);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={u.status} />
        <span className="font-medium">{u.playerName}</span>
        {showGame && (
          <span className="text-sm text-muted">
            {u.teamAbbr ?? u.teamName} · {u.matchup.replace("@", " @ ")} · {tip ? when(tip, tz) : u.gameTime}
          </span>
        )}
        {!u.playerId && <span className="text-xs text-danger">Couldn&apos;t match this name</span>}
        {u.returning && <span className="text-xs font-medium text-accent">Returning</span>}
        {u.heldOn.length > 0 && <OwnerTags heldOn={u.heldOn} />}
      </div>
      {u.reason && <p className="mt-1 text-sm">{u.reason}</p>}
      <NextUp u={u} />
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">
          {trail.length > 1 ? `${trail.join(" → ")} · ` : ""}changed {when(u.changedAt, tz).replace(/^(Today|Tomorrow|Yesterday)/, (d) => d.toLowerCase())} · report text
        </summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-background p-2 font-mono">{u.rawText}</pre>
        <p className="mt-1">From the report published {when(u.reportTime, tz)}.</p>
      </details>
    </li>
  );
}
