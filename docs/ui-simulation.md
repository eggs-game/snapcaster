# Practice with four players on one computer

The local practice table uses the real lobby and game interface with three
simulated opponents. It needs no public room, invited friend, camera permission,
or Supabase write. It is available only on `localhost`, `127.0.0.1` and IPv6
loopback. Production builds remove `mock-data.local.json`, and the transport
itself rejects a non-loopback hostname.

Prepare the ignored fixture and run a local source preview:

```sh
bash scripts/start_ui_simulation.sh
```

The launcher uses your installed Node or this workspace's bundled Codex runtime.
Set `SNAPCAST_NODE` to choose another executable, or `SNAPCAST_UI_PORT` to use a
different port. Dependencies must already be installed. Stop it with Ctrl+C.

Open the printed practice URL, continue through setup, and join
as a player. The table starts in the lobby with you as host and Maya, Drew and
Sam as the other seated players. Start the game from Game management. Each tile
contains a local canvas video stream with existing supplied card photos; clicking
an opponent's card creates a JPEG using the same `cropGeometry` as production and
feeds the normal card-recognition path. The left, middle and right cards are
Contagion, Boseiju, Who Shelters All, and Due Diligence.

The preparation script adds or replaces only `TEST04` in an existing fixture. It
preserves the old fixture in the OS temporary directory before changing it.
Fixture mutations stay in the current tab's session storage, so use a fresh tab
or remove `snapcast-local-mock-state` from session storage when resetting an
older practice session. Never copy these fixtures to a public deployment.

Ready checks receive three automatic responses. A whisper to any simulated
opponent receives a private reply. Other incoming events are deterministic
console controls:

```js
const table = window.__scLocalGame;
table.receive("mock-maya", "life", { value: 37 });
table.receive("mock-drew", "poison", { value: 2 });
table.receive("mock-sam", "commander-damage", {
  attackerId: "mock-maya", value: 4, commanderName: "Alela, Artful Provocateur"
});
table.receive("mock-maya", "chat", { text: "Moving to combat." });
table.receive("mock-drew", "whisper", { text: "I have a response." });
table.receive("mock-sam", "dice-roll", { value: 17 });
table.receive("mock-maya", "active-player");
table.receive("mock-maya", "muted", { muted: true });
table.receive("mock-maya", "camera-enabled", { enabled: false });
table.receive("mock-maya", "video-counter", {
  counter: { id: "practice-counter", type: "plus-one", x: .5, y: .5, value: 3 }
});
table.receive("mock-maya", "video-counter-remove", { id: "practice-counter" });
table.receive("mock-drew", "elimination", { reason: "concede" });
table.receive("mock-drew", "elimination", { reason: "" });
table.disconnect("mock-sam");
table.reconnect("mock-sam");
table.snapshot(); // bounded event log and local transport state
```

The controls accept only known opponents, disappear when the game closes, and
never send a packet to another browser. A restart resets transport life, poison,
commander damage, elimination, commanders, video counters and pending ready
responses along with the UI. Incoming and outgoing transport state is a testing
adapter rather than a game server: it does not represent account persistence,
network synchronization or a real opponent's decisions.

Run the repeatable browser smoke test after compiling current source:

```sh
npm run check
node scripts/test_local_game_simulation.mjs
node scripts/test_ui_simulation.mjs
```

The browser driver injects the fixture into a private browser context instead of
changing `dist`. It serves the compiled app on an ephemeral loopback port, blocks
Supabase and server write endpoints, and fails if any such write was attempted.
It exercises joining, four decoded videos, invalid Commander submission and saved
Commander selection, ready acceptance/veto/timeout, start/end/restart, public
chat, whisper replies, sound categories/search/preview/cooldown, incoming counters
and dice, sidebar panels, light/dark
settings, every general switch, all appearance/layout/color/quality choices,
camera and microphone controls, keyboard activation, editable poison/commander
damage, every Coin/D3–D20 choice, draggable counter placement/movement/removal and
zero expiry, invitation copy/cancel, game rename, video flip, mobile layout, real
JPEG capture, removed-player isolation and reconnect events. A separate visitor
session verifies remote video/chat/capture access and the absence of player,
host and camera controls. It saves its
report and screenshots to `.cache/ui-simulation/`. `SNAPCAST_SIMULATION_URL` may
point at an existing loopback source preview; `SNAPCAST_CHROME_PATH` selects a
browser executable and `SNAPCAST_UI_OUTPUT` changes the report directory.
Set `SNAPCAST_UI_RECOGNITION=1` to also click the middle card on an opponent's
video and verify Boseiju through the complete recognition pipeline. Its cold
model/index downloads make this optional for routine UI checks.
Set `SNAPCAST_UI_AXE=1` to check the whole four-player game and desktop/mobile
settings with axe's WCAG 2 A/AA rules, including counter-sticker contrast.

Screenshots require visual review; successful automation alone does not establish
that every layout looks right. Canvas tracks exercise actual HTML video playback
and image capture. Signaling, opponents and persistence are simulated. Physical
microphones/cameras, OAuth, WebRTC negotiation, TURN, real media quality and
production durable writes need their own tests. This table does not replace
SNAPTEST's full recognition release matrix.
