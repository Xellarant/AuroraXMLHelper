const assert = require('node:assert/strict');
const { loadApp, runInApp, createStubElement } = require('../scripts/app-vm-harness');

const feat = (name = 'Copper Gift') => ({ name, description: 'Original effect.', prerequisite: '', benefits: ['You enjoy copper.'] });
function workspace(data = { feat: [feat()] }) {
  const app = loadApp({ name: 'Export Fixture', abbr: 'EXP' });
  runInApp(app.context, 'extractedData = ' + JSON.stringify(data) + '; ensureExtractedDataBuckets(); captureGeneratedBaseline();');
  app.context.validateAll = () => [];
  app.context.Blob = Blob;
  const downloads = [];
  app.context.downloadBlobFile = (fileName, blob) => downloads.push({ fileName, blob });
  return { ...app, downloads };
}
function zipMock(context, generate) {
  const files = new Map();
  const calls = [];
  context.JSZip = class {
    folder(name) { calls.push(name); return { file(fileName, text) { files.set(fileName, text); } }; }
    generateAsync(options) { return generate(options); }
  };
  return { files, calls };
}
function issue() {
  return { type: 'feat', i: 0, field: 'benefits.0', msg: 'Synthetic issue -- check <source> & details.',
    source: { kind: 'pdf', fileName: 'synthetic.pdf', page: 7, line: 12, excerpt: 'Original synthetic source.' } };
}

test('preview shows the latest XML without acknowledging pending edits', () => {
  const { context, elements } = workspace();
  const visible = new Set(['hidden']);
  elements.xmlPreviewWrap = createStubElement();
  elements.xmlPreviewWrap.classList = {
    toggle(name) { if (visible.has(name)) visible.delete(name); else visible.add(name); },
    contains(name) { return visible.has(name); }
  };
  context.markChanged();
  const revision = runInApp(context, 'editRevision');
  context.showXmlPreview();
  assert.match(elements.xmlPreview.textContent, /Copper Gift/);
  assert.equal(runInApp(context, 'hasUnsavedChanges'), true);
  assert.equal(runInApp(context, 'editRevision'), revision);
  assert.equal(visible.has('hidden'), false);
});

test('empty single and ZIP exports are refused before creating a download', async () => {
  const { context, elements, downloads } = workspace({});
  let zipCreated = false;
  context.JSZip = class { constructor() { zipCreated = true; } };
  assert.equal(await context.generateAndDownload(), false);
  assert.equal(await context.downloadZip(), false);
  assert.equal(downloads.length, 0);
  assert.equal(zipCreated, false);
  assert.match(elements.manualAuthorStatus.textContent, /Add or restore an entry/);
});

test('ZIP snapshots retain pending edits made during compression and prevent duplicate concurrent exports', async () => {
  const { context, elements, downloads } = workspace();
  let finish;
  const { files } = zipMock(context, () => new Promise(resolve => { finish = resolve; }));
  context.markChanged();
  const pending = context.downloadZip();
  assert.equal(typeof finish, 'function');
  assert.equal(await context.downloadZip(), false);
  const field = createStubElement('Effect edited during compression.');
  field.dataset = { id: 'feat-0', field: 'description' };
  context.updateField(field);
  finish(new Blob(['ZIP bytes']));
  assert.equal(await pending, true);
  assert.equal(downloads.length, 1);
  assert.match(files.get('exp-feats.xml'), /Original effect/);
  assert.doesNotMatch(files.get('exp-feats.xml'), /Effect edited during compression/);
  assert.equal(runInApp(context, 'extractedData.feat[0].description'), 'Effect edited during compression.');
  assert.equal(runInApp(context, 'hasUnsavedChanges'), true);
  assert.match(elements.manualAuthorStatus.textContent, /Edits made during export are still pending/);
  assert.equal(runInApp(context, 'zipDownloadBusy'), false);
});

