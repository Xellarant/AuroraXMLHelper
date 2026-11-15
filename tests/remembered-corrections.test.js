const assert = require('node:assert/strict');
const { capture, apply, describe } = require('../src/remembered-corrections');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const feature = (name, rest = {}) => ({ name, level: 1, description: 'Earlier prose.', action: 'Action', ...rest });
const copy = value => JSON.parse(JSON.stringify(value));

test('only edited fields of matched features change, across source reordering and new siblings', () => {
  const base = { name: 'Copper Adept', features: [feature('Sight'), feature('Flight')] };
  const edited = copy(base); edited.features[0].action = 'Bonus Action';
  const fresh = { name: 'Copper Adept', features: [feature('New feature'), feature('Flight'),
    feature('Sight', { description: 'Improved prose.', _source: { page: 9 } })] };
  const before = copy(fresh);
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.item.features.map(entry => entry.name), ['New feature', 'Flight', 'Sight']);
  assert.equal(result.item.features[2].action, 'Bonus Action');
  assert.equal(result.item.features[2].description, 'Improved prose.');
  assert.deepEqual(result.item.features[2]._source, { page: 9 });
  assert.deepEqual(fresh, before, 'Applying a correction must not mutate parser data or its baseline.');
});

test('nested class options match by choice and option names while preserving new options and references', () => {
  const base = { choices: [{ name: 'Hexes', feature: 'Hexes', options: [feature('Fog Bell')] }] };
  const edited = copy(base); edited.choices[0].options[0].action = 'Bonus Action';
  const fresh = copy(base);
  fresh.choices[0].options[0].description = 'Improved instructions.';
  fresh.choices[0].options[0]._source = { page: 8 };
  fresh.choices[0].options.push(feature('Rain Shield'));
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.issues, []);
  assert.equal(result.item.choices[0].options.length, 2);
  assert.equal(result.item.choices[0].options[0].action, 'Bonus Action');
  assert.equal(result.item.choices[0].options[0].description, 'Improved instructions.');
  assert.deepEqual(result.item.choices[0].options[0]._source, { page: 8 });
});

test('missing or renamed source features hold the correction and keep the fresh list intact', () => {
  const base = { features: [feature('Sight')] };
  const edited = { features: [feature('Sight', { action: 'Bonus Action' })] };
  const fresh = { features: [feature('Improved Sight')] };
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.item, fresh);
  assert.match(result.issues[0].message, /missing or was renamed.*Fresh source content was kept/);
});

test('ambiguous duplicate names never apply edits to an arbitrary record', () => {
  const base = { features: [feature('Sight')] };
  const edited = { features: [feature('Sight', { level: 3 })] };
  const fresh = { features: [feature('Sight'), feature('Sight', { level: 5 })] };
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.item, fresh);
  assert.match(result.issues[0].message, /same name or level/);
});

test('deleting a source entry that has since improved holds the whole list, including a related rename', () => {
  const base = { features: [feature('Sight')] };
  const edited = { features: [feature('Copper Sight')] };
  const fresh = { features: [feature('Sight', { description: 'Improved instructions.' }), feature('New feature')] };
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.item, fresh);
  assert.match(result.issues[0].message, /marked for removal changed/);
});

test('explicit additions and removals retain independently added source siblings and are idempotent', () => {
  const base = { features: [feature('Removed'), feature('Kept')] };
  const edited = { features: [feature('Kept'), feature('Added manually')] };
  const fresh = { features: [feature('Removed'), feature('Kept'), feature('New source feature')] };
  const record = capture(base, edited);
  const result = apply(fresh, record);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.item.features.map(entry => entry.name), ['Kept', 'New source feature', 'Added manually']);
  assert.deepEqual(apply(result.item, record).item, result.item);
});

