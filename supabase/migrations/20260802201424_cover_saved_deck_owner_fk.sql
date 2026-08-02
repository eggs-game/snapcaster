-- Match the composite foreign-key column order so deck deletion and ownership
-- checks can use one covering index. The composite prefix also replaces the
-- former deck_id-only index.
drop index if exists public.saved_deck_cards_deck_fk_idx;

create index if not exists saved_deck_cards_deck_owner_fk_idx
  on public.saved_deck_cards(deck_id, owner_id);
