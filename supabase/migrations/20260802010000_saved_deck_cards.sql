-- Full saved-deck lists. Provider imports and manual card additions are written
-- only by the authenticated same-origin API after input validation.

alter table public.saved_commander_decks
  add column if not exists source_provider text,
  add column if not exists source_url text,
  add column if not exists imported_at timestamptz,
  add constraint saved_commander_decks_source_provider check (
    source_provider is null or source_provider in ('moxfield', 'archidekt', 'text')
  ),
  add constraint saved_commander_decks_source_url_length check (
    source_url is null or char_length(source_url) <= 256
  ),
  add constraint saved_commander_decks_id_owner_key unique (id, owner_id);

create table if not exists public.saved_deck_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null,
  owner_id uuid not null,
  name text not null,
  quantity smallint not null default 1,
  board text not null default 'mainboard',
  scryfall_id uuid,
  oracle_id uuid,
  set_code text,
  collector_number text,
  mana_value numeric(5,2),
  type_line text,
  colors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_deck_cards_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint saved_deck_cards_quantity check (quantity between 1 and 999),
  constraint saved_deck_cards_board check (board in ('commander', 'mainboard', 'sideboard', 'maybeboard')),
  constraint saved_deck_cards_set_length check (set_code is null or char_length(set_code) <= 12),
  constraint saved_deck_cards_collector_length check (collector_number is null or char_length(collector_number) <= 32),
  constraint saved_deck_cards_mana_value check (mana_value is null or mana_value between 0 and 100),
  constraint saved_deck_cards_type_line_length check (type_line is null or char_length(type_line) <= 200),
  constraint saved_deck_cards_colors check (colors <@ array['W', 'U', 'B', 'R', 'G']::text[]),
  constraint saved_deck_cards_deck_board_name_key unique (deck_id, board, name),
  constraint saved_deck_cards_deck_owner_fk foreign key (deck_id, owner_id)
    references public.saved_commander_decks(id, owner_id) on delete cascade
);

create index if not exists saved_deck_cards_owner_deck_idx on public.saved_deck_cards(owner_id, deck_id);
create index if not exists saved_deck_cards_deck_fk_idx on public.saved_deck_cards(deck_id);

drop trigger if exists saved_deck_cards_set_updated_at on public.saved_deck_cards;
create trigger saved_deck_cards_set_updated_at
  before update on public.saved_deck_cards
  for each row execute function public.set_updated_at();

alter table public.saved_deck_cards enable row level security;
revoke all on public.saved_deck_cards from anon, authenticated;
grant select on public.saved_deck_cards to authenticated;

drop policy if exists "players read their deck cards" on public.saved_deck_cards;
create policy "players read their deck cards"
  on public.saved_deck_cards for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

-- Full-list imports replace all rows in one transaction. This capability is
-- service-only; the API verifies the authenticated owner before invoking it.
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
    colors
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
    colors jsonb
  )
  returning *;
end;
$$;

revoke all on function public.replace_saved_deck_cards(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_saved_deck_cards(uuid, uuid, jsonb)
  to service_role;

-- Keep account portability complete now that a saved deck has child rows.
create or replace function public.get_my_account_export()
returns jsonb language sql volatile security definer set search_path = '' as $$
  select public.snapcast_check_rate_limit('account_export', 10, interval '1 day');
  select jsonb_build_object(
    'generated_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'private_account', (select to_jsonb(a) from public.account_private a where a.user_id = auth.uid()),
    'preferences', (select to_jsonb(p) from public.account_preferences p where p.user_id = auth.uid()),
    'decks', coalesce((
      select jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'cards', coalesce((
          select jsonb_agg(to_jsonb(c) order by c.board, c.name)
          from public.saved_deck_cards c
          where c.deck_id = d.id and c.owner_id = auth.uid()
        ), '[]'::jsonb)
      ) order by d.sort_order, d.created_at)
      from public.saved_commander_decks d
      where d.owner_id = auth.uid()
    ), '[]'::jsonb),
    'games', public.get_my_game_history(100),
    'friends', coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where auth.uid() in (f.player_one_id, f.player_two_id)), '[]'::jsonb),
    'reviews_received', coalesce((select jsonb_agg(to_jsonb(r)) from public.player_reviews r where r.reviewed_id = auth.uid()), '[]'::jsonb),
    'reviews_sent', coalesce((select jsonb_agg(to_jsonb(r)) from public.player_reviews r where r.reviewer_id = auth.uid()), '[]'::jsonb),
    'moderation_reports', coalesce((select jsonb_agg(to_jsonb(r)) from public.moderation_reports r where auth.uid() in (r.reporter_id, r.reported_profile_id)), '[]'::jsonb),
    'deletion_request', public.get_my_account_deletion_status()
  );
$$;
