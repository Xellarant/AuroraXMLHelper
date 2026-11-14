const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const availability = require('../src/spell-availability');
const review = require('../src/source-review');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const { readSource, generateBenchmarkXml } = require('../scripts/benchmark-corpus');

const spell = (name = 'Copper Flash', overrides = {}) => ({ name, level: 1, school: 'Evocation', classes: [], castingTime: '1 action', range: '30 feet', duration: 'Instantaneous', description: 'A harmless copper light appears.', ...overrides });
const definition = (name = 'Copper Flash', body = 'A harmless copper light appears.', kind = '1st-level evocation') => [name, kind, 'Casting Time: 1 action', 'Range: 30 feet', 'Components: V, S', 'Duration: Instantaneous', body].join('\n');
const page = (number, text) => ({ page: number, text });
const sorted = values => [...values].sort();

test('separate class lists fill every membership without expanding the selected definitions', () => {
  const { context } = loadApp();
  const selected = [page(5, definition())];
  const all = [page(1, 'Druid Spells\n1st Level\nCopper flash (evocation)\nOutside Spark (evocation)\nRanger Spells\n1st Level\nCopper Flash (evocation)'), page(2, 'Wizard Spells\n1st Level\nCopper Flash (evocation)'), ...selected, page(6, definition('Outside Spark'))];
  const spells = context.parseSpellsFromText(selected[0].text, { pages: selected, availabilityPages: all, fileName: 'synthetic.pdf' });
  assert.equal(spells.length, 1);
  assert.deepEqual(sorted(spells[0].classes), ['Druid', 'Ranger', 'Wizard']);
  assert.deepEqual(availability.contextPages(spells), [1, 2]);
  assert.ok(spells[0].availability.base.every(entry => entry._source.fileName === 'synthetic.pdf' && entry._source.availabilityContext));
});

test('a class list continues across a page and stops at another class or spell definition', () => {
  const spells = [spell(), spell('Silver Spark'), spell('Outside Spark')];
  availability.resolve(spells, { pages: [page(4, definition())], availabilityPages: [
    page(1, 'Sorcerer Spells\nCantrips (0 Level)\nSilver Spark (evocation)'),
    page(2, '1st Level\nCopper Flash (evocation)\nWarlock Spells\n1st Level\nSilver Spark (evocation)'),
    page(3, definition('Unselected Spell') + '\nOutside Spark')
  ] });
  assert.deepEqual(spells[0].classes, ['Sorcerer']);
  assert.deepEqual(sorted(spells[1].classes), ['Sorcerer', 'Warlock']);
  assert.deepEqual(spells[2].classes, []);
});

test('custom class lists need explicit spell-list context and accept marked names', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, "Class: Witch\nThe chapter begins with the witch's spell list.\nWitch Spells\n1st Level\nCopper Flash*")] });
  assert.deepEqual(spells[0].classes, ['Witch']);
  const other = [spell()];
  availability.resolve(other, { pages: [page(1, 'Dragon Spells\n1st Level\nCopper Flash')] });
  assert.deepEqual(other[0].classes, []);
});

test('modern metadata keeps Artificer, Paladin, Ranger, and ritual separate', () => {
  const { context } = loadApp();
  const [item] = context.parseSpellsFromText(definition('Copper Flash', 'A light appears.', 'Level 1 Evocation (Artificer, Paladin, Ranger, Ritual)'));
  assert.deepEqual(sorted(item.classes), ['Artificer', 'Paladin', 'Ranger']);
  assert.equal(item.classes.includes('Ritual'), false);
});

test('class mentions and preceding spell metadata cannot assign another spell to that class', () => {
  const { context } = loadApp();
  const spells = context.parseSpellsFromText(definition('First Spark', "Spell Lists. Wizard\nConsult the Druid's spell list.") + '\n' + definition('Copper Flash', "A wizard can see this light. Compare the Cleric's spell list."));
  assert.deepEqual([...spells[0].classes], ['Wizard']);
  assert.deepEqual([...spells[1].classes], []);
});