test('changed text lists are held while unrelated scalar corrections can still apply', () => {
  const base = { name: 'Copper Gift', benefits: ['Original benefit.'] };
  const edited = { name: 'Copper Gift Edited', benefits: ['Corrected benefit.'] };
  const fresh = { name: 'Copper Gift', benefits: ['Improved benefit.', 'New source benefit.'] };
  const result = apply(fresh, capture(base, edited));
  assert.equal(result.item.name, 'Copper Gift Edited');
  assert.deepEqual(result.item.benefits, fresh.benefits);
  assert.match(result.issues[0].message, /list changed.*Review the saved correction/);
  assert.deepEqual(apply(base, capture(base, edited)).item, edited);
});

test('progression rows and choice schedules match by level rather than position', () => {
  const base = { progression: [{ level: 1, spellsKnown: 2 }, { level: 2, spellsKnown: 3 }] };
  const edited = copy(base); edited.progression[1].spellsKnown = 4;
  const fresh = { progression: [{ level: 1, spellsKnown: 2, features: ['New source feature'] }, { level: 2, spellsKnown: 3 }, { level: 3, spellsKnown: 5 }] };
  const result = apply(fresh, capture(base, edited));
  assert.deepEqual(result.issues, []);
  assert.equal(result.item.progression[1].spellsKnown, 4);
  assert.deepEqual(result.item.progression[0].features, ['New source feature']);
  assert.equal(result.item.progression.length, 3);
});

test('stored corrections strip source/review metadata and reject unsafe property names', () => {
  const base = { name: 'Copper', features: [feature('Sight', { _source: { page: 1 } })] };
  const edited = copy(base); edited._rememberedCorrectionIssues = [{ message: 'old' }]; edited.features[0].level = 3;
  const record = capture(base, edited);
  assert.equal(record.item.features[0]._source, undefined);
  assert.equal(record.baseline.features[0]._source, undefined);
  assert.equal(record.item._rememberedCorrectionIssues, undefined);
  assert.equal(describe(record.item).includes('_source'), false);
});

test('older field masks apply scalar edits while holding collections, and full replacements are held', () => {
  const fresh = { name: 'Copper', range: '90 feet', features: [feature('New source feature')] };
  const saved = { item: { ...fresh, range: '60 feet', features: [feature('Old source feature')] }, fields: ['range', 'features'] };
  const result = apply(fresh, saved);
  assert.equal(result.item.range, '60 feet');
  assert.deepEqual(result.item.features, fresh.features);
  assert.match(result.issues[0].message, /older correction.*individual entries/);
  assert.deepEqual(apply(fresh, { item: saved.item }).item, fresh);
});

test('held corrections survive draft restore, show escaped saved values, and can be forgotten', () => {
  const { context } = loadApp();
  const old = { name: 'Copper Gift', description: '', benefits: ['Original benefit.'] };
  const edited = { ...old, benefits: ['<script>saved correction</script>'] };
  runInApp(context, 'extractedData.feat = ' + JSON.stringify([{ ...old, benefits: ['New source benefit.'] }]) + '; captureGeneratedBaseline();');
  const storageKey = context.overrideKeyForIndex('feat', 0);
  runInApp(context, 'rememberedOverrides = ' + JSON.stringify({ [storageKey]: { type: 'feat', ...capture(old, edited) } }) + ';');
  context.applyRememberedOverridesToExtractedData();
  const state = context.captureWorkspaceDraft();
  context.restoreWorkspaceDraft(state);
  const html = context.buildOverrideControls('feat', 0);
  assert.match(html, /Review saved correction/);
  assert.match(html, /&lt;script&gt;saved correction/);
  assert.doesNotMatch(html, /<script>saved correction/);
  assert.ok(context.validateAll({ includeXml: false }).some(issue => /Saved correction/.test(issue.msg)));
  context.forgetOverride('feat-0');
  assert.ok(!context.validateAll({ includeXml: false }).some(issue => /Saved correction/.test(issue.msg)));
  assert.equal(runInApp(context, 'extractedData.feat[0].benefits[0]'), 'New source benefit.');
});
