// Loads the prebuilt card index (/carddata/*) and identifies card crops.
import { VEC_BYTES, CARD_W, CARD_H, toGray, queryVariants, hammingSearch } from "./hash.js";
import { findCardQuad, rectifyCard, centerCropCard, loadOpenCV } from "./quad.js";

const CONF_GOOD = 90, CONF_BAD = 170; // of 512 bits

let indexData = null; // Uint8Array N*64
let cards = null;     // [[name, set, cn, id, face], ...]
let loadPromise = null;

export function preload() {
  loadOpenCV().catch(() => {});
  return loadIndex();
}

export function loadIndex() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [hRes, cRes] = await Promise.all([fetch("/carddata/hashes.bin"), fetch("/carddata/cards.json")]);
    if (!hRes.ok || !cRes.ok) throw new Error("Card index not found — run the 'Build card index' GitHub Action, then redeploy.");
    indexData = new Uint8Array(await hRes.arrayBuffer());
    cards = await cRes.json();
    if (indexData.length !== cards.length * VEC_BYTES) throw new Error("Card index is corrupted — rebuild it.");
    return cards.length;
  })();
  return loadPromise;
}

export function indexSize() { return cards ? cards.length : 0; }

function cardMeta(i, distance) {
  const [name, set, cn, id, face] = cards[i];
  const side = face === 1 ? "back" : "front";
  return {
    name, set, collector_number: cn,
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${cn}`,
    distance,
    confidence: Math.max(0, Math.min(1, (CONF_BAD - distance) / (CONF_BAD - CONF_GOOD))),
  };
}

async function dataUrlToCanvas(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

export async function identify(imageDataUrl) {
  const L = (m) => console.log(`[snapcaster] identify: ${m}`);
  L("start");
  await loadIndex();
  L(`index ready (${cards?.length} faces)`);
  const canvas = await dataUrlToCanvas(imageDataUrl);
  L(`canvas ${canvas.width}x${canvas.height}`);

  let rectified, cardFound = false;
  const quad = await findCardQuad(canvas);
  L(`quad ${quad ? "found" : "none (center-crop)"}`);
  if (quad) {
    rectified = await rectifyCard(canvas, quad);
    cardFound = true;
  } else {
    rectified = centerCropCard(canvas);
  }

  const ctx = rectified.getContext("2d");
  const gray = toGray(ctx.getImageData(0, 0, rectified.width, rectified.height));

  const n = cards.length;
  const dists = new Uint16Array(n).fill(0xffff);
  for (const q of queryVariants(gray)) hammingSearch(q, indexData, n, dists);
  L("hamming search done");

  // top 5
  const top = [];
  for (let i = 0; i < n; i++) {
    if (top.length < 5 || dists[i] < top[top.length - 1].d) {
      top.push({ i, d: dists[i] });
      top.sort((a, b) => a.d - b.d);
      if (top.length > 5) top.pop();
    }
  }
  return { matches: top.map((t) => cardMeta(t.i, t.d)), card_found: cardFound };
}
