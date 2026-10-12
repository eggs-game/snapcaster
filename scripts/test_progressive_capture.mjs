#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bundle=await build({entryPoints:[path.join(root,"src/webrtc.js")],bundle:true,write:false,platform:"node",format:"esm",define:{"import.meta.env":"{}"},logLevel:"silent"});
const {GameConnection,captureLocalFrame}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const native={document:globalThis.document,MediaStream:globalThis.MediaStream,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
const created=[],revoked=[];
URL.createObjectURL=blob=>{const url=native.create(blob);created.push({url,blob});return url;};
URL.revokeObjectURL=url=>{revoked.push(url);native.revoke(url);};
class Track {
 constructor(grades,firstDelay=2){this.grades=grades;this.firstDelay=firstDelay;this.samples=[];this.encoded=[];this.listeners=new Map();this.kind="video";}
 addEventListener(name,fn){this.listeners.set(name,fn);}
 stop(){this.listeners.get("ended")?.();}
}
class Stream {constructor(tracks=[]){this.tracks=tracks;}getVideoTracks(){return this.tracks.filter(track=>track.kind==="video");}getTracks(){return this.tracks;}}
class Canvas {
 width=0;height=0;frame=null;track=null;
 getContext(){const self=this;return {fillRect(){},drawImage(source){if(source instanceof Video){const track=source.srcObject.getVideoTracks()[0],index=track.samples.length;self.track=track;self.frame={index,grade:track.grades[Math.min(index,track.grades.length-1)]};track.samples.push({at:performance.now(),index});}else{self.track=source.track;self.frame=source.frame;}},getImageData(){const bytes=new Uint8ClampedArray(160*160*4),grade=self.frame?.grade||0;for(let y=0;y<160;y++)for(let x=0;x<160;x++){const i=(y*160+x)*4,v=(x%16<8?20:20+grade);bytes[i]=bytes[i+1]=bytes[i+2]=v;bytes[i+3]=255;}return {data:bytes};}};}
 toBlob(callback,type,quality){const frame={...this.frame},track=this.track,payload={frame:frame.index,width:this.width,height:this.height,grade:frame.grade,quality};track.encoded.push(payload);setTimeout(()=>callback(new Blob([JSON.stringify(payload)],{type})),frame.index===0?track.firstDelay:2);}
}
class Video {paused=true;videoWidth=400;videoHeight=300;async play(){this.paused=false;}pause(){this.paused=true;}}
globalThis.MediaStream=Stream;
globalThis.document={createElement:type=>type==="video"?new Video():new Canvas()};
const stream=(grades,delay)=>new Stream([new Track(grades,delay)]);
const assertSamples=track=>{assert.equal(track.samples.length,3);for(let i=1;i<3;i++)assert.ok(track.samples[i].at-track.samples[i-1].at>=115,"Three samples keep their 120 ms spacing");};
const payload=blob=>blob.text().then(JSON.parse);
const setup=(connection,id,send)=>{const dc={readyState:"open",send};connection.peers.set(id,{chunks:new Map(),pc:{close(){}}});connection._setupDC(id,dc);return dc;};
async function receiveBlob(connection,id,dc,request,blob,phase){
 await dc.onmessage({data:JSON.stringify({t:"bin-chunk",id:request.id,i:0,n:1,mime:"image/jpeg",px:.2,py:.8,...(phase?{phase}:{})})});
 await dc.onmessage({data:await blob.arrayBuffer()});
}
try {
 let first;
 const camera=stream([200,80,50]),track=camera.getVideoTracks()[0];
 const capture=await captureLocalFrame(camera,.03,.95,{onFirstFrame:value=>{first=value;return new Promise(()=>{});}});
 assertSamples(track);assert.equal(capture.firstSelected,true);assert.equal(capture.blob,first.blob);assert.equal(capture.url,first.url);assert.equal(track.encoded.length,1,"A winning first sample is encoded once and retains exact Blob identity");
 assert.ok(track.samples[1].at>track.samples[0].at);assert.ok(!revoked.includes(first.url));URL.revokeObjectURL(capture.url);
 const expected=await payload(capture.blob);assert.equal(expected.frame,0);assert.equal(expected.width,165);assert.equal(expected.quality,.9);

 const moving=stream([10,210,90]);let blurred;
 const sharper=await captureLocalFrame(moving,.03,.95,{onFirstFrame:value=>{blurred=value;}});
 assertSamples(moving.getVideoTracks()[0]);assert.equal(sharper.firstSelected,false);assert.notEqual(sharper.blob,blurred.blob);assert.equal((await payload(sharper.blob)).frame,1);assert.ok(revoked.includes(blurred.url));
 const control=await captureLocalFrame(stream([10,210,90]),.03,.95);
 assert.equal(await sharper.blob.text(),await control.blob.text(),"Later sharper sample has unchanged legacy pixels/geometry/encoding");URL.revokeObjectURL(sharper.url);URL.revokeObjectURL(control.url);

 let lateCalls=0;
 const late=await captureLocalFrame(stream([10,210,90],320),.5,.5,{onFirstFrame:()=>lateCalls++});
 await new Promise(resolve=>setTimeout(resolve,90));assert.equal(lateCalls,0,"Late encoding cannot prepare a first sample already discarded by selection");URL.revokeObjectURL(late.url);

 for(const grades of [[210,80,50],[10,210,90]]){
  const owner=new GameConnection({}),viewer=new GameConnection({});owner.localStream=stream(grades);owner.roster=[{id:"viewer",role:"visitor",membershipId:"member-viewer"}];owner.allowedMembershipIds=new Set(["member-viewer"]);
  const wire=[],errors=[];let ownerDC,viewerDC;
  ownerDC=setup(owner,"viewer",data=>{wire.push({direction:"owner",data,at:performance.now()});queueMicrotask(()=>Promise.resolve(viewerDC.onmessage({data})).catch(error=>errors.push(error)));});
  viewerDC=setup(viewer,"owner",data=>{wire.push({direction:"viewer",data,at:performance.now()});queueMicrotask(()=>Promise.resolve(ownerDC.onmessage({data})).catch(error=>errors.push(error)));});
  let preview,settled=false;
  const pending=viewer.requestRemoteCapture("owner",.2,.8,{onFirstFrame:cap=>{preview=cap;assert.equal(settled,false,"Early transfer must not resolve/display a capture");}}).then(result=>{settled=true;return result;});
  const result=await pending;assert.equal(result.firstSelected,grades[0]>grades[1]);assert.ok(preview);assert.equal(owner.localStream.getVideoTracks()[0].samples.length,3);
  const messages=wire.filter(record=>typeof record.data==="string").map(record=>JSON.parse(record.data));
  assert.equal(messages.filter(message=>message.phase==="first").length,1);assert.equal(messages.filter(message=>message.t==="cap-commit").length,result.firstSelected?1:0);
  if(result.firstSelected){assert.equal(result.blob,preview.blob);assert.equal(result.url,preview.url);assert.equal(messages.filter(message=>message.t==="bin-chunk").length,1);}else{assert.notEqual(result.blob,preview.blob);assert.ok(revoked.includes(preview.url));assert.equal(messages.filter(message=>message.t==="bin-chunk").length,2);}
  assert.equal(viewer.pending.size,0);assert.deepEqual(errors,[]);URL.revokeObjectURL(result.url);owner.close();viewer.close();
 }

 const owner=new GameConnection({});owner.localStream=stream([210,80,50]);owner.roster=[{id:"legacy",role:"player",membershipId:"m-legacy"}];owner.allowedMembershipIds=new Set(["m-legacy"]);const legacy=[];const legacyDC=setup(owner,"legacy",data=>legacy.push(data));
 await legacyDC.onmessage({data:JSON.stringify({t:"cap-req",id:"legacy-request",nx:.5,ny:.5,binary:1})});
 const legacyMessages=legacy.filter(data=>typeof data==="string").map(JSON.parse);assert.equal(legacyMessages.length,1);assert.equal(legacyMessages[0].t,"bin-chunk");assert.equal(legacyMessages[0].phase,undefined);assert.equal(owner.localStream.getVideoTracks()[0].encoded.length,1);owner.close();

 const requester=new GameConnection({}),sent=[];const ownerChannel=setup(requester,"owner",data=>sent.push(JSON.parse(data)));const otherChannel=setup(requester,"other",()=>{});
 let callbacks=0;const request=requester.requestRemoteCapture("owner",.2,.8,{onFirstFrame:()=>callbacks++});const id=sent[0].id;const blob=new Blob(["first pixels"],{type:"image/jpeg"});
 await otherChannel.onmessage({data:JSON.stringify({t:"cap-res",id,error:"capture failed"})});await receiveBlob(requester,"other",otherChannel,{id},blob,"first");await otherChannel.onmessage({data:JSON.stringify({t:"cap-commit",id})});
 assert.equal(requester.pending.size,1);assert.equal(callbacks,0,"Another peer cannot deliver or commit this owner's capture");
 await receiveBlob(requester,"owner",ownerChannel,{id},blob,"first");await receiveBlob(requester,"owner",ownerChannel,{id},blob,"first");assert.equal(callbacks,1,"Only one bounded first-frame slot/callback exists per request");
 const held=requester.pending.get(id).early;await ownerChannel.onmessage({data:JSON.stringify({t:"cap-commit",id})});const committed=await request;assert.equal(committed.blob,held.blob);assert.equal(committed.url,held.url);URL.revokeObjectURL(committed.url);

 const oldOwner=[];const legacyRequester=new GameConnection({});const oldChannel=setup(legacyRequester,"old-owner",data=>oldOwner.push(JSON.parse(data)));let legacyCalls=0;const oldRequest=legacyRequester.requestRemoteCapture("old-owner",.5,.5,{onFirstFrame:()=>legacyCalls++});await receiveBlob(legacyRequester,"old-owner",oldChannel,oldOwner[0],blob);const oldResult=await oldRequest;assert.equal(oldResult.firstSelected,false);assert.equal(legacyCalls,0,"A new requester accepts an older owner's normal single response");URL.revokeObjectURL(oldResult.url);

 const delayed=[];const delayedConnection=new GameConnection({});const delayedChannel=setup(delayedConnection,"owner",data=>delayed.push(JSON.parse(data)));let delayedFirst;const delayedRequest=delayedConnection.requestRemoteCapture("owner",.5,.5,{onFirstFrame:cap=>{delayedFirst=cap;}});const delayedId=delayed[0].id;
 await delayedChannel.onmessage({data:JSON.stringify({t:"bin-chunk",id:delayedId,i:0,n:1,mime:"image/jpeg",phase:"first"})});
 const delayedBlob=new Blob(["delayed first pixels"],{type:"image/jpeg"});const originalRead=delayedBlob.arrayBuffer.bind(delayedBlob);let releaseRead;delayedBlob.arrayBuffer=()=>new Promise(resolve=>{releaseRead=()=>originalRead().then(resolve);});
 const reading=delayedChannel.onmessage({data:delayedBlob});await delayedChannel.onmessage({data:JSON.stringify({t:"cap-commit",id:delayedId})});assert.equal(delayedConnection.pending.size,1);releaseRead();await reading;const delayedResult=await delayedRequest;assert.equal(delayedResult.blob,delayedFirst.blob,"Commit survives an asynchronous first-Blob read without resolving early");URL.revokeObjectURL(delayedResult.url);delayedConnection.close();

 const reordered=new GameConnection({}),reorderMessages=[];const reorderDC=setup(reordered,'owner',data=>reorderMessages.push(JSON.parse(data)));let reorderedFirst;const reorderRequest=reordered.requestRemoteCapture('owner',.2,.8,{onFirstFrame:value=>{reorderedFirst=value;}});const reorderId=reorderMessages[0].id;
 await reorderDC.onmessage({data:JSON.stringify({t:'bin-chunk',id:reorderId,i:0,n:2,mime:'image/jpeg',px:.13,py:.91,phase:'first'})});
 const zero=new Blob(['part zero'],{type:'image/jpeg'}),readZero=zero.arrayBuffer.bind(zero);let releaseZero;zero.arrayBuffer=()=>new Promise(resolve=>{releaseZero=()=>readZero().then(resolve);});const firstRead=reorderDC.onmessage({data:zero});
 await reorderDC.onmessage({data:JSON.stringify({t:'bin-chunk',id:reorderId,i:1,n:2,mime:'image/jpeg',phase:'first'})});await reorderDC.onmessage({data:new Blob(['part one'],{type:'image/jpeg'})});await reorderDC.onmessage({data:JSON.stringify({t:'cap-commit',id:reorderId})});assert.equal(reordered.pending.size,1);releaseZero();await firstRead;const reorderResult=await reorderRequest;assert.equal(await reorderResult.blob.text(),'part zeropart one');assert.equal(reorderResult.px,.13);assert.equal(reorderResult.py,.91);assert.equal(reorderResult.blob,reorderedFirst.blob);URL.revokeObjectURL(reorderResult.url);reordered.close();

 const timed=[];const timeDC=setup(requester,"timeout-owner",data=>timed.push(JSON.parse(data)));const timeout=requester.requestRemoteCapture("timeout-owner",.5,.5,{onFirstFrame(){},timeoutMs:20});const rejects=assert.rejects(timeout,/Capture timed out/);await receiveBlob(requester,"timeout-owner",timeDC,timed[0],blob,"first");const timeoutUrl=requester.pending.get(timed[0].id).early.url;await rejects;assert.ok(revoked.includes(timeoutUrl));assert.equal(requester.pending.size,0);
 const closed=[];const closedDC=setup(requester,"closed-owner",data=>closed.push(JSON.parse(data)));const closing=requester.requestRemoteCapture("closed-owner",.5,.5,{onFirstFrame(){}});const closeReject=assert.rejects(closing,/Capture closed/);await receiveBlob(requester,"closed-owner",closedDC,closed[0],blob,"first");const closedUrl=requester.pending.get(closed[0].id).early.url;requester.close();await closeReject;assert.ok(revoked.includes(closedUrl));assert.equal(requester.pending.size,0);legacyRequester.close();

 class CongestedChannel extends EventTarget {
  readyState="open";bufferedAmount=2*1024*1024;messages=[];listeners=new Map();
  send(data){this.messages.push(data);}
  addEventListener(name,fn,options){const set=this.listeners.get(name)||new Set();set.add(fn);this.listeners.set(name,set);super.addEventListener(name,fn,options);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);super.removeEventListener(name,fn);}
  count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
 }
 for(const kind of ['abort','deadline','inactive','replace','drain']){
  const conn=new GameConnection({}),dc=new CongestedChannel(),controller=new AbortController();let active=true;conn.peers.set('owner',{dc});const at=performance.now();
  const sending=conn._sendBinaryChunked('owner',{id:'paced'},blob,{signal:controller.signal,deadline:Date.now()+(kind==='deadline'?25:500),isActive:()=>active});
  await new Promise(resolve=>setTimeout(resolve,5));
  if(kind==='abort')controller.abort();if(kind==='inactive')active=false;if(kind==='replace')conn.peers.set('owner',{dc:new CongestedChannel()});if(kind==='drain'){dc.bufferedAmount=0;dc.dispatchEvent(new Event('bufferedamountlow'));}
  assert.equal(await sending,kind==='drain');assert.ok(performance.now()-at<150,'Canceled/expired/superseded transfers must not inherit a two-second wait');assert.equal(dc.count(),0,'Backpressure listeners are removed on every exit');assert.equal(dc.messages.length,kind==='drain'?2:0,'Headers and bytes stay atomic and canceled transfers send nothing');
 }
 const gone=new GameConnection({}),departedMessages=[];gone._diagnostic=()=>{};gone.roster=[{id:'gone',role:'player'}];const goneDC=setup(gone,'gone',data=>departedMessages.push(JSON.parse(data)));const departing=gone.requestRemoteCapture('gone',.5,.5,{onFirstFrame(){}});const departedReject=assert.rejects(departing,/Capture player left/);await receiveBlob(gone,'gone',goneDC,departedMessages[0],blob,'first');const goneUrl=gone.pending.get(departedMessages[0].id).early.url;const goneEntry=gone.peers.get('gone');goneEntry.chunks.set(`binary:${departedMessages[0].id}:final`,{parts:[]});gone._finalizeDeparture({id:'gone',role:'player'},true);await departedReject;assert.ok(revoked.includes(goneUrl));assert.equal(goneEntry.chunks.size,0);assert.equal(gone.pending.size,0);gone.close();

 const restored=new GameConnection({}),restoreMessages=[];restored._diagnostic=()=>{};restored.myId='viewer';restored.roster=[{id:'viewer',role:'visitor',joinedAt:2},{id:'owner',role:'player',joinedAt:1}];restored.knownIds=new Set(['owner']);const restoreDC=setup(restored,'owner',data=>restoreMessages.push(JSON.parse(data)));const restoring=restored.requestRemoteCapture('owner',.5,.5,{onFirstFrame(){}});const restoreReject=assert.rejects(restoring,/Capture connection replaced/);await receiveBlob(restored,'owner',restoreDC,restoreMessages[0],blob,'first');const restoreUrl=restored.pending.get(restoreMessages[0].id).early.url;const restoreEntry=restored.peers.get('owner');restored.departureTimers.set('owner',setTimeout(()=>{},5000));restored._makeOffer=async()=>{};restored._onRoster(restored.roster);await restoreReject;assert.ok(revoked.includes(restoreUrl));assert.equal(restoreEntry.chunks.size,0);assert.equal(restored.pending.size,0);restored.close();

 // Inject first-transfer congestion into the actual chunk sender, then let
 // the sharper final frame use an uncongested channel. This is a regression
 // control, not a claim about live network timing.
 const pacedOwner=new GameConnection({}),pacedWire=[];pacedOwner.localStream=stream([10,210,90]);pacedOwner.roster=[{id:'viewer',role:'player',membershipId:'m-viewer'}];pacedOwner.allowedMembershipIds=new Set(['m-viewer']);const pacedDC=new CongestedChannel();pacedDC.bufferedAmount=0;pacedDC.send=data=>pacedWire.push(data);pacedOwner.peers.set('viewer',{chunks:new Map(),pc:{close(){}}});pacedOwner._setupDC('viewer',pacedDC);const actualSend=pacedOwner._sendBinaryChunked.bind(pacedOwner);let canceledFirst;
 pacedOwner._sendBinaryChunked=(peer,header,bytes,options)=>{pacedDC.bufferedAmount=header.phase==='first'?2*1024*1024:0;const result=actualSend(peer,header,bytes,options);if(header.phase==='first')canceledFirst=result;return result;};
 const pacedAt=performance.now();await pacedDC.onmessage({data:JSON.stringify({t:'cap-req',id:'paced-later',nx:.5,ny:.5,binary:1,progressive:1})});assert.ok(performance.now()-pacedAt<600,'A later sharper winner must not wait for discarded first-transfer backpressure');assert.equal(await canceledFirst,false);assert.equal(pacedDC.count(),0);const pacedHeaders=pacedWire.filter(value=>typeof value==='string').map(JSON.parse);assert.equal(pacedHeaders.length,1);assert.equal(pacedHeaders[0].phase,undefined);assert.equal((await payload(new Blob(pacedWire.filter(value=>value instanceof Uint8Array)))).frame,1,'Cancellation preserves the sharper final bytes');pacedOwner.close();
 console.log("OK: progressive capture retains native quality, exact winning Blob and later-sharpness fallback; legacy/async responses, owner bounds, deadlines, backpressure cancellation and URL/removal cleanup pass");
} finally {
 for(const {url} of created)native.revoke(url);
 globalThis.document=native.document;globalThis.MediaStream=native.MediaStream;URL.createObjectURL=native.create;URL.revokeObjectURL=native.revoke;
}
