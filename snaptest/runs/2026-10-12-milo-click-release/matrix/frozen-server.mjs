#!/usr/bin/env node
// Local full-production build. Source is snapshotted before Vite sees it;
// public fixtures/catalog are deliberately shared and fingerprinted separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const flags = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || '1'];
}));
if (flags.help) {
  console.log('Usage: node .cache/card35/frozen-server.mjs [--baseline=ae8d3d2] --output=.cache/card35/frozen-35 --port=5188 [--build-only=1 | --snapshot-only=1 | --serve-only=1]');
  process.exit(0);
}
const baseline = flags.baseline === '1' ? 'ae8d3d2' : flags.baseline || '';
const output = path.resolve(root, flags.output || `.cache/card35/frozen-${baseline ? '34' : '35'}`);
const project = path.join(output, 'project');
const compiled = path.join(output, 'compiled');
const proofPath = path.join(output, 'source-proof.json');
const port = Number(flags.port || (baseline ? 5187 : 5188));
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, 'A valid unprivileged port is required');
assert.ok(![flags['build-only'], flags['snapshot-only'], flags['serve-only']].filter(value => value && value !== '0').slice(1).length, 'Choose at most one execution mode');
assert.ok(output.startsWith(path.join(root, '.cache', 'card35') + path.sep), 'Keep this research build under .cache/card35');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const readOriginal = async file => baseline ? Buffer.from(git('show', `${baseline}:${file}`)) : readFile(path.join(root, file));
const catalogFiles = ['public/carddata/manifest.json', 'public/carddata/cards.json', 'public/carddata/milo/manifest.json'];
const catalogDigests = async () => Object.fromEntries(await Promise.all(catalogFiles.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
let proof;

if (flags['serve-only'] && flags['serve-only'] !== '0') {
  proof = JSON.parse(await readFile(proofPath, 'utf8'));
  assert.equal(proof.baseline || '', baseline, 'Serve the requested frozen arm');
  for (const [file, digest] of Object.entries(proof.sourceDigests)) assert.equal(sha256(await readFile(path.join(project, file))), digest, `Frozen source changed: ${file}`);
  for (const [file, digest] of Object.entries(proof.buildInputDigests)) assert.equal(sha256(await readFile(path.join(project, file))), digest, `Frozen build input changed: ${file}`);
  assert.ok(proof.compiled, 'The snapshot must already have a production build');
  for (const [file, digest] of Object.entries(proof.compiledDigests)) assert.equal(sha256(await readFile(path.join(compiled, file))), digest, `Compiled asset changed: ${file}`);
} else {
  const listed = baseline ? git('ls-tree', '-r', '--name-only', baseline, '--', 'src') : execFileSync('rg', ['--files', 'src'], { cwd: root, encoding: 'utf8' });
  const sourceFiles = listed.trim().split('\n').filter(file => /\.(jsx?|css)$/.test(file)).sort();
  assert.ok(sourceFiles.includes('src/main.jsx') && sourceFiles.includes('src/SnapTest.jsx'), 'Full production source is required');
  const frozenSource = new Map(await Promise.all(sourceFiles.map(async file => [file, await readOriginal(file)])));
  // A second read catches an edit during snapshot acquisition. Later edits are
  // harmless because neither Vite nor the server reads live application source.
  if (!baseline) for (const [file, data] of frozenSource) assert.equal(sha256(await readFile(path.join(root, file))), sha256(data), `Source changed during snapshot: ${file}`);
  const buildInputs = new Map(await Promise.all(['index.html', 'vite.config.js', 'package.json'].map(async file => [file, await readOriginal(file)])));
  buildInputs.set('vercel.json', await readFile(path.join(root, 'vercel.json')));
  await mkdir(project, { recursive: true });
  await rm(path.join(project, 'src'), { recursive: true, force: true });
  for (const [file, data] of [...frozenSource, ...buildInputs]) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await writeFile(path.join(project, file), data);
  }
  try { await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir'); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const main = frozenSource.get('src/main.jsx').toString('utf8');
  proof = {
    schema: 'snapcast-frozen-full-production-v1', createdAt: new Date().toISOString(),
    baseline: baseline || null, commit: git('rev-parse', baseline || 'HEAD').trim(),
    build: JSON.parse(main.match(/const BUILD = ("[^"]+")/)?.[1] || '"unknown"'),
    sourceDigests: Object.fromEntries([...frozenSource].map(([file, data]) => [file, sha256(data)])),
    buildInputDigests: Object.fromEntries([...buildInputs].map(([file, data]) => [file, sha256(data)])),
    catalogDigests: await catalogDigests(),
    catalog: {
      manifest: JSON.parse(await readFile(path.join(root, 'public/carddata/manifest.json'), 'utf8')),
      milo: JSON.parse(await readFile(path.join(root, 'public/carddata/milo/manifest.json'), 'utf8')),
    },
    sourceCount: sourceFiles.length, compiled: false,
    productionHeaders: JSON.parse(buildInputs.get('vercel.json')).headers,
    limitations: [
      'All application JS/JSX/CSS, full index.html and Vite configuration are immutable copies. No Game, signaling or recognition adapter is injected.',
      'Both arms serve the same current public catalog/assets. Catalog manifest/cards/model-gallery identifiers are recorded separately from application source.',
      'The exact Vercel production headers including CSP are applied. This loopback static server does not implement production APIs and rejects all mutations.',
      'Frozen raw /src modules are exposed solely for the paired SNAPTEST sampler and scene/degradation generator. The application uses production compiled assets.',
    ],
  };
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
  if (flags['snapshot-only'] && flags['snapshot-only'] !== '0') {
    console.log(JSON.stringify({ snapshotOnly: true, output, build: proof.build, sourceCount: proof.sourceCount, proof: proofPath }));
    process.exit(0);
  }
  await build({
    root: project, configFile: path.join(project, 'vite.config.js'), envDir: root,
    publicDir: false, build: { outDir: compiled, emptyOutDir: true },
  });
  proof.compiled = true;
  proof.compiledAt = new Date().toISOString();
  const builtFiles = execFileSync('rg', ['--files', '--no-ignore', 'compiled'], { cwd: output, encoding: 'utf8' }).trim().split('\n').sort();
  proof.compiledDigests = Object.fromEntries(await Promise.all(builtFiles.map(async file => [file.slice('compiled/'.length), sha256(await readFile(path.join(output, file)))])));
  assert.deepEqual(await catalogDigests(), proof.catalogDigests, 'Catalog changed during production build');
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
}
assert.deepEqual(await catalogDigests(), proof.catalogDigests, 'Shared catalog must match the frozen proof');
if (flags['build-only'] && flags['build-only'] !== '0') {
  console.log(JSON.stringify({ buildOnly: true, output, build: proof.build, sourceCount: proof.sourceCount, proof: proofPath }));
  process.exit(0);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.onnx': 'application/octet-stream', '.ico': 'image/x-icon' };
const safeFile = (directory, pathname) => {
  const file = path.resolve(directory, '.' + pathname);
  return file.startsWith(directory + path.sep) ? file : null;
};
const regularFile = async file => file && (await stat(file).catch(() => null))?.isFile() ? file : null;
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    for (const rule of proof.productionHeaders) {
      const applies = rule.source === '/(.*)' || rule.source === '/vendor/(.*)' && pathname.startsWith('/vendor/') || rule.source === '/carddata/(.*)' && pathname.startsWith('/carddata/');
      if (applies) for (const header of rule.headers) res.setHeader(header.key, header.value);
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Read-only fixture server'); return; }
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/mock-data.local.json' || pathname.startsWith('/experimental/') || pathname.includes('..') || pathname.includes('\0')) { res.writeHead(404); res.end('Not found'); return; }
    let file;
    if (pathname.startsWith('/src/')) {
      assert.ok(Object.hasOwn(proof.sourceDigests, pathname.slice(1)), 'Only frozen application modules are served');
      file = await regularFile(safeFile(project, pathname));
    } else {
      file = await regularFile(safeFile(compiled, pathname));
      file ||= await regularFile(safeFile(path.join(root, 'public'), pathname));
      if (!file && (pathname === '/' || !path.extname(pathname))) file = path.join(compiled, 'index.html');
    }
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    const metadata = await stat(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', metadata.size);
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log(JSON.stringify({ ready: true, url: `http://127.0.0.1:${port}`, output, build: proof.build, sourceCount: proof.sourceCount, proof: proofPath }));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  try {
    assert.deepEqual(await catalogDigests(), proof.catalogDigests, 'Catalog changed while serving');
    await writeFile(path.join(output, 'server-proof.json'), JSON.stringify({ closedAt: new Date().toISOString(), catalogUnchanged: true, build: proof.build }, null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  server.close(() => process.exit(process.exitCode || 0));
  server.closeAllConnections();
});
