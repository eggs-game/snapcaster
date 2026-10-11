#!/usr/bin/env node
// Browser cost/parity probe only. Ranking a candidate is not identification.
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
const assets='.cache/ai-lookup',publicRoot='public/experimental/ai-lookup';
await mkdir(publicRoot,{recursive:true});
for(const file of ['model.onnx','gallery-int8.bin','gallery-norms.bin','gallery-ids.json'])await copyFile(assets+'/'+file,publicRoot+'/'+file);
const manifest=JSON.parse(await readFile(assets+'/crops/manifest.json','utf8'));
// Fixed examples across the complete run, including known difficult captures.
const indices=[0,16,37,42,47,51,67,93,100,137,146,155,156,175,192,199];
const queries=[];
for(const i of indices){
 const record=manifest.records.find(r=>r.i===i);if(!record)throw new Error('Incomplete crop manifest');
 for(const crop of record.crops.filter(c=>c.kind==='perfect'||c.kind==='ai-0')){
  await copyFile(assets+'/crops/'+crop.file,publicRoot+'/'+crop.file);
  queries.push({i,name:record.name,kind:crop.kind,file:crop.file});
 }
}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8877/snaptest/cards.json');
 const result=await page.evaluate(async queries=>{
  const base='/experimental/ai-lookup/',runtime='/vendor/vision/cornelius-2.12-ort-1.30.0/';
  const started=performance.now();
  const ort=await import(runtime+'ort.wasm.min.mjs');ort.env.wasm.wasmPaths=runtime;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  const [session,bytes,normBytes,ids,rows]=await Promise.all([
   ort.InferenceSession.create(base+'model.onnx',{executionProviders:['wasm']}),
   fetch(base+'gallery-int8.bin').then(r=>r.arrayBuffer()),fetch(base+'gallery-norms.bin').then(r=>r.arrayBuffer()),
   fetch(base+'gallery-ids.json').then(r=>r.json()),fetch('/carddata/cards.json').then(r=>r.json())]);
  const gallery=new Int8Array(bytes),norms=new Float32Array(normBytes);
  const nameOf=new Map(rows.map(r=>[r[3]+(r[4]?'_back':''),r[0]]));
  const names=ids.map(id=>nameOf.get(id));const loadedMs=Math.round(performance.now()-started);
  const warm=new ort.Tensor('float32',new Float32Array(3*448*448),[1,3,448,448]);
  const warmed=await session.run({image:warm});warm.dispose();for(const v of Object.values(warmed))v.dispose();
  const records=[];
  for(const query of queries){
   const bmp=await createImageBitmap(await(await fetch(base+query.file)).blob());
   try{
    const inferenceStart=performance.now(),embeddings=[];
    let source=bmp;
    if(bmp.width>bmp.height){
     source=new OffscreenCanvas(bmp.height,bmp.width);const rotated=source.getContext('2d');
     rotated.translate(0,bmp.width);rotated.rotate(-Math.PI/2);rotated.drawImage(bmp,0,0);
    }
    for(const rotation of [0,Math.PI]){
     const c=new OffscreenCanvas(448,448);const x=c.getContext('2d',{willReadFrequently:true});
     x.translate(224,224);x.rotate(rotation);x.drawImage(source,-224,-224,448,448);
     const rgba=x.getImageData(0,0,448,448).data,input=new Float32Array(3*448*448);
     const mean=[.485,.456,.406],std=[.229,.224,.225];
     for(let j=0;j<448*448;j++)for(let ch=0;ch<3;ch++)input[ch*448*448+j]=(rgba[j*4+ch]/255-mean[ch])/std[ch];
     const tensor=new ort.Tensor('float32',input,[1,3,448,448]);
     const output=await session.run({image:tensor});embeddings.push(Array.from(output.embedding.data));
     tensor.dispose();for(const v of Object.values(output))v.dispose();
    }
    const inferMs=performance.now()-inferenceStart,searchStart=performance.now();
    const scores=new Float32Array(ids.length);
    for(let row=0;row<ids.length;row++){
     let a=0,b=0;const offset=row*128;
     for(let d=0;d<128;d++){const v=gallery[offset+d];a+=v*embeddings[0][d];b+=v*embeddings[1][d];}
     scores[row]=Math.max(a,b)/norms[row];
    }
    const order=Array.from(scores.keys()).sort((a,b)=>scores[b]-scores[a]);
    const rank=order.findIndex(i=>names[i]===query.name)+1;
    const searchMs=performance.now()-searchStart;
    records.push({...query,got:names[order[0]],rank,score:scores[order[0]],top5:order.slice(0,5).map(i=>names[i]),inferMs:Math.round(inferMs),searchMs:Math.round(searchMs),totalMs:Math.round(inferMs+searchMs),embeddings});
   }finally{bmp.close();}
  }
  await session.release();
  return {backend:'ONNX Runtime Web 1.30.0 WASM, one thread; int8 gallery; portrait+180 degrees',galleryRows:ids.length,loadedMs,records};
 },queries);
 await writeFile(assets+'/browser-results.json',JSON.stringify(result,null,2)+'\n');
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
 console.log(JSON.stringify({n:result.records.length,galleryRows:result.galleryRows,coldLoadMs:result.loadedMs,medianInferMs:median(result.records.map(r=>r.inferMs)),medianSearchMs:median(result.records.map(r=>r.searchMs)),medianTotalMs:median(result.records.map(r=>r.totalMs)),correct:result.records.filter(r=>r.got===r.name).length}));
}finally{await browser.close();}
