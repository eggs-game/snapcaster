import assert from "node:assert/strict";
import { build } from "esbuild";

// Run the actual transport while replacing only browser/network boundaries.
const bundle = await build({
  entryPoints: ["src/webrtc.js"], bundle: true, write: false, platform: "node", format: "esm",
  define: { "import.meta.env": "{}" }, logLevel: "silent",
});
const { GameConnection } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const saved = { rtc: globalThis.RTCPeerConnection, stream: globalThis.MediaStream, fetch: globalThis.fetch };
const connections = new Set();

class FakePeerConnection {
  constructor() { this.signalingState = "stable"; this.remoteDescription = null; this.localDescription = null; this.ice = []; }
  async setRemoteDescription(description) {
    await Promise.resolve(); // Keep the SDP/ICE race observable.
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  async setLocalDescription(description) {
    await Promise.resolve();
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async createOffer() { return { type: "offer", sdp: "local-offer" }; }
  async createAnswer() { assert.equal(this.remoteDescription?.type, "offer"); return { type: "answer", sdp: "local-answer" }; }
  async addIceCandidate(candidate) { assert.ok(this.remoteDescription, "ICE must wait for remote SDP"); this.ice.push(candidate); }
  getSenders() { return []; }
  createDataChannel() { return { readyState: "open", send() {} }; }
  addTransceiver() {}
  close() { this.closed = true; }
}
class FakeMediaStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
}
const member = (id, joinedAt) => ({ id, name: id, membershipId: `membership-${id}`, role: "player", joinedAt, protocol: 2 });
const host = member("host", 1000);
const friend = member("friend", 2000);
const states = (roster) => roster.map((item) => ({ membership_id: item.membershipId, display_name: item.name, role: item.role }));
const candidate = (label) => ({ candidate: `candidate:${label}`, sdpMid: "0", sdpMLineIndex: 0 });
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(setImmediate); };
function connection({ ready = true, authorized = [host, friend], roster = [host, friend] } = {}) {
  const sent = [], diagnostics = [], callbacks = [];
  const value = new GameConnection({
    onMembershipRefresh: () => callbacks.push("refresh"),
    onChat: () => callbacks.push("chat"),
    onLife: () => callbacks.push("life"),
    onActivePlayer: () => callbacks.push("turn"),
  });
  value.myId = ready ? host.id : null;
  const room = { send: (message, to) => sent.push({ ...message, to }), leave() {} };
  value.room = ready ? room : null;
  value._diagnostic = (type) => diagnostics.push(type);
  value.verifiedMemberships = new Map(states(authorized).map((state) => [state.membership_id, state]));
  value.allowedMembershipIds = new Set(authorized.map((item) => item.membershipId));
  value.roster = [...roster];
  value.rawRoster = [...roster];
  connections.add(value);
  return { value, room, sent, diagnostics, callbacks };
}

