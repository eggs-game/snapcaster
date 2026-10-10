#!/usr/bin/env node
// Catalog maintenance checks: new faces + saved recognition regressions.
// Isolated reference images prove coverage, not crowded-camera accuracy.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [base='http://127.0.0.1:4187',cases='.cache/index-refresh-scan-cases.json',output='.cache/index-refresh-browser.json']=process.argv.slice(2);
const entries=JSON.parse(await readFile(cases,'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const records=[];
try{
 const page=await browser.newPage();await page.goto(base+'/snaptest');
 await page.waitForFunction(()=>window.__SNAP_RECOGNITION_WARMUP?.status==='ready',null,{timeout:90000});
 const state=await page.evaluate(()=>({build:window.__SNAP_BUILD,warmup:window.__SNAP_RECOGNITION_WARMUP}));
 const run=async(item,source,aiCrop=true)=>{
  const result=await page.evaluate(async({item,source,aiCrop})=>{
   const start=performance.now();
   const r=await window.__scIdentifyUrl(source,item.point||{nx:.5,ny:.5},[],{aiCrop});
   const best=r.matches[0];
   return {name:item.name,id:item.id,face:item.face??0,got:best?.name,gotId:best?.scryfall_id,gotFace:best?.face,ok:best?.name===item.name,by:best?.identified_by,ms:Math.round(performance.now()-start),aiCrop,stages:r.stage_ms};
  },{item,source,aiCrop});
  records.push(result);console.log(`${records.length}: ${result.name}: ${result.ok?'OK':'MISS '+result.got}`);
 };
 for(const item of entries)await run(item,item.url);
 const regression=await page.evaluate(async()=>await(await fetch('/snaptest/regressions/manifest.json')).json());
 for(const item of regression.fixtures)for(const aiCrop of [false,true])await run(item,'/snaptest/regressions/'+item.file,aiCrop);
 const names=await page.evaluate(async names=>{
  const catalog=await(await fetch('/carddata/names.json',{cache:'no-cache'})).json();
  return names.filter(n=>!catalog.includes(n));
 },entries.map(r=>r.name));
 const result={scope:'isolated new card/face coverage and frozen regressions; not an accuracy benchmark',...state,newFaces:{n:entries.length,correct:records.slice(0,entries.length).filter(r=>r.ok).length,missingNames:names},frozenRegressions:{n:records.length-entries.length,correct:records.slice(entries.length).filter(r=>r.ok).length},records};
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({newFaces:result.newFaces,frozenRegressions:result.frozenRegressions,build:result.build}));
 if(records.some(r=>!r.ok)||names.length)process.exitCode=1;
}finally{await browser.close();}
