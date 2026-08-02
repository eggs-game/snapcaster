# Accounts, profiles, and game history plan

**Status:** All delivery phases now have a local implementation on
`account-plan`. Production provider configuration, migration rollout, live
authorization testing, alert configuration, a witnessed backup restore, and
qualified policy review remain launch blockers.

This is the living product plan for giving Snapcast players durable profiles
and Commander game history. Update it whenever a product decision is made so
the plan is easier to follow than a long chat thread.

## Goal

Let a player build a Snapcast profile that remembers their Commander games
without making account creation a requirement to join a game.

Profiles should eventually show:

- Overall wins, losses, draws, and win rate.
- Record with each commander and legal partner pairing.
- Record against other Snapcast players.
- Record against opposing commanders.
- Match history: when a game happened, who played, commanders, result, and
  how a player lost when applicable.
- Feedback from people they played with, using a 1–5 star rating and optional
  comments about the game experience or deck.

Profiles are clickable wherever a signed-in player appears in Snapcast—for
example, a public game listing, a completed game, chat, or a game seat.

Each signed-in player also has a private **My Profile** area for editing their
own information, saved preferences, and personal commander library.

Signed-in players can also build a mutual **Friends** list for presence and
direct game invitations.

## Decisions made

| Area | Decision |
| --- | --- |
| First account provider | Discord only. |
| Guest play | Stays available; no account is required to join a game. |
| Landing page | Keep the main page focused on **Join a game** and **Create a game**, add scannable tiles for joinable public games, and keep **Sign in with Discord** in the top header. |
| Game visibility | Creating a game requires choosing **Private** or **Public**. |
| Public games | Show public lobbies and live games on the home page and in full discovery views. Lobbies support player or visitor entry; live games support visitor entry only. |
| Game discovery pages | Separate public **Game Lobbies** from **Live Games**. Lobbies allow player or visitor entry; live games allow new arrivals to join only as visitors. |
| Game management | The game creator controls when the game starts, may remove players or visitors, may mute visitors room-wide, may end the game and choose the winner, and may restart the table. |
| Friends | Use mutual friend requests for online presence and direct in-app game invitations. |
| Review prompt | After an explicit leave or a completed game, offer reviews only for eligible players the user has never reviewed before; a 4–5 star review may offer a friend request. |
| Product styling | All account, lobby, live-game, review, and social surfaces reuse Snapcast’s existing design-system components and visual language. |
| Policies | Update and review the privacy policy, terms, and community/moderation rules before these account and public-game features ship. |
| Notifications | Add a profile notification center with unread indicators for friend requests and direct game invitations. |
| Security model | Enforce ownership and permissions in Supabase with database grants, Row Level Security, trusted server-side functions for sensitive mutations, rate limits, and auditable moderation—not only in the client UI. |
| Profile visibility | A signed-in player has a clickable public profile with their gameplay stats. Private reviews, email, and detailed account information stay private. |
| Discord data | Request `identify` and `email` scopes. Use the stable Discord ID, username/display name, avatar, and—when Discord provides it—email to establish the Snapcast profile. |
| Email | Collect the email returned by Discord OAuth for the Snapcast account; clearly state this in the sign-in consent copy and let players manage email communications separately. |
| Commander pairs | Store each commander separately; creature partners need independent commander-damage tracking and match statistics. |
| Result capture | Use an explicit end-game confirmation flow; never rely only on automatic loss detection. |
| Timing analytics | Track total game duration and each player's turn durations so profiles can show timing by game and by commander. |

## Account experience

### Landing and game creation

The landing page stays game-first rather than account-first:

- The top header includes a clearly labeled **Sign in with Discord** button so
  returning or account-minded players can sign in before joining or creating.
- The header button is secondary to **Join a game** and **Create a game** and
  never becomes a sign-in wall.
- After sign-in, the same header position becomes the player's profile/account
  control rather than continuing to show the Discord sign-in button.
- **Join a game** takes someone to an invite/link or public-game join flow.
- The home page also shows a section of currently joinable public-game tiles
  beneath the primary actions. Lobby tiles include **Join as player** and
  **Join as visitor**; live tiles include **Watch as visitor**. None requires
  an account.
- **Create a game** asks for its visibility before the game starts:
  - **Private** creates an invite-only game link.
  - **Public** makes the game discoverable on the **Games** page.
