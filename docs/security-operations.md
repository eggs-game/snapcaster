# Account launch and security operations

This runbook covers the production-only work for accounts, public games,
durable history, social features, reviews, moderation, retention, and deletion.
The migrations and application code implement the controls; this checklist
turns them on and verifies the deployed system.

## Launch order

1. Back up the Supabase database and record a restore point.
2. Apply every timestamped migration in `supabase/migrations/` in order.
3. Run `scripts/test_account_security.py` and the production build in CI.
4. Configure Discord in Supabase with only `identify email`, add the Supabase
   callback to Discord, and allow exact `https://snapcast.app`,
   `https://snapcaster.vercel.app`, their `/moderation` callback paths, and
   intended local redirect origins.
5. Enable Supabase Anonymous Sign-Ins for guest room authorization. Keep the
   provider IP rate limit enabled, add CAPTCHA before raising that limit, and
   retain the daily maintenance cleanup for anonymous Auth users older than 30
   days. Anonymous identities receive no profile and cannot use account-only
   APIs.
6. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` as server-only Vercel
   variables. Never create a `VITE_` service-role or provider-secret variable.
7. Add `profile_notifications` to the Supabase Realtime publication. No private
   account, review, report, invitation, or history table should be published.
8. Deploy, confirm the GitHub status on the deployed commit, and run the live
   authorization checks below before opening discovery or profiles publicly.

The daily `/api/maintenance` Vercel cron runs retention, finalizes due game
results, processes up to 50 due account deletions, and deletes up to 100
anonymous Auth identities older than 30 days. Vercel supplies
`Authorization: Bearer $CRON_SECRET`; requests without the exact secret fail.
The user-facing `/api/account-delete` route can process a due deletion
immediately after revalidating the signed-in Supabase session.

## Moderator access

`/moderation` is denied unless the signed-in profile has an active row in
`moderator_accounts`. Grant or revoke access only from a service-role process
or the Supabase SQL editor after confirming the target UUID:

```sql
insert into public.moderator_accounts (profile_id, role)
values ('00000000-0000-0000-0000-000000000000', 'moderator')
on conflict (profile_id) do update set active = true, role = excluded.role;

update public.moderator_accounts
set active = false
where profile_id = '00000000-0000-0000-0000-000000000000';
```

Moderator decisions and appeals write append-only `moderation_actions`.
Moderators see only case data needed for the queue; ordinary browser clients
have no table access. Use two people for permanent bans or other enforcement
outside the implemented review-removal workflow.

## Required live authorization checks

Use two normal accounts, one moderator account, and a guest browser:

- Account A cannot read or change Account B’s private identity, preferences,
  saved decks, notifications, reviews, invitations, history, or reports.
- A guest can join with a valid capability but cannot call account RPCs.
- A removed membership is rejected from the rotated private Realtime topic,
  even if a modified client keeps the old room code and channel connection.
- A private room cannot be discovered by code probing or public directory
  queries. A full room cannot exceed its player/visitor capacity under
  concurrent joins.
- A non-owner cannot start, end, restart, remove, mute, invite, or claim a
  healthy owner’s game. A removed membership stops appearing in official
  clients.
- Direct browser inserts/updates cannot create a saved Commander deck.
  Runtime and saved-deck choices reject a non-Commander or illegal partner,
  and forged heartbeat/Realtime Commander fields never enter the official
  membership snapshot or durable game record.
- A review requires a verified shared durable game, cannot target self, and is
  unavailable across a block. Only the reviewed player can report it.
- Only a listed moderator can load `/moderation` or resolve a report, appeal,
  or disputed game correction.
- Account export contains the signed-in account only. Deletion can be canceled
  during the seven-day delay; after processing, shared history retains
  “Deleted player” but identity, contact, social, and review data is gone.
- Revoking a session immediately prevents authenticated RPC and Realtime
  notification access.

Record results and Supabase Security Advisor output with the release.

## Monitoring and alerts

Alert on repeated authorization errors, rate-limit spikes, public-room creation
bursts, invitation/review/report spikes, maintenance failures, and growing due
deletion queues. Vercel logs must not include bearer tokens, emails, invite
capabilities, private review text, or report details. Supabase logs should keep
stable request/action identifiers rather than sensitive payloads.

Check daily:

- `/api/maintenance` returned 200 or 207 and its failed deletion count is zero.
- Database size, Realtime connections, authentication error rate, and API
  latency remain within expected ranges.
- No new Supabase Security Advisor findings affect exposed tables/functions.

Check weekly:

- Open moderation and correction queues are moving.
- Rate-limit distributions do not suggest scraping or room-code probing.
- A test restore from the latest managed backup succeeds in an isolated
  project, with RLS and function grants intact.

## Incident response

1. Preserve relevant Vercel/Supabase audit logs without copying sensitive
   payloads into chat or issue trackers.
2. Disable the affected feature or moderator account; for a broad incident,
   disable Discord sign-in and public discovery while guest private games are
   evaluated separately.
3. Rotate the affected provider, service-role, cron, TURN, or analytics secret
   and redeploy. Revoke active sessions when authentication data may be
   exposed.
4. Determine affected accounts, data classes, and time range. Restore only
   from a tested backup and replay reviewed migrations in order.
5. Notify affected users and regulators when required by the approved legal
   policy, then document cause, containment, recovery, and follow-up controls.

Security incidents, restore failures, and destructive moderator actions require
a second reviewer before the incident is closed.
