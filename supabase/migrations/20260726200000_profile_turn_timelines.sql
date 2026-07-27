-- Complete profile analytics: partner pairs are one record dimension, while
-- participant-only history exposes the detailed game timing promised by the
-- product plan.

create or replace function public.get_public_profile(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select profiles.id, profiles.display_name, profiles.avatar_url, profiles.created_at,
      coalesce(preferences.show_recent_games, true) as show_recent_games
    from public.profiles profiles
    left join public.account_preferences preferences on preferences.user_id = profiles.id
    where profiles.id = target_profile_id
  ),
  completed as (
    select participants.*, sessions.started_at, sessions.ended_at, sessions.id as game_session_id
    from public.game_session_participants participants
    join public.game_sessions sessions on sessions.id = participants.session_id
    where participants.profile_id = target_profile_id
      and sessions.state = 'final'
      and not participants.hidden_by_player
  ),
  overall as (
    select
      count(*) as games,
      count(*) filter (where result = 'win') as wins,
      count(*) filter (where result in ('loss', 'conceded')) as losses,
      count(*) filter (where result = 'draw') as draws,
      coalesce(avg(extract(epoch from (ended_at - started_at))) filter (where ended_at is not null), 0) as average_game_seconds
    from completed
  ),
  commander_games as (
    select completed.id as participant_id, completed.result,
      primary_commander.commander_name ||
        case when partner.commander_name is null then '' else ' + ' || partner.commander_name end
        as commander_name
    from completed
    join public.game_session_commanders primary_commander
      on primary_commander.participant_id = completed.id and primary_commander.slot = 1
    left join public.game_session_commanders partner
      on partner.participant_id = completed.id and partner.slot = 2
  ),
  commander_stats as (
    select commander_games.commander_name,
      count(distinct commander_games.participant_id) as games,
      count(distinct commander_games.participant_id) filter (where commander_games.result = 'win') as wins,
      count(distinct commander_games.participant_id) filter (where commander_games.result in ('loss', 'conceded')) as losses,
      count(distinct commander_games.participant_id) filter (where commander_games.result = 'draw') as draws,
      coalesce(avg(turns.elapsed_ms) filter (where turns.elapsed_ms is not null), 0) as average_turn_ms,
      coalesce(percentile_cont(0.5) within group (order by turns.elapsed_ms)
        filter (where turns.elapsed_ms is not null), 0) as median_turn_ms
    from commander_games
    left join public.game_turns turns on turns.participant_id = commander_games.participant_id
    group by commander_games.commander_name
    order by count(distinct commander_games.participant_id) desc, commander_games.commander_name
    limit 24
  ),
  turn_stats as (
    select
      count(turns.id) as turns,
      coalesce(avg(turns.elapsed_ms), 0) as average_turn_ms,
      coalesce(percentile_cont(0.5) within group (order by turns.elapsed_ms), 0) as median_turn_ms,
      coalesce(max(turns.elapsed_ms), 0) as longest_turn_ms
    from completed
    join public.game_turns turns on turns.participant_id = completed.id
    where turns.elapsed_ms is not null
  ),
  recent as (
    select jsonb_agg(jsonb_build_object(
      'session_id', completed.game_session_id,
      'started_at', completed.started_at,
      'ended_at', completed.ended_at,
      'result', completed.result,
      'commander', (
        select commander_name from public.game_session_commanders
        where participant_id = completed.id and slot = 1
      ),
      'partner', (
        select commander_name from public.game_session_commanders
        where participant_id = completed.id and slot = 2
      )
    ) order by completed.started_at desc) as games
    from (
      select * from completed order by started_at desc limit 12
    ) completed
  )
  select case when target.id is null then null else jsonb_build_object(
    'profile', jsonb_build_object(
      'id', target.id,
      'display_name', target.display_name,
      'avatar_url', target.avatar_url,
      'created_at', target.created_at
    ),
    'overall', jsonb_build_object(
      'games', overall.games,
      'wins', overall.wins,
      'losses', overall.losses,
      'draws', overall.draws,
      'win_rate', case when overall.games = 0 then 0 else overall.wins::numeric / overall.games end,
      'average_game_seconds', overall.average_game_seconds
    ),
    'turns', to_jsonb(turn_stats),
    'commanders', coalesce((select jsonb_agg(to_jsonb(commander_stats)) from commander_stats), '[]'::jsonb),
    'recent_games', case
      when target.show_recent_games then coalesce(recent.games, '[]'::jsonb)
      else '[]'::jsonb
    end,
    'recent_games_visible', target.show_recent_games
  ) end
  from target cross join overall cross join turn_stats cross join recent;
