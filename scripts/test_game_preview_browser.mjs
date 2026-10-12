#!/usr/bin/env node
// Actual decorative preview DOM with isolated reference fixtures. No room,
// account, recognition worker, or production write is involved.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const output = process.env.SNAPCAST_PREVIEW_OUTPUT || ".cache/game-preview-images";
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "jsx", contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import GamePreview from "./src/GamePreview.jsx";
    createRoot(document.getElementById("root")).render(<main className="lobby-home"><GamePreview/></main>);
  ` },
  bundle: true, write: false, minify: true, format: "iife",
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
});
const styles = await readFile("src/styles.css", "utf8");
const server = createServer((request, response) => {
  const file = request.url === "/bundle.js" ? ["text/javascript", bundle.outputFiles[0].text]
    : request.url === "/styles.css" ? ["text/css", styles]
      : ["text/html", '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'];
  response.writeHead(200, { "Content-Type": file[0] }); response.end(file[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { cases: [], errors: [], externalRequests: [], liveReferences: process.env.SNAPCAST_PREVIEW_REAL_REFERENCES === "1" };
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}) });
  for (const viewport of [{ width: 1360, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "no-preference" });
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.addInitScript(() => {
      window.IntersectionObserver = class {
        constructor(callback) { window.startPreview = () => callback([{ isIntersecting: true }]); }
        observe() {} disconnect() {}
      };
    });
    await page.route("https://**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "cards.scryfall.io" || route.request().method() !== "GET") {
        report.externalRequests.push(url.origin + url.pathname); return route.abort();
      }
      if (report.liveReferences) return route.continue();
      const [width, height] = url.pathname.startsWith("/small/") ? [146, 204] : [672, 936];
      return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#557a58"/></svg>` });
    });
    await page.goto(base);
    await page.locator(".home-preview-camera img").first().waitFor();
    const inspect = () => page.evaluate(() => ({
      decorative: [...document.querySelectorAll(".home-preview-camera img")].map((image) => ({ src: image.src, loading: image.loading, alt: image.alt })),
      tiles: document.querySelectorAll(".home-game-preview .tile").length,
      featured: document.querySelector(".home-preview-card-result img")?.src,
      featuredName: document.querySelector(".home-preview-card-result img")?.alt,
      recents: [...document.querySelectorAll(".home-preview-recent img")].map((image) => image.src),
    }));
    const initial = await inspect();
    assert.equal(initial.tiles, 4);
    assert.equal(initial.decorative.length, 52, "every commander and battlefield row keeps its full-frame card slot");
    const imagePath = /^\/small\/front\/([0-9a-f])\/([0-9a-f])\/([0-9a-f-]{36})\.jpg$/;
    for (const image of initial.decorative) {
      const match = new URL(image.src).pathname.match(imagePath);
      assert.ok(match, "decorative cards request small full-frame references");
      assert.equal(match[1], match[3][0]); assert.equal(match[2], match[3][1]);
      assert.equal(image.loading, "lazy"); assert.equal(image.alt, "");
    }
    assert.equal(initial.featuredName, "Ghalta, Primal Hunger");
    assert.ok(new URL(initial.featured).pathname.startsWith("/normal/front/"));
    assert.equal(initial.recents.length, 2);
    assert.ok(initial.recents.every((url) => new URL(url).pathname.startsWith("/normal/front/")), "the sidebar card treatment is unchanged");
    await page.evaluate(() => window.startPreview());
    await page.waitForFunction(() => document.querySelector(".home-preview-card-result img")?.alt === "Rhystic Study");
    const next = await inspect();
    assert.ok(new URL(next.featured).pathname.startsWith("/normal/front/"), "the next featured lookup also retains normal resolution");
    assert.deepEqual(next.decorative, initial.decorative, "the card demo cycle never replaces the decorative printings");
    if (report.liveReferences) {
      await page.waitForFunction(() => [...document.querySelectorAll(".home-game-showcase img")].every((image) => image.complete && image.naturalWidth > 0));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${output}/${viewport.width}-preview.png`, fullPage: true });
    }
    report.cases.push({ viewport, decorativeCards: initial.decorative.length, uniqueDecorativeReferences: new Set(initial.decorative.map((image) => image.src)).size, featuredNormalRetained: true });
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  console.log(JSON.stringify(report));
} finally {
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
