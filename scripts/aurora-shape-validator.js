const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultValidatorPath = path.join(repoRoot, 'scripts', 'Test-AuroraXmlShape.ps1');
const STARTUP_TIMEOUT_MS = 30000;
const VALIDATION_TIMEOUT_MS = 30000;
let cachedPowerShell;

function timeoutValue(value, fallback) {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new RangeError('Validator timeouts must be positive integers.');
  return timeout;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitPathList(value) {
  return String(value || '')
    .split(path.delimiter)
    .map(part => part.trim())
    .filter(Boolean);
}

function powerShellCandidates() {
  const candidates = [
    process.env.AURORA_POWERSHELL,
    process.env.POWERSHELL_EXE,
    'pwsh',
    'powershell'
  ];

  for (const dir of splitPathList(process.env.PATH)) {
    candidates.push(path.join(dir, 'pwsh.exe'));
    candidates.push(path.join(dir, 'powershell.exe'));
  }

  if (process.env.SystemRoot) {
    candidates.push(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    candidates.push(path.join(process.env.SystemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  }
  candidates.push('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  candidates.push('C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe');
  return unique(candidates);
}

function findPowerShell(options = {}) {
  const timeoutMs = timeoutValue(options.timeoutMs, STARTUP_TIMEOUT_MS);
  const candidates = powerShellCandidates();
  const cacheKey = candidates.join('\0');
  if (cachedPowerShell?.key === cacheKey) return cachedPowerShell.command;
  const deadline = Date.now() + timeoutMs;
  for (const command of candidates) {
    if (command.includes(path.sep) && !fs.existsSync(command)) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error(`PowerShell startup check exceeded its ${timeoutMs}ms limit.`), { code: 'ETIMEDOUT' });
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL', windowsHide: true
    });
    if (result.error?.code === 'ETIMEDOUT') {
      throw Object.assign(new Error(`PowerShell startup check timed out after ${timeoutMs}ms (${command}).`, { cause: result.error }), { code: 'ETIMEDOUT' });
    }
    if (!result.error && result.status === 0) {
      cachedPowerShell = { key: cacheKey, command };
      return command;
    }
  }
  return '';
}

function runAuroraShapeValidator(options = {}) {
  const rootPath = options.rootPath;
  if (!rootPath) throw new Error('Missing rootPath for Aurora XML shape validation.');
  const validatorPath = options.validatorPath || defaultValidatorPath;
  const timeoutMs = timeoutValue(options.timeoutMs, VALIDATION_TIMEOUT_MS);
  let powershell = options.powershell;
  try {
    powershell ||= findPowerShell({ timeoutMs: options.startupTimeoutMs });
  } catch (error) {
    return { available: false, skipped: false, command: '', ok: false, timedOut: error.code === 'ETIMEDOUT', error, stdout: '', stderr: error.message };
  }
  if (!powershell) {
    return {
      available: false,
      skipped: true,
      reason: 'PowerShell is not available',
      command: ''
    };
  }

  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    validatorPath,
    '-RootPath',
    rootPath,
    '-Json'
  ];
  const result = spawnSync(powershell, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    available: true,
    skipped: false,
    command: powershell,
    status: result.status,
    stdout: result.stdout || '',
    stderr: [result.stderr, timedOut ? `Aurora XML validator timed out after ${timeoutMs}ms (${powershell}).` : result.error?.message].filter(Boolean).join('\n'),
    timedOut,
    error: result.error || null,
    ok: !result.error && result.status === 0
  };
}

module.exports = {
  STARTUP_TIMEOUT_MS,
  VALIDATION_TIMEOUT_MS,
  defaultValidatorPath,
  findPowerShell,
  runAuroraShapeValidator
};
