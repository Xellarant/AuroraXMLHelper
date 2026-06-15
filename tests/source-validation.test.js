const assert = require('node:assert/strict');
const path = require('node:path');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');
const { sourceLineRecords, sourceContextForName } = require('../scripts/benchmark-corpus');
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
