// Direct photo recognition must keep portrait, tapped and inverted identities.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
const [base,output]=process.argv.slice(2);
if(!base||!output)throw new Error("usage: BASE OUTPUT");
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const records=[];
try {
  const page=await browser.newPage();await page.goto(base+"/snaptest?aiCrop=1&milo=1");
  await page.waitForFunction(()=>window.__SNAP_RECOGNITION_WARMUP?.status==="ready"&&window.__SNAP_MILO_WARMUP?.status==="ready",null,{timeout:90000});
  for(const index of [7,18,19,34,44])for(const rotation of [0,90,180,270]) {
    const result=await page.evaluate(async({index,rotation})=>{
      const cards=await(await fetch("/snaptest/arcane/manifest.json")).json(),card=cards.medium[index];
      const image=await createImageBitmap(await(await fetch("/snaptest/arcane/medium/"+card.file)).blob());
      const sideways=rotation%180!==0;
      const canvas=new OffscreenCanvas(sideways?image.height:image.width,sideways?image.width:image.height);
      const ctx=canvas.getContext("2d");ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);
      ctx.drawImage(image,-image.width/2,-image.height/2);image.close();
      const source=URL.createObjectURL(await canvas.convertToBlob({type:"image/png"}));canvas.width=canvas.height=0;
      try {
        const r=await window.__scIdentifyUrl(source,{nx:.5,ny:.5}),best=r.matches[0];
        return{index,rotation,expected:card.name,got:best?.name,by:best?.identified_by,build:window.__SNAP_BUILD,aiCrop:r.ai_crop,milo:r.milo,ms:r.stage_ms.total,artBest:r.art_best};
      }finally{URL.revokeObjectURL(source);}
    },{index,rotation});
    records.push(result);console.log(JSON.stringify(result));
    assert.equal(result.got,result.expected,`photo ${index}, rotation ${rotation}: retain identity`);
    assert.equal(result.aiCrop.status,"input-card","actual rotated input uses the direct frame trial");
  }
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({build:records[0].build,n:records.length,records},null,2)+"\n");
}finally{await browser.close();}
