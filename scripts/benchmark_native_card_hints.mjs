#!/usr/bin/env node
// Real prior card -> nearby replacement, through actual compiled Game/native RTC.
// Frozen public SNAPTEST scenes and loopback signaling are the only adapters.
// Every captured q.9 JPEG and click/crop geometry must match the archived corpus.
// Account/API writes are blocked; recognition scoring and gates stay production.
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
const artifactRoot = path.join(root, "snaptest/runs/2026-10-11-milo-click-release");
if (flags.help) {
  console.log(`Native stale-hint recognition probe (no account/API writes):
  --selection=PATH      Archived 20-case selection (default: release stale-hints-selection.json)
  --sourceProof=PATH    Source/card SHA proof (default: release stale-hints-control-20.json, build33)
  --controlProof=PATH   Full200 native pixel/metadata corpus (default: release native-control-200.json)
  --sceneFixtures=DIR   Lossless scene PNGs + manifest (default: .cache/native-delivery-control/scenes)
  --output=DIR          New result/JPEG/compiled directory (default: .cache/native-card-hints)
  --allowSourceChange=1 Explicitly compare a new source snapshot with the pinned control
  --baseline=GIT_REF    Freeze application source at a specified Git revision
  --limit=N            Run the first N cases (default20)
  --validateOnly=1     Check selection/source/catalog/fixture SHA without a browser
  --summarize=PATH      Recompute a saved hints report summary without a browser
Source files and catalog are fingerprinted separately. No-hint/stale-hint arm order
alternates; caches remain shared, so the second arm may be warmer. Timing includes
actual Game pointer capture/data channel/sidebar picture but excludes physical
camera, NAT, and first-visit model downloads. Missing JPEG/geometry parity fails.`);
  process.exit(0);
}
if (flags.summarize) {
  const savedPath = path.resolve(flags.summarize), saved = JSON.parse(await readFile(savedPath, "utf8"));
  saved.summary = summarizeHints(saved);
  await writeFile(savedPath, JSON.stringify(saved, null, 2) + "\n");
  console.log(JSON.stringify(saved.summary, null, 2));
  process.exit(0);
}
const caseLimit=Number(flags.limit||20);assert.ok(Number.isInteger(caseLimit)&&caseLimit>=1&&caseLimit<=20,"--limit must be an integer1..20");
const selectionPath=path.resolve(flags.selection||path.join(artifactRoot,"stale-hints-selection.json"));
const sourceProofPath=path.resolve(flags.sourceProof||path.join(artifactRoot,"stale-hints-control-20.json"));
const controlProofPath=path.resolve(flags.controlProof||path.join(artifactRoot,"native-control-200.json"));
const probeSelection=JSON.parse(await readFile(selectionPath,"utf8")).selection;
const sourceProof=JSON.parse(await readFile(sourceProofPath,"utf8"));
const baselineProof=JSON.parse(await readFile(controlProofPath,"utf8"));
assert.equal(sourceProof.ok,true);assert.equal(baselineProof.ok,true);assert.equal(baselineProof.rows.length,200);
assert.deepEqual(sourceProof.catalogDigests,baselineProof.catalogDigests);
assert.equal(probeSelection.length,20);assert.equal(new Set(probeSelection.map(row=>row.i)).size,20);
for(const row of probeSelection){
 const target=baselineProof.rows.find(item=>item.scene===row.scene&&item.index===row.index),old=baselineProof.rows.find(item=>item.scene===row.oldScene&&item.index===row.oldIndex);
 assert.ok(target&&old,"Selected source and replacement exist in pinned corpus");
 assert.equal(target.name,row.expectedName);assert.equal(old.name,row.oldName);assert.notEqual(old.name,target.name,"Stale hint is a different card identity");
 assert.equal(old.fresh.correct,true);assert.ok(["art-match","visual-exact"].includes(old.fresh.by));
 assert.equal(row.oldCapture.sha256,old.fresh.capture.sha256);assert.equal(row.targetCapture.sha256,target.fresh.capture.sha256);
}
const baseline=flags.baseline||"";
const sourceFiles=(baseline?execFileSync("git",["ls-tree","-r","--name-only",baseline,"--","src"],{cwd:root,encoding:"utf8"}):execFileSync("rg",["--files","src"],{cwd:root,encoding:"utf8"})).trim().split("\n").filter(file=>/\.(jsx?|css)$/.test(file));
const frozenSource=new Map(await Promise.all(sourceFiles.map(async file=>[path.join(root,file),baseline?execFileSync("git",["show",`${baseline}:${file}`],{cwd:root,encoding:"utf8"}):await readFile(path.join(root,file),"utf8")])));
const readSource=file=>frozenSource.get(path.join(root,file));
const output = path.resolve(flags.output || path.join(root, ".cache/native-card-hints"));
const sceneFixtureDir=path.resolve(flags.sceneFixtures||path.join(root,".cache/native-delivery-control/scenes"));
const fixtureManifest=JSON.parse(await readFile(path.join(sceneFixtureDir,"manifest.json"),"utf8"));
assert.deepEqual(fixtureManifest.catalogDigests,baselineProof.catalogDigests);
for(const scene of new Set(probeSelection.flatMap(row=>[row.scene,row.oldScene]))){
 const fixture=fixtureManifest.scenes.find(item=>item.scene===scene);assert.ok(fixture,"Lossless scene metadata exists");
 assert.equal(fixture.file,`${String(scene).padStart(2,"0")}.png`);
 assert.equal(createHash("sha256").update(await readFile(path.join(sceneFixtureDir,fixture.file))).digest("hex"),fixture.sha256,"Frozen lossless scene PNG SHA");
}
const sceneExports=path.join(output,'scenes');await mkdir(sceneExports,{recursive:true});
const startScene = probeSelection[0].oldScene;
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
const report = { ok: false, build: JSON.parse(buildMarker), baseline:baseline||null, commit: execFileSync("git", ["rev-parse", baseline||"HEAD"], { cwd: root, encoding: "utf8" }).trim(), sample: "Twenty deterministic nearby stale-hint replacements from authoritative SNAPTEST realLife200, seed20260803", rows: [], errors: [], blockedWrites: [], limitations: [
  "Actual compiled Game pointer handler, three native HTML-video samples 120 ms apart, production sharpness selection/JPEG crop, native RTC data channel, real matcher and actual sidebar.",
  "Only source media and signaling are adapted: deterministic 1920x1080 SNAPTEST canvas MediaStream tracks and loopback memory signaling; no physical camera, microphone, real room, STUN, TURN or remote NAT.",
  "Recognition models/index are warmed. Frame crop is encoded at production JPEG quality 0.9, which differs from supplied-image SNAPTEST quality 0.62; the resulting input is not pixel-identical to that benchmark.",
  "Fresh clears only the test Game's room-hint ref before the actual pointer click. Prior cards can still warm reference caches. Immediate repeats keep the newly verified hint; this does not measure first-visit downloads.",
  "Paint is approximated by decoded image pixels at full ancestor opacity plus the following requestAnimationFrame; this does not measure physical screen scanout."
] };
report.limitations.push('The canvas camera composites each source scene onto opaque black before every repaint. Transparent playmat pixels must not accumulate through repeated source-over draws; each static camera frame therefore has the same pixels.');
report.sceneFixtureSource=sceneFixtureDir;report.proofInputs={selection:selectionPath,sourceProof:sourceProofPath,controlProof:controlProofPath};
report.limitations.push('Each source scene is exported losslessly with its exact click metadata; --sceneFixtures replays those same pixels for the other arm. Native JPEG hashes must still match before comparing accuracy or latency.');
report.sourceDigests=Object.fromEntries(sourceFiles.sort().map(file=>[file,createHash('sha256').update(readSource(file)).digest('hex')]));
const assetFiles=['public/carddata/manifest.json','public/carddata/cards.json','public/carddata/milo/manifest.json'];
report.catalogDigests=Object.fromEntries(await Promise.all(assetFiles.map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])));
report.originalControlSourceDigests=sourceProof.sourceDigests;report.originalControlBuild=sourceProof.build;report.intentionalSourceChange=flags.allowSourceChange==='1';if(!report.intentionalSourceChange)for(const file of sourceFiles)assert.equal(report.sourceDigests[file],sourceProof.sourceDigests[file],'Candidate source must remain frozen '+file);assert.deepEqual(report.catalogDigests,sourceProof.catalogDigests);
report.catalog={manifest:JSON.parse(await readFile(path.join(root,'public/carddata/manifest.json'),'utf8')),milo:JSON.parse(await readFile(path.join(root,'public/carddata/milo/manifest.json'),'utf8'))};
report.limitations.push('Baseline freezes application source at the requested Git revision; both arms intentionally serve the same current working catalog. Manifest/cards SHA256 and Milo model/gallery IDs are recorded separately.');
if(flags.validateOnly==='1'){
 const validation={ok:true,build:report.build,selectionCases:probeSelection.length,plannedCases:caseLimit,catalogDigests:report.catalogDigests,sourceDigests:report.sourceDigests,intentionalSourceChange:report.intentionalSourceChange,proofInputs:report.proofInputs,scope:'Archive/source/catalog/scene validation only; no native JPEG capture or latency measured'};
 const file=path.join(output,'validation.json');await writeFile(file,JSON.stringify(validation,null,2)+'\n');
 console.log(JSON.stringify({ok:true,build:report.build,plannedCases:caseLimit,sourceFiles:sourceFiles.length,validationFile:file}));process.exit(0);
}
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
await writeFile(path.join(project, "entry.jsx"), entry);
function testAdapters(){return {name:"native-only-test-adapters",enforce:"pre",async load(id){
 if(id===path.join(root,"src/signaling.js"))return signaling;
 if(id===path.join(root,"src/LocalMockGameConnection.js"))return adapter;
 if(id===path.join(root,"src/webrtc.js")){
  let value=frozenSource.get(id);
  value=value.replace(/async function captureFrameSet\(state, nx, ny(?:, options)?\) \{/,match=>`${match}\n const captureTrace={at:performance.now(),nx,ny,frames:[]};const recordCapture=(blob,best,firstSelected=false)=>{captureTrace.endedAt=performance.now();captureTrace.width=best.width;captureTrace.height=best.height;captureTrace.geometry={...geom};captureTrace.bytes=blob.size;captureTrace.firstSelected=firstSelected;window.__nativeCaptureRecords.push(captureTrace);void blob.arrayBuffer().then(async bytes=>{captureTrace.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');let binary='';for(const byte of new Uint8Array(bytes))binary+=String.fromCharCode(byte);captureTrace.jpegBase64=btoa(binary);});};`);
  value=value.replace('const score = captureSharpness(state, canvas);','const score = captureSharpness(state, canvas);\n captureTrace.frames.push({index:i,at:performance.now(),score});');
  value=value.replace('bestScore = score;','bestScore = score; captureTrace.selected=i;');
  value=value.replace('const blob = await canvasToBlob(best);','const blob = await canvasToBlob(best);\n recordCapture(blob,best);');
  value=value.replace('returnedFirst = true;','returnedFirst = true;recordCapture(first.blob,best,true);');
  return value;
 }
 if(id===path.join(root,'src/Game.jsx')){
  let value=frozenSource.get(id);
  value=value.replace('const recognitionHintsRef = useRef([]);','const recognitionHintsRef = useRef([]);window.__nativeClearHints=()=>{recognitionHintsRef.current=[];};window.__nativeReadHints=()=>JSON.parse(JSON.stringify(recognitionHintsRef.current));window.__nativeRestoreHints=values=>{recognitionHintsRef.current=JSON.parse(JSON.stringify(values));};');
  value=value.replace('const data = await identifyCard(cap.blob || cap.url, {','window.__nativeIdentifyHints=JSON.parse(JSON.stringify(hints));\nconst data = await identifyCard(cap.blob || cap.url, {');
  value=value.replace('const recognitionMs = Math.round(performance.now() - recognitionStartedAt);','window.__nativeMatcherData={at:performance.now(),ai_crop:data.ai_crop,milo:data.milo,matches:data.matches,hint_hit:data.hint_hit,wasm_heap_mb:data.wasm_heap_mb};\nconst recognitionMs = Math.round(performance.now() - recognitionStartedAt);');
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
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__nativeViewer?.peers.get('native-source')?.dc?.readyState==='open'&&document.querySelector('.tile video')?.videoWidth===1920,null,{timeout:30000});
 await page.waitForFunction(()=>['ready','failed'].includes(window.__SNAP_RECOGNITION_WARMUP?.status),null,{timeout:120000});
 report.warmup=await page.evaluate(()=>({core:window.__SNAP_RECOGNITION_WARMUP,milo:window.__SNAP_MILO_WARMUP}));assert.equal(report.warmup.core.status,'ready');
 assert.equal(report.warmup.milo?.status,'ready','A native benchmark must not silently disable learned recognition');
 process.stdout.write('Native data channel, decoded source video and recognition warmup ready\n');
 report.probeScope='Actual compiled Game pointer click → native remote camera three-frame capture/production q.9 JPEG → native RTC data channel → real matcher → actual sidebar. Same frozen candidate source (build recorded below) no-hint vs one real verified previous-scene nearby stale hint. Both model/index warmed; no physical camera/NAT. No replacement expected outcome was used to select cases.';
 report.selection=probeSelection;
 report.limitations=report.limitations.filter(value=>!value.startsWith('Fresh clears'));
 report.limitations.push('Each case first clicks its real previous-scene card with an empty hint ref. The verified hint generated by production Game is snapshotted, then replacement is clicked with that snapshot or an empty ref. Arm order alternates; reference caches remain shared and the second arm may be warmer. The original 200 native JPEG SHA is asserted for every scan before accepting comparison.');
 async function setScene(scene){await page.evaluate(scene=>window.__nativeSetScene(scene),scene);await page.waitForTimeout(180);}
 async function scan(item,label,expectedSha){
  await page.waitForFunction(()=>{const p=window.__nativeOwner.peers.get('native-viewer');return Math.min(4,(p.capTokens??4)+(Date.now()-(p.capTokensAt||0))/1200)>=1.02;},null,{timeout:15000});
  const before=await page.evaluate(()=>window.__nativeSamples.length);
  const point=await page.locator('.tile video').evaluate((video,p)=>{const r=video.getBoundingClientRect(),scale=getComputedStyle(video).objectFit==='contain'?Math.min(r.width/video.videoWidth,r.height/video.videoHeight):Math.max(r.width/video.videoWidth,r.height/video.videoHeight);return {x:r.left+(r.width-video.videoWidth*scale)/2+p.nx*video.videoWidth*scale,y:r.top+(r.height-video.videoHeight*scale)/2+p.ny*video.videoHeight*scale,visible:p.nx*video.videoWidth*scale+(r.width-video.videoWidth*scale)/2>=0&&p.nx*video.videoWidth*scale+(r.width-video.videoWidth*scale)/2<=r.width&&p.ny*video.videoHeight*scale+(r.height-video.videoHeight*scale)/2>=0&&p.ny*video.videoHeight*scale+(r.height-video.videoHeight*scale)/2<=r.height};},item);
  assert.ok(point.visible);
  const hintsBefore=await page.evaluate(()=>window.__nativeReadHints());
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(n=>window.__nativeSamples.length===n+1&&window.__nativeSamples.at(-1)?.timing&&(document.querySelector('.card-empty-state.failed,.lookup-status.error')||window.__nativeSamples.at(-1).images.some(image=>image.paintAt)),before,{timeout:90000});
  await page.waitForFunction(()=>window.__nativeCaptureRecords.at(-1)?.sha256&&window.__nativeCaptureRecords.at(-1)?.jpegBase64,null,{timeout:5000});
  const result=await page.evaluate(()=>{const s=window.__nativeSamples.at(-1),image=s.images.find(v=>v.kind==='preview'&&v.paintAt)||s.images.find(v=>v.paintAt),hit=document.querySelector('.card-hit'),normal=hit?.querySelector('.card-result-normal'),record=window.__nativeMatcherData,winner=record?.at>=s.at?record.matches?.find(match=>match.image===normal?.src):null;return {wallAt:s.wallAt,got:hit?.querySelector('.card-meta > b')?.textContent||null,by:winner?.identified_by||null,confidence:winner?.confidence??null,aiCrop:record?.ai_crop||null,milo:record?.milo||null,hintHit:record?.hint_hit||false,identifyHints:window.__nativeIdentifyHints,wasmHeapMB:record?.wasm_heap_mb,winner:winner?{id:winner.scryfall_id,face:winner.face||0,distance:winner.distance,strategy:winner.strategy,clickInside:winner.click_inside,regionalProof:winner.regional_proof}:null,timing:s.timing,capture:window.__nativeCaptureRecords.at(-1),send:window.__nativeOwner.captureTrace.at(-1),titleMs:s.titleAt?Math.round(s.titleAt-s.at):null,displayMs:image?Math.round(image.paintAt-s.at):null,previewMs:image&&s.resultAt?Math.round(image.paintAt-s.resultAt):null,image:image?{width:image.width,height:image.height,opacity:image.opacity,kind:image.kind}:null};});
  result.hintsBefore=hintsBefore;result.correct=result.got===item.name;
  const jpg=Buffer.from(result.capture.jpegBase64,'base64');delete result.capture.jpegBase64;
  await mkdir(path.join(output,'jpegs'),{recursive:true});result.jpegFile=`jpegs/${label}.jpg`;await writeFile(path.join(output,result.jpegFile),jpg);
  assert.equal(createHash('sha256').update(jpg).digest('hex'),result.capture.sha256);
  assert.equal(result.capture.sha256,expectedSha,'Exactly the same native q.9 JPEG pixels as completed paired 200: '+label);
  const expectedCapture=label.endsWith('-old')?probeSelection.find(row=>label.startsWith(row.i+'-')).oldCapture:probeSelection.find(row=>label.startsWith(row.i+'-')).targetCapture;assert.deepEqual(result.capture.geometry,expectedCapture.geometry,'Identical actual click/crop geometry '+label);
  return result;
 }
 for(const pair of probeSelection.slice(0,caseLimit)){
  const oldItem=baselineProof.rows.find(row=>row.scene===pair.oldScene&&row.index===pair.oldIndex),item=baselineProof.rows.find(row=>row.scene===pair.scene&&row.index===pair.index);
  const row={...pair,oldWarm:null,noHints:null,staleHint:null};
  await page.evaluate(()=>window.__nativeClearHints());await setScene(pair.oldScene);
  row.oldWarm=await scan(oldItem,`${pair.i}-old`,pair.oldCapture.sha256);
  assert.equal(row.oldWarm.correct,true,'The prior card must be reproduced as a real verified result');
  assert.ok(['art-match','visual-exact'].includes(row.oldWarm.by));
  assert.equal(row.oldWarm.winner.id,pair.oldVerifiedNative.winner.id,'Hint printing comes from actual paired native winner');
  assert.equal(row.oldWarm.winner.face,pair.oldVerifiedNative.winner.face||0);
  const oldHints=await page.evaluate(()=>window.__nativeReadHints());
  assert.equal(oldHints.length,1);assert.equal(oldHints[0].card.scryfall_id,row.oldWarm.winner.id);assert.equal(oldHints[0].ownerId,'native-source');
  row.realPriorHint=oldHints[0];
  await setScene(pair.scene);
  for(const mode of pair.i%2?['staleHint','noHints']:['noHints','staleHint']){
   await page.evaluate(({mode,oldHints})=>mode==='noHints'?window.__nativeClearHints():window.__nativeRestoreHints(oldHints),{mode,oldHints});
   row[mode]=await scan(item,`${pair.i}-${mode}`,pair.targetCapture.sha256);
   if(mode==='staleHint'){assert.equal(row[mode].hintsBefore.length,1);assert.equal(row[mode].identifyHints.length,1);assert.equal(row[mode].identifyHints[0].scryfall_id,row.oldWarm.winner.id);}else{assert.equal(row[mode].hintsBefore.length,0);assert.equal(row[mode].identifyHints.length,0);}
  }
  report.rows.push(row);await save();
  process.stdout.write(JSON.stringify({case:pair.i,new:pair.expectedName,old:pair.oldName,noHints:row.noHints.displayMs,staleHint:row.staleHint.displayMs,noHintCorrect:row.noHints.correct,staleCorrect:row.staleHint.correct,staleBy:row.staleHint.by,staleAI:row.staleHint.aiCrop?.status})+'\n');
 }
 assert.equal(report.rows.length,caseLimit);
 report.nativeErrors=await page.evaluate(()=>window.__nativeErrors);assert.deepEqual(report.nativeErrors,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);
 if(sceneFixtureDir){const frozen=JSON.parse(await readFile(path.join(sceneFixtureDir,'manifest.json'),'utf8'));assert.deepEqual(frozen.catalogDigests,report.catalogDigests,'Replay source scenes must use the identical current catalog');}
 for(const file of assetFiles)assert.equal(createHash('sha256').update(await readFile(path.join(root,file))).digest('hex'),report.catalogDigests[file],'Catalog must remain frozen for the entire run');
 await page.screenshot({path:path.join(output,'final-game.png'),fullPage:true});
 report.ok=true;
}catch(error){report.failure=error.stack||String(error);if(page){report.failureView=await page.locator('body').innerText().catch(()=>null);report.failureState=await page.evaluate(()=>{const inspect=conn=>conn?{id:conn.myId,roster:conn.roster,pendingSignals:[...conn.pendingSignals],pendingIce:[...conn.pendingIce],tracks:conn.localStream?.getTracks().map(track=>({kind:track.kind,readyState:track.readyState,enabled:track.enabled,settings:track.getSettings()})),peers:[...conn.peers].map(([id,entry])=>({id,state:entry.pc.connectionState,signaling:entry.pc.signalingState,ice:entry.pc.iceConnectionState,local:entry.pc.localDescription?.type,remote:entry.pc.remoteDescription?.type,dc:entry.dc?.readyState,senders:entry.pc.getSenders().map(sender=>({kind:sender.track?.kind})),receivers:entry.pc.getReceivers().map(receiver=>({kind:receiver.track?.kind,muted:receiver.track?.muted}))}))}:null;return {errors:window.__nativeErrors,diagnostics:window.__SNAP_CONNECTION_DIAGNOSTICS,warmup:window.__SNAP_RECOGNITION_WARMUP,viewer:inspect(window.__nativeViewer),owner:inspect(window.__nativeOwner),videos:[...document.querySelectorAll('video')].map(video=>({width:video.videoWidth,height:video.videoHeight,paused:video.paused})),timing:window.__SNAP_RECOGNITION_TIMINGS,samples:window.__nativeSamples};}).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}throw error;
}finally{await save();await browser?.close();await new Promise(resolve=>server.close(resolve));}
function summarizeHints(report) {
 const percentile=(values,p)=>{values=values.filter(Number.isFinite).sort((a,b)=>a-b);return values[Math.min(values.length-1,Math.floor(values.length*p))]??null;};
 return Object.fromEntries(["noHints","staleHint"].map(mode=>{
  const rows=report.rows.map(row=>row[mode]).filter(Boolean);
  const accepted=rows.filter(row=>["art-match","visual-exact","recent-hint","ocr-title"].includes(row.by));
  return [mode,{n:rows.length,correct:rows.filter(row=>row.correct).length,
   correctUnder1s:rows.filter(row=>row.correct&&Number.isFinite(row.displayMs)&&row.displayMs<1000).length,
   hintHits:rows.filter(row=>row.hintHit).length,prepared:rows.filter(row=>row.aiCrop?.prepared).length,
   accepted:{n:accepted.length,correct:accepted.filter(row=>row.correct).length},
   byPathway:Object.fromEntries([...new Set(rows.map(row=>row.by||"(unresolved)"))].map(by=>{const selected=rows.filter(row=>(row.by||"(unresolved)")===by);return[by,{n:selected.length,correct:selected.filter(row=>row.correct).length}];})),
   displayMs:{p50:percentile(rows.map(row=>row.displayMs),.5),p90:percentile(rows.map(row=>row.displayMs),.9),max:percentile(rows.map(row=>row.displayMs),1)},
   recognitionMs:{p50:percentile(rows.map(row=>row.timing.recognitionMs),.5),p90:percentile(rows.map(row=>row.timing.recognitionMs),.9)},
   captureMs:{p50:percentile(rows.map(row=>row.timing.captureMs),.5),p90:percentile(rows.map(row=>row.timing.captureMs),.9)}}];
 }));
}
async function save(){report.summary=summarizeHints(report);await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
