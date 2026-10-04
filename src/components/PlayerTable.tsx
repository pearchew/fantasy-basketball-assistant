"use client";

import { useTransition } from "react";
import { removeFromTeam, removeFromWatchlist } from "@/app/actions";
import type { OwnedPlayer } from "@/lib/dashboard";
import type { StatsLookup } from "@/lib/stats";
import { StatsPanel } from "./StatsPanel";

type Props = {
  players: OwnedPlayer[];
  /** Team the table belongs to, or "watchlist". Remove acts on this. */
  context: string;
  emptyText: string;
  stats?: StatsLookup | null;
};

export function PlayerTable({ players, context, emptyText, stats = null }: Props) {
  if (!players.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    // Fixed layout: wide stats tables scroll inside their row instead of widening the page.
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <th className="py-2 pr-3 font-medium">Player</th>
          <th className="w-12 py-2 pr-3 font-medium">Pos</th>
          <th className="w-14 py-2 pr-3 font-medium">NBA</th>
          <th className="hidden w-48 py-2 pr-3 font-medium sm:table-cell">Held on</th>
          <th className="w-10 py-2" />
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <Row key={p.espnId} player={p} context={context} stats={stats} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ player: p, context, stats }: { player: OwnedPlayer; context: string; stats: StatsLookup | null }) {
  const [pending, startTransition] = useTransition();
  const held = [...p.onTeams.map((t) => ({ key: t.id, label: t.name })), ...(p.watchlisted ? [{ key: "watchlist", label: "Watchlist" }] : [])];

  const statsRow = stats !== null;
  return (
    <>
      <tr className={`${statsRow ? "" : "border-b border-border"} ${pending ? "opacity-40" : ""}`}>
        <td className="pt-2 pr-3 pb-1">
          <span className="font-medium">{p.name}</span>
          {!p.active && (
            <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">not on an NBA roster</span>
          )}
          {/* On narrow screens the "Held on" column is hidden; show it under the name. */}
          <HeldOn held={held} context={context} className="mt-1 sm:hidden" />
        </td>
        <td className="py-2 pr-3 text-muted">{p.position}</td>
        <td className="py-2 pr-3 text-muted">{p.teamAbbr ?? "—"}</td>
        <td className="hidden py-2 pr-3 sm:table-cell">
          <HeldOn held={held} context={context} />
        </td>
        <td className="py-2 text-right">
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove ${p.name}`}
            title="Remove"
            onClick={() =>
              startTransition(async () => {
                await (context === "watchlist" ? removeFromWatchlist(p.espnId) : removeFromTeam(context, p.espnId));
              })
            }
            className="rounded px-2 py-1 text-muted hover:bg-accent-soft hover:text-danger"
          >
            ✕
          </button>
        </td>
      </tr>
      {statsRow && (
        <tr className={`border-b border-border ${pending ? "opacity-40" : ""}`}>
          <td colSpan={5} className="pb-2">
            <StatsPanel playerId={p.espnId} stats={stats} />
          </td>
        </tr>
      )}
    </>
  );
}

function HeldOn({ held, context, className = "" }: { held: { key: string; label: string }[]; context: string; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {held.map((h) => (
        <span
          key={h.key}
          className={`rounded px-1.5 py-0.5 text-xs ${
            h.key === context ? "bg-accent-soft text-accent" : "border border-border text-muted"
          }`}
        >
          {h.label}
        </span>
      ))}
    </div>
  );
}
