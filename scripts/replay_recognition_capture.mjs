// Replay saved release pixels and exact click; exclude from headline timing.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const [base, captureDir, filename, output, repeats="3"]=process.argv.slice(2);
if(!output)throw new Error("usage: BASE CAPTURE_DIR FILE OUTPUT [REPEATS]");
const item=JSON.parse(await readFile(path.join(captureDir,"manifest.json"),"utf8")).find(r=>r.file===filename);
if(!item?.point)throw new Error("saved exact click missing");
const mime=path.extname(filename).toLowerCase()===".png"?"image/png":"image/jpeg";
const source=`data:${mime};base64,`+(await readFile(path.join(captureDir,filename))).toString("base64");
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const records=[];
try {
 const page=await browser.newPage();await page.goto(base+"/snaptest");
 await page.waitForFunction(()=>window.__SNAP_RECOGNITION_WARMUP?.status==="ready",null,{timeout:90000});
 for(let i=0;i<Number(repeats);i++) {
  const result=await page.evaluate(async({source,item})=>{
   const r=await window.__scIdentifyUrl(source,item.point);
   return{build:window.__SNAP_BUILD,got:r.matches[0]?.name,ok:r.matches[0]?.name===item.name,by:r.matches[0]?.identified_by,
    matches:r.matches.slice(0,12),artBest:r.art_best,milo:r.milo,miloChecked:r.milo_verification,aiCrop:r.ai_crop,stages:r.stage_ms};
  },{source,item});records.push(result);
  console.log(JSON.stringify({got:result.got,ok:result.ok,by:result.by,artBest:result.artBest,retryHit:result.aiCrop?.retryHit,milo:result.milo}));
 }
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({item,records},null,2)+"\n");
} finally {await browser.close();}
