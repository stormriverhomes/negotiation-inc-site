-- ══ ONE METER, EVERY FEATURE ════════════════════════════════════════════════
-- Run this in Supabase → SQL editor, after 002. It is safe to run twice.
--
-- 002 metered the photo read with two columns on `profiles` — read_used and
-- read_month. That was right for one feature and wrong for five: the written
-- comparison, the street brief, the bid check and the objections panel would
-- each have added two more columns, ten in total, five copies of the same
-- roll-the-month bug, and a schema migration every time a feature shipped.
--
-- A feature is now a ROW. Adding one is a constant in the server and nothing
-- here changes.
--
-- The site is safe to deploy in either order. If the code arrives first the
-- function 404s and nothing is metered (features still work, the caps are not
-- enforced for as long as that lasts). If the SQL arrives first, ni_use_read
-- is kept below as a thin wrapper so the currently-deployed server keeps
-- working unchanged.

create table if not exists public.usage (
  uid     uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  month   date not null,
  used    int  not null default 0,
  primary key (uid, feature, month)
);

alter table public.usage enable row level security;

-- A person may READ their own meter — the desk shows "18 of 100 left this
-- month", and a number you are being held to is a number you get to see.
-- Nobody but the service role may write one.
drop policy if exists "read own usage" on public.usage;
create policy "read own usage" on public.usage
  for select using (auth.uid() = uid);

revoke insert, update, delete on public.usage from authenticated, anon;

-- ── the meter ───────────────────────────────────────────────────────────────
-- Called by the server with the service key, AFTER the work has succeeded, so
-- a read that failed upstream does not spend somebody's month on our error.
-- Rolls the month itself: a month boundary decided by the caller's clock is a
-- month boundary that never arrives.
create or replace function public.ni_use(who uuid, feat text, cap int)
returns table (used int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  mo date := (date_trunc('month', (now() at time zone 'utc')))::date;
  u  int;
begin
  if who is null then raise exception 'no uid'; end if;
  -- a feature name is an identifier we chose, not user input; refuse anything
  -- that does not look like one rather than letting it create a row
  if feat is null or feat !~ '^[a-z][a-z0-9_]{1,30}$' then raise exception 'bad feature'; end if;

  insert into public.usage (uid, feature, month, used)
       values (who, feat, mo, 1)
  on conflict (uid, feature, month)
       do update set used = public.usage.used + 1
    returning public.usage.used into u;

  return query select u, greatest(0, coalesce(cap, 0) - u);
end;
$$;

revoke all on function public.ni_use(uuid, text, int) from public, anon, authenticated;

-- ── carry 002's counts over ─────────────────────────────────────────────────
-- Pre-launch this is almost certainly zero rows, and it costs nothing to be
-- right if it is not.
insert into public.usage (uid, feature, month, used)
select id, 'airead', date_trunc('month', read_month)::date, read_used
  from public.profiles
 where read_used > 0 and read_month is not null
on conflict (uid, feature, month) do nothing;

-- ── 002's function, kept as a wrapper ───────────────────────────────────────
-- So that a server deployed before this migration, or after it and before the
-- next deploy, goes on working. Delete it once the new server is live and the
-- logs are quiet.
create or replace function public.ni_use_read(who uuid, cap int)
returns table (used int, remaining int)
language sql
security definer
set search_path = public
as $$ select * from public.ni_use(who, 'airead', cap); $$;

revoke all on function public.ni_use_read(uuid, int) from public, anon, authenticated;
