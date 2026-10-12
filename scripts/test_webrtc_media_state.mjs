import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/webrtc.js"], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" }, logLevel: "silent" });
const { GameConnection } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const savedStorage = globalThis.sessionStorage, savedFetch = globalThis.fetch;
const connections = new Set(), storage = new Map(), requests = [], order = [];
let acquire;

class Track {
  constructor(kind, deviceId, width = 3840) { Object.assign(this, { kind, deviceId, width, enabled: true, readyState: "live" }); }
  getSettings() { return { deviceId: this.deviceId, ...(this.kind === "video" ? { width: this.width, height: this.width * 9 / 16 } : {}) }; }
  stop() { this.readyState = "ended"; order.push(`stop:${this.deviceId}`); }
}
class Stream {
  constructor(tracks) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter((item) => item !== track); }
}
function sender(track, label, rejectTrack = null) {
  return {
    track, parameters: null,
    async replaceTrack(next) {
      order.push(`replace:${label}:${next.deviceId}`);
      if (next === rejectTrack) throw new Error("Peer renegotiation rejected this replacement");
      this.track = next;
    },
    getParameters() { return { encodings: [{}] }; },
    async setParameters(parameters) { this.parameters = structuredClone(parameters); },
  };
}
function connection(tracks = []) {
  const value = new GameConnection({});
  value.localStream = new Stream(tracks);
  value.roomCode = "TEST01"; value.participantId = "local"; value.myId = "local";
  value.room = { send() {}, leave() {} };
  value._diagnostic = () => {};
  connections.add(value);
  return value;
}
function attach(value, id, senders) { value.peers.set(id, { pc: { getSenders: () => senders, close() {} } }); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
  getUserMedia: async (constraints) => { requests.push(structuredClone(constraints)); return acquire(constraints); },
} } });
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
globalThis.fetch = () => { throw new Error("Media-state regressions must never contact production services."); };
try {
  const oldVideo = new Track("video", "old-camera"), oldAudio = new Track("audio", "old-mic");
  const value = connection([oldVideo, oldAudio]);
  value.toggleTrack("audio", false); value.setMuted(true);
  value.toggleTrack("video", false); value.setCameraEnabled(false);
  assert.equal(oldAudio.enabled, false); assert.equal(oldVideo.enabled, false);

  const firstVideoSender = sender(oldVideo, "first-video"), secondVideoSender = sender(oldVideo, "second-video");
  const firstAudioSender = sender(oldAudio, "first-audio"), secondAudioSender = sender(oldAudio, "second-audio");
  attach(value, "first", [firstVideoSender, firstAudioSender]);
  attach(value, "second", [secondVideoSender, secondAudioSender]);
  value.videoQuality.set("first", "720p"); value.videoQuality.set("second", "1080p");
  await value.setOutgoingVideoQuality("1440p");
  const newVideo = new Track("video", "new-camera");
  acquire = () => new Stream([newVideo]);
  order.length = 0;
  await value.switchDevice("video", "new-camera");
  assert.deepEqual(requests.at(-1).video.deviceId, { exact: "new-camera" });
  assert.equal(requests.at(-1).audio, false);
  assert.equal(newVideo.enabled, false, "a camera switch must preserve camera-off state");
  assert.equal(newVideo.contentHint, "detail");
  assert.equal(firstVideoSender.track, newVideo); assert.equal(secondVideoSender.track, newVideo);
  assert.ok(order.indexOf("replace:second-video:new-camera") < order.indexOf("stop:old-camera"), "the old camera stops after every successful sender swap");
  assert.equal(firstVideoSender.parameters.encodings[0].scaleResolutionDownBy, 3);
  assert.equal(firstVideoSender.parameters.encodings[0].maxBitrate, 1_800_000);
  assert.equal(secondVideoSender.parameters.encodings[0].scaleResolutionDownBy, 2);
  assert.equal(secondVideoSender.parameters.encodings[0].maxBitrate, 5_000_000);
  assert.equal(value.videoDeviceId, "new-camera");

  const newAudio = new Track("audio", "new-mic");
  acquire = () => new Stream([newAudio]);
  await value.switchDevice("audio", "new-mic");
  assert.deepEqual(requests.at(-1).audio.deviceId, { exact: "new-mic" });
  assert.equal(requests.at(-1).video, false);
  assert.equal(newAudio.enabled, false, "switching microphones cannot unmute the player");
  assert.equal(firstAudioSender.track, newAudio); assert.equal(secondAudioSender.track, newAudio);
  value.toggleTrack("audio", true); value.setMuted(false);
  value.toggleTrack("video", true); value.setCameraEnabled(true);
  assert.equal(newAudio.enabled, true); assert.equal(newVideo.enabled, true);
  assert.equal(oldAudio.readyState, "ended"); assert.equal(oldVideo.readyState, "ended");
  value.toggleTrack("audio", false); value.setMuted(true);
  value.toggleTrack("video", false); value.setCameraEnabled(false);
  const restoredVideo = new Track("video", "restored-camera"), restoredAudio = new Track("audio", "restored-mic");
  const restored = connection([restoredVideo, restoredAudio]);
  const restoredState = restored._restorePlayerState();
  assert.equal(restoredState.muted, true); assert.equal(restoredState.cameraEnabled, false);
  assert.equal(restoredVideo.enabled, false); assert.equal(restoredAudio.enabled, false);

  const visitor = connection([new Track("audio", "visitor-mic")]); visitor.role = "visitor";
  const requestCount = requests.length;
  await visitor.switchDevice("video", "not-a-visitor-camera");
  visitor.toggleTrack("video", true);
  assert.equal(requests.length, requestCount, "a visitor cannot acquire a camera by changing devices");
  assert.equal(visitor.localStream.getVideoTracks().length, 0);

  // Acquisition failure must leave an existing, still-working device intact.
  const permissionError = Object.assign(new Error("Denied"), { name: "NotAllowedError" });
  acquire = async () => { throw permissionError; };
  await assert.rejects(value.switchDevice("audio", "denied-mic"), (error) => error === permissionError);
  assert.equal(value.localStream.getAudioTracks()[0], newAudio);
  assert.equal(newAudio.readyState, "live");

  // If replacement fails for one peer after another has switched, no peer may
  // retain an orphaned live microphone that bypasses the local mute button.
  const prior = new Track("audio", "prior-mic"), attempted = new Track("audio", "attempted-mic");
  const partial = connection([prior]);
  const early = sender(prior, "early"), late = sender(prior, "late", attempted);
  attach(partial, "early", [early]); attach(partial, "late", [late]);
  acquire = () => new Stream([attempted]);
  await partial.switchDevice("audio", "attempted-mic").catch(() => {});
  for (const current of [early, late]) {
    assert.ok(current.track.readyState === "ended" || partial.localStream.getTracks().includes(current.track), "a partial sender failure must not leave a live microphone outside localStream");
  }
  partial.toggleTrack("audio", false); partial.setMuted(true);
  assert.ok([early, late].every((current) => current.track.readyState === "ended" || !current.track.enabled), "mute must reach every still-live audio sender after replacement failure");
  assert.ok(attempted.readyState === "ended" || partial.localStream.getTracks().includes(attempted), "failed replacement must not leak the newly acquired microphone");

  // A sender can start publishing the replacement before replaceTrack resolves.
  // Mute/camera-off must reach that track while it is outside localStream.
  for (const kind of ["audio", "video"]) {
    const previous = new Track(kind, `pending-${kind}-old`), replacement = new Track(kind, `pending-${kind}-new`);
    const duringReplacement = connection([previous]);
    const started = deferred(), release = deferred();
    const waitingSender = sender(previous, `pending-${kind}-first`);
    waitingSender.replaceTrack = async function (next) {
      this.track = next;
      started.resolve();
      await release.promise;
    };
    const nextSender = sender(previous, `pending-${kind}-second`);
    attach(duringReplacement, "waiting", [waitingSender]); attach(duringReplacement, "next", [nextSender]);
    acquire = () => new Stream([replacement]);
    const changingDevice = duringReplacement.switchDevice(kind, replacement.deviceId);
    await started.promise;
    assert.equal(duringReplacement.localStream.getTracks()[0], previous, "the current local stream stays intact while a sender replacement is pending");
    assert.ok(duringReplacement.pendingMediaTracks.has(replacement));
    duringReplacement.toggleTrack(kind, false);
    if (kind === "audio") duringReplacement.setMuted(true); else duringReplacement.setCameraEnabled(false);
    assert.equal(previous.enabled, false);
    assert.equal(waitingSender.track.enabled, false, "privacy controls immediately disable the replacement already being published by a pending sender");
    assert.equal(nextSender.track.enabled, false);
    assert.equal(previous.readyState, "live", "pending sender replacement cannot release the original device early");
    release.resolve();
    await changingDevice;
    assert.equal(waitingSender.track, replacement); assert.equal(nextSender.track, replacement);
    assert.equal(replacement.enabled, false, "completion cannot undo a privacy toggle made during replacement");
    assert.equal(previous.readyState, "ended");
    assert.equal(duringReplacement.pendingMediaTracks.size, 0);
  }

  // Two rapid selections of the same device kind must finish in selection order.
  // Hold the first swap inside replaceTrack to prove the second does not even
  // acquire media until the first publishes successfully to every peer.
  const serialOriginal = new Track("audio", "serial-original"), serialFirst = new Track("audio", "serial-first"), serialSecond = new Track("audio", "serial-second");
  const serialized = connection([serialOriginal]), firstSwapStarted = deferred(), releaseFirstSwap = deferred();
  const serialWaiting = sender(serialOriginal, "serial-waiting"), serialOther = sender(serialOriginal, "serial-other");
  serialWaiting.replaceTrack = async function (next) {
    order.push(`replace:serial-waiting:${next.deviceId}`);
    this.track = next;
    if (next === serialFirst) { firstSwapStarted.resolve(); await releaseFirstSwap.promise; }
  };
  attach(serialized, "waiting", [serialWaiting]); attach(serialized, "other", [serialOther]);
  acquire = (constraints) => {
    const id = constraints.audio.deviceId.exact;
    order.push(`acquire:${id}`);
    assert.ok(id === serialFirst.deviceId || id === serialSecond.deviceId);
    return new Stream([id === serialFirst.deviceId ? serialFirst : serialSecond]);
  };
  order.length = 0;
  const beforeSerialRequests = requests.length;
  const firstSelection = serialized.switchDevice("audio", serialFirst.deviceId);
  const secondSelection = serialized.switchDevice("audio", serialSecond.deviceId);
  await firstSwapStarted.promise;
  assert.equal(requests.length, beforeSerialRequests + 1, "a concurrent same-kind selection queues acquisition behind the pending swap");
  assert.equal(serialized.localStream.getAudioTracks()[0], serialOriginal);
  assert.equal(serialSecond.readyState, "live");
  assert.deepEqual([...serialized.pendingMediaTracks], [serialFirst]);
  releaseFirstSwap.resolve();
  await Promise.all([firstSelection, secondSelection]);
  assert.deepEqual(requests.slice(beforeSerialRequests).map((constraints) => constraints.audio.deviceId.exact), [serialFirst.deviceId, serialSecond.deviceId]);
  assert.ok(order.indexOf("stop:serial-original") < order.indexOf("acquire:serial-second"), "the first selection commits before the second acquires media");
  assert.ok(order.indexOf("replace:serial-other:serial-second") < order.indexOf("stop:serial-first"), "the intermediate device remains live until every peer has its successor");
  assert.equal(serialized.audioDeviceId, serialSecond.deviceId);
  assert.deepEqual(serialized.localStream.getAudioTracks(), [serialSecond]);
  assert.equal(serialWaiting.track, serialSecond); assert.equal(serialOther.track, serialSecond);
  assert.equal(serialOriginal.readyState, "ended"); assert.equal(serialFirst.readyState, "ended"); assert.equal(serialSecond.readyState, "live");
  assert.equal(serialized.pendingMediaTracks.size, 0); assert.equal(serialized.deviceSwitches.size, 0);

  // getUserMedia can finish after the game has been left or its effect closed.
  const pendingInit = deferred(), lateVideo = new Track("video", "late-camera"), lateAudio = new Track("audio", "late-mic");
  const closedStartup = connection(); closedStartup.localStream = null;
  acquire = () => pendingInit.promise;
  const initialization = closedStartup.initMedia();
  closedStartup.close();
  pendingInit.resolve(new Stream([lateVideo, lateAudio]));
  await assert.rejects(initialization, "closed acquisition must reject so the caller cannot proceed to join");
  assert.equal(lateVideo.readyState, "ended"); assert.equal(lateAudio.readyState, "ended");

  const pendingSwitch = deferred(), lateReplacement = new Track("audio", "late-replacement");
  const closedSwitch = connection([new Track("audio", "closing-mic")]);
  acquire = () => pendingSwitch.promise;
  const switching = closedSwitch.switchDevice("audio", "late-replacement");
  closedSwitch.close();
  pendingSwitch.resolve(new Stream([lateReplacement]));
  await assert.rejects(switching);
  assert.equal(lateReplacement.readyState, "ended", "a switch completing after leave must release its new media");

  // Finalized departure clears only that peer's pending negotiation state.
  const departure = connection();
  attach(departure, "departed", []);
  departure.roster = [{ id: "departed", role: "player" }];
  departure.pendingSignals.set("departed", { at: Date.now(), messages: [] });
  departure.pendingIce.set("departed", [{ candidate: "stale" }]);
  departure.pendingIce.set("retained", [{ candidate: "retained" }]);
  departure._finalizeDeparture({ id: "departed", role: "player" }, true);
  assert.equal(departure.pendingSignals.has("departed"), false);
  assert.equal(departure.pendingIce.has("departed"), false);
  assert.equal(departure.pendingIce.has("retained"), true);
  value.close();
  assert.equal(newVideo.readyState, "ended"); assert.equal(newAudio.readyState, "ended");
  assert.equal(value.pendingSignals.size, 0); assert.equal(value.pendingIce.size, 0);
  console.log("OK: actual transport swaps preserve mute/camera state even while replacement is pending, serialize concurrent selections, retain quality, release failed/late media, and clear departure/close negotiation queues");
} finally {
  for (const value of connections) value.close();
  if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator); else delete globalThis.navigator;
  if (savedStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = savedStorage;
  globalThis.fetch = savedFetch;
}
