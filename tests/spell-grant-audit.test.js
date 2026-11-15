const assert = require('node:assert/strict');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const plain = value => JSON.parse(JSON.stringify(value));
function app(year = '2014') {
  const loaded = loadApp({ name: 'Grant Audit', abbr: 'GRA', year });
  return { ...loaded, meta: loaded.context.getSourceMeta() };
}
function table(lead, header = 'Class Level', rows = ['| 3 | Shield |']) {
  return [lead, '| ' + header + ' | Spells |', '| --- | --- |', ...rows].join('\n');
}

test('spell grant IDs resolve known, local, and edition-specific spells without inventing unknown IDs', () => {
  const { context, meta } = app();
  assert.equal(context.canonicalSpellId('Shield', meta), 'ID_PHB_SPELL_SHIELD');
  assert.equal(context.canonicalSpellId('Memory Beacon', meta), '');
  assert.equal(context.canonicalSpellId('Shield spell', meta), 'ID_PHB_SPELL_SHIELD');
  runInApp(context, 'extractedData.spell = [{ name: "Memory Beacon" }, { name: "Shield" }];');
  assert.equal(context.canonicalSpellId('Memory Beacon', meta), 'ID_GRA_SPELL_MEMORY_BEACON');
  assert.equal(context.canonicalSpellId('Shield', meta), 'ID_GRA_SPELL_SHIELD');
  const modern = app('2024');
  assert.equal(modern.context.canonicalSpellId('Shield', modern.meta), 'ID_WOTC_PHB24_SPELL_SHIELD');
});

test('expanded spell-level tables extend only their owning subclass spellcasting feature', () => {
  const { context, meta } = app();
  const description = table('These spells are added to your Warlock spell list.', 'Spell Level', ['| 1 | Shield |', '| 2 | Hold Person |']);
  const access = context.featureSpellAccess(description, 'Warlock', meta);
  assert.deepEqual(plain(access.expanded), ['ID_PHB_SPELL_SHIELD', 'ID_PHB_SPELL_HOLD_PERSON']);
  assert.equal(access.rules.length, 0);
  const xml = context.genArchetypeXml({
    name: 'Copper Patron', class: 'Warlock', supports: 'Otherworldly Patron',
    features: [{ name: 'Expanded Spell List', level: 3, description }]
  }, 'Grant Audit', meta.prefix, meta).join('\n');
  assert.match(xml, /<spellcasting name="Warlock" extend="true">/);
  assert.match(xml, /<extend>ID_PHB_SPELL_SHIELD<\/extend>/);
  assert.doesNotMatch(xml, /grant type="Spell"|prepared="true"/);
});

