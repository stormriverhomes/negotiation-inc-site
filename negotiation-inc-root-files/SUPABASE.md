# The account, on a server — setup

Free tier. 50,000 monthly active users and 500MB, which is more than you will
need before this is profitable. **Cost today: $0.**

Until you do this, nothing changes: with no Supabase configured the product
behaves exactly as it does now — a local record, no password, the door's fine
print saying so. That is deliberate. The site is live and a half-finished auth
layer must not be able to lock anybody out of something that works.

---

## 1 · The project

New project at supabase.com. Then **Settings → API** gives you two values and
two keys. You need the URL and the **anon** key. You will also need the
**service_role** key, but *only* for the Render service — see §4.

> **The two keys look identical and are not.** The anon key is meant to be
> public and is safe only because the policies below exist. The service_role
> key bypasses every policy and must never reach a browser. The build refuses
> to run if the service_role key is in the browser variable, but do not rely on
> that — it is a backstop, not a plan.

**Authentication → Providers → Email:** turn **"Confirm email" off** for now.
You have no SMTP configured, and Supabase's built-in sender is rate-limited to
a handful an hour and not meant for production. With confirmation off, signing
up works instantly and costs nothing. Turn it on when you have a mail sender —
the code already handles the confirm-first case and says so on the door.

## 2 · The tables

Paste this whole block into **SQL Editor**. Every line matters.

```sql
-- ── PROFILES ────────────────────────────────────────────────────────────
-- One row per person. The PLAN lives here and is the only thing that
-- decides what the product switches on.
create table profiles (
  id      uuid primary key references auth.users on delete cascade,
  name    text,
  market  text,
  plan    text,                       -- null | 'solo' | 'underwriter' | 'the office'
  trial   timestamptz,
  created timestamptz default now()
);

-- a profile appears the moment somebody signs up, with the name they gave
create function public.on_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.on_new_user();

alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid() = id);

-- ── THE ONE THAT MATTERS ────────────────────────────────────────────────
-- A person may rename themselves and change their market. They may NOT
-- change their plan. This WITH CHECK is the entire difference between a
-- subscription meaning something and being a field in devtools.
create policy "update own profile, but not the plan" on profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and plan is not distinct from (select p.plan from profiles p where p.id = auth.uid())
  );

-- ── SHEETS ──────────────────────────────────────────────────────────────
-- One row per property. The blob is the same object the export writes, so
-- the file somebody downloads and the row on the server are the same shape
-- and neither needs a migration when a field is added.
create table sheets (
  uid     uuid not null references auth.users on delete cascade,
  pid     text not null,
  updated timestamptz not null default now(),
  blob    jsonb not null,
  primary key (uid, pid)
);

alter table sheets enable row level security;

create policy "own sheets" on sheets
  for all using (auth.uid() = uid) with check (auth.uid() = uid);

-- ── THE WAITLIST ────────────────────────────────────────────────────────
-- Written only by the Render service with the service_role key, so it needs
-- RLS on and NO policy at all: that combination means the anon key cannot
-- read it, which is what you want for a list of email addresses.
create table waitlist (
  email   text primary key,
  source  text,
  created timestamptz default now()
);
alter table waitlist enable row level security;
```

**Then check it worked.** In SQL Editor:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

All three must say `true`. A table with RLS off and a public anon key is the
whole database readable by anybody who opens developer tools.

## 3 · The site

Build with the two public values in the environment:

```bash
NI_SUPABASE_URL=https://YOURPROJECT.supabase.co \
NI_SUPABASE_ANON=eyJ...the-anon-key... \
node publish.mjs
```

They are baked into every page as `window.NI_SUPABASE_URL` and
`window.NI_SUPABASE_ANON`. Both are public by design.

Also add your site's URL under **Authentication → URL Configuration** so
Supabase will accept requests from it.

## 4 · The Render service

Two more environment variables in the dashboard, and this one **is** the
service_role key:

```
SUPABASE_URL          https://YOURPROJECT.supabase.co
SUPABASE_SERVICE_KEY  eyJ...the-SERVICE_ROLE-key...
```

That switches the waitlist on. Check `/api/health` shows `"list":"on"`.

The same key is what the Stripe webhook will use to write `profiles.plan` —
the only thing in the system allowed to.

---

## What you should see

1. Open the hub. The door now asks for a password, and the fine print has
   changed to describe what actually happens.
2. Sign up. Price a property. Sign in from a phone — the sheet is there.
3. Open devtools, set `plan` to `"the office"` in `ni-account-v1`, reload.
   **It goes back to what the server says.** That is the whole point.

## What this unlocks

- **Stripe becomes small.** The webhook writes one field on one row. `tierOf()`
  already reads exactly that field and nothing else.
- **"The portfolio on every device"** stops being a promise the plans page
  makes and the software cannot keep.
- **The photo read's access code retires.** It was always a placeholder for a
  real session; once auth is live the proxy checks the session and the tier
  instead of a shared phrase.

## The one thing to be careful about

Sync is **last-write-wins per property**, not per workspace. That is
deliberate: edit one sheet on a phone and a different one on a laptop and you
end up with both. A whole-workspace blob would silently drop one of them, and
the person could not tell it had happened — which is the most damaging bug a
sync layer can have. If you ever change this, change it away from per-workspace,
not towards it.
