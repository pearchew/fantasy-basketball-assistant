"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RedoStatus } from "@/lib/nextUp/redo";

async function post(action: "start" | "continue"): Promise<{ message?: string; error?: string }> {
  const res = await fetch("/api/next-up/redo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}

/**
 * "Update next-up calls": redoes calls built before their team's latest box score. Shows the
 * cost in Gemini calls and the runs today's allowance still covers, and greys out when there's
 * nothing to update or the allowance can't cover another run. Batches continue on their own,
 * a minute apart, while the page is open.
 */
export function NextUpUpdate({ status }: { status: RedoStatus | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = status?.pending ?? 0;
  const nextBatchAt = status?.nextBatchAt ?? null;

  // Keep going while answers are waiting for their batch.
  useEffect(() => {
    if (!pending) return;
    const wait = nextBatchAt ? Math.max(0, new Date(nextBatchAt).getTime() - Date.now()) + 1500 : 1500;
    const timer = setTimeout(async () => {
      const r = await post("continue");
      if (r.error) setMessage(`Update failed: ${r.error}`);
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [pending, nextBatchAt, router]);

  if (!status) return null;

  const running = busy || pending > 0;
  const remaining = status.limit - status.used;
  const disabled = running || status.callsPerRun === 0 || status.runsLeft === 0;

  let detail: string;
  if (pending > 0) detail = `Updating: ${pending} waiting for the next batch (about a minute apart)`;
  else if (status.callsPerRun === 0) detail = "Up to date with the latest box scores";
  else if (status.runsLeft === 0)
    detail = `Needs ${status.callsPerRun} Gemini calls; ${remaining} of today's ${status.limit} left. Resets at midnight ET`;
  else
    detail = `${status.callsPerRun} out of date · ~${status.callsPerRun} Gemini calls · ${status.runsLeft} run${status.runsLeft === 1 ? "" : "s"} left today`;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        title={`Redo next-up calls made before their team's latest game. Uses up to ${status.limit} Gemini calls a day (${status.used} used).`}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const r = await post("start");
          setMessage(r.error ? `Update failed: ${r.error}` : (r.message ?? null));
          setBusy(false);
          router.refresh();
        }}
        className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
      >
        {running ? "Updating next-up…" : "Update next-up calls"}
      </button>
      <span>{message && !pending ? message : detail}</span>
    </span>
  );
}
