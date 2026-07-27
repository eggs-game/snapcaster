-- Moderator access, report appeals, editable sent reviews, and cancelable
-- account deletion. Browser clients reach private data only through RPCs.

create table if not exists public.moderator_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'moderator',
  active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint moderator_accounts_role check (role in ('moderator', 'admin'))
);

alter table public.moderation_reports
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolution_note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.player_reviews
  add column if not exists removed_at timestamptz,
  add column if not exists removal_reason text;

alter table public.player_reviews
  drop constraint if exists player_reviews_removal_reason_length;
alter table public.player_reviews
  add constraint player_reviews_removal_reason_length
  check (removal_reason is null or char_length(removal_reason) <= 2000);

alter table public.moderation_reports
  drop constraint if exists moderation_reports_resolution_note_length;
alter table public.moderation_reports
  add constraint moderation_reports_resolution_note_length
  check (resolution_note is null or char_length(resolution_note) <= 2000);

drop trigger if exists moderation_reports_set_updated_at on public.moderation_reports;
create trigger moderation_reports_set_updated_at before update on public.moderation_reports
  for each row execute function public.set_updated_at();

create unique index if not exists moderation_reports_open_review_unique
  on public.moderation_reports(reporter_id, review_id)
  where review_id is not null and status in ('open', 'reviewing');

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.moderation_reports(id) on delete cascade,
  moderator_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moderation_actions_action check (
    action in ('claimed', 'review_removed', 'resolved', 'dismissed', 'appeal_reviewed')
  ),
  constraint moderation_actions_details_size check (octet_length(details::text) <= 32768)
);

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.moderation_reports(id) on delete cascade,
  appellant_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint moderation_appeals_reason_length check (char_length(btrim(reason)) between 1 and 2000),
  constraint moderation_appeals_status check (status in ('open', 'upheld', 'overturned')),
  constraint moderation_appeals_resolution_length check (
    resolution_note is null or char_length(resolution_note) <= 2000
  ),
  unique (report_id, appellant_id)
);

alter table public.moderator_accounts enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.moderation_appeals enable row level security;

revoke all on public.moderator_accounts from public, anon, authenticated;
revoke all on public.moderation_actions from public, anon, authenticated;
revoke all on public.moderation_appeals from public, anon, authenticated;
grant all on public.moderator_accounts to service_role;
grant all on public.moderation_actions to service_role;
grant all on public.moderation_appeals to service_role;

create or replace function public.is_snapcast_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.moderator_accounts
    where profile_id = auth.uid() and active
  );
$$;