test('ZIP failure keeps edited data and pending state and allows a later successful retry', async () => {
  const { context, elements, downloads } = workspace();
  context.markChanged();
  const before = runInApp(context, 'JSON.stringify(extractedData)');
  zipMock(context, async () => { throw new Error('Compression failed'); });
  assert.equal(await context.downloadZip(), false);
  assert.equal(runInApp(context, 'JSON.stringify(extractedData)'), before);
  assert.equal(runInApp(context, 'hasUnsavedChanges'), true);
  assert.equal(runInApp(context, 'zipDownloadBusy'), false);
  assert.equal(downloads.length, 0);
  assert.match(elements.manualAuthorStatus.textContent, /Your work is kept.*ZIP file could not be created.*Single XML/);
  zipMock(context, async () => new Blob(['Retry ZIP']));
  assert.equal(await context.downloadZip(), true);
  assert.equal(downloads.length, 1);
  assert.equal(runInApp(context, 'hasUnsavedChanges'), false);
});

test('confirmed exports carry unresolved review notes in both ZIP and single XML without invalid comment syntax', async () => {
  const zip = workspace();
  zip.context.validateAll = () => [issue()];
  const { files } = zipMock(zip.context, async () => new Blob(['ZIP']));
  assert.equal(await zip.context.downloadZip(), true);
  assert.match(files.get('unresolved-items.txt'), /Synthetic issue -- check <source> & details/);
  assert.match(files.get('unresolved-items.txt'), /synthetic.pdf, PDF page 7, line 12/);
  assert.ok(files.has('exp-feats.xml') && files.has('source.xml'));
  const single = workspace();
  single.context.validateAll = () => [issue()];
  assert.equal(await single.context.generateAndDownload(), true);
  const xml = await single.downloads[0].blob.text();
  assert.match(xml, /^<\?xml.*\n<!-- Unresolved items/);
  const comment = xml.match(/<!-- ([\s\S]*?) -->/)[1];
  assert.match(comment, /Synthetic issue/);
  assert.ok(!comment.includes('--'));
  assert.ok(xml.endsWith('</elements>'));
});

test('cancelling an unresolved export preserves the workspace and does not download', async () => {
  const { context, downloads } = workspace();
  context.validateAll = () => [issue()];
  context.confirm = () => false;
  context.markChanged();
  assert.equal(await context.generateAndDownload(), false);
  assert.equal(await context.downloadZip(), false);
  assert.equal(downloads.length, 0);
  assert.equal(runInApp(context, 'hasUnsavedChanges'), true);
});

test('copying several repaired documents refuses to concatenate them into invalid XML', async () => {
  const { context, elements } = workspace();
  let copied = null;
  context.navigator = { clipboard: { writeText: async value => { copied = value; } } };
  runInApp(context, 'repairState.originalDocs = [{fileName:"one.xml",xml:"old"},{fileName:"two.xml",xml:"old"}];'
    + 'repairState.docs = [{fileName:"one.xml",xml:"<elements />"},{fileName:"two.xml",xml:"<index />"}];');
  assert.equal(await context.copyRepairedXml(), false);
  assert.equal(copied, null);
  assert.match(elements.repairPreviewStatus.textContent, /separate documents.*ZIP/);
});

test('element removal and undo restore the original position and its paired parser baseline', async () => {
  const { context } = workspace({ feat: [feat('First'), feat('Second')] });
  runInApp(context, 'extractedData.feat[0].description = "Edited effect";');
  const before = runInApp(context, 'JSON.stringify({data:extractedData,baseline:generatedBaselineData})');
  assert.equal(await context.removeElement('feat-0'), true);
  assert.equal(runInApp(context, 'extractedData.feat[0].name'), 'Second');
  assert.equal(runInApp(context, 'generatedBaselineData.feat[0].name'), 'Second');
  assert.equal(context.undoLastRemoval(), true);
  assert.equal(runInApp(context, 'JSON.stringify({data:extractedData,baseline:generatedBaselineData})'), before);
});

test('nested removal and undo work for features, traits, benefits, choices, and choice options', () => {
  const cls = { name: 'Mistkeeper', hitDie: 8, features: [{ name: 'Mist Sight', level: 1, description: 'You see mist.' }],
    choices: [{ name: 'Mist Form', feature: 'Mist Sight', mode: 'options', levels: [1], options: [{ name: 'Copper', description: 'Copper mist.' }] }] };
  const { context } = workspace({ class: [cls], race: [{ name: 'Mist Folk', traits: [{ name: 'Bright Eyes', description: 'Bright eyes.' }] }], feat: [feat()] });
  for (const [id, field] of [['class-0', 'features'], ['race-0', 'traits'], ['feat-0', 'benefits'], ['class-0', 'choices.0.options'], ['class-0', 'choices']]) {
    const before = runInApp(context, 'JSON.stringify(extractedData)');
    const baseline = runInApp(context, 'JSON.stringify(generatedBaselineData)');
    assert.equal(context.removeNestedEntry(id, field, 0), true, field);
    assert.equal(context.undoLastRemoval(), true, field);
    assert.equal(runInApp(context, 'JSON.stringify(extractedData)'), before, field);
    assert.equal(runInApp(context, 'JSON.stringify(generatedBaselineData)'), baseline, field);
  }
});

