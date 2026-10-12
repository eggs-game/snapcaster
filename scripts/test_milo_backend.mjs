import assert from "node:assert/strict";
import { createMiloBackend } from "../src/recognition/miloBackend.js";

// Test the real backend with owned tensor/session handles. No browser, model
// downloads, devices or GPU are needed to force these lifecycle races.
const bytes = new Uint8Array([1, 2, 3]).buffer;
const values = marker => { const input = new Float32Array(3 * 448 * 448); input[0] = marker; return input; };
const vector = marker => Float32Array.from({ length: 128 }, (_, i) => marker + i / 128);
const turn = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const failures = [];
async function scenario(name, run) {
  try { await run(); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}

function runtime(kind, options = {}) {
  const sessions = [], tensors = [], runs = [], events = [];
  class Tensor {
    constructor(type, data, dims) {
      assert.equal(type, "float32");
      assert.deepEqual(dims, [1, 3, 448, 448]);
      this.data = data; this.disposed = false; this.role = "input";
      tensors.push(this);
    }
    dispose() { assert.equal(this.disposed, false, "Dispose an input tensor exactly once"); this.disposed = true; events.push("input-dispose"); }
  }
  const outputTensor = data => {
    const tensor = {
      disposed: false, role: "output",
      get data() { assert.equal(this.disposed, false, "Read a live output tensor"); return data; },
      dispose() { assert.equal(this.disposed, false, "Dispose every output exactly once"); this.disposed = true; data.fill(NaN); events.push("output-dispose"); },
    };
    tensors.push(tensor); return tensor;
  };
  const result = data => ({ embedding: outputTensor(data), auxiliary: outputTensor(new Float32Array([1])) });
  const implementation = {
    Tensor,
    InferenceSession: { async create(modelBytes, config) {
      assert.equal(modelBytes, bytes, "Reuse the same checksum-verified model bytes");
      assert.deepEqual(config.executionProviders, [kind]);
      events.push("create");
      if (options.createError) throw options.createError;
      const session = {
        released: false, releaseCount: 0, calls: [],
        async run({ image }) {
          assert.equal(this.released, false, "Never run a released session");
          assert.equal(image.disposed, false, "Keep the input alive until run settles");
          this.calls.push(image.data); runs.push(image.data); events.push(`run:${image.data[0]}`);
          return options.run ? options.run({ input: image, call: this.calls.length, result, session }) : result(vector(1));
        },
        async release() {
          this.releaseCount++;
          assert.equal(this.releaseCount, 1, "Release a session once");
          this.released = true; events.push("release");
          if (options.releaseGate) await options.releaseGate.promise;
          if (options.releaseError) throw options.releaseError;
        },
      };
      sessions.push(session);
      if (options.createGate) await options.createGate.promise;
      return session;
    } },
  };
  return { implementation, sessions, tensors, runs, events,
    assertDisposed() { assert.ok(tensors.every(tensor => tensor.disposed), "Release every input and output tensor"); },
  };
}

for (const load of [undefined, async () => null, async () => { throw new Error("blocked GPU module"); }]) {
  await scenario(`WASM fallback for ${load ? "unavailable GPU" : "no GPU"}`, async () => {
    const cpu = runtime("wasm"), input = values(11);
    const backend = await createMiloBackend(bytes, cpu.implementation, load, 20);
    assert.equal(backend.kind, "wasm"); assert.equal(backend.recovered, false);
    assert.deepEqual(await backend.embed(input), vector(1), "Copy output before disposal invalidates its storage");
    assert.equal(cpu.runs[1], input); assert.equal(cpu.sessions.length, 1); cpu.assertDisposed();
  });
}

await scenario("late GPU runtime import cannot create a session after CPU adoption", async () => {
  const imported = gate(), cpu = runtime("wasm"), gpu = runtime("webgpu");
  const backend = await createMiloBackend(bytes, cpu.implementation, () => imported.promise, 10);
  assert.equal(backend.kind, "wasm"); imported.resolve(gpu.implementation); await turn(); await turn();
  assert.equal(gpu.sessions.length, 0); await backend.embed(values(12)); cpu.assertDisposed();
});

await scenario("late GPU session creation releases without warming or adoption", async () => {
  const created = gate(), cpu = runtime("wasm"), gpu = runtime("webgpu", { createGate: created });
  const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 10);
  assert.equal(backend.kind, "wasm"); await backend.embed(values(13));
  created.resolve(); await turn(); await turn();
  assert.equal(gpu.runs.length, 0, "A timed-out GPU create must not begin late warmup alongside live CPU work");
  assert.equal(gpu.sessions[0].releaseCount, 1); gpu.assertDisposed(); cpu.assertDisposed();
});