test('catalogue evidence is explicit and conflicting complete lists stay unresolved', () => {
  const { context } = loadApp();
  const text = '| Spell | Classes |\n| --- | --- |\n| Copper Flash | Bard, Artificer |\n' + definition('Copper Flash', 'A light appears.', 'Level 1 Evocation (Wizard)');
  const [item] = context.parseSpellsFromText(text);
  assert.deepEqual(sorted(item.classes), ['Artificer', 'Bard', 'Wizard']);
  assert.equal(item.availability.conflicts.length, 1);
  assert.ok(review.findings({ spell: [item] }).some(issue => /disagree/.test(issue.msg)));
});

test('subclass expansion is conditional and a spell-level row is not a character level', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, '## Subclasses\n### Lantern Patron (Warlock Subclass)\n#### Expanded Spell List\nThese spells are added to your Warlock spell list.\n| Spell Level | Spells |\n| --- | --- |\n| 1 | Copper Flash, Outside Spark |')] });
  assert.deepEqual(spells[0].classes, []);
  const [entry] = spells[0].availability.conditional;
  assert.equal(entry.owner, 'Lantern Patron');
  assert.equal(entry.kind, 'subclass');
  assert.equal(entry.access, 'expanded-list');
  assert.equal(entry.spellLevel, 1);
  assert.equal(entry.level, undefined);
});

test('background prepared-spell tables retain the background and acquisition level', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, 'Background: Copper Envoy\nYou always have these spells prepared.\n| Character Level | Spells |\n| --- | --- |\n| 3 | Copper Flash |')] });
  const [entry] = spells[0].availability.conditional;
  assert.equal(entry.owner, 'Copper Envoy');
  assert.equal(entry.kind, 'background');
  assert.equal(entry.access, 'prepared');
  assert.equal(entry.level, 3);
  assert.deepEqual(spells[0].classes, []);
});

test('a named racial cantrip is not delayed to the level of the following grant', () => {
  const spells = [spell('Copper Flash', { level: 0 }), spell('Silver Spark')];
  availability.resolve(spells, { pages: [page(1, 'Race: Copperkin\nYou know the copper flash cantrip. When you reach 3rd level, you can cast the silver spark spell once per long rest.')] });
  assert.equal(spells[0].availability.conditional[0].level, undefined);
  assert.equal(spells[1].availability.conditional[0].level, 3);
  assert.equal(spells[0].availability.conditional[0].kind, 'race');
});

test('feat choices use the eligible class and spell level without granting a fixed spell', () => {
  const spells = [spell('Copper Flash', { level: 0, classes: ['Sorcerer'] }), spell('Silver Spark', { level: 1, classes: ['Wizard'] })];
  availability.resolve(spells, { pages: [page(1, 'Feat: Copper Initiate\nYou know one cantrip of your choice from the Sorcerer spell list.')] });
  assert.equal(spells[0].availability.conditional[0].access, 'choice');
  assert.equal(spells[0].availability.conditional[0].owner, 'Copper Initiate');
  assert.equal(spells[1].availability.conditional.length, 0);
});

test('spell description examples and negative or incidental statements are not access grants', () => {
  const { context } = loadApp();
  const text = 'Feat: Copper Scholar\nFor example, if you know Copper Flash, you could cast it.\nYou do not learn Silver Spark.\n'
    + definition('Copper Flash', 'You can cast spells through this light. Silver Spark remains unaffected.') + '\n' + definition('Silver Spark');
  const spells = context.parseSpellsFromText(text);
  assert.equal(spells.every(item => item.availability.conditional.length === 0), true);
});

test('ambiguous bonus tables keep their condition for review and never become base classes', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, '### Copper Craft (Witch Subclass)\n#### Copper Craft Bonus Spells\n| Spell Level | Spells |\n| --- | --- |\n| 1 | Copper Flash |')] });
  assert.equal(spells[0].availability.conditional[0].access, 'review');
  assert.ok(review.findings({ spell: spells }).some(issue => /grant conditions/.test(issue.msg)));
  assert.deepEqual(spells[0].classes, []);
});

function layoutPage(number, columns) {
  return { page: number, text: columns.flatMap(column => column.rows.map(row => row.text)).join('\n'), layout: { columns } };
}
function row(text, x, y, height = 10) { return { text, y, items: [{ str: text, x, y, height }] }; }