test('cancelled deletion leaves data intact and undo cannot leak removed data into another workspace', async () => {
  const { context } = workspace();
  const before = runInApp(context, 'JSON.stringify(extractedData)');
  context.confirm = () => false;
  assert.equal(await context.removeElement('feat-0'), false);
  assert.equal(runInApp(context, 'JSON.stringify(extractedData)'), before);
  context.confirm = () => true;
  assert.equal(await context.removeElement('feat-0'), true);
  runInApp(context, 'extractedData = {feat: []};');
  assert.equal(context.undoLastRemoval(), false);
  assert.equal(runInApp(context, 'extractedData.feat.length'), 0);
});

test('malformed remembered corrections are ignored before load or application', () => {
  const { context } = workspace();
  const key = context.overrideKeyForIndex('feat', 0);
  const storageKey = runInApp(context, 'OVERRIDE_STORAGE_KEY');
  context.localStorage.setItem(storageKey, JSON.stringify({
    [key]: { type: 'feat', item: { name: 'Malformed', benefits: { unsafe: 'Not an array' } } },
    valid: { type: 'feat', item: feat('Valid') }
  }));
  assert.deepEqual(Object.keys(context.loadRememberedOverrides()), ['valid']);
  runInApp(context, 'rememberedOverrides = ' + JSON.stringify({ [key]: { type: 'feat', item: { name: 'Malformed', benefits: 'Not an array' } } }) + ';');
  assert.equal(context.applyRememberedOverrideAt('feat', 0), false);
  assert.equal(runInApp(context, 'extractedData.feat[0].name'), 'Copper Gift');
});

test('failed correction save or forget preserves prior saved state and never reports success', () => {
  const { context, elements } = workspace();
  runInApp(context, 'extractedData.feat[0].description = "First correction";');
  context.rememberOverride('feat-0');
  const key = context.overrideKeyForIndex('feat', 0);
  const storageKey = runInApp(context, 'OVERRIDE_STORAGE_KEY');
  const saved = context.localStorage.getItem(storageKey);
  runInApp(context, 'extractedData.feat[0].description = "Second unsaved correction";');
  const setter = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error('Storage is full'); };
  assert.equal(context.rememberOverride('feat-0'), false);
  assert.equal(runInApp(context, 'rememberedOverrides[' + JSON.stringify(key) + '].item.description'), 'First correction');
  assert.equal(context.localStorage.getItem(storageKey), saved);
  assert.match(elements.manualAuthorStatus.textContent, /could not save the correction/);
  assert.doesNotMatch(elements.manualAuthorStatus.textContent, /Remembered correction/);
  assert.equal(context.forgetOverride('feat-0'), false);
  assert.equal(context.localStorage.getItem(storageKey), saved);
  assert.equal(runInApp(context, 'rememberedOverrides[' + JSON.stringify(key) + '].item.description'), 'First correction');
  assert.doesNotMatch(elements.manualAuthorStatus.textContent, /Forgot saved/);
  assert.equal(runInApp(context, 'extractedData.feat[0].description'), 'Second unsaved correction');
  context.localStorage.setItem = setter;
});

test('source metadata input handlers mark changes and retain a manually edited abbreviation', () => {
  let ready;
  const { context, elements } = loadApp({}, { onWindowEvent(type, callback) { if (type === 'DOMContentLoaded') ready = callback; } });
  const listeners = {};
  for (const id of ['sourceName', 'sourceAbbr', 'sourceAuthor', 'sourceYear']) elements[id].addEventListener = (type, callback) => { if (type === 'input') listeners[id] = callback; };
  ready();
  for (const id of ['sourceName', 'sourceAbbr', 'sourceAuthor', 'sourceYear']) {
    context.clearChanged();
    assert.equal(typeof listeners[id], 'function', id);
    elements[id].value = id === 'sourceYear' ? '2024' : 'Edited ' + id;
    listeners[id]();
    assert.equal(runInApp(context, 'hasUnsavedChanges'), true, id);
  }
  assert.equal(elements.sourceAbbr.dataset.userEdited, '1');
  assert.equal(context.getSourceMeta().ruleset, '2024');
});