- Neither choice requires a Snapcast account.

### Sign-in and account prompt

The first version should not put a sign-in wall in front of joining or
creating. A guest completes the normal device/video setup first. Once their
video preview is working, show a single dismissible modal if they are not
signed in:

> **Track your games and stats**
> Sign in with Discord to save this game's result, build your Commander
> record, and see your stats over time.

The modal actions are:

- **Continue with Discord** — completes OAuth, then returns the player to the
  already-prepared game flow.
- **Not now** — continues as a guest with no penalty or repeated interruption
  during that game.

The prompt should appear only after video setup because the immediate value is
clear: the player has already done the work to start a game, and sign-in can
save the game they are about to play. It should not prevent them from entering
or participating in a game.

Discord sign-in creates or restores a Snapcast profile. The player can choose
a Snapcast display name and seat color; Discord name and avatar are helpful
defaults, not permanent requirements. The OAuth request also asks for the
optional `email` scope so Snapcast can associate Discord-provided email with
the profile when one is available.

### Guests

Guests continue to play exactly as today. Their games are not part of a
durable personal record until they sign in. A valid membership capability can
claim the guest seat and its recent game records for 48 hours after Discord
sign-in; it cannot claim anyone else’s seat.

## Game data to capture

One completed game record should include:

- Start and end timestamps.
- Every participant and whether they used a Snapcast account or were a guest.
- Every selected commander, with partner commanders stored as separate rows.
- Player result: win, loss, draw, conceded, or unknown.
- Loss reason when relevant: life total, commander damage, poison, concede,
  or manually specified.
- A final snapshot of life, poison, and commander-damage totals.
- Total game duration, derived from the official start and end timestamps.
- An ordered turn timeline with the active player, commander selection,
  turn number, start time, end time, and elapsed active duration.
- Elimination time and cause, persisted when the player marks themselves out
  and reconciled with the host's final life, poison, and Commander-damage
  snapshot when the game ends.
- Optional notes in a later release.

Game events can remain useful for live play, but profile records should be
derived from the final game snapshot rather than mutable running totals.

## Game and turn duration analytics

Snapcast should measure how long games last and how long each player's turns
take. Timing begins only after the game owner selects **Start game**, so lobby
setup and waiting for players do not inflate the result.

### Turn timing rules

- A turn begins when the active-player state moves to a player.
- A turn ends when play passes to the next eligible player or the game ends.
- Record the player, commander or legal commander pair used in that game,
  turn number, start timestamp, end timestamp, and elapsed duration.
- Treat duplicate pass-turn events and reconnect retries idempotently so one
  turn cannot be recorded twice.
- A temporary disconnect does not silently end a turn. If the room later adds
  an owner-controlled pause, paused time must be stored separately and
  excluded from active-turn duration.
- Restarting the table closes or discards any unfinished turn only after the
  current game record has been preserved through the normal end or unresolved
  flow.

### Statistics and profile views

For each completed game, show:

- Total game length.
- Each player's total active-turn time, turn count, average turn length, and
  longest turn.
- A turn-by-turn timeline for participants when detailed game history is
  available.

For a player's profile, derive:

- Average and median turn length across all completed games.
- Average and median turn length for each commander or legal commander pair.
- Average total turn time per game and average game length.
- A recent-game timing view so someone can compare their turns within one
  specific game.

Use finished-game events as the source of truth rather than incrementing
mutable lifetime counters. Public profiles may show aggregates, but the
detailed turn timeline should be visible only to that game's participants
unless the player explicitly chooses broader visibility.

## Public game discovery: Game Lobbies and Live Games

Public games need two dedicated discovery views so it is immediately clear
whether someone can still take a player seat or can only watch:

- **Game Lobbies** lists public games that have not started.
- **Live Games** lists public games that have started and are available to
  watch.

These may be separate routes or clearly separated views within **Games**, but
each needs its own shareable URL and preserved filters. The home page should
show a useful selection from both views, with clear **Lobby** or **Live**
status, while **View all games** opens the appropriate full directory.

Every public game tile should make the important decision information visible
at a glance:

- Game name.
- Bracket.
- Current and maximum seats, with games limited to **2–6 players**.
- Chosen commanders for every seated player, including partner commanders
  when relevant.
- Whether player seats are still open.
- Current state: **Lobby** or **Live**.
- In a lobby, separate **Join as player** and **Join as visitor** actions.
- In a live game, a single **Watch as visitor** action.

