#!/usr/bin/env node
// Compile and exercise the real sidebar with held normal-image requests.
// Only public-reference fixture pixels are used; no room/account/camera exists.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...values] = arg.replace(/^--/, "").split("="); return [key, values.join("=")];
}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, args.output || ".cache/remembered-card-sidebar");
await mkdir(output, { recursive: true });
const svg = (name, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="244" height="340"><rect width="244" height="340" fill="${color}"/><text x="24" y="40" fill="white">${name}</text></svg>`;
const images = { a: svg("Remembered A", "#a82020"), b: svg("Remembered B", "#2050a8") };
const sources = ["src/CardSidebar.jsx", "src/cardPresentation.js", "src/styles.css"];
const sourceDigests = Object.fromEntries(await Promise.all(sources.map(async file => [file,
  createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")])));
const bundle = await build({
  stdin: { resolveDir: root, loader: "jsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import CardSidebar from './src/CardSidebar.jsx';
    import {ConfirmDialogProvider} from './src/ConfirmDialog.jsx';
    const root=createRoot(document.getElementById('root'));
    async function boot() {
      window.preview={};
      for (const [key,svg] of Object.entries(${JSON.stringify(images)})) {
        preview[key]=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
        const decoded=new Image(); decoded.src=preview[key]; await decoded.decode();
      }
      window.cards={a:{name:'Remembered A',scryfall_id:'e07f656c-97b5-4147-821a-edbb49f34e19',face:0,image:location.origin+'/normal-a.svg',scryfall_uri:'https://scryfall.com/card/cmm/396',identified_by:'art-match',confidence:1,distance:100},
        b:{name:'Remembered B',scryfall_id:'8d80ec47-0e47-49e3-9c43-1c126d8523e1',face:0,image:location.origin+'/normal-b.svg',scryfall_uri:'https://scryfall.com/card/emn/203',identified_by:'art-match',confidence:1,distance:100}};
      window.remembered=(key,id)=>({requestId:id,loading:true,rememberedCard:{card:cards[key],previewImage:preview[key],at:Date.now()}});
      window.props={current:null,lookups:[],recognitionReports:[],chatMessages:[],currentUserId:'me',chatRecipients:[],chatParticipants:[],view:'lookup',collapsed:false,cameras:[],mics:[],tileColors:['#d7ac3f'],counterPlayers:[],managementFriends:[],lobbyName:'Remembered card fixture',onViewChange:view=>update({view})};
      window.update=next=>{Object.assign(props,next);root.render(<ConfirmDialogProvider><div className="game"><div className="main"><CardSidebar {...props}/></div></div></ConfirmDialogProvider>)};
      window.show=current=>{window.deliveredAt=performance.now();update({current})};
      window.probe=async()=>{
        const started=deliveredAt;
        do {
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const card=document.querySelector('.card-hit-remembered'),title=card?.querySelector('.card-meta b')?.textContent;
          const image=card&&[...card.querySelectorAll('img')].find(img=>img.complete&&img.naturalWidth>0&&Number(getComputedStyle(img).opacity)===1);
          let ancestorOpacity=1;
          for(let node=card;node;node=node.parentElement) ancestorOpacity*=Number(getComputedStyle(node).opacity);
          if(card&&image&&ancestorOpacity===1) {
            const content=document.querySelector('.sidebar-content').getBoundingClientRect();
            const visible=element=>{const rect=element.getBoundingClientRect();return rect.top>=content.top&&rect.bottom<=content.bottom;};
            return {elapsedMs:Math.round(performance.now()-started),title,ancestorOpacity,imageSource:image.src,status:card.querySelector('[role=status]')?.textContent.trim(),frameHeight:card.querySelector('.card-hit-image').getBoundingClientRect().height,titleVisible:visible(card.querySelector('.card-meta b')),statusVisible:visible(card.querySelector('[role=status]'))};
          }
        } while(performance.now()-started<1000);
        throw new Error('Remembered reference did not become decoded and fully opaque');
      };
      show(remembered('a',1));window.initialPaint=probe();window.ready=true;
    }
    boot();
  ` },
  bundle: true, write: false, minify: true, format: "iife", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, logLevel: "silent",
});
const styles = (await Promise.all(["src/styles.css", "src/AppDropdown.css", "src/ConfirmDialog.css"]
  .map(file => readFile(path.join(root, file), "utf8")))).join("\n");
