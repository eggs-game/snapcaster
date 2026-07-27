-- Durable game sessions, participant snapshots, turn timing, owner lifecycle,
-- and append-only result corrections.

alter table public.game_rooms
  add column if not exists owner_membership_id uuid references public.game_memberships(id) on delete set null;

update public.game_rooms rooms
set owner_membership_id = owners.id
from lateral (
  select memberships.id
  from public.game_memberships memberships
  where memberships.game_id = rooms.id
    and memberships.role = 'player'
  order by memberships.joined_at, memberships.id
  limit 1
) owners
where rooms.owner_membership_id is null;

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete restrict,
  game_number integer not null,
  state text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  proposed_at timestamptz,
  finalizes_at timestamptz,
  finalized_at timestamptz,
  result_kind text,
  winner_membership_id uuid references public.game_memberships(id) on delete set null,
  result_snapshot jsonb not null default '{}'::jsonb,
  start_idempotency_key uuid not null,
  end_idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint game_sessions_state check (state in ('active', 'proposed', 'final', 'unresolved')),
  constraint game_sessions_result_kind check (
    result_kind is null or result_kind in ('winner', 'draw', 'unresolved')
  ),
  constraint game_sessions_snapshot_size check (
    octet_length(result_snapshot::text) <= 262144
  ),
  unique (room_id, game_number),
  unique (room_id, start_idempotency_key)
);

create unique index if not exists game_sessions_one_active_per_room
  on public.game_sessions(room_id)
  where state = 'active';

create table if not exists public.game_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  membership_id uuid not null references public.game_memberships(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  seat_number smallint not null,
  result text not null default 'unknown',
  loss_reason text,
  final_life integer,
  final_poison integer,
  final_commander_damage jsonb not null default '{}'::jsonb,
  hidden_by_player boolean not null default false,
  created_at timestamptz not null default now(),
  constraint game_session_participants_result check (
    result in ('win', 'loss', 'draw', 'conceded', 'unknown')
  ),
  constraint game_session_participants_loss_reason check (
    loss_reason is null or loss_reason in ('life', 'commander_damage', 'poison', 'concede', 'other', 'unknown')
  ),
  constraint game_session_participants_final_life check (final_life is null or final_life between -999 and 999),
  constraint game_session_participants_final_poison check (final_poison is null or final_poison between 0 and 999),
  constraint game_session_participants_damage_size check (
    octet_length(final_commander_damage::text) <= 32768
  ),
  unique (session_id, membership_id),
  unique (session_id, seat_number)
);

create index if not exists game_session_participants_profile_history_idx
  on public.game_session_participants(profile_id, created_at desc)
  where profile_id is not null;

create table if not exists public.game_session_commanders (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.game_session_participants(id) on delete cascade,
  slot smallint not null,
  commander_name text not null,
  scryfall_id uuid,
  created_at timestamptz not null default now(),
  constraint game_session_commanders_slot check (slot in (1, 2)),
  constraint game_session_commanders_name_length check (
    char_length(btrim(commander_name)) between 1 and 120
  ),
  unique (participant_id, slot)
);

create table if not exists public.game_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  participant_id uuid not null references public.game_session_participants(id) on delete restrict,
  turn_number integer not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  elapsed_ms bigint generated always as (
    case when ended_at is null then null
      else greatest(0, floor(extract(epoch from (ended_at - started_at)) * 1000)::bigint)
    end
  ) stored,
  transition_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint game_turns_positive_number check (turn_number > 0),
  constraint game_turns_time_order check (ended_at is null or ended_at >= started_at),
  unique (session_id, turn_number),
  unique (session_id, transition_idempotency_key)
);

create unique index if not exists game_turns_one_open_per_session
  on public.game_turns(session_id)
  where ended_at is null;

create table if not exists public.game_result_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  actor_participant_id uuid references public.game_session_participants(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint game_result_corrections_reason_length check (
    char_length(btrim(reason)) between 1 and 500
  ),
  constraint game_result_corrections_status check (
    status in ('pending', 'accepted', 'declined', 'moderator_review')
  ),
  constraint game_result_corrections_size check (
    octet_length(before_snapshot::text) <= 262144
    and octet_length(after_snapshot::text) <= 262144
  )
);

