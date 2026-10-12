// GPU execution changes retrieval speed, never the identity verifier. Retain
// the original WASM runtime for unsupported devices and a lost GPU session.
const SIZE = 448, DIM = 128;

async function embedding(engine, values) {
  const input = new engine.runtime.Tensor("float32", values, [1, 3, SIZE, SIZE]);
  let output;
  try {
    output = await engine.session.run({ image: input });
    const result = Float32Array.from(output.embedding.data);
    if (result.length !== DIM || !result.every(Number.isFinite) || Math.hypot(...result) < .01)
      throw new Error("Invalid Milo query embedding");
    return result;
  } finally {
    input.dispose();
    if (output) for (const value of Object.values(output)) value.dispose();
  }
}

async function createEngine(bytes, runtime, kind, isActive = () => true) {
  const session = await runtime.InferenceSession.create(bytes, { executionProviders: [kind] });
  const engine = { runtime, session, kind };
  try {
    if (!isActive()) { await session.release().catch(() => {}); return null; }
    await embedding(engine, new Float32Array(3 * SIZE * SIZE));
    return engine;
  } catch (error) {
    await session.release().catch(() => {});
    throw error;
  }
}

export async function createMiloBackend(bytes, wasm, loadGpu, gpuBudgetMs = 5000) {
  let active, recovered = false, failed;
  if (loadGpu) {
    // A stalled GPU initialization cannot disable the working CPU path. A
    // session that finishes after the deadline is released without adoption.
    let expired = false, timer;
    const attempt = (async () => {
      const runtime = await loadGpu();
      if (!runtime || expired) return null;
      const engine = await createEngine(bytes, runtime, "webgpu", () => !expired);
      if (!engine) return null;
      if (!expired) return engine;
      await engine.session.release().catch(() => {});
      return null;
    })().catch(() => null);
    try {
      active = await Promise.race([attempt, new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve(null); }, gpuBudgetMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  if (!active) active = await createEngine(bytes, wasm, "wasm");
  return {
    get kind() { return active?.kind || "failed"; },
    get recovered() { return recovered; },
    async embed(values) {
      if (failed) throw failed;
      try { return await embedding(active, values); }
      catch (error) {
        if (active.kind !== "webgpu") throw error;
        const lost = active;
        active = null;
        // Fall back once, using the same checksum-verified model and input.
        try { active = await createEngine(bytes, wasm, "wasm"); }
        catch (error) { failed = error; throw error; }
        finally { await lost.session.release().catch(() => {}); }
        recovered = true;
        return embedding(active, values);
      }
    },
  };
}
