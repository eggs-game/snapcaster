-- Public/private room directory and server-authorized membership.
-- Durable game records are added in the next migration; this migration owns
-- discovery, capacity, lifecycle state, and host/participant capabilities.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  bracket smallint not null,
  visibility text not null default 'private',
  status text not null default 'lobby',
  owner_profile_id uuid references public.profiles(id) on delete set null,
  owner_token_hash bytea not null,
  seat_limit smallint not null default 4,
  visitor_limit smallint not null default 8,
  started_at timestamptz,
  ended_at timestamptz,
  realtime_epoch uuid not null default gen_random_uuid(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_rooms_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint game_rooms_name_length check (char_length(btrim(name)) between 1 and 48),
  constraint game_rooms_bracket check (bracket between 1 and 5),
  constraint game_rooms_visibility check (visibility in ('private', 'public')),
  constraint game_rooms_status check (status in ('lobby', 'live', 'finished', 'closed')),
  constraint game_rooms_seat_limit check (seat_limit between 2 and 6),
  constraint game_rooms_visitor_limit check (visitor_limit between 0 and 8),
  constraint game_rooms_lifecycle check (
    (status = 'lobby' and started_at is null and ended_at is null)
    or (status = 'live' and started_at is not null and ended_at is null)
    or (status in ('finished', 'closed') and ended_at is not null)
  )
);

create index if not exists game_rooms_public_directory_idx
  on public.game_rooms(status, bracket, last_seen_at desc)
  where visibility = 'public' and status in ('lobby', 'live');

create table if not exists public.game_memberships (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.game_rooms(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  role text not null,
  seat_number smallint,
  token_hash bytea not null,
  commander_name text,
  partner_commander_name text,
  room_muted boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  removed_at timestamptz,
  constraint game_memberships_name_length check (char_length(btrim(display_name)) between 1 and 32),
  constraint game_memberships_role check (role in ('player', 'visitor')),
  constraint game_memberships_seat check (
    (role = 'player' and seat_number between 1 and 6)
    or (role = 'visitor' and seat_number is null)
  ),
  constraint game_memberships_commander_length check (
    commander_name is null or char_length(commander_name) <= 120
  ),
  constraint game_memberships_partner_length check (
    partner_commander_name is null or char_length(partner_commander_name) <= 120
  )
);

create unique index if not exists game_memberships_active_seat_unique
  on public.game_memberships(game_id, seat_number)
  where role = 'player' and left_at is null and removed_at is null;

create unique index if not exists game_memberships_active_profile_unique
  on public.game_memberships(game_id, profile_id)
  where profile_id is not null and left_at is null and removed_at is null;

create index if not exists game_memberships_game_active_idx
  on public.game_memberships(game_id, role, joined_at)
  where left_at is null and removed_at is null;

create index if not exists game_memberships_auth_active_idx
  on public.game_memberships(auth_user_id, game_id)
  where auth_user_id is not null and left_at is null and removed_at is null;

-- Created here so public discovery can enforce block isolation even before
-- the social RPC migration adds the rest of the friends feature.
create table if not exists public.player_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint player_blocks_not_self check (blocker_id <> blocked_id)
);
alter table public.player_blocks enable row level security;
revoke all on public.player_blocks from anon, authenticated;

alter table public.game_rooms
  add column if not exists owner_membership_id uuid references public.game_memberships(id) on delete set null;

create table if not exists public.security_rate_events (
  id bigint generated always as identity primary key,
  actor_hash bytea not null,
  action text not null,
  occurred_at timestamptz not null default now(),
  constraint security_rate_events_action_length check (char_length(action) between 1 and 64)
);
create index if not exists security_rate_events_lookup_idx
  on public.security_rate_events(action, actor_hash, occurred_at desc);
alter table public.security_rate_events enable row level security;
revoke all on public.security_rate_events from anon, authenticated;

drop trigger if exists game_rooms_set_updated_at on public.game_rooms;
create trigger game_rooms_set_updated_at
  before update on public.game_rooms
  for each row execute function public.set_updated_at();

alter table public.game_rooms enable row level security;
alter table public.game_memberships enable row level security;
revoke all on public.game_rooms from anon, authenticated;
revoke all on public.game_memberships from anon, authenticated;

create or replace function public.snapcast_token_hash(token text)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $$
  select extensions.digest(token, 'sha256');
$$;

revoke all on function public.snapcast_token_hash(text) from public, anon, authenticated;

