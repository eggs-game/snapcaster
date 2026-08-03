-- Keep private Realtime authorization continuous while active members move to
-- a freshly rotated topic. The prior topic remains joinable only by active
-- memberships for a short handoff window; departed or removed memberships
-- still fail the membership predicate immediately.

alter table public.game_rooms
  add column if not exists previous_realtime_epoch uuid,
  add column if not exists previous_realtime_epoch_expires_at timestamptz;

create or replace function public.snapcast_preserve_previous_realtime_epoch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.realtime_epoch is distinct from old.realtime_epoch then
    new.previous_realtime_epoch := old.realtime_epoch;
    new.previous_realtime_epoch_expires_at := now() + interval '90 seconds';
  end if;
  return new;
end;
$$;

drop trigger if exists game_rooms_preserve_previous_realtime_epoch on public.game_rooms;
create trigger game_rooms_preserve_previous_realtime_epoch
  before update of realtime_epoch on public.game_rooms
  for each row
  when (old.realtime_epoch is distinct from new.realtime_epoch)
  execute function public.snapcast_preserve_previous_realtime_epoch();

create or replace function public.snapcast_can_access_realtime_topic(topic_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.game_memberships memberships
    join public.game_rooms rooms on rooms.id = memberships.game_id
    where memberships.auth_user_id = (select auth.uid())
      and memberships.left_at is null
      and memberships.removed_at is null
      and rooms.status in ('lobby', 'live', 'finished')
      and topic_name in (
        'room-' || rooms.code || '-' || rooms.realtime_epoch::text,
        case
          when rooms.previous_realtime_epoch is not null
            and rooms.previous_realtime_epoch_expires_at > now()
          then 'room-' || rooms.code || '-' || rooms.previous_realtime_epoch::text
          else null
        end
      )
  );
$$;

-- A voluntary owner departure has already invalidated that membership and
-- rotated the room. Claiming the now-vacant crown must not rotate again while
-- the remaining clients are still completing the first handoff.
create or replace function public.claim_game_ownership(
  target_room_id uuid,
  acting_membership_id uuid,
  participant_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
  current_owner public.game_memberships;
  successor public.game_memberships;
begin
  select * into target_room from public.game_rooms where id = target_room_id for update;
  if not found or target_room.status not in ('lobby', 'live') then raise exception 'game is unavailable'; end if;
  select * into current_owner from public.game_memberships where id = target_room.owner_membership_id;
  if current_owner.id is not null
    and current_owner.left_at is null
    and current_owner.removed_at is null
    and current_owner.last_seen_at >= now() - interval '2 minutes' then
    return false;
  end if;
  select * into successor
  from public.game_memberships
  where game_id = target_room_id and role = 'player'
    and left_at is null and removed_at is null
  order by joined_at, id
  limit 1
  for update;
  if successor.id is null
    or successor.id <> acting_membership_id
    or successor.token_hash <> public.snapcast_token_hash(participant_token) then
    return false;
  end if;
  update public.game_rooms
  set owner_membership_id = successor.id,
      owner_profile_id = successor.profile_id,
      owner_token_hash = public.snapcast_token_hash(participant_token)
  where id = target_room_id;
  insert into public.game_audit_log(
    room_id, actor_membership_id, action, details, idempotency_key
  ) values (
    target_room_id, successor.id, 'ownership_claimed',
    jsonb_build_object('previous_owner_membership_id', current_owner.id),
    gen_random_uuid()
  );
  return true;
end;
$$;

revoke all on function public.snapcast_preserve_previous_realtime_epoch() from public, anon, authenticated;
revoke all on function public.snapcast_can_access_realtime_topic(text) from public;
grant execute on function public.snapcast_can_access_realtime_topic(text) to authenticated;
revoke all on function public.claim_game_ownership(uuid, uuid, text) from public, anon;
grant execute on function public.claim_game_ownership(uuid, uuid, text) to authenticated;
