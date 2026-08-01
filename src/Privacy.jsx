import React from "react";
import LegalPage from "./LegalPage.jsx";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="July 27, 2026">
      <p>
        Snapcast is a remote paper Magic: The Gathering table. This policy explains what
        information is handled when you use <a href="https://snapcast.app">snapcast.app</a>,
        and what stays on your device.
      </p>

      <h2>Summary</h2>
      <ul>
        <li>Accounts are optional. You can still play as a guest with a per-session display name.</li>
        <li>Guest play uses a pseudonymous authentication identifier to authorize a private game channel, but does not create a Snapcast profile.</li>
        <li>If you sign in with Discord, we receive your Discord identity information and email when Discord makes it available and you authorize that access.</li>
        <li>Live camera and microphone streams are peer-to-peer. Snapcast does not record or store your live video.</li>
        <li>Game signaling (room join, life totals, public chat, turn state) goes through Supabase Realtime for the session.</li>
        <li>Finished games can store participants, commanders, results, final counters, game duration, and turn timing for profiles and personal history.</li>
        <li>Friendships, invitations, presence, notifications, and private reviews are stored only when signed-in players use those features.</li>
        <li>Limited connection diagnostics are recorded so unexpected game drops can be investigated.</li>
        <li>Content-free card-lookup timing metrics are recorded so slow scans and timeouts can be investigated.</li>
        <li>Card recognition runs in your browser. Recent strong results from players and visitors may be shared ephemerally within your room to speed everyone’s repeated lookups.</li>
        <li>Optional “Wrong card” reports are the main way images are stored on our servers.</li>
      </ul>

      <h2>Information we handle</h2>

      <h3>Optional Discord account</h3>
      <p>
        If you choose “Sign in with Discord,” Discord and our authentication provider,
        Supabase, process the sign-in. We request basic identity and email access. We store
        your Discord account identifier, display name, avatar URL, and email when Discord
        provides one. Your email and account preferences are private to your account; your
        display name and avatar may be visible to other Snapcast users.
      </p>
      <p>
        Creating an account is optional. An account supports your profile,
        preferences, saved Commander decks, durable game history, friends,
        invitations, notifications, and private reviews.
      </p>

      <h3>Display name and game settings</h3>
      <p>
        The name you enter is stored in your browser’s local storage so it can be prefilled next time,
        and is shared with other people in your room through signaling. Game name, bracket, and seat
        limit are shared the same way for that session.
      </p>
      <p>
        Supabase issues guests a pseudonymous authentication identifier so
        private room policies can admit and later revoke that membership. It
        is not shown as a public profile and is retained only under the
        operational anonymous-user schedule.
      </p>

      <h3>Camera and microphone</h3>
      <p>
        Players grant camera and microphone access in the browser. Audio and video are sent over an
        encrypted WebRTC connection to the other people in your room — directly when possible, or
        through Cloudflare TURN when a direct path is blocked. TURN relays media temporarily; it is
        not used as a recording store. Visitors join with microphone only.
      </p>
      <p>
        When another player scans a card on your board, their request arrives over the encrypted peer
        channel and <em>your</em> browser photographs its own camera. That still travels peer-to-peer
        for recognition. Capture is never silent: you see who scanned your board.
      </p>

      <h3>Game signaling</h3>
      <p>
        Room codes, presence, life totals, public chat, turns, and similar game state are broadcast
        through Supabase Realtime while the room is active. Private whispers use the encrypted
        WebRTC data channel between the two participants and are not placed on the public room
        broadcast.
      </p>

      <h3>Public games and durable game history</h3>
      <p>
        Public game names, brackets, seat counts, selected commanders, and
        lobby/live status appear in public discovery. Private games do not.
        When a game starts, Snapcast may retain its participants, commanders,
        start and end times, turn durations, result, loss reasons, and final
        life, poison, and commander-damage snapshot. Public profiles show
        aggregates and, when enabled by the player, recent games. Detailed
        personal history and turn timelines remain participant-only.
      </p>

      <h3>Friends, presence, invitations, and reviews</h3>
      <p>
        Signed-in players can store mutual friendships, blocks, short-lived
        presence, direct game invitations, and notifications. Appear offline
        hides presence and current-game status. Post-game ratings and comments
        are private to the reviewed player; report and moderation records are
        limited to authorized reviewers.
      </p>

      <h3>Card recognition</h3>
      <p>
        Recognition (hashing, matching, OCR) runs locally in your browser against a card index we
        host. Card art looked up for results may be loaded from Scryfall’s image hosts.
      </p>
      <p>
        To speed up repeated lookups of the same permanent, a strong result from any player or
        visitor may broadcast its card printing identifier, the temporary room participant whose
        board was scanned, an approximate board position, and a timestamp to the people in your
        current room. Everyone contributes to and benefits from this shared shortlist. Their
        browsers keep a small, short-lived memory of these hints and verify the card against each
        new capture before showing it. Hints are not placed in Chat, are not written to Supabase
        tables or Storage, and disappear when the room or browser session ends.
      </p>
      <p>
        To diagnose slow scans and timeouts, Snapcast records bounded lookup-performance metrics:
        capture, recognition, and worker-stage timings; whether the scan was local or remote; a
        success or failure category; candidate counts; capture payload size; outgoing quality;
        temporary room-scoped participant identifiers; the app build; and a one-way fingerprint
        of the room code. These automatic timing records do not contain the raw room code, display
        names, card identities or results, images, OCR text, device labels, or raw error messages.
        Uploading them happens in the background and is not part of producing the card result.
      </p>

      <h3>Optional recognition reports</h3>
      <p>
        If you use “Wrong card” (or similar) feedback, you send a cropped still, recognition
        diagnostics, and related context (such as room code, display name, and predicted card) to
        our Supabase project so we can improve recognition. Those uploads are opt-in and separate
        from live play.
      </p>

      <h3>Preferences on your device</h3>
      <p>
        Theme preference, video layout, and similar UI choices are kept in local storage on your
        device. If you sign in, supported game-entry preferences may also be saved to your private
        account preferences so they can follow you between devices. While a room is active,
        session storage also keeps a room-scoped participant
        identifier, original seat time, and your player-owned game state so a refresh can restore
        your seat, life, commander, counters, and media-toggle state. Choosing “Leave game” clears
        that active-room recovery data. These values are not uploaded as a profile.
      </p>

      <h3>Connectivity helpers</h3>
      <p>
        Entering a game may request short-lived TURN credentials from our same-origin API so
        WebRTC can relay when needed. Those requests may be rate-limited (for example by IP and
        room) to reduce abuse. Hosting and CDN providers (such as Vercel) may keep standard
        technical access logs.
      </p>
      <p>
        To diagnose unexpected drops, Snapcast records limited connection events such as signaling
        timeouts, browser offline/online transitions, WebRTC failure and recovery, and a participant
        unexpectedly disappearing from room presence. Reports contain temporary participant and
        browser-session identifiers, connection states, visibility/online state, event timing, and
        a one-way fingerprint of the room code. They do not include display names, messages, card
        data, device labels, camera or microphone content, or the raw room code. A short recent
        diagnostic trail is also kept in your browser’s local storage.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>We do not run third-party advertising trackers in the app.</li>
        <li>We do not require an account or email for guest play.</li>
        <li>We do not use live game video as a training upload unless you explicitly submit a recognition report.</li>
      </ul>

      <h2>Children</h2>
      <p>
        Snapcast is aimed at Magic players generally. It is not directed at children under 13, and
        we do not knowingly collect personal information from children under 13.
      </p>

      <h2>Retention</h2>
      <p>
        Session signaling is ephemeral to the game. Local preferences remain
        until you clear site data. Account profiles, preferences, friendships,
        saved decks, and game history remain while the account is active.
        Presence and invitations expire; notifications and operational audit
        data are periodically purged under the service retention schedule.
        Opt-in recognition reports, limited connection diagnostics, content-free lookup timing
        records, and moderation evidence are kept only as long as needed for service improvement,
        review, safety, and appeals, then deleted or anonymized. You can clear local data anytime
        in your browser settings.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Deny camera or microphone permission — you may still be able to join in a limited role, depending on the room.</li>
        <li>Continue as a guest instead of signing in with Discord.</li>
        <li>Skip recognition feedback — reports are only sent when you choose to submit them.</li>
        <li>Leave a room or close the tab to end live streams and signaling for that session.</li>
        <li>Hide recent games or appear offline from My Profile.</li>
        <li>Export your account data or request deletion from My Profile. Shared historical games are anonymized rather than removed from other participants’ records.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        We may update this policy as Snapcast evolves. The “Last updated” date at the top will
        change when we do. Continued use after a change means you accept the updated policy.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: open an issue on{" "}
        <a href="https://github.com/eggs-game/snapcaster/issues" target="_blank" rel="noopener noreferrer">
          the Snapcast GitHub repository
        </a>.
      </p>
    </LegalPage>
  );
}
