import { trend, type StatKey, type StatsLookup, type StatWindow } from "@/lib/stats";

const COLUMNS: { key: StatKey; label: string; attempts?: "fga" | "fta" }[] = [
  { key: "min", label: "MIN" },
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "tpm", label: "3PM" },
  { key: "tov", label: "TO" },
  { key: "fgPct", label: "FG%", attempts: "fga" },
  { key: "ftPct", label: "FT%", attempts: "fta" },
];

const fmt = (key: StatKey, v: number | null) =>
  v === null ? "–" : key === "fgPct" || key === "ftPct" ? v.toFixed(3).replace(/^0/, "") : v.toFixed(1);

const TREND_CLASS = { up: "text-good", down: "text-danger" } as const;

function summary(windows: StatWindow[]): string {
  const w = windows.find((x) => x.size === 14 && x.games > 0) ?? windows.find((x) => x.games > 0);
  if (!w) return "";
  const label = w.size === 0 ? "Season" : w.games < w.size ? `Last ${w.games}` : w.label;
  return `${label}: ${w.pts.toFixed(1)} pts · ${w.reb.toFixed(1)} reb · ${w.ast.toFixed(1)} ast · ${w.min.toFixed(1)} min`;
}

/** Recent form for one player: a one-line summary that opens into the full window table. */
export function StatsPanel({ playerId, stats }: { playerId: string; stats: StatsLookup | null }) {
  if (!stats) return null;
  if (!stats.ok) {
    return <p className="mt-1 text-xs text-muted">Stats unavailable right now ({stats.error}).</p>;
  }
  const player = stats.byPlayer[playerId];
  if (!player?.windows.length) {
    return <p className="mt-1 text-xs text-muted">No games played in {stats.seasonLabel} yet.</p>;
  }
  const season = player.windows.find((w) => w.size === 0)!;

  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-muted select-none">
        {summary(player.windows)} <span className="underline">stats</span>
      </summary>
      <div className="mt-1 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[34rem] text-right tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-left font-medium">{stats.seasonLabel}</th>
              <th className="px-2 py-1 font-medium">GP</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {player.windows.map((w) => {
              const short = w.size > 0 && w.games < w.size;
              return (
                <tr key={w.size} className={`border-t border-border ${w.size === 0 ? "font-medium" : ""}`}>
                  <td className="px-2 py-1 text-left whitespace-nowrap">{w.label}</td>
                  <td className="px-2 py-1" title={short ? `Only ${w.games} games played` : undefined}>
                    {w.games}
                    {short && "*"}
                  </td>
                  {COLUMNS.map((c) => {
                    const t = trend(w, season, c.key);
                    return (
                      <td key={c.key} className={`px-2 py-1 whitespace-nowrap ${t ? TREND_CLASS[t] : ""}`}>
                        {fmt(c.key, w[c.key])}
                        {c.attempts && <span className="ml-0.5 text-muted">({w[c.attempts].toFixed(1)})</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-muted">
        Games played, regular season, through {player.lastGame}. Green/red: clearly above/below his season average.
        {player.windows.some((w) => w.size > 0 && w.games < w.size) && " * fewer games than the window."} FG% and FT% are
        total makes over attempts; attempts per game in brackets.
      </p>
    </details>
  );
}
