// Render the actual preview DOM without browser binaries in the fast policy
// set. The browser companion separately verifies its image cycle.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "jsx", contents: `
    import React from "react"; import {renderToStaticMarkup} from "react-dom/server";
    import GamePreview from "./src/GamePreview.jsx";
    module.exports=renderToStaticMarkup(<GamePreview/>);
  ` },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
const html = module.exports;
const tiles = [...html.matchAll(/<article\b[^>]*class="tile[^>]*>[\s\S]*?<\/article>/g)].map(([markup]) => markup);
assert.equal(tiles.length, 4);
const images = tiles.flatMap((tile) => [...tile.matchAll(/<img\b[^>]*>/g)].map(([markup]) => markup));
assert.equal(images.length, 52, "all commander, creature, support and land card slots remain present");
for (const image of images) {
  const src = image.match(/\bsrc="([^"]+)"/)?.[1];
  const match = new URL(src).pathname.match(/^\/small\/front\/([0-9a-f])\/([0-9a-f])\/([0-9a-f-]{36})\.jpg$/);
  assert.ok(match, "decorative images use full-frame small references");
  assert.equal(match[1], match[3][0]); assert.equal(match[2], match[3][1]);
  assert.ok(image.includes('loading="lazy"')); assert.ok(image.includes('alt=""'));
}
const featured = html.match(/class="card-hit-image"[^>]*>\s*(<img\b[^>]*>)/)?.[1];
assert.ok(featured?.includes('alt="Ghalta, Primal Hunger"'));
assert.ok(featured.includes("https://cards.scryfall.io/normal/front/"), "the larger featured lookup retains normal resolution");
console.log("Actual preview DOM keeps 52 lazy small decorative cards, all four players, and the normal-size featured lookup");
