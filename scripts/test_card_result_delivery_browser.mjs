#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=")]; }));
const rootPath = process.cwd();
const output = args.output || ".cache/card-result-delivery";
await mkdir(output, { recursive: true });
const svg = (name, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="244" height="340"><rect width="244" height="340" fill="${color}"/><text x="25" y="40" fill="white">${name}</text></svg>`;
const imageA = svg("Printing A", "#a82020");
const imageB = svg("Printing B", "#2050a8");
const bundle = await build({
  stdin: { resolveDir: rootPath, loader: "jsx", contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import CardSidebar from "./src/CardSidebar.jsx";
    import {ConfirmDialogProvider} from "./src/ConfirmDialog.jsx";
    const root=createRoot(document.getElementById('root'));
    window.props={current:null,lookups:[],recognitionReports:[],chatMessages:[],currentUserId:'me',chatRecipients:[],chatParticipants:[],view:'lookup',collapsed:false,cameras:[],mics:[],tileColors:['#d7ac3f'],counterPlayers:[],managementFriends:[],lobbyName:'Delivery fixture',onViewChange:view=>update({view})};
    window.update=next=>{Object.assign(props,next);root.render(<ConfirmDialogProvider><div className="game"><div className="main"><CardSidebar {...props}/></div></div></ConfirmDialogProvider>)};
    window.requestSequence=0;
    window.showMatch=(name,image,preview)=>{window.resultDeliveredAt=performance.now();update({current:{requestId:++window.requestSequence,matches:[{name,scryfall_id:name,face:0,identified_by:'art-match',distance:100,image}],previewImage:preview}})};
    window.makePreview=(svg)=>URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    update({});
  ` },
  bundle: true, write: false, minify: true, format: "iife", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, logLevel: "silent",
  plugins: args.baseline ? [{ name: "baseline-sidebar", setup(build) {
    build.onLoad({ filter: /src\/(CardSidebar\.jsx|cardPresentation\.js)$/ }, ({ path: file }) => ({ contents: execFileSync("git", ["show", `${args.baseline}:${path.relative(rootPath, file)}`], { encoding: "utf8" }), loader: file.endsWith("jsx") ? "jsx" : "js" }));
  } }] : [],
});
const styles = (await Promise.all(["src/styles.css", "src/AppDropdown.css", "src/ConfirmDialog.css"].map((file) => args.baseline && file === "src/styles.css" ? execFileSync("git", ["show", `${args.baseline}:${file}`], { encoding: "utf8" }) : readFile(file, "utf8")))).join("\n");
const server = createServer((request, response) => {
  const file = request.url === "/bundle.js" ? ["text/javascript", bundle.outputFiles[0].text] : request.url === "/styles.css" ? ["text/css", styles] : request.url === "/" ? ["text/html", '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'] : ["application/json", "[]"];
  response.writeHead(200, { "Content-Type": file[0] }); response.end(file[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { baseline: args.baseline || null, cases: [], errors: [] };
try {
  browser = await chromium.launch({ headless: true, ...(args.chrome ? { executablePath: args.chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.route("https://**/*", (route) => route.abort());
  const settleScreenshot = () => page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => animation.playState === "running"
      && Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.race([Promise.all(animations.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  let releaseNormalA;
  const heldA = new Promise((resolve) => { releaseNormalA = resolve; });
  await page.route("**/normal-a.svg", async (route) => { await heldA; await route.fulfill({ contentType: "image/svg+xml", body: imageA }); });
  await page.route("**/normal-b.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: imageB }));
  await page.goto(base);
  await page.waitForTimeout(300);
  const delayed = await page.evaluate(async ({ base, svg }) => {
    showMatch("Printing A", `${base}/normal-a.svg`, makePreview(svg));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = [...document.querySelectorAll(".card-hit-image img")].find((candidate) => candidate.complete && candidate.naturalWidth > 0);
    return { elapsedMs: Math.round(performance.now() - resultDeliveredAt), title: document.querySelector(".card-meta b")?.textContent, cardHitOpacity: Number(getComputedStyle(document.querySelector(".card-hit")).opacity), imagePaintable: !!image, imageSource: image?.src || "", height: document.querySelector(".card-hit-image")?.getBoundingClientRect().height };
  }, { base, svg: imageA });
  await settleScreenshot();
  await page.screenshot({ path: `${output}/held-normal.png`, fullPage: true });
  report.cases.push({ name: "held-normal-reference", ...delayed });
  assert.equal(delayed.title, "Printing A");
  if (args.baseline) assert.equal(delayed.imagePaintable, false, "baseline waits for the normal JPEG despite an available verified preview");
  else { assert.equal(delayed.cardHitOpacity, 1, "the delivered card should not fade in after recognition completes"); assert.equal(delayed.imagePaintable, true); assert.ok(delayed.imageSource.startsWith("blob:")); assert.ok(delayed.elapsedMs < 250); assert.ok(delayed.height > 200); }

  // Supersede A while its normal reference is still held; completing it later
  // must never overwrite the newer printing B.
  await page.evaluate(({ base, svg }) => showMatch("Printing B", `${base}/normal-b.svg`, makePreview(svg)), { base, svg: imageB });
  await page.waitForFunction(() => document.querySelector('.card-hit-image img[alt="Printing B"]')?.complete);
  if (!args.baseline) await page.waitForFunction(() => document.querySelector(".card-result-normal.is-ready")?.complete);
  await settleScreenshot();
  await page.screenshot({ path: `${output}/settled-normal.png`, fullPage: true });
  releaseNormalA();
  await page.waitForTimeout(100);
  const latest = await page.evaluate(() => ({ title: document.querySelector(".card-meta b")?.textContent, images: [...document.querySelectorAll(".card-hit-image img")].map((image) => ({ alt: image.alt, src: image.src })) }));
  assert.equal(latest.title, "Printing B");
  assert.ok(latest.images.every((image) => !image.src.endsWith("normal-a.svg")));
  report.cases.push({ name: "late-previous-printing", ...latest });

  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await page.evaluate(() => update({ current: { ...props.current, matches: [{ ...props.current.matches[0], set_name: "Optional metadata" }] } }));
  await page.waitForTimeout(50);
  const upgrade = await page.evaluate(() => ({ chatVisible: document.querySelector(".sidebar")?.classList.contains("chat-view") }));
  assert.equal(upgrade.chatVisible, true, "metadata upgrades for the same request preserve the player's tab choice");
  report.cases.push({ name: "same-request-upgrade-preserves-chat", ...upgrade });
  await page.evaluate(({ base, svg }) => { update({current:{requestId:requestSequence+1,loading:true}}); queueMicrotask(() => showMatch("Fast printing", `${base}/normal-b.svg`, makePreview(svg))); }, { base, svg: imageB });
  await page.waitForTimeout(150);
  const fast = await page.evaluate(() => ({ chatVisible: document.querySelector(".sidebar")?.classList.contains("chat-view"), cardVisible: !!document.querySelector(".card-hit-image"), title: document.querySelector(".card-meta b")?.textContent || "" }));
  report.cases.push({ name: "batched-loading-to-result-from-chat", ...fast });
  if (args.baseline) assert.equal(fast.chatVisible, true, "baseline never observes the batched loading state");
  else { assert.equal(fast.chatVisible, false); assert.equal(fast.cardVisible, true); }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
