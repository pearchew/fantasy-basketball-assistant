-- Phase 2: parsed injury updates, ingest bookkeeping, and league-wide game logs.
-- Written only by server jobs with the secret key; readable when signed in.

-- One row per (player, game). Repeat reports update it and append to history.
create table public.injury_updates (
  id              bigint generated always as identity primary key,
  update_key      text not null unique,      -- "<game_date>|<team_abbr>|<espn_id or unmatched:name_key>"
  game_date       date not null,             -- US Eastern
  game_time       text not null,             -- as printed, e.g. "07:30 (ET)"
  matchup         text not null,             -- as printed, e.g. "DAL@CLE"
  team_name       text not null,
  team_abbr       text,                      -- ESPN abbreviation; null if the team name is unknown
  player_id       text references public.players (espn_id),  -- null: unmatched, shown on the review list
  player_name     text not null,             -- "First Last" as printed
  status          text not null check (status in ('out', 'doubtful', 'questionable', 'probable', 'available')),
  reason          text not null default '',
  raw_text        text not null,             -- the report row as printed, for checking the parse
  report_time     timestamptz not null,      -- report this status came from
  first_seen_at   timestamptz not null,
  changed_at      timestamptz not null,      -- last status or reason change
  -- True when the previous game's update for this player had the same status and reason.
  ongoing         boolean not null default false,
  history         jsonb not null default '[]'::jsonb  -- [{status, reason, report_time}], oldest first
);
create index injury_updates_game_date_idx on public.injury_updates (game_date);
create index injury_updates_player_idx on public.injury_updates (player_id, game_date desc);

-- Single-row-per-job bookkeeping: rate limits and the last report ingested.
create table public.ingest_state (
  job             text primary key,
  last_attempt_at timestamptz not null default 'epoch',
  last_success_at timestamptz,
  last_report_url text,
  last_report_time timestamptz,
  last_error      text
);
insert into public.ingest_state (job) values ('injury_report'), ('game_logs');

create table public.games (
  event_id     text primary key,            -- ESPN event id
  game_date    date not null,               -- US Eastern
  season       int not null,                -- ESPN season year: 2027 = 2026-27
  season_type  int not null,                -- 1 preseason, 2 regular season, 3 postseason
  home_abbr    text not null,
  away_abbr    text not null,
  status       text not null
);
create index games_date_idx on public.games (game_date);

-- No foreign key to players: logs include players who have since left the league.
create table public.game_logs (
  event_id      text not null references public.games (event_id) on delete cascade,
  player_id     text not null,
  player_name   text not null,
  team_abbr     text not null,
  game_date     date not null,
  season        int not null,
  season_type   int not null,
  starter       boolean not null,
  did_not_play  boolean not null,
  min int not null, pts int not null,
  fgm int not null, fga int not null,
  tpm int not null, tpa int not null,
  ftm int not null, fta int not null,
  reb int not null, ast int not null, stl int not null, blk int not null, tov int not null,
  primary key (event_id, player_id)
);
create index game_logs_player_idx on public.game_logs (player_id, game_date desc);
create index game_logs_team_idx on public.game_logs (team_abbr, game_date desc);

alter table public.injury_updates enable row level security;
alter table public.ingest_state   enable row level security;
alter table public.games          enable row level security;
alter table public.game_logs      enable row level security;

create policy "signed-in users read injury updates" on public.injury_updates for select to authenticated using (true);
create policy "signed-in users read ingest state"   on public.ingest_state   for select to authenticated using (true);
create policy "signed-in users read games"          on public.games          for select to authenticated using (true);
create policy "signed-in users read game logs"      on public.game_logs      for select to authenticated using (true);

revoke all on public.injury_updates, public.ingest_state, public.games, public.game_logs from anon;
grant select on public.injury_updates, public.ingest_state, public.games, public.game_logs to authenticated;
grant all on public.injury_updates, public.ingest_state, public.games, public.game_logs to service_role;
