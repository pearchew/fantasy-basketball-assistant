-- ESPN labels the All-Star games and the NBA Cup championship as "regular season",
-- but neither counts in official stats. Track ESPN's competition type and exclude them.
alter table public.games add column comp_type text not null default 'STD';  -- STD, ALLSTAR, CC (Cup championship), ...
alter table public.game_logs add column counts_for_stats boolean not null default true;

-- Rows already stored: All-Star teams aren't NBA franchises; the 2025 Cup final was event 401809839.
update public.games set comp_type = 'ALLSTAR' where home_abbr in ('STARS', 'STRIPES', 'WORLD') or away_abbr in ('STARS', 'STRIPES', 'WORLD');
update public.games set comp_type = 'CC' where event_id = '401809839';
update public.game_logs l set counts_for_stats = false
  from public.games g where g.event_id = l.event_id and g.comp_type <> 'STD';

create or replace function public.player_stat_windows(p_ids text[], p_season int)
returns table (
  player_id   text,
  window_size int,
  games       int,
  last_game   date,
  min numeric, pts numeric, reb numeric, ast numeric, stl numeric, blk numeric,
  tpm numeric, tov numeric, fga numeric, fta numeric,
  fgm_total int, fga_total int, ftm_total int, fta_total int
)
language sql
stable
security invoker
set search_path = public
as $$
  with played as (
    select l.*,
           row_number() over (partition by l.player_id order by l.game_date desc, l.event_id desc) as rn
    from public.game_logs l
    where l.player_id = any (p_ids)
      and l.season = p_season
      and l.season_type = 2
      and l.counts_for_stats
      and not l.did_not_play
      and l.min > 0
  ),
  windows (w) as (values (7), (14), (30), (0))
  select p.player_id,
         w.w,
         count(*)::int,
         max(p.game_date),
         avg(p.min), avg(p.pts), avg(p.reb), avg(p.ast), avg(p.stl), avg(p.blk),
         avg(p.tpm), avg(p.tov), avg(p.fga), avg(p.fta),
         sum(p.fgm)::int, sum(p.fga)::int, sum(p.ftm)::int, sum(p.fta)::int
  from played p
  join windows w on w.w = 0 or p.rn <= w.w
  group by p.player_id, w.w
$$;
