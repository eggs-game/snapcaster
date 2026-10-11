import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import config from "../vite.config.js";

const root = await mkdtemp(path.join(os.tmpdir(), "snapcast-build-isolation-"));
try {
  const target = path.join(root, "isolated-build");
  const unrelated = path.join(root, "dist");
  for (const directory of [target, unrelated]) {
    await mkdir(path.join(directory, "experimental"), { recursive: true });
    await writeFile(path.join(directory, "mock-data.local.json"), "local fixture");
    await writeFile(path.join(directory, "experimental", "fixture.txt"), "experimental fixture");
  }
  const plugin = config.plugins.find((item) => item.name === "exclude-local-mock-data");
  plugin.configResolved({ root, build: { outDir: "isolated-build" } });
  await plugin.closeBundle();
  await assert.rejects(access(path.join(target, "mock-data.local.json")));
  await assert.rejects(access(path.join(target, "experimental")));
  assert.equal(await readFile(path.join(unrelated, "mock-data.local.json"), "utf8"), "local fixture");
  assert.equal(await readFile(path.join(unrelated, "experimental", "fixture.txt"), "utf8"), "experimental fixture");
  console.log("OK: production fixture cleanup stays inside the configured build output");
} finally { await rm(root, { recursive: true, force: true }); }
