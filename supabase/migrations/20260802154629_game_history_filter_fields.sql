-- Give the participant-only history surface enough structured data for local
-- filtering without exposing another player's private history endpoint.

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
      'room_code', rooms.code,
      'bracket', rooms.bracket,
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
      'opponent_commanders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'profile_id', opponents.profile_id,
          'display_name', case when opponents.profile_id is null then 'Guest' else opponents.display_name end,
          'commander', primary_commander.commander_name,
          'partner', partner_commander.commander_name
        ) order by opponents.seat_number)
        from public.game_session_participants opponents
        left join public.game_session_commanders primary_commander
          on primary_commander.participant_id = opponents.id and primary_commander.slot = 1
        left join public.game_session_commanders partner_commander
          on partner_commander.participant_id = opponents.id and partner_commander.slot = 2
        where opponents.session_id = sessions.id
          and opponents.id <> mine.id
          and primary_commander.commander_name is not null
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
    join public.game_rooms rooms on rooms.id = sessions.room_id
    left join public.game_turns turns on turns.participant_id = mine.id and turns.elapsed_ms is not null
    where mine.profile_id = auth.uid()
    group by mine.id, sessions.id, rooms.id
    order by sessions.started_at desc
    limit least(greatest(coalesce(result_limit, 30), 1), 100)
  ) rows;
$$;

revoke all on function public.get_my_game_history(integer) from public, anon;
grant execute on function public.get_my_game_history(integer) to authenticated;