test('split PDF tables retain cantrip rows and wrapped names under their background', () => {
  const spells = [spell(), spell('Silver Spark'), spell('Unseen Servant')];
  const pdf = layoutPage(7, [
    { side: 'left', rows: [row('BACKGROUND: COPPER ENVOY', 40, 750, 11), row('These spells are added to your spell list.', 40, 730),
      row('Spell Level', 50, 700), row('Cantrip', 55, 680), row('1st', 60, 650)] },
    { side: 'reference', rows: [row('Spells', 120, 700), row('Copper Flash, Silver Spark', 120, 680), row('Unseen Servant', 120, 650)] }
  ]);
  availability.resolve(spells, { pages: [pdf] });
  assert.ok(spells.every(spell => spell.availability.conditional[0]?.owner === 'COPPER ENVOY'));
  assert.equal(spells[0].availability.conditional[0].spellLevel, 0);
  assert.equal(spells[2].availability.conditional[0].spellLevel, 1);
});

test('small capital headings identify feats without treating a parenthetical feat reference as an owner', () => {
  const spells = [spell()];
  const pdf = layoutPage(9, [{ side: 'left', rows: [
    row('DRACONIC FEATS', 40, 750, 13.4), row('GIFT OF THE COPPER DRAGON', 40, 730, 10.2),
    row('You always have Copper Flash prepared.', 40, 710),
    row('Your spellcasting ability is one you choose (choose when you select this feat)', 40, 690)
  ] }]);
  availability.resolve(spells, { pages: [pdf] });
  const [entry] = spells[0].availability.conditional;
  assert.equal(entry.owner, 'GIFT OF THE COPPER DRAGON');
  assert.equal(entry.kind, 'feat');
  assert.equal(entry.access, 'prepared');
});

test('wrapped background headings and spaced guild table headings preserve their owner', () => {
  const spells = [spell()];
  const pdf = layoutPage(5, [{ side: 'left', rows: [
    row('B ACKGROUND: COPPER', 40, 750, 11), row('FUNCTIONARY', 40, 736, 11),
    row('C OPPER G UILD SPELLS', 40, 718, 10.5), row('These spells are added to your spell list.', 40, 700),
    { text: 'Spell Level Spells', y: 680, items: [{ str: 'Spell Level', x: 50, y: 680, height: 10 }, { str: 'Spells', x: 120, y: 680, height: 10 }] },
    { text: '1st Copper Flash,', y: 660, items: [{ str: '1st', x: 60, y: 660, height: 10 }, { str: 'Copper Flash,', x: 120, y: 660, height: 10 }] },
    row('Silver Spark', 120, 648)
  ] }]);
  spells.push(spell('Silver Spark'));
  availability.resolve(spells, { pages: [pdf] });
  assert.ok(spells.every(spell => spell.availability.conditional[0]?.owner === 'COPPER FUNCTIONARY'));
  assert.ok(spells.every(spell => spell.availability.conditional[0]?.kind === 'background'));
});

test('class headings inside a feat cannot broaden base access and lists cannot jump over unread pages', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, 'Feat: Copper Initiate\nWizard Spells\n1st Level\nCopper Flash')] });
  assert.deepEqual(spells[0].classes, []);
  availability.resolve(spells, { pages: [page(1, 'Wizard Spells\n1st Level'), page(3, 'Copper Flash')] });
  assert.deepEqual(spells[0].classes, []);
});

test('single-spell introduction metadata is scoped to that definition', () => {
  const { context } = loadApp();
  const text = "## Spell\nThis new spell appears on the Artificer's spell list.\n" + definition() + '\n' + definition('Silver Spark');
  const spells = context.parseSpellsFromText(text);
  assert.deepEqual([...spells[0].classes], ['Artificer']);
  assert.deepEqual([...spells[1].classes], []);
});

test('malformed availability and context in imported drafts fail clearly', () => {
  const draft = require('../src/draft-storage');
  const { context } = loadApp();
  runInApp(context, `extractedData = { spell: [${JSON.stringify(spell())}] };`);
  const state = context.window.AuroraXMLHelper.captureWorkspaceDraft();
  state.data.spell[0].availability = { base: [], conditional: 'not-an-array', conflicts: [] };
  assert.throws(() => draft.validateState(state), /invalid spell availability/);
  delete state.data.spell[0].availability;
  state.reviewContext = { kind: 'pdf', fileName: 'synthetic.pdf', types: ['spell'], selectedPages: [2], continuationPages: [], availabilityPages: [0] };
  assert.throws(() => draft.validateState(state), /invalid source review/);
});

