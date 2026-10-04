const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Canonical key for matching player names across sources.
 * Strips accents, punctuation and generational suffixes, lowercases.
 * "Luka Dončić" -> "luka doncic", "Dereck Lively II" -> "dereck lively".
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((part) => part && !SUFFIXES.has(part))
    .join(" ");
}

/**
 * The official injury report lists players as "Last, First" with any suffix
 * before the comma ("Lively II, Dereck"). Returns "First Last Suffix".
 */
export function flipReportName(raw: string): string {
  const comma = raw.indexOf(",");
  if (comma === -1) return raw.trim();
  const last = raw.slice(0, comma).trim();
  const first = raw.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}
