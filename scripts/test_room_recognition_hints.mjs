import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {
  RECOGNITION_HINT_LIMIT, nearbyRecognitionHints, rememberRecognitionHint,
  removeRecognitionHintsForOwner,
} from '../src/recognitionHints.js';

// Actual GameConnection and helpers; replace only browser/media/network edges.
// The deterministic room bus behaves like authenticated targeted Realtime.
const bundle = await build({ entryPoints: ['src/webrtc.js'], bundle: true, write: false,
  platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const { GameConnection, clickToNormalized } = await import('data:text/javascript;base64,'
  + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const saved = { now: Date.now, fetch: globalThis.fetch,
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  style: globalThis.getComputedStyle };
const now = 1_800_000_000_000;
Date.now = () => now;
globalThis.fetch = () => { throw new Error('Room-hint tests must make no network requests'); };
const members = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, name: id, role: 'player',
  membershipId: `membership-${id}`, joinedAt: index + 1, protocol: 2 }));
const visitor = { id: 'visitor', name: 'Visitor', role: 'visitor',
  membershipId: 'membership-visitor', joinedAt: 5, protocol: 2 };
const states = roster => roster.map(member => ({ membership_id: member.membershipId,
  display_name: member.name, role: member.role }));
const uuid = index => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const hint = (ownerId = 'b', index = 1, at = now - 1000) => ({ ownerId, nx: .4, ny: .6, at,
  card: { name: index === 1 ? 'Sol Ring' : `Known card ${index}`,
    scryfall_id: uuid(index), face: index % 2, set: 'cmm', collector_number: String(index) } });
