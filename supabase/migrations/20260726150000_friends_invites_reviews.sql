-- Mutual friends, blocks, privacy-aware presence, direct invitations,
-- recipient-owned notifications, and private post-game reviews.

create table if not exists public.player_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint player_blocks_not_self check (blocker_id <> blocked_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (sender_id <> recipient_id),
  constraint friend_requests_status check (status in ('pending', 'accepted', 'declined', 'canceled'))
);

create unique index if not exists friend_requests_pending_pair_unique
  on public.friend_requests(least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status = 'pending';

create table if not exists public.friendships (
  player_one_id uuid not null references public.profiles(id) on delete cascade,
  player_two_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_one_id, player_two_id),
  constraint friendships_canonical_pair check (player_one_id < player_two_id)
);

create table if not exists public.player_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'offline',
  game_id uuid references public.game_rooms(id) on delete set null,
  expires_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_presence_status check (status in ('online', 'in_game', 'offline'))
);

create table if not exists public.game_invitations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.game_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  token_hash bytea not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint game_invitations_not_self check (sender_id <> recipient_id),
  constraint game_invitations_status check (status in ('pending', 'accepted', 'declined', 'expired', 'canceled')),
  constraint game_invitations_expiry check (expires_at > created_at)
);

create unique index if not exists game_invitations_pending_unique
  on public.game_invitations(game_id, recipient_id)
  where status = 'pending';

create table if not exists public.profile_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  reference_id uuid,
  read_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profile_notifications_kind check (
    kind in ('friend_request', 'friend_accepted', 'game_invitation', 'result_correction', 'review_received')
  )
);

create index if not exists profile_notifications_recipient_idx
  on public.profile_notifications(recipient_id, created_at desc)
  where dismissed_at is null;

create table if not exists public.player_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewed_id uuid not null references public.profiles(id) on delete cascade,
  evidence_session_id uuid not null references public.game_sessions(id) on delete restrict,
  rating smallint not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editable_until timestamptz not null default now() + interval '7 days',
  constraint player_reviews_not_self check (reviewer_id <> reviewed_id),
  constraint player_reviews_rating check (rating between 1 and 5),
  constraint player_reviews_comment_length check (comment is null or char_length(comment) <= 1000),
  unique (reviewer_id, reviewed_id)
);

create table if not exists public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  reported_profile_id uuid references public.profiles(id) on delete set null,
  review_id uuid references public.player_reviews(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint moderation_reports_reason_length check (char_length(btrim(reason)) between 1 and 120),
  constraint moderation_reports_details_length check (details is null or char_length(details) <= 2000),
  constraint moderation_reports_status check (status in ('open', 'reviewing', 'resolved', 'dismissed'))
);

create table if not exists public.account_deletion_requests (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  execute_after timestamptz not null default now() + interval '7 days',
  canceled_at timestamptz,
  completed_at timestamptz
);

drop trigger if exists player_reviews_set_updated_at on public.player_reviews;
create trigger player_reviews_set_updated_at before update on public.player_reviews
  for each row execute function public.set_updated_at();

alter table public.player_blocks enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.player_presence enable row level security;
alter table public.game_invitations enable row level security;
alter table public.profile_notifications enable row level security;
alter table public.player_reviews enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.account_deletion_requests enable row level security;

revoke all on public.player_blocks from anon, authenticated;
revoke all on public.friend_requests from anon, authenticated;
revoke all on public.friendships from anon, authenticated;
revoke all on public.player_presence from anon, authenticated;
revoke all on public.game_invitations from anon, authenticated;
revoke all on public.profile_notifications from anon, authenticated;
revoke all on public.player_reviews from anon, authenticated;
revoke all on public.moderation_reports from anon, authenticated;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.profile_notifications to authenticated;

drop policy if exists "players read their notifications" on public.profile_notifications;
create policy "players read their notifications" on public.profile_notifications
  for select to authenticated using (recipient_id = auth.uid());

drop policy if exists "players dismiss their notifications" on public.profile_notifications;

