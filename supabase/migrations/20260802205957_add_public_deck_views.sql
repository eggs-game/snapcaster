-- Public profiles expose saved Commander decks through narrow, read-only
-- functions. The owner-only table policies and all mutation paths remain
-- unchanged; callers receive only the fields needed to render deck pages.

create or replace function public.get_public_profile_relationship(target_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'none'
    when auth.uid() = target_profile_id then 'self'
    when public.players_are_blocked(auth.uid(), target_profile_id) then 'blocked'
    when exists (
      select 1 from public.friendships friendships
      where friendships.player_one_id = least(auth.uid(), target_profile_id)
        and friendships.player_two_id = greatest(auth.uid(), target_profile_id)
    ) then 'friend'
    when exists (
      select 1 from public.friend_requests requests
      where requests.sender_id = auth.uid()
        and requests.recipient_id = target_profile_id
        and requests.status = 'pending'
    ) then 'outgoing_pending'
    when exists (
      select 1 from public.friend_requests requests
      where requests.sender_id = target_profile_id
        and requests.recipient_id = auth.uid()
        and requests.status = 'pending'
    ) then 'incoming_pending'
    else 'none'
  end;
$$;

-- Keep the existing analytics implementation behind an uncallable internal
-- name. The public wrapper below is the only route to those results.
alter function public.get_public_profile(uuid) rename to get_friend_profile_stats_internal;
revoke all on function public.get_friend_profile_stats_internal(uuid) from public, anon, authenticated;

create or replace function public.get_public_profile(target_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  relationship text := public.get_public_profile_relationship(target_profile_id);
  result jsonb;
begin
  if relationship in ('self', 'friend') then
    result := public.get_friend_profile_stats_internal(target_profile_id);
    if result is null then return null; end if;
    return result || jsonb_build_object(
      'relationship', relationship,
      'stats_visible', true
    );
  end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profiles.id,
      'display_name', profiles.display_name,
      'avatar_url', profiles.avatar_url,
      'created_at', profiles.created_at
    ),
    'relationship', relationship,
    'stats_visible', false
  )
  into result
  from public.profiles profiles
  where profiles.id = target_profile_id;

  return result;
end;
$$;

-- Matchups are analytics too. Preserve the existing query as an internal
-- implementation and return empty collections to every non-friend caller.
alter function public.get_profile_matchups(uuid) rename to get_friend_profile_matchups_internal;
revoke all on function public.get_friend_profile_matchups_internal(uuid) from public, anon, authenticated;

create or replace function public.get_profile_matchups(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.get_public_profile_relationship(target_profile_id) in ('self', 'friend')
      then public.get_friend_profile_matchups_internal(target_profile_id)
    else jsonb_build_object('opponents', '[]'::jsonb, 'commanders', '[]'::jsonb)
  end;
$$;

create or replace function public.get_public_profile_decks(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', decks.id,
    'label', decks.label,
    'commander_name', decks.commander_name,
    'commander_scryfall_id', decks.commander_scryfall_id,
    'partner_name', decks.partner_name,
    'partner_scryfall_id', decks.partner_scryfall_id,
    'color_identity', decks.color_identity,
    'card_count', coalesce((
      select sum(cards.quantity)
      from public.saved_deck_cards cards
      where cards.deck_id = decks.id and cards.owner_id = decks.owner_id
    ), 0),
    'updated_at', decks.updated_at
  ) order by decks.sort_order, decks.created_at), '[]'::jsonb)
  from (
    select candidate.*
    from public.saved_commander_decks candidate
    where candidate.owner_id = target_profile_id
    order by candidate.sort_order, candidate.created_at
    limit 100
  ) decks;
$$;

create or replace function public.get_public_saved_deck(target_deck_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', decks.id,
    'label', decks.label,
    'commander_name', decks.commander_name,
    'commander_scryfall_id', decks.commander_scryfall_id,
    'partner_name', decks.partner_name,
    'partner_scryfall_id', decks.partner_scryfall_id,
    'color_identity', decks.color_identity,
    'source_provider', decks.source_provider,
    'source_url', decks.source_url,
    'imported_at', decks.imported_at,
    'owner', jsonb_build_object(
      'id', owners.id,
      'display_name', owners.display_name,
      'avatar_url', owners.avatar_url
    ),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cards.id,
        'name', cards.name,
        'quantity', cards.quantity,
        'board', cards.board,
        'scryfall_id', cards.scryfall_id,
        'oracle_id', cards.oracle_id,
        'set_code', cards.set_code,
        'collector_number', cards.collector_number,
        'mana_value', cards.mana_value,
        'type_line', cards.type_line,
        'colors', cards.colors,
        'tags', cards.tags
      ) order by cards.board, cards.name)
      from (
        select candidate.*
        from public.saved_deck_cards candidate
        where candidate.deck_id = decks.id and candidate.owner_id = decks.owner_id
        order by candidate.board, candidate.name
        limit 500
      ) cards
    ), '[]'::jsonb)
  )
  from public.saved_commander_decks decks
  join public.profiles owners on owners.id = decks.owner_id
  where decks.id = target_deck_id;
$$;

revoke all on function public.get_public_profile_relationship(uuid) from public;
revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_profile_matchups(uuid) from public;
revoke all on function public.get_public_profile_decks(uuid) from public;
revoke all on function public.get_public_saved_deck(uuid) from public;
grant execute on function public.get_public_profile_relationship(uuid) to anon, authenticated;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
grant execute on function public.get_profile_matchups(uuid) to anon, authenticated;
grant execute on function public.get_public_profile_decks(uuid) to anon, authenticated;
grant execute on function public.get_public_saved_deck(uuid) to anon, authenticated;
