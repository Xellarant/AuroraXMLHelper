const assert = require('node:assert/strict');
const { digest, releaseFiles, inspectRelease, waitForRelease } = require('../scripts/verify-release');

const files = [{ file: 'index.html', sha256: digest('new page') }, { file: 'src/app.js', sha256: digest('new app') }];
const response = (text, status = 200) => ({ status, text: async () => text });

test('browser UTF-8 decoding and Windows line endings do not cause a false release mismatch', () => {
  assert.equal(digest('\uFEFFnew page\r\n'), digest('new page\n'));
  assert.notEqual(digest('old page\n'), digest('new page\n'));
});

test('release verification covers all local script dependencies and the PDF worker', () => {
  const paths = releaseFiles().map(file => file.file);
  for (const required of ['index.html', 'src/user-messages.js', 'src/remembered-corrections.js', 'src/app.js', 'src/draft-storage.js', 'src/draft-recovery.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/jszip.min.js']) {
    assert.ok(paths.includes(required), `${required} must be verified on the deployed site`);
  }
});

test('mixed or missing deployed files fail even when the home page is current', async () => {
  const results = await inspectRelease('https://example.test/project/', files, {
    fetchImpl: async url => response(url.pathname.endsWith('index.html') ? 'new page' : 'old app')
  });
  assert.deepEqual(results.map(result => result.ok), [true, false]);
  const missing = await inspectRelease('https://example.test/project/', files, { fetchImpl: async () => response('Not found', 404) });
  assert.ok(missing.every(result => !result.ok && result.reason === 'HTTP 404'));
});

test('verification waits for deployment propagation, retaining the project URL path', async () => {
  const requested = [];
  const results = await waitForRelease('https://example.test/project/', files, {
    timeoutMs: 1000, intervalMs: 0,
    fetchImpl: async url => {
      requested.push(url.pathname);
      return response(url.searchParams.get('release-check').endsWith('-1') ? 'stale' : url.pathname.endsWith('app.js') ? 'new app' : 'new page');
    }
  });
  assert.ok(results.every(result => result.ok));
  assert.ok(requested.every(url => url.startsWith('/project/')));
});

test('a stale release or request failure produces a bounded failure with file details', async () => {
  await assert.rejects(waitForRelease('https://example.test/project/', files, {
    timeoutMs: 0, fetchImpl: async () => { throw new Error('Network failure'); }
  }), /index.html: Network failure/);
});

test('the overall release deadline also bounds a slow request in the last attempt', async () => {
  let configured;
  const started = Date.now();
  await assert.rejects(waitForRelease('https://example.test/project/', files, {
    timeoutMs: 20, requestTimeoutMs: 1000,
    fetchImpl: async (url, options) => {
      configured = options.signal;
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Request deadline reached')), { once: true }));
    }
  }), /Request deadline reached/);
  assert.equal(configured.aborted, true);
  assert.ok(Date.now() - started < 500, 'A 20ms overall deadline must not wait for a 1000ms per-request timeout.');
});

test('empty checks and invalid wait settings cannot produce a misleading successful release', async () => {
  await assert.rejects(inspectRelease('https://example.test/project/', []), /at least one expected file/);
  await assert.rejects(waitForRelease('https://example.test/project/', files, { timeoutMs: NaN }), /nonnegative numbers/);
  await assert.rejects(waitForRelease('https://example.test/project/', files, { intervalMs: -1 }), /nonnegative numbers/);
  await assert.rejects(inspectRelease('https://example.test/project/', files, { requestTimeoutMs: 0 }), /positive number/);
});
