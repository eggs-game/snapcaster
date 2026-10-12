#!/usr/bin/env node
// Three independent compiled Game pages, actual native RTC and matcher.
// Only signaling/media and bounded response delays are local test adapters.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.join("=") || "1"]; }));
const output = path.resolve(flags.output || path.join(root, ".cache/shared-card-memory"));
const fixtures = path.resolve(flags.sceneFixtures || path.join(root, ".cache/native-delivery-control/scenes"));
const corpus = JSON.parse(await readFile(path.resolve(flags.sourceProof || path.join(root, ".cache/card35/native-control-200/report.json")), "utf8"));
const fixtureManifest = JSON.parse(await readFile(path.join(fixtures, "manifest.json"), "utf8"));
const files = execFileSync("rg", ["--files", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(file => /\.(jsx?|css)$/.test(file)).sort();
const frozen = new Map(await Promise.all(files.map(async file => [path.join(root, file), await readFile(path.join(root, file), "utf8")])));
const source = file => frozen.get(path.join(root, file));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const marker = source("src/main.jsx").match(/const BUILD = ("[^"]+")/)?.[1];
assert.ok(marker);
assert.deepEqual(corpus.catalogDigests, fixtureManifest.catalogDigests);
const card = (scene, index) => { const value = corpus.rows.find(row => row.scene === scene && row.index === index); assert.ok(value?.fresh.correct); return value; };
const boots = card(0, 0), grid = card(0, 6), replacement = card(1, 0);
const names = ["Scanner A", "Player B", "Player C"], ids = ["known-a", "known-b", "known-c"];
const report = { ok: false, build: JSON.parse(marker), sourceDigests: Object.fromEntries(files.map(file => [file, digest(source(file))])), catalogDigests: {}, cases: [], errors: [], blockedWrites: [], limitations: [
  "Three independent actual compiled Game pages and real native RTC mesh/capture/matcher/sidebar; only canvas media and same-origin BroadcastChannel signaling are adapters. No account, public room, physical camera/microphone, STUN, TURN or production writes.",
  "Native capture replies and actual worker result delivery are deliberately held to prove provisional display and publication ordering. This bounded functional suite is not a full200 recognition or physical/network latency benchmark.",
  "Public remembered thumbnails are warmed only by the production Game's received/verified hints. No target answer, remembered state, history or matcher result is seeded.",
  "A capture failure is injected at the native capture entry in the test build, then follows the actual RTC opaque-error and Game failure paths.",
] };
for (const [file, sha] of Object.entries(corpus.catalogDigests)) { report.catalogDigests[file] = digest(await readFile(path.join(root, file))); assert.equal(report.catalogDigests[file], sha); }
for (const scene of [0, 1]) { const value = fixtureManifest.scenes.find(item => item.scene === scene); assert.equal(digest(await readFile(path.join(fixtures, value.file))), value.sha256); }
await mkdir(output, { recursive: true });
const project = path.join(output, "project"), compiled = path.join(output, "compiled");
await mkdir(project, { recursive: true });
const room = `K${Date.now().toString(36).slice(-5)}`.toUpperCase();
const signaling = `
export const isConfigured=true;
export async function saveConnectionEvent(){}
export async function saveRecognitionTiming(){}
export async function saveRecognitionReport(){throw new Error('Local write disabled');}
export async function labelRecognitionReport(){throw new Error('Local write disabled');}
export async function joinRoom(code,name,role,handlers){
 if(!['127.0.0.1','localhost'].includes(location.hostname))throw new Error('Loopback only');
 const id=handlers.participantId,channel=new BroadcastChannel('snapcast-test-'+code);
 const self={id,name,role,joinedAt:handlers.joinedAt,protocol:2,membershipId:handlers.membershipId};
 const members=new Map([[id,self]]);
 const publish=()=>handlers.onRoster([...members.values()].sort((a,b)=>a.joinedAt-b.joinedAt));
 const send=value=>channel.postMessage(JSON.parse(JSON.stringify(value)));
 channel.onmessage=({data})=>{
  if(data.kind==='join'){members.set(data.member.id,data.member);publish();send({kind:'members',to:data.member.id,members:[...members.values()]});}
  if(data.kind==='members'&&data.to===id){for(const member of data.members)members.set(member.id,member);publish();}
  if(data.kind==='leave'){members.delete(data.id);publish();}
  if(data.kind==='message'&&(!data.to||data.to===id)){window.__sharedEvents.push({kind:'signal-received',type:data.message.type,from:data.message.from,at:performance.now()});Promise.resolve(handlers.onMessage(data.message)).catch(error=>window.__sharedErrors.push(String(error)));}
 };
 const connection={myId:id,send(message,to){const payload={...message,from:id};window.__sharedEvents.push({kind:'signal-sent',type:message.type,to:to||null,at:performance.now()});send({kind:'message',to:to||null,message:payload});},leave:async()=>{send({kind:'leave',id});channel.close();},announceLeave:async()=>connection.send({type:'participant-leaving'})};
 publish();send({kind:'join',member:self});return connection;
}`;
const adapter = `
import {GameConnection} from ${JSON.stringify(path.join(root, "src/webrtc.js"))};
const states=${JSON.stringify(ids.map((id, i) => ({ membership_id: `m-${id}`, display_name: names[i], role: "player" })))};
export default class NativeMemoryConnection extends GameConnection{
 constructor(handlers){const remote=handlers.onRemoteStream;super({...handlers,onRemoteStream:(id,stream)=>{window.__sharedRemoteStreams.set(id,stream);remote?.(id,stream);}});this._configureIceServers=async()=>{this.iceServers=[];this.turnStatus='native-loopback';};this.setMembershipStates(states);window.__sharedConnection=this;}
 async initMedia(){this.localStream=window.__sharedSourceCanvas.captureStream(24);this.muted=true;return this.localStream;}
 async listDevices(){return {cameras:[],mics:[]};}
 _setupDC(peerId,dc){super._setupDC(peerId,dc);const deliver=dc.onmessage;dc.onmessage=event=>{
  let parsed=null;try{if(typeof event.data==='string')parsed=JSON.parse(event.data);}catch{}
  const capture=event.data instanceof ArrayBuffer||event.data instanceof Blob||ArrayBuffer.isView(event.data)||['bin-chunk','chunk'].includes(parsed?.t)||parsed?.t?.startsWith('cap-')&&parsed.t!=='cap-req';
  if(capture&&window.__sharedCaptureGate){window.__sharedHeldCapture.push({peerId,event,deliver});window.__sharedEvents.push({kind:'capture-held',peerId,type:parsed?.t||'binary',id:parsed?.id||null,at:performance.now()});return;}
  return deliver(event);
 };}
}`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import Game from ${JSON.stringify(path.join(root, "src/Game.jsx"))};
import {ConfirmDialogProvider} from ${JSON.stringify(path.join(root, "src/ConfirmDialog.jsx"))};
import ${JSON.stringify(path.join(root, "src/styles.css"))};
(async()=>{
 window.__SNAP_BUILD=${marker};window.__sharedErrors=[];window.__sharedEvents=[];window.__sharedRemoteStreams=new Map();window.__sharedCaptureRecords=[];
 window.__sharedSourceCanvas=document.createElement('canvas');window.__sharedSourceCanvas.width=1920;window.__sharedSourceCanvas.height=1080;
 window.__sharedScene=null;
 window.__sharedPaint=()=>{const ctx=window.__sharedSourceCanvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);if(window.__sharedScene)ctx.drawImage(window.__sharedScene,0,0);window.__sharedConnection?.localStream.getVideoTracks()[0]?.requestFrame?.();};
 window.__sharedSetScene=async(scene)=>{const image=new Image();const value=${JSON.stringify(fixtureManifest.scenes.map(item => ({ scene: item.scene, file: item.file })))}.find(row=>row.scene===scene);await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src='/__scene/'+value.file;});window.__sharedScene=image;window.__sharedPaint();};
 const participant=new URLSearchParams(location.search).get('participant')||'known-a';const index=${JSON.stringify(ids)}.indexOf(participant);if(index<0)throw new Error('Invalid local participant');
 if(participant==='known-a')await window.__sharedSetScene(0);else window.__sharedPaint();
 window.__sharedRepaint=setInterval(window.__sharedPaint,40);
 const session={code:${JSON.stringify(room)},name:${JSON.stringify(names)}[index],role:'player',participantId:participant,joinedAt:index+1,membershipId:'m-'+participant,mockGame:{},roomStatus:'lobby',lobbyName:'Shared known-card controls',startMuted:true};
 createRoot(document.getElementById('root')).render(<ConfirmDialogProvider><Game session={session} account={null} onLeave={()=>{}} themePreference='dark' onThemePreferenceChange={()=>{}}/></ConfirmDialogProvider>);
})().catch(error=>{window.__sharedErrors.push(String(error));throw error;});
`;
await writeFile(path.join(project, "index.html"), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
await writeFile(path.join(project, "entry.jsx"), entry);
function testAdapters() { return { name: "local-shared-memory-test", enforce: "pre", load(id) {
  if (id === path.join(root, "src/signaling.js")) return signaling;
  if (id === path.join(root, "src/LocalMockGameConnection.js")) return adapter;
  if (id === path.join(root, "src/Game.jsx")) {
    let value = frozen.get(id);
    assert.ok(value.includes("current, setCurrent") && value.includes("recognitionHintImagesRef"), "Known-memory implementation required");
    value = value.replace("const [current, setCurrent] = useState(null);", "const [current, setCurrent] = useState(null);window.__sharedProbe=()=>({current,lookups,chatMessages,hints:recognitionHintsRef.current,images:[...recognitionHintImagesRef.current.entries].map(([key,v])=>({key,ready:v.ready,src:v.image.src})),requestId:latestRecognitionRequestRef.current});");
    value = value.replace("captureMs = Math.round(performance.now() - captureStartedAt);", "window.__sharedEvents.push({kind:'capture-complete',requestId,at:performance.now()});captureMs = Math.round(performance.now() - captureStartedAt);");
    value = value.replace("const recognitionMs = Math.round(performance.now() - recognitionStartedAt);", "window.__sharedEvents.push({kind:'recognition-complete',requestId,at:performance.now(),matches:data.matches?.map(card=>({name:card.name,id:card.scryfall_id,face:card.face||0,by:card.identified_by}))});const recognitionMs = Math.round(performance.now() - recognitionStartedAt);");
    return value;
  }
  if (id === path.join(root, "src/webrtc.js")) {
    let value = frozen.get(id);
    const captureMarker = "export async function captureLocalFrame(stream, nx = 0.5, ny = 0.5, options) {";
    assert.ok(value.includes(captureMarker));
    value = value.replace(captureMarker, `${captureMarker}\nif(window.__sharedFailNextCapture){window.__sharedFailNextCapture=false;throw new Error('synthetic camera frame unavailable');}`);
    value = value.replace("async function captureFrameSet(state, nx, ny, options) {", "async function captureFrameSet(state, nx, ny, options) {\nconst trace={at:performance.now(),nx,ny,frames:[]};window.__sharedCaptureRecords.push(trace);");
    value = value.replace("const score = captureSharpness(state, canvas);", "const score = captureSharpness(state, canvas);trace.frames.push({index:i,at:performance.now(),score});");
    value = value.replace("bestScore = score;", "bestScore = score;trace.selected=i;");
    return value;
  }
  if (frozen.has(id)) return frozen.get(id);
} }; }

function browserHooks() {
  localStorage.setItem("theme-preference", "dark"); localStorage.setItem("snapcast-video-layout", "tiles");
  window.__sharedHeldCapture = []; window.__sharedCaptureGate = false; window.__sharedUiSamples = []; window.__sharedWorkerEvents = [];
  window.__sharedHoldCapture = () => { window.__sharedCaptureGate = true; };
  window.__sharedReleaseCapture = async () => { window.__sharedCaptureGate = false; const held = window.__sharedHeldCapture.splice(0); for (const item of held) await item.deliver(item.event); };
  let workerGate = null, heldWorker = [];
  window.__sharedHoldWorker = kind => { workerGate = kind; };
  window.__sharedHeldWorkerCount = () => heldWorker.length;
  window.__sharedReleaseWorker = () => { workerGate = null; const held = heldWorker.splice(0); for (const deliver of held) deliver(); };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(data, ...rest) {
      window.__sharedWorkerEvents.push({at:performance.now(),direction:'sent',type:data?.type,id:data?.id,ownerId:data?.ownerId});
      return super.postMessage(data,...rest);
    }
    constructor(...args) {
      super(...args);
      if (!String(args[0]).includes("recognizer")) return;
      let handler = null;
      Object.defineProperty(this, "onmessage", { configurable: true, get: () => handler, set: value => { handler = value; } });
      this.addEventListener("message", event => {
        const data = event.data;
        const result = Array.isArray(data?.matches) || data?.hintMiss;
        if (result) window.__sharedWorkerEvents.push({ at: performance.now(), id: data.id, miss: !!data.hintMiss, hit: !!data.hintHit, names: data.matches?.map(card => card.name) || [] });
        const hold = result && (workerGate === "results" || workerGate === "after-miss" && !data.hintMiss);
        if (hold) { if (heldWorker.length >= 3) throw new Error("Bounded worker gate overflow"); heldWorker.push(() => handler?.call(this, event)); return; }
        handler?.call(this, event);
      });
    }
  };
  let active;
  document.addEventListener("click", event => {
    if (!event.target.closest?.(".tile .video-wrap")) return;
    active = { at: performance.now(), images: [] }; window.__sharedUiSamples.push(active);
  }, true);
  const inspect = async image => {
    if (!(image instanceof HTMLImageElement) || !image.closest(".card-hit-remembered") || !active) return;
    const sample = active, src = image.currentSrc || image.src;
    if (sample.images.some(value => value.src === src)) return;
    try { await image.decode(); } catch { return; }
    if (sample !== active || !image.isConnected) return;
    let opacity = 1; for (let node = image; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    const result = { src, at: performance.now(), width: image.naturalWidth, height: image.naturalHeight, opacity, title: image.closest(".card-hit-remembered").querySelector(".card-meta b")?.textContent };
    sample.images.push(result);
    await new Promise(requestAnimationFrame); if (image.isConnected && opacity === 1) result.paintAt = performance.now();
  };
  document.addEventListener("load", event => inspect(event.target), true);
  document.addEventListener("DOMContentLoaded", () => new MutationObserver(() => {
    for (const image of document.querySelectorAll(".card-hit-remembered img")) if (image.complete && image.naturalWidth) inspect(image);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true }), { once: true });
}

let server, browser, context;
const pages = new Map();
const save = () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
async function snapshot(page) { return page.evaluate(() => { const data = window.__sharedProbe(); return { ...data, events: window.__sharedEvents, workerEvents: window.__sharedWorkerEvents, samples: window.__sharedUiSamples, heldCapture: window.__sharedHeldCapture.length, heldWorker: window.__sharedHeldWorkerCount(), pendingCaptures: window.__sharedConnection.pending.size, nativeCaptures: window.__sharedCaptureRecords, nativeErrors: window.__sharedErrors }; }); }
async function click(page, row) {
  await page.bringToFront();
  assert.equal(await page.evaluate(() => document.hidden), false, 'Time an actively viewed player tab');
  const position = await page.evaluate(({ nx, ny }) => {
    const conn = window.__sharedConnection, stream = conn.myId === "known-a" ? conn.localStream : window.__sharedRemoteStreams.get("known-a");
    const video = [...document.querySelectorAll(".tile video")].find(value => value.srcObject?.id === stream?.id);
    if (!video?.videoWidth) throw new Error("Actual owner video not decoded");
    const rect = video.getBoundingClientRect(), scale = getComputedStyle(video).objectFit === "contain" ? Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight) : Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const x = (rect.width - video.videoWidth * scale) / 2 + nx * video.videoWidth * scale, y = (rect.height - video.videoHeight * scale) / 2 + ny * video.videoHeight * scale;
    return { x: rect.left + x, y: rect.top + y, visible: x >= 0 && x <= rect.width && y >= 0 && y <= rect.height };
  }, row);
  assert.equal(position.visible, true); await page.mouse.click(position.x, position.y);
}
async function waitKnown(page, row) {
  await page.waitForFunction(({ id, face }) => { const data = window.__sharedProbe?.(); return data?.hints.some(hint => hint.ownerId === "known-a" && hint.card.scryfall_id === id && hint.card.face === face) && data.images.some(image => image.key === `${id}:${face}` && image.ready); }, { id: row.fresh.winner.id, face: row.fresh.winner.face }, { timeout: 30000 });
}
async function waitVerified(page, row) {
  await page.waitForFunction(name => { const data = window.__sharedProbe?.(); return data?.current && !data.current.loading && data.current.matches?.[0]?.name === name; }, row.name, { timeout: 60000 });
  const data = await snapshot(page), top = data.current.matches[0];
  assert.equal(top.scryfall_id, row.fresh.winner.id); assert.equal(top.face || 0, row.fresh.winner.face);
  assert.ok(["art-match", "recent-hint", "visual-exact"].includes(top.identified_by));
  assert.equal(await page.locator(".card-hit-remembered").count(), 0); return data;
}
function publication(data) { return { lookups: data.lookups.length, cards: data.chatMessages.filter(value => value.kind === "card").length, hints: data.events.filter(value => value.kind === "signal-sent" && value.type === "recognition-hint").length, announces: data.events.filter(value => value.kind === "signal-sent" && value.type === "card-identified").length }; }
async function assertPending(page, row, before) {
  await page.waitForFunction(name => window.__sharedUiSamples.at(-1)?.images.some(image => image.paintAt && image.title === name), row.name, { timeout: 5000 });
  const data = await snapshot(page), sample = data.samples.at(-1), image = sample.images.find(value => value.paintAt && value.title === row.name);
  assert.equal(data.current.loading, true); assert.equal(data.current.matches, undefined);
  assert.equal(data.current.rememberedCard.card.name, row.name); assert.equal(data.current.rememberedCard.card.confidence, undefined);
  assert.equal(image.opacity, 1); assert.ok(image.width > 0 && image.height > 0);
  assert.ok(image.paintAt - sample.at <= 250, "Warmed remembered pixels must paint within250ms, independently of held fresh work");
  assert.match(await page.locator(".card-remembered-status").textContent(), /^Previously recognized · Checking…$/);
  assert.equal(await page.locator(".card-hit-remembered button").count(), 0, "Provisional memory exposes no decisive card actions");
  assert.deepEqual(publication(data), publication(before), "Memory must not create history, reannounce or reshare before verification");
  return { ...data, provisionalDisplayMs: Math.round(image.paintAt - sample.at) };
}
async function addPage(id) {
  const page = await context.newPage(); pages.set(id, page);
  page.on("pageerror", error => report.errors.push({ id, message: error.message }));
  await page.goto(`${report.base}/?participant=${id}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.__sharedConnection?.myId && window.__sharedProbe && window.__SNAP_RECOGNITION_WARMUP?.status === "ready" && window.__SNAP_MILO_WARMUP?.status === "ready", null, { timeout: 45000 });
  } catch (error) {
    report.startupDiagnostic=await page.evaluate(()=>({id:window.__sharedConnection?.myId,probe:!!window.__sharedProbe,core:window.__SNAP_RECOGNITION_WARMUP,milo:window.__SNAP_MILO_WARMUP,errors:window.__sharedErrors}));
    throw error;
  }
  assert.equal(await page.evaluate(() => window.__SNAP_BUILD), report.build); return page;
}
try {
  await build({ root: project, configFile: false, publicDir: false, plugins: [testAdapters(), react()], worker: { plugins: () => [testAdapters()] }, build: { outDir: compiled, emptyOutDir: true }, logLevel: "warn" });
  const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".onnx": "application/octet-stream", ".wasm": "application/wasm", ".bin": "application/octet-stream" };
  server = createServer(async (request, response) => {
    try { const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname); assert.ok(!pathname.includes("..")); let file = /^\/__scene\/\d{2}\.png$/.test(pathname) ? path.join(fixtures, path.basename(pathname)) : path.join(compiled, pathname === "/" ? "index.html" : pathname); try { await stat(file); } catch { file = path.join(root, "public", pathname); } response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); response.end(await readFile(file)); } catch { response.statusCode = 404; response.end("Missing local fixture"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); report.base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: flags.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
  await context.grantPermissions(["camera", "microphone"], { origin: report.base });
  await context.route("**/*", route => { const request = route.request(), url = new URL(request.url()); if (/\.supabase\.(co|net)$/.test(url.hostname) || url.pathname.startsWith("/api/") || !["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push({ method: request.method(), url: `${url.origin}${url.pathname}` }); return route.abort("blockedbyclient"); } return route.continue(); });
  await context.addInitScript(browserHooks);
  const a = await addPage("known-a"), b = await addPage("known-b");
  await b.waitForFunction(() => window.__sharedConnection.peers.get("known-a")?.dc?.readyState === "open" && [...document.querySelectorAll(".tile video")].some(video => video.srcObject?.id === window.__sharedRemoteStreams.get("known-a")?.id && video.videoWidth === 1920));
  await click(a, boots); const seed = await waitVerified(a, boots); await waitKnown(b, boots);
  assert.equal((await snapshot(b)).lookups.length, 0); assert.equal(publication(seed).announces, 0);
  report.cases.push({ name: "A verified result broadcasts naturally to B", scanner: seed, receiver: await snapshot(b) }); await save();
  // C joins after recognition and must receive the actual stored snapshot.
  const c = await addPage("known-c"); await waitKnown(c, boots);
  for (const page of pages.values()) await page.waitForFunction(() => window.__sharedConnection.peers.size === 2 && [...window.__sharedConnection.peers.values()].every(value => value.dc?.readyState === "open"));
  report.cases.push({ name: "Late C receives verified room memory via real transport snapshot", receiver: await snapshot(c) }); await save();
  await click(a, grid); await waitVerified(a, grid); await Promise.all([waitKnown(b, grid), waitKnown(c, grid)]);
  for (const [id, page] of [["known-b", b], ["known-c", c], ["known-a", a]]) {
    const before = await snapshot(page); await page.evaluate(local => local ? window.__sharedHoldWorker("results") : window.__sharedHoldCapture(), id === "known-a");
    await click(page, boots); const pending = await assertPending(page, boots, before);
    if (id === "known-a") { await page.waitForFunction(() => window.__sharedHeldWorkerCount() > 0); const at = (await snapshot(page)).events.filter(value => value.kind === "capture-complete").at(-1).at; assert.ok(pending.samples.at(-1).images.find(value => value.paintAt).paintAt < at); await page.screenshot({ path: path.join(output, `${id}-pending.png`), fullPage: true }); await page.evaluate(() => window.__sharedReleaseWorker()); }
    else { await page.waitForFunction(() => window.__sharedHeldCapture.some(value => typeof value.event.data === "string" && JSON.parse(value.event.data).t === "cap-commit") && window.__sharedConnection.pending.size > 0); const held = await snapshot(page); assert.deepEqual(publication(held), publication(before)); assert.ok(!held.events.some(value => value.kind === "capture-complete" && value.at >= pending.samples.at(-1).at)); await page.screenshot({ path: path.join(output, `${id}-pending.png`), fullPage: true }); await page.evaluate(() => window.__sharedReleaseCapture()); }
    const verified = await waitVerified(page, boots); report.cases.push({ name: `${id} shows pending remembered pixels before held native work`, before: publication(before), pending, verified }); await page.screenshot({ path: path.join(output, `${id}-verified.png`), fullPage: true }); await save();
  }
  // Two outstanding real native captures: only the newest requested card wins.
  await b.evaluate(() => window.__sharedHoldCapture()); const rapidBefore = await snapshot(b);
  await click(b, boots); await assertPending(b, boots, rapidBefore);
  await click(b, grid); const latestPending = await assertPending(b, grid, rapidBefore);
  await b.waitForFunction(() => window.__sharedConnection.pending.size === 2); await b.evaluate(() => window.__sharedReleaseCapture());
  const latest = await waitVerified(b, grid); assert.equal(latest.current.matches[0].name, grid.name);
  assert.equal(latest.lookups.length, rapidBefore.lookups.length + 1, "Obsolete capture creates no old history entry");
  assert.equal(latest.lookups.at(-1).card.name, grid.name);
  report.cases.push({ name: "Newest remembered click wins two pending native captures", pending: latestPending, verified: latest }); await save();
  // Actual opaque cap-error travels over the native data channel.
  await a.evaluate(() => { window.__sharedFailNextCapture = true; }); await b.evaluate(() => window.__sharedHoldCapture());
  const errorBefore = await snapshot(b); await click(b, boots); const errorPending = await assertPending(b, boots, errorBefore);
  await b.waitForFunction(() => window.__sharedHeldCapture.length > 0); await b.evaluate(() => window.__sharedReleaseCapture());
  await b.waitForFunction(() => window.__sharedProbe().current?.error); const failed = await snapshot(b);
  assert.equal(await b.locator(".card-hit-remembered").count(), 0); assert.deepEqual(publication(failed), publication(errorBefore));
  report.cases.push({ name: "Native capture failure removes provisional image without publication", pending: errorPending, failed }); await save();
  // Scene1 replacement is near the remembered scene0 card, but is a new card.
  // A synthetic canvas stream needs foreground paint to advance its native
  // video frame; changing its backing canvas alone can retain the old frame.
  await a.bringToFront();
  await a.evaluate(async () => {
    const video=[...document.querySelectorAll('video')].find(v=>v.srcObject===window.__sharedConnection.localStream);
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;
    const ctx=canvas.getContext('2d');
    const pixels=()=>{ctx.drawImage(video,0,0,32,18);return [...ctx.getImageData(0,0,32,18).data].join(',');};
    const before=pixels();await window.__sharedSetScene(1);
    const deadline=performance.now()+5000;
    while(pixels()===before){if(performance.now()>deadline)throw new Error('Replacement native source frame did not advance');await new Promise(requestAnimationFrame);}
  });
  await b.evaluate(() => window.__sharedHoldWorker("after-miss")); const replacementBefore = await snapshot(b);
  await click(b, replacement); const stalePending = await assertPending(b, boots, replacementBefore); await b.waitForFunction(() => window.__sharedWorkerEvents.some(value => value.miss) && window.__sharedHeldWorkerCount() > 0);
  const missed = await snapshot(b); assert.equal(missed.current.loading, true); assert.equal(missed.current.rememberedCard, null); assert.equal(await b.locator(".card-hit-remembered").count(), 0); assert.deepEqual(publication(missed), publication(replacementBefore));
  await b.evaluate(() => window.__sharedReleaseWorker()); const replaced = await waitVerified(b, replacement);
  report.cases.push({ name: "Real hint miss clears stale memory before replacement verification", pending: stalePending, missed, verified: replaced }); await save();
  report.players = Object.fromEntries(await Promise.all([...pages].map(async ([id, page]) => [id, await snapshot(page)])));
  for (const value of Object.values(report.players)) { assert.deepEqual(value.nativeErrors, []); assert.ok(value.nativeCaptures.every(trace => trace.frames.length === 3)); }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blockedWrites, []);
  for (const file of files) assert.equal(digest(await readFile(path.join(root, file))), report.sourceDigests[file], "Production source stays frozen during this run");
  report.ok = true; console.log(JSON.stringify({ ok: true, cases: report.cases.length, players: pages.size, sourceFiles: files.length, output }));
} catch (error) {
  report.failure = error.stack || String(error);
  report.failurePlayers = Object.fromEntries(await Promise.all([...pages].map(async ([id,page]) => [id, await page.evaluate(() => ({
    probe:window.__sharedProbe?.(), errors:window.__sharedErrors, events:window.__sharedEvents,
    workerEvents:window.__sharedWorkerEvents, heldWorkers:window.__sharedHeldWorkerCount(), queue:window.__SNAP_RECOGNITION_QUEUE,
    roster:window.__sharedConnection?.roster,
    peers:[...window.__sharedConnection?.peers||[]].map(([id,p])=>({id,state:p.pc.connectionState,ice:p.pc.iceConnectionState,dc:p.dc?.readyState})),
    videos:[...document.querySelectorAll('video')].map(v=>({stream:v.srcObject?.id,width:v.videoWidth,height:v.videoHeight,paused:v.paused})),
  })).catch(error=>({error:String(error)}))])));
  throw error;
}
finally { for (const page of pages.values()) await page.evaluate(() => { clearInterval(window.__sharedRepaint); window.__sharedConnection?.close(); }).catch(() => {}); await context?.unrouteAll({ behavior: "wait" }); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await save(); }