$$;

create or replace function public.get_my_game_history(result_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(rows.history order by rows.started_at desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'session_id', sessions.id,
      'room_id', sessions.room_id,
      'room_code', (select code from public.game_rooms where id = sessions.room_id),
      'started_at', sessions.started_at,
      'ended_at', sessions.ended_at,
      'state', sessions.state,
      'result', mine.result,
      'loss_reason', mine.loss_reason,
      'hidden_by_player', mine.hidden_by_player,
      'final_life', mine.final_life,
      'final_poison', mine.final_poison,
      'commander', (
        select commander_name from public.game_session_commanders
        where participant_id = mine.id and slot = 1
      ),
      'partner', (
        select commander_name from public.game_session_commanders
        where participant_id = mine.id and slot = 2
      ),
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', opponents.profile_id,
          'display_name', case when opponents.profile_id is null then 'Guest' else opponents.display_name end
        ) order by opponents.seat_number)
        from public.game_session_participants opponents
        where opponents.session_id = sessions.id
          and opponents.id <> mine.id
      ), '[]'::jsonb),
      'duration_seconds', extract(epoch from (sessions.ended_at - sessions.started_at)),
      'turn_count', count(turns.id),
      'total_turn_ms', coalesce(sum(turns.elapsed_ms), 0),
      'average_turn_ms', avg(turns.elapsed_ms),
      'longest_turn_ms', max(turns.elapsed_ms),
      'player_timing', coalesce((
        select jsonb_agg(to_jsonb(timing) order by timing.seat_number)
        from (
          select participants.id as participant_id, participants.profile_id,
            case when participants.profile_id is null then 'Guest' else participants.display_name end as display_name,
            participants.seat_number,
            count(player_turns.id) as turn_count,
            coalesce(sum(player_turns.elapsed_ms), 0) as total_turn_ms,
            coalesce(avg(player_turns.elapsed_ms), 0) as average_turn_ms,
            coalesce(max(player_turns.elapsed_ms), 0) as longest_turn_ms
          from public.game_session_participants participants
          left join public.game_turns player_turns
            on player_turns.participant_id = participants.id and player_turns.elapsed_ms is not null
          where participants.session_id = sessions.id
          group by participants.id
        ) timing
      ), '[]'::jsonb),
      'turn_timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'turn_number', timeline.turn_number,
          'participant_id', participant.id,
          'profile_id', participant.profile_id,
          'display_name', case when participant.profile_id is null then 'Guest' else participant.display_name end,
          'commander', (
            select commander_name from public.game_session_commanders
            where participant_id = participant.id and slot = 1
          ),
          'partner', (
            select commander_name from public.game_session_commanders
            where participant_id = participant.id and slot = 2
          ),
          'started_at', timeline.started_at,
          'ended_at', timeline.ended_at,
          'elapsed_ms', timeline.elapsed_ms
        ) order by timeline.turn_number)
        from public.game_turns timeline
        join public.game_session_participants participant on participant.id = timeline.participant_id
        where timeline.session_id = sessions.id
      ), '[]'::jsonb)
    ) as history,
    sessions.started_at
    from public.game_session_participants mine
    join public.game_sessions sessions on sessions.id = mine.session_id
    left join public.game_turns turns on turns.participant_id = mine.id and turns.elapsed_ms is not null
    where mine.profile_id = auth.uid()
    group by mine.id, sessions.id
    order by sessions.started_at desc
    limit least(greatest(coalesce(result_limit, 30), 1), 100)
  ) rows;
$$;

