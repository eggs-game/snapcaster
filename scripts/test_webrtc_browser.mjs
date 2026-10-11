#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.SNAPCAST_WEBRTC_OUTPUT || path.join(root, ".cache/webrtc-browser"));
await mkdir(output, { recursive: true });
const signaling = `
const clients = new Map();
const log = window.__rtcSignals = [];
window.__rtcDiagnostics = [];
window.__rtcResetSignaling = () => clients.clear();
function roster() { return [...clients.values()].map(({ member }) => ({ ...member })).sort((a,b) => a.joinedAt-b.joinedAt); }
function publish() { const list=roster(); for(const {handlers} of clients.values()) handlers.onRoster(list); }
export async function saveConnectionEvent(event) { window.__rtcDiagnostics.push(event); }
export async function joinRoom(code, name, role, handlers) {
  const id=handlers.participantId;
  clients.set(id,{member:{id,name,role,joinedAt:handlers.joinedAt,protocol:2,membershipId:'m-'+id},handlers});
  const room={myId:id,send(message,to){
    const payload=JSON.parse(JSON.stringify({...message,from:id}));
    log.push({from:id,to:to||null,type:message.type,at:performance.now()});
    for(const [target,client] of clients) if(target!==id && (!to || target===to)) {
      const delay=message.type==='offer'||message.type==='answer'?150:0;
      setTimeout(()=>{
        const targetConnection=window.__rtcPeers.get(target)?.conn;
        log.push({delivered:true,from:id,to:target,type:message.type,at:performance.now(),senderAdmitted:!!targetConnection?.roster.some(member=>member.id===id),roomReady:!!targetConnection?.room});
        Promise.resolve(client.handlers.onMessage(payload)).catch(error=>window.__rtcFailures.push({from:id,to:target,type:message.type,error:String(error)}));
      },delay);
    }
  },leave:async()=>{clients.delete(id);publish();},announceLeave:async()=>{room.send({type:'participant-leaving'});}};
  publish();
  if(window.__rtcHoldNextJoin){const delay=window.__rtcHoldNextJoin;window.__rtcHoldNextJoin=0;await new Promise(resolve=>setTimeout(resolve,delay));}
  return room;
}
`;
const entry = `
import { GameConnection } from '../src/webrtc.js';
window.__rtcFailures=[];
window.__rtcPlaybackEvents=[];
window.__rtcTrackEvents=[];
window.__rtcPeers=new Map();
const NativeRTC=window.RTCPeerConnection;
window.RTCPeerConnection=function(config){
  const pc=new NativeRTC(config);
  const nativeAddTrack=pc.addTrack.bind(pc);
  // Strip MSID grouping only in the dedicated interoperability phase. The
  // browser still negotiates real streamless tracks and generates real events.
  pc.addTrack=(track,...streams)=>nativeAddTrack(track,...(window.__rtcForceStreamless?[]:streams));
  pc.addEventListener('track',event=>window.__rtcTrackEvents.push({kind:event.track.kind,muted:event.track.muted,streams:event.streams.map(stream=>({id:stream.id,kinds:stream.getTracks().map(track=>track.kind)})),at:performance.now()}));
  return pc;
};
window.RTCPeerConnection.prototype=NativeRTC.prototype;
const videos=new Map();
const phases=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const memberships=()=>[...window.__rtcPeers.values()].map(peer=>({membership_id:'m-'+peer.id,display_name:peer.id,role:peer.role,profile_id:''}));
async function add(id,role='player',joinedAt=Date.now()) {
  const peer={id,role,joinedAt,streams:new Map(),events:[]};
  const conn=new GameConnection({onRemoteStream(from,stream){
    peer.streams.set(from,stream);
    peer.events.push({from,kinds:stream?.getTracks().map(track=>({kind:track.kind,muted:track.muted,enabled:track.enabled})),at:performance.now()});
    if(!stream){window.__rtcFailures.push({to:id,from,error:'onRemoteStream received no stream'});return;}
    const key=id+'<-'+from;
    let video=videos.get(key);
    if(!video){video=document.createElement('video');video.dataset.link=key;video.autoplay=true;video.playsInline=true;video.muted=true;video.style.width='160px';document.body.append(video);videos.set(key,video);}
    if(video.srcObject!==stream){video.srcObject=stream;video.dataset.frames='0';}
    const next=()=>video.requestVideoFrameCallback(()=>{video.dataset.frames=String(Number(video.dataset.frames)+1);next();});
    if(!video.dataset.observing){video.dataset.observing='true';next();}
    video.play().catch(error=>{
      // A later ontrack can replace the stream while the previous play promise
      // is pending. The subsequent load/play is verified by decoded frames.
      if(error.name==='AbortError')window.__rtcPlaybackEvents.push({link:key,kind:'stream-replaced-during-play'});
      else window.__rtcFailures.push({link:key,error:String(error)});
    });
  },onError(error){window.__rtcFailures.push({to:id,error});}});
  peer.conn=conn;
  conn._configureIceServers=async()=>{conn.iceServers=[];conn.turnStatus='local-native-test';};
  await conn.initMedia({audioOnly:role==='visitor'});
  for(const track of conn.localStream.getVideoTracks()) await track.applyConstraints({width:640,height:360,frameRate:8});
  if(window.__rtcDelayVideo) for(const track of conn.localStream.getVideoTracks()) track.enabled=false;
  window.__rtcPeers.set(id,peer);
  conn.setMembershipStates(memberships());
  await conn.join('RTC001',id,role,{participantId:id,joinedAt});
  // Existing clients see the initial offer/ICE before their authoritative
  // membership refresh admits the newcomer, matching independent RPC/realtime timing.
  await wait(500);
  for(const current of window.__rtcPeers.values()) current.conn.setMembershipStates(memberships());
  if(window.__rtcDelayVideo) setTimeout(()=>{for(const track of conn.localStream.getVideoTracks())track.enabled=true;},500);
  return peer;
}
async function stats() {
  const links=[];
  for(const [id,peer] of window.__rtcPeers) for(const [from,entry] of peer.conn.peers){
    const all=[...(await entry.pc.getStats()).values()];
    const video=videos.get(id+'<-'+from);
    let pixelMean=0;
    if(video?.videoWidth){
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
      const context=canvas.getContext('2d');context.drawImage(video,0,0,32,32);
      const pixels=context.getImageData(0,0,32,32).data;
      for(let index=0;index<pixels.length;index+=4)pixelMean+=pixels[index]+pixels[index+1]+pixels[index+2];
      pixelMean=Math.round(pixelMean/(32*32*3));
    }
    links.push({to:id,from,state:entry.pc.connectionState,ice:entry.pc.iceConnectionState,signaling:entry.pc.signalingState,dc:entry.dc?.readyState,
      media:all.filter(item=>item.type==='inbound-rtp'||item.type==='outbound-rtp').map(item=>({type:item.type,kind:item.kind,packetsReceived:item.packetsReceived,bytesReceived:item.bytesReceived,framesDecoded:item.framesDecoded,framesEncoded:item.framesEncoded})),
      video:video?{width:video.videoWidth,height:video.videoHeight,frames:Number(video.dataset.frames),pixelMean,paused:video.paused,tracks:video.srcObject?.getTracks().map(track=>({kind:track.kind,muted:track.muted,readyState:track.readyState}))}:null});
  }
  return links;
}
async function verify(label,timeout=15000) {
  const start=performance.now();
  let links;
  while(performance.now()-start<timeout){
    links=await stats();
    const peers=[...window.__rtcPeers.values()];
    const expected=peers.length*(peers.length-1);
    if(links.length===expected && links.every(link=>{
      const source=window.__rtcPeers.get(link.from);
      const audio=link.media.find(item=>item.type==='inbound-rtp'&&item.kind==='audio');
      const video=link.media.find(item=>item.type==='inbound-rtp'&&item.kind==='video');
      return link.state==='connected'&&link.dc==='open'&&audio?.bytesReceived>0
        &&(source.role==='visitor'||(video?.framesDecoded>0&&link.video?.frames>0&&link.video.pixelMean>10));
    })){
      phases.push({label,ms:Math.round(performance.now()-start),links});
      return;
    }
    await wait(100);
  }
  throw new Error(label+' failed to receive native audio/video: '+JSON.stringify(links));
}
window.__rtcSnapshot=async()=>({phases,links:await stats(),failures:window.__rtcFailures,playbackEvents:window.__rtcPlaybackEvents,trackEvents:window.__rtcTrackEvents,signals:window.__rtcSignals,diagnostics:window.__rtcDiagnostics,streamEvents:[...window.__rtcPeers.values()].map(peer=>({id:peer.id,events:peer.events}))});
window.__rtcRun=async()=>{
  await add('first-player','player',1000);
  await add('second-player','player',2000);
  await verify('two native players with ICE before SDP and delayed membership');
  await add('third-player','player',3000);
  await add('fourth-player','player',4000);
  await verify('four-player late-join full mesh');
  await add('late-visitor','visitor',5000);
  await verify('late audio-only visitor receives all player video');
  const old=window.__rtcPeers.get('first-player');
  old.conn.close();
  window.__rtcPeers.delete('first-player');
  await wait(300);
  window.__rtcHoldNextJoin=350;
  await add('first-player','player',1000);
  await verify('same-ID first-player reconnect within grace');
  window.__rtcResetSignaling();
  for(const peer of window.__rtcPeers.values())peer.conn.close();
  window.__rtcPeers.clear();
  for(const video of videos.values())video.remove();
  videos.clear();
  await add('equal-time-a','player',6000);
  await add('equal-time-b','player',6000);
  await verify('equal-timestamp deterministic offer initiator');
  window.__rtcResetSignaling();
  for(const peer of window.__rtcPeers.values())peer.conn.close();
  window.__rtcPeers.clear();
  for(const video of videos.values())video.remove();
  videos.clear();
  window.__rtcForceStreamless=true;
  window.__rtcDelayVideo=true;
  await add('streamless-a','player',7000);
  await add('streamless-b','player',8000);
  await verify('native streamless tracks with audio before delayed video frames');
  return window.__rtcSnapshot();
};
window.__rtcClose=()=>{for(const peer of window.__rtcPeers.values())peer.conn.close();};
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: path.join(root, "scripts"), sourcefile: "native-webrtc-test.js" },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "import.meta.env": "{}" }, logLevel: "silent",
  plugins: [{ name: "local-signaling-only", setup(build) {
    build.onResolve({ filter: /^\.\/signaling\.js$/ }, () => ({ path: "local-signaling", namespace: "native-test" }));
    build.onLoad({ filter: /.*/, namespace: "native-test" }, () => ({ contents: signaling, loader: "js" }));
  } }],
});
let browser;
let page;
const report = { ok: false, errors: [], requests: [], real: ["actual GameConnection media and sender tuning", "native RTCPeerConnection and ICE", "RTP audio and video", "data channels", "decoded HTML video frames"], simulated: ["local in-memory signaling and presence", "Chrome fake camera and microphone"], limitations: ["No Supabase, TURN, physical hardware or cross-network browser interoperability is exercised."] };
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><html><body><h1>Native local WebRTC transport test</h1><script src="/bundle.js"></script></body></html>');
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"], ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}) });
  const context = await browser.newContext();
  await context.grantPermissions(["camera", "microphone"], { origin: base });
  await context.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== base || request.method() !== "GET") {
      report.requests.push({ method: request.method(), url: request.url() });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(base);
  Object.assign(report, await page.evaluate(() => window.__rtcRun()));
  const delivered = report.signals.filter((signal) => signal.delivered);
  assert.ok(delivered.some((signal) => signal.type === "offer" && !signal.senderAdmitted), "Test must deliver an offer before membership admission");
  assert.ok(delivered.some((signal) => signal.type === "offer" && !signal.roomReady), "Test must deliver an offer before room assignment");
  assert.ok(delivered.some((signal) => signal.type === "ice" && delivered.some((sdp) => sdp.from === signal.from && sdp.to === signal.to && ["offer", "answer"].includes(sdp.type) && sdp.at > signal.at)), "Test must deliver real ICE before SDP");
  assert.ok(report.trackEvents.some((event) => event.kind === "video" && event.streams.length === 0), "Streamless phase must generate real native video events without grouped streams");
  assert.deepEqual(report.failures, [], "Native signaling must not produce transport errors");
  assert.deepEqual(report.errors, [], "Native RTC test must not produce JavaScript errors");
  assert.deepEqual(report.requests, [], "Native RTC test must never contact external services");
  report.ok = true;
  process.stdout.write(`Native WebRTC passed: ${report.phases.map((phase) => phase.label).join('; ')}.\n`);
} catch (error) {
  report.failure = error.stack || String(error);
  if (page) Object.assign(report, await page.evaluate(() => window.__rtcSnapshot?.()).catch(() => ({})));
  throw error;
} finally {
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await page?.evaluate(() => window.__rtcClose?.()).catch(() => {});
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  process.stdout.write(`Native WebRTC report: ${path.join(output, "report.json")}\n`);
}