Commander presentation is a first-class part of the listing, not secondary
metadata. A player should be able to tell what decks are already at the table
before joining. Private games never appear in this directory.

### Game Lobby page

Each public game that has not started has a dedicated lobby page. It shows the
game name, bracket, host, 2–6 player capacity, open seats, current players,
selected commanders, and current visitors.

- A new arrival chooses **Join as player** or **Join as visitor** before
  completing the corresponding device setup.
- **Join as player** reserves one of the game's 2–6 player seats and continues
  through player device setup, commander selection, and game controls.
- **Join as visitor** does not consume a player seat and continues through
  visitor audio setup.
- Once the owner starts the game, the lobby becomes the game’s Live Game page.
  The server stops accepting new player-seat joins immediately, even if a
  stale browser still displays the old lobby action.
- Existing seated players remain players across the transition. Existing
  visitors remain visitors.

### Game Lobby filters

Bracket is a primary filter and must be visible without opening an advanced
filter drawer. The lobby directory should support:

- Bracket.
- Open player seats.
- Current player count / desired table size.
- Game name or commander search.

Filters should be reflected in the URL so a filtered lobby list can be
refreshed or shared. Empty states should explain which filters are active and
offer a one-click reset.

### Live Game page

Every public game that has started has a dedicated watch page. It shows the
same game identity, bracket, commanders, participants, live video grid, chat,
and visitor-safe read-only game information.

- New arrivals may only select **Watch as visitor**. They cannot take or
  reclaim a player seat through the public Live Games directory.
- Visitors continue through visitor audio setup and can watch, listen, use
  chat, inspect and look up cards, and view commander damage read-only.
- Visitors cannot modify life totals, commander damage, turn order, player
  settings, or other game state.
- The Live Games directory should show current visitor count and whether the
  room is accepting additional visitors.
- “Any live game” means any **public** live game. Private live games remain
  accessible only through an authorized invite or scoped link.

### Joining from a public-game tile

- Both paths remain available to guests and signed-in accounts. The normal
  post-device-setup account prompt can still explain the benefits of signing
  in without blocking entry.
- When player seats are full, the tile disables **Join as player** but may
  continue offering **Join as visitor** while the game permits visitors.
- When the game is live, the tile removes **Join as player** entirely and
  offers only **Watch as visitor**.
- The tile and server must re-check capacity and permissions during join so a
  stale home-page listing cannot overfill a game or bypass visitor rules.

## Game Management for the game creator

The game creator gets an owner-only **Game Management** panel. It shows every
current player and visitor in separate participant tiles and provides the
controls needed to run the table. These powers belong to the current game
owner and must be authorized by the server, not inferred from whether the
buttons are visible.

### Start the game

- The owner explicitly selects **Start game** when everyone is ready.
- Starting records the official game start time and locks in the participants
  who are present for the initial game record.
- Players and visitors can see that the game has started, but cannot trigger
  the action themselves.
- Starting is idempotent: repeated clicks or network retries cannot create
  duplicate starts or game records.

### Manage participants

- The owner can remove any player or visitor from the room.
- Removing someone immediately revokes their room membership, media access,
  Realtime subscriptions, private invitation authorization, and ability to
  reconnect into the same seat without a new valid invitation.
- The removed participant sees a clear message that the game owner removed
  them; do not mislabel the action as a connection failure.
- The action requires a confirmation step and records who performed it, who
  was removed, and when.
- The owner cannot accidentally remove themselves with the same action. Owner
  transfer or owner departure needs a separate explicit flow.

### Mute visitors for the room

- The owner can mute or unmute any visitor individually.
- A room-muted visitor cannot transmit microphone audio to anyone in the game,
  even if their own microphone control says it is enabled.
- The mute is enforced by room authorization and receiving clients, not just
  by hiding a local audio control.
- Everyone can see that the visitor was muted by the game owner. The visitor
  retains chat and other visitor permissions unless they are separately
  removed or blocked.
- Players are not included in this owner mute control for the first release;
  this requirement is specifically for visitor audio.

### End the game and choose the winner

- The owner can select **End game** from Game Management.
- The end-game flow asks the owner to choose the winner, declare a draw, or
  mark the result unresolved.