create table if not exists public.game_audit_log (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.game_rooms(id) on delete restrict,
  session_id uuid references public.game_sessions(id) on delete restrict,
  actor_membership_id uuid references public.game_memberships(id) on delete set null,
  action text not null,
  target_membership_id uuid references public.game_memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint game_audit_log_action_length check (char_length(action) between 1 and 64),
  constraint game_audit_log_details_size check (octet_length(details::text) <= 32768),
  unique (room_id, idempotency_key)
);

create unique index if not exists game_result_corrections_one_pending_per_participant
  on public.game_result_corrections(session_id, actor_participant_id)
  where status = 'pending';

alter table public.game_sessions enable row level security;
alter table public.game_session_participants enable row level security;
alter table public.game_session_commanders enable row level security;
alter table public.game_turns enable row level security;
alter table public.game_result_corrections enable row level security;
alter table public.game_audit_log enable row level security;

revoke all on public.game_sessions from anon, authenticated;
revoke all on public.game_session_participants from anon, authenticated;
revoke all on public.game_session_commanders from anon, authenticated;
revoke all on public.game_turns from anon, authenticated;
revoke all on public.game_result_corrections from anon, authenticated;
revoke all on public.game_audit_log from anon, authenticated;

create or replace function public.snapcast_require_owner(target_room_id uuid, owner_token text)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
begin
  if owner_token is null or char_length(owner_token) < 32 or char_length(owner_token) > 256 then
    raise exception 'invalid owner capability';
  end if;
  select * into target_room
  from public.game_rooms
  where id = target_room_id
    and owner_token_hash = public.snapcast_token_hash(owner_token)
  for update;
  if not found then raise exception 'owner authorization failed'; end if;
  return target_room;
end;
$$;