test('an unreadable table level remains actionable and can be corrected without guessing', () => {
  const { context, elements } = loadApp();
  const item = spell();
  const pdf = layoutPage(2, [{ side: 'page', rows: [
    row('DRAGONMARK FEATS', 40, 760, 14), row('MARK OF COPPER', 40, 740, 11),
    row('If you have Spellcasting, these spells are added to your spell list.', 40, 720, 8),
    row('MARK OF COPPER SPELIS', 40, 700, 11), row('Spell Level Spells', 40, 680, 8),
    { text: '% Copper Flash', y: 660, items: [{ str: '%', x: 50, y: 660, height: 8 }, { str: 'Copper Flash', x: 120, y: 660, height: 8 }] },
    row('https://example.test/source 2/9', 40, 640, 14)
  ] }]);
  availability.resolve([item], { pages: [pdf] });
  const entry = item.availability.conditional[0];
  assert.equal(entry.owner, 'MARK OF COPPER');
  assert.match(entry.condition, /If you have Spellcasting/);
  assert.equal(entry.levelUnclear, true);
  assert.equal(entry.spellLevel, undefined);
  runInApp(context, `extractedData = {spell:[${JSON.stringify(item)}]}; captureGeneratedBaseline();`);
  context.buildReviewUI();
  assert.match(elements.reviewIssuesList.innerHTML, /table level.*unreadable/);
  context.markSpellAvailabilityChecked(0, 0, true);
  assert.match(elements.reviewIssuesList.innerHTML, /table level.*unreadable/);
  context.updateSpellAvailabilityLevel(0, 0, { value: '2', dataset: { id: 'spell-0' }, classList: { add() {}, remove() {} } });
  assert.doesNotMatch(elements.reviewIssuesList.innerHTML, /table level.*unreadable/);
  const corrected = context.window.AuroraXMLHelper.captureWorkspaceDraft().data.spell[0];
  assert.equal(corrected.availability.conditional[0].spellLevel, 2);
  const fresh = review.applyContentCorrection(item, corrected);
  assert.equal(fresh.availability.conditional[0].spellLevel, 2);
  assert.equal(fresh.availability.conditional[0]._reviewed, undefined);
  assert.equal(fresh.availability.conditional[0]._source.page, 2);
});

test('grant conditions retain usage and ability text and stop before the next feature', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, 'Feat: Copper Gift\nDraconic Healing. You learn Copper Flash.\nYou can cast it without a spell slot.\nYou regain this use after a long rest.\nYou can also use spell slots.\nIntelligence, Wisdom, or Charisma is your spellcasting ability.\nProtective Wings. You gain wings for a moment.')] });
  const condition = spells[0].availability.conditional[0].condition;
  assert.match(condition, /long rest/);
  assert.match(condition, /Intelligence, Wisdom, or Charisma/);
  assert.doesNotMatch(condition, /Protective Wings/);
});

test('a level condition wrapped before the grant stays attached to that grant', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, 'Race: Copperkin\nWhen you reach character level 3,\nyou always have Copper Flash prepared.')] });
  const entry = spells[0].availability.conditional[0];
  assert.equal(entry.level, 3);
  assert.match(entry.condition, /When you reach character level 3/);
});

test('source reports preserve complete class membership and compare it as a set', () => {
  const { createSourceModel, validateSourceModel } = require('../scripts/source-validation');
  const model = createSourceModel({ parsedData: { spell: [spell('Copper Flash', { classes: ['Wizard', 'Artificer'] })] },
    types: ['spell'], sourceRecords: [], sourceContextForName: () => null });
  assert.deepEqual(model.entitiesByType.spell[0].metadata.classes, ['Wizard', 'Artificer']);
  let report = validateSourceModel(model, { requiredMetadata: { spell: { 'Copper Flash': { classes: ['Artificer', 'Wizard'] } } } });
  assert.equal(report.issues.some(issue => issue.field === 'classes'), false);
  report = validateSourceModel(model, { requiredMetadata: { spell: { 'Copper Flash': { classes: ['Wizard'] } } } });
  assert.equal(report.issues.some(issue => issue.field === 'classes'), true);
});

