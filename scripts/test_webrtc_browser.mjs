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
// Chrome reads this generated tone through its fake microphone backend. It
// lets the test distinguish received sound from merely receiving silent RTP.
const fakeMicrophone = path.join(output, "fake-microphone.wav");
const sampleRate = 48000;
const sampleCount = sampleRate * 2;
const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
wav.writeUInt32LE(sampleCount * 2, 40);
for (let index = 0; index < sampleCount; index++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8192), 44 + index * 2);
await writeFile(fakeMicrophone, wav);
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
  const peer={id,role,joinedAt,streams:new Map(),audioNodes:new Map(),muted:new Map(),cameraEnabled:new Map(),events:[]};
  const conn=new GameConnection({onRemoteStream(from,stream){
    peer.streams.set(from,stream);
    peer.events.push({from,kinds:stream?.getTracks().map(track=>({kind:track.kind,muted:track.muted,enabled:track.enabled})),at:performance.now()});
    if(!stream){window.__rtcFailures.push({to:id,from,error:'onRemoteStream received no stream'});return;}
    const previousAudio=peer.audioNodes.get(from);
    previousAudio?.source.disconnect();previousAudio?.analyser.disconnect();previousAudio?.silence.disconnect();
    if(stream.getAudioTracks().length){
      const source=window.__rtcAudioContext.createMediaStreamSource(stream);
      const analyser=window.__rtcAudioContext.createAnalyser();analyser.fftSize=2048;
      const silence=window.__rtcAudioContext.createGain();silence.gain.value=0;
      source.connect(analyser);analyser.connect(silence);silence.connect(window.__rtcAudioContext.destination);
      peer.audioNodes.set(from,{source,analyser,silence});
    }
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
  },onMuted(from,value){peer.muted.set(from,value);},onCameraEnabled(from,value){peer.cameraEnabled.set(from,value);},onError(error){window.__rtcFailures.push({to:id,error});}});
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
    const analyser=peer.audioNodes.get(from)?.analyser;
    let audioRms=0;
    if(analyser){const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);audioRms=Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length);}
    let pixelMean=0;
    if(video?.videoWidth){
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
      const context=canvas.getContext('2d');context.drawImage(video,0,0,32,32);
      const pixels=context.getImageData(0,0,32,32).data;
      for(let index=0;index<pixels.length;index+=4)pixelMean+=pixels[index]+pixels[index+1]+pixels[index+2];
      pixelMean=Math.round(pixelMean/(32*32*3));
    }
    links.push({to:id,from,state:entry.pc.connectionState,ice:entry.pc.iceConnectionState,signaling:entry.pc.signalingState,dc:entry.dc?.readyState,audioRms,
      media:all.filter(item=>item.type==='inbound-rtp'||item.type==='outbound-rtp').map(item=>({type:item.type,kind:item.kind,packetsReceived:item.packetsReceived,bytesReceived:item.bytesReceived,totalAudioEnergy:item.totalAudioEnergy,totalSamplesDuration:item.totalSamplesDuration,framesDecoded:item.framesDecoded,framesEncoded:item.framesEncoded,frameWidth:item.frameWidth,frameHeight:item.frameHeight})),
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
      return link.state==='connected'&&link.dc==='open'&&audio?.bytesReceived>0&&link.audioRms>0.001
        &&(source.role==='visitor'||(video?.framesDecoded>0&&link.video?.frames>0&&link.video.pixelMean>10));
    })){
      phases.push({label,ms:Math.round(performance.now()-start),links});
      return;
    }
    await wait(100);
  }
  throw new Error(label+' failed to receive native audio/video: '+JSON.stringify(links));
}
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function eventually(predicate,label,timeout=10000){
  const started=performance.now();
  while(performance.now()-started<timeout){if(await predicate())return;await wait(100);}
  throw new Error(label+' timed out: '+JSON.stringify(await stats()));
}
const sourceLinks=(links,id)=>links.filter(link=>link.from===id);
const audioBytes=link=>link.media.find(item=>item.type==='inbound-rtp'&&item.kind==='audio')?.bytesReceived||0;
const encoding=(source,receiver)=>source.peers.get(receiver).pc.getSenders().find(sender=>sender.track?.kind==='video').getParameters().encodings[0];
async function verifyMediaControls(){
  const source=window.__rtcPeers.get('first-player').conn;
  const receivers=[...window.__rtcPeers.values()].filter(peer=>peer.id!=='first-player');
  source.toggleTrack('audio',false);source.setMuted(true);
  source.toggleTrack('video',false);source.setCameraEnabled(false);
  await eventually(async()=>sourceLinks(await stats(),'first-player').every(link=>link.video.pixelMean<5)
    &&receivers.every(peer=>peer.muted.get('first-player')===true&&peer.cameraEnabled.get('first-player')===false),'disabled camera/mic propagation');
  // Opus can emit tiny comfort noise after a muted source. Require the decoded
  // waveform below -100 dBFS rather than demanding exact floating-point zero.
  await eventually(async()=>sourceLinks(await stats(),'first-player').every(link=>link.audioRms<0.00001),'muted microphone silence');
  const stillQuiet=sourceLinks(await stats(),'first-player');
  check(stillQuiet.every(link=>link.audioRms<0.00001),'Muted microphone must deliver silence to every receiver');
  phases.push({label:'camera/mic off yields black video and silent audio on every mesh recipient',links:stillQuiet});
  const devices=await source.listDevices();
  const oldVideo=source.localStream.getVideoTracks()[0];
  const oldAudio=source.localStream.getAudioTracks()[0];
  const camera=devices.cameras.find(device=>device.deviceId!==oldVideo.getSettings().deviceId);
  const microphone=devices.mics.find(device=>device.deviceId!=='default'&&device.deviceId!==oldAudio.getSettings().deviceId);
  check(camera&&microphone,'Native switch phase requires a different fake camera and microphone');
  await source.switchDevice('video',camera.deviceId);
  const newVideo=source.localStream.getVideoTracks()[0];
  await newVideo.applyConstraints({width:640,height:360,frameRate:8});
  await source.switchDevice('audio',microphone.deviceId);
  const newAudio=source.localStream.getAudioTracks()[0];
  check(oldVideo.readyState==='ended'&&oldAudio.readyState==='ended','Device switch must stop both old native tracks');
  check(newVideo!==oldVideo&&newAudio!==oldAudio&&!newVideo.enabled&&!newAudio.enabled,'Device switch must retain camera-off/mic-muted state on new tracks');
  check(source.videoDeviceId===camera.deviceId&&source.audioDeviceId===microphone.deviceId,'Device switch must retain actual chosen device IDs');
  for(const entry of source.peers.values()){
    check(entry.pc.getSenders().some(sender=>sender.track===newVideo),'Each native video sender must use the new camera');
    check(entry.pc.getSenders().some(sender=>sender.track===newAudio),'Each native audio sender must use the new microphone');
  }
  source.toggleTrack('video',true);source.setCameraEnabled(true);
  source.toggleTrack('audio',true);source.setMuted(false);
  await source.setOutgoingVideoQuality('1080p');
  await eventually(async()=>sourceLinks(await stats(),'first-player').every(link=>link.audioRms>0.001&&audioBytes(link)>audioBytes(stillQuiet.find(before=>before.to===link.to)))
    &&receivers.every(peer=>peer.muted.get('first-player')===false&&peer.cameraEnabled.get('first-player')===true),'switched microphone decoded-tone recovery');
  await verify('native camera/microphone replacement preserves mute state and re-enables media for all peers');
  await newVideo.applyConstraints({width:1920,height:1080,frameRate:8});
  await source.setOutgoingVideoQuality('1080p');
  const receiver=window.__rtcPeers.get('second-player').conn;
  check(receiver.requestVideoQuality('first-player','720p'),'Valid receiver quality request must be accepted');
  await eventually(()=>source.videoQuality.get('second-player')==='720p'&&encoding(source,'second-player').maxBitrate===1800000,'720p sender encoding');
  await eventually(async()=>{const link=(await stats()).find(link=>link.from==='first-player'&&link.to==='second-player');return link.video.width===1280&&link.video.height===720&&link.video.pixelMean>10;},'720p native decoded resolution');
  check(Math.abs(encoding(source,'second-player').scaleResolutionDownBy-1.5)<0.01,'720p receiver must downscale a 1920px source');
  check(receiver.requestVideoQuality('first-player','1080p'),'1080p quality request must be accepted');
  await eventually(()=>source.videoQuality.get('second-player')==='1080p'&&encoding(source,'second-player').maxBitrate===5000000,'1080p sender encoding');
  await eventually(async()=>{const link=(await stats()).find(link=>link.from==='first-player'&&link.to==='second-player');return link.video.width===1920&&link.video.height===1080&&link.video.pixelMean>10;},'1080p native decoded resolution');
  check(receiver.requestVideoQuality('first-player','auto'),'Auto quality request must be accepted');
  await eventually(()=>source.videoQuality.get('second-player')==='auto','auto receiver quality');
  for(const [quality,bitrate] of [['720p',1800000],['1080p',5000000],['1440p',8000000],['2160p',14000000]]){
    check(await source.setOutgoingVideoQuality(quality)===quality,'Outgoing quality must be retained');
    check(encoding(source,'second-player').maxBitrate===bitrate,'Native sender must receive '+quality+' bitrate cap');
  }
  await newVideo.applyConstraints({width:640,height:360,frameRate:8});
  await source.setOutgoingVideoQuality('1080p');
  await verify('receiver 720p/1080p/auto changes decoded size and all outgoing quality caps preserve A/V');
}
window.__rtcSnapshot=async()=>({phases,links:await stats(),failures:window.__rtcFailures,playbackEvents:window.__rtcPlaybackEvents,trackEvents:window.__rtcTrackEvents,signals:window.__rtcSignals,diagnostics:window.__rtcDiagnostics,streamEvents:[...window.__rtcPeers.values()].map(peer=>({id:peer.id,events:peer.events}))});
window.__rtcRun=async()=>{
  window.__rtcAudioContext=new AudioContext();await window.__rtcAudioContext.resume();
  await add('first-player','player',1000);
  await add('second-player','player',2000);
  await verify('two native players with ICE before SDP and delayed membership');
  await add('third-player','player',3000);
  await add('fourth-player','player',4000);
  await verify('four-player late-join full mesh');
  await add('late-visitor','visitor',5000);
  await verify('late audio-only visitor receives all player video');
  await verifyMediaControls();
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
window.__rtcClose=()=>{for(const peer of window.__rtcPeers.values())peer.conn.close();window.__rtcAudioContext?.close();};
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
const report = { ok: false, errors: [], requests: [], real: ["actual GameConnection media, native device replacement and sender tuning", "native RTCPeerConnection and ICE", "RTP audio and video", "decoded audio waveform and mute silence", "data channels", "decoded non-black HTML video frames and quality transitions"], simulated: ["local in-memory signaling and presence", "two Chrome fake cameras and a generated fake microphone tone"], limitations: ["No Supabase, TURN, physical hardware, audible speaker output or cross-network browser interoperability is exercised."] };
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><html><body><h1>Native local WebRTC transport test</h1><script src="/bundle.js"></script></body></html>');
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${fakeMicrophone}`], ...(process.env.SNAPCAST_CHROME_PATH ? { executablePath: process.env.SNAPCAST_CHROME_PATH } : {}) });
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
  await page.getByRole("heading").click();
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
