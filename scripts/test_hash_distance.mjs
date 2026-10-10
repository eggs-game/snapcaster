import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { hammingSearch as standaloneSearch } from "../src/recognition/hash.js";
const source = readFileSync(new URL("../src/recognition/recognizer.js", import.meta.url), "utf8");
const context = vm.createContext({ Uint8Array, Uint16Array, Uint32Array });
vm.runInContext(source.slice(source.indexOf("const POPCOUNT16 ="), source.indexOf("// ---------- OpenCV loading")), context);
let seed = 12345;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
const bits = (v) => { let n = 0; while (v) { v &= v - 1; n++; } return n; };
for (const alignment of [0, 1, 2, 3]) {
  const backing = new Uint8Array(257 * 64 + alignment);
  for (let i = 0; i < backing.length; i++) backing[i] = random();
  const index = backing.subarray(alignment);
  const queries = Array.from({ length: 8 }, () => Uint8Array.from({ length: 64 }, random));
  for (const count of [1, 4, 8]) {
  const variants = queries.slice(0, count);
  const expected = Uint16Array.from({ length: 257 }, (_, i) => i % 3 === 0 ? 100 : 512);
  const actual = expected.slice();
  for (let i = 0; i < 257; i++) for (const q of variants) {
    let distance = 0;
    for (let b = 0; b < 64; b++) distance += bits(q[b] ^ index[i * 64 + b]);
    expected[i] = Math.min(expected[i], distance);
  }
  context.hammingSearchVariants(variants, index, 257, actual);
  assert.deepEqual(actual, expected);
  const singles = Uint16Array.from({ length: 257 }, () => 512);
  for (const q of variants) context.hammingSearch(q, index, 257, singles);
  const helper = new Uint16Array(257).fill(512);
  for (const q of variants) standaloneSearch(q, index, 257, helper);
  assert.deepEqual(helper, singles);
  const empty = new Uint16Array(257).fill(512);
  context.hammingSearchVariants([], index, 257, empty);
  assert.ok(empty.every(v => v === 512));
  const words = context.hashWords(index);
  for (const i of [0, 127, 256]) {
    const distance = context.wordDistance(context.hashWords(queries[0]), words, i * 16);
    let oracle = 0;
    for (let b = 0; b < 64; b++) oracle += bits(queries[0][b] ^ index[i * 64 + b]);
    assert.equal(distance, oracle);
  }
  }
}
console.log("word-based distance is bit-exact for all variants, alignments and existing minima");
