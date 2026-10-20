"use client";

import { useState } from "react";
import { change, MIN_GAMES, type OnOffTableData, type Side, type StatKey, type TableRow } from "@/lib/onOff";
import { OwnerTags, StatusBadge } from "./Badges";
import { useStats } from "./StatsContext";
import { COLUMNS, fmt, StatsTable, TREND_CLASS } from "./StatsPanel";

const SHOWN = 6;

const lastName = (name: string) => name.split(" ").slice(1).join(" ") || name;

function delta(key: StatKey, without: Side, withHim: Side): string {
  const a = without[key];
  const b = withHim[key];
  if (a === null || b === null) return "–";
  const d = a - b;
  const sign = d >= 0 ? "+" : "−";
  return key === "fgPct" || key === "ftPct" ? `${sign}${Math.abs(d).toFixed(3).replace(/^0/, "")}` : `${sign}${Math.abs(d).toFixed(1)}`;
}

function Row({ r, open, onToggle }: { r: TableRow; open: boolean; onToggle: () => void }) {
  const stats = useStats();
  const thin = (r.without?.games ?? 0) < MIN_GAMES;
  const form = stats?.ok ? stats.byPlayer[r.playerId] : undefined;
  return (
    <tbody className="border-t border-border">
      <tr className={thin ? "opacity-70" : ""}>
        <td rowSpan={2} className="sticky left-0 bg-background px-2 py-1 text-left align-top">
          <button type="button" onClick={onToggle} className="cursor-pointer text-left font-medium hover:underline" aria-expanded={open}>
            {r.name}
          </button>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {r.heldOn.length > 0 && <OwnerTags heldOn={r.heldOn} />}
            {r.status && <StatusBadge status={r.status} />}
          </span>
        </td>
        <td className="px-2 pt-1 whitespace-nowrap" title={r.without ? `Started ${r.without.starts} of the ${r.without.games} games he sat` : undefined}>
          {r.without ? `${r.without.starts}/${r.without.games}` : "–"}
          {r.without && thin && "*"}
        </td>
        {COLUMNS.map((c) => (
          <td key={c.key} className="px-2 pt-1 whitespace-nowrap">
            {r.without ? fmt(c.key, r.without[c.key]) : "–"}
          </td>
        ))}
      </tr>
      <tr className="text-muted">
        <td className="px-2 pb-1 whitespace-nowrap" title={r.with ? `Started ${r.with.starts} of the ${r.with.games} games he played` : undefined}>
          {r.with ? `${r.with.starts}/${r.with.games}` : "–"}
        </td>
        {COLUMNS.map((c) => {
          const t = r.without && r.with ? change(c.key, r.without, r.with) : null;
          return (
            <td key={c.key} className={`px-2 pb-1 whitespace-nowrap ${t ? TREND_CLASS[t] : ""}`}>
              {r.without && r.with ? delta(c.key, r.without, r.with) : "–"}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length + 2} className="px-2 pb-2 text-left">
            {!stats ? null : !stats.ok ? (
              <p className="text-muted">Stats unavailable right now ({stats.error}).</p>
            ) : form?.windows.length ? (
              <StatsTable player={form} seasonLabel={stats.seasonLabel} />
            ) : (
              <p className="text-muted">No games played in {stats.seasonLabel} yet.</p>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

/**
 * How an injured (or returning) player's teammates did in the games he sat versus the games
 * he played. `open`: shown expanded (out, doubtful, returning) or collapsed (questionable).
 */
export function OnOffTable({ name, returning, table, open }: { name: string; returning: boolean; table: OnOffTableData; open: boolean }) {
  const [season, setSeason] = useState(table.defaultSeason);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const s = table.seasons.find((x) => x.season === season) ?? table.seasons[0];
  const last = lastName(name);
  const rows = showAll ? s.rows : s.rows.slice(0, SHOWN);
  const heading = returning
    ? `While ${last} was out (${s.sat} g) vs with him (${s.played} g)`
    : `When ${last} sat (${s.sat} g) vs played (${s.played} g)`;
  const empty =
    s.sat + s.played === 0
      ? `${name} has no games for this team in ${s.label}.`
      : s.sat === 0
        ? `${name} hasn't missed a game in ${s.label} (${s.played} played).`
        : s.rows.length === 0
          ? "No current teammates played in those games."
          : null;

  // Nothing to show in any season: one line, not a box.
  if (table.seasons.every((x) => x.sat === 0)) {
    return <p className="mt-2 text-xs text-muted">On/off: {empty ?? `${name} hasn't missed a game.`}</p>;
  }

  return (
    <details open={open} className="mt-2 rounded-lg bg-background px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none">
        <span className="font-medium tracking-wide text-muted uppercase">On/off</span>{" "}
        <span className="text-muted">
          · {heading} · {s.label}
        </span>
      </summary>

      {table.seasons.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Season">
          {table.seasons.map((x) => (
            <button
              key={x.season}
              type="button"
              onClick={() => setSeason(x.season)}
              aria-pressed={x.season === s.season}
              className={`rounded-full border px-2 py-0.5 ${x.season === s.season ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"}`}
            >
              {x.label} · {x.sat} missed
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <p className="mt-2 text-muted">{empty}</p>
      ) : (
        <>
          {s.played === 0 && (
            <p className="mt-2 text-muted">
              {name} didn&apos;t play in {s.label}, so there&apos;s nothing to compare with: the top line is each teammate&apos;s season.
            </p>
          )}
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[42rem] text-right tabular-nums">
              <thead>
                <tr className="text-muted">
                  <th className="sticky left-0 bg-background px-2 py-1 text-left font-medium">Teammate</th>
                  <th className="px-2 py-1 font-medium">GS</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-1 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {rows.map((r) => (
                <Row
                  key={r.playerId}
                  r={r}
                  open={expanded === r.playerId}
                  onToggle={() => setExpanded(expanded === r.playerId ? null : r.playerId)}
                />
              ))}
            </table>
          </div>
          {s.rows.length > SHOWN && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="mt-1 cursor-pointer text-muted underline">
              {showAll ? "Show fewer" : `Show all ${s.rows.length} teammates`}
            </button>
          )}
          <p className="mt-1 text-muted">
            Per game, regular season, current teammates. Top line: {returning ? "while he was out" : "when he sat"}. Below it: the change from
            when he played (GS there: starts in those games). Green/red: clearly better/worse. * fewer than {MIN_GAMES} games without him.
            {returning && " With him back, expect those gains to shrink."} Tap a name for his last 7 / 14 / 30 / season.
          </p>
        </>
      )}
    </details>
  );
}
