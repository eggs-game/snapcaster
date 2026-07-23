import React from "react";
import LegalPage from "./LegalPage.jsx";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="July 23, 2026">
      <p>
        Snapcast is a remote paper Magic: The Gathering table. This policy explains what
        information is handled when you use <a href="https://snapcast.app">snapcast.app</a>,
        and what stays on your device.
      </p>

      <h2>Summary</h2>
      <ul>
        <li>There are no accounts. You pick a display name when you join a game.</li>
        <li>Live camera and microphone streams are peer-to-peer. Snapcast does not record or store your live video.</li>
        <li>Game signaling (room join, life totals, public chat, turn state) goes through Supabase Realtime for the session.</li>
        <li>Card recognition runs in your browser. Optional “Wrong card” reports are the main way images leave your device for our servers.</li>
      </ul>

      <h2>Information we handle</h2>

      <h3>Display name and game settings</h3>
      <p>
        The name you enter is stored in your browser’s local storage so it can be prefilled next time,
        and is shared with other people in your room through signaling. Game name, bracket, and seat
        limit are shared the same way for that session.
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

      <h3>Card recognition</h3>
      <p>
        Recognition (hashing, matching, OCR) runs locally in your browser against a card index we
        host. Card art looked up for results may be loaded from Scryfall’s image hosts.
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
        device. They are not uploaded as a profile.
      </p>

      <h3>Connectivity helpers</h3>
      <p>
        Entering a game may request short-lived TURN credentials from our same-origin API so
        WebRTC can relay when needed. Those requests may be rate-limited (for example by IP and
        room) to reduce abuse. Hosting and CDN providers (such as Vercel) may keep standard
        technical access logs.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>We do not run third-party advertising trackers in the app.</li>
        <li>We do not require an account or email to play.</li>
        <li>We do not use live game video as a training upload unless you explicitly submit a recognition report.</li>
      </ul>

      <h2>Children</h2>
      <p>
        Snapcast is aimed at Magic players generally. It is not directed at children under 13, and
        we do not knowingly collect personal information from children under 13.
      </p>

      <h2>Retention</h2>
      <p>
        Session signaling is ephemeral to the game. Local preferences remain until you clear site
        data. Opt-in recognition reports are kept long enough to review and improve recognition,
        then may be deleted or anonymized. You can clear local data anytime in your browser settings.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Deny camera or microphone permission — you may still be able to join in a limited role, depending on the room.</li>
        <li>Skip recognition feedback — reports are only sent when you choose to submit them.</li>
        <li>Leave a room or close the tab to end live streams and signaling for that session.</li>
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
