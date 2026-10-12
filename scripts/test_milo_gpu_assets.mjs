import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const base = new URL("../public/vendor/vision/ort-webgpu-1.30.0/", import.meta.url);
// Exact files from the existing checksum-verified ORT 1.30.0 npm archive.
const pinned = {
  "ort.webgpu.min.mjs": "3dffff71811bc13a3a3d9591c57ca5ee5735b8f5f3eaf789510b02bb040ae3a0",
  "ort-wasm-simd-threaded.asyncify.mjs": "3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28",
  "ort-wasm-simd-threaded.asyncify.wasm": "39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da",
};
for (const [file, expected] of Object.entries(pinned)) {
  assert.equal(createHash("sha256").update(readFileSync(new URL(file, base))).digest("hex"), expected,
    `Reproduce the matching GPU runtime using scripts/setup_ai_crop.py: ${file}`);
}
for (const file of ["ONNX-Runtime-LICENSE.txt", "ONNX-Runtime-ThirdPartyNotices.txt"]) {
  assert.deepEqual(readFileSync(new URL(file, base)), readFileSync(new URL("../public/vendor/vision/cornelius-2.12-ort-1.30.0/" + file, import.meta.url)));
}
assert.match(readFileSync(new URL("SOURCE.txt", base), "utf8"), /d2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71/);
console.log("Optional Milo GPU runtime files match the pinned ORT 1.30.0 archive and retain its licenses");
