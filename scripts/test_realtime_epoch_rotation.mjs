#!/usr/bin/env node
import assert from "node:assert/strict";
import { RealtimeEpochRotator } from "../src/realtimeEpochRotation.js";

let current = "epoch-1";
const rotations = [];
let releaseFirst;
const firstRotation = new Promise((resolve) => { releaseFirst = resolve; });
const rotator = new RealtimeEpochRotator({
  currentEpoch: () => current,
  rotate: async (epoch) => {
    rotations.push(epoch);
    if (epoch === "epoch-2") await firstRotation;
    current = epoch;
  },
});

const firstRequest = rotator.request("epoch-2");
await Promise.resolve();
const newestRequest = rotator.request("epoch-3");
releaseFirst();
await Promise.all([firstRequest, newestRequest]);
assert.deepEqual(rotations, ["epoch-2", "epoch-3"], "rotations must serialize and finish on the newest epoch");
assert.equal(current, "epoch-3");

await rotator.request("epoch-3");
assert.deepEqual(rotations, ["epoch-2", "epoch-3"], "the active epoch must not reconnect twice");

let failureCurrent = "epoch-a";
let releaseFailure;
const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
const recovered = [];
const recoveringRotator = new RealtimeEpochRotator({
  currentEpoch: () => failureCurrent,
  rotate: async (epoch) => {
    recovered.push(epoch);
    if (epoch === "epoch-b") {
      await failureGate;
      throw new Error("obsolete topic");
    }
    failureCurrent = epoch;
  },
});

const obsoleteRequest = recoveringRotator.request("epoch-b");
await Promise.resolve();
const recoveryRequest = recoveringRotator.request("epoch-c");
releaseFailure();
await Promise.all([obsoleteRequest, recoveryRequest]);
assert.deepEqual(recovered, ["epoch-b", "epoch-c"], "a newer epoch must recover from an obsolete subscription failure");
assert.equal(failureCurrent, "epoch-c");

console.log("realtime epoch rotation is serialized and latest-wins");
