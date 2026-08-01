create or replace function public.list_public_game_rooms_with_cards(
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
  commander_cards jsonb,
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
    coalesce(
      jsonb_agg(jsonb_build_object(
        'name', members.commander_name,
        'scryfall_id', members.commander_scryfall_id,
        'partner_name', members.partner_commander_name,
        'partner_scryfall_id', members.partner_commander_scryfall_id,
        'seat_number', members.seat_number
      ) order by members.seat_number)
        filter (where members.role = 'player' and members.commander_name is not null),
      '[]'::jsonb
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

revoke all on function public.list_public_game_rooms_with_cards(text, integer, boolean, text, integer)
  from public;
grant execute on function public.list_public_game_rooms_with_cards(text, integer, boolean, text, integer)
  to anon, authenticated;