create or replace function public.snapcast_check_rate_limit(
  requested_action text,
  maximum_events integer,
  window_length interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  actor_ip text := split_part(
    coalesce(headers ->> 'x-forwarded-for', headers ->> 'cf-connecting-ip', 'anonymous'),
    ',',
    1
  );
  identity_hash bytea := extensions.digest(
    case when auth.uid() is null then 'ip:' || actor_ip else 'user:' || auth.uid()::text end,
    'sha256'
  );
  ip_hash bytea := extensions.digest('ip:' || actor_ip, 'sha256');
begin
  delete from public.security_rate_events where occurred_at < now() - interval '2 days';
  if (
    select count(*) from public.security_rate_events
    where action = requested_action
      and actor_hash = identity_hash
      and occurred_at > now() - window_length
  ) >= maximum_events then
    raise exception 'rate limit reached';
  end if;
  if identity_hash <> ip_hash and (
    select count(*) from public.security_rate_events
    where action = requested_action
      and actor_hash = ip_hash
      and occurred_at > now() - window_length
  ) >= maximum_events then
    raise exception 'rate limit reached';
  end if;
  insert into public.security_rate_events(actor_hash, action)
  values (identity_hash, left(requested_action, 64));
  if identity_hash <> ip_hash then
    insert into public.security_rate_events(actor_hash, action)
    values (ip_hash, left(requested_action, 64));
  end if;
end;
$$;
revoke all on function public.snapcast_check_rate_limit(text, integer, interval) from public, anon, authenticated;

create or replace function public.create_game_room(
  room_code text,
  room_name text,
  room_bracket integer,
  room_visibility text,
  room_seat_limit integer,
  owner_token text,
  owner_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_room public.game_rooms;
  created_member public.game_memberships;
  normalized_code text := upper(btrim(room_code));
  normalized_name text := btrim(room_name);
  normalized_owner_name text := btrim(owner_display_name);
begin
  perform public.snapcast_check_rate_limit('create_game_room', 10, interval '1 hour');
  if auth.uid() is null then raise exception 'game identity required'; end if;
  if owner_token is null or char_length(owner_token) < 32 or char_length(owner_token) > 256 then
    raise exception 'invalid owner capability';
  end if;
  if normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'invalid room code';
  end if;
  if char_length(normalized_name) not between 1 and 48 then
    raise exception 'invalid room name';
  end if;
  if char_length(normalized_owner_name) not between 1 and 32 then
    raise exception 'invalid owner name';
  end if;
  if room_bracket not between 1 and 5
    or room_visibility not in ('private', 'public')
    or room_seat_limit not between 2 and 6 then
    raise exception 'invalid room settings';
  end if;

  insert into public.game_rooms (
    code, name, bracket, visibility, owner_profile_id, owner_token_hash, seat_limit
  ) values (
    normalized_code,
    normalized_name,
    room_bracket,
    room_visibility,
    case when exists (select 1 from public.profiles where id = auth.uid()) then auth.uid() else null end,
    public.snapcast_token_hash(owner_token),
    room_seat_limit
  )
  returning * into created_room;

  insert into public.game_memberships (
    game_id, auth_user_id, profile_id, display_name, role, seat_number, token_hash
  ) values (
    created_room.id,
    auth.uid(),
    case when exists (select 1 from public.profiles where id = auth.uid()) then auth.uid() else null end,
    normalized_owner_name,
    'player',
    1,
    public.snapcast_token_hash(owner_token)
  )
  returning * into created_member;

  update public.game_rooms
  set owner_membership_id = created_member.id
  where id = created_room.id;

  return jsonb_build_object(
    'game_id', created_room.id,
    'membership_id', created_member.id,
    'code', created_room.code,
    'status', created_room.status,
    'realtime_epoch', created_room.realtime_epoch
  );
exception
  when unique_violation then
    raise exception 'room code is already in use';
end;
$$;

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
  target_room public.game_rooms;
  created_member public.game_memberships;
  next_seat smallint;
  active_count integer;
  normalized_name text := btrim(participant_name);
begin
  perform public.snapcast_check_rate_limit('join_game_room', 120, interval '1 hour');
  if auth.uid() is null then raise exception 'game identity required'; end if;
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
  if participant_role = 'player' and target_room.status <> 'lobby' then
    raise exception 'game has already started';
  end if;

  if auth.uid() is not null and exists (
    select 1 from public.game_memberships
    where game_id = target_room.id
      and profile_id = auth.uid()
      and left_at is null and removed_at is null
  ) then
    raise exception 'account is already in this game';
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
    auth.uid(),
    case when exists (select 1 from public.profiles where id = auth.uid()) then auth.uid() else null end,
    normalized_name,
    participant_role,
    next_seat,
    public.snapcast_token_hash(participant_token)
  )
  returning * into created_member;

  return jsonb_build_object(
    'game_id', target_room.id,
    'membership_id', created_member.id,
    'code', target_room.code,
    'status', target_room.status,
    'seat_limit', target_room.seat_limit,
    'realtime_epoch', target_room.realtime_epoch
  );
end;
$$;

create or replace function public.list_public_game_rooms(
  requested_status text default null,
  requested_bracket integer default null,
  open_seats_only boolean default false,
  search_text text default null,
  result_limit integer default 24
)
returns table (
  game_id uuid,
  code text,
  name text,
  bracket smallint,
  status text,
  seat_limit smallint,
  player_count bigint,
  visitor_count bigint,
  commanders text[],
  players jsonb,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    rooms.id,
    rooms.code,
    rooms.name,
    rooms.bracket,
    rooms.status,
    rooms.seat_limit,
    count(members.id) filter (where members.role = 'player'),
    count(members.id) filter (where members.role = 'visitor'),
    coalesce(
      array_agg(
        case
          when members.partner_commander_name is not null
            then members.commander_name || ' + ' || members.partner_commander_name
          else members.commander_name
        end
        order by members.seat_number
      ) filter (where members.role = 'player' and members.commander_name is not null),
      array[]::text[]
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profiles.id,
        'display_name', profiles.display_name,
        'seat_number', listed_players.seat_number
      ) order by listed_players.seat_number)
      from public.game_memberships listed_players
      join public.profiles profiles on profiles.id = listed_players.profile_id
      left join public.account_preferences preferences on preferences.user_id = profiles.id
      where listed_players.game_id = rooms.id
        and listed_players.role = 'player'
        and listed_players.left_at is null
        and listed_players.removed_at is null
        and not coalesce(preferences.appear_offline, false)
        and (
          auth.uid() is null
          or not exists (
            select 1 from public.player_blocks blocks
            where (blocks.blocker_id = auth.uid() and blocks.blocked_id = profiles.id)
              or (blocks.blocker_id = profiles.id and blocks.blocked_id = auth.uid())
          )
        )
    ), '[]'::jsonb),
    rooms.last_seen_at
  from public.game_rooms rooms
  left join public.game_memberships members
    on members.game_id = rooms.id
    and members.left_at is null
    and members.removed_at is null
  where rooms.visibility = 'public'
    and rooms.status in ('lobby', 'live')
    and rooms.last_seen_at > now() - interval '5 minutes'
    and (requested_status is null or rooms.status = requested_status)
    and (requested_bracket is null or rooms.bracket = requested_bracket)
    and (
      search_text is null
      or rooms.name ilike '%' || left(btrim(search_text), 64) || '%'
      or exists (
        select 1 from public.game_memberships search_member
        where search_member.game_id = rooms.id
          and search_member.left_at is null
          and search_member.removed_at is null
          and (
            search_member.commander_name ilike '%' || left(btrim(search_text), 64) || '%'
            or search_member.partner_commander_name ilike '%' || left(btrim(search_text), 64) || '%'
          )
      )
    )
  group by rooms.id
  having (
    not open_seats_only
    or (
      rooms.status = 'lobby'
      and count(members.id) filter (where members.role = 'player') < rooms.seat_limit
    )
  )
  order by rooms.last_seen_at desc
  limit least(greatest(coalesce(result_limit, 24), 1), 50);
