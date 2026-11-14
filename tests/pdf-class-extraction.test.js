const assert = require('node:assert/strict');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSource, generateBenchmarkXml } = require('../scripts/benchmark-corpus');
const { createClassLayoutPdf } = require('./fixtures/create-class-layout-pdf');

function legacyClass(name = 'Wayfinder') {
  return [
    `The ${name}`,
    '| Level | Proficiency Bonus | Features | Spells Known | 1st | 2nd | 6th | 9th |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1st | +2 | Trail Lore, Spellcasting | 2 | 2 | — | — | — |',
    '| 2nd | +2 | Travelers Guild | 3 | 3 | — | — | — |',
    '| 20th | +6 | Trail Lore | 12 | 4 | 3 | 2 | 1 |',
    'Class Features', `As a ${name.toLowerCase()}, you gain the following class features.`,
    'Hit Points', `Hit Dice: 1d8 per ${name.toLowerCase()} level`,
    'Hit Points at 1st Level: 8 + your Constitution modifier',
    'Proficiencies', 'Armor: Light armor', 'Weapons: Simple weapons,', 'shortswords, and whips',
    'Tools: None', 'Saving Throws: Wisdom, Dexterity',
    'Skills: Choose three from Animal Handling,', 'Arcana, Nature, S tealth, and Survival',
    'Equipment', 'You start with a copper compass', 'and a walking staff.',
    'Trail Lore', 'Beginning at 1st level, you can follow a trail through mist.', 'Trail lore.', 'These e ffects last one minute.',
    'Spellcasting', 'Wisdom is your spellcasting ability for your spells.',
    'Spell Slots', 'You regain your spell slots when you finish a long rest.',
    'Spell attack modifier = your proficiency bonus', '+ your Wisdom modifier',
    'Travelers Guild', 'At 2nd level, you choose a guild.', 'Your guild grants additional benefits.',
    'You gain benefits at', '3rd level and again at 5th, 7th, and 11th', 'level.'
  ].join('\n');
}

test('older and homebrew class intros use table levels and retain wrapped core metadata', () => {
  const { context } = loadApp();
  const classes = context.parseClassesFromText(legacyClass());
  assert.equal(classes.length, 1);
  const cls = classes[0];
  assert.equal(cls.name, 'Wayfinder');
  assert.equal(cls.hitDie, 8);
  assert.equal(cls.skillChoices.count, 3);
  assert.ok(cls.skillChoices.from.includes('Animal Handling'));
  assert.ok(cls.skillChoices.from.includes('Stealth'));
  assert.ok(cls.weaponProficiencies.includes('whips'));
  assert.match(cls.startingEquipment, /copper compass.*walking staff/);
  assert.deepEqual(Array.from(cls.features, f => [f.name, f.level]), [['Trail Lore', 1], ['Spellcasting', 1], ['Travelers Guild', 2]]);
  assert.match(cls.features[1].description, /Spell Slots/);
  assert.equal(cls.spellcastingAbility, 'Wisdom');
  assert.equal(cls.progression.length, 3);
  assert.equal(cls.progression[2].slots[9], 1);
  assert.equal(cls.progression[2].spellsKnown, 12);
  assert.doesNotMatch(cls.features[0].description, /\| Level|\| 20th/);
  assert.match(cls.features[0].description, /Trail lore\./);
  assert.match(cls.features[0].description, /These effects last/);
  assert.match(cls.features[1].description, /\+ your Wisdom modifier/);
  assert.equal(cls.features[1].usage, '', 'Slot recovery does not make Spellcasting a once-per-rest feature.');
});

