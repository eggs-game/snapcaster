-- The profile deck browser only needs one compact aggregate per deck. Keep the
-- card rows behind their existing owner-only RLS policy and expose the view as
-- security invoker so it cannot widen access.
create or replace view public.saved_deck_profile_sort_metadata
with (security_invoker = true)
as
select
  cards.deck_id,
  cards.owner_id,
  round(
    sum(cards.mana_value * cards.quantity) filter (
      where cards.board in ('commander', 'mainboard')
        and cards.mana_value is not null
        and cards.type_line is not null
        and cards.type_line not ilike '%land%'
    ) / nullif(
      sum(cards.quantity) filter (
        where cards.board in ('commander', 'mainboard')
          and cards.mana_value is not null
          and cards.type_line is not null
          and cards.type_line not ilike '%land%'
      ),
      0
    ),
    2
  ) as average_cmc
from public.saved_deck_cards cards
group by cards.deck_id, cards.owner_id;

revoke all on public.saved_deck_profile_sort_metadata from public, anon;
grant select on public.saved_deck_profile_sort_metadata to authenticated;