create or replace function public.get_moderation_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_snapcast_moderator() then raise exception 'moderator access required'; end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reports.id,
        'reason', reports.reason,
        'details', reports.details,
        'status', reports.status,
        'created_at', reports.created_at,
        'updated_at', reports.updated_at,
        'review', case when reviews.id is null then null else jsonb_build_object(
          'id', reviews.id,
          'rating', reviews.rating,
          'comment', reviews.comment,
          'created_at', reviews.created_at
        ) end,
        'reporter', case when reporter.id is null then null else jsonb_build_object(
          'id', reporter.id, 'display_name', reporter.display_name
        ) end,
        'reported', case when reported.id is null then null else jsonb_build_object(
          'id', reported.id, 'display_name', reported.display_name
        ) end
      ) order by reports.created_at)
      from public.moderation_reports reports
      left join public.player_reviews reviews on reviews.id = reports.review_id
      left join public.profiles reporter on reporter.id = reports.reporter_id
      left join public.profiles reported on reported.id = reports.reported_profile_id
      where reports.status in ('open', 'reviewing')
    ), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', corrections.id,
        'session_id', corrections.session_id,
        'reason', corrections.reason,
        'before_snapshot', corrections.before_snapshot,
        'after_snapshot', corrections.after_snapshot,
        'created_at', corrections.created_at,
        'player', jsonb_build_object(
          'id', participants.profile_id,
          'display_name', participants.display_name
        )
      ) order by corrections.created_at)
      from public.game_result_corrections corrections
      join public.game_session_participants participants
        on participants.id = corrections.actor_participant_id
      where corrections.status in ('pending', 'moderator_review')
    ), '[]'::jsonb),
    'appeals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', appeals.id,
        'report_id', appeals.report_id,
        'reason', appeals.reason,
        'created_at', appeals.created_at,
        'appellant', jsonb_build_object(
          'id', appellant.id, 'display_name', appellant.display_name
        )
      ) order by appeals.created_at)
      from public.moderation_appeals appeals
      join public.profiles appellant on appellant.id = appeals.appellant_id
      where appeals.status = 'open'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.resolve_game_correction(
  target_correction_id uuid,
  accept_correction boolean,
  resolution text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target_correction public.game_result_corrections;
  target_participant public.game_session_participants;
  target_session public.game_sessions;
  proposed_result text;
  proposed_loss_reason text;
  proposed_commander text;
  proposed_partner text;
begin
  if not public.is_snapcast_moderator() then raise exception 'moderator access required'; end if;
  if resolution is not null and char_length(resolution) > 2000 then
    raise exception 'resolution note is too long';
  end if;

  select * into target_correction from public.game_result_corrections
  where id = target_correction_id and status in ('pending', 'moderator_review')
  for update;
  if not found then raise exception 'correction unavailable'; end if;
  select * into target_participant from public.game_session_participants
  where id = target_correction.actor_participant_id for update;
  select * into target_session from public.game_sessions
  where id = target_correction.session_id for update;

  if accept_correction then
    proposed_result := target_correction.after_snapshot ->> 'result';
    proposed_loss_reason := target_correction.after_snapshot ->> 'loss_reason';
    proposed_commander := target_correction.after_snapshot ->> 'commander';
    proposed_partner := target_correction.after_snapshot ->> 'partner';

    if proposed_result is not null and proposed_result not in ('win', 'loss', 'draw', 'conceded', 'unknown') then
      raise exception 'invalid corrected result';
    end if;
    if proposed_loss_reason is not null
      and proposed_loss_reason not in ('life', 'commander_damage', 'poison', 'concede', 'other', 'unknown') then
      raise exception 'invalid corrected loss reason';
    end if;
    if proposed_commander is not null and char_length(btrim(proposed_commander)) not between 1 and 120 then
      raise exception 'invalid corrected commander';
    end if;
    if proposed_partner is not null and char_length(btrim(proposed_partner)) > 120 then
      raise exception 'invalid corrected partner';
    end if;

    update public.game_session_participants
    set result = coalesce(proposed_result, result),
        loss_reason = case
          when target_correction.after_snapshot ? 'loss_reason'
            then nullif(proposed_loss_reason, '')
          else loss_reason
        end
    where id = target_participant.id;

    if proposed_commander is not null then
      insert into public.game_session_commanders(participant_id, slot, commander_name)
      values (target_participant.id, 1, btrim(proposed_commander))
      on conflict (participant_id, slot) do update set commander_name = excluded.commander_name;
    end if;
    if target_correction.after_snapshot ? 'partner' then
      if nullif(btrim(proposed_partner), '') is null then
        delete from public.game_session_commanders
        where participant_id = target_participant.id and slot = 2;
      else
        insert into public.game_session_commanders(participant_id, slot, commander_name)
        values (target_participant.id, 2, btrim(proposed_partner))
        on conflict (participant_id, slot) do update set commander_name = excluded.commander_name;
      end if;
    end if;
  end if;

  update public.game_result_corrections
  set status = case when accept_correction then 'accepted' else 'declined' end,
      resolved_at = now()
  where id = target_correction.id;

  insert into public.game_audit_log(
    room_id, session_id, action, details, idempotency_key
  ) values (
    target_session.room_id,
    target_session.id,
    case when accept_correction then 'correction_accepted' else 'correction_declined' end,
    jsonb_build_object(
      'correction_id', target_correction.id,
      'moderator_id', auth.uid(),
      'resolution', nullif(btrim(resolution), '')
    ),
    gen_random_uuid()
  );
  perform public.finalize_due_game_results();
  return true;
end;
$$;

create or replace function public.resolve_moderation_report(
  target_report_id uuid,
  target_status text,
  resolution text default null,
  remove_review boolean default false
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target_report public.moderation_reports;
  review_snapshot jsonb;
begin
  if not public.is_snapcast_moderator() then raise exception 'moderator access required'; end if;
  if target_status not in ('reviewing', 'resolved', 'dismissed')
    or (resolution is not null and char_length(resolution) > 2000) then
    raise exception 'invalid moderation decision';
  end if;

  select * into target_report from public.moderation_reports
  where id = target_report_id for update;
  if not found then raise exception 'report unavailable'; end if;

  if remove_review and target_report.review_id is not null then
    select jsonb_build_object('rating', rating, 'comment', comment)
    into review_snapshot
    from public.player_reviews where id = target_report.review_id;
    update public.player_reviews
    set comment = null, removed_at = now(), removal_reason = nullif(btrim(resolution), '')
    where id = target_report.review_id;
    insert into public.moderation_actions(report_id, moderator_id, action, details)
    values (
      target_report.id,
      auth.uid(),
      'review_removed',
      jsonb_build_object('review_id', target_report.review_id, 'review', review_snapshot)
    );
  end if;

  update public.moderation_reports
  set status = target_status,
      assigned_to = coalesce(assigned_to, auth.uid()),
      resolved_by = case when target_status in ('resolved', 'dismissed') then auth.uid() else null end,
      resolved_at = case when target_status in ('resolved', 'dismissed') then now() else null end,
      resolution_note = nullif(btrim(resolution), '')
  where id = target_report.id;

  insert into public.moderation_actions(report_id, moderator_id, action, details)
  values (
    target_report.id,
    auth.uid(),
    case target_status when 'reviewing' then 'claimed' when 'dismissed' then 'dismissed' else 'resolved' end,
    jsonb_build_object('note', nullif(btrim(resolution), ''), 'review_removed', remove_review)
  );
  return true;
end;
$$;

create or replace function public.submit_moderation_appeal(target_report_id uuid, appeal_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare appeal_id uuid;
begin
  if auth.uid() is null
    or char_length(btrim(appeal_reason)) not between 1 and 2000
    or not exists (
      select 1 from public.moderation_reports
      where id = target_report_id
        and reported_profile_id = auth.uid()
        and status in ('resolved', 'dismissed')
    ) then raise exception 'appeal unavailable'; end if;
  perform public.snapcast_check_rate_limit('moderation_appeal', 5, interval '1 day');
  insert into public.moderation_appeals(report_id, appellant_id, reason)
  values (target_report_id, auth.uid(), btrim(appeal_reason))
  returning id into appeal_id;
  return appeal_id;
end;
$$;

create or replace function public.resolve_moderation_appeal(
  target_appeal_id uuid, target_status text, resolution text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_appeal public.moderation_appeals;
begin
  if not public.is_snapcast_moderator() then raise exception 'moderator access required'; end if;
  if target_status not in ('upheld', 'overturned')
    or char_length(btrim(resolution)) not between 1 and 2000 then
    raise exception 'invalid appeal decision';
  end if;
  select * into target_appeal from public.moderation_appeals
  where id = target_appeal_id and status = 'open' for update;
  if not found then raise exception 'appeal unavailable'; end if;
  update public.moderation_appeals
  set status = target_status, resolution_note = btrim(resolution),
      resolved_by = auth.uid(), resolved_at = now()
  where id = target_appeal.id;
  if target_status = 'overturned' then
    update public.player_reviews reviews
    set removed_at = null,
        removal_reason = null,
        rating = coalesce((actions.details -> 'review' ->> 'rating')::integer, reviews.rating),
        comment = actions.details -> 'review' ->> 'comment'
    from public.moderation_reports reports,
      lateral (
        select details from public.moderation_actions
        where report_id = target_appeal.report_id and action = 'review_removed'
        order by created_at desc limit 1
      ) actions
    where reports.id = target_appeal.report_id
      and reviews.id = reports.review_id;
  end if;
  insert into public.moderation_actions(report_id, moderator_id, action, details)
  values (
    target_appeal.report_id, auth.uid(), 'appeal_reviewed',
    jsonb_build_object('appeal_id', target_appeal.id, 'status', target_status, 'note', btrim(resolution))
  );
  return true;
end;
$$;

create or replace function public.get_my_sent_reviews()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reviews.id,
    'rating', reviews.rating,
    'comment', reviews.comment,
    'created_at', reviews.created_at,
    'updated_at', reviews.updated_at,
    'editable_until', reviews.editable_until,
    'reviewed', jsonb_build_object(
      'id', reviewed.id,
      'display_name', reviewed.display_name,
      'avatar_url', reviewed.avatar_url
    )
  ) order by reviews.updated_at desc), '[]'::jsonb)
  from public.player_reviews reviews
  join public.profiles reviewed on reviewed.id = reviews.reviewed_id
  where reviews.reviewer_id = auth.uid()
    and reviews.removed_at is null
    and not public.players_are_blocked(auth.uid(), reviews.reviewed_id);
$$;

create or replace function public.get_my_received_reviews()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reviews.id,
    'rating', reviews.rating,
    'comment', reviews.comment,
    'created_at', reviews.created_at,
    'reviewer', jsonb_build_object(
      'id', reviewer.id,
      'display_name', reviewer.display_name,
      'avatar_url', reviewer.avatar_url
    )
  ) order by reviews.created_at desc), '[]'::jsonb)
  from public.player_reviews reviews
  join public.profiles reviewer on reviewer.id = reviews.reviewer_id
  where reviews.reviewed_id = auth.uid()
    and reviews.removed_at is null
    and not public.players_are_blocked(auth.uid(), reviews.reviewer_id);