test('a verified OCR split in If you have preserves the spellcasting prerequisite', () => {
  const spells = [spell()];
  availability.resolve(spells, { pages: [page(1, 'Feat: Copper Mark\nSpells of the Mark. \\f you have the Spellcasting or Pact Magic class feature, these spells are added to its spell list.\n| Spell Level | Spells |\n| --- | --- |\n| 1 | Copper Flash |')] });
  assert.match(spells[0].availability.conditional[0].condition, /If you have the Spellcasting or Pact Magic class feature/);
});

test('conditional access is visible in XML while supports retain only base classes', () => {
  const { context } = loadApp();
  const item = spell('Copper Flash', { classes: ['Wizard'], availability: { base: [], conflicts: [], conditional: [{ owner: 'Copper <Patron>', kind: 'subclass', access: 'expanded-list', condition: 'Requires the Copper Patron & its feature.' }] } });
  runInApp(context, `extractedData = {spell: [${JSON.stringify(item)}]};`);
  const xml = context.generateXml();
  assert.match(xml, /<supports>Wizard<\/supports>/);
  assert.match(xml, /<h4>Conditional access<\/h4>/);
  assert.match(xml, /Copper &lt;Patron&gt;/);
  assert.match(xml, /&amp; its feature/);
  assert.doesNotMatch(xml, /<grant type="Spell"/);
});

test('review acknowledgements survive drafts but do not carry into a new extraction or remembered content', () => {
  const { context, elements } = loadApp();
  const item = spell('Copper Flash', { availability: { base: [], conflicts: [], conditional: [{ owner: 'Copper Initiate', kind: 'feat', access: 'known', condition: 'You know Copper Flash.', _source: { kind: 'pdf', page: 2, line: 4 } }] } });
  runInApp(context, `extractedData = {spell: [${JSON.stringify(item)}]}; captureGeneratedBaseline();`);
  context.buildReviewUI();
  assert.match(elements.reviewIssuesList.innerHTML, /Copper Initiate/);
  context.markSpellAvailabilityChecked(0, 0, true);
  context.markSpellAvailabilityChecked(0, -1, true);
  assert.doesNotMatch(elements.reviewIssuesList.innerHTML, /no spell lists assigned|review .*Copper Initiate/);
  const state = context.window.AuroraXMLHelper.captureWorkspaceDraft();
  const other = loadApp(); other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(state);
  assert.equal(other.context.window.AuroraXMLHelper.captureWorkspaceDraft().data.spell[0].availability.conditional[0]._reviewed, true);
  const corrected = review.applyContentCorrection(item, state.data.spell[0]);
  assert.equal(corrected.availability.conditional[0]._reviewed, undefined);
  assert.equal(corrected.availability.conditional[0]._source.page, 2);
});

test('real PDF lookup reads availability outside selection without importing outside spells', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-spell-availability-'));
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const lines of [
      ['Wizard Spells', '1st Level', 'Copper Flash (evocation)', 'Outside Spark (evocation)', 'Feat: Copper Initiate', 'You know the Copper Flash spell.'],
      definition().split('\n'), definition('Outside Spark').split('\n')
    ]) {
      const sheet = pdf.addPage([600, 800]);
      lines.forEach((text, i) => sheet.drawText(text, { x: 40, y: 740 - i * 22, size: 11, font }));
    }
    const file = path.join(directory, 'synthetic.pdf');
    fs.writeFileSync(file, await pdf.save());
    const source = await readSource(file, '2', { spellAvailability: true });
    const { context } = loadApp();
    const generated = generateBenchmarkXml(context, source.text, ['spell'], source);
    assert.deepEqual(source.pages.map(page => page.page), [2]);
    assert.deepEqual(source.continuationPages.map(page => page.page), [3]);
    assert.equal(generated.data.spell.length, 1);
    const item = generated.data.spell[0];
    assert.deepEqual([...item.classes], ['Wizard']);
    assert.equal(item._source.page, 2);
    assert.equal(item.availability.base[0]._source.page, 1);
    assert.equal(item.availability.conditional[0].owner, 'Copper Initiate');
    assert.equal(item.availability.conditional[0]._source.page, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
