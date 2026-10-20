import type { FeedUpdate } from "@/lib/feed";
import { when } from "@/lib/format";
import type { OnOffTableData } from "@/lib/onOff";
import type { StatsLookup } from "@/lib/stats";
import { OnOffTable } from "./OnOffTable";
import { OwnerTags, StatusBadge } from "./Badges";
import { StatsPanel } from "./StatsPanel";
import { gameStartUtc } from "@/lib/time";

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * One player's update. `showGame` adds the matchup and tip-off, for lists outside a game's dropdown.
 * `onOff`: his teammates' splits (a string when they couldn't be loaded); absent when not applicable.
 */
export function UpdateItem({
  u,
  tz,
  stats = null,
  onOff,
  showGame = false,
}: {
  u: FeedUpdate;
  tz: string;
  stats?: StatsLookup | null;
  onOff?: OnOffTableData | string;
  showGame?: boolean;
}) {
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
      {/* My own players get their form here; teammates get it inside the on/off table. */}
      {u.heldOn.length > 0 && u.playerId && <StatsPanel playerId={u.playerId} stats={stats} />}
      {typeof onOff === "string" ? (
        <p className="mt-2 text-xs text-muted">On/off splits unavailable right now ({onOff}).</p>
      ) : (
        onOff && <OnOffTable name={u.playerName} returning={u.returning} table={onOff} open={u.status !== "questionable" || u.returning} />
      )}
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
