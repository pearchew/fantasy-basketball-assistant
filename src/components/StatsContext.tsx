"use client";

import { createContext, useContext } from "react";
import type { StatsLookup } from "@/lib/stats";

// Recent form for every player on the page, sent to the browser once rather than with each table.
const StatsContext = createContext<StatsLookup | null>(null);

export function StatsProvider({ stats, children }: { stats: StatsLookup | null; children: React.ReactNode }) {
  return <StatsContext.Provider value={stats}>{children}</StatsContext.Provider>;
}

export const useStats = () => useContext(StatsContext);
