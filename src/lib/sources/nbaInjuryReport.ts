// The NBA's official injury report: a PDF table republished every 15 minutes
// on game days at a predictable URL. Primary v1 availability source.
import { getDocumentProxy } from "unpdf";
import { flipReportName } from "../names";
import { fetchWithTimeout } from "./http";

const BASE = "https://ak-static.cms.nba.com/referee/injury";
const SLOT_MINUTES = 15;

export type InjuryStatus = "out" | "doubtful" | "questionable" | "probable" | "available";

export type InjuryEntry = {
  gameDate: string; // YYYY-MM-DD
  gameTime: string; // "07:30 (ET)"
  matchup: string; // "DAL@CLE"
  team: string; // "Dallas Mavericks"
  playerRaw: string; // as printed: "Lively II, Dereck"
  playerName: string; // "Dereck Lively II"
  status: InjuryStatus;
  reason: string;
  /** The printed line(s) for this row, top to bottom: wrapped reasons span up to three lines. */
  rawText: string;
};

export type NotSubmitted = { gameDate: string; matchup: string; team: string };

export type InjuryReport = {
  reportTime: string | null; // as printed: "03/15/26 05:00 PM"
  entries: InjuryEntry[];
  notSubmitted: NotSubmitted[];
  /** Rows that could not be parsed cleanly; surfaced for review, never dropped silently. */
  warnings: string[];
};

/** Wall-clock parts of `instant` in US Eastern time. */
function easternParts(instant: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "dayPeriod", string>;
}

/** URL of the report published in the 15-minute slot containing `instant`. */
export function reportUrlFor(instant: Date): string {
  const p = easternParts(instant);
  const minute = String(Math.floor(Number(p.minute) / SLOT_MINUTES) * SLOT_MINUTES).padStart(2, "0");
  return `${BASE}/Injury-Report_${p.year}-${p.month}-${p.day}_${p.hour}_${minute}${p.dayPeriod.toUpperCase()}.pdf`;
}

/**
 * Walks back from `now` one slot at a time until a published report is found.
 * Off game days nothing is published, so give up after `maxSlots`.
 */
