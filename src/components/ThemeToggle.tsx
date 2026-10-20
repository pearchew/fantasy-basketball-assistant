"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;
const DARK_QUERY = "(prefers-color-scheme: dark)";

// The theme in effect: a hand-picked one on <html data-theme>, else the device setting.
function current(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/** Flips between light and dark, and remembers the choice on this device. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => null);
  if (!theme) return null;
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax`;
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="rounded-lg border-2 border-white/30 px-2 py-1 font-pixel text-[10px] text-white hover:border-white/70 sm:text-xs"
    >
      {theme === "dark" ? "☀ LIGHT" : "☾ DARK"}
    </button>
  );
}
