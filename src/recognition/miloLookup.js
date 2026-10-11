// Milo retrieves printings. Cosine similarity is never identity confidence.
export const MILO_REVISION = "9bcc5e809e936b8c5630d1e7101aae1de1e76621";
export const MILO_MODEL_SHA = "bd13d8d60383c69da04dce261f32e93fdaeaa8fd618fbc991e7385f71b3d45df";
export const MILO_PREPROCESS = "milo1-rgb-portrait-ccw-bilinear448-imagenet-v1";
const SIZE = 448, DIM = 128;
let ready, ort, model, gallery, norms, names, catalog;

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

export function validateMiloCatalog(manifest, vectors, lengths, groups) {
  if (manifest?.version !== 1 || manifest.revision !== MILO_REVISION || manifest.model_sha256 !== MILO_MODEL_SHA
    || manifest.preprocess !== MILO_PREPROCESS || manifest.dimension !== DIM
    || !Number.isSafeInteger(manifest.count) || manifest.count < 1 || manifest.count > 500000
    || !Number.isSafeInteger(manifest.names) || manifest.names < 1 || manifest.names > manifest.count
    || !/^[a-f0-9]{64}$/.test(manifest.cards_sha256 || "")
    || vectors.length !== manifest.count * DIM || lengths.length !== manifest.count || groups.length !== manifest.count) {
    throw new Error("Incompatible Milo catalog");
  }
  for (let row = 0; row < manifest.count; row++) {
    if (!(lengths[row] > 0) || !Number.isFinite(lengths[row]) || groups[row] >= manifest.names) throw new Error("Corrupt Milo catalog");
  }
}

export function miloCatalog(runtime) {
  if (!ready) ready = (async () => {
    ort = runtime;
    const base = "/carddata/milo/";
    const response = await fetch(base + "manifest.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Milo catalog unavailable");
    catalog = await response.json();
    // Check provenance before downloading large tables or creating a session.
    if (catalog.revision !== MILO_REVISION || catalog.model_sha256 !== MILO_MODEL_SHA || catalog.preprocess !== MILO_PREPROCESS) throw new Error("Milo model/catalog mismatch");
    const files = ["vectors.bin", "norms.bin", "names.bin"];
    const buffers = await Promise.all(files.map(async file => {
      const r = await fetch(base + file, { cache: "no-cache" });
      if (!r.ok) throw new Error("Milo table unavailable");
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength !== catalog.files?.[file]?.bytes || await sha256(bytes) !== catalog.files[file].sha256) throw new Error("Milo table checksum mismatch");
      return bytes;
    }));
    gallery = new Int8Array(buffers[0]); norms = new Float32Array(buffers[1]); names = new Uint32Array(buffers[2]);
    validateMiloCatalog(catalog, gallery, norms, names);
    const r = await fetch("/vendor/vision/milo1/model.onnx");
    if (!r.ok) throw new Error("Milo model unavailable");
    const bytes = await r.arrayBuffer();
    if (await sha256(bytes) !== MILO_MODEL_SHA) throw new Error("Milo model checksum mismatch");
    model = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    const input = new ort.Tensor("float32", new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]);
    let output;
    try { output = await model.run({ image: input }); }
    finally { input.dispose(); if (output) for (const value of Object.values(output)) value.dispose(); }
    return { count: catalog.count, cards_sha256: catalog.cards_sha256 };
  })();
  return ready;
}

// Keep two treatments of six different identities. Hundreds of reprints of
// one basic land must not consume the rescue budget for all other names.
export function diverseMiloRows(scores, groups, identityLimit = 6, treatmentLimit = 2) {
  const leaders = new Map();
  for (let row = 0; row < scores.length; row++) {
    if (!Number.isFinite(scores[row])) continue;
    const group = groups[row], entries = leaders.get(group) || [];
    if (entries.length < treatmentLimit || scores[row] > entries.at(-1).score) {
      entries.push({ row, score: scores[row] }); entries.sort((a,b) => b.score - a.score || a.row - b.row);
      entries.length = Math.min(entries.length, treatmentLimit); leaders.set(group, entries);
    }
  }
  const chosen = [...leaders.values()].sort((a,b) => b[0].score - a[0].score || a[0].row - b[0].row).slice(0, identityLimit);
  const output = [];
  for (let treatment = 0; treatment < treatmentLimit; treatment++) for (const entries of chosen) if (entries[treatment]) output.push(entries[treatment]);
  return output;
}

function inputFor(source, rotation) {
  const canvas = new OffscreenCanvas(SIZE, SIZE), ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(SIZE / 2, SIZE / 2); ctx.rotate(rotation);
  ctx.drawImage(source, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data, values = new Float32Array(3 * SIZE * SIZE);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) values[c * SIZE * SIZE + i] = (pixels[i * 4 + c] / 255 - mean[c]) / std[c];
  canvas.width = canvas.height = 0;
  return new ort.Tensor("float32", values, [1, 3, SIZE, SIZE]);
}

export async function lookupMilo(images, runtime) {
  const started = performance.now();
  await miloCatalog(runtime);
  const scores = new Float32Array(catalog.count).fill(-Infinity);
  let inferenceMs = 0, searchMs = 0;
  for (const image of images.slice(0, 2)) {
    let source = new OffscreenCanvas(image.width, image.height);
    source.getContext("2d").putImageData(image, 0, 0);
    if (image.width > image.height) {
      const portrait = new OffscreenCanvas(image.height, image.width), ctx = portrait.getContext("2d");
      ctx.translate(0, image.width); ctx.rotate(-Math.PI / 2); ctx.drawImage(source, 0, 0);
      source.width = source.height = 0; source = portrait;
    }
    const embeddings = [], t = performance.now();
    try {
      for (const rotation of [0, Math.PI]) {
        const input = inputFor(source, rotation); let output;
        try {
          output = await model.run({ image: input });
          const embedding = Float32Array.from(output.embedding.data);
          const norm = Math.hypot(...embedding);
          if (embedding.length !== DIM || !Number.isFinite(norm) || norm < .01) throw new Error("Invalid Milo query embedding");
          for (let d = 0; d < DIM; d++) embedding[d] /= norm;
          embeddings.push(embedding);
        } finally { input.dispose(); if (output) for (const value of Object.values(output)) value.dispose(); }
      }
    } finally { source.width = source.height = 0; }
    inferenceMs += performance.now() - t;
    const s = performance.now();
    for (let row = 0; row < catalog.count; row++) {
      let a = 0, b = 0; const offset = row * DIM;
      for (let d = 0; d < DIM; d++) { const v = gallery[offset + d]; a += v * embeddings[0][d]; b += v * embeddings[1][d]; }
      scores[row] = Math.max(scores[row], Math.max(a,b) / norms[row]);
    }
    searchMs += performance.now() - s;
  }
  const rows = diverseMiloRows(scores, names);
  return { rows, cards_sha256: catalog.cards_sha256,
    diagnostic: { model: "milo1", status: "ready", crops: Math.min(2, images.length), proposals: rows.length,
      inferenceMs: Math.round(inferenceMs), searchMs: Math.round(searchMs), ms: Math.round(performance.now() - started) } };
}
