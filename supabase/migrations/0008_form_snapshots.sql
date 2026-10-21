-- Monitoring: risers and droppers. Once a day, after the box scores load, every player's last
-- 3 games are compared with the 10 games before them and with his baseline (this season's
-- earlier games, or last season's until he has 10 this season), in his own game-to-game
-- standard deviations. Players flagged at 0.5 s.d. or more are stored; the page filters further.

create table public.form_snapshots (
  snapshot_date  date not null,           -- US Eastern; counts games before this date
  player_id      text not null,
  player_name    text not null,
  team_abbr      text not null,
  side           text not null check (side in ('riser', 'dropper')),
  baseline       text not null check (baseline in ('season', 'last_season')),
  baseline_rank  int not null,            -- by baseline value among all players with a baseline
  z_prev10       numeric not null,        -- (last 3 - previous 10) / player's s.d.
  z_baseline     numeric not null,        -- (last 3 - baseline) / player's s.d.
  value_last3    numeric not null,        -- 9-cat z-score total per game
  value_prev10   numeric not null,
  value_baseline numeric not null,
  min_last3      numeric not null,
  min_baseline   numeric not null,
  last_game      date not null,
  primary key (snapshot_date, player_id)
);

alter table public.form_snapshots enable row level security;
create policy "signed-in users read form snapshots" on public.form_snapshots for select to authenticated using (true);
grant select on public.form_snapshots to authenticated;
grant all on public.form_snapshots to service_role;

create or replace function public.form_flags(p_date date, p_season int, p_min_sd numeric)
returns table (
  player_id text, player_name text, team_abbr text, side text, baseline text, baseline_rank int,
  z_prev10 numeric, z_baseline numeric, value_last3 numeric, value_prev10 numeric, value_baseline numeric,
  min_last3 numeric, min_baseline numeric, last_game date
)
language sql
stable
security invoker
set search_path = public
as $$
  with played as (
    select l.*, row_number() over (partition by l.player_id order by l.game_date desc, l.event_id desc) as rn
    from public.game_logs l
    where l.season in (p_season, p_season - 1)
      and l.season_type = 2
      and l.counts_for_stats
      and not l.did_not_play
      and l.min > 0
      and l.game_date < p_date
  ),
  lg as (select sum(fgm)::numeric / sum(fga) as fg, sum(ftm)::numeric / sum(fta) as ft from played),
  -- Category scale: per-season averages of regulars (10+ games, 20+ minutes).
  regulars as (
    select avg(pts) as pts, avg(reb) as reb, avg(ast) as ast, avg(stl) as stl, avg(blk) as blk, avg(tpm) as tpm,
           avg(tov) as tov, avg(fgm - fga * lg.fg) as fgi, avg(ftm - fta * lg.ft) as fti
    from played, lg
    group by played.player_id, played.season
    having count(*) >= 10 and avg(min) >= 20
  ),
  sc as (
    select avg(pts) m_pts, stddev(pts) s_pts, avg(reb) m_reb, stddev(reb) s_reb, avg(ast) m_ast, stddev(ast) s_ast,
           avg(stl) m_stl, stddev(stl) s_stl, avg(blk) m_blk, stddev(blk) s_blk, avg(tpm) m_tpm, stddev(tpm) s_tpm,
           avg(tov) m_tov, stddev(tov) s_tov, avg(fgi) m_fgi, stddev(fgi) s_fgi, avg(fti) m_fti, stddev(fti) s_fti
    from regulars
  ),
  -- Each game's value: the sum of 9-category z-scores, turnovers inverted, percentages by attempts.
  valued as (
    select p.*, (
        (pts - m_pts) / s_pts + (reb - m_reb) / s_reb + (ast - m_ast) / s_ast + (stl - m_stl) / s_stl
      + (blk - m_blk) / s_blk + (tpm - m_tpm) / s_tpm - (tov - m_tov) / s_tov
      + ((fgm - fga * lg.fg) - m_fgi) / s_fgi + ((ftm - fta * lg.ft) - m_fti) / s_fti) as v
    from played p, sc, lg
  ),
  per_player as (
    select v.player_id,
           (array_agg(v.player_name order by v.rn))[1] as player_name,
           (array_agg(v.team_abbr order by v.rn))[1] as team_abbr,
           max(v.game_date) as last_game,
           count(*) filter (where v.rn <= 3 and v.season = p_season) as n_recent,
           count(*) filter (where v.rn between 4 and 13) as n_prev,
           count(*) filter (where v.rn > 3 and v.season = p_season) as n_this,
           count(*) filter (where v.season = p_season - 1) as n_last,
           avg(v.v) filter (where v.rn <= 3) as value_last3,
           avg(v.v) filter (where v.rn between 4 and 13) as value_prev10,
           avg(v.min) filter (where v.rn <= 3) as min_last3,
           -- Baseline: this season's games before the last 3, or last season's until there are 10.
           avg(v.v) filter (where v.rn > 3 and v.season = p_season) as this_v,
           stddev(v.v) filter (where v.rn > 3 and v.season = p_season) as this_sd,
           avg(v.min) filter (where v.rn > 3 and v.season = p_season) as this_min,
           avg(v.v) filter (where v.season = p_season - 1) as last_v,
           stddev(v.v) filter (where v.season = p_season - 1) as last_sd,
           avg(v.min) filter (where v.season = p_season - 1) as last_min
    from valued v
    group by v.player_id
  ),
  based as (
    select pp.*,
           case when pp.n_this >= 10 or pp.n_last < 8 then 'season' else 'last_season' end as baseline,
           case when pp.n_this >= 10 or pp.n_last < 8 then pp.this_v else pp.last_v end as value_baseline,
           case when pp.n_this >= 10 or pp.n_last < 8 then pp.this_sd else pp.last_sd end as sd,
           case when pp.n_this >= 10 or pp.n_last < 8 then pp.this_min else pp.last_min end as min_baseline,
           case when pp.n_this >= 10 or pp.n_last < 8 then pp.n_this else pp.n_last end as n_baseline
    from per_player pp
  ),
  ranked as (
    select b.*, rank() over (order by b.value_baseline desc)::int as baseline_rank
    from based b
    where b.n_baseline >= 8 and b.sd > 0
  ),
  scored as (
    select r.*, (r.value_last3 - r.value_prev10) / r.sd as zp, (r.value_last3 - r.value_baseline) / r.sd as zb
    from ranked r
    -- 3 recent games this season at 15+ minutes, one in the last week, 5+ before them, outside the top 50.
    where r.n_recent = 3 and r.n_prev >= 5 and r.min_last3 >= 15 and r.last_game >= p_date - 7 and r.baseline_rank > 50
  )
  select s.player_id, s.player_name, s.team_abbr,
         case when s.zp > 0 then 'riser' else 'dropper' end as side,
         s.baseline, s.baseline_rank,
         round(s.zp, 2) as z_prev10, round(s.zb, 2) as z_baseline,
         round(s.value_last3, 2) as value_last3, round(s.value_prev10, 2) as value_prev10, round(s.value_baseline, 2) as value_baseline,
         round(s.min_last3, 1) as min_last3, round(s.min_baseline, 1) as min_baseline, s.last_game
  from scored s
  where (s.zp >= p_min_sd and s.zb >= p_min_sd) or (s.zp <= -p_min_sd and s.zb <= -p_min_sd)
$$;

-- Replaces one day's snapshot. Called by the daily job with the secret key.
create or replace function public.refresh_form_snapshot(p_date date, p_season int)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  delete from public.form_snapshots where snapshot_date = p_date;
  insert into public.form_snapshots (
    snapshot_date, player_id, player_name, team_abbr, side, baseline, baseline_rank, z_prev10, z_baseline,
    value_last3, value_prev10, value_baseline, min_last3, min_baseline, last_game
  )
  select p_date, f.* from public.form_flags(p_date, p_season, 0.5) f;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.refresh_form_snapshot(date, int) from public, anon, authenticated;
grant execute on function public.refresh_form_snapshot(date, int) to service_role;
