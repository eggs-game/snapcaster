#!/usr/bin/env node
// Complete production recognition matrix, serialized with a fresh browser for
// each broad suite. The primary is paired on identical generated source pixels.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNativeMatrixPrecision, assertNativePrimaryRetention } from '../../scripts/native_recognition_release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const node = process.execPath;
const flags = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || '1'];
}));
if (flags.help) {
  console.log('Usage: node .cache/card35/run-release-matrix.mjs --url=http://127.0.0.1:5188 --baselineUrl=http://127.0.0.1:5187 [--output=.cache/card35/release-matrix] [--candidateProof=PATH] [--controlProof=PATH] [--resume=1 | --validate-only=1]');
  process.exit(0);
}
const output = path.resolve(root, flags.output || '.cache/card35/release-matrix');
const candidateOutput = path.join(output, 'candidate');
const controlOutput = path.join(output, 'control');
const baselineProofPath = path.resolve(root, flags.controlProof || '.cache/card35/frozen-34/source-proof.json');
const candidateProofPath = path.resolve(root, flags.candidateProof || '.cache/card35/frozen-35/source-proof.json');
const baselineUrl = flags.baselineUrl || 'http://127.0.0.1:5187';
const candidateUrl = flags.url || 'http://127.0.0.1:5188';
const chrome = flags.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const modes = ['realLife', 'tableauEdh10', 'tableauVegasEdh20', 'tableauEdhDice10', 'random200', 'edh200', 'recentHint20', 'arcaneMedium'];
const limits = { realLife: [200, 0], tableauEdh10: [100, .92], tableauVegasEdh20: [200, .83], tableauEdhDice10: [100, .90], random200: [200, .95], edh200: [200, .93], recentHint20: [20, 1], arcaneMedium: [200, .99] };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const controlProof = JSON.parse(await readFile(baselineProofPath, 'utf8'));
const candidateProof = JSON.parse(await readFile(candidateProofPath, 'utf8'));
assert.ok(controlProof.compiled && candidateProof.compiled, 'Both full-production source snapshots must be compiled');
assert.deepEqual(controlProof.catalogDigests, candidateProof.catalogDigests, 'Both arms must use the identical current catalog');
for (const file of ['src/SnapTest.jsx', 'src/snaptest/scene.js', 'src/snaptest/degrade.js', 'src/captureGeometry.js']) {
  assert.equal(controlProof.sourceDigests[file], candidateProof.sourceDigests[file], `Benchmark generator contract is unchanged: ${file}`);
}
await mkdir(output, { recursive: true });
if (flags.resume === '1' || flags['validate-only']) {
  const oldProof = JSON.parse(await readFile(path.join(output, 'matrix-proof.json'), 'utf8'));
  assert.equal(oldProof.sourceProofs.control.sha256, sha256(await readFile(baselineProofPath)), 'Resume/validation must keep the exact original control source proof');
  assert.equal(oldProof.sourceProofs.candidate.sha256, sha256(await readFile(candidateProofPath)), 'Resume/validation must keep the exact original candidate source proof');
}
await mkdir(path.join(output, 'source-proofs'), { recursive: true });
await writeFile(path.join(output, 'source-proofs/control.json'), await readFile(baselineProofPath));
await writeFile(path.join(output, 'source-proofs/candidate.json'), await readFile(candidateProofPath));
const report = {
  schema: 'snapcast-frozen-production-matrix-v1', startedAt: new Date().toISOString(), completed: false,
  sourceProofs: {
    control: { file: 'source-proofs/control.json', sha256: sha256(await readFile(baselineProofPath)), build: controlProof.build, commit: controlProof.commit, sourceCount: controlProof.sourceCount },
    candidate: { file: 'source-proofs/candidate.json', sha256: sha256(await readFile(candidateProofPath)), build: candidateProof.build, commit: candidateProof.commit, sourceCount: candidateProof.sourceCount },
  },
  catalogDigests: candidateProof.catalogDigests, modes, results: {}, failures: [],
  limitations: [
    'Full compiled main-app production pages with the unchanged production CSP. Models are warm; these SNAPTEST suites do not measure a physical camera click or first-visit download.',
    'RealLife and ArcaneMedium use the actual paired production helper, identical source pixels and all per-card arm results. Six additional suites use their actual UI runner with a fresh browser per suite.',
    'Broad random suites do not have a current-main paired arm. Their documented accuracy/rotation/hint gates and strict confident precision are checked. Every previously correct primary and supplied-photo identity must be retained.',
    'Paired supplied-photo retention is an additional safety control. This release still selects native improvement evidence; it does not select or relax the separate photo-improvement release policy.',
  ],
};
const save = () => writeFile(path.join(output, 'matrix-proof.json'), JSON.stringify(report, null, 2) + '\n');

