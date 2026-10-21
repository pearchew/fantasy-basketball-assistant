import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { OwnerTags } from "@/components/Badges";
import { heldByMap, loadDashboard } from "@/lib/dashboard";
import { DEFAULT_THRESHOLD, loadMonitoring, pickFlags, THRESHOLDS, type FormFlag } from "@/lib/form";
import { gameDateLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";

const signed = (z: number) => (z > 0 ? "+" : "") + z.toFixed(1);

function FlagTable({ flags, heldBy, emptyText }: { flags: FormFlag[]; heldBy: Record<string, string[]>; emptyText: string }) {
  if (!flags.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-medium">Player</th>
            <th className="py-2 pr-3 text-right font-medium" title="Last 3 games vs the 10 before them, in his own standard deviations">
              vs prev 10
            </th>
            <th className="py-2 pr-3 text-right font-medium" title="Last 3 games vs his baseline, in his own standard deviations">
              vs season
            </th>
            <th className="py-2 text-right font-medium" title="Minutes per game: last 3 (baseline)">
              Min
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {flags.map((f) => {
            const tone = f.side === "riser" ? "text-good" : "text-danger";
            const held = heldBy[f.playerId] ?? [];
            return (
              <tr key={f.playerId} className="align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{f.name}</span> <span className="text-xs text-muted">{f.teamAbbr}</span>
                  {held.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      <OwnerTags heldOn={held} />
                    </span>
                  )}
                </td>
                <td className={`py-2 pr-3 text-right ${tone}`}>{signed(f.zPrev10)}</td>
                <td className={`py-2 pr-3 text-right ${tone}`}>
                  {signed(f.zBaseline)}
                  {f.baseline === "last_season" && (
                    <span className="ml-1 text-xs text-muted" title="Compared with last season: fewer than 10 earlier games this season">
                      LY
                    </span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {Math.round(f.minLast3)} <span className="text-xs text-muted">({Math.round(f.minBaseline)})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function MonitoringPage({ searchParams }: PageProps<"/monitoring">) {
  const { sd, show } = await searchParams;
  const threshold = THRESHOLDS.find((t) => String(t) === sd) ?? DEFAULT_THRESHOLD;
  const everyone = show === "all";

  const supabase = await createClient();
  const [monitoring, dashboard, { data: auth }] = await Promise.all([
    loadMonitoring(supabase),
    loadDashboard(supabase),
    supabase.auth.getClaims(),
  ]);
  const heldBy = heldByMap(dashboard);
  const { risers, droppers } = monitoring.ok ? pickFlags(monitoring.flags, threshold, everyone) : { risers: [], droppers: [] };

  const href = (next: { sd?: number; all?: boolean }) => {
    const params = new URLSearchParams();
    const t = next.sd ?? threshold;
    if (t !== DEFAULT_THRESHOLD) params.set("sd", String(t));
    if (next.all ?? everyone) params.set("show", "all");
    const q = params.toString();
    return q ? `/monitoring?${q}` : "/monitoring";
  };
  const pill = (label: string, to: string, selected: boolean) => (
    <Link
      key={label}
      href={to}
      aria-current={selected ? "true" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${
        selected ? "bg-foreground text-background" : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="page-panel">
      <AppHeader active="monitoring" email={auth?.claims?.email as string | undefined} />

      <p className="mt-6 text-sm text-muted">
        {monitoring.ok && monitoring.date
          ? `Through games on ${gameDateLabel(addDays(monitoring.date, -1))}. `
          : ""}
        Last 3 games compared with the 10 before them and with the season so far, in each player&apos;s own standard deviations
        of a 9-category value. Both gaps must clear the threshold. Top 50 players left out.
      </p>
      {!monitoring.ok && <p className="mt-2 text-sm text-danger">Couldn&apos;t load the snapshot: {monitoring.error}</p>}

      <nav className="mt-4 flex flex-wrap items-center gap-1" aria-label="Filters">
        {THRESHOLDS.map((t) => pill(`${t.toFixed(1)} s.d.`, href({ sd: t }), t === threshold))}
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        {pill("Rosterable", href({ all: false }), !everyone)}
        {pill("Everyone", href({ all: true }), everyone)}
      </nav>

      <main className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface px-4 pt-3 pb-1">
          <h2 className="font-semibold">
            Risers <span className="font-normal text-muted">{risers.length}</span>
          </h2>
          <p className="text-sm text-muted">{everyone ? "Strongest first." : "Last 3 games at an average rotation player's level or better."}</p>
          <FlagTable flags={risers} heldBy={heldBy} emptyText={monitoring.ok && !monitoring.date ? "No snapshot yet. It's made each morning after the box scores load." : "Nobody at this threshold."} />
        </section>
        <section className="rounded-xl border border-border bg-surface px-4 pt-3 pb-1">
          <h2 className="font-semibold">
            Droppers <span className="font-normal text-muted">{droppers.length}</span>
          </h2>
          <p className="text-sm text-muted">{everyone ? "Strongest first." : "Players who were at a rotation player's level before the slump."}</p>
          <FlagTable flags={droppers} heldBy={heldBy} emptyText={monitoring.ok && !monitoring.date ? "No snapshot yet. It's made each morning after the box scores load." : "Nobody at this threshold."} />
        </section>
      </main>
    </div>
  );
}
