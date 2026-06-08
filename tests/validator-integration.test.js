const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');

function findPowerShell() {
  const candidates = ['pwsh', 'powershell'];
  if (process.env.SystemRoot) {
    candidates.push(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  }
  candidates.push('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  for (const command of candidates) {
    const result = spawnSync(command, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8'
    });
    if (!result.error && result.status === 0) return command;
  }
  return '';
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('generated fixture XML passes Aurora shape validator when available', () => {
  const powershell = findPowerShell();
  if (!powershell) {
    console.log('ok - validator skipped: PowerShell is not available');
    return;
  }

  const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.fixture.json');
  const { xml } = generateFromFixtureFile(fixturePath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-validator-'));
  const xmlPath = path.join(tempRoot, 'synthetic-fixture.xml');
  fs.writeFileSync(xmlPath, xml, 'utf8');

  const validatorPath = path.join(repoRoot, 'scripts', 'Test-AuroraXmlShape.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    validatorPath,
    '-RootPath',
    tempRoot,
    '-Json'
  ];
  const result = spawnSync(powershell, args, { encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    [
      'Aurora XML shape validator failed.',
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n')
  );
});