create or replace function public.mark_my_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.profile_notifications
  set read_at = now()
  where recipient_id = auth.uid() and read_at is null and dismissed_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.dismiss_my_notification(target_notification_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.profile_notifications
  set dismissed_at = now(), read_at = coalesce(read_at, now())
  where id = target_notification_id and recipient_id = auth.uid() and dismissed_at is null;
  if not found then raise exception 'notification unavailable'; end if;
  return true;
end;
$$;

create or replace function public.players_are_blocked(one_id uuid, two_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.player_blocks
    where (blocker_id = one_id and blocked_id = two_id)
       or (blocker_id = two_id and blocked_id = one_id)
  );
$$;
revoke all on function public.players_are_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.send_friend_request(target_profile_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  perform public.snapcast_check_rate_limit('friend_request', 20, interval '1 hour');
  if auth.uid() is null or auth.uid() = target_profile_id then raise exception 'invalid friend request'; end if;
  if public.players_are_blocked(auth.uid(), target_profile_id) then raise exception 'friend request unavailable'; end if;
  if exists (select 1 from public.friendships where player_one_id = least(auth.uid(), target_profile_id) and player_two_id = greatest(auth.uid(), target_profile_id)) then
    raise exception 'already friends';
  end if;
  if (select count(*) from public.friend_requests where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'friend request rate limit reached';
  end if;
  insert into public.friend_requests(sender_id, recipient_id)
  values (auth.uid(), target_profile_id) returning id into request_id;
  insert into public.profile_notifications(recipient_id, actor_id, kind, reference_id)
  values (target_profile_id, auth.uid(), 'friend_request', request_id);
  return request_id;
end;
$$;

create or replace function public.respond_friend_request(target_request_id uuid, accept_request boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare request public.friend_requests;
begin
  select * into request from public.friend_requests
  where id = target_request_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'friend request unavailable'; end if;
  if public.players_are_blocked(request.sender_id, request.recipient_id) then accept_request := false; end if;
  update public.friend_requests set status = case when accept_request then 'accepted' else 'declined' end, responded_at = now()
  where id = request.id;
  if accept_request then
    insert into public.friendships(player_one_id, player_two_id)
    values (least(request.sender_id, request.recipient_id), greatest(request.sender_id, request.recipient_id))
    on conflict do nothing;
    insert into public.profile_notifications(recipient_id, actor_id, kind, reference_id)
    values (request.sender_id, request.recipient_id, 'friend_accepted', request.id);
  end if;
  update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'friend_request' and reference_id = request.id;
  return accept_request;
end;
$$;

create or replace function public.block_player(target_profile_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() = target_profile_id then raise exception 'invalid block'; end if;
  insert into public.player_blocks(blocker_id, blocked_id) values (auth.uid(), target_profile_id) on conflict do nothing;
  delete from public.friendships
  where player_one_id = least(auth.uid(), target_profile_id) and player_two_id = greatest(auth.uid(), target_profile_id);
  update public.friend_requests set status = 'canceled', responded_at = now()
  where status = 'pending' and ((sender_id = auth.uid() and recipient_id = target_profile_id) or (sender_id = target_profile_id and recipient_id = auth.uid()));
  update public.game_invitations set status = 'canceled', responded_at = now()
  where status = 'pending' and ((sender_id = auth.uid() and recipient_id = target_profile_id) or (sender_id = target_profile_id and recipient_id = auth.uid()));
  update public.profile_notifications set dismissed_at = now()
  where recipient_id in (auth.uid(), target_profile_id) and actor_id in (auth.uid(), target_profile_id);
  return true;
end;
$$;

create or replace function public.remove_friend(target_profile_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  delete from public.friendships
  where player_one_id = least(auth.uid(), target_profile_id)
    and player_two_id = greatest(auth.uid(), target_profile_id);
  get diagnostics removed_count = row_count;
  update public.profile_notifications
  set dismissed_at = now(), read_at = coalesce(read_at, now())
  where kind = 'game_invitation'
    and reference_id in (
      select id from public.game_invitations
      where status = 'pending'
        and ((sender_id = auth.uid() and recipient_id = target_profile_id)
          or (sender_id = target_profile_id and recipient_id = auth.uid()))
    );
  update public.game_invitations set status = 'canceled', responded_at = now()
  where status = 'pending'
    and ((sender_id = auth.uid() and recipient_id = target_profile_id)
      or (sender_id = target_profile_id and recipient_id = auth.uid()));
  return removed_count > 0;
end;
$$;

create or replace function public.list_social_dashboard()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profiles.id, 'display_name', profiles.display_name, 'avatar_url', profiles.avatar_url,
        'status', case
          when preferences.appear_offline or presence.expires_at <= now() then 'offline'
          else presence.status
        end
      ) order by profiles.display_name)
      from public.friendships friendships
      join public.profiles profiles on profiles.id = case when friendships.player_one_id = auth.uid() then friendships.player_two_id else friendships.player_one_id end
      left join public.player_presence presence on presence.profile_id = profiles.id
      left join public.account_preferences preferences on preferences.user_id = profiles.id
      where auth.uid() in (friendships.player_one_id, friendships.player_two_id)
        and not public.players_are_blocked(auth.uid(), profiles.id)
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', notifications.id, 'kind', notifications.kind, 'reference_id', notifications.reference_id,
        'read_at', notifications.read_at, 'created_at', notifications.created_at,
        'actor', case when actor.id is null then null else jsonb_build_object('id', actor.id, 'display_name', actor.display_name, 'avatar_url', actor.avatar_url) end
      ) order by notifications.created_at desc)
      from (select * from public.profile_notifications
        where recipient_id = auth.uid() and dismissed_at is null
          and (expires_at is null or expires_at > now())
        order by created_at desc limit 50) notifications
      left join public.profiles actor on actor.id = notifications.actor_id
      where notifications.actor_id is null or not public.players_are_blocked(auth.uid(), notifications.actor_id)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.update_my_presence(requested_status text, target_game_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or requested_status not in ('online', 'in_game', 'offline') then raise exception 'invalid presence'; end if;
  insert into public.player_presence(profile_id, status, game_id, expires_at, updated_at)
  values (auth.uid(), requested_status, case when requested_status = 'in_game' then target_game_id else null end, now() + interval '90 seconds', now())
  on conflict (profile_id) do update set status = excluded.status, game_id = excluded.game_id, expires_at = excluded.expires_at, updated_at = now();
  return true;
end;
$$;

create or replace function public.create_game_invitation(
  target_game_id uuid, target_profile_id uuid, owner_token text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation_id uuid; target_room public.game_rooms;
begin
  perform public.snapcast_check_rate_limit('game_invitation', 30, interval '1 hour');
  if auth.uid() is null or auth.uid() = target_profile_id then raise exception 'invalid invitation'; end if;
  target_room := public.snapcast_require_owner(target_game_id, owner_token);
  if target_room.status not in ('lobby', 'live') then raise exception 'game is unavailable'; end if;
  if public.players_are_blocked(auth.uid(), target_profile_id) then raise exception 'invitation unavailable'; end if;
  if not exists (
    select 1 from public.friendships
    where player_one_id = least(auth.uid(), target_profile_id)
      and player_two_id = greatest(auth.uid(), target_profile_id)
  ) then raise exception 'game invitations are for friends'; end if;
  if (select count(*) from public.game_invitations where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'invitation rate limit reached';
  end if;
  insert into public.game_invitations(game_id, sender_id, recipient_id, token_hash, expires_at)
  values (target_game_id, auth.uid(), target_profile_id, extensions.digest(gen_random_uuid()::text, 'sha256'), least(now() + interval '24 hours', coalesce(target_room.ended_at, now() + interval '24 hours')))
  returning id into invitation_id;
  insert into public.profile_notifications(recipient_id, actor_id, kind, reference_id, expires_at)
  values (target_profile_id, auth.uid(), 'game_invitation', invitation_id, now() + interval '24 hours');
  return invitation_id;
end;
$$;

create or replace function public.respond_game_invitation(target_invitation_id uuid, accept_invitation boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.game_invitations; target_room public.game_rooms;
begin
  select * into invitation from public.game_invitations
  where id = target_invitation_id and recipient_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'invitation unavailable'; end if;
  select * into target_room from public.game_rooms where id = invitation.game_id for update;
  if invitation.expires_at <= now() or target_room.status not in ('lobby', 'live') then
    update public.game_invitations set status = 'expired', responded_at = now() where id = invitation.id;
    raise exception 'invitation expired';
  end if;
  if public.players_are_blocked(invitation.sender_id, invitation.recipient_id) then accept_invitation := false; end if;
  update public.game_invitations
  set status = case when accept_invitation then 'accepted' else 'declined' end, responded_at = now()
  where id = invitation.id;
  update public.profile_notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'game_invitation' and reference_id = invitation.id;
  return jsonb_build_object(
    'accepted', accept_invitation,
    'code', case when accept_invitation then target_room.code else null end,
    'role', case when target_room.status = 'live' then 'visitor' else 'player' end
  );
end;
$$;

create or replace function public.submit_player_review(
  target_profile_id uuid, target_session_id uuid, review_rating integer, review_comment text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare review_id uuid;
begin
  perform public.snapcast_check_rate_limit('player_review', 20, interval '1 day');
  if auth.uid() is null or auth.uid() = target_profile_id or review_rating not between 1 and 5 then raise exception 'invalid review'; end if;
  if public.players_are_blocked(auth.uid(), target_profile_id) then raise exception 'review unavailable'; end if;
  if not exists (
    select 1 from public.game_session_participants mine
    join public.game_session_participants theirs on theirs.session_id = mine.session_id
    where mine.session_id = target_session_id and mine.profile_id = auth.uid() and theirs.profile_id = target_profile_id
  ) then raise exception 'shared game required'; end if;
  if review_comment is not null and char_length(review_comment) > 1000 then raise exception 'review comment is too long'; end if;
  insert into public.player_reviews(reviewer_id, reviewed_id, evidence_session_id, rating, comment)
  values (auth.uid(), target_profile_id, target_session_id, review_rating, nullif(btrim(review_comment), ''))
  returning id into review_id;
  insert into public.profile_notifications(recipient_id, actor_id, kind, reference_id)
  values (target_profile_id, auth.uid(), 'review_received', review_id);
  return review_id;
end;
$$;

create or replace function public.get_review_eligible_profiles(target_session_id uuid)
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select profiles.id, profiles.display_name, profiles.avatar_url
  from public.game_session_participants mine
  join public.game_session_participants others on others.session_id = mine.session_id
  join public.profiles profiles on profiles.id = others.profile_id
  where mine.session_id = target_session_id
    and mine.profile_id = auth.uid()
    and others.profile_id is not null
    and others.profile_id <> auth.uid()
    and not public.players_are_blocked(auth.uid(), others.profile_id)
    and not exists (
      select 1 from public.player_reviews reviews
      where reviews.reviewer_id = auth.uid() and reviews.reviewed_id = others.profile_id
    );
$$;

create or replace function public.report_player_review(target_review_id uuid, report_reason text, report_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare report_id uuid; target_review public.player_reviews;
begin
  perform public.snapcast_check_rate_limit('review_report', 10, interval '1 day');
  select * into target_review from public.player_reviews
  where id = target_review_id and reviewed_id = auth.uid();
  if not found then raise exception 'review unavailable'; end if;
  if char_length(btrim(report_reason)) not between 1 and 120
    or (report_details is not null and char_length(report_details) > 2000) then
    raise exception 'invalid report';
  end if;
  insert into public.moderation_reports(reporter_id, reported_profile_id, review_id, reason, details)
  values (auth.uid(), target_review.reviewer_id, target_review_id, btrim(report_reason), nullif(btrim(report_details), ''))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.get_my_received_reviews()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reviews.id,
    'rating', reviews.rating,
    'comment', reviews.comment,
    'created_at', reviews.created_at,
    'reviewer', jsonb_build_object('id', reviewer.id, 'display_name', reviewer.display_name, 'avatar_url', reviewer.avatar_url)
  ) order by reviews.created_at desc), '[]'::jsonb)
  from public.player_reviews reviews
  join public.profiles reviewer on reviewer.id = reviews.reviewer_id
  where reviews.reviewed_id = auth.uid()
    and not public.players_are_blocked(auth.uid(), reviews.reviewer_id);
$$;

create or replace function public.update_my_player_review(
  target_review_id uuid, review_rating integer, review_comment text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.snapcast_check_rate_limit('review_update', 30, interval '1 day');
  if review_rating not between 1 and 5 or (review_comment is not null and char_length(review_comment) > 1000) then
    raise exception 'invalid review';
  end if;
  update public.player_reviews
  set rating = review_rating, comment = nullif(btrim(review_comment), '')
  where id = target_review_id and reviewer_id = auth.uid() and editable_until > now();
  if not found then raise exception 'review edit window is closed'; end if;
  return true;
end;
$$;

create or replace function public.get_my_account_export()
returns jsonb language sql volatile security definer set search_path = '' as $$
  select public.snapcast_check_rate_limit('account_export', 10, interval '1 day');
  select jsonb_build_object(
    'generated_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'private_account', (select to_jsonb(a) - 'discord_user_id' from public.account_private a where a.user_id = auth.uid()),
    'preferences', (select to_jsonb(p) from public.account_preferences p where p.user_id = auth.uid()),
    'decks', coalesce((select jsonb_agg(to_jsonb(d)) from public.saved_commander_decks d where d.owner_id = auth.uid()), '[]'::jsonb),
    'games', public.get_my_game_history(100),
    'friends', coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where auth.uid() in (f.player_one_id, f.player_two_id)), '[]'::jsonb),
    'reviews_received', coalesce((select jsonb_agg(to_jsonb(r)) from public.player_reviews r where r.reviewed_id = auth.uid()), '[]'::jsonb)
  );
$$;

create or replace function public.request_account_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare deadline timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform public.snapcast_check_rate_limit('account_deletion_request', 3, interval '1 day');
  insert into public.account_deletion_requests(profile_id, execute_after, canceled_at, completed_at)
  values (auth.uid(), deadline, null, null)
  on conflict (profile_id) do update set requested_at = now(), execute_after = deadline, canceled_at = null, completed_at = null;
  return deadline;
end;
$$;

revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.mark_my_notifications_read() from public;
revoke all on function public.dismiss_my_notification(uuid) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.block_player(uuid) from public;
revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.list_social_dashboard() from public;
revoke all on function public.update_my_presence(text, uuid) from public;
revoke all on function public.create_game_invitation(uuid, uuid, text) from public;
revoke all on function public.respond_game_invitation(uuid, boolean) from public;
revoke all on function public.submit_player_review(uuid, uuid, integer, text) from public;
revoke all on function public.get_review_eligible_profiles(uuid) from public;
revoke all on function public.report_player_review(uuid, text, text) from public;
revoke all on function public.get_my_received_reviews() from public;
revoke all on function public.update_my_player_review(uuid, integer, text) from public;
revoke all on function public.get_my_account_export() from public;
revoke all on function public.request_account_deletion() from public;
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
grant execute on function public.submit_player_review(uuid, uuid, integer, text) to authenticated;
grant execute on function public.get_review_eligible_profiles(uuid) to authenticated;
grant execute on function public.report_player_review(uuid, text, text) to authenticated;
grant execute on function public.get_my_received_reviews() to authenticated;
grant execute on function public.update_my_player_review(uuid, integer, text) to authenticated;
grant execute on function public.get_my_account_export() to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
