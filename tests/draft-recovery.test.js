const assert = require('node:assert/strict');
const draft = require('../src/draft-storage');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');

function workspace() {
  const { context } = loadApp();
  return context.window.AuroraXMLHelper.captureWorkspaceDraft();
}

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('recovery preserves edited results, parser baselines, authoring XML, source flags, and repair undo', () => {
  const { context, elements } = loadApp();
  runInApp(context, `
    extractedData = { feat: [{ name: 'Edited feat', description: 'Current text', benefits: ['Increase your Strength score by 1.'] }] };
    generatedBaselineData = { feat: [{ name: 'Generated feat', description: 'Original text', benefits: [] }] };
    skippedItems = [{ type: 'spell', item: { name: 'Incomplete spell' } }];
    discoveredPageRanges = { feat: [4, 5] };
    selectedAuthoringTemplateId = 'feat-2021';
    selectedAuthoringTemplateOriginalXml = '<elements />';
  `);
  elements.sourceAbbr.dataset.userEdited = '1';
  elements.sourceYear.value = '2024';
  elements.sourceYear.dataset.rulesetEvidence = 'Synthetic 2024 source';
  elements.authoringTemplateXml.value = '<elements><!-- unsaved work --></elements>';
  const original = '<elements><info><n>Recovery</n></info></elements>';
  context.loadRepairDocs([{ fileName: 'original.xml', xml: original }, { fileName: 'other.xml', xml: '<elements />' }]);
  context.inspectRepairXml();
  const api = context.window.AuroraXMLHelper;
  const repair = api.repairState.analysis.diagnostics.find(finding => finding.category === 'info-uses-n-tag').repairs[0];
  api.applyRepairSelection([repair.id]);
  context.switchWorkspaceView('repair');
  context.markChanged();
  const encoded = draft.encode(api.captureWorkspaceDraft());
  assert.ok(!encoded.includes('gemini_api_key'));
  const other = loadApp();
  other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(draft.decode(encoded).state);
  const recovered = other.context.window.AuroraXMLHelper.captureWorkspaceDraft();
  assert.equal(recovered.data.feat[0].name, 'Edited feat');
  assert.equal(recovered.baseline.feat[0].name, 'Generated feat');
  assert.equal(recovered.sourceFlags.abbrEdited, '1');
  assert.equal(recovered.sourceFlags.rulesetEvidence, 'Synthetic 2024 source');
  assert.equal(recovered.fields.sourceYear, '2024');
  assert.equal(recovered.author.xml, elements.authoringTemplateXml.value);
  assert.equal(recovered.workspace, 'repair');
  assert.equal(recovered.changed, true);
  assert.equal(recovered.repair.originalDocs[0].xml, original);
  assert.equal(recovered.repair.inspected, true);
  other.context.undoLastRepair();
  assert.equal(other.context.window.AuroraXMLHelper.repairState.docs[0].xml, original);
});

test('uninspected XML edits survive without reusing stale repair offsets', () => {
  const { context, elements } = loadApp();
  context.loadRepairDocs([{ fileName: 'edit.xml', xml: '<elements />' }]);
  context.inspectRepairXml();
  elements.repairXmlInput.value = '<elements><!-- newer text --></elements>';
  const state = context.window.AuroraXMLHelper.captureWorkspaceDraft();
  assert.equal(state.repair.inspected, false);
  const other = loadApp();
  other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(draft.decode(draft.encode(state)).state);
  assert.equal(other.elements.repairXmlInput.value, elements.repairXmlInput.value);
  assert.equal(other.context.window.AuroraXMLHelper.repairState.analysis, null);
});

test('malformed, unsupported, and incomplete drafts are rejected without removing the saved copy', () => {
  const storage = memoryStorage();
  for (const raw of ['{broken', JSON.stringify({ format: draft.FORMAT, version: 2 }), JSON.stringify({ format: draft.FORMAT, version: 1, savedAt: new Date().toISOString(), state: {} })]) {
    storage.setItem(draft.KEY, raw);
    assert.throws(() => draft.createStore(storage).load(), /draft/i);
    assert.equal(storage.getItem(draft.KEY), raw);
  }
});

