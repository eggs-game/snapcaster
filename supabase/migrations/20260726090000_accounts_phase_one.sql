-- Phase 1 account foundation: optional Discord identity, public profile data,
-- private contact data, and owner-only game-entry preferences.
--
-- Discord must be enabled in Supabase Auth with only the identify and email
-- scopes. The browser never receives the Discord application secret.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 1 and 32),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048)
);

create table if not exists public.account_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_user_id text,
  email text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_private_discord_id_length
    check (discord_user_id is null or char_length(discord_user_id) <= 32),
  constraint account_private_email_length
    check (email is null or char_length(email) <= 320)
);

create unique index if not exists account_private_discord_user_id_unique
  on public.account_private(discord_user_id)
  where discord_user_id is not null;

create table if not exists public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_camera_id text,
  preferred_microphone_id text,
  theme text not null default 'dark',
  appear_offline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_preferences_theme
    check (theme in ('light', 'dark', 'system')),
  constraint account_preferences_camera_length
    check (preferred_camera_id is null or char_length(preferred_camera_id) <= 512),
  constraint account_preferences_microphone_length
    check (preferred_microphone_id is null or char_length(preferred_microphone_id) <= 512)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists account_private_set_updated_at on public.account_private;
create trigger account_private_set_updated_at
  before update on public.account_private
  for each row execute function public.set_updated_at();

drop trigger if exists account_preferences_set_updated_at on public.account_preferences;
create trigger account_preferences_set_updated_at
  before update on public.account_preferences
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposed_name text;
  proposed_avatar text;
  proposed_discord_id text;
begin
  -- Anonymous Auth users exist only to authorize private Realtime game
  -- channels. They are not Snapcast accounts and get no profile rows.
  if coalesce(new.is_anonymous, false) then return new; end if;
  proposed_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'global_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    'Snapcast player'
  );
  proposed_avatar := nullif(
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    ''
  );
  proposed_discord_id := nullif(
    coalesce(
      new.raw_user_meta_data ->> 'provider_id',
      new.raw_user_meta_data ->> 'sub'
    ),
    ''
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, left(proposed_name, 32), left(proposed_avatar, 2048))
  on conflict (id) do update
  set avatar_url = excluded.avatar_url;

  insert into public.account_private (
    user_id,
    discord_user_id,
    email,
    email_verified
  )
  values (
    new.id,
    left(proposed_discord_id, 32),
    left(nullif(new.email, ''), 320),
    new.email_confirmed_at is not null
  )
  on conflict (user_id) do update
  set discord_user_id = excluded.discord_user_id,
      email = excluded.email,
      email_verified = excluded.email_verified;

  insert into public.account_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_snapcast on auth.users;
create trigger on_auth_user_created_snapcast
  after insert or update of raw_user_meta_data, email, email_confirmed_at
  on auth.users
  for each row execute function public.handle_new_account();

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_account() from public, anon, authenticated;

-- Backfill users that existed before this migration.
insert into public.profiles (id, display_name, avatar_url)
select
  id,
  left(coalesce(
    nullif(raw_user_meta_data ->> 'global_name', ''),
    nullif(raw_user_meta_data ->> 'full_name', ''),
    nullif(raw_user_meta_data ->> 'name', ''),
    nullif(raw_user_meta_data ->> 'user_name', ''),
    'Snapcast player'
  ), 32),
  left(nullif(coalesce(
    raw_user_meta_data ->> 'avatar_url',
    raw_user_meta_data ->> 'picture'
  ), ''), 2048)
from auth.users
where not coalesce(is_anonymous, false)
on conflict (id) do nothing;

insert into public.account_private (user_id, discord_user_id, email, email_verified)
select
  id,
  left(nullif(coalesce(
    raw_user_meta_data ->> 'provider_id',
    raw_user_meta_data ->> 'sub'
  ), ''), 32),
  left(nullif(email, ''), 320),
  email_confirmed_at is not null
from auth.users
where not coalesce(is_anonymous, false)
on conflict (user_id) do nothing;

insert into public.account_preferences (user_id)
select id from auth.users where not coalesce(is_anonymous, false)
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.account_private enable row level security;
alter table public.account_preferences enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.account_private from anon, authenticated;
revoke all on public.account_preferences from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;
-- Linked identity and email are synchronized only by the auth trigger. Browser
-- clients may read their own row, but cannot rewrite provider ownership.
grant select on public.account_private to authenticated;
grant select, update on public.account_preferences to authenticated;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "players update their own profile" on public.profiles;
create policy "players update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() is not null and auth.uid() = id);

drop policy if exists "players read their own private account" on public.account_private;
create policy "players read their own private account"
  on public.account_private for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "players update their own private account" on public.account_private;

drop policy if exists "players read their own preferences" on public.account_preferences;
create policy "players read their own preferences"
  on public.account_preferences for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "players update their own preferences" on public.account_preferences;
create policy "players update their own preferences"
  on public.account_preferences for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
