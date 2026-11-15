const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');
const { runAuroraShapeValidator, STARTUP_TIMEOUT_MS, VALIDATION_TIMEOUT_MS } = require('../scripts/aurora-shape-validator');
const { validateAuroraXmlDocuments } = require('../src/aurora-xml-shape');
// Allow both bounded subprocesses to finish before the test runner's deadline.
const validatorTestTimeoutMs = STARTUP_TIMEOUT_MS + VALIDATION_TIMEOUT_MS + 10000;

function withTempFixture(prefix, fn) {
  const temporaryBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryBase, prefix));
  try {
    return fn(directory);
  } finally {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), temporaryBase);
    assert.ok(path.basename(absolute).startsWith(prefix));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

const runTest = globalThis.test || function standaloneTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
};

runTest('extracted browser shape module catches duplicate element IDs', () => {
  const elementNode = attrs => ({
    tagName: 'element',
    getAttribute(name) { return attrs[name] || ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  const updateNode = {
    getAttribute(name) { return name === 'version' ? '0.1.0' : ''; },
    querySelectorAll(selector) {
      return selector === 'file'
        ? [{ getAttribute(name) { return name === 'name' ? 'duplicate.xml' : 'duplicate.xml'; } }]
        : [];
    }
  };
  const infoNode = {
    querySelector(selector) {
      if (selector === 'update') return updateNode;
      return null;
    }
  };
  class DOMParser {
    parseFromString() {
      return {
        querySelector() { return null; },
        documentElement: {
          tagName: 'elements',
          children: [
            elementNode({ name: 'First', type: 'Feat', source: 'Duplicate Fixture', id: 'ID_DUPLICATE_FIXTURE_FEAT_REPEAT' }),
            elementNode({ name: 'Second', type: 'Feat', source: 'Duplicate Fixture', id: 'ID_DUPLICATE_FIXTURE_FEAT_REPEAT' })
          ],
          querySelector(selector) {
            if (selector === 'info') return infoNode;
            return null;
          }
        }
      };
    }
  }

  const issues = validateAuroraXmlDocuments([{ fileName: 'duplicate.xml', xml: '<elements />' }], 'Unit Test', { DOMParser });

  assert.ok(issues.some(issue => issue.code === 'DuplicateElementIds' && issue.msg.includes('duplicate.xml')));
});

runTest('generated fixture XML passes Aurora shape validator when available', () => withTempFixture('aurora-xml-helper-validator-', tempRoot => {
  const requireValidator = process.argv.includes('--required') || process.env.AURORA_REQUIRE_VALIDATOR === '1';
  const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.fixture.json');
  const { xml } = generateFromFixtureFile(fixturePath);
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
}), validatorTestTimeoutMs);

runTest('Aurora shape validator catches duplicate element IDs in one file when available', () => withTempFixture('aurora-xml-helper-validator-duplicate-', tempRoot => {
  const requireValidator = process.argv.includes('--required') || process.env.AURORA_REQUIRE_VALIDATOR === '1';
  fs.writeFileSync(path.join(tempRoot, 'duplicate.xml'), `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <info>
    <name>Duplicate Fixture</name>
    <update version="0.1.0">
      <file name="duplicate.xml" url="duplicate.xml" />
    </update>
  </info>
  <element name="First" type="Feat" source="Duplicate Fixture" id="ID_DUPLICATE_FIXTURE_FEAT_REPEAT" />
  <element name="Second" type="Feat" source="Duplicate Fixture" id="ID_DUPLICATE_FIXTURE_FEAT_REPEAT" />
</elements>`, 'utf8');

  const result = runAuroraShapeValidator({ rootPath: tempRoot });
  if (result.skipped) {
    if (requireValidator) assert.fail(result.reason);
    console.log(`ok - validator skipped: ${result.reason}`);
    return;
  }

  assert.equal(result.ok, false);
  assert.match(result.stdout, /DuplicateElementIds/);
  assert.match(result.stdout, /ID_DUPLICATE_FIXTURE_FEAT_REPEAT/);
}), validatorTestTimeoutMs);
