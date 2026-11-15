const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const { readSource, generateBenchmarkXml } = require('../scripts/benchmark-corpus');
const { createSpellAccuracyPdf } = require('./fixtures/create-spell-accuracy-pdf');

function spellText(body) {
  return ['Copper Flash', '2nd-level evocation', 'Casting Time: 1 action', 'Range: 30 feet', 'Components: V, S', 'Duration: Instantaneous', body].join('\n');
}

test('spell OCR cleanup restores dice and wrapped words in both the description and upcasting', () => {
  const { context } = loadApp();
  const [spell] = context.parseSpellsFromText(spellText([
    'A crea-', 'ture takes ld6 damage. On a suc-', 'cessful save it takes half damage.',
    'The charge dissi-', 'pates. A fly i ng mote sheds light.',
    'At Higher Levels. When us-', 'ing a higher slot, damage in-', 'creases by ld8.'
  ].join('\n')));
  assert.match(spell.description, /creature takes 1d6 damage/);
  assert.match(spell.description, /successful save/);
  assert.match(spell.description, /dissipates/);
  assert.match(spell.description, /flying mote/);
  assert.match(spell.higherLevels, /using a higher slot, damage increases by 1d8/);
});

test('OCR cleanup preserves genuine compounds, valid dice, and unfamiliar hyphenated words', () => {
  const { context } = loadApp();
  const [spell] = context.parseSpellsFromText(spellText('A 30-\nfoot cone has a short-\nterm effect and deals 2d8 damage.\nA crystal-\nforged token keeps its name. The identifier field6 is unchanged.'));
  assert.match(spell.description, /30-foot cone/);
  assert.match(spell.description, /short-term effect/);
  assert.match(spell.description, /crystal-forged token/);
  assert.match(spell.description, /2d8 damage/);
  assert.match(spell.description, /field6/);
});

test('a complete die-result table can recover a missing first label without inventing incomplete results', () => {
  const { context } = loadApp();
  const [spell] = context.parseSpellsFromText(spellText('Roll on the table.\nSPARK RESULTS\nd4 Effect\nCopper light appears.\n2 Silver light appears.\n3 Blue light appears.\n4 Green light appears.'));
  assert.match(spell.description, /d4 Effect\n1 Copper light appears/);
  const [incomplete] = context.parseSpellsFromText(spellText('Roll on the table.\nd4 Effect\nCopper light appears.\n3 Blue light appears.\n4 Green light appears.'));
  assert.doesNotMatch(incomplete.description, /1 Copper/);
});

test('a selected PDF spell retains its next-page stat block and prose, without importing the adjacent spell', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-spell-accuracy-'));
  try {
    const sourcePath = path.join(directory, 'synthetic.pdf');
    fs.writeFileSync(sourcePath, await createSpellAccuracyPdf());
    const source = await readSource(sourcePath, '1');
    const { context } = loadApp({ name: 'Accuracy Fixture', abbr: 'ACC', year: '2021' });
    const generated = generateBenchmarkXml(context, source.text, ['spell'], source);
    assert.equal(generated.data.spell.length, 1);
    const spell = generated.data.spell[0];
    assert.equal(spell.name, 'Summon Brassy Glider');
    assert.equal(spell.statBlockName, 'Brassy Glider');
    assert.match(spell.statBlock, /Armor Class 12/);
    assert.match(spell.statBlock, /Hit: 1d6 \+ 2 piercing damage/);
    assert.doesNotMatch(spell.statBlock, /You call|Outside Range Spark/);
    assert.match(spell.description, /follows your commands/);
    assert.match(spell.higherLevels, /increase by 1d8/);
    assert.match(generated.xml, /<h4>Brassy Glider<\/h4>/);
    assert.match(generated.xml, /Armor Class 12/);
    assert.doesNotMatch(generated.xml, /Outside Range Spark/);
  } finally {
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(absolute).startsWith('aurora-spell-accuracy-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});

test('missing referenced stat blocks are visible in review and validation, and exported stat text is escaped', () => {
  const { context } = loadApp();
  const [unnamed] = context.parseSpellsFromText(spellText('This form uses the following stat block. It appears in an open space.'));
  assert.equal(unnamed.statBlockName, undefined, 'A generic reference must not be mistaken for a creature name.');
  const [spell] = context.parseSpellsFromText(spellText('This form uses the Copper Wisp stat block. It appears in an open space.'));
  runInApp(context, `extractedData = { spell: ${JSON.stringify([spell])} };`);
  assert.ok(context.validateAll().some(issue => /Copper Wisp.*stat block/i.test(issue.msg)));
  assert.match(context.buildSpellFields(spell, 'spell-0'), /data-field="statBlock"/);
  spell.statBlock = 'Hit: 1d6 damage. <script>unsafe</script>';
  runInApp(context, `extractedData = { spell: ${JSON.stringify([spell])} };`);
  const xml = context.window.AuroraXMLHelper.generateXml();
  assert.ok(xml.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!xml.includes('<script>'));
});


test('split cantrip headings and duration labels recover complete OCR spell metadata', () => {
  const { context } = loadApp();
  const text = ['Copper Blade', 'Evocation ca ntrip', 'Casting Time: 1 action', 'Range: 5 f eet',
    'Components: V, S', 'Duratio n: Instantan eo us', 'A harmless copper flash appears.'].join('\n');
  const [spell] = context.parseSpellsFromText(text);
  assert.equal(spell.name, 'Copper Blade');
  assert.equal(spell.level, 0);
  assert.equal(spell.range, '5 feet');
  assert.equal(spell.duration, 'Instantaneous');
  assert.equal(spell.description, 'A harmless copper flash appears.');
  assert.equal(context.parseSpellKind('You gain a ca ntrip.'), null, 'Prose must not become a spell heading.');
});
