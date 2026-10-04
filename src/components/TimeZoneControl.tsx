"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { TZ_COOKIE, TZ_MANUAL_COOKIE } from "@/lib/timezone";

const YEAR = 60 * 60 * 24 * 365;
const AUTO = "__auto__";

function setCookie(name: string, value: string, maxAge = YEAR) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Keeps the display time zone in step with this browser (so it follows you when
 * you travel), unless you picked one by hand. Re-renders the page when it changes.
 */
export function TimeZoneControl({ tz, manual, known }: { tz: string; manual: boolean; known: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (manual) return;
    const detected = browserZone();
    if (!known || detected !== tz) {
      setCookie(TZ_COOKIE, detected);
      router.refresh();
    }
  }, [tz, manual, known, router]);

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [tz];
    }
  }, [tz]);

  return (
    <label className="inline-flex items-center gap-1.5">
      <span>Times in</span>
      <select
        value={manual ? tz : AUTO}
        onChange={(e) => {
          if (e.target.value === AUTO) {
            setCookie(TZ_MANUAL_COOKIE, "", 0);
            setCookie(TZ_COOKIE, browserZone());
          } else {
            setCookie(TZ_MANUAL_COOKIE, "1");
            setCookie(TZ_COOKIE, e.target.value);
          }
          router.refresh();
        }}
        aria-label="Time zone"
        className="max-w-[16rem] rounded border border-border bg-surface px-1.5 py-0.5"
      >
        <option value={AUTO}>{manual ? "Automatic (this device)" : `${tz.replaceAll("_", " ")} (automatic)`}</option>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
