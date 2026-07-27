import React from "react";
import LegalPage from "./LegalPage.jsx";

export default function Community() {
  return (
    <LegalPage title="Community guidelines" updated="July 26, 2026">
      <p>
        Snapcast is a shared tabletop. Treat every player and visitor with the
        same respect you would expect at an in-person game night.
      </p>
      <h2>Expected conduct</h2>
      <ul>
        <li>Be welcoming, patient, and clear about table expectations and deck power.</li>
        <li>Respect names, pronouns, boundaries, and a host’s reasonable table rules.</li>
        <li>Use reviews for honest firsthand feedback about a shared game, not retaliation.</li>
      </ul>
      <h2>Not allowed</h2>
      <ul>
        <li>Harassment, threats, hate speech, discriminatory conduct, or sexual content directed at another participant.</li>
        <li>Impersonation, doxxing, sharing private game details, or recording people without permission.</li>
        <li>Spam, room-code probing, invitation abuse, review manipulation, brigading, or knowingly false reports.</li>
        <li>Using chat, camera, microphone, profile, deck labels, or game names to share illegal or abusive content.</li>
      </ul>
      <h2>Hosts, blocks, and reports</h2>
      <p>
        Hosts may remove participants and room-mute visitors. Any signed-in
        player may block another player. Blocking removes the social
        relationship and stops future requests, invitations, reviews, and
        presence sharing between those accounts.
      </p>
      <p>
        Reports are evidence for review, not proof by themselves. Moderation
        decisions should consider context, repeat behavior, retaliation, and
        coordinated abuse. People affected by a moderation decision may ask
        for an appeal through the project’s support channel.
      </p>
      <h2>Reviews</h2>
      <p>
        Reviews are private to the reviewed player in the initial release.
        Keep comments about the verified shared game, sportsmanship, or deck
        experience. Do not include contact information or sensitive personal
        details.
      </p>
      <h2>Enforcement</h2>
      <p>
        Snapcast may remove content, limit features, suspend accounts, or
        preserve relevant evidence when necessary to protect participants or
        investigate abuse. Severe or repeated conduct may result in permanent
        removal.
      </p>
    </LegalPage>
  );
}
