-- A browser can disappear without running the deliberate leave flow. Rejoin
-- the authenticated account's existing membership instead of creating a
-- duplicate seat or rejecting the player. Rotating both the participant
-- capability and Realtime epoch supersedes an older tab while the coordinated
-- epoch handoff keeps every other active player connected.

create unique index if not exists game_memberships_active_auth_unique
  on public.game_memberships(game_id, auth_user_id)
  where auth_user_id is not null and left_at is null and removed_at is null;

create or replace function public.join_game_room(
  room_code text,
  participant_token text,
  participant_name text,
  participant_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_room public.game_rooms;
  joined_member public.game_memberships;
  next_seat smallint;
  active_count integer;
  normalized_name text := btrim(participant_name);
  resumed boolean := false;
begin
  perform public.snapcast_check_rate_limit('join_game_room', 120, interval '1 hour');
  if caller_id is null then raise exception 'game identity required'; end if;
  if participant_token is null or char_length(participant_token) < 32 or char_length(participant_token) > 256 then
    raise exception 'invalid participant capability';
  end if;
  if participant_role not in ('player', 'visitor') then
    raise exception 'invalid participant role';
  end if;
  if char_length(normalized_name) not between 1 and 32 then
    raise exception 'invalid participant name';
  end if;

  select * into target_room
  from public.game_rooms
  where code = upper(btrim(room_code))
    and status in ('lobby', 'live')
    and last_seen_at > now() - interval '15 minutes'
  for update;
  if not found then raise exception 'game is unavailable'; end if;

  if exists (
    select 1
    from public.game_memberships
    where game_id = target_room.id
      and auth_user_id = caller_id
      and removed_at is not null
  ) then
    raise exception 'you were removed from this game';
  end if;

  select * into joined_member
  from public.game_memberships
  where game_id = target_room.id
    and auth_user_id = caller_id
    and left_at is null
    and removed_at is null
  order by joined_at, id
  limit 1
  for update;

  if joined_member.id is not null then
    update public.game_memberships
    set token_hash = public.snapcast_token_hash(participant_token),
        display_name = normalized_name,
        last_seen_at = now()
    where id = joined_member.id
    returning * into joined_member;

    update public.game_rooms
    set realtime_epoch = gen_random_uuid(),
        owner_token_hash = case
          when owner_membership_id = joined_member.id
          then public.snapcast_token_hash(participant_token)
          else owner_token_hash
        end,
        last_seen_at = now()
    where id = target_room.id
    returning * into target_room;

    resumed := true;
  else
    if participant_role = 'player' and target_room.status <> 'lobby' then
      raise exception 'game has already started';
    end if;

    if participant_role = 'player' then
      select count(*) into active_count
      from public.game_memberships
      where game_id = target_room.id and role = 'player'
        and left_at is null and removed_at is null;
      if active_count >= target_room.seat_limit then raise exception 'game is full'; end if;
      select seat into next_seat
      from generate_series(1, target_room.seat_limit) seat
      where not exists (
        select 1 from public.game_memberships
        where game_id = target_room.id and seat_number = seat
          and left_at is null and removed_at is null
      )
      order by seat
      limit 1;
    else
      select count(*) into active_count
      from public.game_memberships
      where game_id = target_room.id and role = 'visitor'
        and left_at is null and removed_at is null;
      if active_count >= target_room.visitor_limit then raise exception 'visitor room is full'; end if;
    end if;

    insert into public.game_memberships (
      game_id, auth_user_id, profile_id, display_name, role, seat_number, token_hash
    ) values (
      target_room.id,
      caller_id,
      case when exists (select 1 from public.profiles where id = caller_id) then caller_id else null end,
      normalized_name,
      participant_role,
      next_seat,
      public.snapcast_token_hash(participant_token)
    )
    returning * into joined_member;
  end if;

  return jsonb_build_object(
    'game_id', target_room.id,
    'membership_id', joined_member.id,
    'code', target_room.code,
    'status', target_room.status,
    'seat_limit', target_room.seat_limit,
    'realtime_epoch', target_room.realtime_epoch,
    'role', joined_member.role,
    'owner', target_room.owner_membership_id = joined_member.id,
    'resumed', resumed
  );
end;
$$;

revoke all on function public.join_game_room(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_game_room(text, text, text, text)
  to authenticated;