- It pre-fills players already marked out and their recorded loss reasons.
- Ending the game requires confirmation, records the official end time, and
  creates the proposed finished-game snapshot.
- Other signed-in participants receive the normal correction window before
  the result becomes final. Owner status does not allow someone to silently
  rewrite another participant's record.

### Restart the table

- The owner can select **Restart game** to prepare the same room for another
  game.
- Restart requires a clear confirmation because it changes shared game state.
- Restart returns every player's life to the configured starting total and
  resets poison and commander-damage totals.
- Restart clears every player's commander and partner selection so each player
  chooses their commanders for the new game.
- Restart clears the prior turn/active-player state and returns the room to a
  not-started state. It does not remove participants, friendships, chat
  history, or saved profile commanders.
- If the current game has already started, restart first preserves it as an
  ended, unresolved game or runs the normal end-game flow. It must never erase
  an in-progress or completed historical record.
- The restart operation is transactional and idempotent so a retry cannot
  create multiple games or partially reset the room.

## Post-game player reviews

After an explicit **Leave game** action or after the game result is finalized,
show each signed-in participant a dismissible review popup for eligible players
they actually played with.

- A 1–5 star rating.
- An optional written comment about the game experience, sportsmanship, or
  deck experience.
- One review per reviewer/reviewed-player relationship, editable for a short
  window from profile or game history.

### Prompt timing and eligibility

- Trigger the popup after a deliberate **Leave game** action and after the
  normal end-game flow. Do not trigger it for a refresh, crash, temporary
  connection loss, or automatic reconnect.
- The popup must never block someone from leaving. Include **Maybe later** and
  close actions.
- Include only other signed-in players who shared a verified player seat in
  that game and whom the current user has never reviewed before.
- Exclude the current user, visitors, guests without a durable profile,
  blocked players, and anyone the user has already reviewed in an earlier
  game.
- If there are no eligible players, do not show an empty popup.

### Review-to-friend flow

After a user submits a 4- or 5-star review, offer **Add friend** for that
player. This sends a normal mutual friend request; it does not add the player
silently. Hide the action when the players are already friends, a request is
already pending, or either player has blocked the other. Review submission and
friend-request submission are separate actions, so the review succeeds even
if the user dismisses the friend suggestion.

Reviews should be deliberately separate from match results: they are feedback
about playing with a person, not proof that someone won or lost. A review
submitted during an early departure remains tied to that verified shared game
session. Reviews should be private to the reviewed player at first—do not make
a public reputation score or public comments part of the first release.
Include report, block, and moderation tools before considering any broader
visibility.

## Ending a game

Use a short end-game confirmation flow that starts with a player-level
elimination action instead of asking everyone to complete a large result form.

### In-game elimination action

Give every player a clear **I’m out** button in their own game controls. It
opens a compact sheet asking how they left the game:

- Life total reached 0.
- Commander damage.
- Poison.
- Conceded.
- Other / not sure.

When relevant, Snapcast pre-fills the likely answer from live game state. The
player can correct it before confirming. Confirming marks that player as out,
records their loss reason, and posts a concise system update to the table. It
does not immediately end a multiplayer game while other players remain.

### Finishing the table

1. A player starts **End game**.
2. Snapcast pre-fills eliminated players and their recorded loss reasons.
3. The remaining player or players submit the winner, draw, or unresolved
   outcome.
4. Participants receive a correction window before the result becomes final.
5. Write a finished-game record and calculate profile statistics from it.

### Open decision

**Decided:** one player submits the result and other participants receive a
24-hour correction window. A pending correction stops automatic finalization
until it is resolved.

- **Recommended:** one player submits the result; others receive a correction
  window. This is fast for casual games and avoids a missing player blocking
  everyone.
- Require every player to confirm before the game is recorded. This has
  stronger agreement but more friction.

## Statistics model

Compute statistics from finished game records instead of incrementing stored
counters. That makes corrections safe and keeps every view consistent.

Initial views:

- Overall record.
- Record by commander and commander pair.
- Record versus a named Snapcast profile.
- Record versus an opposing commander.
- Game length and personal turn-time statistics overall and by commander.
- Recent match history.

## Clickable player profiles

Clicking a signed-in player opens their Snapcast profile. The public profile
should show the information that helps someone understand who they may play
with:

- Display name and avatar.
- Overall record, wins, losses, draws, and win rate.
- Commander record and legal partner-pair record.
- Opponent and commander matchup summaries.
- Recent completed games, subject to player privacy settings.

