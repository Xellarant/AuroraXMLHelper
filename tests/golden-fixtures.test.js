const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateFromFixtureFile } = require('./fixture-harness');

const fixturesRoot = path.join(__dirname, 'fixtures', 'golden');

function listFixtureFiles() {
  return fs.readdirSync(fixturesRoot)
    .filter(file => file.endsWith('.fixture.json'))
    .map(file => path.join(fixturesRoot, file));
}

function countLiteral(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function summarizeCounts(data) {
  return Object.fromEntries(Object.entries(data)
    .filter(([, items]) => Array.isArray(items) && items.length)
    .map(([type, items]) => [type, items.length]));
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

for (const fixtureFile of listFixtureFiles()) {
  test(`golden fixture: ${path.basename(fixtureFile)}`, () => {
    const result = generateFromFixtureFile(fixtureFile);
    const expected = result.fixture.expected || {};
    const counts = summarizeCounts(result.data);

    if (expected.ruleset) {
      assert.equal(result.meta.ruleset, expected.ruleset, 'ruleset');
    }
    if (expected.counts) {
      assert.deepEqual(counts, expected.counts, 'extracted counts');
    }
    for (const snippet of expected.snippets || []) {
      assert.ok(result.xml.includes(snippet), `missing expected snippet: ${snippet}`);
    }
    for (const snippet of expected.notIncludes || []) {
      assert.ok(!result.xml.includes(snippet), `unexpected snippet present: ${snippet}`);
    }
    for (const expectation of expected.regexCounts || []) {
      assert.equal(
        countLiteral(result.xml, expectation.pattern),
        expectation.count,
        `count for ${expectation.pattern}`
      );
    }
  });
}
