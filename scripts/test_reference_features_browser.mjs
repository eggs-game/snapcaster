// Native descriptor parity and bounded allocation; run outside timed benchmarks.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const [base, dist, output] = process.argv.slice(2);
if (!base || !dist || !output) throw new Error("usage: BASE DIST OUTPUT");
const source = await readFile("src/recognition/recognizer.js", "utf8");
const probe = `
  if (type === "reference-cache-test") {
    try {
      await loadCV();
      const image = await fetchReference("cb231e4d-dbba-4475-a01b-212d83859722", 0);
      const legacy = await fetchReference("cb231e4d-dbba-4475-a01b-212d83859722", 0, "normal");
      const detail = await fetchReference("cb231e4d-dbba-4475-a01b-212d83859722", 0, "detail");
      if (!image || !legacy || !detail) throw new Error("public reference unavailable");
      if (image.width !== 244 || detail.width !== 400 || detail.height !== 557) throw new Error("reference detail was discarded");
      const snapshot = features => ({
        bytes: Array.from(features.desc.data),
        points: Array.from({length: features.kp.size()}, (_, i) => {
          const keypoint = features.kp.get(i);
          return [keypoint.pt.x, keypoint.pt.y, keypoint.size, keypoint.angle];
        })
      });
      const parity = [];
      for (const pixels of [image, legacy, detail]) for (const contrast of [false, true]) {
        const fresh = orbFeatures(pixels, 300, contrast), cached = referenceFeatures(pixels, contrast);
        const expected = snapshot(fresh);
        const equal = JSON.stringify(expected) === JSON.stringify(snapshot(cached));
        fresh.kp.delete(); fresh.desc.delete(); releaseReferenceFeatures(cached);
        const reused = referenceFeatures(pixels, contrast);
        parity.push({width:pixels.width, height:pixels.height, contrast, equal, sameObject: reused === cached, keypoints: reused.kp.size()});
        releaseReferenceFeatures(reused);
      }
      const heaps = [];
      for (let batch = 0; batch < 4; batch++) {
        for (let i = 0; i < 80; i++) {
          const pixels = i % 4 < 2 ? image : detail;
          const clone = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
          const f = referenceFeatures(clone, i % 2 === 0);
          if (!f.desc.rows) throw new Error("cached descriptors missing");
          releaseReferenceFeatures(f);
        }
        heaps.push(self.cv.HEAPU8.length);
      }
      const fresh = orbFeatures(image, 300), cached = referenceFeatures(image);
      const afterEvictionEqual = JSON.stringify(snapshot(fresh)) === JSON.stringify(snapshot(cached));
      fresh.kp.delete(); fresh.desc.delete(); releaseReferenceFeatures(cached);
      self.postMessage({id, parity, heaps, afterEvictionEqual, entries: referenceFeatureCache.length});
    } catch(error) { self.postMessage({id, error: String(error)}); }
    return;
  }
`;
await mkdir(path.join(dist,"experimental"),{recursive:true});
await writeFile(path.join(dist,"experimental/reference-cache.js"),source.replace('  if (type === "set-early-orb-probe") {',probe+'  if (type === "set-early-orb-probe") {'));
const browser = await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage(); await page.goto(base+"/snaptest?aiCrop=0&milo=0");
  const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const worker=new Worker("/experimental/reference-cache.js");
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error("native cache probe timed out"));},90000);
    worker.onmessage=e=>{if(e.data.id!==1)return;clearTimeout(timeout);worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data);};
    worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(new Error(e.message));};
    worker.postMessage({id:1,type:"reference-cache-test"});
  }));
  if(!result.parity.every(r=>r.equal&&r.sameObject&&r.keypoints>0)||!result.afterEvictionEqual||result.entries!==60||new Set(result.heaps).size!==1)throw new Error(JSON.stringify(result));
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));
} finally {await browser.close();}