const connections = new Set();
function client(member) {
  const cache = { hints: [], received: [], cleared: [] };
  const value = new GameConnection({
    onRecognitionHint: value => { cache.received.push(value); cache.hints = rememberRecognitionHint(cache.hints, value); },
    onRecognitionHintsCleared: owner => { cache.cleared.push(owner); cache.hints = removeRecognitionHintsForOwner(cache.hints, owner); },
  });
  value.myId = member.id; value.role = member.role; value.name = member.name;
  value._diagnostic = () => {};
  value._makeOffer = async () => {}; // Negotiation is independently covered.
  connections.add(value);
  return { value, cache };
}
function room() {
  const clients = new Map(), sent = [], delivery = [];
  return {
    clients, sent,
    add(member) {
      const peer = client(member);
      clients.set(member.id, peer);
      peer.value.room = { leave() {}, send(message, to = null) {
        const payload = JSON.parse(JSON.stringify({ ...message, from: member.id, to }));
        sent.push(payload);
        for (const [id, receiver] of clients) if (id !== member.id && (!to || to === id)) {
          delivery.push(receiver.value._onSignal(payload));
        }
        return Promise.resolve('ok');
      } };
      return peer;
    },
    roster(roster) {
      for (const peer of clients.values()) {
        peer.value.setMembershipStates(states(roster));
        peer.value._onRoster(roster);
      }
    },
    async flush() {
      for (let attempts = 0; delivery.length; attempts++) {
        assert.ok(attempts < 20, 'Room delivery must drain');
        await Promise.all(delivery.splice(0));
      }
    },
  };
}
const admit = (value, roster) => {
  value.verifiedMemberships = new Map(states(roster).map(state => [state.membership_id, state]));
  value.allowedMembershipIds = new Set(roster.map(member => member.membershipId));
  value._onRoster(roster);
};
class Track {
  constructor(kind, deviceId) { this.kind = kind; this.enabled = true; this.deviceId = deviceId; }
  getSettings() { return { deviceId: this.deviceId }; }
  stop() { this.stopped = true; }
}
class Stream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(value => value !== track); }
}
try {
  const mesh = room();
  const a = mesh.add(members[0]), b = mesh.add(members[1]), c = mesh.add(members[2]);
  mesh.roster(members.slice(0, 3)); await mesh.flush();
  assert.equal(a.value.announceRecognitionHint(hint()), true);
  await mesh.flush();
  for (const peer of [a, b, c]) assert.deepEqual(peer.value.recognitionHints, [hint()], 'One player teaches every current participant about the same board');
  assert.deepEqual(nearbyRecognitionHints(c.cache.hints, 'b', .4, .6), [hint().card]);
  assert.deepEqual(nearbyRecognitionHints(c.cache.hints, 'a', .4, .6), [], 'A different board cannot consume matching coordinates');

  // A separate browser that did not observe the original broadcast learns it
  // through the ordinary authorized roster snapshot, retaining its timestamp.
  const d = mesh.add(members[3]);
  assert.deepEqual(d.cache.hints, []);
  mesh.roster(members); await mesh.flush();
  assert.deepEqual(d.value.recognitionHints, [hint()]);
  assert.deepEqual(d.cache.hints, [hint()]);
  assert.ok(mesh.sent.some(message => message.type === 'state-snapshot'
    && message.to === 'd' && message.recognitionHints?.[0]?.at === hint().at));
  assert.equal(d.cache.hints[0].at, now - 1000, 'Late join cannot rebase the original verification time');

  const v = mesh.add(visitor);
  mesh.roster([...members, visitor]); await mesh.flush();
  assert.deepEqual(v.cache.hints, [hint()], 'Visitors receive shared candidates');
  assert.equal(v.value.announceRecognitionHint(hint('c', 2)), true, 'Visitors can contribute a lookup of a seated player board');
  await mesh.flush();
  assert.ok(a.cache.hints.some(value => value.ownerId === 'c' && value.card.scryfall_id === uuid(2)));
  assert.equal(v.value.announceRecognitionHint(hint('visitor')), false, 'A visitor has no capturable board');
  assert.equal(a.value.announceRecognitionHint(hint('missing')), false, 'Unknown board owners are rejected on send');
  const accepted = d.cache.received.length;
  for (const packet of [
    { ...hint('missing'), from: 'a', type: 'recognition-hint' },
    { ...hint('visitor'), from: 'a', type: 'recognition-hint' },
    { ...hint(), from: 'unknown', type: 'recognition-hint' },
  ]) await d.value._onSignal(packet);
  assert.equal(d.cache.received.length, accepted, 'Unknown/visitor owners and unknown senders cannot introduce candidates');
  d.value.allowedMembershipIds.delete('membership-b');
  await d.value._onSignal({ ...hint(), from: 'a', type: 'recognition-hint' });
  assert.equal(d.cache.received.length, accepted, 'Stale rendered roster cannot authorize a revoked owner');
  d.value.allowedMembershipIds.add('membership-b');
  d.value.allowedMembershipIds.delete('membership-a');
  await d.value._onSignal({ from: 'a', type: 'state-snapshot', messages: [], recognitionHints: [hint()] });
  assert.equal(d.cache.received.length, accepted, 'A revoked sender cannot hydrate room memory');
  d.value.allowedMembershipIds.add('membership-a');

  // Revocation in an awaited state child also prevents the later hint field.
  d.value.h.onLife = () => d.value.allowedMembershipIds.delete('membership-a');
  await d.value._onSignal({ from: 'a', type: 'state-snapshot', messages: [{ type: 'life', life: 40 }], recognitionHints: [hint()] });
  assert.equal(d.cache.received.length, accepted);
  d.value.allowedMembershipIds.add('membership-a');
  delete d.value.h.onLife;

  const beforeExpired = d.cache.received.length;
  await d.value._onSignal({ from: 'a', type: 'state-snapshot', messages: [],
    recognitionHints: [hint('b', 3, now - 4 * 60 * 60 * 1000)] });
  assert.equal(d.cache.received.length, beforeExpired, 'Expired snapshot entries cannot become fresh');

  const expiry = client(members[0]);
  admit(expiry.value, members);
  expiry.value.recognitionHints = [hint('b', 3, now - 4 * 60 * 60 * 1000)];
  expiry.value._pruneRecognitionHints();
  assert.deepEqual(expiry.value.recognitionHints, []);
  assert.deepEqual(expiry.cache.cleared, [], 'TTL expiry must not cancel a fresh scan of an unchanged camera');

  // Source coordinates are invariant across viewer sizes and a local 180 flip.
  globalThis.getComputedStyle = video => ({ objectFit: video.fit });
  const video = { videoWidth: 1600, videoHeight: 900, fit: 'cover',
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 900 }) };
  const ordinary = clickToNormalized(video, 350, 560);
  const flipped = clickToNormalized(video, 670, 380, true);
  assert.deepEqual(ordinary, { nx: .4, ny: .6 }); assert.deepEqual(flipped, ordinary);
  assert.deepEqual(nearbyRecognitionHints(d.cache.hints, 'b', flipped.nx, flipped.ny), [hint().card]);

  // A participant can clear only their own board, including camera setup changes.
  a.value.announceRecognitionHint(hint('a', 4)); await mesh.flush();
  await d.value._onSignal({ from: 'a', type: 'recognition-hints-clear', ownerId: 'b' });
  assert.ok(d.value.recognitionHints.some(value => value.ownerId === 'b'));
  assert.ok(!d.value.recognitionHints.some(value => value.ownerId === 'a'));
  await d.value._onSignal({ from: 'visitor', type: 'recognition-hints-clear', ownerId: 'b' });
  assert.ok(d.value.recognitionHints.some(value => value.ownerId === 'b'), 'A visitor cannot clear another board');
  b.value.setCameraEnabled(false); await mesh.flush();
  for (const peer of mesh.clients.values()) {
    assert.ok(!peer.value.recognitionHints.some(value => value.ownerId === 'b'));
    assert.ok(!peer.cache.hints.some(value => value.ownerId === 'b'));
  }
  a.value.announceRecognitionHint(hint()); await mesh.flush();
  assert.ok(!d.value.recognitionHints.some(value => value.ownerId === 'b'), 'Camera-off boards cannot regain a hinted preview');
  b.value.setCameraEnabled(true); await mesh.flush();
  a.value.announceRecognitionHint(hint()); await mesh.flush();
  assert.ok(d.value.recognitionHints.some(value => value.ownerId === 'b'));
  await d.value._onSignal({ from: 'b', type: 'state-snapshot',
    messages: [{ type: 'camera-enabled', enabled: false }], recognitionHints: [hint()] });
  assert.ok(!d.value.recognitionHints.some(value => value.ownerId === 'b'), 'Snapshot camera state is applied before its candidates');
  await d.value._onSignal({ from: 'b', type: 'camera-enabled', enabled: true });
  a.value.announceRecognitionHint(hint()); await mesh.flush();
  d.value._onRoster(members.filter(member => member.id !== 'b'));
  assert.ok(d.value.roster.some(member => member.id === 'b'), 'The disconnected tile retains its ordinary grace period');
  assert.ok(!d.value.recognitionHints.some(value => value.ownerId === 'b'), 'Hinted positions are invalidated immediately during that grace period');
  await d.value._onSignal({ ...hint(), from: 'a', type: 'recognition-hint' });
  assert.ok(!d.value.recognitionHints.some(value => value.ownerId === 'b'));

  const bounded = client(members[0]);
  const packets = [];
  bounded.value.room = { send: (message, to) => packets.push({ ...message, from: 'a', to }), leave() {} };
  admit(bounded.value, members);
  for (let i = 1; i <= 300; i++) bounded.value.announceRecognitionHint(hint('b', i));
  assert.equal(bounded.value.recognitionHints.length, RECOGNITION_HINT_LIMIT);
  assert.equal(bounded.value.recognitionHints[0].card.scryfall_id, uuid(45));
  bounded.value.knownIds.delete('d'); bounded.value._onRoster(members);
  let snapshot = packets.filter(packet => packet.type === 'state-snapshot' && packet.to === 'd').at(-1);
  assert.equal(snapshot.recognitionHints.length, RECOGNITION_HINT_LIMIT, 'All normal 256 known cards fit the bounded envelope');
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024);
  const receiver = client(members[3]); receiver.value.room = { send() {}, leave() {} }; admit(receiver.value, members);
  await receiver.value._onSignal({ from: 'a', type: 'state-snapshot', messages: [], recognitionHints: Array.from({ length: 600 }, (_, i) => hint('b', i + 1)) });
  assert.equal(receiver.cache.received.length, RECOGNITION_HINT_LIMIT, 'Oversized incoming arrays process at most the shared bound');
  const clean = client(members[3]); clean.value.room = { send() {}, leave() {} }; admit(clean.value, [...members, visitor]);
  await clean.value._onSignal({ ...hint(), type: 'recognition-hint', from: 'a', capture: 'private-camera-pixels',
    card: { ...hint().card, image_uri: 'data:image/jpeg,private-camera-pixels', oracle_text: 'private-camera-pixels' } });
  assert.ok(!JSON.stringify(clean.value.recognitionHints).includes('private-camera-pixels'), 'Only sanitized card metadata is retained');
  bounded.value.recognitionHints = Array.from({ length: RECOGNITION_HINT_LIMIT }, (_, i) => ({ ...hint('b', i + 1),
    card: { ...hint('b', i + 1).card, name: '\u0001'.repeat(120), collector_number: '\u0001'.repeat(20) } }));
  bounded.value.knownIds.delete('d'); bounded.value._onRoster(members);
  snapshot = packets.filter(packet => packet.type === 'state-snapshot' && packet.to === 'd').at(-1);
  assert.ok(snapshot.recognitionHints.length > 0 && snapshot.recognitionHints.length < RECOGNITION_HINT_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.recognitionHints)) <= 128 * 1024, 'Escaped metadata has a concrete byte budget');
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024, 'The complete hint envelope remains below the lowest documented Broadcast cap');
  const byteReceiver = client(members[3]); byteReceiver.value.room = { send() {}, leave() {} }; admit(byteReceiver.value, members);
  await byteReceiver.value._onSignal({ from: 'a', type: 'state-snapshot', messages: [], recognitionHints: bounded.value.recognitionHints });
  assert.ok(Buffer.byteLength(JSON.stringify(byteReceiver.value.recognitionHints)) <= 128 * 1024);

  const media = client(members[1]), mediaPackets = [];
  media.value.room = { send: packet => mediaPackets.push(packet), leave() {} }; admit(media.value, members);
  const oldTrack = new Track('video', 'old-camera');
  media.value.localStream = new Stream([oldTrack]);
  media.value.announceRecognitionHint(hint());
  let nextTrack = new Track('video', 'new-camera');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => new Stream([nextTrack]) },
  } });
  const sender = { track: oldTrack, replaceTrack: async () => { throw new Error('cannot replace'); } };
  media.value.peers.set('a', { pc: { getSenders: () => [sender], close() {} } });
  await assert.rejects(media.value.switchDevice('video', 'new-camera'), /cannot replace/);
  assert.equal(media.value.recognitionHints.length, 1, 'A failed device change keeps the prior board memory');
  assert.ok(!mediaPackets.some(packet => packet.type === 'recognition-hints-clear'));
  nextTrack = new Track('video', 'actual-new-camera'); media.value.peers.clear();
  await media.value.switchDevice('video', 'requested-alias');
  assert.equal(media.value.videoDeviceId, 'actual-new-camera');
  assert.equal(media.value.recognitionHints.length, 0);
  assert.ok(mediaPackets.some(packet => packet.type === 'recognition-hints-clear'), 'A successful camera replacement invalidates every peer copy');
  media.value.announceRecognitionHint(hint());
  media.value.resetTableState();
  assert.equal(media.value.recognitionHints.length, 0, 'Starting a new setup clears the owned board');
  clean.value.close();
  assert.equal(clean.value.recognitionHints.length, 0); assert.equal(clean.value.recognitionHintCameraEnabled.size, 0);
  await clean.value._onSignal({ ...hint(), type: 'recognition-hint', from: 'a' });
  assert.equal(clean.value.recognitionHints.length, 0);
  assert.equal(clean.value.announceRecognitionHint(hint()), false, 'Closed rooms cannot hydrate or announce card memory');
  console.log('OK: actual room transport shares 256 bounded verified-card candidates across players/visitors, restores late joins, enforces owner/admission/TTL/byte bounds, and invalidates changed camera boards');
} finally {
  for (const connection of connections) connection.close();
  Date.now = saved.now; globalThis.fetch = saved.fetch;
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globalThis.navigator;
  if (saved.style === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = saved.style;
}
