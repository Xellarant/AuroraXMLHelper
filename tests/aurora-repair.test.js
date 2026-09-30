const assert = require('node:assert/strict');
const { analyzeAuroraXmlDocuments } = require('../src/aurora-xml-patterns');
const { applyRepairs, diffLines, verifyRepairedXml } = require('../src/aurora-xml-repair');

const brokenXml = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <info>
    <name>Repair Fixture</name>
    <update version="0.1.0">
      <file name="fixture.xml" url="fixture.xml" />
    </update>
  </info>
  <element name="Fire Needle" type="Spell" source="Repair Fixture" id="ID_FIXTURE_SPELL_FIRE_NEEDLE">
    <supports>Wizard, 1</supports>
    <setters>
      <set name="level">1</set>
    </setters>
  </element>
  <element name="Resistant Scale" type="Racial Trait" source="Repair Fixture" id="ID_FIXTURE_RACIAL_TRAIT_RESISTANT_SCALE">
    <rules>
      <grant type="Condition Immunity" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" />
      <select type="Feat" />
    </rules>
  </element>
  <element name="Broken Class" type="Class" source="Repair Fixture" id="ID_FIXTURE_CLASS_BROKEN">
    <description><p>No hit die.</p></description>
  </element>
  <element name="Setter Class" type="Class" source="Repair Fixture" id="ID_FIXTURE_CLASS_SETTER">
    <setters>
      <set name="short">Setter</set>
    </setters>
  </element>
  <element name="Duplicate" type="Feat" source="Repair Fixture" id="ID_FIXTURE_FEAT_DUPLICATE" />
  <element name="Duplicate Again" type="Feat" source="Repair Fixture" id="ID_FIXTURE_FEAT_DUPLICATE" />
</elements>`;

function analyze(xml = brokenXml) {
  const docs = [{ fileName: 'fixture.xml', xml }];
  return { docs, analysis: analyzeAuroraXmlDocuments(docs) };
}

function repairsFor(analysis, category) {
  return analysis.diagnostics
    .filter(finding => finding.category === category)
    .flatMap(finding => finding.repairs);
}

test('every repair record gets a stable id and an anchor into the source text', () => {
  const { analysis } = analyze();
  const repairs = analysis.diagnostics.flatMap(finding => finding.repairs);
  assert.ok(repairs.length > 0);
  assert.equal(new Set(repairs.map(item => item.id)).size, repairs.length);
  for (const item of repairs) {
    assert.ok(item.anchor, `${item.kind} should have an anchor`);
    assert.equal(brokenXml.slice(item.anchor.start, item.anchor.end), item.anchor.text);
  }
});

test('high-confidence repairs apply and resolve their findings', () => {
  const { docs, analysis } = analyze();
  const repairs = analysis.diagnostics
    .flatMap(finding => finding.repairs)
    .filter(item => item.confidence === 'high');
  const result = applyRepairs(docs, repairs);

  assert.equal(result.skipped.length, 0);
  assert.equal(result.docs[0].changed, true);
  const xml = result.docs[0].xml;
  assert.match(xml, /<supports>Wizard<\/supports>/);
  assert.match(xml, /<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" \/>/);
  assert.match(xml, /<select type="Feat" supports="feat" \/>/);

  const verify = verifyRepairedXml(docs, result.docs, { beforeAnalysis: analysis });
  const resolvedCategories = verify.resolved.map(finding => finding.category).sort();
  assert.deepEqual(resolvedCategories, ['damage-resistance-grant-type', 'spell-supports-level-token']);
  assert.equal(verify.introduced.length, 0);
});

test('several repairs on the same rule tag compose into one edit', () => {
  const { docs, analysis } = analyze();
  const repairs = repairsFor(analysis, 'select-missing-required-attribute');
  const nameRepair = repairs.find(item => item.attribute === 'name');
  const result = applyRepairs(docs, repairs, { values: { [nameRepair.id]: 'Bonus Feat' } });

  assert.equal(result.applied.length, 2);
  assert.match(result.docs[0].xml, /<select type="Feat" name="Bonus Feat" supports="feat" \/>/);
  const verify = verifyRepairedXml(docs, result.docs, { beforeAnalysis: analysis });
  assert.ok(verify.resolved.some(finding => finding.category === 'select-missing-required-attribute'));
});

test('manual repairs without a value are skipped instead of guessed', () => {
  const { docs, analysis } = analyze();
  const repairs = repairsFor(analysis, 'class-missing-hit-die');
  const result = applyRepairs(docs, repairs);
  assert.equal(result.applied.length, 0);
  assert.match(result.skipped[0].reason, /Enter a value/);
  assert.equal(result.docs[0].changed, false);
});

test('insert-setter creates or extends the setters block with matching indentation', () => {
  const { docs, analysis } = analyze();
  const repairs = repairsFor(analysis, 'class-missing-hit-die');
  const values = Object.fromEntries(repairs.map(item => [item.id, 'd10']));
  const result = applyRepairs(docs, repairs, { values });
  const xml = result.docs[0].xml;

  assert.equal(result.applied.length, 2);
  assert.match(xml, /id="ID_FIXTURE_CLASS_BROKEN">\n    <setters>\n      <set name="hd">d10<\/set>\n    <\/setters>\n    <description>/);
  assert.match(xml, /<setters>\n      <set name="hd">d10<\/set>\n      <set name="short">Setter<\/set>/);
  const verify = verifyRepairedXml(docs, result.docs, { beforeAnalysis: analysis });
  assert.equal(verify.resolved.filter(finding => finding.category === 'class-missing-hit-die').length, 2);
});

test('duplicate element ids can be regenerated with a user value', () => {
  const { docs, analysis } = analyze();
  const [regen] = repairsFor(analysis, 'duplicate-element-id');
  const result = applyRepairs(docs, [regen], { values: { [regen.id]: 'ID_FIXTURE_FEAT_DUPLICATE_AGAIN' } });
  assert.match(result.docs[0].xml, /name="Duplicate Again" type="Feat" source="Repair Fixture" id="ID_FIXTURE_FEAT_DUPLICATE_AGAIN"/);
  const verify = verifyRepairedXml(docs, result.docs, { beforeAnalysis: analysis });
  assert.ok(verify.resolved.some(finding => finding.category === 'duplicate-element-id'));
});

test('stale anchors are skipped when the document changed after inspection', () => {
  const { analysis } = analyze();
  const repairs = repairsFor(analysis, 'spell-supports-level-token');
  const edited = [{ fileName: 'fixture.xml', xml: brokenXml.replace('<supports>Wizard, 1</supports>', '<supports>Wizard, 2</supports>') }];
  const result = applyRepairs(edited, repairs);
  assert.equal(result.applied.length, 0);
  assert.match(result.skipped[0].reason, /changed since it was inspected/);
});

test('repairs without anchors or with manual-only kinds are reported as skipped', () => {
  const fragment = '<element name="Loose" type="Feat" source="X" id="ID_X_FEAT_LOOSE" />';
  const docs = [{ fileName: 'fragment.xml', xml: fragment }];
  const analysis = analyzeAuroraXmlDocuments(docs);
  const repairs = repairsFor(analysis, 'root-shape');
  const result = applyRepairs(docs, repairs);
  assert.equal(result.applied.length, 0);
  assert.match(result.skipped[0].reason, /manual edit/);
});

test('diffLines returns compact hunks around changed lines', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
  const hunks = diffLines(before, after, { context: 1 });
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].map(row => `${row.op}${row.line}`), [' c', '-d', '+D', ' e']);
});
