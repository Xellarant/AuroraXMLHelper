const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');
const { runAuroraShapeValidator } = require('../scripts/aurora-shape-validator');

const runTest = globalThis.test || function standaloneTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
};

runTest('generated fixture XML passes Aurora shape validator when available', () => {
  const requireValidator = process.argv.includes('--required') || process.env.AURORA_REQUIRE_VALIDATOR === '1';
  const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.fixture.json');
  const { xml } = generateFromFixtureFile(fixturePath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-validator-'));
  const xmlPath = path.join(tempRoot, 'synthetic-fixture.xml');
  fs.writeFileSync(xmlPath, xml, 'utf8');

  const result = runAuroraShapeValidator({ rootPath: tempRoot });
  if (result.skipped) {
    if (requireValidator) assert.fail(result.reason);
    console.log(`ok - validator skipped: ${result.reason}`);
    return;
  }

  assert.equal(
    result.ok,
    true,
    [
      'Aurora XML shape validator failed.',
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n')
  );
}, 15000);
