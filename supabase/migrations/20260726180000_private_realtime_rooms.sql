-- Private Realtime room authorization. Guests receive an anonymous Supabase
-- Auth identity, but the account trigger deliberately creates no profile.

alter table public.game_memberships
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

alter table public.game_rooms
  add column if not exists realtime_epoch uuid not null default gen_random_uuid();

create index if not exists game_memberships_auth_active_idx
  on public.game_memberships(auth_user_id, game_id)
  where auth_user_id is not null and left_at is null and removed_at is null;

update public.game_memberships
set auth_user_id = profile_id
where auth_user_id is null and profile_id is not null;

create or replace function public.snapcast_stamp_room_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'game identity required'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    new.owner_profile_id := null;
  end if;
  return new;
end;
$$;

create or replace function public.snapcast_stamp_membership_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'game identity required'; end if;
  new.auth_user_id := auth.uid();
  if exists (select 1 from public.profiles where id = auth.uid()) then
    new.profile_id := auth.uid();
  else
    new.profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists game_rooms_stamp_identity on public.game_rooms;
create trigger game_rooms_stamp_identity
  before insert on public.game_rooms
  for each row execute function public.snapcast_stamp_room_identity();

drop trigger if exists game_memberships_stamp_identity on public.game_memberships;
create trigger game_memberships_stamp_identity
  before insert on public.game_memberships
  for each row execute function public.snapcast_stamp_membership_identity();

create or replace function public.snapcast_can_access_realtime_topic(topic_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from public.game_memberships memberships
    join public.game_rooms rooms on rooms.id = memberships.game_id
    where memberships.auth_user_id = auth.uid()
      and memberships.left_at is null
      and memberships.removed_at is null
      and rooms.status in ('lobby', 'live', 'finished')
      and topic_name = 'room-' || rooms.code || '-' || rooms.realtime_epoch::text
  );
$$;

create or replace function public.get_realtime_room_epoch(
  target_membership_id uuid, participant_token text
)
returns uuid language sql stable security definer set search_path = '' as $$
  select rooms.realtime_epoch
  from public.game_memberships memberships
  join public.game_rooms rooms on rooms.id = memberships.game_id
  where memberships.id = target_membership_id
    and memberships.auth_user_id = auth.uid()
    and memberships.token_hash = public.snapcast_token_hash(participant_token)
    and memberships.left_at is null
    and memberships.removed_at is null;
$$;

-- Supabase owns realtime.messages and enables RLS on it. Managed projects
-- intentionally reject ALTER TABLE here, while still allowing app policies.

drop policy if exists "active game members receive realtime room messages" on realtime.messages;
create policy "active game members receive realtime room messages"
  on realtime.messages for select
  to authenticated
  using (public.snapcast_can_access_realtime_topic(realtime.topic()));

drop policy if exists "active game members send realtime room messages" on realtime.messages;
create policy "active game members send realtime room messages"
  on realtime.messages for insert
  to authenticated
  with check (public.snapcast_can_access_realtime_topic(realtime.topic()));

revoke all on function public.snapcast_stamp_room_identity() from public, anon, authenticated;
revoke all on function public.snapcast_stamp_membership_identity() from public, anon, authenticated;
revoke all on function public.snapcast_can_access_realtime_topic(text) from public;
revoke all on function public.get_realtime_room_epoch(uuid, text) from public;
grant execute on function public.snapcast_can_access_realtime_topic(text) to authenticated;
grant execute on function public.get_realtime_room_epoch(uuid, text) to authenticated;