$$;

create or replace function public.update_my_player_review(
  target_review_id uuid, review_rating integer, review_comment text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.snapcast_check_rate_limit('review_update', 30, interval '1 day');
  if review_rating not between 1 and 5
    or (review_comment is not null and char_length(review_comment) > 1000) then
    raise exception 'invalid review';
  end if;
  update public.player_reviews
  set rating = review_rating, comment = nullif(btrim(review_comment), '')
  where id = target_review_id
    and reviewer_id = auth.uid()
    and editable_until > now()
    and removed_at is null;
  if not found then raise exception 'review edit window is closed'; end if;
  return true;
end;
$$;

create or replace function public.search_public_profiles(search_text text, result_limit integer default 12)
returns table (id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.snapcast_check_rate_limit('profile_search', 60, interval '1 hour');
  return query
  select profiles.id, profiles.display_name, profiles.avatar_url
  from public.profiles profiles
  where char_length(btrim(search_text)) >= 2
    and profiles.display_name ilike '%' || left(btrim(search_text), 32) || '%'
    and (auth.uid() is null or not public.players_are_blocked(auth.uid(), profiles.id))
  order by
    case when lower(profiles.display_name) = lower(btrim(search_text)) then 0 else 1 end,
    profiles.display_name
  limit least(greatest(coalesce(result_limit, 12), 1), 20);
end;
$$;

create or replace function public.get_my_moderation_cases()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reports.id,
    'reason', reports.reason,
    'status', reports.status,
    'created_at', reports.created_at,
    'resolved_at', reports.resolved_at,
    'resolution_note', reports.resolution_note,
    'relationship', case when reports.reporter_id = auth.uid() then 'reported' else 'subject' end,
    'can_appeal', reports.reported_profile_id = auth.uid()
      and reports.status in ('resolved', 'dismissed')
      and not exists (
        select 1 from public.moderation_appeals appeals
        where appeals.report_id = reports.id and appeals.appellant_id = auth.uid()
      ),
    'appeal', (
      select jsonb_build_object(
        'status', appeals.status,
        'reason', appeals.reason,
        'resolution_note', appeals.resolution_note,
        'created_at', appeals.created_at
      )
      from public.moderation_appeals appeals
      where appeals.report_id = reports.id and appeals.appellant_id = auth.uid()
    )
  ) order by reports.created_at desc), '[]'::jsonb)
  from public.moderation_reports reports
  where auth.uid() in (reports.reporter_id, reports.reported_profile_id);
