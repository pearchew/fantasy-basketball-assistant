-- Phase 1: player directory, fantasy teams, rosters and the watchlist.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- NBA player directory, synced daily from ESPN by /api/cron/sync-players.
-- Written only with the secret key (which bypasses RLS); readable when signed in.
create table public.players (
  espn_id     text primary key,
  name        text not null,
  name_key    text not null,             -- nameKey(): accent/suffix-free, for matching other sources
  position    text not null default '',  -- NBA-listed: G, F or C
  team_abbr   text,                      -- null when not on an NBA roster
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index players_name_key_idx on public.players (name_key);

create table public.fantasy_teams (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  format      text not null default 'h2h_9cat' check (format in ('h2h_9cat', 'roto')),
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.roster_spots (
  team_id     uuid not null references public.fantasy_teams (id) on delete cascade,
  player_id   text not null references public.players (espn_id),
  added_at    timestamptz not null default now(),
  primary key (team_id, player_id)
);
create index roster_spots_player_idx on public.roster_spots (player_id);

create table public.watchlist (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  player_id   text not null references public.players (espn_id),
  added_at    timestamptz not null default now(),
  primary key (owner_id, player_id)
);

alter table public.players       enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.roster_spots  enable row level security;
alter table public.watchlist     enable row level security;

create policy "signed-in users read the directory" on public.players
  for select to authenticated using (true);

create policy "owners manage their teams" on public.fantasy_teams
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners manage their rosters" on public.roster_spots
  for all to authenticated
  using (exists (select 1 from public.fantasy_teams t where t.id = team_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.fantasy_teams t where t.id = team_id and t.owner_id = (select auth.uid())));

create policy "owners manage their watchlist" on public.watchlist
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Explicit grants: newer projects don't expose new tables to the Data API by default.
revoke all on public.players, public.fantasy_teams, public.roster_spots, public.watchlist from anon;
grant select on public.players to authenticated;
grant select, insert, update, delete on public.fantasy_teams, public.roster_spots, public.watchlist to authenticated;
grant all on public.players, public.fantasy_teams, public.roster_spots, public.watchlist to service_role;
