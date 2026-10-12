#!/usr/bin/env node
// Executes the actual identify() metadata closure with browser-equivalent
// detached bitmap getters. A closed ImageBitmap reports width/height zero.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const identify = source.indexOf("async function identify(");
const begin = source.indexOf("  const nx = Number(point?.nx), ny = Number(point?.ny);", identify);
const end = source.indexOf("  const preparedCache = new WeakMap();", begin);
assert.ok(identify >= 0 && begin > identify && end > begin, "Actual identify metadata closure exists");
const metadata = source.slice(begin, end);
const rawHelper = source.slice(0, source.indexOf("/* eslint"));
const plain = value => JSON.parse(JSON.stringify(value));

for (const aiOnly of [false, true]) for (const point of [{ nx: .25, ny: .7 }, { nx: -1, ny: 3 }, { nx: NaN, ny: Infinity }]) {
  let closed = false, pixelReads = 0;
  const pixels = { width: 594, height: 426, data: new Uint8ClampedArray(4) };
  const bmp = {
    get width() { return closed ? 0 : pixels.width; },
    get height() { return closed ? 0 : pixels.height; },
    close() { closed = true; },
  };
  const image = {}, otherImage = {}, absentGeometryImage = {};
  const mappedClick = { x: 100, y: 130 };
  const matrix = [1, 0, -20, 0, 1, -30, 0, 0, 1];
  const candidates = [
    { image, sourceClick: mappedClick, cameraToCrop: matrix },
    { image: absentGeometryImage, sourceClick: mappedClick },
  ];
  const context = vm.createContext({ bmp, point, candidates, aiOnly, useMilo: aiOnly,
    bitmapToImageData(bitmap) {
      assert.equal(closed, false, "Pixels must be copied while the bitmap is attached");
      assert.equal(bitmap.width, 594);assert.equal(bitmap.height, 426);
      pixelReads++;return pixels;
    },
  });
  vm.runInContext(rawHelper + metadata + "\nglobalThis.api = {queryRegionsFor, getSourceImageData, click, normalizedPoint};", context);
  const { api } = context;
  const before = api.queryRegionsFor([image])[0];
  assert.equal(before.width, 594);assert.equal(before.height, 426);
  assert.equal(pixelReads, 0, "Metadata alone keeps pixels lazy for hint/empty-crop paths");
  // The ordinary/rectified producer primes source pixels before releasing its
  // bitmap. Later verification may reuse those pixels after close().
  assert.equal(api.getSourceImageData(), pixels);
  bmp.close();assert.equal(bmp.width, 0);assert.equal(bmp.height, 0);
  const [after, unknown, incomplete] = api.queryRegionsFor([image, otherImage, absentGeometryImage]);
  assert.equal(after.width, 594, "Source width survives bitmap close()");
  assert.equal(after.height, 426, "Source height survives bitmap close()");
  assert.deepEqual(plain(after), plain(before), "Click and camera transform stay unchanged after close()");
  assert.equal(after.mappedClick, mappedClick);assert.equal(after.cameraToCrop, matrix);
  assert.equal(unknown, null, "An image without exact candidate identity cannot gain regional proof");
  assert.equal(incomplete, null, "An unregistered crop cannot gain regional proof");
  assert.equal(api.getSourceImageData(), pixels);assert.equal(pixelReads, 1, "Primed pixels are reused without drawing a detached bitmap");
  const clamped = Number.isFinite(point.nx) ? Math.max(0, Math.min(1, point.nx)) : .5;
  const clampedY = Number.isFinite(point.ny) ? Math.max(0, Math.min(1, point.ny)) : .5;
  assert.deepEqual(plain(api.click), { x: clamped * 594, y: clampedY * 426 });
}
console.log("Source bitmap region lifecycle tests passed.");
