-- Deck-local functional tags support the same organization model as mature
-- deck builders without exposing another browser-writable table.

alter table public.saved_deck_cards
  add column if not exists tags text[] not null default '{}',
  add constraint saved_deck_cards_tags_size check (
    cardinality(tags) <= 8
    and char_length(array_to_string(tags, '')) <= 256
  );

-- Keep imports atomic while carrying tags parsed from plaintext exports.
create or replace function public.replace_saved_deck_cards(
  target_deck_id uuid,
  target_owner_id uuid,
  replacement_cards jsonb
)
returns setof public.saved_deck_cards
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(replacement_cards) <> 'array'
    or jsonb_array_length(replacement_cards) not between 1 and 500 then
    raise exception 'invalid replacement deck';
  end if;

  if not exists (
    select 1
    from public.saved_commander_decks deck
    where deck.id = target_deck_id and deck.owner_id = target_owner_id
  ) then
    raise exception 'deck not found';
  end if;

  delete from public.saved_deck_cards
  where deck_id = target_deck_id and owner_id = target_owner_id;

  return query
  insert into public.saved_deck_cards (
    deck_id,
    owner_id,
    name,
    quantity,
    board,
    scryfall_id,
    oracle_id,
    set_code,
    collector_number,
    mana_value,
    type_line,
    colors,
    tags
  )
  select
    target_deck_id,
    target_owner_id,
    card.name,
    card.quantity,
    card.board,
    card.scryfall_id,
    card.oracle_id,
    card.set_code,
    card.collector_number,
    card.mana_value,
    card.type_line,
    case
      when jsonb_typeof(card.colors) = 'array'
        then array(select jsonb_array_elements_text(card.colors))
      else '{}'::text[]
    end,
    case
      when jsonb_typeof(card.tags) = 'array'
        then array(select jsonb_array_elements_text(card.tags))
      else '{}'::text[]
    end
  from jsonb_to_recordset(replacement_cards) as card(
    name text,
    quantity smallint,
    board text,
    scryfall_id uuid,
    oracle_id uuid,
    set_code text,
    collector_number text,
    mana_value numeric,
    type_line text,
    colors jsonb,
    tags jsonb
  )
  returning *;
end;
$$;

revoke all on function public.replace_saved_deck_cards(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_saved_deck_cards(uuid, uuid, jsonb)
  to service_role;