function sourceSpell(overrides = {}) {
  return { name: 'Copper Signal', level: 1, school: 'Illusion', castingTime: '1 action', range: '30 feet',
    duration: '1 minute', classes: ['Wizard'], hasVerbal: true, hasSomatic: true, hasMaterial: false,
    description: 'Earlier source prose.', higherLevels: '', ...overrides };
}

function correctionWorkspace(spell, storage = {}) {
  const app = loadApp({ name: 'Remembered Source', abbr: 'REM', year: '2016' }, { storage });
  runInApp(app.context, 'extractedData = ' + JSON.stringify({ spell: [spell] }) + '; ensureExtractedDataBuckets(); captureGeneratedBaseline();');
  return { ...app, storage };
}

test('a remembered field correction survives reload without replacing new source prose, spell lists, or references', () => {
  const storage = {};
  const first = correctionWorkspace(sourceSpell({ _source: { kind: 'pdf', fileName: 'old.pdf', page: 2, excerpt: 'Old source.' } }), storage);
  runInApp(first.context, 'extractedData.spell[0].range = "60 feet";');
  first.context.rememberOverride('spell-0');
  const key = first.context.overrideKeyForIndex('spell', 0);
  const storageKey = runInApp(first.context, 'OVERRIDE_STORAGE_KEY');
  const saved = JSON.parse(storage[storageKey])[key];
  assert.deepEqual(saved.fields, ['range']);
  assert.equal(saved.item.description, 'Earlier source prose.', 'The stored full snapshot must not broaden which fields are applied.');
  assert.equal(saved.item._source, undefined);

  const current = sourceSpell({ level: 2, range: '90 feet', classes: ['Artificer', 'Wizard'], description: 'Newly recovered complete source prose.',
    _source: { kind: 'pdf', fileName: 'new.pdf', page: 9, line: 12, excerpt: 'New source location.' } });
  const second = correctionWorkspace(current, storage);
  assert.equal(second.context.hasRememberedOverride('spell', 0), true, 'Initialization must load corrections supplied through persistent storage.');
  assert.equal(second.context.applyRememberedOverridesToExtractedData(), 1);
  const applied = JSON.parse(runInApp(second.context, 'JSON.stringify(extractedData.spell[0])'));
  assert.equal(applied.range, '60 feet');
  assert.equal(applied.level, 2);
  assert.equal(applied.description, current.description);
  assert.deepEqual(applied.classes, current.classes);
  assert.deepEqual(applied._source, current._source);
  assert.equal(applied._legacyRememberedCorrection, undefined);
  assert.equal(runInApp(second.context, 'generatedBaselineData.spell[0].range'), '90 feet');
});

test('an older full-entry correction retains its source location and raises a manual review warning', () => {
  const storage = {};
  const fixture = correctionWorkspace(sourceSpell(), storage);
  const key = fixture.context.overrideKeyForIndex('spell', 0);
  const storageKey = runInApp(fixture.context, 'OVERRIDE_STORAGE_KEY');
  storage[storageKey] = JSON.stringify({ [key]: { type: 'spell', item: sourceSpell({ description: 'Legacy replacement text.', range: '60 feet' }) } });
  const current = sourceSpell({ description: 'Current source prose.', _source: { kind: 'pdf', fileName: 'current.pdf', page: 5, line: 2, excerpt: 'Current source.' } });
  const restored = correctionWorkspace(current, storage);
  assert.equal(restored.context.applyRememberedOverridesToExtractedData(), 1);
  assert.equal(runInApp(restored.context, 'extractedData.spell[0].description'), 'Legacy replacement text.');
  assert.equal(runInApp(restored.context, 'extractedData.spell[0]._source.page'), 5);
  const warning = restored.context.validateAll({ includeXml: false }).find(issue => /older remembered correction replaced the full entry/.test(issue.msg));
  assert.ok(warning);
  assert.equal(warning.category, 'source-review');
  assert.match(warning.msg, /Revert to Generated.*Remember Correction/);
});

