-- On/off splits: for each injured player, his current teammates' per-game averages in the
-- team's games he sat versus the games he played. Computed when the feed loads, so it is
-- always up to date. Replaces the stored next-up calls (0003, 0006).

create or replace function public.on_off_splits(p_players text[], p_teams text[], p_seasons int[], p_before date)
returns table (
  subject_id  text,
  team_abbr   text,
  season      int,
  teammate_id text,    -- null: the subject's own row, counting the games he sat and played
  teammate_name text,
  sat         boolean,
  games       int,     -- games the teammate was on the box score (a "did not play" counts as zero)
  starts      int,
  min numeric, pts numeric, reb numeric, ast numeric, stl numeric, blk numeric, tpm numeric, tov numeric,
  fgm int, fga int, ftm int, fta int
)
language sql
stable
security invoker
set search_path = public
as $$
  with subjects as (
    select distinct s.player_id, s.team_abbr
    from unnest(p_players, p_teams) as s (player_id, team_abbr)
  ),
  lines as (
    select l.*, (not l.did_not_play and l.min > 0) as played
    from public.game_logs l
    where l.season = any (p_seasons)
      and l.season_type = 2
      and l.counts_for_stats
      and l.game_date < p_before
  ),
  -- Which of the team's games he could have sat. If he played for another team that season,
  -- only games since his first appearance here; otherwise the whole season, so a player
  -- injured since opening night counts as sitting every game. Materialized so the lookups
  -- run once per player and season, not once per box-score line.
  since as materialized (
    select s.player_id, s.team_abbr, x.season,
           case
             when exists (
               select 1 from public.game_logs o
               where o.player_id = s.player_id and o.season = x.season and o.season_type = 2
                 and o.team_abbr <> s.team_abbr and o.game_date < p_before
             )
             then (
               select min(o.game_date) from public.game_logs o
               where o.player_id = s.player_id and o.team_abbr = s.team_abbr and o.season = x.season
                 and o.season_type = 2 and o.counts_for_stats and o.game_date < p_before
             )
             else (
               select min(o.game_date) from public.game_logs o
               where o.team_abbr = s.team_abbr and o.season = x.season
                 and o.season_type = 2 and o.counts_for_stats and o.game_date < p_before
             )
           end as first_game
    from subjects s
    cross join unnest(p_seasons) as x (season)
  ),
  team_games as materialized (
    select s.player_id as subject_id, s.team_abbr, s.season, l.event_id,
           not bool_or(l.player_id = s.player_id and l.played) as sat
    from since s
    join lines l on l.team_abbr = s.team_abbr and l.season = s.season and l.game_date >= s.first_game
    group by 1, 2, 3, 4
  )
  select g.subject_id, g.team_abbr, g.season, null::text, null::text, g.sat, count(*)::int, null::int,
         null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
         null::numeric, null::numeric, null::int, null::int, null::int, null::int
  from team_games g
  group by g.subject_id, g.team_abbr, g.season, g.sat
  union all
  select g.subject_id, g.team_abbr, g.season, l.player_id, p.name, g.sat,
         count(*)::int,
         (count(*) filter (where l.starter and l.played))::int,
         avg(case when l.played then l.min else 0 end),
         avg(case when l.played then l.pts else 0 end),
         avg(case when l.played then l.reb else 0 end),
         avg(case when l.played then l.ast else 0 end),
         avg(case when l.played then l.stl else 0 end),
         avg(case when l.played then l.blk else 0 end),
         avg(case when l.played then l.tpm else 0 end),
         avg(case when l.played then l.tov else 0 end),
         (sum(l.fgm) filter (where l.played))::int,
         (sum(l.fga) filter (where l.played))::int,
         (sum(l.ftm) filter (where l.played))::int,
         (sum(l.fta) filter (where l.played))::int
  from team_games g
  join lines l on l.event_id = g.event_id and l.team_abbr = g.team_abbr and l.player_id <> g.subject_id
  -- Current roster only: players who have left the team aren't worth picking up for it.
  join public.players p on p.espn_id = l.player_id and p.team_abbr = g.team_abbr and p.active
  group by g.subject_id, g.team_abbr, g.season, l.player_id, p.name, g.sat
$$;

-- The next-up calls and their Gemini allowance are no longer used. Their tables are left in
-- place; drop them when you're sure you won't want the old calls back:
--   drop function if exists public.reserve_model_calls(date, text, int, int);
--   drop table if exists public.model_budget;
--   drop table if exists public.next_up;
