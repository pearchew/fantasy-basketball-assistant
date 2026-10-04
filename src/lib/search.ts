import type { DirectoryPlayer } from "./dashboard";
import { nameKey } from "./names";

const MAX_RESULTS = 8;

/** Every query word must start a word of the player's name: "j bru" finds Jalen Brunson. */
export function searchPlayers(directory: DirectoryPlayer[], query: string): DirectoryPlayer[] {
  const words = nameKey(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hits: { p: DirectoryPlayer; starts: boolean }[] = [];
  for (const p of directory) {
    const parts = nameKey(p.name).split(" ");
    if (words.every((w) => parts.some((part) => part.startsWith(w)))) {
      hits.push({ p, starts: parts[0].startsWith(words[0]) });
    }
  }
  hits.sort((a, b) => Number(b.starts) - Number(a.starts) || a.p.name.localeCompare(b.p.name));
  return hits.slice(0, MAX_RESULTS).map((h) => h.p);
}
