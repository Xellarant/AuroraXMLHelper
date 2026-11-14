const assert = require('node:assert/strict');
const { textItemsToLines, textItemsToLayout, extractPageLayout, findColumnSplit } = require('../src/pdf-text-layout');

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

test('one-column positioned text preserves row-first ordering', () => {
  const lines = textItemsToLines([
    item('Second', 72, 680),
    item('row', 115, 680),
    item('First', 72, 700),
    item('row', 110, 700)
  ]);

  assert.deepEqual(lines, ['First row', 'Second row']);
  assert.equal(findColumnSplit([item('A', 72, 700), item('B', 100, 700)]), null);
});

function styled(str, x, y, fontName = 'body', width = str.length * 4) {
  return { str, transform: [10, 0, 0, 10, x, y], width, height: 10, fontName };
}

test('a full-width progression table remains row-aligned between independent column bands', () => {
  const items = [styled('The Wayfinder', 54, 720)];
  for (const [label, x] of [['Level', 54], ['Bonus', 100], ['Features', 145], ['Known ', 330], ['1st', 380], ['2nd', 430]]) {
    items.push(styled(label, x, 690));
    items.push(styled(label, x, 690)); // Overprinted header in the source PDF.
  }
  items.push(styled('Proficiency', 100, 702), styled('Spells', 330, 702));
  for (const [level, y, feature, known, slots] of [['1st', 675, 'Trail Lore', '2', '2'], ['2nd', 660, 'Travelers Guild', '3', '3']]) {
    [['' + level, 54], ['+2', 100], [feature, 145], [known, 330], [slots, 380], ['—', 430]].forEach(([text, x]) => items.push(styled(text, x, y)));
  }
  for (let i = 0; i < 24; i++) items.push(styled(`Left prose row ${i}`, 54, 620 - i * 12, 'body', 220), styled(`Right prose row ${i}`, 320, 620 - i * 12, 'body', 220));
  const layout = textItemsToLayout(items);
  assert.equal(layout.tables.length, 1);
  assert.deepEqual(layout.tables[0].headers, ['Level', 'Proficiency Bonus', 'Features', 'Spells Known', '1st', '2nd']);
  assert.deepEqual(layout.tables[0].rows[1], ['2nd', '+2', 'Travelers Guild', '3', '3', '—']);
  assert.ok(layout.lines.indexOf('Left prose row 23') < layout.lines.indexOf('Right prose row 0'));
  assert.ok(!layout.lines.some(line => /Level Level|Bonus Bonus/.test(line)));
});

test('widths distinguish uneven columns from inline fragments in a single text column', () => {
  const columns = [];
  for (let i = 0; i < 48; i++) columns.push(styled(`Left prose ${i}`, 54, 720 - i * 12, 'body', 225));
  for (let i = 0; i < 5; i++) columns.push(styled(`Right inset ${i}`, 333, 720 - i * 12, 'body', 190));
  const lines = textItemsToLines(columns);
  assert.ok(lines.indexOf('Left prose 47') < lines.indexOf('Right inset 0'));
  const single = [];
  for (let i = 0; i < 24; i++) single.push(styled('Wide paragraph prefix', 54, 720 - i * 12, 'body', 270), styled('same line suffix', 330, 720 - i * 12, 'body', 200));
  assert.ok(textItemsToLines(single).every(line => line === 'Wide paragraph prefix same line suffix'));
  const fields = [];
  for (let i = 0; i < 24; i++) fields.push(styled('Label:', 54, 720 - i * 12, 'body', 80), styled('A field value on the same line.', 180, 720 - i * 12, 'body', 300));
  assert.ok(textItemsToLines(fields).every(line => line === 'Label: A field value on the same line.'));
});

test('inset reference prose is preserved separately without swallowing math or short final lines', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push(styled('A long paragraph of ordinary main-column rules text.', 54, 720 - i * 12, 'body', 220));
  items.push(styled('Reference Note', 333, 720, 'heading', 120));
  for (let i = 0; i < 5; i++) items.push(styled(`Reference paragraph line ${i}`, 333, 700 - i * 12, 'sans', 190));
  items.push(styled('Done.', 333, 640, 'sans', 25), styled('Spell save DC = 8 + proficiency', 80, 400, 'sans', 190));
  const layout = textItemsToLayout(items, { styles: { body: { fontFamily: 'serif' }, sans: { fontFamily: 'sans-serif' } } });
  assert.equal(layout.references.length, 1);
  assert.ok(layout.references[0].lines.includes('Done.'));
  assert.ok(layout.lines.includes('Reference Note'));
  assert.ok(!layout.mainLines.some(line => /Reference paragraph/.test(line)));
  assert.ok(layout.mainLines.some(line => /Spell save DC/.test(line)));
});

test('centered chapter lettering and a small full-width citation do not hide the prose gutter', () => {
  const items = [];
  for (let i = 0; i < 24; i++) {
    items.push(styled(`A paragraph on the left, line ${i}`, 54, 700 - i * 14, 'body', 232));
    items.push(styled(`A paragraph on the right, line ${i}`, 320, 700 - i * 14, 'body', 220));
  }
  for (let x = 250; x < 330; x += 6) items.push({ ...styled('C', x, 760, 'heading', 5), height: 24 });
  items.push({ ...styled('A source citation extending across both columns.', 200, 30, 'caption', 360), height: 6 });
  const layout = textItemsToLayout(items);
  assert.ok(layout.lines.indexOf('A paragraph on the left, line 23') < layout.lines.indexOf('A paragraph on the right, line 0'));
});

test('only a resolved annotation font is separated; ordinary alternate type and an all-script source survive', async () => {
  const items = [];
  for (let i = 0; i < 12; i++) items.push(styled(`Ordinary rules paragraph line ${i}`, 54, 720 - i * 12));
  items.push(styled('A marginal author comment.', 54, 500, 'note', 190));
  const styles = { body: { fontFamily: 'serif', ascent: 1, descent: -0.2 }, note: { fontFamily: 'serif', ascent: 1.4, descent: -0.9 } };
  let fontName = 'SUBSET+DearSarah-Regular';
  let calls = 0;
  const page = { getTextContent: async () => ({ items, styles }), getOperatorList: async () => { calls++; }, commonObjs: { has: () => true, get: () => ({ name: fontName }) } };
  let layout = await extractPageLayout(page);
  assert.equal(calls, 1);
  assert.ok(!layout.lines.some(line => /author comment/.test(line)));
  assert.equal(layout.references[0].kind, 'annotation');
  fontName = 'OrdinaryItalic';
  layout = await extractPageLayout(page);
  assert.ok(layout.lines.some(line => /author comment/.test(line)));
  const allScript = textItemsToLayout(items.filter(item => item.fontName === 'note'), { styles: { note: { name: 'DearSarah-Regular' } } });
  assert.ok(allScript.lines.includes('A marginal author comment.'));
});

test('two-column positioned text reads the full left column before the right', () => {
  const items = [];
  for (let index = 0; index < 10; index++) {
    const y = 720 - (index * 20);
    items.push(item(`L${index + 1}a`, 72, y), item(`L${index + 1}b`, 130, y));
    items.push(item(`R${index + 1}a`, 320, y), item(`R${index + 1}b`, 380, y));
  }

  const lines = textItemsToLines(items);

  assert.deepEqual(lines, [
    ...Array.from({ length: 10 }, (_, index) => `L${index + 1}a L${index + 1}b`),
    ...Array.from({ length: 10 }, (_, index) => `R${index + 1}a R${index + 1}b`)
  ]);
});