await scenario("expired GPU warmup drains owned tensors and cannot replace live CPU", async () => {
  const warmed = gate(), cpu = runtime("wasm");
  const gpu = runtime("webgpu", { run: ({ result }) => warmed.promise.then(() => result(vector(2))) });
  const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 10);
  assert.equal(backend.kind, "wasm");
  assert.equal(gpu.runs.length, 1, "Only the already-started warmup may remain in flight");
  assert.equal(gpu.tensors[0].disposed, false, "Keep warmup input alive until its pending run finishes");
  await backend.embed(values(15)); warmed.resolve(); await turn(); await turn();
  assert.equal(backend.kind, "wasm"); assert.equal(backend.recovered, false);
  assert.equal(gpu.runs.length, 1); assert.equal(gpu.sessions[0].releaseCount, 1);
  gpu.assertDisposed(); cpu.assertDisposed();
});

for (const phase of ["create", "warmup"]) {
  await scenario(`rejected GPU ${phase} preserves CPU and releases allocated resources`, async () => {
    const failure = new Error(`GPU ${phase} failed`), cpu = runtime("wasm");
    const gpu = runtime("webgpu", phase === "create" ? { createError: failure } : { run: () => { throw failure; } });
    const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 30);
    assert.equal(backend.kind, "wasm"); await backend.embed(values(14));
    assert.equal(gpu.sessions.length, phase === "create" ? 0 : 1);
    if (phase === "warmup") assert.equal(gpu.sessions[0].releaseCount, 1);
    gpu.assertDisposed(); cpu.assertDisposed();
  });
}

await scenario("GPU loss on second lookup retries exact input once and stays on CPU", async () => {
  const cpu = runtime("wasm"), gpu = runtime("webgpu", {
    run: ({ call, result }) => { if (call === 3) throw new Error("GPU device lost"); return result(vector(2)); },
  });
  const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 30);
  assert.equal(backend.kind, "webgpu"); const first = values(21), second = values(22), third = values(23);
  assert.deepEqual(await backend.embed(first), vector(2));
  assert.deepEqual(await backend.embed(second), vector(1));
  assert.equal(backend.kind, "wasm"); assert.equal(backend.recovered, true);
  await backend.embed(third);
  assert.equal(gpu.runs.length, 3); assert.equal(gpu.runs[2], second); assert.equal(cpu.runs[1], second);
  assert.equal(cpu.runs[2], third); assert.equal(cpu.sessions.length, 1); assert.equal(gpu.sessions[0].releaseCount, 1);
  gpu.assertDisposed(); cpu.assertDisposed();
});

await scenario("pending inference keeps input alive and disposes outputs after copying", async () => {
  const completed = gate(), cpu = runtime("wasm", {
    run: ({ call, result }) => call === 1 ? result(vector(1)) : completed.promise.then(() => result(vector(3))),
  });
  const backend = await createMiloBackend(bytes, cpu.implementation), input = values(24);
  const job = backend.embed(input); await turn();
  assert.equal(cpu.tensors.at(-1).disposed, false);
  completed.resolve(); assert.deepEqual(await job, vector(3)); cpu.assertDisposed();
});

