const assert = require('node:assert/strict');
const { loadApp } = require('../scripts/app-vm-harness');

test('spell metadata accepts spaced colons and preserves a wrapped reaction trigger', () => {
  const { context } = loadApp();
  const [spell] = context.parseSpellsFromText([
    'Copper Shelter', '1st-level abjuration', 'Casting Time : 1 reaction, which you take when',
    'a creature moves within 10 feet of you', 'Range : Self', 'Components : S',
    'Duration : 1 round', 'A copper ward surrounds you until your next turn.'
  ].join('\n'));
  assert.ok(spell);
  assert.equal(spell.castingTime, '1 reaction, which you take when a creature moves within 10 feet of you');
  assert.equal(spell.duration, '1 round');
  assert.match(spell.description, /^A copper ward/);
});

test('a partially described spell recovers the next-page continuation and excludes the next spell', () => {
  const { context } = loadApp();
  const header = ['Copper Winds', '2nd-level transmutation', 'Casting Time: 1 action', 'Range: 60 feet', 'Components: V', 'Duration: 1 minute'];
  const text = [...header, 'Choose an effect, or use your action on a later', '123456\u0015', '8'].join('\n');
  const rows = lines => lines.map((text, i) => ({ text, y: 700 - i * 15, items: [] }));
  const pages = [{ page: 8, text, layout: { columns: [{ side: 'right', rows: rows(header) }] } }];
  const continuationPages = [{ page: 9, layout: { columns: [{ side: 'left', rows: rows([
    'turn to switch effects.', 'Downdraft. A creature descends safely.', 'Updraft. A creature rises 10 feet.',
    'Outside Spark', '1st-level evocation', 'Casting Time: 1 action', 'Range: 20 feet', 'Components: V', 'Duration: Instantaneous', 'Unselected content.'
  ]) }] } }];
  const spells = context.parseSpellsFromText(text, { pages, continuationPages });
  assert.equal(spells.length, 1);
  assert.match(spells[0].description, /turn to switch effects/);
  assert.match(spells[0].description, /Downdraft\./);
  assert.match(spells[0].description, /Updraft\./);
  assert.doesNotMatch(spells[0].description, /123456|Outside Spark|Unselected/);
});

test('long item fragments do not require a recognised section heading', () => {
  const { context } = loadApp();
  const text = [...Array(130).fill('This is synthetic catalogue context.'), 'Copper Locket', 'Wondrous item, uncommon', 'The locket produces harmless light.'].join('\n');
  const items = context.parseMagicItemsFromText(text);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Copper Locket');
});

test('wrapped attunement metadata and split decorative L glyphs produce usable item names', () => {
  const { context } = loadApp();
  const items = context.parseMagicItemsFromText([
    'Be LL of Copper', 'Wondrous item, rare (requires attunement by a bard,', 'sorcerer, or wizard)',
    'The bell has 3 charges and regains 1d3 charges at dawn.',
    'F L ame Locket', 'Wondrous item, uncommon', 'The locket glows softly.'
  ].join('\n'));
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'Bell of Copper');
  assert.equal(items[0].requiresAttunement, true);
  assert.equal(items[0].charges, 3);
  assert.match(items[0].description, /^Requires attunement by a bard, sorcerer, or wizard\.\nThe bell/);
  assert.equal(items[1].name, 'Flame Locket');
  assert.equal(context.normalizeExtractedName('Ring L'), 'Ring L', 'Ambiguous letter designations must remain unchanged.');
});
