import { cookies } from "next/headers";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { OwnerTags, StatusBadge } from "@/components/Badges";
import { RefreshControls } from "@/components/RefreshControls";
import { StatsProvider } from "@/components/StatsContext";
import { TimeZoneControl } from "@/components/TimeZoneControl";
import { UpdateItem } from "@/components/UpdateItem";
import { isStale, loadFeed, STATUS_ORDER, type Game } from "@/lib/feed";
import { ago, clock, dayLabel, gameDateLabel, localDate, when } from "@/lib/format";
import { change, hasOnOff, loadOnOff, myGains, subjectKey, tableFor, type Gain, type OnOffTableData, type StatKey } from "@/lib/onOff";
import type { InjuryStatus } from "@/lib/sources/nbaInjuryReport";
import { currentSeason, loadStats, type StatsLookup } from "@/lib/stats";
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

type Tables = Map<number, OnOffTableData | string>;

const GAIN_PARTS: { key: Exclude<StatKey, "fgPct" | "ftPct">; label: string }[] = [
  { key: "min", label: "min" },
  { key: "pts", label: "pts" },
  { key: "reb", label: "reb" },
  { key: "ast", label: "ast" },
  { key: "tpm", label: "3PM" },
];

/** "Without Irving (8 g, 2025-26): +9.4 min · +5.2 pts · …", clear gains green and drops red. */
function GainLine({ g }: { g: Gain }) {
  const { without, with: withHim } = g.row;
  if (!without || !withHim) return null;
  const last = g.because.playerName.split(" ").slice(1).join(" ") || g.because.playerName;
  return (
    <span className="block text-xs text-muted">
      Without {last} ({without.games} g, {g.season.label}):{" "}
      {GAIN_PARTS.map((p, i) => {
        const d = without[p.key] - withHim[p.key];
        const t = change(p.key, without, withHim);
        return (
          <span key={p.key}>
            {i > 0 && " · "}
            <span className={t === "up" ? "text-good" : t === "down" ? "text-danger" : ""}>
              {d >= 0 ? "+" : "−"}
              {Math.abs(d).toFixed(1)} {p.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** One game, closed by default; the summary line says what's inside. */
function GameDropdown({ game, tz, stats, tables, gains }: { game: Game; tz: string; stats: StatsLookup; tables: Tables; gains: number }) {
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
        {gains > 0 && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
            {gains} of yours gain{gains === 1 ? "s" : ""}
          </span>
        )}
      </summary>
      <div className="space-y-3 border-t border-border px-4 pb-1">
        {game.teams.map((t) => (
          <div key={t.name}>
            <h3 className="pt-3 text-sm font-semibold">{t.name}</h3>
            <ul className="divide-y divide-border">
              {t.updates.map((u) => (
                <UpdateItem key={u.id} u={u} tz={tz} stats={stats} onOff={tables.get(u.id)} />
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
  const [{ feed, state, heldOn }, { data: auth }, season] = await Promise.all([
    loadFeed(supabase, archiveDate ?? today, { onlyDate: !!archiveDate }),
    supabase.auth.getClaims(),
    currentSeason(supabase).catch(() => null),
  ]);
  const updates = feed.games.flatMap((g) => g.teams.flatMap((t) => t.updates));

  // Teammates' splits for everyone out, doubtful, questionable or returning, from games before this day.
  const onOff = await loadOnOff(supabase, updates, season, archiveDate ?? today);
  const statuses = new Map<string, Record<string, InjuryStatus>>();
  for (const u of updates) {
    if (!u.playerId) continue;
    const k = `${u.gameDate}|${u.teamAbbr}`;
    statuses.set(k, { ...statuses.get(k), [u.playerId]: u.status });
  }
  const tables: Tables = new Map();
  for (const u of updates) {
    if (!hasOnOff(u)) continue;
    if (!onOff.ok) {
      tables.set(u.id, onOff.error);
      continue;
    }
    const data = onOff.bySubject[subjectKey(u.playerId, u.teamAbbr)];
    if (data) tables.set(u.id, tableFor(data, statuses.get(`${u.gameDate}|${u.teamAbbr}`) ?? {}, heldOn));
  }

  // My players who did clearly better when an out teammate sat, one entry per player and game.
  const gains = new Map<string, Gain[]>();
  const gainsByGame = new Map<string, Set<string>>();
  for (const u of updates) {
    const table = tables.get(u.id);
    if (!table || typeof table === "string") continue;
    for (const g of myGains(u, table)) {
      const k = `${u.gameDate}|${g.row.playerId}`;
      gains.set(k, [...(gains.get(k) ?? []), g]);
      const gameKey = `${u.gameDate}|${u.matchup}`;
      gainsByGame.set(gameKey, (gainsByGame.get(gameKey) ?? new Set()).add(g.row.playerId));
    }
  }
  const gainList = [...gains.values()];

  // Form for my players and every teammate in a table: one database call per 200 players.
  const statIds = [
    ...feed.mine.map((u) => u.playerId),
    ...[...tables.values()].flatMap((t) => (typeof t === "string" ? [] : t.seasons.flatMap((s) => s.rows.map((r) => r.playerId)))),
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
    <div className="page-panel">
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

      <StatsProvider stats={stats}>
      <main className="mt-4 space-y-4">
        {feed.games.length === 0 && (
          <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            {archiveDate ? "No injury updates stored for that day." : "No injury updates for upcoming games. The NBA publishes reports on game days."}
          </p>
        )}

        {gainList.length > 0 && (
          <Section title="Your players who gain" hint="Clearly better (+3 min or +3 pts a game, 3+ games each way) when an out teammate sat.">
            <ul className="divide-y divide-border">
              {gainList.map((gs) => {
                const { row } = gs[0];
                const u = gs[0].because;
                return (
                  <li key={`${u.gameDate}|${row.playerId}`} className="py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{row.name}</span>
                      <OwnerTags heldOn={row.heldOn} />
                      {row.status && <StatusBadge status={row.status} />}
                    </span>
                    <span className="block text-muted">
                      {gs.map((g) => `${g.because.playerName} ${g.because.status}`).join(", ")} · {u.matchup.replace("@", " @ ")}
                    </span>
                    {gs.map((g) => (
                      <GainLine key={g.because.id} g={g} />
                    ))}
                    <StatsPanel playerId={row.playerId} stats={stats} />
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {feed.mine.length > 0 && (
          <Section title="Your players" hint="On your teams or watchlist.">
            <ul className="divide-y divide-border">
              {feed.mine.map((u) => (
                <UpdateItem key={u.id} u={u} tz={tz} stats={stats} onOff={tables.get(u.id)} showGame />
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
              <GameDropdown key={g.key} game={g} tz={tz} stats={stats} tables={tables} gains={gainsByGame.get(g.key)?.size ?? 0} />
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
      </StatsProvider>

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
