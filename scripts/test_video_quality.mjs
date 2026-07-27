import assert from "node:assert/strict";
import {
  DEFAULT_OUTGOING_VIDEO_QUALITY,
  normalizeOutgoingVideoQuality,
  normalizeReceiverVideoQuality,
  resolveVideoEncoding,
} from "../src/videoQuality.js";

assert.equal(normalizeOutgoingVideoQuality("1440p"), "1440p");
assert.equal(normalizeOutgoingVideoQuality("unknown"), DEFAULT_OUTGOING_VIDEO_QUALITY);
assert.equal(normalizeReceiverVideoQuality("720p"), "720p");
assert.equal(normalizeReceiverVideoQuality("2160p"), "auto");

assert.deepEqual(
  resolveVideoEncoding("auto", "2160p", 3840),
  {
    quality: "2160p",
    width: 3840,
    height: 2160,
    maxBitrate: 14_000_000,
    scaleResolutionDownBy: null,
  },
);

assert.deepEqual(
  resolveVideoEncoding("auto", "1080p", 3840),
  {
    quality: "1080p",
    width: 1920,
    height: 1080,
    maxBitrate: 5_000_000,
    scaleResolutionDownBy: 2,
  },
);

assert.deepEqual(
  resolveVideoEncoding("1080p", "720p", 3840),
  {
    quality: "720p",
    width: 1280,
    height: 720,
    maxBitrate: 1_800_000,
    scaleResolutionDownBy: 3,
  },
);

assert.deepEqual(
  resolveVideoEncoding("720p", "2160p", 2560),
  {
    quality: "720p",
    width: 1280,
    height: 720,
    maxBitrate: 1_800_000,
    scaleResolutionDownBy: 2,
  },
);

console.log("video quality policy passed");
