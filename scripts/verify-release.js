#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
// Fetch's UTF-8 decoder strips a byte-order mark; match that on local files too.
const digest = text => crypto.createHash('sha256').update(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).digest('hex');

function releaseFiles(root = repoRoot) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = new Set(['index.html', 'vendor/pdf.worker.min.mjs']);
  const references = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), ...html.matchAll(/\bfrom\s+["']([^"']+)["']/g)];
  for (const [, reference] of references) {
    if (/^(?:https?:|\/\/|data:)/i.test(reference)) continue;
    const relative = reference.replace(/^\.\//, '');
    if (relative.startsWith('/') || relative.split('/').includes('..')) throw new Error(`Unsupported release asset: ${reference}`);
    files.add(relative);
  }
  return [...files].map(file => ({ file, sha256: digest(fs.readFileSync(path.join(root, file), 'utf8')) }));
}

async function inspectRelease(baseUrl, files, { fetchImpl = fetch, attempt = 1, sha = 'workspace', requestTimeoutMs = 15000 } = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || !base.pathname.endsWith('/')) throw new Error('Release URL must be an HTTP(S) site URL ending in /.');
  return Promise.all(files.map(async expected => {
    const url = new URL(expected.file, base);
    url.searchParams.set('release-check', `${sha}-${attempt}`);
    try {
      const response = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(requestTimeoutMs) });
      if (response.status !== 200) return { ...expected, ok: false, reason: `HTTP ${response.status}` };
      const actual = digest(await response.text());
      return { ...expected, actual, ok: actual === expected.sha256, ...(actual !== expected.sha256 ? { reason: 'Content differs from the checked-out release' } : {}) };
    } catch (error) { return { ...expected, ok: false, reason: error.message }; }
  }));
}

async function waitForRelease(baseUrl, files, options = {}) {
  const { timeoutMs = 180000, intervalMs = 5000, onAttempt = () => {} } = options;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let results;
  do {
    results = await inspectRelease(baseUrl, files, { ...options, attempt: ++attempt });
    onAttempt(results, attempt);
    if (results.every(result => result.ok)) return results;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  } while (Date.now() <= deadline);
  throw Object.assign(new Error(`The live release did not match within ${timeoutMs}ms: ${results.filter(result => !result.ok).map(result => `${result.file}: ${result.reason}`).join('; ')}`), { results });
}

async function main() {
  const url = process.env.RELEASE_BASE_URL;
  if (!url) throw new Error('Set RELEASE_BASE_URL to the published site URL ending in /.');
  const outputDirectory = path.resolve(process.env.SMOKE_REPORT_DIR || path.join(repoRoot, 'artifacts', 'release'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const report = { ok: false, url, sha: process.env.RELEASE_SHA || 'working tree', checkedAt: new Date().toISOString() };
  try {
    report.assets = await waitForRelease(url, releaseFiles(), {
      sha: process.env.RELEASE_SHA,
      timeoutMs: Number(process.env.RELEASE_WAIT_MS || 180000),
      onAttempt(results, attempt) {
        const pending = results.filter(result => !result.ok).map(result => `${result.file}: ${result.reason}`).join('; ');
        console.log(`Release check ${attempt}: ${results.filter(result => result.ok).length}/${results.length} files match.${pending ? ` Waiting for ${pending}` : ''}`);
      }
    });
    const smoke = spawnSync(process.execPath, [path.join(__dirname, 'browser-smoke.js')], {
      cwd: repoRoot,
      env: { ...process.env, SMOKE_BASE_URL: url, SMOKE_REPORT_DIR: outputDirectory },
      stdio: 'inherit',
      timeout: 180000
    });
    if (smoke.error) throw smoke.error;
    if (smoke.status !== 0) throw new Error(`Published-site browser checks failed (exit ${smoke.status}).`);
    report.ok = true;
    console.log(`Verified release ${report.sha} at ${url}`);
  } catch (error) {
    report.error = error.message;
    if (error.results) report.assets = error.results;
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputDirectory, 'release-verification.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

module.exports = { digest, releaseFiles, inspectRelease, waitForRelease };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
