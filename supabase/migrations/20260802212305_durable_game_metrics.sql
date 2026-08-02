-- Persist eliminations as they happen and make whole-game turn metrics
-- unambiguous in the participant-only history response.

alter table public.game_session_participants
  add column if not exists eliminated_at timestamptz;

update public.game_session_participants participants
set eliminated_at = coalesce(sessions.ended_at, participants.created_at)
from public.game_sessions sessions
where sessions.id = participants.session_id
  and participants.result in ('loss', 'conceded')
  and participants.eliminated_at is null;

create index if not exists game_session_participants_eliminated_at_idx
  on public.game_session_participants(session_id, eliminated_at)
  where eliminated_at is not null;

create or replace function public.snapcast_stamp_eliminated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.final_commander_damage) <> 'object' then
    raise exception 'invalid Commander damage snapshot';
  end if;
  if exists (
    select 1
    from jsonb_each_text(new.final_commander_damage) damage
    where not case
        when damage.value ~ '^[0-9]{1,3}$' then damage.value::integer between 0 and 999
        else false
      end
      or not exists (
        select 1
        from public.game_session_participants source
        where source.session_id = new.session_id
          and source.membership_id::text = damage.key
      )
  ) then
    raise exception 'invalid Commander damage snapshot';
  end if;

  if new.result in ('loss', 'conceded') then
    new.eliminated_at := coalesce(
      new.eliminated_at,
      case when tg_op = 'UPDATE' then old.eliminated_at else null end,
      now()
    );
  else
    new.eliminated_at := null;
    new.loss_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists game_session_participants_stamp_eliminated_at
  on public.game_session_participants;
create trigger game_session_participants_stamp_eliminated_at
  before insert or update of result, loss_reason, eliminated_at, final_commander_damage
  on public.game_session_participants
  for each row execute function public.snapcast_stamp_eliminated_at();

revoke all on function public.snapcast_stamp_eliminated_at()
  from public, anon, authenticated;

create or replace function public.record_game_elimination(
  target_session_id uuid,
  acting_membership_id uuid,
  participant_token text,
  p_reason text,
  p_final_life integer,
  p_final_poison integer,
  p_final_commander_damage jsonb,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.game_sessions;
  target_participant public.game_session_participants;
begin
  select * into target_session
  from public.game_sessions
  where id = target_session_id
  for update;
  if not found then raise exception 'game session was not found'; end if;

  select participants.* into target_participant
  from public.game_session_participants participants
  join public.game_memberships memberships
    on memberships.id = participants.membership_id
  where participants.session_id = target_session_id
    and participants.membership_id = acting_membership_id
    and memberships.token_hash = public.snapcast_token_hash(participant_token)
    and memberships.left_at is null
    and memberships.removed_at is null
  for update of participants;
  if not found then raise exception 'participant authorization failed'; end if;

  if p_reason is not null
    and p_reason not in ('life', 'commander_damage', 'poison', 'concede', 'other', 'unknown') then
    raise exception 'invalid elimination reason';
  end if;
  if octet_length(coalesce(p_final_commander_damage, '{}'::jsonb)::text) > 32768 then
    raise exception 'commander damage snapshot is too large';
  end if;

  if exists (
    select 1 from public.game_audit_log audit
    where audit.room_id = target_session.room_id
      and audit.idempotency_key = record_game_elimination.idempotency_key
  ) then
    return jsonb_build_object(
      'participant_id', target_participant.id,
      'reason', target_participant.loss_reason,
      'eliminated_at', target_participant.eliminated_at
    );
  end if;

  if target_session.state <> 'active' then
    raise exception 'game session is not active';
  end if;

  update public.game_session_participants
  set result = case
        when p_reason is null then 'unknown'
        when p_reason = 'concede' then 'conceded'
        else 'loss'
      end,
      loss_reason = p_reason,
      final_life = case when p_reason is null then null
        else greatest(-999, least(999, coalesce(p_final_life, 0))) end,
      final_poison = case when p_reason is null then null
        else greatest(0, least(999, coalesce(p_final_poison, 0))) end,
      final_commander_damage = case when p_reason is null then '{}'::jsonb
        else coalesce(p_final_commander_damage, '{}'::jsonb) end,
      eliminated_at = case when p_reason is null then null
        else coalesce(eliminated_at, now()) end
  where id = target_participant.id
  returning * into target_participant;

  insert into public.game_audit_log (
    room_id, session_id, actor_membership_id, action, details, idempotency_key
  ) values (
    target_session.room_id,
    target_session.id,
    acting_membership_id,
    case when p_reason is null then 'elimination_reversed' else 'elimination_recorded' end,
    jsonb_build_object(
      'reason', p_reason,
      'final_life', target_participant.final_life,
      'final_poison', target_participant.final_poison
    ),
    idempotency_key
  );

  return jsonb_build_object(
    'participant_id', target_participant.id,
    'reason', target_participant.loss_reason,
    'eliminated_at', target_participant.eliminated_at
  );
end;
$$;

revoke all on function public.record_game_elimination(
  uuid, uuid, text, text, integer, integer, jsonb, uuid
) from public, anon;
grant execute on function public.record_game_elimination(
  uuid, uuid, text, text, integer, integer, jsonb, uuid
) to authenticated;

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
      'eliminated_at', mine.eliminated_at,
      'hidden_by_player', mine.hidden_by_player,
      'final_life', mine.final_life,
      'final_poison', mine.final_poison,
      'final_commander_damage', mine.final_commander_damage,
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
          'display_name', case when opponents.profile_id is null then 'Guest' else opponents.display_name end,
          'result', opponents.result,
          'loss_reason', opponents.loss_reason,
          'eliminated_at', opponents.eliminated_at,
          'final_life', opponents.final_life,
          'final_poison', opponents.final_poison
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
      'participant_count', (
        select count(*) from public.game_session_participants participants
        where participants.session_id = sessions.id
      ),
      'turn_count', (
        select count(*) from public.game_turns turns
        where turns.session_id = sessions.id and turns.elapsed_ms is not null
      ),
      'my_turn_count', (
        select count(*) from public.game_turns turns
        where turns.participant_id = mine.id and turns.elapsed_ms is not null
      ),
      'total_turn_ms', coalesce((
        select sum(turns.elapsed_ms) from public.game_turns turns
        where turns.participant_id = mine.id and turns.elapsed_ms is not null
      ), 0),
      'average_turn_ms', (
        select avg(turns.elapsed_ms) from public.game_turns turns
        where turns.participant_id = mine.id and turns.elapsed_ms is not null
      ),
      'longest_turn_ms', (
        select max(turns.elapsed_ms) from public.game_turns turns
        where turns.participant_id = mine.id and turns.elapsed_ms is not null
      ),
      'game_total_turn_ms', coalesce((
        select sum(turns.elapsed_ms) from public.game_turns turns
        where turns.session_id = sessions.id and turns.elapsed_ms is not null
      ), 0),
      'game_average_turn_ms', (
        select avg(turns.elapsed_ms) from public.game_turns turns
        where turns.session_id = sessions.id and turns.elapsed_ms is not null
      ),
      'game_longest_turn_ms', (
        select max(turns.elapsed_ms) from public.game_turns turns
        where turns.session_id = sessions.id and turns.elapsed_ms is not null
      ),
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
    where mine.profile_id = auth.uid()
    order by sessions.started_at desc
    limit least(greatest(coalesce(result_limit, 30), 1), 100)
  ) rows;
$$;

revoke all on function public.get_my_game_history(integer) from public, anon;
grant execute on function public.get_my_game_history(integer) to authenticated;
