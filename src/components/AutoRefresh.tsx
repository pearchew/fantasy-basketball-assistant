"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** When the stored report is stale, asks the server to fetch a new one, then reloads the data. */
export function AutoRefresh({ stale }: { stale: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"idle" | "checking" | "failed">("idle");

  useEffect(() => {
    if (!stale || started.current) return;
    started.current = true;
    setState("checking");
    fetch("/api/refresh", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setState("idle");
        if (body.status === "ingested") router.refresh();
      })
      .catch(() => setState("failed"));
  }, [stale, router]);

  if (state === "checking") return <span className="text-accent">Checking for a new report…</span>;
  if (state === "failed") return <span className="text-danger">Couldn&apos;t reach the NBA report; showing saved data.</span>;
  return null;
}
