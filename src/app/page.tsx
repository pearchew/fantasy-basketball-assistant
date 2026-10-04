import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusBadge, UpdateItem } from "@/components/UpdateItem";
import { isStale, loadFeed, type FeedUpdate } from "@/lib/feed";
import { ago, easternClock, gameDayLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { easternDate } from "@/lib/time";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-4 pt-3 pb-1">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function Collapsed({ title, updates, today }: { title: string; updates: FeedUpdate[]; today: string }) {
  return (
    <details className="rounded-xl border border-border bg-surface px-4 py-3">
      <summary className="cursor-pointer font-semibold select-none">
        {title} <span className="font-normal text-muted">{updates.length}</span>
      </summary>
      <ul className="divide-y divide-border">
        {updates.map((u) => (
          <UpdateItem key={u.id} u={u} today={today} />
        ))}
      </ul>
    </details>
  );
}

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const { date } = await searchParams;
  const today = easternDate();
  // ?date=YYYY-MM-DD shows one past game day from the archive.
  const archiveDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today ? date : null;
  const supabase = await createClient();
  const [{ feed, state }, { data: auth }] = await Promise.all([
    loadFeed(supabase, archiveDate ?? today, { onlyDate: !!archiveDate }),
    supabase.auth.getClaims(),
  ]);
  const total =
    feed.mine.length + feed.newAndChanged.length + feed.gLeague.length + feed.unmatched.length +
    feed.ongoingByTeam.reduce((n, t) => n + t.updates.length, 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <AppHeader active="feed" email={auth?.claims?.email as string | undefined} />

      <p className="mt-6 flex flex-wrap gap-x-2 text-sm text-muted">
        <span>
          {state.lastReportTime
            ? `Latest report: ${gameDayLabel(easternDate(new Date(state.lastReportTime)), today)} ${easternClock(state.lastReportTime)}`
            : "No report loaded yet"}
        </span>
        {state.lastSuccessAt && <span>· checked {ago(state.lastSuccessAt)}</span>}
        {!archiveDate && <AutoRefresh stale={isStale(state)} />}
      </p>
      {archiveDate && (
        <p className="mt-2 rounded-lg bg-accent-soft p-3 text-sm">
          Archive: games on {gameDayLabel(archiveDate, today)}.{" "}
          <Link href="/" className="font-medium underline">
            Back to upcoming games
          </Link>
        </p>
      )}
      {state.lastError && <p className="mt-1 text-sm text-danger">Last refresh failed: {state.lastError}</p>}

      <main className="mt-4 space-y-4">
        {total === 0 && (
          <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            {archiveDate ? "No injury updates stored for that day." : "No injury updates for upcoming games. The NBA publishes reports on game days."}
          </p>
        )}

        {feed.mine.length > 0 && (
          <Section title="Your players" hint="On your teams or watchlist.">
            <ul className="divide-y divide-border">
              {feed.mine.map((u) => (
                <UpdateItem key={u.id} u={u} today={today} />
              ))}
            </ul>
          </Section>
        )}

        {feed.newAndChanged.length > 0 && (
          <Section title="New and changed" hint="Around the league, newest first.">
            <ul className="divide-y divide-border">
              {feed.newAndChanged.map((u) => (
                <UpdateItem key={u.id} u={u} today={today} />
              ))}
            </ul>
          </Section>
        )}

        {feed.ongoingByTeam.length > 0 && (
          <details className="rounded-xl border border-border bg-surface px-4 py-3">
            <summary className="cursor-pointer font-semibold select-none">
              Still out, unchanged{" "}
              <span className="font-normal text-muted">{feed.ongoingByTeam.reduce((n, t) => n + t.updates.length, 0)}</span>
            </summary>
            <ul className="mt-2 space-y-2 text-sm">
              {feed.ongoingByTeam.map(({ team, updates }) => (
                <li key={team}>
                  <span className="font-medium">{team}:</span>{" "}
                  {updates.map((u, i) => (
                    <span key={u.id}>
                      {i > 0 && ", "}
                      {u.playerName} <StatusBadge status={u.status} /> <span className="text-muted">{u.reason}</span>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </details>
        )}

        {feed.gLeague.length > 0 && <Collapsed title="G League and two-way" updates={feed.gLeague} today={today} />}

        {feed.unmatched.length > 0 && (
          <Collapsed title="Names the tool couldn't match: check these" updates={feed.unmatched} today={today} />
        )}
      </main>

      <p className="mt-6 text-xs text-muted">
        Source: the NBA&apos;s official injury report. Updates for games already played are archived.{" "}
        <Link href="/teams" className="underline">
          Edit your teams
        </Link>
      </p>
    </div>
  );
}
