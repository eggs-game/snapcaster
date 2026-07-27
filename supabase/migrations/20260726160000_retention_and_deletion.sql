-- Retention maintenance and the service-only half of account deletion.

create or replace function public.run_snapcast_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_notifications integer;
  removed_invitations integer;
  removed_presence integer;
  removed_rate_events integer;
begin
  delete from public.profile_notifications
  where created_at < now() - interval '90 days'
    or (expires_at is not null and expires_at < now() - interval '7 days');
  get diagnostics removed_notifications = row_count;

  delete from public.game_invitations
  where created_at < now() - interval '90 days'
    or (expires_at < now() - interval '7 days' and status <> 'pending');
  get diagnostics removed_invitations = row_count;

  delete from public.player_presence where expires_at < now() - interval '7 days';
  get diagnostics removed_presence = row_count;

  delete from public.security_rate_events where occurred_at < now() - interval '2 days';
  get diagnostics removed_rate_events = row_count;

  perform public.finalize_due_game_results();
  return jsonb_build_object(
    'notifications', removed_notifications,
    'invitations', removed_invitations,
    'presence', removed_presence,
    'rate_events', removed_rate_events
  );
end;
$$;

create or replace function public.prepare_account_deletion(target_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.account_deletion_requests
    where profile_id = target_profile_id
      and canceled_at is null
      and execute_after <= now()
  ) then raise exception 'deletion request is not ready'; end if;

  update public.game_session_participants
  set profile_id = null, display_name = 'Deleted player'
  where profile_id = target_profile_id;
  update public.game_memberships
  set profile_id = null, display_name = 'Deleted player'
  where profile_id = target_profile_id;
  update public.game_result_corrections set actor_profile_id = null
  where actor_profile_id = target_profile_id;
  delete from public.player_reviews where reviewer_id = target_profile_id or reviewed_id = target_profile_id;
  update public.moderation_reports set reporter_id = null where reporter_id = target_profile_id;
  update public.moderation_reports set reported_profile_id = null where reported_profile_id = target_profile_id;
  delete from public.profile_notifications where recipient_id = target_profile_id or actor_id = target_profile_id;
  delete from public.game_invitations where sender_id = target_profile_id or recipient_id = target_profile_id;
  delete from public.friend_requests where sender_id = target_profile_id or recipient_id = target_profile_id;
  delete from public.friendships where target_profile_id in (player_one_id, player_two_id);
  delete from public.player_blocks where target_profile_id in (blocker_id, blocked_id);
  delete from public.player_presence where profile_id = target_profile_id;
  delete from public.saved_commander_decks where owner_id = target_profile_id;
  delete from public.account_preferences where user_id = target_profile_id;
  delete from public.account_private where user_id = target_profile_id;
  update public.profiles set display_name = 'Deleted player', avatar_url = null
  where id = target_profile_id;
  update public.account_deletion_requests set completed_at = now()
  where profile_id = target_profile_id;
  return true;
end;
$$;

revoke all on function public.run_snapcast_retention() from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.run_snapcast_retention() to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
