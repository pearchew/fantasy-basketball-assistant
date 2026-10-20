-- Manual "update next-up calls": redo calls built before the team's latest box score,
-- within a daily Gemini allowance.

-- Latest box-score date the depth chart used; a team game after this makes the call out of date.
alter table public.next_up add column computed_through date;
-- Set when I ask for an update; cleared when the call is recomputed.
alter table public.next_up add column needs_recompute boolean not null default false;

-- Gemini calls spent per day (US Eastern) and purpose.
create table public.model_budget (
  day           date not null,
  purpose       text not null,
  calls_used    int not null default 0,
  runs          int not null default 0,
  last_batch_at timestamptz,
  primary key (day, purpose)
);

alter table public.model_budget enable row level security;
create policy "signed-in users read the model budget" on public.model_budget for select to authenticated using (true);
revoke all on public.model_budget from anon;
grant select on public.model_budget to authenticated;
grant all on public.model_budget to service_role;

-- Reserves p_calls for a run only if the day's total stays within p_limit. Atomic, so a double
-- click can't overspend. Returns the new total, or null when the run doesn't fit.
create or replace function public.reserve_model_calls(p_day date, p_purpose text, p_calls int, p_limit int)
returns int
language sql
security invoker
set search_path = public
as $$
  insert into public.model_budget as b (day, purpose, calls_used, runs)
  select p_day, p_purpose, p_calls, 1
  where p_calls <= p_limit
  on conflict (day, purpose) do update
    set calls_used = b.calls_used + excluded.calls_used,
        runs = b.runs + 1
    where b.calls_used + excluded.calls_used <= p_limit
  returning calls_used;
$$;

revoke all on function public.reserve_model_calls(date, text, int, int) from public, anon, authenticated;
grant execute on function public.reserve_model_calls(date, text, int, int) to service_role;
