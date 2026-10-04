"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addToTeam, addToWatchlist } from "@/app/actions";
import type { DirectoryPlayer, Team } from "@/lib/dashboard";
import { searchPlayers } from "@/lib/search";

const WATCHLIST = "watchlist";

type Props = {
  directory: DirectoryPlayer[];
  /** Fixed destination, or null to let me choose (All teams view). */
  target: string | null;
  teams: Team[];
  /** player id -> where I already hold him, for the result list. */
  heldBy: Record<string, string[]>;
};

export function PlayerSearch({ directory, target, teams, heldBy }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState(teams[0]?.id ?? WATCHLIST);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchPlayers(directory, query), [directory, query]);
  const destination = target ?? chosen;

  function add(p: DirectoryPlayer) {
    setError(null);
    startTransition(async () => {
      const r = destination === WATCHLIST ? await addToWatchlist(p.espnId) : await addToTeam(destination, p.espnId);
      if (r.error) setError(r.error);
      setQuery("");
      setActive(0);
      input.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!results.length) return;
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % results.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + results.length) % results.length);
    else if (e.key === "Enter") add(results[active]);
    else if (e.key === "Escape") setQuery("");
    else return;
    e.preventDefault();
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Add a player: type a name"
          aria-label="Search players"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {target === null && (
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            aria-label="Add to"
            className="rounded-lg border border-border bg-surface px-2 py-2 text-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={WATCHLIST}>Watchlist</option>
          </select>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {results.map((p, i) => (
            <li key={p.espnId} role="option" aria-selected={i === active}>
              <button
                type="button"
                disabled={pending}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(p)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === active ? "bg-accent-soft" : ""
                }`}
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-muted">
                    {p.position} · {p.teamAbbr}
                  </span>
                </span>
                {heldBy[p.espnId]?.length ? (
                  <span className="truncate text-xs text-muted">on {heldBy[p.espnId].join(", ")}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