revoke all on function public.snapcast_require_owner(uuid, text) from public, anon, authenticated;

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
  latest_session_id uuid;
  target_owner_membership_id uuid;
  target_owner_stale boolean;
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
  returning status, owner_membership_id, realtime_epoch
  into target_status, target_owner_membership_id, target_realtime_epoch;
  select (
    owner.left_at is not null
    or owner.removed_at is not null
    or owner.last_seen_at < now() - interval '2 minutes'
  ) into target_owner_stale
  from public.game_memberships owner
  where owner.id = target_owner_membership_id;
  select id into latest_session_id from public.game_sessions
  where room_id = target_game_id order by game_number desc limit 1;
  return jsonb_build_object(
    'active', true,
    'room_muted', target_muted,
    'room_status', target_status,
    'game_session_id', latest_session_id,
    'owner_membership_id', target_owner_membership_id,
    'owner_stale', coalesce(target_owner_stale, true),
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
      owner_token_hash = public.snapcast_token_hash(participant_token),
      realtime_epoch = gen_random_uuid()
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

create or replace function public.leave_game_room(
  membership_id uuid,
  participant_token text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_game_id uuid;
begin
  update public.game_memberships
  set left_at = now(), last_seen_at = now()
  where id = membership_id
    and token_hash = public.snapcast_token_hash(participant_token)
    and left_at is null and removed_at is null
  returning game_id into target_game_id;
  if target_game_id is null then return false; end if;
  update public.game_session_participants participants
  set result = 'conceded', loss_reason = 'concede'
  from public.game_sessions sessions
  where participants.session_id = sessions.id
    and participants.membership_id = leave_game_room.membership_id
    and sessions.room_id = target_game_id
    and sessions.state = 'active';
  update public.game_rooms set realtime_epoch = gen_random_uuid()
  where id = target_game_id;
  return true;
end;
$$;

create or replace function public.get_game_membership_states(
  target_game_id uuid,
  acting_membership_id uuid,
  participant_token text
)
returns table (
  membership_id uuid,
  role text,
  room_muted boolean,
  profile_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select members.id, members.role, members.room_muted, members.profile_id, members.display_name
  from public.game_memberships members
  where members.game_id = target_game_id
    and members.left_at is null
    and members.removed_at is null
    and exists (
      select 1 from public.game_memberships caller
      where caller.id = acting_membership_id
        and caller.game_id = target_game_id
        and caller.token_hash = public.snapcast_token_hash(participant_token)
        and caller.left_at is null
        and caller.removed_at is null
    );
$$;

create or replace function public.claim_guest_game_membership(
  target_membership_id uuid,
  participant_token text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership public.game_memberships;
  claimed_records integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into target_membership
  from public.game_memberships
  where id = target_membership_id
    and token_hash = public.snapcast_token_hash(participant_token)
    and profile_id is null
    and joined_at > now() - interval '48 hours'
  for update;
  if not found then return 0; end if;
  if exists (
    select 1 from public.game_memberships
    where game_id = target_membership.game_id and profile_id = auth.uid()
      and id <> target_membership_id
  ) then raise exception 'account already has a seat in this game'; end if;
  update public.game_memberships set profile_id = auth.uid(), auth_user_id = auth.uid()
  where id = target_membership_id;
  update public.game_session_participants set profile_id = auth.uid()
  where membership_id = target_membership_id and profile_id is null;
  get diagnostics claimed_records = row_count;
  insert into public.game_audit_log(
    room_id, actor_membership_id, action, details, idempotency_key
  ) values (
    target_membership.game_id, target_membership_id, 'guest_games_claimed',
    jsonb_build_object('records', claimed_records), gen_random_uuid()
  );
  return claimed_records;
end;
$$;

create or replace function public.owner_start_game(
  target_room_id uuid,
  owner_token text,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
  target_session public.game_sessions;
  first_participant uuid;
begin
  target_room := public.snapcast_require_owner(target_room_id, owner_token);

  select * into target_session
  from public.game_sessions
  where room_id = target_room_id and start_idempotency_key = idempotency_key;
  if found then
    return jsonb_build_object('session_id', target_session.id, 'status', 'live', 'started_at', target_session.started_at);
  end if;
  if target_room.status <> 'lobby' then raise exception 'game is not in the lobby'; end if;
  if (
    select count(*) from public.game_memberships
    where game_id = target_room_id
      and role = 'player'
      and left_at is null
      and removed_at is null
  ) < 2 then raise exception 'at least two players are required to start'; end if;

  insert into public.game_sessions (
    room_id, game_number, start_idempotency_key
  ) values (
    target_room_id,
    coalesce((select max(game_number) + 1 from public.game_sessions where room_id = target_room_id), 1),
    idempotency_key
  )
  returning * into target_session;

  insert into public.game_session_participants (
    session_id, membership_id, profile_id, display_name, seat_number
  )
  select
    target_session.id, id, profile_id, display_name, seat_number
  from public.game_memberships
  where game_id = target_room_id
    and role = 'player'
    and left_at is null
    and removed_at is null
  order by seat_number;

  insert into public.game_session_commanders (participant_id, slot, commander_name)
  select participants.id, 1, memberships.commander_name
  from public.game_session_participants participants
  join public.game_memberships memberships on memberships.id = participants.membership_id
  where participants.session_id = target_session.id
    and memberships.commander_name is not null;

  insert into public.game_session_commanders (participant_id, slot, commander_name)
  select participants.id, 2, memberships.partner_commander_name
  from public.game_session_participants participants
  join public.game_memberships memberships on memberships.id = participants.membership_id
  where participants.session_id = target_session.id
    and memberships.partner_commander_name is not null;

  select id into first_participant
  from public.game_session_participants
  where session_id = target_session.id
  order by seat_number
  limit 1;

  if first_participant is not null then
    insert into public.game_turns (
      session_id, participant_id, turn_number, started_at, transition_idempotency_key
    ) values (
      target_session.id, first_participant, 1, target_session.started_at, idempotency_key
    );
  end if;

  update public.game_rooms
  set status = 'live', started_at = target_session.started_at, ended_at = null, last_seen_at = now()
  where id = target_room_id;

  insert into public.game_audit_log (
    room_id, session_id, actor_membership_id, action, idempotency_key
  ) values (
    target_room_id, target_session.id, target_room.owner_membership_id, 'game_started', idempotency_key
  );

  return jsonb_build_object('session_id', target_session.id, 'status', 'live', 'started_at', target_session.started_at);
end;
$$;

create or replace function public.owner_manage_member(
  target_room_id uuid,
  owner_token text,
  target_membership_id uuid,
  requested_action text,
  idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
  target_role text;
begin
  target_room := public.snapcast_require_owner(target_room_id, owner_token);
  if target_membership_id = target_room.owner_membership_id then
    raise exception 'owner cannot remove or room-mute themselves';
  end if;
  if exists (
    select 1 from public.game_audit_log
    where room_id = target_room_id and game_audit_log.idempotency_key = owner_manage_member.idempotency_key
  ) then return true; end if;

  select role into target_role from public.game_memberships
  where id = target_membership_id and game_id = target_room_id
    and left_at is null and removed_at is null
  for update;
  if not found then raise exception 'participant is unavailable'; end if;

  if requested_action = 'remove' then
    update public.game_memberships
    set removed_at = now(), last_seen_at = now()
    where id = target_membership_id;
    update public.game_session_participants participants
    set result = 'conceded', loss_reason = 'other'
    from public.game_sessions sessions
    where participants.session_id = sessions.id
      and participants.membership_id = target_membership_id
      and sessions.room_id = target_room_id
      and sessions.state = 'active';
    update public.game_rooms set realtime_epoch = gen_random_uuid()
    where id = target_room_id;
  elsif requested_action in ('mute', 'unmute') then
    if target_role <> 'visitor' then raise exception 'only visitors can be room-muted'; end if;
    update public.game_memberships
    set room_muted = requested_action = 'mute'
    where id = target_membership_id;
  else
    raise exception 'invalid management action';
  end if;

  insert into public.game_audit_log (
    room_id, actor_membership_id, action, target_membership_id, idempotency_key
  ) values (
    target_room_id, target_room.owner_membership_id, requested_action, target_membership_id, idempotency_key
  );
  return true;
end;
$$;

create or replace function public.record_game_turn(
  target_session_id uuid,
  acting_membership_id uuid,
  participant_token text,
  next_membership_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.game_sessions;
  current_turn public.game_turns;
  next_participant uuid;
begin
  select * into target_session from public.game_sessions
  where id = target_session_id and state = 'active'
  for update;
  if not found then raise exception 'game session is not active'; end if;

  if not exists (
    select 1 from public.game_memberships memberships
    join public.game_session_participants participants
      on participants.membership_id = memberships.id
      and participants.session_id = target_session_id
    where memberships.id = acting_membership_id
      and memberships.token_hash = public.snapcast_token_hash(participant_token)
      and memberships.left_at is null and memberships.removed_at is null
  ) then raise exception 'participant authorization failed'; end if;

  select * into current_turn
  from public.game_turns
  where session_id = target_session_id and ended_at is null
  for update;

  if current_turn.transition_idempotency_key = idempotency_key then
    return jsonb_build_object('turn_number', current_turn.turn_number, 'started_at', current_turn.started_at);
  end if;

  select id into next_participant
  from public.game_session_participants
  where session_id = target_session_id and membership_id = next_membership_id;
  if not found then raise exception 'next player is not in this game'; end if;

  if current_turn.id is not null then
    update public.game_turns set ended_at = now() where id = current_turn.id;
  end if;

  insert into public.game_turns (
    session_id, participant_id, turn_number, started_at, transition_idempotency_key
  ) values (
    target_session_id,
    next_participant,
    coalesce(current_turn.turn_number + 1, 1),
    now(),
    idempotency_key
  )
  returning * into current_turn;

  return jsonb_build_object('turn_number', current_turn.turn_number, 'started_at', current_turn.started_at);
exception
  when unique_violation then
    select * into current_turn from public.game_turns
    where session_id = target_session_id and transition_idempotency_key = idempotency_key;
    return jsonb_build_object('turn_number', current_turn.turn_number, 'started_at', current_turn.started_at);
end;
$$;

create or replace function public.owner_end_game(
  target_room_id uuid,
  owner_token text,
  p_result_kind text,
  p_winner_membership_id uuid,
  final_snapshot jsonb,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
  target_session public.game_sessions;
  snapshot_entry jsonb;
  participant_record public.game_session_participants;
begin
  target_room := public.snapcast_require_owner(target_room_id, owner_token);
  if p_result_kind not in ('winner', 'draw', 'unresolved') then raise exception 'invalid result'; end if;
  if octet_length(coalesce(final_snapshot, '{}'::jsonb)::text) > 262144 then raise exception 'snapshot is too large'; end if;

  select * into target_session
  from public.game_sessions
  where room_id = target_room_id and state = 'active'
  for update;
  if not found then
    select * into target_session from public.game_sessions
    where room_id = target_room_id and end_idempotency_key = idempotency_key;
    if found then return jsonb_build_object('session_id', target_session.id, 'status', target_session.state); end if;
    raise exception 'game session is not active';
  end if;

  if p_result_kind = 'winner' and not exists (
    select 1 from public.game_session_participants
    where session_id = target_session.id and membership_id = p_winner_membership_id
  ) then raise exception 'winner is not a participant'; end if;

  update public.game_turns set ended_at = now()
  where session_id = target_session.id and ended_at is null;

  for snapshot_entry in select * from jsonb_array_elements(coalesce(final_snapshot -> 'players', '[]'::jsonb))
  loop
    select * into participant_record
    from public.game_session_participants
    where session_id = target_session.id
      and membership_id = (snapshot_entry ->> 'membership_id')::uuid;
    if found then
      update public.game_session_participants
      set result = case
            when p_result_kind = 'draw' then 'draw'
            when p_result_kind = 'unresolved' then 'unknown'
            when participant_record.membership_id = p_winner_membership_id then 'win'
            when snapshot_entry ->> 'result' in ('loss', 'conceded') then snapshot_entry ->> 'result'
            else 'loss'
          end,
          loss_reason = case
            when snapshot_entry ->> 'loss_reason' in ('life', 'commander_damage', 'poison', 'concede', 'other', 'unknown')
              then snapshot_entry ->> 'loss_reason'
            else null
          end,
          final_life = greatest(-999, least(999, coalesce((snapshot_entry ->> 'life')::integer, 0))),
          final_poison = greatest(0, least(999, coalesce((snapshot_entry ->> 'poison')::integer, 0))),
          final_commander_damage = coalesce(snapshot_entry -> 'commander_damage', '{}'::jsonb)
      where id = participant_record.id;
    end if;
  end loop;

  update public.game_sessions
  set state = case when p_result_kind = 'unresolved' then 'unresolved' else 'proposed' end,
      ended_at = now(),
      proposed_at = now(),
      finalizes_at = case when p_result_kind = 'unresolved' then null else now() + interval '24 hours' end,
      result_kind = p_result_kind,
      winner_membership_id = case when p_result_kind = 'winner' then p_winner_membership_id else null end,
      result_snapshot = coalesce(final_snapshot, '{}'::jsonb),
      end_idempotency_key = idempotency_key
  where id = target_session.id
  returning * into target_session;

  update public.game_rooms
  set status = 'finished', ended_at = target_session.ended_at, last_seen_at = now()
  where id = target_room_id;

  insert into public.game_audit_log (
    room_id, session_id, actor_membership_id, action, details, idempotency_key
  ) values (
    target_room_id,
    target_session.id,
    target_room.owner_membership_id,
    'game_ended',
    jsonb_build_object('result_kind', p_result_kind, 'winner_membership_id', p_winner_membership_id),
    idempotency_key
  );

  return jsonb_build_object(
    'session_id', target_session.id,
    'status', target_session.state,
    'finalizes_at', target_session.finalizes_at
  );
end;
$$;

create or replace function public.owner_restart_game(
  target_room_id uuid,
  owner_token text,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.game_rooms;
  target_session public.game_sessions;
begin
  target_room := public.snapcast_require_owner(target_room_id, owner_token);
  if exists (
    select 1 from public.game_audit_log
    where room_id = target_room_id and game_audit_log.idempotency_key = owner_restart_game.idempotency_key
  ) then return jsonb_build_object('status', 'lobby'); end if;

  select * into target_session from public.game_sessions
  where room_id = target_room_id and state = 'active'
  for update;
  if found then
    update public.game_turns set ended_at = now()
    where session_id = target_session.id and ended_at is null;
    update public.game_sessions
    set state = 'unresolved', ended_at = now(), result_kind = 'unresolved'
    where id = target_session.id;
  end if;

  update public.game_memberships
  set commander_name = null, partner_commander_name = null, room_muted = false
  where game_id = target_room_id and left_at is null and removed_at is null;

  update public.game_rooms
  set status = 'lobby', started_at = null, ended_at = null, last_seen_at = now()
  where id = target_room_id;

  insert into public.game_audit_log (
    room_id, session_id, actor_membership_id, action, idempotency_key
  ) values (
    target_room_id, target_session.id, target_room.owner_membership_id, 'game_restarted', idempotency_key
  );
  return jsonb_build_object('status', 'lobby');
end;
$$;

create or replace function public.submit_game_correction(
  target_session_id uuid,
  acting_membership_id uuid,
  participant_token text,
  reason text,
  proposed_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.game_sessions;
  actor_participant public.game_session_participants;
  correction_id uuid;
begin
  select * into target_session from public.game_sessions
  where id = target_session_id
    and state = 'proposed'
    and finalizes_at > now();
  if not found then raise exception 'correction window is closed'; end if;
  select participants.* into actor_participant
  from public.game_session_participants participants
  join public.game_memberships memberships on memberships.id = participants.membership_id
  where participants.session_id = target_session_id
    and memberships.id = acting_membership_id
    and memberships.token_hash = public.snapcast_token_hash(participant_token);
  if not found then raise exception 'participant authorization failed'; end if;
  if char_length(btrim(reason)) not between 1 and 500 then raise exception 'invalid correction reason'; end if;
  if octet_length(proposed_snapshot::text) > 262144 then raise exception 'snapshot is too large'; end if;
  perform public.snapcast_check_rate_limit('game_correction', 10, interval '1 day');

  insert into public.game_result_corrections (
    session_id, actor_participant_id, actor_profile_id, reason, before_snapshot, after_snapshot
  ) values (
    target_session_id,
    actor_participant.id,
    actor_participant.profile_id,
    btrim(reason),
    target_session.result_snapshot,
    proposed_snapshot
  ) returning id into correction_id;

  return correction_id;
end;
$$;

create or replace function public.finalize_due_game_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  finalized_count integer;
begin
  with finalized as (
    update public.game_sessions sessions
    set state = 'final', finalized_at = now()
    where state = 'proposed'
      and finalizes_at <= now()
      and not exists (
        select 1 from public.game_result_corrections corrections
        where corrections.session_id = sessions.id and corrections.status = 'pending'
      )
    returning 1
  )
  select count(*) into finalized_count from finalized;
  return finalized_count;
end;
$$;

revoke all on function public.owner_start_game(uuid, text, uuid) from public;
revoke all on function public.claim_game_ownership(uuid, uuid, text) from public;
revoke all on function public.get_game_membership_states(uuid, uuid, text) from public;
revoke all on function public.claim_guest_game_membership(uuid, text) from public;
revoke all on function public.owner_manage_member(uuid, text, uuid, text, uuid) from public;
revoke all on function public.record_game_turn(uuid, uuid, text, uuid, uuid) from public;
revoke all on function public.owner_end_game(uuid, text, text, uuid, jsonb, uuid) from public;
revoke all on function public.owner_restart_game(uuid, text, uuid) from public;
revoke all on function public.submit_game_correction(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.finalize_due_game_results() from public, anon, authenticated;

grant execute on function public.owner_start_game(uuid, text, uuid) to anon, authenticated;
grant execute on function public.claim_game_ownership(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_game_membership_states(uuid, uuid, text) to anon, authenticated;
grant execute on function public.claim_guest_game_membership(uuid, text) to authenticated;
grant execute on function public.owner_manage_member(uuid, text, uuid, text, uuid) to anon, authenticated;
grant execute on function public.record_game_turn(uuid, uuid, text, uuid, uuid) to anon, authenticated;
grant execute on function public.owner_end_game(uuid, text, text, uuid, jsonb, uuid) to anon, authenticated;
grant execute on function public.owner_restart_game(uuid, text, uuid) to anon, authenticated;
grant execute on function public.submit_game_correction(uuid, uuid, text, text, jsonb) to anon, authenticated;