globalThis.RTCPeerConnection = FakePeerConnection;
globalThis.MediaStream = FakeMediaStream;
globalThis.fetch = () => { throw new Error("Signaling regressions must never contact production services."); };
try {
  // An existing host has not yet fetched the newcomer's membership. Retain the
  // offer, request verification, and answer only after that membership arrives.
  const admission = connection({ authorized: [host], roster: [host] });
  admission.value._onRoster([host, friend]);
  await admission.value._onSignal({ from: friend.id, type: "offer", sdp: "newcomer-offer" });
  assert.equal(admission.value.peers.size, 0);
  assert.equal(admission.sent.some((message) => message.type === "answer"), false);
  assert.equal(admission.value.pendingSignals.get(friend.id)?.messages.length, 1);
  assert.deepEqual(admission.callbacks, ["refresh"]);
  admission.value.setMembershipStates(states([host, friend]));
  await tick();
  assert.equal(admission.value.peers.get(friend.id)?.pc.remoteDescription?.sdp, "newcomer-offer");
  assert.equal(admission.sent.filter((message) => message.type === "answer").length, 1);
  assert.equal(admission.value.pendingSignals.size, 0);
  assert.equal(admission.diagnostics.includes("peer-negotiation-failed"), false);

  // Presence/broadcast may run before joinRoom resolves its channel and ID.
  for (const missing of ["room", "myId", "both"]) {
    const startup = connection();
    if (missing !== "myId") startup.value.room = null;
    if (missing !== "room") startup.value.myId = null;
    await startup.value._onSignal({ from: friend.id, type: "offer", sdp: `startup-${missing}` });
    assert.equal(startup.value.peers.size, 0, `${missing} readiness must defer SDP`);
    startup.value.room = startup.room;
    startup.value.myId = host.id;
    startup.value._onRoster([host, friend]);
    await tick();
    assert.equal(startup.sent.filter((message) => message.type === "answer").length, 1);
    assert.equal(startup.value.pendingSignals.size, 0);
    assert.equal(startup.diagnostics.includes("peer-negotiation-failed"), false);
  }

  // ICE can precede both peer allocation and asynchronous remote SDP.
  const incoming = connection();
  await incoming.value._onSignal({ from: friend.id, type: "ice", candidate: candidate("before-peer") });
  assert.equal(incoming.value.peers.size, 0);
  assert.equal(incoming.value.pendingIce.get(friend.id)?.length, 1);
  const offer = incoming.value._onSignal({ from: friend.id, type: "offer", sdp: "remote-offer" });
  await incoming.value._onSignal({ from: friend.id, type: "ice", candidate: candidate("during-sdp") });
  await offer;
  assert.deepEqual(incoming.value.peers.get(friend.id).pc.ice.map((item) => item.candidate), ["candidate:before-peer", "candidate:during-sdp"]);
  assert.equal(incoming.value.pendingIce.size, 0);

  const outgoing = connection();
  await outgoing.value._makeOffer(friend.id);
  await outgoing.value._onSignal({ from: friend.id, type: "ice", candidate: candidate("before-answer") });
  assert.equal(outgoing.value.peers.get(friend.id).pc.ice.length, 0);
  await outgoing.value._onSignal({ from: friend.id, type: "answer", sdp: "remote-answer" });
  assert.equal(outgoing.value.peers.get(friend.id).pc.ice[0].candidate, "candidate:before-answer");
  assert.equal(outgoing.value.pendingIce.size, 0);

  // Equal milliseconds must elect exactly one side using participant IDs.
  const first = member("peer-a", 1000), second = member("peer-b", 1000);
  const a = connection({ authorized: [first, second], roster: [] });
  const b = connection({ authorized: [first, second], roster: [] });
  a.value.myId = first.id; b.value.myId = second.id;
  a.value._onRoster([first, second]); b.value._onRoster([first, second]);
  await tick();
  assert.equal(a.sent.filter((message) => message.type === "offer").length, 0);
  assert.equal(b.sent.filter((message) => message.type === "offer").length, 1);

  // Only bounded negotiation packets may wait for admission. Game actions must
  // not be replayed when an unknown sender later becomes a verified participant.
  const untrusted = connection({ authorized: [host], roster: [host] });
  for (const type of ["chat", "life", "active-player", "state-snapshot"]) {
    await untrusted.value._onSignal({ from: friend.id, type, text: "untrusted", life: 1, playerId: friend.id, messages: [{ type: "life", life: 1 }] });
  }
  assert.equal(untrusted.value.pendingSignals.size, 0);
  assert.deepEqual(untrusted.callbacks, []);
  for (const message of [
    { from: friend.id, type: "offer", sdp: "x".repeat(65537) },
    { from: friend.id, type: "ice", candidate: candidate("x".repeat(8193)) },
    { from: friend.id, type: "ice", candidate: { candidate: 12 } },
    { from: "x".repeat(41), type: "offer", sdp: "bad-id" },
  ]) await untrusted.value._onSignal(message);
  // The signaling boundary drops self broadcasts; the queue also rejects them.
  untrusted.value._queueSignal({ from: host.id, type: "offer", sdp: "self-offer" });
  assert.equal(untrusted.value.pendingSignals.size, 0, "invalid packets must not allocate queue slots");
  untrusted.value.setMembershipStates(states([host, friend]));
  await tick();
  assert.deepEqual(untrusted.callbacks, []);
  assert.equal(untrusted.value.peers.size, 0);

  const bounded = connection({ ready: false, authorized: [host], roster: [host] });
  for (let index = 0; index < 20; index++) bounded.value._queueSignal({ from: `unknown-${index}`, type: "offer", sdp: "bounded" });
  assert.equal(bounded.value.pendingSignals.size, 14);
  for (let index = 0; index < 60; index++) bounded.value._queueSignal({ from: "unknown-0", type: "ice", candidate: candidate(index) });
  assert.equal(bounded.value.pendingSignals.get("unknown-0").messages.length, 40);
  for (let index = 0; index < 10; index++) bounded.value._queueSignal({ from: "unknown-1", type: "offer", sdp: `latest-${index}` });
  assert.equal(bounded.value.pendingSignals.get("unknown-1").messages.length, 1, "repeated SDP types replace rather than accumulate");
  assert.equal(bounded.value.pendingSignals.get("unknown-1").messages[0].sdp, "latest-9");
  assert.equal(bounded.callbacks.length, 1, "an admission burst must request only one immediate membership refresh");
  for (const pending of bounded.value.pendingSignals.values()) pending.at = Date.now() - 30001;
  bounded.value._queueSignal({ from: friend.id, type: "offer", sdp: "fresh-offer" });
  assert.equal(bounded.value.pendingSignals.size, 1, "expired senders release the bounded peer slots");
  bounded.value.pendingSignals.get(friend.id).at = Date.now() - 30001;
  bounded.value.room = bounded.room; bounded.value.myId = host.id;
  bounded.value.setMembershipStates(states([host, friend]));
  await tick();
  assert.equal(bounded.value.pendingSignals.size, 0);
  assert.equal(bounded.value.peers.size, 0, "expired SDP must never negotiate after admission");

  // Even stale rendered presence cannot authorize a revoked membership.
  const revoked = connection({ ready: false });
  await revoked.value._onSignal({ from: friend.id, type: "offer", sdp: "revoked-offer" });
  revoked.value.allowedMembershipIds.delete(friend.membershipId);
  revoked.value.room = revoked.room; revoked.value.myId = host.id;
  revoked.value._drainPendingSignals();
  await tick();
  assert.equal(revoked.value.peers.size, 0);
  assert.equal(revoked.sent.length, 0, "revocation must block pending negotiation despite stale roster data");
  revoked.value.pendingIce.set(friend.id, [candidate("pending-close")]);
  revoked.value.close();
  assert.equal(revoked.value.pendingSignals.size, 0);
  assert.equal(revoked.value.pendingIce.size, 0);
  await revoked.value._onSignal({ from: friend.id, type: "offer", sdp: "after-close" });
  assert.equal(revoked.value.pendingSignals.size, 0, "closed transports cannot resume buffering");

  // Separate/streamless track events must retain both received media kinds.
  const streams = [];
  const tracks = connection();
  tracks.value.h.onRemoteStream = (_id, stream) => streams.push(stream);
  const peer = tracks.value._getPeer(friend.id);
  peer.pc.ontrack({ track: { id: "video", kind: "video", readyState: "live" }, streams: [] });
  peer.pc.ontrack({ track: { id: "audio", kind: "audio", readyState: "live" }, streams: [] });
  assert.deepEqual(streams.at(-1).getTracks().map((track) => track.kind), ["video", "audio"]);
  assert.ok([...connections].every((item) => item.pendingSignals.size <= 14 && item.pendingIce.size <= 14));
  console.log("OK: actual WebRTC transport preserves early authorized SDP/ICE, elects equal-time peers, bounds admission queues, blocks revoked/actions, and aggregates remote audio/video");
} finally {
  for (const value of connections) value.close();
  for (const [key, value] of [["RTCPeerConnection", saved.rtc], ["MediaStream", saved.stream], ["fetch", saved.fetch]]) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
