const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const progression = require('../src/class-progression');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const { generateBenchmarkXml, readSource } = require('../scripts/benchmark-corpus');
const { classChoiceSource } = require('./fixtures/class-choice-source');
const { runAuroraShapeValidator } = require('../scripts/aurora-shape-validator');
const draft = require('../src/draft-storage');
const review = require('../src/source-review');

function parsed(text = classChoiceSource()) {
  const app = loadApp({ name: 'Mistkeeper Test', abbr: 'MIST', year: '2014' }, { referenceIndex: true });
  const generated = generateBenchmarkXml(app.context, text, ['class']);
  return { ...app, ...generated, cls: generated.data.class[0] };
}
const plain = value => JSON.parse(JSON.stringify(value));
const choice = (cls, name) => cls.choices.find(choice => choice.name === name);

test('repeated progression features are granted once and explicit features absent from the table survive', () => {
  const { context, cls } = parsed();
  cls.features.push({ name: 'Mist Lantern', level: 7, description: 'You light a lantern.' });
  const grants = plain(context.classProgressionFeatureGrants(cls));
  assert.deepEqual(grants.filter(grant => grant.name === 'Ability Score Improvement'), [{ name: 'Ability Score Improvement', level: 4 }]);
  assert.deepEqual(grants.filter(grant => grant.name === 'Grand Hex'), [{ name: 'Grand Hex', level: 11 }]);
  assert.deepEqual(grants.find(grant => grant.name === 'Mist Lantern'), { name: 'Mist Lantern', level: 7 });
  assert.ok(progression.findings(cls).some(issue => /Mist Lantern.*absent/.test(issue.msg)));
});

