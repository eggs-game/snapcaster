import assert from "node:assert/strict";
import { build } from "esbuild";
import { getUserMediaWithFallback } from "../src/mediaDevices.js";

const failure = (name) => Object.assign(new Error(name), { name, constraint: "deviceId" });
const selected = {
  video: { deviceId: { exact: "old-camera" }, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 24 } },
  audio: { deviceId: { exact: "old-mic" }, echoCancellation: true, noiseSuppression: true },
};
const original = structuredClone(selected);
const stream = { id: "working-stream" };
const acquire = async (constraints, failures) => {
  const requests = [];
  const result = await getUserMediaWithFallback(constraints, {
    getUserMedia: async (request) => {
      requests.push(structuredClone(request));
      if (failures.length) throw failures.shift();
      return stream;
    },
  });
  assert.equal(result, stream);
  return requests;
};

assert.deepEqual(await acquire(selected, []), [selected], "working devices keep exact selection and full capture quality");
for (const name of ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError", "DevicesNotFoundError"]) {
  const requests = await acquire(selected, [failure(name)]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].video, { ...selected.video, deviceId: { ideal: "old-camera" } });
  assert.deepEqual(requests[1].audio, { ...selected.audio, deviceId: { ideal: "old-mic" } });
}
assert.deepEqual(selected, original, "retries must not mutate caller preferences");
const basic = await acquire(selected, [failure("OverconstrainedError"), failure("OverconstrainedError")]);
assert.equal(basic.length, 3);
assert.deepEqual(basic[2], { video: { deviceId: { ideal: "old-camera" } }, audio: { deviceId: { ideal: "old-mic" } } });
const unpinned = await acquire({ video: { width: { ideal: 3840 } }, audio: true }, [failure("OverconstrainedError")]);
assert.deepEqual(unpinned[1], { video: true, audio: true });
const visitor = await acquire({ video: false, audio: selected.audio }, [failure("OverconstrainedError"), failure("OverconstrainedError")]);
assert.ok(visitor.every((request) => request.video === false), "visitor retries never open a camera");

for (const name of ["NotAllowedError", "PermissionDeniedError", "NotReadableError", "AbortError", "SecurityError"]) {
  let calls = 0;
  const error = failure(name);
  await assert.rejects(getUserMediaWithFallback(selected, { getUserMedia: async () => { calls++; throw error; } }), (received) => received === error);
  assert.equal(calls, 1, `${name} must not be retried as a device selection problem`);
}
for (const [constraints, name, expectedCalls] of [
  [selected, "OverconstrainedError", 3],
  [{ video: true, audio: true }, "NotFoundError", 1],
]) {
  let calls = 0;
  const error = failure(name);
  await assert.rejects(getUserMediaWithFallback(constraints, { getUserMedia: async () => { calls++; throw error; } }), (received) => received === error);
  assert.equal(calls, expectedCalls, "fallback is bounded and genuine missing devices still report failure");
}

// Exercise the actual production transport, including native device IDs,
// muted startup and preserving an existing stream when acquisition fails.
const bundle = await build({ entryPoints: ["src/webrtc.js"], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" }, logLevel: "silent" });
const { GameConnection } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const requests = [];
const videoTrack = { kind: "video", enabled: true, getSettings: () => ({ deviceId: "available-camera", width: 1280 }) };
const audioTrack = { kind: "audio", enabled: true, getSettings: () => ({ deviceId: "available-mic" }) };
const nativeStream = { getVideoTracks: () => [videoTrack], getAudioTracks: () => [audioTrack] };
try {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: async (request) => {
      requests.push(structuredClone(request));
      if (request.video?.deviceId?.exact || request.audio?.deviceId?.exact) throw failure("OverconstrainedError");
      return nativeStream;
    },
  } } });
  const connection = new GameConnection({});
  assert.equal(await connection.initMedia({ videoDeviceId: "old-camera", audioDeviceId: "old-mic", startMuted: true }), nativeStream);
  assert.equal(connection.videoDeviceId, "available-camera");
  assert.equal(connection.audioDeviceId, "available-mic");
  assert.equal(audioTrack.enabled, false);
  assert.equal(videoTrack.contentHint, "detail");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].video.width.ideal, 3840, "stale IDs do not reduce recognition capture resolution");

  requests.length = 0;
  navigator.mediaDevices.getUserMedia = async (request) => {
    requests.push(structuredClone(request));
    if (request.audio?.deviceId?.exact) throw failure("OverconstrainedError");
    return { getVideoTracks: () => [], getAudioTracks: () => [audioTrack] };
  };
  const spectator = new GameConnection({});
  await spectator.initMedia({ audioOnly: true, videoDeviceId: "old-camera", audioDeviceId: "old-mic", startMuted: true });
  assert.ok(requests.every((request) => request.video === false));
  assert.equal(spectator.videoDeviceId, "");
  assert.equal(spectator.audioDeviceId, "available-mic");

  navigator.mediaDevices.getUserMedia = async () => { throw failure("OverconstrainedError"); };
  await assert.rejects(connection.initMedia({ videoDeviceId: "old-camera", audioDeviceId: "old-mic" }));
  assert.equal(connection.localStream, nativeStream, "failed retries preserve an existing stream");
} finally {
  if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else delete globalThis.navigator;
}
console.log("OK: stale device IDs recover in real game startup, capture preferences and visitor mode survive, and permission/busy failures are not retried");