async function command(script, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(node, [script, ...args], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited ${code ?? signal}`)));
  });
}

if (!flags['validate-only']) {
  // Test-only request routing cannot change recognition inputs, timing gates or
  // candidates. It merely prevents an unexpected application mutation during
  // an anonymous benchmark; source app/worker bundles remain untouched.
  const driverDir = path.join(output, 'drivers');
  await mkdir(driverDir, { recursive: true });
  async function guardedDriver(name) {
    const original = await readFile(path.join(root, 'scripts', name), 'utf8');
    const contextLine = 'const context = await browser.newContext();';
    assert.ok(original.includes(contextLine), 'Expected authoritative driver context boundary');
    const guarded = original.replace('const flags =', 'const benchmarkBlockedMutations = [];\nconst flags =')
      .replaceAll(contextLine, `${contextLine}\n    await context.route('**/*', async route => {\n      const request = route.request();\n      if (!['GET', 'HEAD'].includes(request.method())) {\n        benchmarkBlockedMutations.push({ method: request.method(), origin: new URL(request.url()).origin });\n        console.error('Blocked unexpected benchmark mutation:', request.method(), new URL(request.url()).origin);\n        await route.abort();\n        return;\n      }\n      await route.continue();\n    });`)
      .replace('await browser.close();', "await browser.close();\n  if (benchmarkBlockedMutations.length) throw new Error('Benchmark attempted an unexpected mutation: ' + JSON.stringify(benchmarkBlockedMutations));");
    const filename = path.join(driverDir, name);
    await writeFile(filename, guarded);
    report.drivers ||= {};
    report.drivers[name] = { authoritativeSha256: sha256(original), guardedSha256: sha256(guarded), change: 'Only read-only request routing at browser context creation.' };
    return filename;
  }
  const paired = await guardedDriver('benchmark_milo_lookup.mjs');
  const ui = await guardedDriver('benchmark_recognition_release.mjs');
  await save();
  const resume = flags.resume === '1';
  const exists = async file => { try { await readFile(file); return true; } catch { return false; } };
  if (!resume || !await exists(path.join(output, 'realLife-paired.json'))) {
    console.log('MATRIX: paired realLife 200, current-main vs candidate, identical generated pixels');
    await command(paired, ['--suite=realLife', '--production=1', '--baselineMilo=1', `--url=${candidateUrl}`, `--baselineUrl=${baselineUrl}`, `--generatorUrl=${baselineUrl}`, `--chrome=${chrome}`, `--output=${path.join(output, 'realLife-paired.json')}`, `--releaseOutput=${candidateOutput}`, `--controlOutput=${controlOutput}`, `--captureOutput=${path.join(output, 'realLife-captures')}`]);
  }
  for (const mode of modes.slice(1).filter(mode => mode !== 'arcaneMedium')) {
    if (resume && await exists(path.join(candidateOutput, `${mode}.json`))) continue;
    console.log(`MATRIX: ${mode}, fresh browser, full frozen candidate app`);
    await command(ui, [`--modes=${mode}`, `--url=${candidateUrl}`, `--chrome=${chrome}`, `--output=${candidateOutput}`, '--ai=1', '--milo=1']);
  }
  if (!resume || !await exists(path.join(output, 'arcane-medium-paired.json'))) {
    console.log('MATRIX: paired Arcane medium 200, unchanged original photo files, frozen main vs candidate');
    await command(paired, ['--suite=arcane', '--severity=medium', '--production=1', '--baselineMilo=1', `--url=${candidateUrl}`, `--baselineUrl=${baselineUrl}`, `--generatorUrl=${baselineUrl}`, `--chrome=${chrome}`, `--output=${path.join(output, 'arcane-medium-paired.json')}`, `--releaseOutput=${candidateOutput}`, `--controlOutput=${controlOutput}`]);
  }
}

const captureFailure = (label, fn) => {
  try { fn(); } catch (error) { report.failures.push({ label, message: error.message }); }
};
const results = {};
for (const mode of modes) {
  const filename = path.join(candidateOutput, `${mode}.json`);
  const bytes = await readFile(filename);
  const result = results[mode] = JSON.parse(bytes);
  report.results[mode] = { file: path.relative(output, filename), sha256: sha256(bytes), build: result.build, summary: result.summary };
  captureFailure(mode, () => {
    assert.equal(result.build, candidateProof.build, 'One frozen candidate throughout every complete suite');
    assert.equal(result.summary.n, limits[mode][0], 'All required scans completed');
    assert.equal(result.summary.errors, 0, 'No scan errors');
    assert.equal(result.errors?.length || 0, 0, 'No hidden exported scan errors');
    assert.ok(result.summary.accuracy >= limits[mode][1], 'Documented accuracy floor');
    assertNativeMatrixPrecision(result, mode);
    if (mode === 'tableauVegasEdh20') {
      assert.ok(result.summary.byCoverage['0 (clear)'].acc >= .84, 'Vegas clear-card floor');
      for (const [rotation, bucket] of Object.entries(result.summary.byRotation)) assert.ok(bucket.ok / bucket.n >= .77, `Vegas rotation ${rotation}`);
      assert.ok(result.misses.every(miss => miss.perfectControl), 'Every Vegas miss has a perfect-crop control');
    }
    if (mode === 'recentHint20') {
      const hint = result.summary.recentHint;
      assert.equal(hint.hits, hint.attempted, 'Every hint attempt verified');
      assert.equal(hint.fullCropFallbacks.length, 0, 'No full fallback on positive repeated hints');
      assert.equal(result.summary.wasmHeapStartMB, result.summary.wasmHeapEndMB, 'Flat WASM heap');
      assert.ok(hint.speedup >= 2, 'Material recent-hint speedup');
    }
  });
}
const controlBytes = await readFile(path.join(controlOutput, 'realLife.json'));
const primaryControl = JSON.parse(controlBytes);
report.controlPrimary = { file: 'control/realLife.json', sha256: sha256(controlBytes), summary: primaryControl.summary };
captureFailure('realLife current-main retention', () => {
  assert.equal(primaryControl.build, controlProof.build, 'Frozen current-main primary arm');
  assertNativePrimaryRetention(results.realLife, primaryControl);
  assert.ok(results.realLife.misses.every(miss => miss.perfectControl), 'Each primary miss has an exact perfect-crop control');
});
// Keep asynchronous paired-file parsing outside the synchronous gate wrapper.
const pair = JSON.parse(await readFile(path.join(output, 'realLife-paired.json'), 'utf8'));
captureFailure('realLife full paired records', () => {
  assert.equal(pair.completed, 200); assert.equal(pair.records.length, 200);
  assert.equal(pair.paired, true); assert.equal(pair.baselineMilo, true);
  assert.ok(pair.records.every(row => row.ai.build === candidateProof.build && row.baseline.build === controlProof.build));
  assert.ok(pair.records.every(row => !row.baseline.ok || row.ai.ok), 'Every previously correct source identity retained');
});
const photoBytes = await readFile(path.join(output, 'arcane-medium-paired.json'));
const photos = JSON.parse(photoBytes);
const manifest = JSON.parse(await readFile(path.join(root, 'public/snaptest/arcane/manifest.json'), 'utf8')).medium;
const oldPhotoBytes = await readFile(path.join(controlOutput, 'arcaneMedium.json'));
const oldPhotos = JSON.parse(oldPhotoBytes);
report.pairedPhotos = { file: 'arcane-medium-paired.json', sha256: sha256(photoBytes), summary: photos.summary };
report.photoControl = { file: 'control/arcaneMedium.json', sha256: sha256(oldPhotoBytes) };
captureFailure('Arcane complete per-card retention', () => {
  assert.equal(photos.suite, 'arcane'); assert.equal(photos.severity, 'medium');
  assert.equal(photos.paired, true); assert.equal(photos.baselineMilo, true);
  assert.equal(photos.completed, 200); assert.equal(photos.records.length, 200);
  for (const [index, row] of photos.records.entries()) {
    assert.equal(row.id, manifest[index].id, 'Unchanged supplied-photo ID and order');
    assert.equal(row.file, manifest[index].file, 'Unchanged supplied-photo file');
    assert.equal(row.name, manifest[index].name, 'Unchanged visible-front identity, including Arlinn Kord');
    assert.equal(row.ai.build, candidateProof.build); assert.equal(row.baseline.build, controlProof.build);
    assert.ok(!row.ai.error && !row.baseline.error, 'No paired photo scan errors');
    assert.ok(!row.baseline.ok || row.ai.ok, 'Every previously correct supplied-photo identity retained');
  }
  assert.equal(oldPhotos.build, controlProof.build);
  assert.equal(oldPhotos.summary.n, 200); assert.equal(oldPhotos.summary.errors, 0);
  assert.ok(oldPhotos.summary.accuracy >= .99, 'Current-main supplied-photo floor is retained');
  assertNativeMatrixPrecision(oldPhotos, 'Arcane current-main control');
});
report.completed = true;
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ completed: true, output, builds: [controlProof.build, candidateProof.build], suites: Object.fromEntries(Object.entries(results).map(([mode, result]) => [mode, { correct: result.summary.correct, n: result.summary.n, accuracy: result.summary.accuracy, medianMs: result.summary.medianMs, p90Ms: result.summary.p90Ms }])), failures: report.failures }, null, 2));
assert.equal(report.failures.length, 0, 'Complete matrix must have no failed release gates');
