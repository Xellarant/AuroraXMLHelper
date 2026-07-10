const assert = require('node:assert/strict');
const { textItemsToLines, findColumnSplit } = require('../src/pdf-text-layout');

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
