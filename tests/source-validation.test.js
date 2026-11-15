const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');
const { sourceLineRecords, sourceContextForName } = require('../scripts/benchmark-corpus');
const { buildSourceReport } = require('../scripts/source-fixture-report');
const temporaryDirectory = require('./temp-directories').temporaryDirectories();
const {
  createSourceModel,
  validateSourceModel,
  renderSourceCoverageMarkdown,
  extractMarkdownTables
} = require('../scripts/source-validation');

function syntheticSourceModel() {
  const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.fixture.json');
  const result = generateFromFixtureFile(fixturePath);
  const pages = [{ page: 1, text: result.sourceText }];
  const records = sourceLineRecords(pages);
  return createSourceModel({
    sourcePath: result.sourceFile,
    sourceKind: 'text',
    pages,
    sourceMeta: result.fixture.sourceMeta,
    generatedMeta: result.meta,
    parsedData: result.data,
    types: result.fixture.types,
    sourceRecords: records,
    sourceContextForName
  });
}

test('source references prefer a definition over an earlier spell-list entry', () => {
  const records = sourceLineRecords([
    { page: 1, text: '2nd Copper Flash Evocation' },
    { page: 3, text: 'COPPER FLASH\n2nd-level evocation\nCasting Time: 1 action' }
  ]);
  const context = sourceContextForName(records, 'Copper Flash');
  assert.equal(context.page, 3);
  assert.equal(context.text, 'COPPER FLASH');
  const decorative = sourceContextForName(sourceLineRecords([{ page: 8, text: 'Be LL of Copper' }]), 'Bell of Copper');
  assert.equal(decorative.page, 8);
});

test('source gates check metadata values and reject known sidebar contamination', () => {
  const model = syntheticSourceModel();
  const spell = model.entitiesByType.spell[0];
  spell.metadata.level = 0;
  spell.metadata.isOptional = false;
  spell.bodyText = 'Rules text. A synthetic author note is present.';
  const expectations = {
    requiredMetadata: { spell: { [spell.name]: { level: 0, isOptional: false } } },
    forbiddenText: { spell: { [spell.name]: ['a synthetic author note'] } }
  };
  assert.ok(validateSourceModel(model, expectations).issues.some(issue => issue.category === 'unexpected-source-text'));
  spell.bodyText = 'Rules text.';
  assert.equal(validateSourceModel(model, expectations).summary.pass, true);
  delete spell.metadata.isOptional;
  assert.ok(validateSourceModel(model, expectations).issues.some(issue => issue.category === 'metadata-mismatch'));
});

test('a source gate catches missing mechanics text, ambiguous dice, and omitted creature statistics', () => {
  const model = syntheticSourceModel();
  const spell = model.entitiesByType.spell[0];
  spell.bodyText = 'It deals ld6 damage.';
  spell.metadata.statBlockName = 'Copper Wisp';
  spell.statBlock = '';
  const expectations = {
    requiredText: { spell: { [spell.name]: ['1d6 damage', 'Armor Class 12'] } },
    maxWarnings: 0
  };
  const incomplete = validateSourceModel(model, expectations);
  assert.equal(incomplete.summary.pass, false);
  assert.equal(incomplete.issues.filter(issue => issue.category === 'missing-source-text').length, 2);
  assert.ok(incomplete.issues.some(issue => issue.category === 'ocr-artifact' && /dice/.test(issue.message)));
  assert.ok(incomplete.issues.some(issue => issue.category === 'missing-stat-block'));
  spell.bodyText = 'It deals 1d6 damage. Armor Class 12.';
  spell.statBlock = 'Armor Class 12.';
  assert.equal(validateSourceModel(model, expectations).summary.pass, true);
});

test('source model preserves parser output, descriptions, tables, and source context', () => {
  const model = syntheticSourceModel();
  const mark = model.entitiesByType.feat.find(entity => entity.name === 'Mark of Storm');
  const cartographer = model.entitiesByType.archetype.find(entity => entity.name === 'Cartographer');

  assert.equal(model.source.ruleset, '2024');
  assert.deepEqual(model.counts, {
    spell: 1,
    archetype: 4,
    feat: 3,
    background: 1
  });
  assert.ok(mark.bodyText.includes('Spell Level'));
  assert.equal(mark.tables[0].headers[0], 'Spell Level');
  assert.equal(mark.tables[0].rows[0][0], '1');
  assert.equal(mark.sourceContext.text, '### Mark of Storm');
  assert.ok(mark.sourceContext.after[0].includes('Prerequisite'));
  assert.ok(cartographer.features.some(feature => feature.name === "Adventurer's Atlas" && feature.textLength > 40));
});

