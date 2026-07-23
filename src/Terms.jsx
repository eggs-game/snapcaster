import React from "react";
import LegalPage from "./LegalPage.jsx";

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="July 23, 2026">
      <p>
        These terms cover your use of Snapcast at{" "}
        <a href="https://snapcast.app">snapcast.app</a>. By using the service, you agree to them.
        If you do not agree, do not use Snapcast.
      </p>

      <h2>What Snapcast is</h2>
      <p>
        Snapcast is an unofficial fan project that helps people play paper Magic: The Gathering
        remotely, including camera/microphone sessions and in-browser card recognition. It is
        provided as early alpha software and may change or break without notice.
      </p>

      <h2>Not affiliated with Wizards of the Coast</h2>
      <p>
        Snapcast is not affiliated with, endorsed by, or sponsored by Wizards of the Coast,
        Hasbro, or Scryfall. Magic: The Gathering and related names and marks are property of
        Wizards of the Coast. Card data and images are © Wizards of the Coast and are used via
        Scryfall under the{" "}
        <a href="https://company.wizards.com/fancontentpolicy" target="_blank" rel="noopener noreferrer">
          Wizards Fan Content Policy
        </a>
        . See also{" "}
        <a href="https://scryfall.com/docs/api" target="_blank" rel="noopener noreferrer">
          Scryfall’s API guidelines
        </a>.
      </p>

      <h2>Eligibility and conduct</h2>
      <ul>
        <li>Use Snapcast only in ways that are lawful where you are.</li>
        <li>Do not harass other players, share illegal content, or attempt to disrupt rooms or infrastructure.</li>
        <li>Do not try to guess or scrape room codes, exhaust TURN credentials, or probe other people’s games.</li>
        <li>A room code is the access key to that table — treat it like an invite link and share it only with people you trust.</li>
      </ul>

      <h2>Camera, microphone, and captures</h2>
      <p>
        When you join as a player, you may grant camera and microphone access. Other players in
        your room can see and hear what you share. Peers can request a still from your camera to
        identify a card; that request is visible to you. Do not point your camera at anything you
        are not willing to show the table, and do not join a room with people you do not trust with
        that access.
      </p>

      <h2>No accounts</h2>
      <p>
        Snapcast does not provide user accounts. Display names are chosen per session and are not
        verified. Anyone with a room code can join according to that room’s role limits.
      </p>

      <h2>Recognition and feedback</h2>
      <p>
        Card identification is best-effort. Results can be wrong. Optional “Wrong card” reports
        may upload crops and diagnostics so recognition can improve; only submit reports you are
        comfortable sharing. See the{" "}
        <a href="/privacy">privacy policy</a> for details.
      </p>

      <h2>Availability</h2>
      <p>
        The service depends on third parties (including hosting, signaling, TURN, and card image
        hosts). We do not guarantee uptime, latency, or recognition accuracy. Features may be
        added, removed, or rate-limited at any time.
      </p>

      <h2>Disclaimer of warranties</h2>
      <p>
        Snapcast is provided “as is” and “as available,” without warranties of any kind, whether
        express or implied, including merchantability, fitness for a particular purpose, and
        non-infringement, to the fullest extent permitted by law.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the operators of Snapcast are not liable for any
        indirect, incidental, special, consequential, or punitive damages, or any loss of data,
        gameplay, or goodwill, arising from your use of the service.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the product evolves. The “Last updated” date will change when
        we do. Continued use after a change means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: open an issue on{" "}
        <a href="https://github.com/eggs-game/snapcaster/issues" target="_blank" rel="noopener noreferrer">
          the Snapcast GitHub repository
        </a>.
      </p>
    </LegalPage>
  );
}
