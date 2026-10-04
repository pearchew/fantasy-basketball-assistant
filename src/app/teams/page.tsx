import Link from "next/link";
import { PlayerSearch } from "@/components/PlayerSearch";
import { PlayerTable } from "@/components/PlayerTable";
import { NewTeamButton, NewTeamForm, TeamSettings } from "@/components/TeamForms";
import { loadDashboard, type Dashboard } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";

function heldByMap(d: Dashboard): Record<string, string[]> {
  const held: Record<string, string[]> = {};
  for (const t of d.teams) for (const p of d.rosters[t.id]) (held[p.espnId] ??= []).push(t.name);
  for (const p of d.watchlist) (held[p.espnId] ??= []).push("Watchlist");
  return held;
}

export default async function TeamsPage({ searchParams }: PageProps<"/teams">) {
  const { view: rawView } = await searchParams;
  const supabase = await createClient();
  const [data, { data: auth }] = await Promise.all([loadDashboard(supabase), supabase.auth.getClaims()]);

  const requested = typeof rawView === "string" ? rawView : undefined;
  const team = data.teams.find((t) => t.id === requested);
  const view = team ? team.id : requested === "watchlist" ? "watchlist" : requested === "all" || !data.teams.length ? "all" : data.teams[0].id;
  const current = data.teams.find((t) => t.id === view);
  const heldBy = heldByMap(data);

  const tab = (href: string, label: string, count: number, selected: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${
        selected ? "bg-foreground text-background" : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {label} <span className="opacity-60">{count}</span>
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <AppHeader active="teams" email={auth?.claims?.email as string | undefined} />

      {data.directory.length === 0 && (
        <p className="mt-4 rounded-lg bg-accent-soft p-3 text-sm">
          The player directory is empty. Run the daily sync once (<code>npm run sync-players</code>) to load NBA rosters.
        </p>
      )}

      <nav className="mt-6 flex flex-wrap items-center gap-1" aria-label="Teams">
        {tab("/teams?view=all", "All teams", data.teams.reduce((n, t) => n + data.rosters[t.id].length, 0), view === "all")}
        {data.teams.map((t) => tab(`/teams?view=${t.id}`, t.name, data.rosters[t.id].length, view === t.id))}
        {tab("/teams?view=watchlist", "Watchlist", data.watchlist.length, view === "watchlist")}
        <NewTeamButton />
      </nav>

      <main className="mt-4 space-y-4">
        {current && (
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <TeamSettings key={current.id} team={current} playerCount={data.rosters[current.id].length} />
            <PlayerSearch directory={data.directory} target={current.id} teams={data.teams} heldBy={heldBy} />
            <PlayerTable players={data.rosters[current.id]} context={current.id} emptyText="No players yet. Search above to add one." />
          </section>
        )}

        {view === "watchlist" && (
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div>
              <h2 className="text-lg font-semibold">Watchlist</h2>
              <p className="text-sm text-muted">Players you don&apos;t own but want to track.</p>
            </div>
            <PlayerSearch directory={data.directory} target="watchlist" teams={data.teams} heldBy={heldBy} />
            <PlayerTable players={data.watchlist} context="watchlist" emptyText="Nobody on the watchlist yet." />
          </section>
        )}

        {view === "all" &&
          (data.teams.length === 0 ? (
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="text-lg font-semibold">Create your first team</h2>
              <NewTeamForm />
            </section>
          ) : (
            <>
              <PlayerSearch directory={data.directory} target={null} teams={data.teams} heldBy={heldBy} />
              {data.teams.map((t) => (
                <section key={t.id} className="rounded-xl border border-border bg-surface p-4">
                  <Link href={`/teams?view=${t.id}`} className="font-semibold hover:underline">
                    {t.name}
                  </Link>
                  <PlayerTable players={data.rosters[t.id]} context={t.id} emptyText="No players yet." />
                </section>
              ))}
            </>
          ))}
      </main>
    </div>
  );
}
