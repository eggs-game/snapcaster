-- Commander selections and saved decks must be introduced by the trusted
-- same-origin API after validation against current Scryfall Oracle data.

alter table public.game_memberships
  add column if not exists commander_scryfall_id uuid,
  add column if not exists partner_commander_scryfall_id uuid,
  add column if not exists partner_commander_type_line text;

create or replace function public.snapcast_stamp_session_commander_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_scryfall_id uuid;
begin
  if tg_op = 'INSERT' and new.scryfall_id is null then
    select case when new.slot = 1
      then memberships.commander_scryfall_id
      else memberships.partner_commander_scryfall_id
    end into selected_scryfall_id
    from public.game_session_participants participants
    join public.game_memberships memberships on memberships.id = participants.membership_id
    where participants.id = new.participant_id;
    new.scryfall_id := selected_scryfall_id;
  elsif tg_op = 'UPDATE' and new.commander_name is distinct from old.commander_name then
    new.scryfall_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists game_session_commanders_stamp_scryfall_id on public.game_session_commanders;
create trigger game_session_commanders_stamp_scryfall_id
  before insert or update on public.game_session_commanders
  for each row execute function public.snapcast_stamp_session_commander_id();

revoke insert, update on public.saved_commander_decks from authenticated;
grant select, delete on public.saved_commander_decks to authenticated;

drop policy if exists "players create their commander decks" on public.saved_commander_decks;
drop policy if exists "players update their commander decks" on public.saved_commander_decks;

create or replace function public.snapcast_check_server_rate_limit(
  target_auth_user_id uuid,
  target_ip text,
  requested_action text,
  maximum_events integer,
  window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_hash bytea;
  ip_hash bytea;
  bounded_action text := left(btrim(requested_action), 64);
  bounded_maximum integer := least(greatest(maximum_events, 1), 1000);
  bounded_window interval := pg_catalog.make_interval(secs => least(greatest(window_seconds, 1), 604800));
begin
  if target_auth_user_id is null or bounded_action = '' then raise exception 'invalid rate limit actor'; end if;
  user_hash := extensions.digest('user:' || target_auth_user_id::text, 'sha256');
  ip_hash := extensions.digest('ip:' || left(coalesce(nullif(btrim(target_ip), ''), 'unknown'), 96), 'sha256');

  if (
    select count(*) from public.security_rate_events
    where action = bounded_action
      and actor_hash = user_hash
      and occurred_at > now() - bounded_window
  ) >= bounded_maximum then
    raise exception 'rate limit reached';
  end if;
  if (
    select count(*) from public.security_rate_events
    where action = bounded_action
      and actor_hash = ip_hash
      and occurred_at > now() - bounded_window
  ) >= bounded_maximum then
    raise exception 'rate limit reached';
  end if;

  insert into public.security_rate_events(actor_hash, action)
  values (user_hash, bounded_action), (ip_hash, bounded_action);
end;
$$;

create or replace function public.set_validated_game_commanders(
  target_membership_id uuid,
  participant_token text,
  target_auth_user_id uuid,
  p_commander_name text,
  p_commander_scryfall_id uuid,
  p_partner_name text default null,
  p_partner_scryfall_id uuid default null,
  p_partner_type_line text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_commander text := nullif(left(btrim(p_commander_name), 120), '');
  clean_partner text := nullif(left(btrim(p_partner_name), 120), '');
begin
  if clean_commander is null or p_commander_scryfall_id is null or target_auth_user_id is null then
    raise exception 'validated commander required';
  end if;
  if (clean_partner is null) <> (p_partner_scryfall_id is null) then
    raise exception 'validated partner is incomplete';
  end if;

  update public.game_memberships
  set commander_name = clean_commander,
      commander_scryfall_id = p_commander_scryfall_id,
      partner_commander_name = clean_partner,
      partner_commander_scryfall_id = p_partner_scryfall_id,
      partner_commander_type_line = case
        when clean_partner is null then null
        else nullif(left(btrim(p_partner_type_line), 240), '')
      end
  where id = target_membership_id
    and auth_user_id = target_auth_user_id
    and token_hash = public.snapcast_token_hash(participant_token)
    and role = 'player'
    and left_at is null
    and removed_at is null;
  if not found then raise exception 'active player membership required'; end if;
  return true;
end;
$$;

-- Presence refresh is intentionally read/heartbeat-only. The legacy commander
-- arguments remain in the signature for a non-breaking rollout but are ignored.
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
  set last_seen_at = now()
  where id = membership_id
    and auth_user_id = auth.uid()
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
        'display_name', members.display_name,
        'commander_name', members.commander_name,
        'commander_scryfall_id', members.commander_scryfall_id,
        'partner_commander_name', members.partner_commander_name,
        'partner_commander_scryfall_id', members.partner_commander_scryfall_id,
        'partner_commander_type_line', members.partner_commander_type_line
      )), '[]'::jsonb)
      from public.game_memberships members
      where members.game_id = target_game_id
        and members.left_at is null
        and members.removed_at is null
    )
  );
end;
$$;

revoke all on function public.snapcast_check_server_rate_limit(uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.set_validated_game_commanders(uuid, text, uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.snapcast_stamp_session_commander_id()
  from public, anon, authenticated;
grant execute on function public.snapcast_check_server_rate_limit(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.set_validated_game_commanders(uuid, text, uuid, text, uuid, text, uuid, text)
  to service_role;
