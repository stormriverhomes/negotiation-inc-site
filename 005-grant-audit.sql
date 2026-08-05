-- ══ PROVE 004 WAS ACTUALLY RUN ═════════════════════════════════════════════
-- Run this in Supabase → SQL editor, after 004. Safe to run twice.
--
-- 004 fixed a real hole: the browser could PATCH its own profile row and write
-- `comp_used`, `read_used`, `plan` and `trial` — the four columns that decide
-- what somebody is entitled to and what they have already spent. The fix was a
-- table-level revoke plus a two-column grant back.
--
-- But 004's protection is a fact about the DATABASE, not about the repository.
-- A migration sitting in git that nobody ran protects nothing, and the failure
-- is silent: everything works, nothing errors, and `trial` is writable. The
-- same class of silence that made 002 and 003 look successful while doing
-- nothing at all.
--
-- So the server should be able to ASK, and say the answer out loud on
-- /api/health. PostgREST cannot read information_schema, so this exposes
-- exactly one read-only view — the grant state of the columns that decide
-- money — and nothing else. It leaks no data: it lists privilege names, not
-- rows, and only for one table.

create or replace view public.entitlement_grants
with (security_invoker = true) as
select
  grantee::text  as role,
  column_name::text as col,
  privilege_type::text as priv
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and grantee in ('authenticated', 'anon')
  and privilege_type in ('UPDATE', 'INSERT');

-- Only the server may read it. The browser has no business knowing the shape
-- of its own cage, and `authenticated` holding SELECT here would be a small
-- reconnaissance gift for no benefit.
revoke all on public.entitlement_grants from authenticated, anon, public;
grant select on public.entitlement_grants to service_role;

-- What healthy looks like, after 004:
--
--   role           | col    | priv
--   ---------------+--------+--------
--   authenticated  | name   | UPDATE
--   authenticated  | market | UPDATE
--
-- Anything else on that list — any row naming plan, trial, comp_used,
-- comp_week, read_used or read_month — means 004 has not been run, or has been
-- undone by a later `grant all`, and /api/health will say `grants: "OPEN"`
-- with the offending columns named.
