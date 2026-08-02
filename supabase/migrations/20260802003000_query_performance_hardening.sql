-- Keep relationship deletes/joins predictable as durable game and social data
-- grows. PostgreSQL does not automatically index the referencing side of a
-- foreign key.

create index if not exists friend_requests_recipient_fk_idx on public.friend_requests(recipient_id);
create index if not exists friend_requests_sender_fk_idx on public.friend_requests(sender_id);
create index if not exists friendships_player_two_fk_idx on public.friendships(player_two_id);
create index if not exists game_audit_actor_membership_fk_idx on public.game_audit_log(actor_membership_id);
create index if not exists game_audit_session_fk_idx on public.game_audit_log(session_id);
create index if not exists game_audit_target_membership_fk_idx on public.game_audit_log(target_membership_id);
create index if not exists game_invitations_recipient_fk_idx on public.game_invitations(recipient_id);
create index if not exists game_invitations_sender_fk_idx on public.game_invitations(sender_id);
create index if not exists game_memberships_profile_fk_idx on public.game_memberships(profile_id);
create index if not exists game_corrections_actor_participant_fk_idx on public.game_result_corrections(actor_participant_id);
create index if not exists game_corrections_actor_profile_fk_idx on public.game_result_corrections(actor_profile_id);
create index if not exists game_rooms_owner_membership_fk_idx on public.game_rooms(owner_membership_id);
create index if not exists game_rooms_owner_profile_fk_idx on public.game_rooms(owner_profile_id);
create index if not exists game_participants_membership_fk_idx on public.game_session_participants(membership_id);
create index if not exists game_sessions_winner_membership_fk_idx on public.game_sessions(winner_membership_id);
create index if not exists game_turns_participant_fk_idx on public.game_turns(participant_id);
create index if not exists moderation_actions_moderator_fk_idx on public.moderation_actions(moderator_id);
create index if not exists moderation_actions_report_fk_idx on public.moderation_actions(report_id);
create index if not exists moderation_appeals_appellant_fk_idx on public.moderation_appeals(appellant_id);
create index if not exists moderation_appeals_resolver_fk_idx on public.moderation_appeals(resolved_by);
create index if not exists moderation_reports_assignee_fk_idx on public.moderation_reports(assigned_to);
create index if not exists moderation_reports_profile_fk_idx on public.moderation_reports(reported_profile_id);
create index if not exists moderation_reports_resolver_fk_idx on public.moderation_reports(resolved_by);
create index if not exists moderation_reports_review_fk_idx on public.moderation_reports(review_id);
create index if not exists moderator_accounts_granter_fk_idx on public.moderator_accounts(granted_by);
create index if not exists player_blocks_blocked_fk_idx on public.player_blocks(blocked_id);
create index if not exists player_presence_game_fk_idx on public.player_presence(game_id);
create index if not exists player_reviews_session_fk_idx on public.player_reviews(evidence_session_id);
create index if not exists player_reviews_reviewed_fk_idx on public.player_reviews(reviewed_id);
create index if not exists profile_notifications_actor_fk_idx on public.profile_notifications(actor_id);

-- Wrap auth.uid() in scalar subqueries so Postgres evaluates it once per
-- statement instead of once per candidate row.
alter policy "players update their own profile" on public.profiles
  using ((select auth.uid()) is not null and (select auth.uid()) = id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = id);

alter policy "players read their own private account" on public.account_private
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

alter policy "players read their own preferences" on public.account_preferences
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

alter policy "players update their own preferences" on public.account_preferences
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

alter policy "players read their commander decks" on public.saved_commander_decks
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

alter policy "players delete their commander decks" on public.saved_commander_decks
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

alter policy "players read their notifications" on public.profile_notifications
  using (recipient_id = (select auth.uid()));
