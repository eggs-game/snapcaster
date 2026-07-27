-- Public profile statistics, private personal history, and saved Commander
-- decks. Statistics are derived from final game events, never counters.

alter table public.account_preferences
  add column if not exists show_recent_games boolean not null default true;

create table if not exists public.saved_commander_decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  commander_name text not null,
  commander_scryfall_id uuid,
  partner_name text,
  partner_scryfall_id uuid,
  color_identity text[] not null default array[]::text[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_commander_decks_label_length check (char_length(btrim(label)) between 1 and 48),
  constraint saved_commander_decks_commander_length check (char_length(btrim(commander_name)) between 1 and 120),
  constraint saved_commander_decks_partner_length check (
    partner_name is null or char_length(btrim(partner_name)) between 1 and 120
  ),
  constraint saved_commander_decks_colors check (
    color_identity <@ array['W', 'U', 'B', 'R', 'G']::text[]
  )
);

create index if not exists saved_commander_decks_owner_sort_idx
  on public.saved_commander_decks(owner_id, sort_order, created_at);

drop trigger if exists saved_commander_decks_set_updated_at on public.saved_commander_decks;
create trigger saved_commander_decks_set_updated_at
  before update on public.saved_commander_decks
  for each row execute function public.set_updated_at();

alter table public.saved_commander_decks enable row level security;
revoke all on public.saved_commander_decks from anon, authenticated;
grant select, insert, update, delete on public.saved_commander_decks to authenticated;

drop policy if exists "players read their commander decks" on public.saved_commander_decks;
create policy "players read their commander decks"
  on public.saved_commander_decks for select
  to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id);

drop policy if exists "players create their commander decks" on public.saved_commander_decks;
create policy "players create their commander decks"
  on public.saved_commander_decks for insert
  to authenticated
  with check (auth.uid() is not null and auth.uid() = owner_id);

drop policy if exists "players update their commander decks" on public.saved_commander_decks;
create policy "players update their commander decks"
  on public.saved_commander_decks for update
  to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id)
  with check (auth.uid() is not null and auth.uid() = owner_id);

drop policy if exists "players delete their commander decks" on public.saved_commander_decks;
create policy "players delete their commander decks"
  on public.saved_commander_decks for delete
  to authenticated
  using (auth.uid() is not null and auth.uid() = owner_id);

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
  commander_stats as (
    select commanders.commander_name,
      count(*) as games,
      count(*) filter (where completed.result = 'win') as wins,
      count(*) filter (where completed.result in ('loss', 'conceded')) as losses,
      count(*) filter (where completed.result = 'draw') as draws
    from completed
    join public.game_session_commanders commanders on commanders.participant_id = completed.id
    where commanders.slot = 1
    group by commanders.commander_name
    order by count(*) desc, commanders.commander_name
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
      select * from completed
      where not hidden_by_player
      order by started_at desc
      limit 12
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
          'display_name', opponents.display_name
        ) order by opponents.seat_number)
        from public.game_session_participants opponents
        where opponents.session_id = sessions.id
          and opponents.profile_id is not null
          and opponents.profile_id <> auth.uid()
      ), '[]'::jsonb),
      'duration_seconds', extract(epoch from (sessions.ended_at - sessions.started_at)),
      'turn_count', count(turns.id),
      'average_turn_ms', avg(turns.elapsed_ms),
      'longest_turn_ms', max(turns.elapsed_ms)
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

create or replace function public.set_my_game_visibility(target_session_id uuid, hide_game boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.game_session_participants
  set hidden_by_player = hide_game
  where session_id = target_session_id and profile_id = auth.uid();
  if not found then raise exception 'game unavailable'; end if;
  return true;
end;
$$;

create or replace function public.search_public_profiles(search_text text, result_limit integer default 12)
returns table (id uuid, display_name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.snapcast_check_rate_limit('profile_search', 60, interval '1 hour');
  return query
  select profiles.id, profiles.display_name, profiles.avatar_url
  from public.profiles profiles
  where char_length(btrim(search_text)) >= 2
    and profiles.display_name ilike '%' || left(btrim(search_text), 32) || '%'
  order by
    case when lower(profiles.display_name) = lower(btrim(search_text)) then 0 else 1 end,
    profiles.display_name
  limit least(greatest(coalesce(result_limit, 12), 1), 20);
end;
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
    join public.game_session_participants other on other.session_id = mine.session_id and other.profile_id is not null and other.profile_id <> target_profile_id
    join public.profiles profiles on profiles.id = other.profile_id
    group by profiles.id, profiles.display_name
    order by count(*) desc, profiles.display_name
    limit 20
  ),
  opposing_commanders as (
    select commanders.commander_name,
      count(*) as games,
      count(*) filter (where mine.result = 'win') as wins,
      count(*) filter (where mine.result in ('loss', 'conceded')) as losses
    from mine
    join public.game_session_participants other on other.session_id = mine.session_id and other.id <> mine.id
    join public.game_session_commanders commanders on commanders.participant_id = other.id and commanders.slot = 1
    group by commanders.commander_name
    order by count(*) desc, commanders.commander_name
    limit 24
  )
  select jsonb_build_object(
    'opponents', coalesce((select jsonb_agg(to_jsonb(opponents)) from opponents), '[]'::jsonb),
    'commanders', coalesce((select jsonb_agg(to_jsonb(opposing_commanders)) from opposing_commanders), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_my_game_history(integer) from public;
revoke all on function public.set_my_game_visibility(uuid, boolean) from public;
revoke all on function public.search_public_profiles(text, integer) from public;
revoke all on function public.get_profile_matchups(uuid) from public;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
grant execute on function public.get_my_game_history(integer) to authenticated;
grant execute on function public.set_my_game_visibility(uuid, boolean) to authenticated;
grant execute on function public.search_public_profiles(text, integer) to anon, authenticated;
grant execute on function public.get_profile_matchups(uuid) to anon, authenticated;