Profiles should be reachable from the Games page, player seats, chat, and
finished-game records. Guests do not get a public profile; show them as
**Guest** instead.

## My Profile and saved commanders

The owner-facing **My Profile** page is separate from the public stats page.
It should let a player:

- Edit their Snapcast screen name.
- Set preferred game-entry settings, such as preferred camera/microphone and
  other non-sensitive defaults that can be applied when joining a game.
- Add, remove, and organize their commander decks.
- Store a commander plus its legal partner, when applicable, as a single
  selectable deck entry.

When a signed-in player joins or creates a game, the commander picker should
offer their saved commanders first, while still allowing a card search for an
unsaved commander. Selecting a saved deck pre-fills the commander (and legal
partner) into the game; it never locks the player into that choice.

## Friends, presence, and direct invitations

Friends are a mutual relationship: a player sends a request from another
player's profile, and the other player accepts or declines. No one is added
silently just because they shared a game.

The **Friends** area should let a signed-in player:

- See friends who are online, in a game, or offline.
- Open a friend's profile.
- Send a direct invitation to a private or public game they are creating or
  currently hosting.
- Accept or decline incoming friend requests and game invites.
- Remove a friend or block a player.

Presence should be privacy-aware. Start with clear statuses—**Online**, **In a
game**, and **Offline**—and add an invisible / appear-offline setting before
shipping. A direct game invite should create an in-product notification and a
single-use or scoped join action; it should not reveal a private game broadly.

### Profile notifications

Every signed-in player needs a notification center accessible from their
profile or account menu. Show an unread badge when action is waiting, without
interrupting the game they are currently playing.

The first notification types are:

- **Friend request:** show who sent it, link to their profile, and provide
  **Accept** and **Decline** actions.
- **Friend request accepted:** confirm that the players are now friends and
  provide a shortcut to their profile.
- **Direct game invitation:** available only between existing friends; show
  who invited them, the game name, whether it is public or private, current
  seats, and **Join** and **Decline** actions.

Notifications should update in real time when Snapcast is open and remain in a
short notification history until dismissed or expired. Game invitations expire
when the game ends, fills up, or the host cancels the invitation. Notification
preferences should eventually allow players to mute sounds while retaining
visual unread badges.

Later views:

- Time-range filters.
- Format/game-type filters.
- Head-to-head history.
- Commander matchup matrix.

## Privacy and corrections

- Public profiles expose gameplay statistics, not account contact details.
- Email, Discord tokens, private review feedback, and account-management data
  are never public profile fields.
- Guests are shown as **Guest** in another player’s history unless they later
  choose to claim the game.
- A player can hide a game from their own profile without changing other
  participants’ records.
- Keep a correction path for wrong commanders, outcomes, and loss reasons.
- Do not expose detailed opponent history publicly by default.

## Safety, security, and abuse prevention

Accounts, profiles, public games, reviews, friends, invitations, presence, and
notifications introduce persistent personal data and social actions. These
features must not ship until the controls below are implemented and tested.
Hiding a control in the interface is never an authorization boundary.

### Authentication and account security

- Use Supabase Auth with Discord's authorization-code OAuth flow.
- Validate OAuth `state`, use exact allow-listed redirect URLs, and request
  only the `identify` and optional `email` scopes.
- Keep the Discord client secret, provider access token, refresh token, and
  Supabase service-role key out of browser code, logs, analytics, and URLs.
- Use short-lived sessions with secure refresh behavior. Signing out should
  invalidate the local session and remove private cached profile data.
- Treat the Supabase user ID as the account owner. Discord IDs are linked
  identities and must never be accepted from the client as proof of ownership.
- Prevent account linking or email changes without recent authentication.
- Protect production Supabase, Discord, Vercel, and DNS administrator accounts
  with MFA and least-privilege access.

### Database authorization

- Enable Row Level Security on every persistent table and private Storage
  bucket before granting browser access.
- Pair RLS with explicit database grants; do not rely on RLS alone or broad
  default privileges.
- Write a per-table access matrix covering anonymous visitors, signed-in
  players, game participants, game hosts, record owners, reviewers,
  moderators, and service processes.
- Enforce ownership and relationship checks on every request. A user must not
  be able to read or mutate another account by substituting a profile, game,
  review, friendship, invitation, or notification ID.