$$;

create or replace function public.cancel_account_deletion()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.account_deletion_requests
  set canceled_at = now()
  where profile_id = auth.uid() and canceled_at is null and completed_at is null;
  if not found then raise exception 'active deletion request unavailable'; end if;
  return true;
end;
$$;

create or replace function public.get_my_account_deletion_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'requested_at', requested_at,
      'execute_after', execute_after,
      'canceled_at', canceled_at,
      'completed_at', completed_at
    )
    from public.account_deletion_requests
    where profile_id = auth.uid()
  ), '{}'::jsonb);
$$;

create or replace function public.get_my_account_export()
returns jsonb language sql volatile security definer set search_path = '' as $$
  select public.snapcast_check_rate_limit('account_export', 10, interval '1 day');
  select jsonb_build_object(
    'generated_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'private_account', (select to_jsonb(a) from public.account_private a where a.user_id = auth.uid()),
    'preferences', (select to_jsonb(p) from public.account_preferences p where p.user_id = auth.uid()),
    'decks', coalesce((select jsonb_agg(to_jsonb(d)) from public.saved_commander_decks d where d.owner_id = auth.uid()), '[]'::jsonb),
    'games', public.get_my_game_history(100),
    'friends', coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where auth.uid() in (f.player_one_id, f.player_two_id)), '[]'::jsonb),
    'reviews_received', coalesce((select jsonb_agg(to_jsonb(r)) from public.player_reviews r where r.reviewed_id = auth.uid()), '[]'::jsonb),
    'reviews_sent', coalesce((select jsonb_agg(to_jsonb(r)) from public.player_reviews r where r.reviewer_id = auth.uid()), '[]'::jsonb),
    'moderation_reports', coalesce((select jsonb_agg(to_jsonb(r)) from public.moderation_reports r where auth.uid() in (r.reporter_id, r.reported_profile_id)), '[]'::jsonb),
    'deletion_request', public.get_my_account_deletion_status()
  );
