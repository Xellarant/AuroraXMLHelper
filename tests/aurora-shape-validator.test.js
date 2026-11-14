const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadValidator(spawnSync, now = Date.now, env = { PATH: '', AURORA_POWERSHELL: 'test-pwsh' }) {
  const filename = path.resolve(__dirname, '../scripts/aurora-shape-validator.js');
  const context = vm.createContext({
    module: { exports: {} }, __dirname: path.dirname(filename), Date: { now },
    process: { env },
    require(id) { return id === 'node:child_process' ? { spawnSync } : require(id); }
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

test('cold startup gets its own budget and successful discovery is reused', () => {
  let elapsed = 0;
  const calls = [];
  const env = { PATH: '', AURORA_POWERSHELL: 'test-pwsh' };
  const validator = loadValidator((command, args, options) => {
    calls.push({ command, args, options });
    elapsed += args.includes('-Command') ? 16000 : 2000;
    return { status: 0, stdout: 'ok', stderr: '' };
  }, () => elapsed, env);
  assert.equal(validator.runAuroraShapeValidator({ rootPath: 'fixture' }).ok, true);
  assert.equal(validator.runAuroraShapeValidator({ rootPath: 'fixture' }).ok, true);
  assert.equal(calls.length, 3, 'Only one startup probe is needed for two validations.');
  assert.equal(calls[0].options.timeout, validator.STARTUP_TIMEOUT_MS);
  assert.equal(calls[1].options.timeout, validator.VALIDATION_TIMEOUT_MS);
  assert.ok(calls.every(call => call.args.includes('-NonInteractive') && call.options.killSignal === 'SIGKILL' && call.options.windowsHide));
  env.AURORA_POWERSHELL = 'changed-pwsh';
  assert.equal(validator.runAuroraShapeValidator({ rootPath: 'fixture' }).ok, true);
  assert.equal(calls.length, 5, 'Changing the executable selection must invalidate cached discovery.');
  assert.equal(calls[4].command, 'changed-pwsh');
});

test('a hung startup fails explicitly instead of being treated as missing PowerShell', () => {
  let calls = 0;
  const validator = loadValidator(() => {
    calls++;
    return { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
  });
  const result = validator.runAuroraShapeValidator({ rootPath: 'fixture', startupTimeoutMs: 25 });
  assert.equal(result.skipped, false);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /startup check timed out after 25ms/);
  assert.equal(result.timedOut, true);
  assert.equal(calls, 1, 'Do not repeat a hung startup through alternate executable names.');
});

test('startup candidates share one deadline rather than receiving a full timeout each', () => {
  let elapsed = 0;
  const timeouts = [];
  const validator = loadValidator((command, args, options) => {
    timeouts.push(options.timeout);
    elapsed += 20;
    return { status: 1, stdout: '', stderr: 'startup failed' };
  }, () => elapsed);
  const result = validator.runAuroraShapeValidator({ rootPath: 'fixture', startupTimeoutMs: 30 });
  assert.equal(result.skipped, false);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /startup check exceeded its 30ms limit/);
  assert.equal(result.timedOut, true);
  assert.deepEqual(timeouts, [30, 10]);
});

test('a hung validator is bounded and keeps partial output plus a useful timeout diagnostic', () => {
  let timeout;
  const validator = loadValidator((command, args, options) => {
    timeout = options.timeout;
    return { status: null, stdout: 'Partial findings', stderr: 'Partial diagnostic',
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
  });
  const result = validator.runAuroraShapeValidator({ rootPath: 'fixture', powershell: 'test-pwsh', timeoutMs: 50 });
  assert.equal(timeout, 50);
  assert.equal(result.skipped, false);
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout, 'Partial findings');
  assert.match(result.stderr, /Partial diagnostic\nAurora XML validator timed out after 50ms/);
});

test('invalid XML still fails without a retry, and missing PowerShell remains an optional skip', () => {
  let calls = 0;
  const validator = loadValidator(() => { calls++; return { status: 1, stdout: 'DuplicateElementIds', stderr: '' }; });
  const result = validator.runAuroraShapeValidator({ rootPath: 'fixture', powershell: 'test-pwsh' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'DuplicateElementIds');
  assert.equal(result.timedOut, false);
  assert.equal(calls, 1);
  const unavailable = loadValidator(() => ({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }));
  assert.equal(unavailable.runAuroraShapeValidator({ rootPath: 'fixture' }).skipped, true);
});
