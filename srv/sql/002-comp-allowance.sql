-- ══ THE WEEKLY COMP ALLOWANCE ═══════════════════════════════════════════════
-- Run this in Supabase → SQL editor. It is safe to run twice.
--
-- What it is for: a free ACCOUNT bought nothing on the comp workbench, so the
-- best thing in the product gave nobody a reason to sign up. It now scores
-- twelve comps a week. Signed out is still three, in the browser; a paid plan
-- is unlimited and never calls this function at all.
--
-- Why the count is here and not in localStorage: a counter in the browser is
-- reset by clearing site data, which people do by accident. This cannot be
-- written by the browser at all — the column privilege is revoked below and
-- the only way in is the function, which decides the number itself.
--
-- It does not stop somebody who edits the JavaScript. Nothing client-side can,
-- and the arithmetic that scores a comp runs in the page. What it stops is the
-- easy bypass, which is the one that actually happens.
--
-- The site is safe to deploy BEFORE this runs: with no function present the
-- call 404s, the desk falls back to the three-comp limit it has always used,
-- and nobody is locked out of anything that worked yesterday.

alter table public.profiles add column if not exists comp_used int  not null default 0;
alter table public.profiles add column if not exists comp_week date;

-- the browser may read its own counters and may never write them
revoke update (comp_used, comp_week) on public.profiles from authenticated, anon;

-- ── the meter ───────────────────────────────────────────────────────────────
-- security definer, so it runs as the owner and can write the two columns the
-- caller cannot. It rolls the week itself: a week boundary decided by the
-- caller's clock is a week boundary that never arrives.
create or replace function public.ni_use_comps(n int)
returns table (used int, cap int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  wk  date := (date_trunc('week', (now() at time zone 'utc')))::date;
  lim int  := 12;                       -- keep in step with ACCT_COMPS_WEEK in desk.html
  u   int;
begin
  if auth.uid() is null then raise exception 'no session'; end if;
  -- a caller cannot spend a negative number to get its allowance back, and
  -- cannot spend a thousand in one call to exhaust somebody's week
  if n is null or n < 0 or n > 50 then raise exception 'bad n'; end if;

  update public.profiles p
     set comp_week = wk,
         comp_used = least(
           lim + 50,
           (case when p.comp_week is distinct from wk then 0 else p.comp_used end) + n)
   where p.id = auth.uid()
   returning p.comp_used into u;

  if u is null then raise exception 'no profile'; end if;
  return query select u, lim, greatest(0, lim - u);
end;
$$;

revoke all on function public.ni_use_comps(int) from public, anon;
grant execute on function public.ni_use_comps(int) to authenticated;


-- ══ THE MONTHLY PHOTO READ ALLOWANCE ════════════════════════════════════════
-- The plans page prints "100 photo condition reads a month" on Underwriter and
-- "pooled, 300" on The Office. Until now nothing counted them per account: the
-- service had one global daily cap, so a single enthusiastic user could spend
-- the whole day's budget by lunchtime and every other subscriber got a 429 for
-- something they had paid for. A promise nobody counts is a promise in both
-- directions — we cannot bill for it and we cannot protect it.
--
-- Written ONLY by the service role, from the server, after a read has actually
-- succeeded. A read that failed does not count against anybody's month.
alter table public.profiles add column if not exists read_used  int not null default 0;
alter table public.profiles add column if not exists read_month date;

revoke update (read_used, read_month) on public.profiles from authenticated, anon;

create or replace function public.ni_use_read(who uuid, cap int)
returns table (used int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  mo date := (date_trunc('month', (now() at time zone 'utc')))::date;
  u  int;
begin
  update public.profiles p
     set read_month = mo,
         read_used  = (case when p.read_month is distinct from mo then 0 else p.read_used end) + 1
   where p.id = who
   returning p.read_used into u;
  if u is null then raise exception 'no profile'; end if;
  return query select u, greatest(0, cap - u);
end;
$$;

-- nobody but the service role, which is the server and nothing else
revoke all on function public.ni_use_read(uuid, int) from public, anon, authenticated;
