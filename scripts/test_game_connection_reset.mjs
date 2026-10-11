import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  entryPoints: [path.join(root, "src/webrtc.js")], bundle: true, write: false, platform: "node", format: "esm",
  define: { "import.meta.env": "{}" }, logLevel: "silent",
});
const { GameConnection } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const savedStorage = globalThis.sessionStorage;
const savedFetch = globalThis.fetch;
const storage = new Map();
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.fetch = () => { throw new Error("A transport reset must never fetch or contact Supabase."); };
try {
  const sent = [];
  const connection = new GameConnection({});
  Object.assign(connection, {
    roomCode: "TEST01", participantId: "local", myId: "local", role: "player",
    life: 9, poison: 7, commander: "Malcolm, Keen-Eyed Navigator", commanderPartner: "Breeches, Brazen Plunderer",
    commanderPartnerType: "Legendary Creature — Goblin Pirate", eliminationReason: "commander_damage",
    commanderDamage: { remote: 21, "p:remote": 8 },
    videoCounters: [{ id: "counter-one", type: "plus-one", x: 0.5, y: 0.5, value: 2, zeroSince: 0 }],
    color: "#d7ac3f", muted: true, cameraEnabled: false,
    activePlayerId: "old-turn",
    roster: [{ id: "observer", role: "visitor" }, { id: "first-player", role: "player" }, { id: "local", role: "player" }],
  });
  connection.room = { send: (message) => {
    const stored = JSON.parse(storage.get(connection._playerStateKey()));
    assert.deepEqual(stored.commanderDamage, {}, "damage must be cleared from refresh state before broadcasts begin");
    assert.deepEqual(stored.videoCounters, [], "stickers must be cleared from refresh state before broadcasts begin");
    sent.push(structuredClone(message));
  } };
  connection._persistPlayerState();
  connection.resetTableState();
  const after = JSON.parse(storage.get(connection._playerStateKey()));
  assert.equal(after.life, 40);
  assert.equal(after.poison, 0);
  assert.equal(after.commander, "");
  assert.equal(after.commanderPartner, "");
  assert.equal(after.commanderPartnerType, "");
  assert.deepEqual(after.commanderDamage, {});
  assert.deepEqual(after.videoCounters, []);
  assert.equal(after.color, "#d7ac3f");
  assert.equal(after.muted, true);
  assert.equal(after.cameraEnabled, false);
  assert.equal(connection.eliminationReason, "");
  assert.equal(connection.activePlayerId, "first-player");
  assert.deepEqual(connection._stateSnapshotMessages().filter((message) => message.type === "active-player"), [
    { type: "active-player", playerId: "first-player" },
  ], "reconnecting peers must receive the reset opening turn instead of the previous active player");
  assert.deepEqual(sent.filter((message) => message.type === "active-player"), [
    { type: "active-player", playerId: "first-player" },
  ]);
  assert.deepEqual(sent.filter((message) => message.type === "commander-damage"), [
    { type: "commander-damage", attackerId: "remote", value: 0 },
    { type: "commander-damage", attackerId: "p:remote", value: 0 },
  ]);
  assert.deepEqual(sent.filter((message) => message.type === "video-counter-remove"), [{ type: "video-counter-remove", counterId: "counter-one" }]);

  const rejoined = new GameConnection({});
  Object.assign(rejoined, { roomCode: "TEST01", participantId: "local", role: "player" });
  const restored = rejoined._restorePlayerState();
  assert.equal(restored.life, 40);
  assert.deepEqual(restored.commanderDamage, {});
  assert.deepEqual(restored.videoCounters, []);

  const remoteState = { damage: { remote: 21, "p:remote": 8 }, counters: new Set(["counter-one"]) };
  const receiver = new GameConnection({
    onCommanderDamage: (_owner, attacker, value) => { remoteState.damage[attacker] = value; },
    onVideoCounterRemove: (_owner, counterId) => remoteState.counters.delete(counterId),
  });
  receiver.roster = [{ id: "local", role: "player" }];
  for (const message of sent) await receiver._onSignal({ ...message, from: "local" });
  assert.deepEqual(remoteState.damage, { remote: 0, "p:remote": 0 });
  assert.equal(remoteState.counters.size, 0);

  const visitor = new GameConnection({});
  Object.assign(visitor, { role: "visitor", commanderDamage: { remote: 5 }, videoCounters: [{ id: "visitor-counter" }], life: 12 });
  visitor.room = { send: () => assert.fail("visitors cannot broadcast a game-state reset") };
  const beforeVisitor = { life: visitor.life, commanderDamage: structuredClone(visitor.commanderDamage), videoCounters: structuredClone(visitor.videoCounters) };
  const storedBeforeVisitor = [...storage];
  visitor.resetTableState();
  assert.deepEqual({ life: visitor.life, commanderDamage: visitor.commanderDamage, videoCounters: visitor.videoCounters }, beforeVisitor);
  assert.deepEqual([...storage], storedBeforeVisitor);
  console.log("OK: actual transport reset clears refresh state and remote damage/stickers, restores the opening turn for reconnects, preserves device preferences, and is a visitor no-op");
} finally {
  if (savedStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = savedStorage;
  globalThis.fetch = savedFetch;
}
