#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({ entryPoints: [path.join(root, "src/webrtc.js")], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" }, logLevel: "silent" });
const { GameConnection } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("Capture rejection must not contact a server");
try {
  const replies = [];
  const connection = new GameConnection({});
  connection.localStream = { getVideoTracks: () => assert.fail("A denied request must not touch camera pixels") };
  connection.roster = [{ id: "approved", role: "player", membershipId: "member-approved" }, { id: "visitor", role: "visitor", membershipId: "member-visitor" }, { id: "removed", role: "player", membershipId: "member-removed" }];
  connection.allowedMembershipIds = new Set(["member-approved", "member-visitor"]);
  const channels = new Map();
  for (const id of ["approved", "visitor", "removed", "unknown"]) {
    const dc = { readyState: "open", send: (data) => replies.push({ to: id, message: JSON.parse(data) }) };
    channels.set(id, dc);
    connection.peers.set(id, { chunks: new Map(), capTokens: 0, capTokensAt: Date.now() });
    connection._setupDC(id, dc);
  }
  for (const id of ["approved", "visitor", "removed", "unknown"]) {
    await channels.get(id).onmessage({ data: JSON.stringify({ t: "cap-req", id: `request-${id}`, nx: 0.5, ny: 0.5, binary: 1 }) });
  }
  assert.deepEqual(replies, [
    { to: "approved", message: { t: "cap-res", id: "request-approved", error: "capture failed" } },
    { to: "visitor", message: { t: "cap-res", id: "request-visitor", error: "capture failed" } },
  ], "Approved exhausted requests reply immediately and opaquely; unknown/removed memberships stay silent");
  const requester = new GameConnection({});
  const outbound = [];
  const senderDC = { readyState: "open", send: (data) => outbound.push(JSON.parse(data)) };
  requester.peers.set("owner", { chunks: new Map() });
  requester._setupDC("owner", senderDC);
  const pending = requester.requestRemoteCapture("owner", 0.2, 0.4);
  assert.equal(requester.pending.size, 1);
  const request = outbound[0];
  await senderDC.onmessage({ data: JSON.stringify({ t: "cap-res", id: request.id, error: "capture failed" }) });
  await assert.rejects(pending, /^Error: capture failed$/);
  assert.equal(requester.pending.size, 0, "Immediate rejection must clear its ten-second timeout");
  for (const id of ["approved", "visitor"]) {
    const entry = connection.peers.get(id);
    entry.capTokens = 4;
    entry.capTokensAt = Date.now();
    for (let count = 0; count < 4; count++) assert.equal(connection._mayCapture(id), true);
    assert.equal(connection._mayCapture(id), false, "The four-request burst ceiling is unchanged");
  }
  assert.equal(connection._mayCapture("removed"), false, "A retained presence row cannot bypass current authoritative membership");
  console.log("OK: denied approved captures fail immediately, removed/unknown peers receive no reply, timers clear, and four-request burst/camera privacy remain intact");
} finally {
  globalThis.fetch = originalFetch;
}