- Perform sensitive multi-record actions—accepting a friend request, joining
  from an invitation, finalizing a game, applying a correction, blocking a
  player, or moderating content—through transactional database functions or a
  trusted server endpoint.
- Never expose the Supabase service-role key to the client. Realtime
  subscriptions must obey the same authorization rules as ordinary reads.

### Friends, blocks, invitations, and presence

- Friend requests are sender/recipient scoped, unique while pending, and
  rate-limited. Prevent self-requests, duplicate requests, request loops, and
  automated request spam.
- Accepting or declining a request must only be possible for its intended
  recipient. Removing a friendship can be initiated by either friend.
- Blocking takes precedence everywhere. A blocked player cannot send friend
  requests, invitations, reviews, direct messages, or presence updates to the
  blocker, and the relationship must not be inferable through notifications
  or search results.
- Direct game invitations are allowed only between current friends. Use
  random, scoped, single-use invite tokens that expire when declined,
  canceled, used, the game fills, or the game ends.
- A private-game invitation must not make the game discoverable or grant
  access to anyone other than its intended recipient. Forwarding its URL must
  not transfer that authorization.
- Presence defaults to the least revealing useful state. Respect
  **Appear offline**, do not expose precise activity timestamps, and do not
  reveal private-game details through an **In a game** status.

### Game-owner moderation powers

- Start, kick, room-mute, end, winner selection, and restart actions require
  the current server-authorized owner role on every request.
- Kicking a participant revokes active room access and reconnect credentials;
  muting a visitor is enforced room-wide rather than trusting the visitor's
  client.
- All owner moderation and lifecycle actions are rate-limited and recorded in
  an audit trail without exposing sensitive media or chat contents.
- Destructive shared-state actions use confirmation and idempotency keys.
  Restart preserves game history and cannot partially reset the room.
- Define an owner-transfer and owner-disconnect policy before implementation
  so the room cannot become permanently unmanaged or grant ownership to an
  arbitrary reconnecting client.

### Public profiles and public games

- Publish only fields explicitly classified as public. Email, Discord tokens,
  linked-account details, notification contents, private reviews, block lists,
  private-game history, device preferences, and precise presence remain
  private.
- Give players controls for recent-game visibility and presence visibility.
  Do not expose detailed opponent history publicly by default.
- Prevent profile enumeration and scraping with pagination, sensible search
  limits, request throttling, and monitoring.
- Sanitize and length-limit display names, game names, review comments, deck
  labels, and any other user-authored text. Render text as text, never trusted
  HTML.
- Rate-limit public-game creation and updates. Hosts may edit or close only
  games they control; server-side rules enforce 2–6 player capacity and reject
  stale or over-capacity joins.
- Private games never appear in public listings, search results, profile
  activity, or unauthenticated APIs.

### Game records, results, and corrections

- Only verified game participants may submit or dispute that game's result.
  Guests cannot later claim another person's seat without a secure,
  time-limited claim flow.
- Store finished records as append-only snapshots. Corrections create an audit
  entry recording the actor, time, reason, and before/after values.
- Validate commanders, participants, loss reasons, seat ownership, and result
  transitions on the server. Do not trust client-calculated statistics.
- Make result-finalization and correction operations idempotent so retries
  cannot create duplicate games, wins, reviews, or notifications.
- Define dispute and correction windows, what happens when players disagree,
  and which actions require moderator review.

### Reviews, reporting, and moderation

- Permit one review per reviewer/reviewed-player relationship, only when both
  signed-in players actually shared a verified player seat in a game. The
  review popup never re-prompts for that relationship in later games.
- A player cannot review themselves. Enforce the edit window and uniqueness in
  the database, not only in the interface.
- Keep ratings and comments private to the reviewed player in the first
  release. Do not publish an aggregate reputation score until moderation,
  appeals, brigading prevention, and privacy consequences have been reviewed.
- Provide report, block, remove, appeal, and moderator-audit workflows before
  enabling written reviews.
- Rate-limit reports and reviews; detect duplicate, coordinated, or retaliatory
  abuse without automatically treating a report as proof of wrongdoing.
- Give moderators only the minimum data needed for the case and log all
  moderation actions. Never expose a reporter's identity to the reported
  player by default.

### Notifications and messaging safety

