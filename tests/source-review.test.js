const assert = require('node:assert/strict');
const review = require('../src/source-review');
const draft = require('../src/draft-storage');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');

function spell(overrides = {}) {
  return { name: 'Copper Flash', school: 'Evocation', level: 1, castingTime: '1 action', range: '30 feet', duration: 'Instantaneous',
    description: 'A copper spark illuminates the room.', classes: ['Wizard'], ...overrides };
}

test('source references prefer a spell definition, tolerate split heading glyphs, and stay on their page', () => {
  const data = { spell: [spell()], magic: [{ name: 'Bell of Copper' }] };
  review.attachSourceReferences(data, { kind: 'pdf', fileName: 'synthetic.pdf', pages: [
    { page: 1, text: 'Copper Flash\nOther spell list entry' },
    { page: 3, text: 'COPPER FLASH\n1st-level evocation\nCasting Time: 1 action\nSource rules.' },
    { page: 4, text: 'Be LL of Copper\nWondrous item, rare\nA copper bell rings.' }
  ] });
  assert.equal(data.spell[0]._source.page, 3);
  assert.equal(data.magic[0]._source.page, 4);
  assert.equal(data.spell[0]._source.fileName, 'synthetic.pdf');
  assert.doesNotMatch(data.spell[0]._source.excerpt, /bell rings/);
});

test('class references identify the intro, individual features, and missing progression entries', () => {
  const data = { class: [{ name: 'Wayfinder', features: [{ name: 'Spellcasting', level: 1, description: 'Copper spells.' }],
    progression: [{ level: 1, features: ['Spellcasting'] }, { level: 4, features: ['Ability Score Improvement'] }] },
  { name: 'Mistkeeper', features: [{ name: 'Spellcasting', level: 2, description: 'Silver spells.' }] }] };
  review.attachSourceReferences(data, { pages: [
    { page: 2, text: 'The Wayfinder\n| Level | PB | Features |\n| 4th | +2 | Ability Score Improvement |\nClass Features\nAs a wayfinder, you gain the following class features.\nHit Dice: 1d8\nSpellcasting\nCopper spells.' },
    { page: 3, text: 'Class Features\nAs a mistkeeper, you gain the following class features.\nHit Dice: 1d8\nSpellcasting\nSilver spells.' }
  ] });
  assert.match(data.class[0]._source.excerpt, /^Class Features/);
  assert.equal(data.class[0].features[0]._source.page, 2);
  assert.equal(data.class[1].features[0]._source.page, 3);
  assert.equal(data.class[0]._source.progression.find(ref => ref.name === 'Ability Score Improvement').match, 'table');
});

test('continuation references are disclosed without importing extra entities or inventing a source location', () => {
  const data = { spell: [spell({ statBlockName: 'Copper Wisp' }), spell({ name: 'Unlocated Spark' })] };
  review.attachSourceReferences(data, { pages: [{ page: 5, text: 'Copper Flash\n1st-level evocation\nCasting Time: 1 action' }],
    continuationPages: [{ page: 6, text: 'Copper Wisp\nArmor Class 12\nOther Spell\n1st-level evocation' }] });
  assert.equal(data.spell.length, 2);
  assert.equal(data.spell[0]._source.related[0].page, 6);
  assert.equal(data.spell[0]._source.related[0].continuation, true);
  assert.equal(data.spell[1]._source.match, 'unmatched');
  assert.equal(data.spell[1]._source.page, null);
});

test('pasted text has line references and source content is escaped in the review screen', () => {
  const { context } = loadApp();
  const [item] = context.parseManualTextForType('spell', 'Copper Flash\n1st-level evocation\nCasting Time: 1 action\nRange: 30 feet\nComponents: V\nDuration: Instantaneous\nA copper spark appears.');
  assert.equal(item._source.kind, 'pasted');
  assert.equal(item._source.page, null);
  assert.equal(item._source.line, 1);
  item._source.excerpt = '<img src=x onerror="alert(1)">';
  const html = context.buildSourceReference(item);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});

