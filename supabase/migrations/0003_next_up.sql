-- Phase 3: next-up inference, stored per (team, game, set of absent and returning players).

-- A player moving from out/doubtful to probable/available, within a game or since his previous game.
-- ("returning" is reserved in Postgres, hence the prefix.)
alter table public.injury_updates add column is_returning boolean not null default false;

create table public.next_up (
  id             bigint generated always as identity primary key,
  group_key      text not null unique,     -- "<game_date>|<team_abbr>|<absent ids>|<returning ids>"
  game_date      date not null,
  team_abbr      text not null,
  absent_ids     text[] not null,          -- out or doubtful for this game
  returning_ids  text[] not null,
  -- [{player_id, name, position, type, reason, for_ids, questionable}]
  -- type: starter_replacement | bench_minutes | starter_usage | loses_minutes
  beneficiaries  jsonb not null,
  source         text not null check (source in ('model', 'rules')),
  model          text,
  model_error    text,                     -- why the rules were used instead, if the model was tried
  model_attempts int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index next_up_game_idx on public.next_up (game_date, team_abbr);

alter table public.next_up enable row level security;
create policy "signed-in users read next-up" on public.next_up for select to authenticated using (true);
revoke all on public.next_up from anon;
grant select on public.next_up to authenticated;
grant all on public.next_up to service_role;