test('explicit prepared class-level tables retain correct levels and locally exported spell IDs', () => {
  const { context, meta } = app();
  runInApp(context, 'extractedData.spell = [{ name: "Memory Beacon" }];');
  const access = context.featureSpellAccess(table('You always have the following spells prepared.', 'Cleric Level',
    ['| 3 | Shield |', '| 5 | Memory Beacon |']), 'Cleric', meta);
  const xml = access.rules.map(rule => rule.xml).join('\n');
  assert.match(xml, /ID_PHB_SPELL_SHIELD" level="3" prepared="true" spellcasting="Cleric"/);
  assert.match(xml, /ID_GRA_SPELL_MEMORY_BEACON" level="5" prepared="true"/);
  assert.equal(access.findings.length, 0);
});

test('spell-level or unspecified spell tables cannot masquerade as class-level preparation', () => {
  const { context, meta } = app();
  for (const description of [table('You always have the following spells prepared.', 'Spell Level', ['| 1 | Shield |']),
    table('Copper Patron Spells')]) {
    const access = context.featureSpellAccess(description, 'Warlock', meta);
    assert.equal(access.rules.length, 0);
    assert.equal(access.expanded.length, 0);
    assert.ok(access.findings.length);
  }
});

test('unreadable table levels and missing spell definitions stay unresolved', () => {
  const { context, meta } = app();
  const access = context.featureSpellAccess(table('You always have the following spells prepared.', 'Class Level',
    ['| ? | Shield |', '| 0 | Shield |', '| 21 | Shield |', '| 5 | Memory Beacon |']), 'Cleric', meta);
  assert.equal(access.rules.length, 0);
  assert.ok(access.findings.some(message => /level.*unreadable|unreadable.*level/.test(message)));
  assert.ok(access.findings.some(message => /Memory Beacon/.test(message)));
  runInApp(context, 'extractedData.archetype = ' + JSON.stringify([{
    name: 'Copper Domain', class: 'Cleric', features: [{ name: 'Copper Spells', level: 3,
      description: table('You always have the following spells prepared.', 'Class Level', ['| 3 | Memory Beacon |']) }]
  }]) + ';');
  assert.ok(context.validateAll({ includeXml: false }).some(issue => issue.type === 'archetype' && /Memory Beacon/.test(issue.msg)));
});

test('cast-without-slot access does not become an always-prepared spell grant', () => {
  const { context, meta } = app();
  const access = context.featureSpellAccess('You can cast the Shield spell without expending a spell slot.', 'Wizard', meta);
  assert.equal(access.rules.length, 1);
  assert.match(access.rules[0].xml, /ID_PHB_SPELL_SHIELD/);
  assert.doesNotMatch(access.rules[0].xml, /prepared="true"/);
});

test('compound spell names and conjunction lists are resolved as full names', () => {
  const { context, meta } = app();
  const description = table('You always have the following spells prepared.', 'Class Level',
    ['| 3 | Detect Poison and Disease and Purify Food and Drink |']);
  const access = context.featureSpellAccess(description, 'Cleric', meta);
  assert.equal(access.rules.length, 2);
  const ids = access.rules.map(rule => rule.xml).join('\n');
  assert.match(ids, /DETECT_POISON_AND_DISEASE/);
  assert.match(ids, /PURIFY_FOOD_AND_DRINK/);
  assert.equal(access.findings.length, 0);
});

test('known compound spell names remain intact in direct table rows', () => {
  const { context, meta } = app();
  const access = context.featureSpellAccess(table('You always have the following spells prepared.', 'Class Level', [
    '| 3 | Protection from Evil and Good |',
    '| 5 | Detect Poison and Disease |',
    '| 7 | Create or Destroy Water |'
  ]), 'Cleric', meta);
  const xml = access.rules.map(rule => rule.xml).join('\n');
  assert.equal(access.rules.length, 3);
  assert.match(xml, /PROTECTION_FROM_EVIL_AND_GOOD" level="3"/);
  assert.match(xml, /DETECT_POISON_AND_DISEASE" level="5"/);
  assert.match(xml, /CREATE_OR_DESTROY_WATER" level="7"/);
  assert.equal(access.findings.length, 0);
});

test('negated or conditional spell tables cannot produce permanent grants or list extensions', () => {
  const { context, meta } = app();
  const sources = [
    table('You do not always have the following spells prepared.'),
    table('While you hold a lantern, you always have the following spells prepared.'),
    table('These spells are not added to your Warlock spell list.', 'Spell Level', ['| 1 | Shield |']),
    table('If you have a lantern, these spells are added to your Warlock spell list.', 'Spell Level', ['| 1 | Shield |'])
  ];
  for (const source of sources) {
    const access = context.featureSpellAccess(source, 'Warlock', meta);
    assert.equal(access.rules.length, 0, source);
    assert.equal(access.expanded.length, 0, source);
    assert.ok(access.findings.length, source);
  }
});

test('prose preparation keeps explicit acquisition levels and does not grant another creature spells', () => {
  const { context, meta } = app();
  for (const source of ['When you reach 3rd level, you always have the Shield spell prepared.',
    'You always have the Shield spell prepared at 3rd level.']) {
    const access = context.featureSpellAccess(source, 'Cleric', meta);
    assert.equal(access.rules.length, 1, source);
    assert.match(access.rules[0].xml, /level="3"/, source);
  }
  const other = context.featureSpellAccess('Your companions always have the Shield spell prepared.', 'Cleric', meta);
  assert.equal(other.rules.length, 0);
  const conditional = context.featureSpellAccess('You always have the Shield spell prepared while you hold a lantern.', 'Cleric', meta);
  assert.equal(conditional.rules.length, 0);
  assert.ok(conditional.findings.length);
});
