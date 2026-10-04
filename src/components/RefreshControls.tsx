"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Result = { status?: string; reason?: string; error?: string };

function describe(r: Result): string {
  if (r.error) return `Refresh failed: ${r.error}`;
  if (r.status === "ingested") return "Loaded a new report.";
  if (r.status === "unchanged") return "No new report since the last one.";
  if (r.status === "no-report") return "No report published recently (normal off game days).";
  if (r.status === "skipped") return `Already up to date: ${r.reason}.`;
  return "";
}

/** Refreshes automatically when the saved report is stale, and on demand with the button. */
export function RefreshControls({ stale }: { stale: boolean }) {
  const router = useRouter();
  const auto = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(manual: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual }),
      });
      const body: Result = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (manual || body.error) setMessage(describe(body));
      router.refresh();
    } catch {
      setMessage("Couldn't reach the server; showing saved data.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!stale || auto.current) return;
    auto.current = true;
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => refresh(true)}
        disabled={busy}
        className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-accent disabled:opacity-60"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {message && <span className={message.startsWith("Refresh failed") ? "text-danger" : ""}>{message}</span>}
    </span>
  );
}
