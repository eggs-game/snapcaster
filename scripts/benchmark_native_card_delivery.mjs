#!/usr/bin/env node
// Native capture -> native RTC -> actual compiled Game/worker/sidebar. Only
// signaling and the source camera are local test adapters; production files
// are never modified. Source cameras use deterministic SNAPTEST canvas tracks.
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
const flags = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "1"]; }));
if (flags.summarize) {
  const savedPath = path.resolve(flags.summarize);
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  saved.summary = { fresh: summarize(saved, "fresh"), ...(saved.rows.some(row => row.repeat) ? { repeat: summarize(saved, "repeat") } : {}) };
  await writeFile(savedPath, JSON.stringify(saved, null, 2) + "\n");
  console.log(JSON.stringify(saved.summary, null, 2));
  process.exit(0);
}
const baseline=flags.baseline||"";
const sourceFiles=(baseline?execFileSync("git",["ls-tree","-r","--name-only",baseline,"--","src"],{cwd:root,encoding:"utf8"}):execFileSync("rg",["--files","src"],{cwd:root,encoding:"utf8"})).trim().split("\n").filter(file=>/\.(jsx?|css)$/.test(file));
const frozenSource=new Map(await Promise.all(sourceFiles.map(async file=>[path.join(root,file),baseline?execFileSync("git",["show",`${baseline}:${file}`],{cwd:root,encoding:"utf8"}):await readFile(path.join(root,file),"utf8")])));
// Research overrides are frozen and fingerprinted before compiling, just like
// tracked source. They cannot masquerade as the checkout's production bytes.
if (flags.sourceOverrides) {
 const overrides=JSON.parse(await readFile(path.resolve(flags.sourceOverrides),"utf8"));
 assert.ok(overrides && typeof overrides==="object" && !Array.isArray(overrides));
 for (const [file,code] of Object.entries(overrides)) {
  assert.ok(sourceFiles.includes(file) && typeof code==="string",`Invalid source override: ${file}`);
  frozenSource.set(path.join(root,file),code);
 }
}
const readSource=file=>frozenSource.get(path.join(root,file));
const output = path.resolve(flags.output || path.join(root, ".cache/native-card-delivery"));
const sceneFixtureDir=flags.sceneFixtures?path.resolve(flags.sceneFixtures):null;
const sceneExports=path.join(output,'scenes');await mkdir(sceneExports,{recursive:true});
const scenes = Math.max(1, Math.min(20, Number(flags.scenes || 20)));
const startScene = Math.max(0, Math.min(19, Number(flags.startScene || 0)));
const repeat = flags.repeat !== "0";
const indices = flags.indices ? flags.indices.split(",").map(Number) : null;
const cases = flags.cases ? new Set(flags.cases.split(",").map(Number)) : null;
if (cases) assert.ok([...cases].every(i=>Number.isInteger(i)&&i>=0&&i<200),"Cases must be global indices 0..199");
await mkdir(output, { recursive: true });
const project = path.join(output, "project");
const dist = path.join(output, "compiled");
await mkdir(project, { recursive: true });
const source = readSource("src/SnapTest.jsx");
function declaration(marker, arrow = false) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing authoritative sampler ${marker}`);
  const brace = source.indexOf("{", arrow ? source.indexOf("=>", start) : start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed sampler ${marker}`);
}
const matsStart = source.indexOf("const REAL_MATS =");
const draw = `${declaration("function mulberry32(")}\n${declaration("const MODES =")};\n${source.slice(matsStart, source.indexOf("];", matsStart) + 2)}\nconst popularRef = { current: null }; const CLICK_MIX = { tokens: .25, basics: .05 };\n${declaration("const loadPopular =", true)};\n${declaration("const samplePopular =", true)};\nreturn { cards: await samplePopular(MODES.realLife.size, MODES.realLife.popular, { seed: MODES.realLife.seed }), mode: MODES.realLife, mats: REAL_MATS };`;
const buildMarker = readSource("src/main.jsx").match(/const BUILD = ("[^"]+")/)?.[1] || '"unknown"';
const report = { ok: false, build: JSON.parse(buildMarker), baseline:baseline||null, commit: execFileSync("git", ["rev-parse", baseline||"HEAD"], { cwd: root, encoding: "utf8" }).trim(), sample: "authoritative SNAPTEST realLife 200, seed 20260803", rows: [], errors: [], blockedWrites: [], limitations: [
  "Actual compiled Game pointer handler, three native HTML-video samples 120 ms apart, production sharpness selection/JPEG crop, native RTC data channel, real matcher and actual sidebar.",
  "Only source media and signaling are adapted: deterministic 1920x1080 SNAPTEST canvas MediaStream tracks and loopback memory signaling; no physical camera, microphone, real room, STUN, TURN or remote NAT.",
  "Recognition models/index are warmed. Frame crop is encoded at production JPEG quality 0.9, which differs from supplied-image SNAPTEST quality 0.62; the resulting input is not pixel-identical to that benchmark.",
  "Fresh clears only the test Game's room-hint ref before the actual pointer click. Prior cards can still warm reference caches. Immediate repeats keep the newly verified hint; this does not measure first-visit downloads.",
  "Paint is approximated by decoded image pixels at full ancestor opacity plus the following requestAnimationFrame; this does not measure physical screen scanout."
] };
report.limitations.push('The canvas camera composites each source scene onto opaque black before every repaint. Transparent playmat pixels must not accumulate through repeated source-over draws; each static camera frame therefore has the same pixels.');
report.sceneFixtureSource=sceneFixtureDir;
report.sourceOverrides=flags.sourceOverrides?path.resolve(flags.sourceOverrides):null;
report.selectedCases=cases?[...cases]:null;
report.limitations.push('Each source scene is exported losslessly with its exact click metadata; --sceneFixtures replays those same pixels for the other arm. Native JPEG hashes must still match before comparing accuracy or latency.');
report.sourceDigests=Object.fromEntries(sourceFiles.sort().map(file=>[file,createHash('sha256').update(readSource(file)).digest('hex')]));
const assetFiles=['public/carddata/manifest.json','public/carddata/cards.json','public/carddata/milo/manifest.json'];
report.catalogDigests=Object.fromEntries(await Promise.all(assetFiles.map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])));
report.catalog={manifest:JSON.parse(await readFile(path.join(root,'public/carddata/manifest.json'),'utf8')),milo:JSON.parse(await readFile(path.join(root,'public/carddata/milo/manifest.json'),'utf8'))};
report.limitations.push('Baseline freezes application source at the requested Git revision; both arms intentionally serve the same current working catalog. Manifest/cards SHA256 and Milo model/gallery IDs are recorded separately.');
const signaling = `
const clients=new Map();
const roster=()=>[...clients.values()].map(value=>({...value.member}));
const publish=()=>{for(const {handlers} of clients.values())handlers.onRoster(roster());};
export const isConfigured=true;
export async function saveConnectionEvent(){}
export async function saveRecognitionTiming(){}
export async function saveRecognitionReport(){throw new Error('disabled local write');}
export async function labelRecognitionReport(){throw new Error('disabled local write');}
export async function joinRoom(code,name,role,handlers){
 const id=handlers.participantId;clients.set(id,{member:{id,name,role,joinedAt:handlers.joinedAt,protocol:2,membershipId:handlers.membershipId},handlers});
 const room={myId:id,send(message,to){const payload=JSON.parse(JSON.stringify({...message,from:id}));for(const [target,client] of clients)if(target!==id&&(!to||target===to))setTimeout(()=>Promise.resolve(client.handlers.onMessage(payload)).catch(error=>window.__nativeErrors.push(String(error))),0);},leave:async()=>{clients.delete(id);publish();},announceLeave:async()=>room.send({type:'participant-leaving'})};
 publish();return room;
}`;
const adapter = `
import {GameConnection} from ${JSON.stringify(path.join(root, "src/webrtc.js"))};
const configure=async function(){this.iceServers=[];this.turnStatus='native-loopback-test';};
const states=[{membership_id:'m-native-viewer',display_name:'Native viewer',role:'visitor'},{membership_id:'m-native-source',display_name:'Native table',role:'player'}];
export default class NativeHarnessConnection extends GameConnection {
 constructor(handlers){super(handlers);if(!['127.0.0.1','localhost'].includes(location.hostname))throw new Error('Loopback only');this._configureIceServers=configure;window.__nativeViewer=this;this.setMembershipStates(states);}
 async initMedia(){this.localStream=new MediaStream();this.muted=true;return this.localStream;}
 async listDevices(){return {cameras:[],mics:[]};}
 async join(code,name,role,options){
  const id=await super.join(code,name,role,options);
  const owner=new GameConnection({onError:error=>window.__nativeErrors.push(String(error))});owner._configureIceServers=configure;owner.localStream=window.__nativeSourceCanvas.captureStream(24);owner.muted=true;owner.setMembershipStates(states);window.__nativeOwner=owner;
  owner.captureTrace=[];
  const send=owner._sendBinaryChunked.bind(owner);owner._sendBinaryChunked=async(...args)=>{const at=performance.now();const ok=await send(...args);owner.captureTrace.push({at,endedAt:performance.now(),bytes:args[2]?.size});return ok;};
  await owner.join(code,'Native table','player',{participantId:'native-source',joinedAt:1,membershipId:'m-native-source'});
  window.__nativeRepaint=setInterval(window.__nativePaintSource,40);
  return id;
 }
 close(){clearInterval(window.__nativeRepaint);window.__nativeOwner?.close();super.close();}
}`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import Game from ${JSON.stringify(path.join(root, "src/Game.jsx"))};
import {ConfirmDialogProvider} from ${JSON.stringify(path.join(root, "src/ConfirmDialog.jsx"))};
import {buildScene,releaseScene} from ${JSON.stringify(path.join(root, "src/snaptest/scene.js"))};
import {captureLocalFrame} from ${JSON.stringify(path.join(root, "src/webrtc.js"))};
import ${JSON.stringify(path.join(root, "src/styles.css"))};
(async()=>{
window.__SNAP_BUILD=${buildMarker};window.__nativeErrors=[];window.__nativeCaptureRecords=[];
window.__nativeDraw=await(async()=>{${draw}})();
window.__nativeSourceCanvas=document.createElement('canvas');window.__nativeSourceCanvas.width=1920;window.__nativeSourceCanvas.height=1080;
window.__nativeBlur=0;
window.__nativePaintSource=()=>{const ctx=window.__nativeSourceCanvas.getContext('2d');ctx.filter='none';ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);ctx.filter=window.__nativeBlur?'blur('+window.__nativeBlur+'px)':'none';ctx.drawImage(window.__nativeScene.canvas,0,0);ctx.filter='none';window.__nativeOwner?.localStream.getVideoTracks()[0]?.requestFrame?.();};
window.__nativeCaptureLocal=captureLocalFrame;
window.__nativeSetScene=async(scene)=>{
 ${sceneFixtureDir?`const manifest=await(await fetch('/__native-scene-fixture/manifest.json')).json();const record=manifest.scenes.find(value=>value.scene===scene);if(!record)throw new Error('Frozen scene missing');const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src='/__native-scene-fixture/'+record.file;});const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d').drawImage(image,0,0);const previous=window.__nativeScene;window.__nativeScene={canvas};window.__nativePaintSource();if(previous)releaseScene(previous.canvas);return record.items;` : ''}
 ${sceneFixtureDir?'/*':' '}
 const m=window.__nativeDraw.mode;const rendered=await buildScene(window.__nativeDraw.cards.slice(scene*10,scene*10+10),scene,1920,1080,{dice:!!m.dice,layout:m.layout,perspective:!!m.perspective,playmat:m.playmat||window.__nativeDraw.mats[scene%window.__nativeDraw.mats.length]});
 if(rendered.failed.length)throw new Error('Scene image load failed');const previous=window.__nativeScene;window.__nativeScene=rendered;window.__nativePaintSource();if(previous)releaseScene(previous.canvas);
 return rendered.placed.map(p=>({...p.card,nx:p.nx,ny:p.ny,rotation:p.rotationClass,coverage:p.coverage,clipped:p.clipped,layout:p.layout,occ:p.occ,scene}));
 ${sceneFixtureDir?'*/':''}
};
window.__nativeProveStaticCamera=async()=>{
 const ctx=window.__nativeSourceCanvas.getContext('2d'),hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 window.__nativePaintSource();const first=ctx.getImageData(0,0,1920,1080).data;for(let i=1;i<10;i++)window.__nativePaintSource();const tenth=ctx.getImageData(0,0,1920,1080).data;
 let opaque=true,equal=true;for(let i=0;i<first.length;i++){if(first[i]!==tenth[i])equal=false;if(i%4===3&&(first[i]!==255||tenth[i]!==255))opaque=false;}
 return {width:1920,height:1080,repaints:10,opaque,equal,firstRGBAsha256:await hash(first),tenthRGBAsha256:await hash(tenth)};
};
window.__nativeItems=await window.__nativeSetScene(${startScene});
const session={code:'NAT001',name:'Native viewer',role:'visitor',participantId:'native-viewer',joinedAt:2,membershipId:'m-native-viewer',mockGame:{},roomStatus:'lobby',lobbyName:'Native capture benchmark'};
createRoot(document.getElementById('root')).render(<ConfirmDialogProvider><Game session={session} account={null} onLeave={()=>{}} themePreference='dark' onThemePreferenceChange={()=>{}}/></ConfirmDialogProvider>);
})().catch(error=>{window.__nativeErrors.push(String(error));throw error;});
`;
await writeFile(path.join(project, "index.html"), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
const instrumentedEntry = flags.gameCancellationControls === '1'
  ? entry.replace('ctx.filter=window.__nativeBlur?', "if(window.__nativePaintOverride?.(ctx)){window.__nativeOwner?.localStream.getVideoTracks()[0]?.requestFrame?.();return;}ctx.filter=window.__nativeBlur?")
  : entry;
await writeFile(path.join(project, "entry.jsx"), instrumentedEntry);
function testAdapters(){return {name:"native-only-test-adapters",enforce:"pre",async load(id){
 if(id===path.join(root,"src/signaling.js"))return signaling;
 if(id===path.join(root,"src/LocalMockGameConnection.js"))return adapter;
 if(id===path.join(root,"src/webrtc.js")){
  let value=frozenSource.get(id);
  value=value.replace(/async function captureFrameSet\(state, nx, ny(?:, options)?\) \{/,match=>`${match}\n const captureTrace={at:performance.now(),nx,ny,frames:[]};const recordCapture=(blob,best,firstSelected=false)=>{captureTrace.endedAt=performance.now();captureTrace.width=best.width;captureTrace.height=best.height;captureTrace.geometry={...geom};captureTrace.bytes=blob.size;captureTrace.firstSelected=firstSelected;window.__nativeCaptureRecords.push(captureTrace);void blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>captureTrace.sha256=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join(''));};`);
  value=value.replace('const score = captureSharpness(state, canvas);','const score = captureSharpness(state, canvas);\n captureTrace.frames.push({index:i,at:performance.now(),score});' + (flags.gameCancellationControls === '1' ? '\n window.__movingOnSample?.(captureTrace,i);window.__nativeOnCaptureSample?.(captureTrace,i);' : ''));
  value=value.replace('bestScore = score;','bestScore = score; captureTrace.selected=i;');
  value=value.replace('const blob = await canvasToBlob(best);','const blob = await canvasToBlob(best);\n recordCapture(blob,best);');
  value=value.replace('returnedFirst = true;','returnedFirst = true;recordCapture(first.blob,best,true);');
  if(flags.gameCancellationControls==='1')value=value.replace('firstCapture = { blob, url:',"captureTrace.firstBytes=blob.size;void blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>captureTrace.firstSHA256=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''));\nfirstCapture = { blob, url:");
  return value;
 }
 if(id===path.join(root,'src/Game.jsx')){
  let value=frozenSource.get(id);
  value=value.replace('const recognitionHintsRef = useRef([]);','const recognitionHintsRef = useRef([]);window.__nativeClearHints=()=>{recognitionHintsRef.current=[];};');
  if(flags.gameCancellationControls==='1')value=value.replace('window.__nativeClearHints=()=>{recognitionHintsRef.current=[];};','window.__nativeClearHints=()=>{recognitionHintsRef.current=[];};window.__nativeReadHints=window.__nativeGetHints=()=>recognitionHintsRef.current.map(h=>({...h,card:{...h.card}}));');
  value=value.replace('const recognitionMs = Math.round(performance.now() - recognitionStartedAt);','window.__nativeMatcherData={at:performance.now(),ai_crop:data.ai_crop,milo:data.milo,orb_timing:data.orb_timing,milo_orb_timing:data.milo_orb_timing,matches:data.matches,wasm_heap_mb:data.wasm_heap_mb};\nconst recognitionMs = Math.round(performance.now() - recognitionStartedAt);');
  return value;
 }
 if(flags.gameCancellationControls==='1'&&id===path.join(root,'src/recognition/matcher.js')){
  let value=frozenSource.get(id);
  const event="globalThis.__nativeControlEvents?.push";
  value=value.replace('entry.fullStartedAt = performance.now();',`entry.fullStartedAt = performance.now();${event}({kind:'early-start',ownerId:entry.ownerId,point:entry.point,at:Date.now()});`);
  value=value.replace('entry.fullJob.then(() => { entry.fullFinishedAt = performance.now(); }, () => { entry.fullFinishedAt = performance.now(); });',`entry.fullJob.then(() => { entry.fullFinishedAt = performance.now();${event}({kind:'early-finished',ownerId:entry.ownerId,ok:true,at:Date.now()}); }, () => { entry.fullFinishedAt = performance.now();${event}({kind:'early-finished',ownerId:entry.ownerId,ok:false,at:Date.now()}); });`);
  value=value.replace('  return () => {\n    entry.active = false;\n    if (entry.ownerId != null)',`  return () => {\n    ${event}({kind:'cancel',ownerId:entry.ownerId,hadFullJob:!!entry.fullJob,at:Date.now()});\n    entry.active = false;\n    if (entry.ownerId != null)`);
  value=value.replace('    const selectedAt = performance.now();',`    const selectedAt = performance.now();${event}({kind:'selected-identify',point,at:Date.now()});void(source instanceof Blob?source.arrayBuffer():Promise.resolve(null)).then(bytes=>bytes&&crypto.subtle.digest('SHA-256',bytes)).then(bytes=>bytes&&${event}({kind:'selected-source-sha',sha256:[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''),at:Date.now()}));`);
  return value;
 }
 if(flags.gameCancellationControls==='1'&&id===path.join(root,'src/recognition/recognizer.js')){
  let value=frozenSource.get(id);
  value=value.replace('  if (type === "milo-release") { releaseMiloOwner(ownerId); return; }','  if (type === "milo-release") { releaseMiloOwner(ownerId); self.postMessage({type:"native-owner-received",messageType:type,ownerId,active:miloOwnerActive,at:Date.now()}); return; }');
  value="self.addEventListener('message',({data})=>{if(data?.bmp)self.postMessage({type:'native-owner-received',messageType:'identify',ownerId:data.ownerId,scanId:data.id,point:data.point,at:Date.now()});});\n"+value;
  return value;
 }
 if(frozenSource.has(id))return frozenSource.get(id);
}};}
await build({ root: project, configFile: false, publicDir: false, plugins: [testAdapters(),react()],worker:{plugins:()=>[testAdapters()]},build:{outDir:dist,emptyOutDir:true},logLevel:"warn" });
const mime={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".wasm":"application/wasm",".bin":"application/octet-stream",".onnx":"application/octet-stream"};
const server=createServer(async(req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname);assert.ok(!pathname.includes(".."));let file=sceneFixtureDir&&/^\/__native-scene-fixture\/(manifest\.json|\d{2}\.png)$/.test(pathname)?path.join(sceneFixtureDir,path.basename(pathname)):path.join(dist,pathname==='/'?'index.html':pathname);try{await stat(file);}catch{file=path.join(root,"public",pathname);}const data=await readFile(file);res.setHeader("Content-Type",mime[path.extname(file)]||"application/octet-stream");res.end(data);}catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
process.stdout.write(`Native test build ready at ${base}\n`);
let browser,page;
try {
 browser=await chromium.launch({headless:true,executablePath:flags.chrome||process.env.SNAPCAST_CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disable-background-timer-throttling","--disable-renderer-backgrounding","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
 const context=await browser.newContext({viewport:{width:1920,height:900}});
 await context.grantPermissions(['camera','microphone'],{origin:base});
 const references=[];const referenceRequests=new Map();
 context.on('request',request=>{const url=new URL(request.url());if(url.hostname==='cards.scryfall.io'){const record={url:url.href,type:request.resourceType(),at:Date.now()};references.push(record);referenceRequests.set(request,record);}});
 context.on('requestfinished',request=>{const record=referenceRequests.get(request);if(record){record.endedAt=Date.now();referenceRequests.delete(request);}});
 context.on('requestfailed',request=>{const record=referenceRequests.get(request);if(record){record.endedAt=Date.now();record.failure=request.failure()?.errorText;referenceRequests.delete(request);}});
 await context.route("**/*",async route=>{const request=route.request(),url=new URL(request.url());if(/\.supabase\.(co|net)$/.test(url.hostname)||url.pathname.startsWith('/api/')||!["GET","HEAD","OPTIONS"].includes(request.method())){report.blockedWrites.push({method:request.method(),url:`${url.origin}${url.pathname}`});return route.abort('blockedbyclient');}return route.continue();});
 await context.addInitScript(()=>{
  localStorage.setItem('theme-preference','dark');localStorage.setItem('snapcast-video-layout','follow');
  window.__nativeSamples=[];window.__nativeWorkerResults=[];let sample=null,timings=[];
  const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);if(String(args[0]).includes('recognizer'))this.addEventListener('message',({data})=>{if(Array.isArray(data?.matches)){window.__nativeWorkerResults.push({at:performance.now(),matches:data.matches});window.__nativeWorkerResults=window.__nativeWorkerResults.slice(-5);}});}};
  Object.defineProperty(window,'__SNAP_RECOGNITION_TIMINGS',{configurable:true,get:()=>timings,set(values){timings=values;if(sample&&values.at(-1)){sample.resultAt=performance.now();sample.timing=values.at(-1);}}});
  document.addEventListener('click',event=>{if(event.target.closest?.('.tile .video-wrap')){sample={at:performance.now(),wallAt:Date.now(),images:[]};window.__nativeSamples.push(sample);}},true);
  const inspect=async image=>{if(!(image instanceof HTMLImageElement)||!image.closest('.card-hit-image')||!sample)return;const active=sample,src=image.currentSrc||image.src;if(active.images.some(v=>v.src===src))return;try{await image.decode();}catch{return;}if(sample!==active||!image.isConnected)return;let opacity=1;for(let node=image;node;node=node.parentElement)opacity*=Number(getComputedStyle(node).opacity);const record={src,kind:image.classList.contains('card-result-preview')?'preview':'normal',decodedAt:performance.now(),width:image.naturalWidth,height:image.naturalHeight,opacity};active.images.push(record);await new Promise(requestAnimationFrame);if(image.isConnected&&opacity===1)record.paintAt=performance.now();};
  document.addEventListener('load',event=>inspect(event.target),true);
  document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{if(sample?.resultAt&&!sample.titleAt&&document.querySelector('.card-hit .card-meta > b')){sample.titleAt=performance.now();sample.title=document.querySelector('.card-hit .card-meta > b').textContent;}for(const image of document.querySelectorAll('.card-hit-image img'))if(image.complete&&image.naturalWidth)inspect(image);}).observe(document.documentElement,{subtree:true,childList:true,attributes:true}),{once:true});
 });
 if(flags.gameCancellationControls==='1')await context.addInitScript(()=>{
  window.__nativeControlEvents=[];window.__movingWorkerMessages=[];window.__nativeHeldModelMessages=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.__nativeKind=String(args[0]).includes('recognizer')?'core':'model';this.addEventListener('message',({data})=>{if(data?.type==='native-owner-received')window.__nativeControlEvents.push({...data,kind:'worker-received',receivedAt:Date.now()});});}
   get onmessage(){return this.__nativeMessageHandler||null;}
   set onmessage(handler){this.__nativeMessageHandler=handler;super.onmessage=event=>{if(this.__nativeKind==='model'&&window.__nativeHoldNextModelReply&&Array.isArray(event.data?.quads)){window.__nativeHoldNextModelReply=false;window.__nativeControlEvents.push({kind:'held-model-reply',id:event.data.id,at:Date.now()});window.__nativeHeldModelMessages.push(()=>handler?.call(this,event));return;}handler?.call(this,event);};}
   postMessage(data,...rest){if(this.__nativeKind==='core'){const event={kind:'worker-post',messageType:data?.type||(data?.bmp?'identify':'other'),ownerId:data?.ownerId,id:data?.id,point:data?.point,at:Date.now()};window.__nativeControlEvents.push(event);window.__movingWorkerMessages.push(event);}return super.postMessage(data,...rest);}
  };
  window.__nativeReleaseHeldModels=()=>{const held=window.__nativeHeldModelMessages.splice(0);for(const release of held)release();window.__nativeControlEvents.push({kind:'released-held-model',count:held.length,at:Date.now()});};
  window.__nativeHoldModelReplies=()=>{window.__nativeHoldNextModelReply=true;};
  window.__nativeReleaseModelReplies=window.__nativeReleaseHeldModels;
  window.__nativeHeldModelReplyCount=()=>window.__nativeHeldModelMessages.length;
 });
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__nativeViewer?.peers.get('native-source')?.dc?.readyState==='open'&&document.querySelector('.tile video')?.videoWidth===1920,null,{timeout:30000});
 await page.waitForFunction(()=>['ready','failed'].includes(window.__SNAP_RECOGNITION_WARMUP?.status),null,{timeout:120000});
 report.warmup=await page.evaluate(()=>({core:window.__SNAP_RECOGNITION_WARMUP,milo:window.__SNAP_MILO_WARMUP}));assert.equal(report.warmup.core.status,'ready');
 assert.equal(report.warmup.milo?.status,'ready','A native benchmark must not silently disable learned recognition');
 process.stdout.write('Native data channel, decoded source video and recognition warmup ready\n');
 if(flags.gameCancellationControls==='1'){
  const controlModule=path.resolve(flags.gameControlsModule||'scripts/native_game_cancellation_controls.mjs');
  report.controlInstrumentation={harnessSHA256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),module:controlModule,moduleSHA256:createHash('sha256').update(await readFile(controlModule)).digest('hex'),purpose:'Loopback test-only sampling, source-painter, owner/worker events, first/final SHA and held detector reply instrumentation. Production source fingerprints remain recorded separately.'};
  const {runNativeGameControls}=await import(controlModule);
  await runNativeGameControls({page,report,output,save,options:{...flags,requireEarly:flags.requireEarly!=='0'&&flags.requireEarly!=='false'}});await save();
 }
 if(flags.temporalControls==='1'){
  assert.equal(baseline,'','Progressive temporal controls run against current source, not a legacy baseline');
  report.temporalControls=await page.evaluate(async()=>{
   const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
   for(const remote of [false,true])for(const blurFirst of [false,true]){
    window.__nativeBlur=blurFirst?7:0;window.__nativePaintSource();await wait(160);const at=performance.now();let first=null,calls=0,firstAt=null;
    const opts={onFirstFrame:value=>{first=value;calls++;firstAt=performance.now();if(blurFirst){window.__nativeBlur=0;window.__nativePaintSource();}}};
    const cap=remote?await window.__nativeViewer.requestRemoteCapture('native-source',.5,.5,opts):await window.__nativeCaptureLocal(window.__nativeOwner.localStream,.5,.5,opts);
    const trace=window.__nativeCaptureRecords.at(-1),item={remote,blurFirst,calls,firstSelected:cap.firstSelected,sameBlob:cap.blob===first?.blob,firstMs:Math.round(firstAt-at),finalMs:Math.round(performance.now()-at),firstHash:first?await digest(first.blob):null,finalHash:await digest(cap.blob),trace};results.push(item);URL.revokeObjectURL(cap.url);window.__nativeBlur=0;
   }
   const cap=await window.__nativeViewer.requestRemoteCapture('native-source',.5,.5);results.push({remote:true,legacy:true,firstSelected:cap.firstSelected,finalHash:await digest(cap.blob),trace:window.__nativeCaptureRecords.at(-1)});URL.revokeObjectURL(cap.url);return results;
  });
  for(const item of report.temporalControls){assert.equal(item.trace.frames.length,3);for(let index=1;index<3;index++)assert.ok(item.trace.frames[index].at-item.trace.frames[index-1].at>=110);if(!item.legacy){assert.equal(item.calls,1);assert.equal(item.firstSelected,!item.blurFirst);assert.equal(item.sameBlob,!item.blurFirst);if(item.blurFirst){assert.notEqual(item.firstHash,item.finalHash);assert.ok(item.trace.selected>0);}else assert.equal(item.firstHash,item.finalHash);}}
  assert.equal(report.temporalControls.at(-1).finalHash,report.temporalControls.find(item=>item.remote&&!item.blurFirst&&!item.legacy).finalHash,'Native legacy and progressive static winners retain byte-identical JPEG pixels');
  process.stdout.write('Native local/remote temporal controls passed: exact first winner, later sharpness fallback and legacy identical pixels\n');
 }
 for(let scene=startScene;flags.controlsOnly!=='1'&&scene<Math.min(20,startScene+scenes);scene++){
  const items=await page.evaluate(scene=>scene===window.__nativeItems[0]?.scene?window.__nativeItems:window.__nativeSetScene(scene),scene);
  const file=`${String(scene).padStart(2,'0')}.png`;
  const png=await page.evaluate(()=>window.__nativeScene.canvas.toDataURL('image/png'));
  const pngBytes=Buffer.from(png.split(',')[1],'base64');await writeFile(path.join(sceneExports,file),pngBytes);
  report.scenes||=[];report.scenes.push({scene,file,sha256:createHash('sha256').update(pngBytes).digest('hex'),items});
  await writeFile(path.join(sceneExports,'manifest.json'),JSON.stringify({catalogDigests:report.catalogDigests,scenes:report.scenes},null,2)+'\n');
  const cameraProof=await page.evaluate(()=>window.__nativeProveStaticCamera());
  assert.equal(cameraProof.opaque,true,'Every source-camera pixel must be opaque after compositing');
  assert.equal(cameraProof.equal,true,'Repeated static camera paints cannot accumulate source alpha');
  assert.equal(cameraProof.firstRGBAsha256,cameraProof.tenthRGBAsha256,'One and ten camera repaints must have exactly the same RGBA bytes');
  report.cameraSourceProof||=[];report.cameraSourceProof.push({scene,...cameraProof});
  await page.waitForTimeout(180); // Receive the changed source scene before clicking; excluded from click timing.
  for(const [index,item] of items.entries()){
   if(indices&&!indices.includes(index))continue;
   if(cases&&!cases.has(scene*10+index))continue;
   const row={...item,index,fresh:null,repeat:null};
   for(const mode of repeat?['fresh','repeat']:['fresh']){
    if(mode==='fresh')await page.evaluate(()=>window.__nativeClearHints());
    // Preserve the production request budget: do not replenish tokens in the test.
    await page.waitForFunction(()=>{const p=window.__nativeOwner.peers.get('native-viewer');return Math.min(4,(p.capTokens??4)+(Date.now()-(p.capTokensAt||0))/1200)>=1.02;},null,{timeout:15000});
    const before=await page.evaluate(()=>window.__nativeSamples.length);
    const point=await page.locator('.tile video').evaluate((video,p)=>{const r=video.getBoundingClientRect(),scale=getComputedStyle(video).objectFit==='contain'?Math.min(r.width/video.videoWidth,r.height/video.videoHeight):Math.max(r.width/video.videoWidth,r.height/video.videoHeight);return {x:r.left+(r.width-video.videoWidth*scale)/2+p.nx*video.videoWidth*scale,y:r.top+(r.height-video.videoHeight*scale)/2+p.ny*video.videoHeight*scale,visible:p.nx*video.videoWidth*scale+(r.width-video.videoWidth*scale)/2>=0&&p.nx*video.videoWidth*scale+(r.width-video.videoWidth*scale)/2<=r.width&&p.ny*video.videoHeight*scale+(r.height-video.videoHeight*scale)/2>=0&&p.ny*video.videoHeight*scale+(r.height-video.videoHeight*scale)/2<=r.height};},item);
    assert.ok(point.visible,'Actual rendered click must be visible');
    await page.mouse.click(point.x,point.y);
    await page.waitForFunction(n=>window.__nativeSamples.length===n+1&&window.__nativeSamples.at(-1)?.timing&&(document.querySelector('.card-empty-state.failed,.lookup-status.error')||window.__nativeSamples.at(-1).images.some(image=>image.paintAt)),before,{timeout:90000});
    row[mode]=await page.evaluate(()=>{const s=window.__nativeSamples.at(-1),image=s.images.find(v=>v.kind==='preview'&&v.paintAt)||s.images.find(v=>v.paintAt),hit=document.querySelector('.card-hit'),normal=hit?.querySelector('.card-result-normal'),record=window.__nativeMatcherData,winner=record?.at>=s.at?record.matches?.find(match=>match.image===normal?.src):null;return {wallAt:s.wallAt,got:hit?.querySelector('.card-meta > b')?.textContent||null,by:winner?.identified_by||null,confidence:winner?.confidence??null,aiCrop:record?.ai_crop||null,milo:record?.milo||null,orb:record?.orb_timing||null,miloOrb:record?.milo_orb_timing||null,wasmHeapMB:record?.wasm_heap_mb,jsHeapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,winner:winner?{id:winner.scryfall_id,face:winner.face||0,distance:winner.distance,strategy:winner.strategy,clickInside:winner.click_inside,regionalProof:winner.regional_proof}:null,timing:s.timing,capture:window.__nativeCaptureRecords.at(-1),send:window.__nativeOwner.captureTrace.at(-1),titleMs:s.titleAt?Math.round(s.titleAt-s.at):null,displayMs:image?Math.round(image.paintAt-s.at):null,previewMs:image&&s.resultAt?Math.round(image.paintAt-s.resultAt):null,image:image?{width:image.width,height:image.height,opacity:image.opacity,kind:image.kind}:null};});
    row[mode].references=references.filter(request=>request.at>=row[mode].wallAt).map(request=>({...request,startMs:request.at-row[mode].wallAt,durationMs:request.endedAt?request.endedAt-request.at:null}));
    row[mode].correct=row[mode].got===item.name;
    process.stdout.write(`${scene*10+index+1}/200 ${item.name} ${mode}: ${row[mode].correct} ${row[mode].displayMs}ms (capture ${row[mode].timing.captureMs}, recognition ${row[mode].timing.recognitionMs}, hint ${row[mode].timing.hintHit})\n`);
   }
   report.rows.push(row);await save();
  }
 }
 report.nativeErrors=await page.evaluate(()=>window.__nativeErrors);assert.deepEqual(report.nativeErrors,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);
 if(sceneFixtureDir){const frozen=JSON.parse(await readFile(path.join(sceneFixtureDir,'manifest.json'),'utf8'));assert.deepEqual(frozen.catalogDigests,report.catalogDigests,'Replay source scenes must use the identical current catalog');}
 for(const file of assetFiles)assert.equal(createHash('sha256').update(await readFile(path.join(root,file))).digest('hex'),report.catalogDigests[file],'Catalog must remain frozen for the entire run');
 await page.screenshot({path:path.join(output,'final-game.png'),fullPage:true});
 report.ok=true;
}catch(error){report.failure=error.stack||String(error);if(page){report.failureView=await page.locator('body').innerText().catch(()=>null);report.failureState=await page.evaluate(()=>{const inspect=conn=>conn?{id:conn.myId,roster:conn.roster,pendingSignals:[...conn.pendingSignals],pendingIce:[...conn.pendingIce],tracks:conn.localStream?.getTracks().map(track=>({kind:track.kind,readyState:track.readyState,enabled:track.enabled,settings:track.getSettings()})),peers:[...conn.peers].map(([id,entry])=>({id,state:entry.pc.connectionState,signaling:entry.pc.signalingState,ice:entry.pc.iceConnectionState,local:entry.pc.localDescription?.type,remote:entry.pc.remoteDescription?.type,dc:entry.dc?.readyState,senders:entry.pc.getSenders().map(sender=>({kind:sender.track?.kind})),receivers:entry.pc.getReceivers().map(receiver=>({kind:receiver.track?.kind,muted:receiver.track?.muted}))}))}:null;return {errors:window.__nativeErrors,diagnostics:window.__SNAP_CONNECTION_DIAGNOSTICS,warmup:window.__SNAP_RECOGNITION_WARMUP,viewer:inspect(window.__nativeViewer),owner:inspect(window.__nativeOwner),videos:[...document.querySelectorAll('video')].map(video=>({width:video.videoWidth,height:video.videoHeight,paused:video.paused})),timing:window.__SNAP_RECOGNITION_TIMINGS,samples:window.__nativeSamples};}).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}throw error;
}finally{await save();if(browser)for(const context of browser.contexts())await context.unrouteAll({behavior:'wait'});await browser?.close();await new Promise(resolve=>server.close(resolve));}
function summarize(report,mode){
 const rows=report.rows.filter(row=>row[mode]);const values=rows.map(row=>row[mode]);const percentile=key=>{const list=values.map(value=>value[key]).filter(Number.isFinite).sort((a,b)=>a-b);return {p50:list[Math.floor(list.length*.5)]??null,p90:list[Math.min(list.length-1,Math.floor(list.length*.9))]??null,max:list.at(-1)??null};};
 const group=(key,bucket=value=>String(value))=>Object.fromEntries([...new Set(rows.map(row=>bucket(row[key])))].map(value=>{const list=rows.filter(row=>bucket(row[key])===value);return [value,{n:list.length,correct:list.filter(row=>row[mode].correct).length,correctUnder1s:list.filter(row=>row[mode].correct&&Number.isFinite(row[mode].displayMs)&&row[mode].displayMs<1000).length}];}));
 const accepted=values.filter(value=>['art-match','visual-exact'].includes(value.by));
 return {n:values.length,correct:values.filter(v=>v.correct).length,correctUnder1s:values.filter(v=>v.correct&&Number.isFinite(v.displayMs)&&v.displayMs<1000).length,hintHits:values.filter(v=>v.timing.hintHit).length,prepared:values.filter(v=>v.aiCrop?.prepared).length,displayMs:percentile('displayMs'),titleMs:percentile('titleMs'),captureMs:percentileNested('captureMs'),recognitionMs:percentileNested('recognitionMs'),captureOverlapMs:percentileNested('captureOverlap'),wasmHeapMB:[values[0]?.wasmHeapMB,values.at(-1)?.wasmHeapMB],firstHalfCorrect:values.slice(0,Math.floor(values.length/2)).filter(v=>v.correct).length,secondHalfCorrect:values.slice(Math.floor(values.length/2)).filter(v=>v.correct).length,byRotation:group('rotation'),byCoverage:group('coverage',v=>v===0?'clear':v<.15?'0-15%':v<.3?'15-30%':'30%+'),byPool:group('pool'),byLayout:group('layout'),neighbourMisses:rows.filter(row=>!row[mode].correct&&report.rows.some(other=>other.scene===row.scene&&other.name===row[mode].got)).map(row=>({scene:row.scene,index:row.index,expected:row.name,got:row[mode].got})),selectedFrames:groupFromFrames(),accepted:{n:accepted.length,correct:accepted.filter(value=>value.correct).length},byPathway:Object.fromEntries([...new Set(values.map(value=>value.by||'(unresolved)'))].map(key=>{const list=values.filter(value=>(value.by||'(unresolved)')===key);return [key,{n:list.length,correct:list.filter(value=>value.correct).length}];}))};
 function percentileNested(key){const list=values.map(value=>key==='captureOverlap'?value.timing.stages?.captureOverlap:value.timing[key]).filter(Number.isFinite).sort((a,b)=>a-b);return {p50:list[Math.floor(list.length*.5)]??null,p90:list[Math.min(list.length-1,Math.floor(list.length*.9))]??null,max:list.at(-1)??null};}
 function groupFromFrames(){return Object.fromEntries([0,1,2].map(index=>[index,values.filter(value=>value.capture?.selected===index).length]));}
}
async function save(){report.summary={fresh:summarize(report,'fresh'),...(repeat?{repeat:summarize(report,'repeat')}:{})};await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