$$;

create or replace function public.touch_game_membership(
  membership_id uuid,
  participant_token text,
  commander text default null,
  partner_commander text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_game_id uuid;
  target_muted boolean;
  target_status text;
  target_realtime_epoch uuid;
begin
  update public.game_memberships
  set last_seen_at = now(),
      commander_name = nullif(left(btrim(commander), 120), ''),
      partner_commander_name = nullif(left(btrim(partner_commander), 120), '')
  where id = membership_id
    and token_hash = public.snapcast_token_hash(participant_token)
    and left_at is null and removed_at is null
  returning game_id, room_muted into target_game_id, target_muted;
  if target_game_id is null then return jsonb_build_object('active', false); end if;
  update public.game_rooms set last_seen_at = now()
  where id = target_game_id
  returning status, realtime_epoch into target_status, target_realtime_epoch;
  return jsonb_build_object(
    'active', true,
    'room_muted', target_muted,
    'room_status', target_status,
    'realtime_epoch', target_realtime_epoch,
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'membership_id', members.id,
        'role', members.role,
        'room_muted', members.room_muted,
        'profile_id', members.profile_id,
        'display_name', members.display_name
      )), '[]'::jsonb)
      from public.game_memberships members
      where members.game_id = target_game_id
        and members.left_at is null
        and members.removed_at is null
    )
  );
end;
$$;

create or replace function public.leave_game_room(
  membership_id uuid,
  participant_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_game_id uuid;
begin
  update public.game_memberships
  set left_at = now(), last_seen_at = now()
  where id = membership_id
    and token_hash = public.snapcast_token_hash(participant_token)
    and left_at is null and removed_at is null
  returning game_id into target_game_id;
  if target_game_id is null then return false; end if;
  update public.game_rooms set realtime_epoch = gen_random_uuid()
  where id = target_game_id;
  return true;
end;
$$;

revoke all on function public.create_game_room(text, text, integer, text, integer, text, text) from public;
revoke all on function public.join_game_room(text, text, text, text) from public;
revoke all on function public.list_public_game_rooms(text, integer, boolean, text, integer) from public;
revoke all on function public.touch_game_membership(uuid, text, text, text) from public;
revoke all on function public.leave_game_room(uuid, text) from public;

grant execute on function public.create_game_room(text, text, integer, text, integer, text, text) to anon, authenticated;
grant execute on function public.join_game_room(text, text, text, text) to anon, authenticated;
grant execute on function public.list_public_game_rooms(text, integer, boolean, text, integer) to anon, authenticated;
grant execute on function public.touch_game_membership(uuid, text, text, text) to anon, authenticated;
grant execute on function public.leave_game_room(uuid, text) to anon, authenticated;