test('ability increases and grand hex choices repeat at every source level without duplicate parent grants', () => {
  const { cls, xml } = parsed();
  assert.deepEqual(progression.events(cls, choice(cls, 'Ability Score Improvement')).map(event => event.level), [4, 8, 12, 16, 19]);
  assert.deepEqual(plain(progression.events(cls, choice(cls, 'Grand Hex')).map(event => event.level)), [11, 13, 15, 18]);
  assert.equal((xml.match(/select type="Ability Score Improvement"/g) || []).length, 5);
  assert.match(xml, /Ability Score Improvement \(Mistkeeper, level 19\)" supports="Ability Score Improvement,Class" level="19" number="2"/);
  assert.equal((xml.match(/grant type="Class Feature" id="ID_MIST_CLASS_FEATURE_MISTKEEPER_ASI"/g) || []).length, 1);
  assert.doesNotMatch(xml, /select type="Feat"/);
});

test('spell and cantrip gains preserve their actual level and multi-cantrip increments', () => {
  const { xml } = parsed();
  assert.match(xml, /Cantrip \(Mistkeeper\)" supports="\$\(spellcasting:list\), 0" level="1" number="2"/);
  assert.match(xml, /Cantrip \(Mistkeeper\)" supports="\$\(spellcasting:list\), 0" level="4" number="2"/);
  assert.match(xml, /Spellcasting \(Mistkeeper\)"[^>]*level="5" number="2"/);
  assert.match(xml, /mistkeeper:spellcasting:slots:9" value="1" level="17"/);
  assert.match(xml, /spellcasting name="Mistkeeper" ability="Charisma" prepare="false" allowReplace="true"/);
});

test('sorted deltas do not inflate after decreases, duplicate levels, or invalid numbers', () => {
  const rows = [{ level: 5, n: 4 }, { level: 1, n: 2 }, { level: 3, n: 1 }, { level: 4, n: 2 },
    { level: 6, n: 8 }, { level: 6, n: 9 }, { level: 7, n: -1 }, { level: 8, n: 4.5 }];
  assert.deepEqual(progression.deltas(rows, row => row.n), [{ level: 1, count: 2 }, { level: 5, count: 2 }]);
  const cls = { features: [], progression: rows.map(row => ({ ...row, features: [], spellsKnown: row.n })) };
  const findings = progression.findings(cls).map(issue => issue.msg).join('\n');
  assert.match(findings, /occurs more than once/);
  assert.match(findings, /out of order/);
  assert.match(findings, /decreases/);
  assert.match(findings, /nonnegative whole number/);
});

test('table numbers are strict, dashes are zero, and modern header variants retain all slot columns', () => {
  const { context } = loadApp();
  const rows = context.parseClassProgressionRows([
    '| Level | PB | Class Features | Cantrips | Prepared Spells | Invocations Known | 1 | 9 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | +2 | Spellcasting | 2? | u | 2 | — | 1 |',
    '| 2 | +2 | — | 2 | 3 | 3 | 2 | 1 |'
  ]);
  assert.equal(rows[0].slots[1], 0);
  assert.equal(rows[0].slots[9], 1);
  assert.equal(rows[0].cantrips, null);
  assert.equal(rows[0].prepared, null);
  assert.equal(rows[1].invocationsKnown, 3);
  assert.equal(rows[0]._errors.length, 2);
});

test('short or unreadable table rows stay visible for repair instead of silently truncating the class', () => {
  const { context } = loadApp();
  const rows = context.parseClassProgressionRows(['| Level | Features | Cantrips |', '| --- | --- | --- |',
    '| 1 | Spellcasting |', '| u | Mist | 3 |', '| 3 | — | 4 |']);
  assert.equal(rows.length, 3);
  assert.ok(rows[0]._errors.length);
  assert.equal(rows[1].level, 0);
  assert.equal(rows[2].cantrips, 4);
  assert.match(progression.findings({ features: [], progression: rows }).map(issue => issue.msg).join('\n'), /invalid level/);
});

test('catalogues generate scoped options, correct counts, and feature prerequisites without importing subclasses', () => {
  const { cls, xml } = parsed();
  assert.deepEqual(plain(choice(cls, 'Hexes').options.map(option => option.name)), ['Fog Bell', 'Mist Anchor', 'Rain Shield', 'Soft Steps']);
  assert.equal(choice(cls, 'Grand Hex').options.length, 4);
  assert.deepEqual(progression.events(cls, choice(cls, 'Hexes')), [{ level: 1, count: 2 }, { level: 5, count: 1 }]);
  assert.match(xml, /Hexes \(Mistkeeper, level 1\)" supports="ID_MIST_CLASS_CHOICE_MISTKEEPER_HEXES" level="1" number="2"/);
  assert.match(xml, /<requirements>ID_MIST_CLASS_FEATURE_MISTKEEPER_HEXES,ID_MIST_CLASS_FEATURE_MISTKEEPER_FAMILIAR<\/requirements>/);
  assert.doesNotMatch(xml, /element name="Cloud Guild"|element name="Cantrips"/);
  assert.match(xml, /grant type="Spell" id="ID_PHB_SPELL_FIND_FAMILIAR"/);
});

test('unresolved prerequisites and invalid minimum levels withhold options and empty pickers', () => {
  const { context, cls } = parsed();
  const hexes = choice(cls, 'Hexes');
  hexes.options.forEach(option => { option.unresolvedPrerequisite = 'An unavailable patron'; });
  assert.equal(context.classChoiceRules(cls, cls.features.find(feature => feature.name === 'Hexes'), context.getSourceMeta()).length, 0);
  assert.doesNotMatch(context.classChoiceElements(cls, 'Test', 'ID_MIST', context.getSourceMeta()).join('\n'), /name="Fog Bell"/);
  assert.ok(progression.findings(cls).some(issue => /unresolved prerequisite/.test(issue.msg)));
  delete hexes.options[0].unresolvedPrerequisite;
  hexes.options[0].minimumLevel = 30;
  assert.equal(context.usableClassOptions(cls, hexes).length, 0);
});

test('catalogue minimum-level prerequisites are retained and unknown prerequisites are withheld', () => {
  const cls = { name: 'Invoker', features: [{ name: 'Eldritch Invocations', level: 2, description: 'Choose invocations.' }] };
  progression.build(cls, ['Eldritch Invocations', 'The following options are presented in alphabetical order.',
    'Deep Voice', 'Prerequisite: 9th-level Invoker', 'You speak through fog.',
    'Pale Eye', 'You can see through mist.', 'Prerequisite: Unmapped Patron',
    'Invoker Subclasses'].join('\n'));
  assert.equal(cls.choices[0].options[0].minimumLevel, 9);
  assert.equal(cls.choices[0].options[1].unresolvedPrerequisite, 'Unmapped Patron');
});

test('choice spells stay under their option and unresolved homebrew spell IDs are never fabricated', () => {
  const { context, cls, xml } = parsed();
  const ember = xml.slice(xml.indexOf('<element name="Ember"'), xml.indexOf('<element name="Wanderer"'));
  assert.match(ember, /grant type="Spell" id="ID_PHB_SPELL_PRODUCE_FLAME"/);
  assert.doesNotMatch(xml.slice(0, xml.indexOf('<element name="Ember"')), /PRODUCE_FLAME/);
  const option = { name: 'Beacon', description: 'You learn the memory beacon cantrip.' };
  assert.equal(context.classOptionRules(cls, choice(cls, 'Mist Curse'), option, context.getSourceMeta()).length, 0);
  runInApp(context, 'extractedData.spell = [{name: "Memory Beacon"}];');
  assert.match(context.classOptionRules(cls, choice(cls, 'Mist Curse'), option, context.getSourceMeta())[0], /ID_MIST_SPELL_MEMORY_BEACON/);
});

test('bonus spell choices from a curse are conditional and retain their own schedule', () => {
  const { context, cls } = parsed();
  const option = { name: 'Haunted', description: 'You learn an additional mistkeeper spell at a level for which you have spell slots at 1st level, and again at 4th level, 8th level, and 12th level. These spells do not count against spells known.' };
  const rules = context.classOptionRules(cls, choice(cls, 'Mist Curse'), option, context.getSourceMeta()).join('\n');
  assert.deepEqual([...rules.matchAll(/level="(\d+)"/g)].map(match => Number(match[1])), [1, 4, 8, 12]);
  assert.match(rules, /spellcasting="Mistkeeper"/);
});

test('2014 optional feats remain optional while 2024 feat choices and epic boons retain source levels', () => {
  const old = parsed(classChoiceSource().replace('to a maximum of 20.', 'to a maximum of 20. Alternatively, choose a feat.'));
  assert.equal(choice(old.cls, 'Ability Score Improvement').mode, 'asiOrFeat');
  assert.match(old.xml, /ID_INTERNAL_OPTION_ALLOW_FEATS/);
  assert.match(old.xml, /select type="Ability Score Improvement"[^>]*number="2"/);
  const modern = parsed(classChoiceSource().replace(/you can increase one ability score by 2 or two ability scores by 1, to a maximum of 20\./,
    'you gain the Ability Score Improvement feat or another feat of your choice.'));
  assert.match(modern.xml, /select type="Feat" name="Ability Score Improvement \(Mistkeeper, level 8\)" level="8"/);
  assert.doesNotMatch(modern.xml, /ID_INTERNAL_OPTION_ALLOW_FEATS/);
});

test('plan catalogues honor tier boundaries and teach plans without granting equipped magic items', () => {
  const text = ['Magic Item Plans (Artificer Level 2+)', '| Magic Item Plan | Attunement |', '| --- | --- |',
    '| Copper Compass | No |', '| Common item* | Varies |',
    'Magic Item Plans (Artificer Level 6+)', '| Magic Item Plan | Attunement |', '| --- | --- |',
    '| Mist Cloak | Yes |', 'Artificer Subclass (Level 3)', '| Unrelated | Table |', '| Bad Plan | No |'].join('\n');
  const cls = { name: 'Artificer', features: [{ name: 'Replicate Magic Item', level: 2, description: 'Choose plans. Whenever you gain a level, you can replace one plan.' }],
    progression: [{ level: 2, features: [], plansKnown: 2 }, { level: 6, features: [], plansKnown: 3 }] };
  progression.build(cls, text);
  const { context } = parsed();
  assert.deepEqual(cls.choices[0].options.map(option => [option.name, option.minimumLevel]), [['Copper Compass', 2], ['Common item', 2], ['Mist Cloak', 6]]);
  const xml = context.classChoiceElements(cls, 'Test', 'ID_MIST', context.getSourceMeta()).join('\n');
  assert.match(xml, /\[level:6\]/);
  assert.match(xml, /allow duplicate/);
  assert.doesNotMatch(xml, /grant type="Magic Item"|Bad Plan/);
  assert.deepEqual(progression.events(cls, cls.choices[0]), [{ level: 2, count: 2 }, { level: 6, count: 1 }]);
});

test('unreadable OCR plan names are withheld and missing tables produce actionable findings', () => {
  const cls = { name: 'Artificer', features: [{ name: 'Replicate Magic Item', level: 2, description: 'Choose plans.' }], progression: [] };
  progression.build(cls, ['Masic Item Pans (Arriricer Levet 2+)', 'Magic Item Plan Attunement', 'Weapon, +7 No', 'Bag of Holding No'].join('\n'));
  assert.equal(cls.choices[0].options.length, 2);
  assert.match(cls.choices[0].options[0].unresolvedPrerequisite, /OCR item name/);
  const findings = progression.findings(cls).map(issue => issue.msg).join('\n');
  assert.match(findings, /No progression table was recovered/);
  assert.match(findings, /no choice schedule/);
});

test('duplicate choice names, option names, and schedule levels cannot emit ambiguous selectors', () => {
  const { context, cls } = parsed();
  const hexes = choice(cls, 'Hexes');
  hexes.schedule = [{ level: 1, count: 2 }, { level: 1, count: 1 }];
  assert.equal(context.validClassChoiceEvents(cls, hexes).length, 0);
  hexes.options.push({ ...hexes.options[0] });
  assert.ok(!context.usableClassOptions(cls, hexes).some(option => option.name === 'Fog Bell'));
  cls.choices.push({ ...hexes });
  assert.ok(!context.exportableClassChoices(cls).some(choice => choice.name === 'Hexes'));
  assert.match(progression.findings(cls).map(issue => issue.msg).join('\n'), /unique within the class/);
});

test('progression and option repair preserve unapplied text, apply corrections, and retain source references', () => {
  const { context, cls } = parsed();
  cls.progressionDraft = '| Level | Features | Cantrips |\n| --- | --- | --- |\n| 1 | Spellcasting | 3 |';
  runInApp(context, 'extractedData.class = ' + JSON.stringify([cls]) + ';');
  assert.ok(context.validateAll({ includeXml: false }).some(issue => /unapplied edits/.test(issue.msg)));
  assert.equal(context.applyClassProgression('class-0'), true);
  assert.equal(runInApp(context, 'extractedData.class[0].progression[0].cantrips'), 3);
  assert.ok(!context.validateAll({ includeXml: false }).some(issue => /unapplied edits/.test(issue.msg)));
  runInApp(context, 'extractedData.class[0].progressionDraft = "not a table";');
  assert.equal(context.applyClassProgression('class-0'), false);
  assert.equal(runInApp(context, 'extractedData.class[0].progression[0].cantrips'), 3);
  const ci = cls.choices.findIndex(choice => choice.name === 'Mist Curse');
  runInApp(context, 'extractedData.class[0].choices[' + ci + '].catalogueDraft = "Choose one of the options below.\\nMoon. You can see moonlight.\\nSun. You can see sunlight.";');
  assert.equal(context.importClassChoiceOptions('class-0', ci), true);
  assert.equal(runInApp(context, 'extractedData.class[0].choices[' + ci + '].options[0]._source.kind'), 'pasted');
});

test('choice schedule edits support a source reset and invalid entries stay unresolved', () => {
  const { context, cls } = parsed();
  const ci = cls.choices.findIndex(choice => choice.name === 'Hexes');
  context.updateClassChoiceSchedule({ dataset: { id: 'class-0', field: 'choices.' + ci + '.scheduleText' }, value: '1:2, bad', classList: { add() {}, remove() {} } });
  assert.ok(context.validateAll({ includeXml: false }).some(issue => /invalid schedule/.test(issue.msg)));
  context.resetClassChoiceSchedule('class-0', ci);
  const events = plain(runInApp(context, 'AuroraClassProgression.events(extractedData.class[0], extractedData.class[0].choices[' + ci + '])'));
  assert.deepEqual(events, [{ level: 1, count: 2 }, { level: 5, count: 1 }]);
});

test('source-wide PDF catalogue context keeps base features in range and identifies partial catalogues', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-class-choices-'));
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const source = classChoiceSource();
    const boundary = source.lastIndexOf('\nHexes\n');
    const chunks = [source.slice(0, boundary), source.slice(boundary + 1, source.indexOf('\nGrand Hexes\n')),
      source.slice(source.indexOf('\nGrand Hexes\n') + 1)];
    for (const text of chunks) {
      const lines = text.replace(/—/g, '-').split('\n');
      const page = pdf.addPage([1500, Math.max(792, lines.length * 14 + 80)]);
      lines.forEach((line, index) => page.drawText(line, { x: 40, y: page.getHeight() - 40 - index * 14, size: 10, font }));
    }
    const file = path.join(directory, 'class-choices.pdf');
    fs.writeFileSync(file, await pdf.save());
    const fullContext = await readSource(file, '1', { classChoices: true });
    const { context } = loadApp({ abbr: 'PDF' });
    const generated = generateBenchmarkXml(context, fullContext.text, ['class'], fullContext);
    const cls = generated.data.class[0];
    assert.equal(cls.features.length, 6);
    assert.equal(choice(cls, 'Hexes').options.length, 4);
    assert.equal(choice(cls, 'Grand Hex').options.length, 4);
    assert.equal(choice(cls, 'Hexes').options[0]._source.page, 2);
    assert.equal(choice(cls, 'Hexes').options[0]._source.continuation, true);
    assert.equal(choice(cls, 'Grand Hex').options[0]._source.page, 3);
    assert.doesNotMatch(generated.xml, /element name="Cloud Guild"/);
    const partial = await readSource(file, '1');
    const limited = generateBenchmarkXml(context, partial.text, ['class'], partial).data.class[0];
    assert.ok(progression.findings(limited).some(issue => /page boundary|no option definitions/.test(issue.msg)));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('generated class choices pass the Aurora XML shape validator', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-class-choice-xml-'));
  try {
    fs.writeFileSync(path.join(directory, 'mistkeeper.xml'), parsed().xml);
    const result = runAuroraShapeValidator({ rootPath: directory });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 90000);

test('draft recovery preserves progression repairs, schedules, option prerequisites, and source locations', () => {
  const { context, cls } = parsed();
  cls.progressionDraft = 'Unapplied table text';
  cls.choices[0].schedule = [{ level: 3, count: 1 }];
  cls.choices[0].options[0]._source = { kind: 'pdf', fileName: 'synthetic.pdf', page: 3, line: 8, excerpt: 'Original option.' };
  runInApp(context, 'extractedData.class = ' + JSON.stringify([cls]) + '; generatedBaselineData = ' + JSON.stringify({ class: [cls] }) + ';');
  const state = draft.decode(draft.encode(context.window.AuroraXMLHelper.captureWorkspaceDraft())).state;
  const other = loadApp();
  other.context.window.AuroraXMLHelper.restoreWorkspaceDraft(state);
  const recovered = other.context.window.AuroraXMLHelper.captureWorkspaceDraft();
  assert.equal(recovered.data.class[0].progressionDraft, 'Unapplied table text');
  assert.equal(recovered.data.class[0].choices[0].schedule[0].level, 3);
  assert.equal(recovered.data.class[0].choices[0].options[0]._source.page, 3);
  assert.equal(recovered.data.class[0].progression[19].slots[9], 1);
  const damaged = plain(state);
  damaged.data.class[0].choices[0].options = {};
  assert.throws(() => draft.encode(damaged), /invalid class progression/);
  const legacy = plain(state);
  delete legacy.data.class[0].choices;
  assert.doesNotThrow(() => draft.encode(legacy));
});

test('source-wide catalogues stop before a different class and cannot lend it options', () => {
  const text = ['Class Features', 'As an invoker, you gain the following class features.',
    'Hit Dice: 1d8 per invoker level', 'Level 1: Hexes', 'Choose two hexes.',
    'Class Features', 'As a fogwalker, you gain the following class features.',
    'Hit Dice: 1d6 per fogwalker level', 'Hexes', 'The Hexes below are presented in alphabetical order.',
    'Borrowed Secret', 'You can read the fog.'].join('\n');
  const { cls } = parsed(text);
  assert.equal(cls.name, 'Invoker');
  assert.equal(cls.choices[0].options.length, 0);
});

test('a table-of-contents entry cannot truncate the selected modern class catalogue', () => {
  const cls = { name: 'Artificer', features: [{ name: 'Replicate Magic Item', level: 2, description: 'Choose plans.' }] };
  const selected = { page: 2, text: ['CORE ARTIFICER TRAITS', 'Primary Ability Intelligence', 'Hit Point Die D8',
    'Magic Item Plans (Artificer Level 2+)', 'Magic Item Plan Attunement', 'Copper Compass No'].join('\n') };
  progression.build(cls, selected.text, { pages: [selected], availabilityPages: [
    { page: 1, text: 'Core Artificer Traits\nBecoming an Artificer\nClass Features' }, selected
  ] });
  assert.equal(cls.choices[0].options.length, 1);
  assert.equal(cls.choices[0].options[0].name, 'Copper Compass');
});

test('remembered class corrections keep newly located choice sources and discard stale page references', () => {
  const { cls } = parsed();
  const corrected = plain(cls);
  corrected.choices[0].schedule = [{ level: 3, count: 1 }];
  corrected.choices[0].options[0]._source.page = 99;
  const current = plain(cls);
  current.choices[0]._source.page = 5;
  current.choices[0].options[0]._source.page = 6;
  const applied = review.applyContentCorrection(current, corrected);
  assert.equal(applied.choices[0].schedule[0].level, 3);
  assert.equal(applied.choices[0]._source.page, 5);
  assert.equal(applied.choices[0].options[0]._source.page, 6);
  const unknown = plain(corrected);
  unknown.choices[0].options.push({ name: 'Manual option', description: 'Manual text.', _source: { page: 42 } });
  assert.equal(review.applyContentCorrection(current, unknown).choices[0].options.at(-1)._source, undefined);
});

test('the progression editor round-trips all levels, empty feature cells, zero slots, and proficiency evidence', () => {
  const { context, cls } = parsed();
  const rows = context.parseClassProgressionRows(context.normalizeTextLines(context.classProgressionText(cls)));
  assert.deepEqual(plain(rows), plain(cls.progression));
});

test('unrecognized resource columns remain available for review and never silently claim automation', () => {
  const { context } = loadApp();
  const rows = context.parseClassProgressionRows(['| Level | Features | Mist Points | Mist Die |',
    '| --- | --- | --- | --- |', '| 1 | Mist | 2 | d6 |']);
  assert.equal(rows[0].extraColumns['Mist Points'], '2');
  assert.equal(rows[0].extraColumns['Mist Die'], 'd6');
  const cls = { name: 'Mistkeeper', features: [], progression: rows };
  assert.match(progression.findings(cls).map(issue => issue.msg).join('\n'), /no generated rules: Mist Points, Mist Die/);
  assert.deepEqual(plain(context.parseClassProgressionRows(context.normalizeTextLines(context.classProgressionText(cls)))), plain(rows));
});

test('fractional option prerequisites remain invalid instead of being truncated to a lower level', () => {
  const { context } = parsed();
  context.updateNestedField({ dataset: { id: 'class-0', field: 'choices.0.options.0.minimumLevel' }, value: '2.5', classList: { add() {}, remove() {} } });
  const cls = runInApp(context, 'extractedData.class[0]');
  assert.equal(cls.choices[0].options[0].minimumLevel, 2.5);
  assert.ok(!context.usableClassOptions(cls, cls.choices[0]).some(option => option.name === 'Ember'));
  assert.ok(progression.findings(cls).some(issue => /minimum level from 1 to 20/.test(issue.msg)));
});
