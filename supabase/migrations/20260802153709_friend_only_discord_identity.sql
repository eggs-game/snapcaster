-- Discord usernames are private identity data. Keep them on the owner-only
-- account row and reveal them through get_public_profile only to the profile
-- owner or an accepted Snapcast friend.

alter table public.account_private
  add column if not exists discord_username text;

alter table public.account_private
  add constraint account_private_discord_username_length
  check (
    discord_username is null
    or char_length(btrim(discord_username)) between 1 and 64
  );

create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposed_name text;
  proposed_avatar text;
  proposed_discord_id text;
  proposed_discord_username text;
begin
  -- Anonymous Auth users exist only to authorize private Realtime game
  -- channels. They are not Snapcast accounts and get no profile rows.
  if coalesce(new.is_anonymous, false) then return new; end if;
  proposed_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'global_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    'Snapcast player'
  );
  proposed_avatar := nullif(
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    ''
  );
  proposed_discord_id := nullif(
    coalesce(
      new.raw_user_meta_data ->> 'provider_id',
      new.raw_user_meta_data ->> 'sub'
    ),
    ''
  );
  proposed_discord_username := nullif(
    btrim(coalesce(
      new.raw_user_meta_data ->> 'global_name',
      new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
      new.raw_user_meta_data ->> 'preferred_username',
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'username',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )),
    ''
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, left(proposed_name, 32), left(proposed_avatar, 2048))
  on conflict (id) do update
  set avatar_url = excluded.avatar_url;

  insert into public.account_private (
    user_id,
    discord_user_id,
    discord_username,
    email,
    email_verified
  )
  values (
    new.id,
    left(proposed_discord_id, 32),
    left(proposed_discord_username, 64),
    left(nullif(new.email, ''), 320),
    new.email_confirmed_at is not null
  )
  on conflict (user_id) do update
  set discord_user_id = excluded.discord_user_id,
      discord_username = excluded.discord_username,
      email = excluded.email,
      email_verified = excluded.email_verified;

  insert into public.account_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

update public.account_private private_account
set discord_username = left(nullif(btrim(coalesce(
  users.raw_user_meta_data ->> 'global_name',
  users.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
  users.raw_user_meta_data ->> 'preferred_username',
  users.raw_user_meta_data ->> 'user_name',
  users.raw_user_meta_data ->> 'username',
  users.raw_user_meta_data ->> 'full_name',
  users.raw_user_meta_data ->> 'name'
)), ''), 64)
from auth.users users
where private_account.user_id = users.id
  and not coalesce(users.is_anonymous, false);

create or replace function public.get_public_profile(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select profiles.id, profiles.display_name, profiles.avatar_url, profiles.created_at,
      private_account.discord_username,
      coalesce(preferences.show_recent_games, true) as show_recent_games
    from public.profiles profiles
    left join public.account_private private_account on private_account.user_id = profiles.id
    left join public.account_preferences preferences on preferences.user_id = profiles.id
    where profiles.id = target_profile_id
  ),
  viewer as (
    select case
      when auth.uid() = target_profile_id then 'self'
      when auth.uid() is not null and exists (
        select 1
        from public.friendships friendships
        where friendships.player_one_id = least(auth.uid(), target_profile_id)
          and friendships.player_two_id = greatest(auth.uid(), target_profile_id)
      ) then 'friend'
      else 'none'
    end as relationship
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
    ) || case
      when viewer.relationship in ('self', 'friend') and target.discord_username is not null
        then jsonb_build_object('discord_username', target.discord_username)
      else '{}'::jsonb
    end,
    'relationship', viewer.relationship,
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
  from target cross join viewer cross join overall cross join turn_stats cross join recent;
$$;

revoke all on function public.handle_new_account() from public, anon, authenticated;
revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
