#!/usr/bin/env node
// Research only: freeze identical pixel crops and production query hashes for
// descriptor comparisons. This does not change or deploy the app's matcher.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {declaration,descriptorSource} from './ai_lookup_probe_helpers.mjs';
const [suite='realLife', output='.cache/ai-lookup/crops', base='http://127.0.0.1:8877'] = process.argv.slice(2);
const source=await readFile(new URL('./benchmark_ai_crop.mjs',import.meta.url),'utf8');
const start=source.indexOf('async ({ scene, suite, severity }) => {');
const end=source.indexOf('}, { scene, suite, severity:',start);
if(start<0||end<0)throw new Error('Authoritative capture generator missing');
const generatorSource=source.slice(start,end+1).replace('suite === "realLife" ? perfectCrop(rendered.canvas, p, rendered.cardW, rendered.cardH) : undefined','perfectCrop(rendered.canvas, p, rendered.cardW, rendered.cardH)');
const generate=(0,eval)('('+generatorSource+')');
const rectifier='const CARD_W=244,CARD_H=340,OCR_MAX_W=610;'+declaration('matToImageData')+declaration('rectifyCard')+';return rectifyCard;';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
await mkdir(output,{recursive:true});const records=[];
try {
 const page=await browser.newPage();page.on('pageerror',e=>console.error(e.message));
 await page.goto(base+'/snaptest/cards.json');
 await page.addScriptTag({url:base+'/vendor/opencv/4.9.0/opencv.js'});
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('OpenCV initialization timeout')),60000);
  const finish=()=>{clearTimeout(timer);resolve();};
  if(window.cv?.Mat)return finish();
  if(window.cv?.then)window.cv.then(m=>{window.cv=m;finish();});
  else reject(new Error('OpenCV unavailable'));
 }));
 await page.evaluate(async ({rectifier,descriptors})=>{
  window.rectifyProbe=Function(rectifier)();
  window.descriptorProbe=Function(descriptors)();
  window.hashProbe=await import('/src/recognition/hash.js');
  window.cropProbe=await import('/src/recognition/aiCrop.js');
  await window.cropProbe.preloadAiCrop();
 },{rectifier,descriptors:descriptorSource});
 for(let scene=0;scene<(['realLife','arcane'].includes(suite)?20:10);scene++){
  const items=await page.evaluate(generate,{scene,suite,severity:'medium'});
  for(const [j,item] of items.entries()){
   const i=scene*10+j;
   const crops=await page.evaluate(async ({item,omitCapture})=>{
    const bmp=await createImageBitmap(await (await fetch(item.source)).blob());
    try{
     const ai=item.pool==='arcane'?{quads:[],diagnostic:{status:'not-requested'}}:await window.cropProbe.proposeAiCrops(bmp,item.point);
     if(!['ready','not-requested'].includes(ai.diagnostic.status))throw new Error(JSON.stringify(ai.diagnostic));
     const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
     ctx.drawImage(bmp,0,0);const raw=ctx.getImageData(0,0,bmp.width,bmp.height);
     const encode=async(id,kind)=>{
      const c=new OffscreenCanvas(id.width,id.height);c.getContext('2d').putImageData(id,0,0);
      // PNG preserves the exact pixels both descriptor arms receive.
      const bytes=Array.from(new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer()));
      return {kind,width:id.width,height:id.height,bytes,...window.descriptorProbe(id)};
     };
     const candidates=omitCapture?[]:[await encode(raw,'capture')];
     for(const [k,quad] of ai.quads.entries())candidates.push(await encode(window.rectifyProbe(raw,quad),'ai-'+k));
     if(item.perfectSource){
      const perfect=await createImageBitmap(await(await fetch(item.perfectSource)).blob());
      try{
       const c=new OffscreenCanvas(perfect.width,perfect.height);const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(perfect,0,0);
       candidates.push(await encode(x.getImageData(0,0,c.width,c.height),'perfect'));
      }finally{perfect.close();}
     }
     return {candidates,ai:ai.diagnostic,quads:ai.quads};
    }finally{bmp.close();}
   },{item,omitCapture:suite==='overlap'});
   const record={...item,source:undefined,perfectSource:undefined,i,ai:crops.ai,quads:crops.quads,crops:[]};
   for(const crop of crops.candidates){
    const file=`${String(i).padStart(3,'0')}-${crop.kind}.png`;
    await writeFile(path.join(output,file),Buffer.from(crop.bytes));
    record.crops.push({...crop,bytes:undefined,file});
   }
   records.push(record);
  }
  await writeFile(path.join(output,'manifest.json'),JSON.stringify({suite,source:'authoritative SnapTest sampler and scene renderer; actual production detector, rectifier and JS hashes',hashPreprocessing:'production whiteBalance -> toGray -> queryVariants (eight rotations/contrast variants)',n:records.length,records},null,2)+'\n');
  console.log(`${suite}: frozen ${records.length} captures`);
 }
}finally{await browser.close();}
