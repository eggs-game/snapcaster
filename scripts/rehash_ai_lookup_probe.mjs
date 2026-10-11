#!/usr/bin/env node
// Repair existing frozen research manifests using the actual worker preprocessing.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {descriptorSource} from './ai_lookup_probe_helpers.mjs';
const [directory='.cache/ai-lookup/crops',base='http://127.0.0.1:8877']=process.argv.slice(2);
const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.goto(base+'/snaptest/cards.json');
 await page.evaluate(source=>{window.descriptorProbe=Function(source)();},descriptorSource);
 for(const record of manifest.records){
  for(const crop of record.crops){
   const png=(await readFile(path.join(directory,crop.file))).toString('base64');
   const descriptors=await page.evaluate(async uri=>{
    const bmp=await createImageBitmap(await(await fetch(uri)).blob());
    try{
     const c=new OffscreenCanvas(bmp.width,bmp.height),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bmp,0,0);
     return window.descriptorProbe(x.getImageData(0,0,c.width,c.height));
    }finally{bmp.close();}
   },'data:image/png;base64,'+png);
   // An earlier manifest may already contain white-balanced gray hashes.
   // Check the corrected control is byte-identical while adding art/color.
   if(manifest.hashPreprocessing&&JSON.stringify(crop.variants)!==JSON.stringify(descriptors.variants))throw new Error('Hash helper parity failed: '+crop.file);
   Object.assign(crop,descriptors);
  }
  if((record.i+1)%20===0)console.log(`Rehashed ${record.i+1}/${manifest.n}`);
 }
 manifest.hashPreprocessing='production whiteBalance -> toGray -> queryVariants (eight rotations/contrast variants)';
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();}