export async function findLatestReport(
  now = new Date(),
  maxSlots = 16,
): Promise<{ url: string; bytes: Uint8Array } | null> {
  for (let i = 0; i < maxSlots; i++) {
    const url = reportUrlFor(new Date(now.getTime() - i * SLOT_MINUTES * 60_000));
    const res = await fetchWithTimeout(url);
    if (res.ok) return { url, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  return null;
}

export async function fetchReport(url: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

type Token = { x: number; y: number; str: string };
type Column = "date" | "time" | "matchup" | "team" | "player" | "status" | "reason";
type Columns = { name: Column; x: number }[];

const STATUSES = new Set<InjuryStatus>(["out", "doubtful", "questionable", "probable", "available"]);
const ROW_TOLERANCE = 2;

function groupRows(tokens: Token[]): Token[][] {
  const rows: Token[][] = [];
  for (const t of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - t.y) <= ROW_TOLERANCE);
    if (row) row.push(t);
    else rows.push([t]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/** Column start positions taken from the header row ("Game Date ... Reason"). */
function headerColumns(row: Token[]): Columns | null {
  const text = row.map((t) => t.str).join(" ");
  if (!/Player/.test(text) || !/Reason/.test(text)) return null;
  const xs = (word: string) => row.filter((t) => t.str === word).map((t) => t.x);
  const [date, time] = xs("Game");
  const cols: Columns = [
    { name: "date", x: date },
    { name: "time", x: time },
    { name: "matchup", x: xs("Matchup")[0] },
    { name: "team", x: xs("Team")[0] },
    { name: "player", x: xs("Player")[0] },
    { name: "status", x: xs("Current")[0] },
    { name: "reason", x: xs("Reason")[0] },
  ];
  return cols.every((c) => c.x !== undefined) ? cols : null;
}

function cellsOf(row: Token[], cols: Columns): Partial<Record<Column, string>> {
  const cells: Partial<Record<Column, string[]>> = {};
  for (const t of row) {
    // Data starts a point or two right of its header; allow a little slack.
    const col = [...cols].reverse().find((c) => t.x >= c.x - 4) ?? cols[0];
    (cells[col.name] ??= []).push(t.str);
  }
  return Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, joinTokens(v!)]));
}

/** Joins tokens with spaces, except after a word-ending hyphen ("Two-" + "Way"). */
function joinTokens(parts: string[]): string {
  return parts.reduce((acc, s) => (!acc ? s : /\w-$/.test(acc) ? acc + s : `${acc} ${s}`), "");
}

function isoDate(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split("/");
  return `${y}-${m}-${d}`;
}

type Line = { y: number; text: string };
type PendingEntry = {
  entry: Omit<InjuryEntry, "reason" | "rawText">;
  y: number;
  reasonParts: Line[];
  lines: Line[];
};

export async function parseInjuryReport(bytes: Uint8Array): Promise<InjuryReport> {
  // pdf.js transfers (detaches) the buffer it is given; copy so callers keep theirs.
  const pdf = await getDocumentProxy(bytes.slice());
  const entries: InjuryEntry[] = [];
  const notSubmitted: NotSubmitted[] = [];
  const warnings: string[] = [];
  let reportTime: string | null = null;
  let cols: Columns | null = null;
  // Date, time, matchup and team are printed once per block and blank below.
  const ctx = { date: "", time: "", matchup: "", team: "" };

  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const tokens: Token[] = content.items
      .filter((it) => "str" in it && it.str.trim())
      .map((it) => {
        const item = it as { str: string; transform: number[] };
        return { str: item.str.trim(), x: item.transform[4], y: item.transform[5] };
      });

    const pageEntries: PendingEntry[] = [];
    const fragments: (Line & { rowText: string })[] = [];
    let headerY = Infinity;

    for (const row of groupRows(tokens)) {
      const text = row.map((t) => t.str).join(" ");
      const title = text.match(/^Injury Report:\s*(.+)$/);
      if (title) {
        reportTime = title[1];
        continue;
      }
      if (/^Page \d+ of \d+$/.test(text)) continue;
      const header = headerColumns(row);
      if (header) {
        cols = header;
        headerY = row[0].y;
        continue;
      }
      if (!cols || row[0].y > headerY) continue;

      const c = cellsOf(row, cols);
      if (c.date) ctx.date = isoDate(c.date);
      if (c.time) ctx.time = c.time;
      if (c.matchup) ctx.matchup = c.matchup;
      if (c.team) ctx.team = c.team;

      if (c.player) {
        const status = (c.status ?? "").toLowerCase() as InjuryStatus;
        if (!STATUSES.has(status)) {
          warnings.push(`page ${p}: unknown status "${c.status ?? ""}" for ${c.player}`);
          continue;
        }
        pageEntries.push({
          entry: {
            gameDate: ctx.date,
            gameTime: ctx.time,
            matchup: ctx.matchup,
            team: ctx.team,
            playerRaw: c.player,
            playerName: flipReportName(c.player),
            status,
          },
          y: row[0].y,
          reasonParts: c.reason ? [{ y: row[0].y, text: c.reason }] : [],
          lines: [{ y: row[0].y, text: joinTokens(row.map((t) => t.str)) }],
        });
      } else if (c.reason && /NOT YET SUBMITTED/i.test(c.reason)) {
        notSubmitted.push({ gameDate: ctx.date, matchup: ctx.matchup, team: ctx.team });
      } else if (c.reason) {
        fragments.push({ y: row[0].y, text: c.reason, rowText: joinTokens(row.map((t) => t.str)) });
      }
    }

    // Long reasons wrap onto lines above and below the player's row.
    for (const f of fragments) {
      const nearest = pageEntries.reduce<PendingEntry | null>(
        (best, e) => (!best || Math.abs(e.y - f.y) < Math.abs(best.y - f.y) ? e : best),
        null,
      );
      nearest?.reasonParts.push(f);
      nearest?.lines.push({ y: f.y, text: f.rowText });
    }
    for (const { entry, reasonParts, lines } of pageEntries) {
      const reason = reasonParts
        .sort((a, b) => b.y - a.y)
        .map((r) => r.text)
        .join(" ")
        .trim();
      const rawText = lines
        .sort((a, b) => b.y - a.y)
        .map((l) => l.text)
        .join("\n");
      entries.push({ ...entry, reason: reason === "-" ? "" : reason, rawText });
    }
  }

  return { reportTime, entries, notSubmitted, warnings };
}