test('the unresolved list includes every finding and clears fixed fields without rebuilding their editor', () => {
  const { context, elements } = loadApp();
  runInApp(context, `extractedData = { spell: ${JSON.stringify(Array.from({ length: 10 }, (_, i) => spell({ name: 'Copper Spark ' + i, classes: [] })))} };`);
  context.buildReviewUI();
  assert.equal((elements.reviewIssuesList.innerHTML.match(/no spell lists assigned/g) || []).length, 10);
  const editor = elements.reviewPanels.innerHTML;
  context.updateFieldArr({ dataset: { id: 'spell-0', field: 'classes' }, value: 'Wizard', classList: { add() {}, remove() {} } });
  context.refreshReviewIssues();
  assert.equal((elements.reviewIssuesList.innerHTML.match(/no spell lists assigned/g) || []).length, 9);
  assert.equal(elements.reviewPanels.innerHTML, editor);
});

test('warning navigation reveals a searched-out card and focuses the precise field', () => {
  const { context, elements } = loadApp();
  runInApp(context, `extractedData = { spell: [${JSON.stringify(spell({ classes: [] }))}] };`);
  context.refreshReviewIssues();
  let switched;
  let focused = false;
  let cleared;
  context.switchTab = type => { switched = type; };
  context.filterPanel = (type, query) => { cleared = query; };
  const search = { value: 'hidden result' };
  elements['panel-spell'] = { querySelector: () => search };
  elements['body-spell-0'] = { classList: { add() {} }, querySelector: selector => selector === '[data-field="classes"]'
    ? { focus() { focused = true; }, scrollIntoView() {} } : null };
  const index = context.validateAll({ includeXml: false }).findIndex(issue => issue.field === 'classes');
  context.goToReviewIssue(index);
  assert.equal(switched, 'spell');
  assert.equal(search.value, '');
  assert.equal(cleared, '');
  assert.equal(focused, true);
});

test('a missing class feature is seeded from its table, and remains unresolved until its description is supplied', () => {
  const { context, elements } = loadApp();
  const cls = { name: 'Wayfinder', hitDie: 8, savingThrows: ['Wisdom'], features: [], progression: [{ level: 4, features: ['Copper Lore'] }],
    _source: { kind: 'pdf', page: 2, progression: [{ name: 'Copper Lore', kind: 'pdf', page: 2, line: 4, match: 'table', excerpt: '| 4th | +2 | Copper Lore |' }] } };
  runInApp(context, `extractedData = { class: [${JSON.stringify(cls)}] };`);
  const index = context.validateAll({ includeXml: false }).findIndex(issue => issue.action === 'add-feature');
  context.refreshReviewIssues(); context.goToReviewIssue(index);
  let item = context.window.AuroraXMLHelper.captureWorkspaceDraft().data.class[0];
  assert.equal(item.features[0].name, 'Copper Lore');
  assert.equal(item.features[0].level, 4);
  assert.equal(item.features[0].description, '');
  assert.equal(item.features[0]._source.page, 2);
  assert.ok(context.validateAll({ includeXml: false }).some(issue => issue.field === 'features.0.description'));
  context.updateNestedField({ dataset: { id: 'class-0', field: 'features.0.description' }, value: 'The intended rule has been supplied from the source.', classList: { add() {}, remove() {} } });
  context.refreshReviewIssues();
  assert.doesNotMatch(elements.reviewIssuesList.innerHTML, /needs its description|progression table features need descriptions/);
});

test('skipped records retain their source and can be restored instead of being lost', () => {
  const { context } = loadApp();
  runInApp(context, `extractedData = { class: [{ name: 'Incomplete Class', features: [], _source: { kind: 'pdf', page: 7, match: 'heading', excerpt: 'Original class text' } }] }; skippedItems = filterIncomplete(); captureGeneratedBaseline();`);
  context.refreshReviewIssues();
  const index = context.validateAll({ includeXml: false }).findIndex(issue => issue.action === 'restore');
  assert.ok(index >= 0);
  context.goToReviewIssue(index);
  const state = context.window.AuroraXMLHelper.captureWorkspaceDraft();
  assert.equal(state.skipped.length, 0);
  assert.equal(state.data.class[0]._source.page, 7);
  assert.equal(state.baseline.class[0]._source.excerpt, 'Original class text');
  assert.ok(context.validateAll({ includeXml: false }).some(issue => issue.field === 'hitDie'));
});