- Notifications are readable and dismissible only by their recipient.
  Notification payloads contain stable internal references rather than
  trusting action URLs supplied by another user.
- Re-authorize every notification action when clicked. An old notification
  must not accept an expired request or join a full, ended, canceled, or newly
  private game.
- Deduplicate notifications and enforce per-sender limits. Blocking or
  removing a player cancels their pending actionable notifications.
- Do not include private game details, email addresses, review text, or other
  sensitive content in push/email previews without explicit consent.
- Email communication is opt-in separately from account creation. Include
  unsubscribe controls and do not treat Discord-provided email as marketing
  consent.

### Data privacy and lifecycle

- Maintain a data inventory classifying every account field as public,
  participant-only, owner-only, moderator-only, or operational.
- Collect only the data needed for the stated feature. Do not collect a phone
  number through Discord or elsewhere for this release.
- Provide account-data export and account deletion. Define how deletion
  anonymizes historical games shared with other participants while removing
  contact information, OAuth links, presence, notifications, saved
  preferences, and private review content.
- Define retention periods for notifications, expired invitations, presence
  events, audit logs, reports, and deleted accounts. Automatically purge data
  when its retention period ends.
- Encrypt data in transit and use provider-managed encryption at rest. Keep
  secrets in managed environment variables and rotate them after suspected
  exposure.
- Do not place tokens, email addresses, private messages, invite secrets, or
  review text in client analytics, error reports, or application logs.

### Rate limits, monitoring, and incident response

- Apply user-, IP-, and relationship-aware rate limits to authentication,
  profile search, friend requests, invitations, notifications, reviews,
  reports, public-game creation, result updates, and account export/deletion.
- Add bot protection where anonymous or authentication endpoints are open to
  automated abuse.
- Keep structured security logs for sign-in anomalies, authorization denials,
  account-link changes, blocks, reports, moderation, result corrections, and
  unusually high request rates. Avoid logging sensitive payloads.
- Monitor failed authorization checks, invitation abuse, scraping patterns,
  review spam, and unusual account activity with actionable alerts.
- Document incident-response ownership, credential rotation, user
  communication, recovery, and evidence-preservation procedures.
- Maintain tested backups and restore procedures for durable account and game
  data.

### Required security verification before launch

- Automated RLS and authorization tests must attempt cross-account reads,
  writes, deletes, Realtime subscriptions, and Storage access for every role.
- Include negative tests for forged profile IDs, friendship IDs, invitation
  recipients, review targets, game participants, host privileges, and
  notification ownership.
- Test blocked-user isolation, private-game non-disclosure, invite expiry,
  race conditions on the last game seat, duplicate submissions, and revoked
  sessions.
- Run dependency, secret, and migration checks in CI. Review Supabase Security
  Advisor findings before each production release involving account data.
- Complete a focused threat-model review and privacy review before opening
  public profiles, public games, written reviews, or direct invitations.

## Product styling and policy updates

All new surfaces in this plan must feel native to the current Snapcast
application. Reuse the existing panel shells, tiles, typography, spacing,
radii, buttons, icon-only controls, tooltips, inputs, empty states, and
responsive behavior documented in the Snapcast design system. New account,
lobby, live-game, review, and friend flows should not introduce a parallel
visual language.

Before launch, have qualified counsel review and update the public-facing
policies for the actual implemented behavior. At minimum, review:

- The privacy policy for Discord account data, email collection, profiles,
  presence, friends, reviews, game and turn history, public listings,
  notifications, telemetry, retention, export, and deletion.
- The terms of service for accounts, eligibility, public games, visitor
  participation, host powers, user content, reviews, moderation, suspension,
  and acceptable use.
- Community and review guidelines covering harassment, discriminatory
  conduct, retaliation, review manipulation, false reports, appeals, and
  enforcement.
- In-product consent and disclosure copy wherever data becomes public or is
  retained after a game.

The implementation plan is not a substitute for legal advice. Policy copy,
consent language, age requirements, and jurisdiction-specific obligations
must be approved before release.

## Delivery phases

### Phase 1 — Discord identity

- **Implemented locally:** shared Supabase client and optional Discord sign-in
  entry points in the home header and post-setup account prompt.
- **Implemented locally:** PKCE authorization-code flow with minimal
  `identify email` scopes, persisted Supabase session handling, guest-game
  restoration after OAuth, and sign-out.
