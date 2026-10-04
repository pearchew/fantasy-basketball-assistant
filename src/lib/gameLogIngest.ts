// ESPN box scores -> public.games and public.game_logs, one date at a time.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLimit } from "./sources/http";
import { fetchBoxScore, fetchScoreboard } from "./sources/espn";
import { compactDate } from "./time";

/** Loads every completed game on an Eastern `isoDate`. Safe to re-run: rows are upserted. */
export async function ingestGameLogs(admin: SupabaseClient, isoDate: string) {
  const games = (await fetchScoreboard(compactDate(isoDate))).filter((g) => g.status === "STATUS_FINAL");
  if (!games.length) return { date: isoDate, games: 0, lines: 0 };

  const boxes = await mapLimit(games, 4, (g) => fetchBoxScore(g.eventId));

  const { error: gamesError } = await admin.from("games").upsert(
    games.map((g) => ({
      event_id: g.eventId,
      game_date: isoDate,
      season: g.season,
      season_type: g.seasonType,
      home_abbr: g.home,
      away_abbr: g.away,
      status: g.status,
    })),
    { onConflict: "event_id" },
  );
  if (gamesError) throw gamesError;

  const lines = boxes.flatMap((lines, i) =>
    lines.map((l) => ({
      event_id: l.eventId,
      player_id: l.espnId,
      player_name: l.name,
      team_abbr: l.teamAbbr,
      game_date: isoDate,
      season: games[i].season,
      season_type: games[i].seasonType,
      starter: l.starter,
      did_not_play: l.didNotPlay,
      min: l.min, pts: l.pts,
      fgm: l.fgm, fga: l.fga, tpm: l.tpm, tpa: l.tpa, ftm: l.ftm, fta: l.fta,
      reb: l.reb, ast: l.ast, stl: l.stl, blk: l.blk, tov: l.tov,
    })),
  );
  const { error: logsError } = await admin.from("game_logs").upsert(lines, { onConflict: "event_id,player_id" });
  if (logsError) throw logsError;

  return { date: isoDate, games: games.length, lines: lines.length };
}