create or replace function public.get_profile_matchups(target_profile_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select participants.id, participants.session_id, participants.result
    from public.game_session_participants participants
    join public.game_sessions sessions on sessions.id = participants.session_id
    where participants.profile_id = target_profile_id
      and sessions.state = 'final'
      and not participants.hidden_by_player
  ),
  opponents as (
    select profiles.id, profiles.display_name,
      count(*) as games,
      count(*) filter (where mine.result = 'win') as wins,
      count(*) filter (where mine.result in ('loss', 'conceded')) as losses
    from mine
    join public.game_session_participants other
      on other.session_id = mine.session_id and other.profile_id is not null and other.profile_id <> target_profile_id
    join public.profiles profiles on profiles.id = other.profile_id
    group by profiles.id, profiles.display_name
    order by count(*) desc, profiles.display_name
    limit 20
  ),
  opposing_commanders as (
    select primary_commander.commander_name ||
        case when partner.commander_name is null then '' else ' + ' || partner.commander_name end
        as commander_name,
      count(*) as games,
      count(*) filter (where mine.result = 'win') as wins,
      count(*) filter (where mine.result in ('loss', 'conceded')) as losses
    from mine
    join public.game_session_participants other on other.session_id = mine.session_id and other.id <> mine.id
    join public.game_session_commanders primary_commander
      on primary_commander.participant_id = other.id and primary_commander.slot = 1
    left join public.game_session_commanders partner
      on partner.participant_id = other.id and partner.slot = 2
    group by primary_commander.commander_name, partner.commander_name
    order by count(*) desc, primary_commander.commander_name, partner.commander_name
    limit 24
  )
  select jsonb_build_object(
    'opponents', coalesce((select jsonb_agg(to_jsonb(opponents)) from opponents), '[]'::jsonb),
    'commanders', coalesce((select jsonb_agg(to_jsonb(opposing_commanders)) from opposing_commanders), '[]'::jsonb)
  );
$$;