test('class XML uses recovered high-level slots and known-spell choices without Artificer assumptions', () => {
  const { context } = loadApp({ name: 'Synthetic Classes', abbr: 'SYN' });
  const [cls] = context.parseClassesFromText(legacyClass());
  runInApp(context, `extractedData = { class: ${JSON.stringify([cls])} };`);
  const xml = context.generateXml();
  assert.match(xml, /wayfinder:spellcasting:slots:9" value="1" level="20"/);
  assert.match(xml, /select type="Spell" name="Spellcasting \(Wayfinder\)"[^>]*level="1" number="2"/);
  assert.doesNotMatch(xml, /SLOTS_HALF_UP/);
  cls.name = 'Ranger';
  assert.ok(context.classSpellcastingRules(cls).some(rule => rule.xml.includes('SLOTS_HALF"')));
});

test('explicit feature levels still work with an older class intro and no progression table', () => {
  const { context } = loadApp();
  const text = legacyClass().slice(legacyClass().indexOf('Class Features'))
    .replace('\nTrail Lore\n', '\nLevel 1: Trail Lore\n')
    .replace('\nSpellcasting\n', '\nSpellcasting (Level 1)\n')
    .replace('\nTravelers Guild\n', '\nTravelers Guild\n2nd-level Wayfinder feature\n');
  const [cls] = context.parseClassesFromText(text);
  assert.deepEqual(Array.from(cls.features, f => [f.name, f.level]), [['Trail Lore', 1], ['Spellcasting', 1], ['Travelers Guild', 2]]);
  assert.match(cls.features[2].description, /^At 2nd level/);
});

test('an adjacent subclass section and another class do not become base class features', () => {
  const { context } = loadApp();
  const first = [legacyClass(), 'Wayfinder Subclasses', 'Copper Guild', 'Some subclass introduction.',
    'Level 3: Copper Sight', 'You see through mist.'].join('\n');
  const second = legacyClass('Mistkeeper');
  const text = [first, second].join('\n');
  const classes = context.parseClassesFromText(text, { pages: [
    { page: 1, text: first, layout: { references: [{ kind: 'reference', lines: ['Copper overview note.'] }] } },
    { page: 2, text: second, layout: { references: [{ kind: 'reference', lines: ['Silver overview note.'] }] } }
  ] });
  assert.equal(classes.length, 2);
  assert.doesNotMatch(classes[0].features.at(-1).description, /Copper Sight|Mistkeeper/);
  assert.equal(classes[1].name, 'Mistkeeper');
  assert.match(classes[0].description, /Copper overview/);
  assert.doesNotMatch(classes[0].description, /Silver overview/);
  assert.match(classes[1].description, /Silver overview/);
  assert.doesNotMatch(classes[1].description, /Copper overview/);
});

test('a selected class feature recovers its continuation without importing the next feature', () => {
  const { context } = loadApp();
  const text = legacyClass().replace('Your guild grants additional benefits.', 'Your guild grants');
  const classes = context.parseClassesFromText(text, { pages: [{ page: 1, text }], continuationPages: [{ page: 2,
    text: 'additional benefits when you travel.\nTrail Lore\nA feature outside the selected range.' }] });
  assert.equal(classes.length, 1);
  assert.match(classes[0].features.at(-1).description, /additional benefits when you travel/);
  assert.doesNotMatch(classes[0].features.at(-1).description, /outside the selected range/);
  const adjacent = context.parseClassesFromText(text, { pages: [{ page: 1, text }], continuationPages: [{ page: 2,
    text: 'Copper Locket\nWondrous item, uncommon\nUnrelated item rules.' }] });
  assert.doesNotMatch(adjacent[0].features.at(-1).description, /Copper Locket|Unrelated/);
  const cls = classes[0];
  cls.progression.push({ level: 3, features: ['Missing Feature', 'Craft Feature'] });
  runInApp(context, `extractedData = { class: ${JSON.stringify([cls])} };`);
  const issue = context.validateAll().find(issue => /progression table features need descriptions/.test(issue.msg));
  assert.match(issue.msg, /Missing Feature/);
  assert.doesNotMatch(issue.msg, /Craft Feature/);
});

test('a real two-page PDF retains a wide table, columns, wrapped fields, and base-class boundaries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-class-layout-'));
  try {
    const sourcePath = path.join(directory, 'synthetic.pdf');
    fs.writeFileSync(sourcePath, await createClassLayoutPdf());
    const source = await readSource(sourcePath, '1-2');
    const { context } = loadApp({ name: 'Class Layout Fixture', abbr: 'CLF' });
    const generated = generateBenchmarkXml(context, source.text, ['class'], source);
    const cls = generated.data.class[0];
    assert.equal(generated.data.class.length, 1);
    assert.equal(cls.name, 'Wayfinder');
    assert.equal(cls.hitDie, 8);
    assert.equal(cls.progression.length, 20);
    assert.equal(cls.progression[19].slots[9], 1);
    assert.deepEqual(Array.from(cls.features, f => f.name), ['Trail Lore', 'Spellcasting', 'Travelers Guild']);
    assert.ok(cls.weaponProficiencies.includes('whips'));
    assert.match(cls.startingEquipment, /compass.*walking staff/);
    assert.doesNotMatch(generated.xml, /outside the base class|\| Level/);
    const partial = await readSource(sourcePath, '1');
    const limited = generateBenchmarkXml(context, partial.text, ['class'], partial);
    assert.ok(!limited.data.class[0].features.some(f => f.name === 'Travelers Guild'));
    assert.doesNotMatch(limited.xml, /grant[^>]*TRAVELERS_GUILD/);
  } finally {
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(absolute).startsWith('aurora-class-layout-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});