test('source validation reports expected entities and required feature coverage', () => {
  const model = syntheticSourceModel();
  const coverage = validateSourceModel(model, {
    minCounts: {
      spell: 1,
      archetype: 4,
      feat: 3,
      background: 1
    },
    expected: {
      spell: ['Clockwork Helper'],
      archetype: ['Cartographer'],
      feat: ['Mark of Storm']
    },
    requireTextTypes: ['spell', 'archetype', 'feat', 'background'],
    requireFeaturesForTypes: ['archetype'],
    requireFeatureTextTypes: ['archetype'],
    requiredFeatures: {
      archetype: {
        Cartographer: ["Adventurer's Atlas", 'Superior Atlas']
      }
    }
  });

  assert.equal(coverage.summary.error, 0);
  assert.equal(coverage.summary.pass, true);
});

test('source validation distinguishes hard missing entities from reviewable parser noise', () => {
  const model = {
    source: {
      path: 'fixture.txt',
      kind: 'text',
      pageCount: 1,
      name: 'Fixture',
      abbr: 'FIX',
      ruleset: '2024'
    },
    counts: { feat: 1, archetype: 1 },
    entitiesByType: {},
    entities: [
      {
        type: 'feat',
        name: 'You have a strange parser boundary',
        sourceContext: { page: 1, line: 2, text: 'You have a strange parser boundary' },
        bodyText: '',
        textLength: 0,
        features: [],
        tables: [],
        tableLikeLineCount: 0
      },
      {
        type: 'archetype',
        name: 'Noisy Artificer',
        sourceContext: null,
        bodyText: 'Feature body with Cant rip OCR damage.',
        textLength: 34,
        features: [{ name: 'Empty Feature', bodyText: '', textLength: 0 }],
        tables: [],
        tableLikeLineCount: 0
      }
    ]
  };

  const coverage = validateSourceModel(model, {
    expected: {
      feat: ['Missing Feat']
    },
    requireTextTypes: ['feat'],
    requireFeatureTextTypes: ['archetype']
  });

  assert.equal(coverage.summary.pass, false);
  assert.ok(coverage.issues.some(issue => issue.severity === 'error' && issue.category === 'missing-entity'));
  assert.ok(coverage.issues.some(issue => issue.severity === 'review' && issue.category === 'fragment-shaped-name'));
  assert.ok(coverage.issues.some(issue => issue.severity === 'warning' && issue.category === 'ocr-artifact'));
  assert.ok(coverage.issues.some(issue => issue.severity === 'warning' && issue.category === 'missing-feature-description'));
});

test('source validation flags PDF chrome, spell-table bleed, and sidebar OCR in descriptions', () => {
  const model = {
    source: {
      path: 'fixture.pdf',
      kind: 'pdf',
      pageCount: 1,
      name: 'Fixture',
      abbr: 'FIX',
      ruleset: '2014'
    },
    counts: { spell: 1 },
    entitiesByType: {},
    entities: [{
      type: 'spell',
      name: 'Noisy Spell',
      sourceContext: { page: 2, line: 10, text: 'NOISY SPELL' },
      bodyText: [
        'The spell starts cleanly.',
        'Cone. Ritual Class',
        '20 CHAPTER 2 I DRAGON MAGIC',
        'Se-ho{ay<; have, e,nga~ in [e,?1',
        '-nzban'
      ].join('\n'),
      textLength: 120,
      features: [],
      tables: [],
      tableLikeLineCount: 0
    }]
  };

  const coverage = validateSourceModel(model, {});

  assert.equal(coverage.summary.warning, 3);
  assert.ok(coverage.issues.some(issue => /spell table class-column artifact/.test(issue.message)));
  assert.ok(coverage.issues.some(issue => /PDF page header\/footer artifact/.test(issue.message)));
  assert.ok(coverage.issues.some(issue => /sidebar OCR artifact/.test(issue.message)));
});

