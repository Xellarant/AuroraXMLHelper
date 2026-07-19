const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  analyzeAuroraXmlDocuments,
  buildAuthoringProfiles,
  parseAuroraElements,
  renderPatternReport,
  summarizePatternCatalog
} = require('../src/aurora-xml-patterns');
const { parseArgs, readDocuments } = require('../scripts/aurora-pattern-report');

const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <info>
    <name>Pattern Fixture</name>
    <update version="0.1.0">
      <file name="fixture.xml" url="fixture.xml" />
    </update>
  </info>
  <!-- Avoid placeholder ID_FAKE_COMMENT in comments. -->
  <element name="Fire Needle" type="Spell" source="Pattern Fixture" id="ID_FIXTURE_SPELL_FIRE_NEEDLE">
    <supports>Wizard, 1</supports>
    <setters>
      <set name="level">1</set>
      <set name="school">Evocation</set>
    </setters>
    <rules>
      <grant type="Spell" id="ID_FIXTURE_SPELL_FIRE_NEEDLE" />
      <select type="Spell" name="Prepared Spell" supports="Wizard" />
    </rules>
  </element>
  <element name="Resistant Scale" type="Racial Trait" source="Pattern Fixture" id="ID_FIXTURE_RACIAL_TRAIT_RESISTANT_SCALE">
    <rules>
      <grant type="Condition Immunity" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" />
      <stat name="resistant:scale" />
    </rules>
  </element>
  <element name="Broken Class" type="Class" source="Pattern Fixture" id="ID_FIXTURE_CLASS_BROKEN">
    <rules>
      <select type="Proficiency" name="Skill" />
      <grant type="Proficiency" />
    </rules>
  </element>
  <element name="Duplicate" type="Feat" source="Pattern Fixture" id="ID_FIXTURE_FEAT_DUPLICATE" />
  <element name="Duplicate Again" type="Feat" source="Pattern Fixture" id="ID_FIXTURE_FEAT_DUPLICATE" />
</elements>`;

test('Aurora XML pattern parser keeps benchmark-compatible element shape', () => {
  const elements = parseAuroraElements(sampleXml, 'fixture.xml');
  const spell = elements.find(element => element.name === 'Fire Needle');
  const duplicate = elements.find(element => element.name === 'Duplicate');

  assert.equal(elements.length, 5);
  assert.equal(spell.type, 'Spell');
  assert.equal(spell.key, 'spell::fire needle');
  assert.deepEqual(spell.setters, { level: '1', school: 'Evocation' });
  assert.deepEqual(spell.rules, [
    'grant|id=ID_FIXTURE_SPELL_FIRE_NEEDLE|type=Spell',
    'select|name=Prepared Spell|supports=Wizard|type=Spell'
  ]);
  assert.equal(duplicate.rules.length, 0);
});

test('Aurora XML pattern catalog summarizes observed shape buckets', () => {
  const elements = parseAuroraElements(sampleXml, 'fixture.xml');
  const catalog = summarizePatternCatalog(elements);

  assert.equal(catalog.totalElements, 5);
  assert.equal(catalog.types.Spell.count, 1);
  assert.equal(catalog.types.Spell.setterNames.level, 1);
  assert.equal(catalog.types.Spell.supportTokens.Wizard, 1);
  assert.equal(catalog.types.Spell.ruleKinds.grant, 1);
  assert.equal(catalog.types['Racial Trait'].grantTypes['Condition Immunity'], 1);
  assert.equal(catalog.types.Feat.emptyRules, 2);
});

test('Aurora XML authoring profiles derive practical type hints', () => {
  const elements = parseAuroraElements(sampleXml, 'fixture.xml');
  const profiles = buildAuthoringProfiles(elements);
  const spell = profiles.find(profile => profile.type === 'Spell');
  const klass = profiles.find(profile => profile.type === 'Class');

  assert.equal(spell.count, 1);
  assert.equal(spell.confidence, 'low');
  assert.deepEqual(spell.requiredAttributes, ['name', 'type', 'source', 'id']);
  assert.deepEqual(spell.requiredSetters.map(row => row.name), ['level', 'school']);
  assert.ok(spell.hints.some(hint => hint.category === 'spell-metadata'));
  assert.ok(spell.hints.some(hint => hint.category === 'supports'));
  assert.ok(klass.hints.some(hint => hint.category === 'class-shape'));
});

test('Aurora XML diagnostics flag initial repair issues', () => {
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'fixture.xml', xml: sampleXml }]);
  const categories = analysis.diagnostics.map(finding => finding.category);
  const finding = category => analysis.diagnostics.find(item => item.category === category);

  assert.ok(analysis.authoringProfiles.some(profile => profile.type === 'Spell'));
  assert.ok(categories.includes('duplicate-element-id'));
  assert.ok(categories.includes('damage-resistance-grant-type'));
  assert.ok(categories.includes('spell-supports-level-token'));
  assert.ok(categories.includes('class-missing-hit-die'));
  assert.ok(categories.includes('select-missing-required-attribute'));
  assert.ok(categories.includes('grant-missing-required-attribute'));
  assert.ok(categories.includes('stat-missing-required-attribute'));
  assert.ok(categories.includes('id-like-comment'));
  assert.equal(analysis.diagnostics.filter(finding => finding.severity === 'error').length, 4);
  assert.equal(finding('damage-resistance-grant-type').repairs[0].kind, 'set-rule-attribute');
  assert.equal(finding('damage-resistance-grant-type').repairs[0].replacementValue, 'Condition');
  assert.equal(finding('spell-supports-level-token').repairs[0].replacementValue, 'Wizard');
  assert.equal(finding('class-missing-hit-die').repairs[0].snippet, '<set name="hd">d8</set>');
  assert.equal(finding('duplicate-element-id').repairs[0].kind, 'regenerate-element-id');
  assert.ok(finding('select-missing-required-attribute').repairs.some(repair => repair.attribute === 'supports'));
});

test('Aurora XML pattern report renders summary and diagnostics', () => {
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'fixture.xml', xml: sampleXml }]);
  const report = renderPatternReport(analysis);

  assert.match(report, /# Aurora XML Pattern Report/);
  assert.match(report, /### Spell/);
  assert.match(report, /## Authoring Profiles/);
  assert.match(report, /spell-metadata: Spell level belongs/);
  assert.match(report, /spell-supports-level-token/);
  assert.match(report, /damage-resistance-grant-type/);
  assert.match(report, /Repair: set-rule-attribute \(high\) -> Condition/);
  assert.match(report, /Repair: replace-supports-text \(high\) -> Wizard/);
});

test('Aurora pattern CLI reads XML paths and validates arguments', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pattern-report-'));
  const xmlPath = path.join(tempRoot, 'fixture.xml');
  fs.writeFileSync(xmlPath, sampleXml, 'utf8');

  const args = parseArgs(['--xml', tempRoot, '--top', '3', '--json']);
  const docs = readDocuments(args.xml);

  assert.equal(args.top, 3);
  assert.equal(args.json, true);
  assert.deepEqual(docs.map(doc => path.basename(doc.fileName)), ['fixture.xml']);
  assert.throws(() => parseArgs(['--xml', tempRoot, '--top', '0']), /--top must be a positive integer/);
});