$$;

create or replace function public.get_due_account_deletions(max_rows integer default 50)
returns table (target_profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select requests.profile_id
  from public.account_deletion_requests requests
  where requests.execute_after <= now()
    and requests.canceled_at is null
  order by requests.execute_after
  limit greatest(1, least(max_rows, 200));
$$;

create or replace function public.run_snapcast_retention()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  removed_notifications integer;
  removed_invitations integer;
  removed_presence integer;
  removed_rate_events integer;
  removed_moderation_reports integer;
  closed_stale_rooms integer;
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

  delete from public.moderation_reports
  where status in ('resolved', 'dismissed')
    and resolved_at < now() - interval '365 days';
  get diagnostics removed_moderation_reports = row_count;

  update public.game_turns turns
  set ended_at = now()
  from public.game_sessions sessions, public.game_rooms rooms
  where turns.session_id = sessions.id
    and sessions.room_id = rooms.id
    and turns.ended_at is null
    and rooms.status in ('lobby', 'live')
    and rooms.last_seen_at < now() - interval '30 minutes';

  update public.game_sessions sessions
  set state = 'unresolved',
      ended_at = coalesce(ended_at, now()),
      result_kind = coalesce(result_kind, 'unresolved')
  from public.game_rooms rooms
  where sessions.room_id = rooms.id
    and sessions.state = 'active'
    and rooms.status in ('lobby', 'live')
    and rooms.last_seen_at < now() - interval '30 minutes';

  update public.game_rooms
  set status = 'closed', ended_at = coalesce(ended_at, now())
  where status in ('lobby', 'live')
    and last_seen_at < now() - interval '30 minutes';
  get diagnostics closed_stale_rooms = row_count;

  perform public.finalize_due_game_results();
  return jsonb_build_object(
    'notifications', removed_notifications,
    'invitations', removed_invitations,
    'presence', removed_presence,
    'rate_events', removed_rate_events,
    'moderation_reports', removed_moderation_reports,
    'closed_stale_rooms', closed_stale_rooms
  );
end;
$$;

revoke all on function public.is_snapcast_moderator() from public;
revoke all on function public.get_moderation_queue() from public;
revoke all on function public.resolve_game_correction(uuid, boolean, text) from public;
revoke all on function public.resolve_moderation_report(uuid, text, text, boolean) from public;
revoke all on function public.submit_moderation_appeal(uuid, text) from public;
revoke all on function public.resolve_moderation_appeal(uuid, text, text) from public;
revoke all on function public.get_my_sent_reviews() from public;
revoke all on function public.get_my_received_reviews() from public;
revoke all on function public.update_my_player_review(uuid, integer, text) from public;
revoke all on function public.search_public_profiles(text, integer) from public;
revoke all on function public.get_my_moderation_cases() from public;
revoke all on function public.cancel_account_deletion() from public;
revoke all on function public.get_my_account_deletion_status() from public;
revoke all on function public.get_my_account_export() from public;
revoke all on function public.get_due_account_deletions(integer) from public, anon, authenticated;
revoke all on function public.run_snapcast_retention() from public, anon, authenticated;

grant execute on function public.is_snapcast_moderator() to authenticated;
grant execute on function public.get_moderation_queue() to authenticated;
grant execute on function public.resolve_game_correction(uuid, boolean, text) to authenticated;
grant execute on function public.resolve_moderation_report(uuid, text, text, boolean) to authenticated;
grant execute on function public.submit_moderation_appeal(uuid, text) to authenticated;
grant execute on function public.resolve_moderation_appeal(uuid, text, text) to authenticated;
grant execute on function public.get_my_sent_reviews() to authenticated;
grant execute on function public.get_my_received_reviews() to authenticated;
grant execute on function public.update_my_player_review(uuid, integer, text) to authenticated;
grant execute on function public.search_public_profiles(text, integer) to anon, authenticated;
grant execute on function public.get_my_moderation_cases() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.get_my_account_deletion_status() to authenticated;
grant execute on function public.get_my_account_export() to authenticated;
grant execute on function public.get_due_account_deletions(integer) to service_role;
grant execute on function public.run_snapcast_retention() to service_role;
