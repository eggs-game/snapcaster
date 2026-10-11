#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { transform } from "esbuild";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [name, ...value] = argument.replace(/^--/, "").split("=");
  return [name, value.join("=")];
}));
const baseUrl = args.url || "http://127.0.0.1:5173";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname));
const output = args.output || ".cache/ui-audit/media-playback";
await mkdir(output, { recursive: true });
const source = args.baseline
  ? execFileSync("git", ["show", `${args.baseline}:src/Game.jsx`], { encoding: "utf8" })
  : await readFile("src/Game.jsx", "utf8");
const tile = source.slice(source.indexOf("const VideoTile = React.memo(function VideoTile("), source.indexOf("\nfunction VideoCounterSticker("));
const audio = source.slice(source.indexOf("function RemoteAudio("), source.indexOf("\nlet speakerAudioContext"));
const comparison = source.slice(source.indexOf("function shallowNonFunctionPropsEqual("), source.indexOf("\nconst StableCardSidebar"));
const playback = source.includes('import { bindMediaPlayback }') ? await readFile("src/mediaPlayback.js", "utf8") : "";
const moduleCode = (await transform(`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
const {useEffect,useRef,useState}=React;const {createRoot}=ReactDOM;
const useSpeaking=()=>false;const CommanderBanner=()=>null;const VideoCounterSticker=()=>null;
const Swords=()=>null;const Minus=()=>null;const Plus=()=>null;const Check=()=>null;const X=()=>null;
${playback}\n${comparison}\n${audio}\n${tile}
const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
const context=canvas.getContext('2d');let frame=0;
setInterval(()=>{context.fillStyle=frame++%2?'red':'blue';context.fillRect(0,0,320,180);},40);
const video=canvas.captureStream(25);const audioContext=new AudioContext();
const destination=audioContext.createMediaStreamDestination();const oscillator=audioContext.createOscillator();
oscillator.connect(destination);oscillator.start();
window.streams={video,audio:destination.stream,both:new MediaStream([...video.getVideoTracks(),...destination.stream.getAudioTracks()]),late:new MediaStream(destination.stream.getAudioTracks())};
window.root=createRoot(document.getElementById('root'));
window.render=(kind='video',stream=streams.video,empty=false,key='peer',role='')=>root.render(kind==='audio'?<RemoteAudio stream={stream}/>:<VideoTile key={key} tile={{id:key,name:'Peer',life:40,isMe:false,empty,stream}} seatCount={4} seatIndex={0} innerSide='right' color='#fff' videoCounters={[]} heroRole={role}/>);
window.mediaState=()=>[...document.querySelectorAll('video,audio')].map(element=>({tag:element.tagName,muted:element.muted,paused:element.paused,ready:element.readyState,width:element.videoWidth||0,height:element.videoHeight||0,src:!!element.srcObject,time:element.currentTime,attempts:window.playAttempts?.get(element)||0}));
window.ready=true;
`, { loader: "jsx", format: "esm" })).code;

const browser = await chromium.launch({ headless: true, ...(args.chrome ? { executablePath: args.chrome } : {}) });
const results = [];
try {
  for (const scenario of ["blocked-video", "blocked-audio", "late-video-track", "empty-to-filled", "layout-remount", "stream-replacement", "cleanup"]) {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    if (scenario.startsWith("blocked-")) {
      await context.addInitScript(() => {
        // Model a browser that refuses initial autoplay. Keep real MediaStreams
        // and the real native play() for the successful retry.
        const originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
          if (this instanceof HTMLMediaElement && name.toLowerCase() === "autoplay") return;
          return originalSetAttribute.call(this, name, value);
        };
        const nativePlay = HTMLMediaElement.prototype.play;
        window.playAttempts = new WeakMap();
        window.userActivatedPlayback = false;
        HTMLMediaElement.prototype.play = function() {
          const attempts = (window.playAttempts.get(this) || 0) + 1;
          window.playAttempts.set(this, attempts);
          if (attempts === 1 || (!this.muted && !window.userActivatedPlayback)) {
            return Promise.reject(new DOMException("Controlled autoplay rejection", "NotAllowedError"));
          }
          return nativePlay.call(this);
        };
        document.addEventListener("pointerdown", () => { window.userActivatedPlayback = true; }, true);
      });
    }
    await page.route("**/__media-test.html", (route) => route.fulfill({ contentType: "text/html", body: '<button id="activate">Interact</button><div id="root"></div><script type="module" src="/__media-test.js"></script>' }));
    await page.route("**/__media-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: moduleCode }));
    await page.goto(`${baseUrl}/__media-test.html`);
    await page.waitForFunction(() => window.ready, {}, { timeout: 5000 });
    if (scenario === "blocked-audio") await page.evaluate(() => render("audio", streams.audio));
    else if (scenario === "blocked-video") await page.evaluate(() => render("video", streams.both));
    else if (scenario === "late-video-track") {
      await page.evaluate(() => render("video", streams.late));
      await page.waitForTimeout(200);
      await page.evaluate(() => { streams.late.addTrack(streams.video.getVideoTracks()[0]); streams.late.dispatchEvent(new Event("addtrack")); });
    } else if (scenario === "empty-to-filled") {
      await page.evaluate(() => render("video", streams.video, true));
      await page.waitForTimeout(100);
      await page.evaluate(() => render("video", streams.video, false));
    } else {
      await page.evaluate(() => render("video", streams.video));
      await page.waitForTimeout(150);
      if (scenario === "layout-remount") await page.evaluate(() => render("video", streams.video, false, "remounted", "thumbnail"));
      if (scenario === "stream-replacement") await page.evaluate(() => render("video", streams.both));
    }
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => mediaState());
    await page.locator("#activate").click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => mediaState());
    let cleanup = null;
    if (scenario === "cleanup") {
      cleanup = await page.evaluate(async () => {
        const element = document.querySelector("video"); root.unmount();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { src: !!element.srcObject, paused: element.paused, liveTracks: streams.video.getTracks().every((track) => track.readyState === "live") };
      });
    }
    assert.deepEqual(errors, []);
    if (args.baseline && ["blocked-video", "blocked-audio", "empty-to-filled"].includes(scenario)) {
      assert.equal(after[0].paused, true, `baseline must reproduce ${scenario}`);
    } else {
      assert.equal(after[0].src, true, scenario);
      assert.equal(after[0].paused, false, scenario);
      if (after[0].tag === "VIDEO") {
        assert.equal(after[0].width, 320, scenario);
        assert.equal(after[0].height, 180, scenario);
        if (!args.baseline) assert.equal(after[0].muted, true, scenario);
      }
      if (cleanup && !args.baseline) assert.deepEqual(cleanup, { src: false, paused: true, liveTracks: true });
    }
    results.push({ scenario, before, after, cleanup, errors });
    console.log(`media playback ${args.baseline ? "baseline reproduced/passed" : "passed"}: ${scenario}`);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ baseline: args.baseline || null, results }, null, 2));
}
