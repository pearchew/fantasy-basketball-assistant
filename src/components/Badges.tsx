import type { InjuryStatus } from "@/lib/sources/nbaInjuryReport";

const STATUS_STYLE: Record<InjuryStatus, string> = {
  out: "bg-danger text-white",
  doubtful: "bg-accent text-white",
  questionable: "bg-accent-soft text-accent",
  probable: "border border-border text-foreground",
  available: "border border-border text-muted",
};

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: InjuryStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{label(status)}</span>;
}

export function OwnerTags({ heldOn }: { heldOn: string[] }) {
  if (!heldOn.length) return <span className="text-xs text-muted">Unowned</span>;
  return (
    <>
      {heldOn.map((t) => (
        <span key={t} className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
          {t}
        </span>
      ))}
    </>
  );
}
