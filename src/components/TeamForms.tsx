"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTeam, deleteTeam, updateTeam } from "@/app/actions";
import { FORMAT_LABELS, type LeagueFormat, type Team } from "@/lib/dashboard";

const inputClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

function FormatSelect({ value, onChange }: { value: LeagueFormat; onChange: (f: LeagueFormat) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as LeagueFormat)} aria-label="Format" className={inputClass}>
      {(Object.keys(FORMAT_LABELS) as LeagueFormat[]).map((f) => (
        <option key={f} value={f}>
          {FORMAT_LABELS[f]}
        </option>
      ))}
    </select>
  );
}

export function NewTeamForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<LeagueFormat>("h2h_9cat");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await createTeam(name, format);
          if (r.error) return setError(r.error);
          setName("");
          onDone?.();
          router.push(`/?view=${r.id}`);
        });
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        aria-label="Team name"
        maxLength={60}
        className={`min-w-0 flex-1 ${inputClass}`}
      />
      <FormatSelect value={format} onChange={setFormat} />
      <button disabled={pending || !name.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        Create team
      </button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}

export function NewTeamButton() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">
        + New team
      </button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-border bg-surface p-3">
      <NewTeamForm onDone={() => setOpen(false)} />
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}

export function TeamSettings({ team, playerCount }: { team: Team; playerCount: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [format, setFormat] = useState(team.format);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{team.name}</h2>
        <span className="text-sm text-muted">
          {FORMAT_LABELS[team.format]} · {playerCount} {playerCount === 1 ? "player" : "players"}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="text-sm text-accent hover:underline">
          Edit
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateTeam(team.id, name, format);
          if (r.error) return setError(r.error);
          setEditing(false);
        });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" maxLength={60} className={`min-w-0 flex-1 ${inputClass}`} />
      <FormatSelect value={format} onChange={setFormat} />
      <button disabled={pending} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-2 text-sm text-muted">
        Cancel
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete "${team.name}" and its roster of ${playerCount}? This cannot be undone.`)) return;
          startTransition(async () => {
            const r = await deleteTeam(team.id);
            if (r.error) return setError(r.error);
            router.push("/?view=all");
          });
        }}
        className="ml-auto rounded-lg px-3 py-2 text-sm text-danger hover:bg-accent-soft"
      >
        Delete team
      </button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