test('failed or oversized saves leave the last successful draft untouched', () => {
  const storage = memoryStorage();
  const store = draft.createStore(storage);
  store.load();
  store.save(workspace());
  const saved = storage.getItem(draft.KEY);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const state = workspace();
  state.author.xml = 'Latest edit';
  assert.throws(() => store.save(state), /previous saved copy is unchanged/);
  assert.equal(storage.getItem(draft.KEY), saved);
  state.author.xml = 'x'.repeat(draft.MAX_LENGTH);
  assert.throws(() => store.save(state), /too large/);
  assert.equal(storage.getItem(draft.KEY), saved);
  const exported = draft.encode(state, undefined, draft.MAX_FILE_LENGTH);
  assert.equal(draft.decode(exported, draft.MAX_FILE_LENGTH).state.author.xml, state.author.xml);
});

test('another tab cannot overwrite or resurrect a saved draft without an explicit choice', () => {
  const storage = memoryStorage();
  const first = draft.createStore(storage);
  const second = draft.createStore(storage);
  first.load(); second.load();
  first.save(workspace());
  assert.throws(() => second.save(workspace()), /Another tab/);
  const otherState = workspace();
  otherState.author.xml = '<!-- Different work in the second tab -->';
  second.save(otherState, { overwrite: true });
  assert.throws(() => first.save(workspace()), /Another tab/);
  first.load();
  second.clear();
  assert.throws(() => first.save(workspace()), /Another tab/);
});

test('unavailable browser storage produces a recoverable error', () => {
  const store = draft.createStore({ getItem() { throw new Error('SecurityError'); } });
  assert.throws(() => store.load(), /unavailable/);
});

test('malformed nested entries and skipped records are rejected before restoration mutates the workspace', () => {
  const cases = [
    value => { value.data.spell = [{ name: 'Spell', classes: 'Wizard' }]; },
    value => { value.data.class = [{ name: 'Class', features: 'Feature' }]; },
    value => { value.data.class = [{ name: 'Class', skillChoices: { from: 'Arcana' } }]; },
    value => { value.data.class = [{ name: 'Class', choices: [{ name: 'Choice', feature: 'Feature', mode: 'options', options: [], levels: '1, 4' }] }]; },
    value => { value.baseline.background = [{ name: 'Background', abilityScores: {} }]; },
    value => { value.data.race = [{ name: 'Race', traits: [null] }]; },
    value => { value.data.class = [{ name: 'Class', _source: { progression: {} } }]; },
    value => { value.data.spell = [{ name: 'Spell', _source: { related: [null] } }]; },
    value => { value.data.feat = [{ name: 42, benefits: ['Benefit'] }]; },
    value => { value.skipped = [null]; },
    value => { value.skipped = [{ type: 'spell', item: { name: 'Spell', classes: {} } }]; }
  ];
  for (const mutate of cases) {
    const value = workspace();
    mutate(value);
    assert.throws(() => draft.encode(value), /invalid/i);
  }
  const incomplete = workspace();
  incomplete.data.class = [{ name: '', features: [], skillChoices: { from: [] } }];
  incomplete.data.spell = [{ name: '', level: '', classes: [] }];
  assert.doesNotThrow(() => draft.encode(incomplete), 'Ordinary incomplete entries must stay recoverable.');
});

test('remembered records can use the same complete shape check as workspace drafts', () => {
  assert.equal(draft.validElementRecord('feat', { name: 'Edited Feat', benefits: ['Benefit'] }), true);
  assert.equal(draft.validElementRecord('spell', { name: 'Spell', classes: [] }), true);
  assert.equal(draft.validElementRecord('spell', { name: 'Spell', availability: {} }), false);
  assert.equal(draft.validElementRecord('class', { name: 'Class', choices: 'wrong shape' }), false);
  assert.equal(draft.validElementRecord('class', { name: 'Class', features: [{ name: 'Feature', description: 'Rules.' }] }), true);
  assert.equal(draft.validElementRecord('arbitrary', { name: 'Unknown' }), false);
});