- **Implemented locally:** public profile, private Discord/email, and private
  preference tables with grants, account triggers, and Row Level Security.
- **Implemented locally:** guest play remains available; game creation now
  captures public/private intent and joining offers Player or Visitor.
- **Rollout required:** configure Discord OAuth in Supabase, apply the account
  migration, and add exact production/local redirect URLs.
- **Implemented locally:** **My Profile** supports display-name editing,
  appearance, saved camera/microphone choices, and the appear-offline
  preference. Device choices are refreshed after game entry.
- **Implemented locally:** linked Discord identity and email are browser
  read-only; only the trusted auth trigger can synchronize them.
- **Rollout required:** finish the redirect allowlist rollout, apply the
  migration, and verify production Discord sign-in.

### Phase 1.5 — Public Games directory

- **Implemented locally:** dedicated **Game Lobbies** and **Live Games** views,
  shareable URL filters, home-page lobby cards, and public/private game
  creation.
- **Implemented locally:** capability-backed room creation and joining,
  transactional 2–6 player capacity enforcement, separate visitor limits,
  private-game non-disclosure, and stale-listing expiry.
- **Implemented locally:** private, membership-authorized Realtime topics for
  signed-in and guest players; guest anonymous Auth identities create no
  Snapcast profile, and removal rotates the room epoch to revoke old clients.
- **Implemented locally:** server-enforced host capabilities, capacity checks,
  private-game non-disclosure, relationship rate limits, and stale listing
  expiry. Production abuse dashboards/alerts remain a rollout task.
- **Implemented locally:** public lobby listings show bracket filters, 2–6
  player capacity, open seats, and visible commander selections.
- **Implemented locally:** live games are listed separately and offer
  **Watch as visitor** as the only new-arrival action.
- Keep private games accessible only through their invite links.

### Phase 2 — Game records

- **Implemented locally:** game sessions, participant and commander snapshots,
  official timing, idempotent turn timelines, outcomes, loss reasons, and a
  24-hour correction window.
- **Implemented locally:** owner-only start, removal, visitor room-mute,
  end/winner, and transactional restart controls with audit entries.
- **Implemented locally:** player-owned elimination/loss-reason announcements,
  winner prefill that excludes eliminated players, a strict 24-hour correction
  window, and moderator-audited correction acceptance or rejection.

### Phase 3 — Personal history

- **Implemented locally:** public profile, recent games, overall and
  Commander/partner-pair records and timing, participant-only per-game turn
  timelines, opponent and opposing-Commander-pair matchups.
- **Implemented locally:** private saved Commander library with trusted
  server-side Oracle validation for legal partner pairs, the same validated
  boundary for runtime selections, and saved-deck selection in game.
- **Implemented locally:** per-game public-history visibility alongside the
  account-wide recent-game privacy preference.

### Phase 3.5 — Friends and invites

- **Implemented locally:** mutual requests, removal, block isolation,
  privacy-aware presence, friend-only expiring invitations, and recipient-only
  notification actions.
- **Implemented locally:** unread notification count in the account header and
  recipient-owned Realtime refresh wiring.
- **Rollout required:** add only `profile_notifications` to the production
  Realtime publication and verify delivery with two accounts.

### Phase 4 — Matchups and refinements

- **Implemented locally:** matchup views, correction storage, public-history
  privacy, private post-game reviews, reporting schema, blocking, account
  export, and delayed deletion requests.
- **Implemented locally:** guest-game claiming, review editing/report and
  appeal UI, a moderator-only report/appeal console, cancelable deletion, and
  daily service-only retention/deletion processing.
- **Documented operations:** rollout order, least-privilege moderator grants,
  live negative authorization tests, monitoring, backup/restore checks, and
  incident response are in `docs/security-operations.md`.
- **Rollout required:** configure production alerts, execute and record the
  live authorization matrix, witness a backup restore, and complete qualified
  privacy/policy review.
- Consider additional sign-in providers only after Discord is working well.

## Implementation safeguards

- Authentication remains optional for game participation.
- Use the Supabase user ID as the internal profile owner; treat Discord ID as
  a linked OAuth identity rather than application authorization everywhere.
- Keep game results append-only with a correction audit trail.
- Do not store Discord access tokens in the browser or expose provider secrets
  in client code.
- Treat the safety, security, abuse-prevention, and launch-verification
  requirements above as release blockers rather than later enhancements.