test('malformed correction field masks are rejected at load and cannot throw during application', () => {
  const { context } = correctionWorkspace(sourceSpell());
  const key = context.overrideKeyForIndex('spell', 0);
  const storageKey = runInApp(context, 'OVERRIDE_STORAGE_KEY');
  for (const fields of [['range', null], ['range', 42], ['_source'], ['__proto__'], ['constructor'], 'range']) {
    context.localStorage.setItem(storageKey, JSON.stringify({ [key]: { type: 'spell', fields, item: sourceSpell({ range: '600 feet' }) } }));
    assert.deepEqual(Object.keys(context.loadRememberedOverrides()), [], JSON.stringify(fields));
    runInApp(context, 'rememberedOverrides = ' + JSON.stringify({ [key]: { type: 'spell', fields, item: sourceSpell({ range: '600 feet' }) } }) + ';');
    assert.doesNotThrow(() => assert.equal(context.applyRememberedOverrideAt('spell', 0), false));
    assert.equal(runInApp(context, 'extractedData.spell[0].range'), '30 feet');
  }
});

test('a newly added blank class is not marked edited by lazy choice initialization', () => {
  const { context } = loadApp();
  context.addManualElement('class');
  assert.equal(context.isEditedFromGenerated('class', 0), false);
  assert.equal(runInApp(context, 'extractedData.class[0].choices.length'), 0);
  assert.equal(runInApp(context, 'extractedData.class[0].progression.length'), 0);
});

test('a remembered nested feature edit warns when its whole collection replaces refreshed source data', () => {
  const storage = {};
  const meta = { name: 'Remembered Source', abbr: 'REM', year: '2016' };
  const first = loadApp(meta, { storage });
  const base = JSON.parse(JSON.stringify(first.context.createBlankElement('class')));
  const old = { ...base, name: 'Copper Adept', hitDie: 8,
    features: [{ name: 'Copper Sight', level: 1, description: 'Earlier source prose.', action: 'Action' }] };
  runInApp(first.context, 'extractedData = ' + JSON.stringify({ class: [old] }) + '; ensureExtractedDataBuckets(); captureGeneratedBaseline();'
    + 'extractedData.class[0].features[0].action = "Bonus Action";');
  first.context.rememberOverride('class-0');

  const refreshed = { ...old, features: [
    { name: 'Copper Sight', level: 1, description: 'Improved complete source prose.', action: 'Action' },
    { name: 'Copper Flight', level: 3, description: 'A newly recovered feature.' }
  ] };
  const second = loadApp(meta, { storage });
  runInApp(second.context, 'extractedData = ' + JSON.stringify({ class: [refreshed] }) + '; ensureExtractedDataBuckets(); captureGeneratedBaseline();');
  assert.equal(second.context.applyRememberedOverridesToExtractedData(), 1);
  assert.equal(runInApp(second.context, 'extractedData.class[0].features[0].action'), 'Bonus Action');
  const warning = second.context.validateAll({ includeXml: false }).find(issue => /remembered correction replaced the features collection/.test(issue.msg));
  assert.ok(warning);
  assert.equal(warning.category, 'source-review');
  second.context.revertToGenerated('class-0');
  assert.equal(runInApp(second.context, 'extractedData.class[0].features[0].description'), 'Improved complete source prose.');
  assert.equal(runInApp(second.context, 'extractedData.class[0].features.length'), 2);
  assert.ok(!second.context.validateAll({ includeXml: false }).some(issue => /remembered correction replaced the features collection/.test(issue.msg)));
});

test('XML scalar escaping keeps zero values and valid Unicode while removing forbidden characters', () => {
  const { context } = loadApp();
  assert.equal(context.escXml(0), '0');
  assert.equal(context.escAttrXml(0), '0');
  assert.equal(context.escXml(false), 'false');
  const value = 'Spirit \u{1F9DA} \uD800\u0000 & <light>';
  assert.equal(context.escXml(value), 'Spirit \u{1F9DA}  &amp; &lt;light&gt;');
  assert.equal(context.escAttrXml('Spirit \u{1F9DA} "light"'), 'Spirit \u{1F9DA} &quot;light&quot;');
  const generated = workspace({ feat: [feat('Spirit \u{1F9DA} Gift')] });
  const xml = generated.context.generateXml();
  assert.match(xml, /name="Spirit \u{1F9DA} Gift"/u);
});
