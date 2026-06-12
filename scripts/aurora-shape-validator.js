const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultValidatorPath = path.join(repoRoot, 'scripts', 'Test-AuroraXmlShape.ps1');

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

function findPowerShell() {
  for (const command of powerShellCandidates()) {
    if (command.includes(path.sep) && !fs.existsSync(command)) continue;
    const result = spawnSync(command, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8'
    });
    if (!result.error && result.status === 0) return command;
  }
  return '';
}

function runAuroraShapeValidator(options = {}) {
  const rootPath = options.rootPath;
  if (!rootPath) throw new Error('Missing rootPath for Aurora XML shape validation.');
  const validatorPath = options.validatorPath || defaultValidatorPath;
  const powershell = options.powershell || findPowerShell();
  if (!powershell) {
    return {
      available: false,
      skipped: true,
      reason: 'PowerShell is not available',
      command: ''
    };
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    validatorPath,
    '-RootPath',
    rootPath,
    '-Json'
  ];
  const result = spawnSync(powershell, args, { encoding: 'utf8' });
  return {
    available: true,
    skipped: false,
    command: powershell,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
    ok: !result.error && result.status === 0
  };
}

module.exports = {
  defaultValidatorPath,
  findPowerShell,
  runAuroraShapeValidator
};
