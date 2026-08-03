-- Keep every client clock anchored to the durable session timestamp returned
-- by the existing membership heartbeat.
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
  latest_session_started_at timestamptz;
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

  select id, started_at into latest_session_id, latest_session_started_at
  from public.game_sessions
  where room_id = target_game_id
  order by game_number desc
  limit 1;

  return jsonb_build_object(
    'active', true,
    'room_muted', target_muted,
    'room_status', target_status,
    'game_session_id', latest_session_id,
    'game_started_at', case when target_status = 'live' then latest_session_started_at else null end,
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
