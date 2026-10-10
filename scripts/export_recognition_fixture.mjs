#!/usr/bin/env node
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const [sceneArg="1", indexArg="6", file="mortuary-mire-template.jpg", generatorUrl="http://127.0.0.1:8877"] = process.argv.slice(2);
const source=await readFile(new URL("./benchmark_ai_crop.mjs",import.meta.url),"utf8");
const start=source.indexOf("async ({ scene, suite, severity }) => {");
const end=source.indexOf("}, { scene, suite, severity:",start);
if (start < 0 || end < 0) throw new Error("Capture generator not found");
const generate=(0,eval)("("+source.slice(start,end+1)+")");
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
 const page=await browser.newPage();await page.goto(generatorUrl+"/snaptest/cards.json");
 const items=await page.evaluate(generate,{scene:Number(sceneArg),suite:"realLife"});
 const item=items[Number(indexArg)];if (!item) throw new Error("Fixture index missing");
 await writeFile("public/snaptest/regressions/"+file,Buffer.from(item.source.split(",")[1],"base64"));
 const manifest=JSON.parse(await readFile("public/snaptest/regressions/manifest.json","utf8"));
 const fixture={name:item.name,id:item.id,point:item.point,rotation:item.rotation,coverage:item.coverage,file,source:"authoritative Real life sampler seed 20260803",scene:Number(sceneArg),index:Number(indexArg)};
 const existing=manifest.fixtures.findIndex(f=>f.file===file);
 if(existing<0) manifest.fixtures.push(fixture); else manifest.fixtures[existing]=fixture;
 await writeFile("public/snaptest/regressions/manifest.json",JSON.stringify(manifest,null,2)+"\n");
 console.log(item.name,file);
} finally {await browser.close();}