const server = createServer((request, response) => {
  const [type, body] = request.url === "/bundle.js" ? ["text/javascript", bundle.outputFiles[0].text]
    : request.url === "/styles.css" ? ["text/css", styles]
      : request.url === "/" ? ["text/html", '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>']
        : ["application/json", "[]"];
  response.writeHead(200, { "Content-Type": type }); response.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { scope: "Actual compiled CardSidebar remembered/final state transitions only. Warm decoded fixture references; excludes room delivery/capture/recognition latency.", sourceDigests, cases: [], errors: [], blockedWrites: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(args.chrome || process.env.SNAPCAST_CHROME
    ? { executablePath: args.chrome || process.env.SNAPCAST_CHROME } : {}) });
  for (const [theme, viewport] of [["dark", { width: 1360, height: 900 }], ["light", { width: 390, height: 900 }]]) {
    const context = await browser.newContext({ viewport });
    await context.route("**/*", route => {
      const request = route.request();
      if (!["GET", "HEAD"].includes(request.method())) {
        report.blockedWrites.push({ url: request.url(), method: request.method() }); return route.abort();
      }
      if (!request.url().startsWith(base) && !/^(blob:|data:)/.test(request.url())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    let releaseA;
    const heldA = new Promise(resolve => { releaseA = resolve; });
    await page.route("**/normal-a.svg", async route => { await heldA; await route.fulfill({ contentType: "image/svg+xml", body: images.a }); });
    await page.route("**/normal-b.svg", route => route.fulfill({ contentType: "image/svg+xml", body: images.b }));
    await page.addInitScript(theme => { document.addEventListener("DOMContentLoaded", () => document.documentElement.dataset.theme = theme); }, theme);
    await page.goto(base);
    await page.waitForFunction(() => window.ready);
    const initial = await page.evaluate(() => window.initialPaint);
    assert.equal(initial.title, "Remembered A"); assert.equal(initial.ancestorOpacity, 1);
    assert.equal(initial.status, "Previously recognized · Checking…");
    assert.equal(initial.titleVisible, true); assert.equal(initial.statusVisible, true);
    assert.ok(initial.imageSource.startsWith("blob:")); assert.ok(initial.elapsedMs < 250);
    assert.ok(initial.frameHeight > 200);
    assert.equal(await page.locator(".card-hit-remembered button, .card-hit-remembered a, .card-hit-remembered .card-actions").count(), 0);
    assert.equal(await page.getByText("Identifying…", { exact: true }).count(), 0);
    report.cases.push({ name: "initial-remembered-reference-before-held-normal", theme, ...initial });

    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await page.evaluate(() => show({ ...props.current, rememberedCard: { ...props.current.rememberedCard, at: Date.now() } }));
    await page.waitForTimeout(30);
    assert.ok(await page.locator(".sidebar.chat-view").count(), "same-request upgrades retain Chat");
    report.cases.push({ name: "same-request-upgrade-preserves-chat", theme });

    const next = await page.evaluate(async () => { show(remembered('b',2)); return probe(); });
    assert.equal(next.title, "Remembered B"); assert.equal(next.ancestorOpacity, 1); assert.ok(next.elapsedMs < 250);
    assert.equal(next.titleVisible, true); assert.equal(next.statusVisible, true);
    assert.equal(await page.locator(".sidebar.chat-view").count(), 0, "new request selects Cards");
    await page.screenshot({ path: path.join(output, `${theme}-remembered.png`), fullPage: true });
    releaseA();
    await page.waitForTimeout(40);
    assert.equal(await page.locator(".card-meta b").textContent(), "Remembered B");
    assert.equal(await page.locator('.card-hit img[alt="Remembered A"]').count(), 0);
    report.cases.push({ name: "new-request-and-late-old-reference", theme, ...next });

    await page.evaluate(() => show({requestId:2,loading:true}));
    await page.getByText("Identifying…", { exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit").count(), 0);
    report.cases.push({ name: "hint-miss-clears-remembered-before-full-fallback", theme });

    await page.evaluate(() => show({...remembered('a',3),loading:false,error:'Capture timed out'}));
    await page.getByText("Capture timed out", { exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit").count(), 0);
    assert.equal(await page.getByText("Previously recognized · Checking…", { exact: true }).count(), 0);
    report.cases.push({ name: "error-cannot-retain-stale-provisional-card", theme });

    await page.evaluate(() => show({requestId:4,loading:true}));
    await page.getByText("Identifying…", { exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit").count(), 0);
    report.cases.push({ name: "ordinary-loading-keeps-placeholder", theme });

    await page.evaluate(() => show({requestId:4,matches:[cards.b],previewImage:preview.b,captureImage:preview.b}));
    await page.getByRole("button", { name: "Expand Remembered B", exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit-remembered, .card-remembered-status").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Share Remembered B to chat", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Wrong card", exact: true }).count(), 1);
    assert.equal(await page.getByRole("link", { name: "View on Scryfall", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await page.evaluate(() => show({...props.current,matches:[{...cards.b,set_name:'Optional final metadata'}]}));
    await page.waitForTimeout(30);
    assert.ok(await page.locator(".sidebar.chat-view").count());
    report.cases.push({ name: "verified-final-restores-actions-and-preserves-upgrade-tab", theme });

    await page.evaluate(() => show({requestId:5,loading:false,rememberedCard:remembered('a',5).rememberedCard,matches:[{...cards.a,identified_by:'milo',distance:170}]}));
    await page.getByText("Image lookup failed", { exact: true }).waitFor();
    assert.equal(await page.locator(".card-hit, .card-remembered-status").count(), 0);
    report.cases.push({ name: "unverified-final-and-ended-loading-do-not-promote-memory", theme });
    await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blockedWrites, []);
  report.ok = true;
  console.log(JSON.stringify({ ok: true, cases: report.cases.length, initialPaintMs: report.cases.filter(x => x.elapsedMs !== undefined).map(x => x.elapsedMs), output }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