test('source validation can opt into warning and review hard limits', () => {
  const model = {
    source: {
      path: 'fixture.pdf',
      kind: 'pdf',
      pageCount: 1,
      name: 'Fixture',
      abbr: 'FIX',
      ruleset: '2014'
    },
    counts: { spell: 1 },
    entitiesByType: {},
    entities: [{
      type: 'spell',
      name: 'You have a noisy boundary',
      sourceContext: { page: 2, line: 10, text: 'You have a noisy boundary' },
      bodyText: 'Cone. Ritual Class',
      textLength: 40,
      features: [],
      tables: [],
      tableLikeLineCount: 0
    }]
  };

  const defaultCoverage = validateSourceModel(model, {});
  const strictCoverage = validateSourceModel(model, { maxWarnings: 0, maxReview: 0 });

  assert.equal(defaultCoverage.summary.pass, true);
  assert.equal(strictCoverage.summary.warning, 1);
  assert.equal(strictCoverage.summary.review, 1);
  assert.equal(strictCoverage.summary.maxWarnings, 0);
  assert.equal(strictCoverage.summary.maxReview, 0);
  assert.equal(strictCoverage.summary.pass, false);
});

test('source validation reports duplicate entities and checks features across duplicates', () => {
  const model = {
    source: {
      path: 'fixture.txt',
      kind: 'text',
      pageCount: 1,
      name: 'Fixture',
      abbr: 'FIX',
      ruleset: '2024'
    },
    counts: { archetype: 2 },
    entitiesByType: {},
    entities: [
      {
        type: 'archetype',
        name: 'Cartographer',
        sourceContext: { page: 1, line: 10, text: 'Cartographer' },
        bodyText: 'First duplicate.',
        textLength: 16,
        features: [],
        tables: [],
        tableLikeLineCount: 0
      },
      {
        type: 'archetype',
        name: 'Cartographer',
        sourceContext: { page: 1, line: 30, text: 'Cartographer' },
        bodyText: 'Second duplicate.',
        textLength: 17,
        features: [{ name: "Adventurer's Atlas", bodyText: 'You create useful maps.', textLength: 23 }],
        tables: [],
        tableLikeLineCount: 0
      }
    ]
  };

  const coverage = validateSourceModel(model, {
    expected: {
      archetype: ['Cartographer']
    },
    requiredFeatures: {
      archetype: {
        Cartographer: ["Adventurer's Atlas"]
      }
    }
  });

  assert.equal(coverage.summary.error, 0);
  assert.equal(coverage.summary.warning, 1);
  assert.ok(coverage.issues.some(issue => issue.category === 'duplicate-entity' && issue.count === 2));
});

test('source coverage markdown gives a compact pass fail summary', () => {
  const model = syntheticSourceModel();
  const coverage = validateSourceModel(model, {
    expected: {
      spell: ['Clockwork Helper']
    }
  });
  const markdown = renderSourceCoverageMarkdown(model, coverage);

  assert.ok(markdown.includes('# Source Coverage Report'));
  assert.ok(markdown.includes('- Source gate: PASS'));
  assert.ok(markdown.includes('## Extracted Entity Summary'));
});

test('markdown table extraction keeps headers and rows', () => {
  const tables = extractMarkdownTables([
    'Before',
    '| Spell Level | Spells |',
    '| --- | --- |',
    '| 1 | Feather Fall, Fog Cloud |',
    'After'
  ].join('\n'));

  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ['Spell Level', 'Spells']);
  assert.deepEqual(tables[0].rows[0], ['1', 'Feather Fall, Fog Cloud']);
});

test('source fixture reporting forwards manifest pageRange to the source reader', async () => {
  const tempRoot = temporaryDirectory('aurora-xml-helper-source-range-');
  const sourcePath = path.join(tempRoot, 'fixture.txt');
  fs.writeFileSync(sourcePath, [
    'Range Spark',
    '1st-level evocation',
    'Casting Time: 1 Action',
    'Range: 30 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'A focused source-report fixture.'
  ].join('\n'), 'utf8');

  const result = await buildSourceReport({
    entry: {
      source: sourcePath,
      pageRange: '1',
      types: ['spell'],
      sourceMeta: { name: 'Range Fixture', abbr: 'RNG', author: 'Codex Fixture' }
    }
  });

  assert.equal(result.model.source.pageRange, '1');
  assert.equal(result.model.source.pageCount, 1);
  assert.ok(result.markdown.includes('- Selected page range: 1 (1/1 page)'));
});