create or replace function public.list_social_dashboard()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profiles.id, 'display_name', profiles.display_name, 'avatar_url', profiles.avatar_url,
        'status', case
          when preferences.appear_offline or presence.expires_at <= now() then 'offline'
          else presence.status
        end
      ) order by profiles.display_name)
      from public.friendships friendships
      join public.profiles profiles on profiles.id = case
        when friendships.player_one_id = auth.uid() then friendships.player_two_id
        else friendships.player_one_id
      end
      left join public.player_presence presence on presence.profile_id = profiles.id
      left join public.account_preferences preferences on preferences.user_id = profiles.id
      where auth.uid() in (friendships.player_one_id, friendships.player_two_id)
        and not public.players_are_blocked(auth.uid(), profiles.id)
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', notifications.id,
        'kind', notifications.kind,
        'reference_id', notifications.reference_id,
        'read_at', notifications.read_at,
        'created_at', notifications.created_at,
        'actor', case when actor.id is null then null else jsonb_build_object(
          'id', actor.id, 'display_name', actor.display_name, 'avatar_url', actor.avatar_url
        ) end,
        'invitation', case when notifications.kind = 'game_invitation' then (
          select jsonb_build_object(
            'name', rooms.name,
            'visibility', rooms.visibility,
            'status', rooms.status,
            'player_count', (
              select count(*) from public.game_memberships members
              where members.game_id = rooms.id and members.role = 'player'
                and members.left_at is null and members.removed_at is null
            ),
            'seat_limit', rooms.seat_limit
          )
          from public.game_invitations invitations
          join public.game_rooms rooms on rooms.id = invitations.game_id
          where invitations.id = notifications.reference_id
        ) else null end
      ) order by notifications.created_at desc)
      from (
        select * from public.profile_notifications candidate
        where candidate.recipient_id = auth.uid()
          and candidate.dismissed_at is null
          and (candidate.expires_at is null or candidate.expires_at > now())
          and (
            candidate.kind <> 'game_invitation'
            or exists (
              select 1
              from public.game_invitations invitations
              join public.game_rooms rooms on rooms.id = invitations.game_id
              where invitations.id = candidate.reference_id
                and invitations.status = 'pending'
                and invitations.expires_at > now()
                and (
                  (
                    rooms.status = 'lobby'
                    and (
                      select count(*) from public.game_memberships members
                      where members.game_id = rooms.id and members.role = 'player'
                        and members.left_at is null and members.removed_at is null
                    ) < rooms.seat_limit
                  )
                  or (
                    rooms.status = 'live'
                    and (
                      select count(*) from public.game_memberships members
                      where members.game_id = rooms.id and members.role = 'visitor'
                        and members.left_at is null and members.removed_at is null
                    ) < 8
                  )
                )
            )
          )
        order by candidate.created_at desc
        limit 50
      ) notifications
      left join public.profiles actor on actor.id = notifications.actor_id
      where notifications.actor_id is null
        or not public.players_are_blocked(auth.uid(), notifications.actor_id)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.respond_game_invitation(
  target_invitation_id uuid, accept_invitation boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.game_invitations;
  target_room public.game_rooms;
  active_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.game_invitations
  where id = target_invitation_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'invitation unavailable'; end if;
  select * into target_room from public.game_rooms where id = invitation.game_id for update;

  if invitation.expires_at <= now() or target_room.status not in ('lobby', 'live') then
    update public.game_invitations set status = 'expired', responded_at = now() where id = invitation.id;
    update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
    where recipient_id = auth.uid() and kind = 'game_invitation' and reference_id = invitation.id;
    return jsonb_build_object('accepted', false, 'expired', true);
  end if;

  select count(*) into active_count
  from public.game_memberships members
  where members.game_id = target_room.id
    and members.role = case when target_room.status = 'live' then 'visitor' else 'player' end
    and members.left_at is null and members.removed_at is null;
  if accept_invitation and active_count >= case when target_room.status = 'live' then 8 else target_room.seat_limit end then
    update public.game_invitations set status = 'expired', responded_at = now() where id = invitation.id;
    update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
    where recipient_id = auth.uid() and kind = 'game_invitation' and reference_id = invitation.id;
    return jsonb_build_object('accepted', false, 'expired', true);
  end if;

  if public.players_are_blocked(invitation.sender_id, invitation.recipient_id) then
    accept_invitation := false;
  end if;
  update public.game_invitations
  set status = case when accept_invitation then 'accepted' else 'declined' end, responded_at = now()
  where id = invitation.id;
  update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'game_invitation' and reference_id = invitation.id;
  return jsonb_build_object(
    'accepted', accept_invitation,
    'expired', false,
    'code', case when accept_invitation then target_room.code else null end,
    'role', case when target_room.status = 'live' then 'visitor' else 'player' end
  );
end;
$$;

create or replace function public.cancel_game_invitation(
  target_invitation_id uuid, owner_token text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  invitation public.game_invitations;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.game_invitations
  where id = target_invitation_id and sender_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'invitation unavailable'; end if;
  perform public.snapcast_require_owner(invitation.game_id, owner_token);
  update public.game_invitations set status = 'canceled', responded_at = now()
  where id = invitation.id;
  update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
  where kind = 'game_invitation' and reference_id = invitation.id;
  return true;
end;
$$;

revoke all on function public.cancel_game_invitation(uuid, text) from public;
grant execute on function public.cancel_game_invitation(uuid, text) to authenticated;

create or replace function public.snapcast_expire_unavailable_game_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_room public.game_rooms;
  target_game_id uuid := new.game_id;
  active_count integer;
begin
  select * into target_room from public.game_rooms where id = target_game_id;
  if not found then return new; end if;
  select count(*) into active_count
  from public.game_memberships members
  where members.game_id = target_game_id
    and members.role = case when target_room.status = 'live' then 'visitor' else 'player' end
    and members.left_at is null and members.removed_at is null;
  if (
    target_room.status = 'lobby' and active_count >= target_room.seat_limit
  ) or (
    target_room.status = 'live' and active_count >= 8
  ) then
    update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
    where kind = 'game_invitation' and reference_id in (
      select id from public.game_invitations
      where game_id = target_game_id and status = 'pending'
    );
    update public.game_invitations set status = 'expired', responded_at = now()
    where game_id = target_game_id and status = 'pending';
  end if;
  return new;
end;
$$;

create or replace function public.snapcast_expire_closed_game_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('lobby', 'live') and old.status is distinct from new.status then
    update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
    where kind = 'game_invitation' and reference_id in (
      select id from public.game_invitations
      where game_id = new.id and status = 'pending'
    );
    update public.game_invitations set status = 'expired', responded_at = now()
    where game_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists game_memberships_expire_full_game_invitations on public.game_memberships;
create trigger game_memberships_expire_full_game_invitations
  after insert on public.game_memberships
  for each row execute function public.snapcast_expire_unavailable_game_invitations();

drop trigger if exists game_memberships_recheck_game_invitations on public.game_memberships;
create trigger game_memberships_recheck_game_invitations
  after update of role, left_at, removed_at on public.game_memberships
  for each row execute function public.snapcast_expire_unavailable_game_invitations();

drop trigger if exists game_rooms_expire_closed_game_invitations on public.game_rooms;
create trigger game_rooms_expire_closed_game_invitations
  after update of status on public.game_rooms
  for each row execute function public.snapcast_expire_closed_game_invitations();

revoke all on function public.snapcast_expire_unavailable_game_invitations()
  from public, anon, authenticated;
revoke all on function public.snapcast_expire_closed_game_invitations()
  from public, anon, authenticated;
