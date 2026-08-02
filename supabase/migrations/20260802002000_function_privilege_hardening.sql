-- Supabase projects grant new public-schema functions to API roles through
-- default privileges. SECURITY DEFINER functions must instead be deny-by-
-- default, with the callable surface explicitly listed below.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select procedures.oid::regprocedure
    from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.prosecdef
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      target_function
    );
  end loop;
end;
$$;

-- Read-only public directory and opt-in recognition labeling.
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
grant execute on function public.get_profile_matchups(uuid) to anon, authenticated;
grant execute on function public.search_public_profiles(text, integer) to anon, authenticated;
grant execute on function public.list_public_game_rooms(text, integer, boolean, text, integer)
  to anon, authenticated;
grant execute on function public.list_public_game_rooms_with_cards(text, integer, boolean, text, integer)
  to anon, authenticated;
grant execute on function public.label_recognition_report(uuid, uuid, jsonb)
  to anon, authenticated;

-- Anonymous Supabase Auth users have the authenticated database role, so game
-- mutations never need raw anon execution.
grant execute on function public.create_game_room(text, text, integer, text, integer, text, text) to authenticated;
grant execute on function public.join_game_room(text, text, text, text) to authenticated;
grant execute on function public.touch_game_membership(uuid, text, text, text) to authenticated;
grant execute on function public.leave_game_room(uuid, text) to authenticated;
grant execute on function public.owner_start_game(uuid, text, uuid) to authenticated;
grant execute on function public.claim_game_ownership(uuid, uuid, text) to authenticated;
grant execute on function public.get_game_membership_states(uuid, uuid, text) to authenticated;
grant execute on function public.claim_guest_game_membership(uuid, text) to authenticated;
grant execute on function public.owner_manage_member(uuid, text, uuid, text, uuid) to authenticated;
grant execute on function public.record_game_turn(uuid, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.owner_end_game(uuid, text, text, uuid, jsonb, uuid) to authenticated;
grant execute on function public.owner_restart_game(uuid, text, uuid) to authenticated;
grant execute on function public.submit_game_correction(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.get_realtime_room_epoch(uuid, text) to authenticated;
grant execute on function public.snapcast_can_access_realtime_topic(text) to authenticated;

-- Signed-in account, social, review, and moderation RPCs.
grant execute on function public.get_my_game_history(integer) to authenticated;
grant execute on function public.set_my_game_visibility(uuid, boolean) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.mark_my_notifications_read() to authenticated;
grant execute on function public.dismiss_my_notification(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.block_player(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.list_social_dashboard() to authenticated;
grant execute on function public.update_my_presence(text, uuid) to authenticated;
grant execute on function public.create_game_invitation(uuid, uuid, text) to authenticated;
grant execute on function public.respond_game_invitation(uuid, boolean) to authenticated;
grant execute on function public.cancel_game_invitation(uuid, text) to authenticated;
grant execute on function public.submit_player_review(uuid, uuid, integer, text) to authenticated;
grant execute on function public.get_review_eligible_profiles(uuid) to authenticated;
grant execute on function public.report_player_review(uuid, text, text) to authenticated;
grant execute on function public.get_my_sent_reviews() to authenticated;
grant execute on function public.get_my_received_reviews() to authenticated;
grant execute on function public.update_my_player_review(uuid, integer, text) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.get_my_account_deletion_status() to authenticated;
grant execute on function public.get_my_account_export() to authenticated;
grant execute on function public.is_snapcast_moderator() to authenticated;
grant execute on function public.get_moderation_queue() to authenticated;
grant execute on function public.resolve_game_correction(uuid, boolean, text) to authenticated;
grant execute on function public.resolve_moderation_report(uuid, text, text, boolean) to authenticated;
grant execute on function public.submit_moderation_appeal(uuid, text) to authenticated;
grant execute on function public.resolve_moderation_appeal(uuid, text, text) to authenticated;
grant execute on function public.get_my_moderation_cases() to authenticated;

-- Maintenance and validated commander mutations stay server-only.
grant execute on function public.finalize_due_game_results() to service_role;
grant execute on function public.run_snapcast_retention() to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.get_due_account_deletions(integer) to service_role;
grant execute on function public.snapcast_check_server_rate_limit(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.set_validated_game_commanders(uuid, text, uuid, text, uuid, text, uuid, text)
  to service_role;
