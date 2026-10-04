import { cookies } from "next/headers";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { RefreshControls } from "@/components/RefreshControls";
import { TimeZoneControl } from "@/components/TimeZoneControl";
import { OwnerTags, StatusBadge, TYPE_LABEL, UpdateItem } from "@/components/UpdateItem";
import { isStale, loadFeed, STATUS_ORDER, type Game } from "@/lib/feed";
import { ago, clock, dayLabel, gameDateLabel, localDate, when } from "@/lib/format";
import { loadStats, type StatsLookup } from "@/lib/stats";
import { StatsPanel } from "@/components/StatsPanel";
import { createClient } from "@/lib/supabase/server";
import { timeZoneFrom } from "@/lib/timezone";
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

const STATUS_WORD: Record<string, string> = { out: "out", doubtful: "doubtful", questionable: "questionable", probable: "probable", available: "available" };

/** One game, closed by default; the summary line says what's inside. */
function GameDropdown({ game, tz, stats }: { game: Game; tz: string; stats: StatsLookup }) {
  const [away, home] = game.matchup.split("@");
  // "Available" players are playing: worth seeing inside the game, noise in the summary.
  const counts = STATUS_ORDER.filter((s) => s !== "available" && game.counts[s]).map((s) => `${game.counts[s]} ${STATUS_WORD[s]}`);
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 select-none">
        <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        <span className="font-semibold">
          {away} <span className="font-normal text-muted">@</span> {home}
        </span>
        <span className="text-sm text-muted">{game.start ? clock(game.start, tz) : "time TBC"}</span>
        <span className="text-sm text-muted">{counts.join(" · ") || "No absences"}</span>
        {game.mine > 0 && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
            {game.mine} of yours
          </span>
        )}
        {game.gains > 0 && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
            {game.gains} of yours gain{game.gains === 1 ? "s" : ""}
          </span>
        )}
      </summary>
      <div className="space-y-3 border-t border-border px-4 pb-1">
        {game.teams.map((t) => (
          <div key={t.name}>
            <h3 className="pt-3 text-sm font-semibold">{t.name}</h3>
            <ul className="divide-y divide-border">
              {t.updates.map((u) => (
                <UpdateItem key={u.id} u={u} tz={tz} stats={stats} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const { date } = await searchParams;
  const today = easternDate();
  // ?date=YYYY-MM-DD shows one past game day from the archive.
  const archiveDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today ? date : null;
  const zone = timeZoneFrom(await cookies());
  const tz = zone.tz;
  const supabase = await createClient();
  const [{ feed, state }, { data: auth }] = await Promise.all([
    loadFeed(supabase, archiveDate ?? today, { onlyDate: !!archiveDate }),
    supabase.auth.getClaims(),
  ]);

  // Form for my players and everyone named as next up: one database call.
  const statIds = [
    ...feed.mine.map((u) => u.playerId),
    ...feed.games.flatMap((g) => g.teams.flatMap((t) => t.updates.flatMap((u) => (u.nextUp ?? []).map((b) => b.player_id)))),
  ].filter((id): id is string => !!id);
  const stats = await loadStats(supabase, statIds);

  // Day headings follow the tip-off date in my time zone.
  const days: { label: string; games: Game[] }[] = [];
  for (const g of feed.games) {
    const key = g.start ? localDate(g.start, tz) : g.gameDate;
    const last = days.at(-1);
    if (last && last.label === key) last.games.push(g);
    else days.push({ label: key, games: [g] });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <AppHeader active="feed" email={auth?.claims?.email as string | undefined} />

      <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{state.lastReportTime ? `Latest report: ${when(state.lastReportTime, tz)}` : "No report loaded yet"}</span>
        {state.lastSuccessAt && <span>· checked {ago(state.lastSuccessAt)}</span>}
        {!archiveDate && <RefreshControls stale={isStale(state)} />}
      </p>
      {archiveDate && (
        <p className="mt-2 rounded-lg bg-accent-soft p-3 text-sm">
          Archive: games on {gameDateLabel(archiveDate)} (US Eastern).{" "}
          <Link href="/" className="font-medium underline">
            Back to upcoming games
          </Link>
        </p>
      )}
      {state.lastError && <p className="mt-1 text-sm text-danger">Last refresh failed: {state.lastError}</p>}

      <main className="mt-4 space-y-4">
        {feed.games.length === 0 && (
          <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            {archiveDate ? "No injury updates stored for that day." : "No injury updates for upcoming games. The NBA publishes reports on game days."}
          </p>
        )}

        {feed.opportunities.length > 0 && (
          <Section title="Your players who gain" hint="Named as next up because a teammate is out.">
            <ul className="divide-y divide-border">
              {feed.opportunities.map(({ call, because }) => (
                <li key={`${because[0].gameDate}|${call.player_id}`} className="py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{call.name}</span>
                    <span className="text-xs text-muted">{TYPE_LABEL[call.type]}</span>
                    <OwnerTags heldOn={call.heldOn} />
                    {call.questionable && <StatusBadge status="questionable" />}
                  </span>
                  <span className="block text-muted">
                    {because.map((u) => `${u.playerName} ${u.status}`).join(", ")} · {because[0].matchup.replace("@", " @ ")}
                  </span>
                  <span className="block">{call.reason}</span>
                  <StatsPanel playerId={call.player_id} stats={stats} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {feed.mine.length > 0 && (
          <Section title="Your players" hint="On your teams or watchlist.">
            <ul className="divide-y divide-border">
              {feed.mine.map((u) => (
                <UpdateItem key={u.id} u={u} tz={tz} stats={stats} showGame />
              ))}
            </ul>
          </Section>
        )}

        {days.map((d) => (
          <section key={d.label} className="space-y-2">
            <h2 className="pt-2 text-sm font-semibold tracking-wide text-muted uppercase">
              {d.games[0].start ? dayLabel(d.games[0].start, tz) : gameDateLabel(d.games[0].gameDate)} ·{" "}
              {d.games.length} {d.games.length === 1 ? "game" : "games"}
            </h2>
            {d.games.map((g) => (
              <GameDropdown key={g.key} game={g} tz={tz} stats={stats} />
            ))}
          </section>
        ))}

        {feed.unmatched.length > 0 && (
          <p className="text-sm text-muted">
            Couldn&apos;t match {feed.unmatched.length} name{feed.unmatched.length === 1 ? "" : "s"} to a player:{" "}
            {feed.unmatched.map((u) => `${u.playerName} (${u.teamAbbr ?? u.teamName})`).join(", ")}. They still show in their games.
          </p>
        )}
      </main>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Source: the NBA&apos;s official injury report. Games already played are archived.{" "}
          <Link href="/teams" className="underline">
            Edit your teams
          </Link>
        </span>
        <TimeZoneControl tz={zone.tz} manual={zone.manual} known={zone.known} />
      </footer>
    </div>
  );
}