test('remembered corrections keep current source locations and do not reuse an old source check', () => {
  const current = spell({ _source: { kind: 'pdf', page: 9, match: 'unmatched' } });
  const previous = spell({ description: 'Corrected text', _source: { kind: 'pdf', page: 3, checked: true } });
  const corrected = review.applyContentCorrection(current, previous);
  assert.equal(corrected.description, 'Corrected text');
  assert.equal(corrected._source.page, 9);
  assert.equal(corrected._source.checked, undefined);
  assert.ok(review.findings({ spell: [corrected] }).some(issue => issue.action === 'check-source'));
  assert.equal(review.withoutReferences(corrected)._source, undefined);
});

test('checking an unlocated source does not hide other gaps or invent a PDF page', () => {
  const { context, elements } = loadApp();
  runInApp(context, `extractedData = { spell: [${JSON.stringify(spell({ classes: [], _source: { kind: 'pdf', match: 'unmatched', page: null, excerpt: '' } }))}] };`);
  context.markSourceChecked('spell', 0);
  const item = context.window.AuroraXMLHelper.captureWorkspaceDraft().data.spell[0];
  assert.equal(item._source.checked, true);
  assert.equal(item._source.page, null);
  assert.doesNotMatch(elements.reviewIssuesList.innerHTML, /heading was not located/);
  assert.match(elements.reviewIssuesList.innerHTML, /no spell lists assigned/);
  context.refreshReviewIssues(context.validateAll({ includeXml: false }));
  assert.equal(elements.reviewIssuesSummary.textContent, '1 item needs attention.');
});

test('source metadata rejects a wrapped by-phrase while retaining explicit author credits and user edits', () => {
  const { context, elements } = loadApp();
  elements.sourceAuthor.value = '';
  context.detectSourceMetaFromText([{ page: 4, text: 'Creating a Witch\nby spirits, or is your mind plagued by destructive\nBy 11th level, you have perfected your magic.' }]);
  assert.equal(elements.sourceAuthor.value, '');
  context.detectSourceMetaFromText([{ page: 1, text: 'Copper Compendium\nBy Jane Doe and Mage Hand Press' }]);
  assert.equal(elements.sourceAuthor.value, 'Jane Doe and Mage Hand Press');
  elements.sourceAuthor.value = 'User-supplied credit';
  context.detectSourceMetaFromText([{ page: 1, text: 'By Someone Else' }]);
  assert.equal(elements.sourceAuthor.value, 'User-supplied credit');
});

test('references and unresolved scope survive recovery, while old drafts remain compatible', () => {
  const { context } = loadApp();
  runInApp(context, `extractedData = { spell: [${JSON.stringify(spell({ classes: [], _source: { kind: 'pdf', fileName: 'synthetic.pdf', page: 3, match: 'heading', excerpt: 'Original source text' } }))}] };
    sourceReviewContext = { kind: 'pdf', fileName: 'synthetic.pdf', types: ['spell'], selectedPages: [3], continuationPages: [4] }; captureGeneratedBaseline();`);
  const state = draft.decode(draft.encode(context.window.AuroraXMLHelper.captureWorkspaceDraft())).state;
  const other = loadApp(); other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(state);
  assert.match(other.elements.reviewIssuesList.innerHTML, /no spell lists assigned/);
  assert.match(other.elements.reviewSourceScope.textContent, /continuation context: 4/);
  assert.equal(other.context.window.AuroraXMLHelper.captureWorkspaceDraft().data.spell[0]._source.page, 3);
  delete state.reviewContext;
  other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(state);
  assert.equal(other.context.window.AuroraXMLHelper.captureWorkspaceDraft().reviewContext, null);
  state.reviewContext = { types: 'invalid' };
  assert.throws(() => draft.validateState(state), /invalid source review/);
});

test('empty selected sections are explicit review items, and XML remains unchanged by source metadata', () => {
  const { context, elements } = loadApp();
  runInApp(context, `extractedData = { spell: [${JSON.stringify(spell())}] }; sourceReviewContext = { kind: 'pdf', fileName: 'synthetic.pdf', types: ['spell', 'class'], selectedPages: [3], continuationPages: [] };`);
  context.refreshReviewIssues();
  assert.match(elements.reviewIssuesList.innerHTML, /No Classes were found/);
  const before = context.generateXml();
  runInApp(context, `AuroraSourceReview.attachSourceReferences(extractedData, { pages: [{ page: 3, text: 'Copper Flash\\n1st-level evocation\\nCasting Time: 1 action' }] });`);
  assert.equal(context.generateXml(), before);
});