for (const invalid of [new Float32Array(127).fill(1), vector(NaN), vector(Infinity), new Float32Array(128)]) {
  await scenario("invalid GPU embedding disposes all outputs and retries unchanged input", async () => {
    const cpu = runtime("wasm"), gpu = runtime("webgpu", { run: ({ call, result }) => result(call === 1 ? vector(2) : invalid.slice()) });
    const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 30), input = values(31);
    assert.deepEqual(await backend.embed(input), vector(1));
    assert.equal(cpu.runs[1], input); assert.equal(gpu.sessions[0].releaseCount, 1);
    gpu.assertDisposed(); cpu.assertDisposed();
  });
}

await scenario("asynchronous lost-session release finishes before recovery returns", async () => {
  const released = gate(), cpu = runtime("wasm"), gpu = runtime("webgpu", { releaseGate: released,
    run: ({ call, result }) => { if (call > 1) throw new Error("lost"); return result(vector(2)); },
  });
  const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 30);
  let settled = false; const job = backend.embed(values(41)).then(result => { settled = true; return result; });
  await turn(); assert.equal(settled, false); released.resolve(); assert.deepEqual(await job, vector(1));
  gpu.assertDisposed(); cpu.assertDisposed();
});

await scenario("CPU initialization failure propagates its original error and releases warmup", async () => {
  const failure = new Error("CPU warmup failed"), cpu = runtime("wasm", { run: () => { throw failure; } });
  await assert.rejects(createMiloBackend(bytes, cpu.implementation), error => error === failure);
  assert.equal(cpu.sessions[0].releaseCount, 1); cpu.assertDisposed();
});

await scenario("CPU inference failure propagates and never creates GPU or another session", async () => {
  const failure = new Error("CPU query failed"), cpu = runtime("wasm", {
    run: ({ call, result }) => { if (call > 1) throw failure; return result(vector(1)); },
  });
  const backend = await createMiloBackend(bytes, cpu.implementation);
  await assert.rejects(backend.embed(values(51)), error => error === failure);
  assert.equal(cpu.sessions.length, 1); cpu.assertDisposed();
});

await scenario("invalid CPU output fails instead of returning an unverified embedding", async () => {
  const cpu = runtime("wasm", { run: ({ call, result }) => result(call === 1 ? vector(1) : vector(NaN)) });
  const backend = await createMiloBackend(bytes, cpu.implementation);
  await assert.rejects(backend.embed(values(52)), /Invalid Milo query embedding/);
  assert.equal(cpu.sessions.length, 1); cpu.assertDisposed();
});

await scenario("failed CPU recovery never reruns the released GPU or repeats fallback", async () => {
  const failure = new Error("CPU recovery unavailable"), cpu = runtime("wasm", { run: () => { throw failure; } });
  const gpu = runtime("webgpu", { run: ({ call, result }) => { if (call > 1) throw new Error("device lost"); return result(vector(2)); } });
  const backend = await createMiloBackend(bytes, cpu.implementation, async () => gpu.implementation, 30);
  await assert.rejects(backend.embed(values(61)), error => error === failure);
  await assert.rejects(backend.embed(values(62)), error => error === failure);
  assert.equal(gpu.runs.length, 2); assert.equal(cpu.sessions.length, 1);
  assert.equal(gpu.sessions[0].releaseCount, 1); assert.equal(cpu.sessions[0].releaseCount, 1);
  gpu.assertDisposed(); cpu.assertDisposed();
});

if (failures.length) throw new AggregateError(failures.map(({ name, error }) => new Error(`${name}: ${error.message}`)), `${failures.length} Milo backend lifecycle checks failed`);
console.log("Milo backend preserves exact fallback inputs, frees tensor/session ownership, rejects invalid embeddings and handles late initialization/device loss/CPU failures");
