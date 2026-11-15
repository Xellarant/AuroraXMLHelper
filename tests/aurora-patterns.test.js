const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  analyzeAuroraXmlDocuments,
  applyRepairToXml,
  buildAuthoringProfiles,
  parseAuroraElements,
  renderPatternReport,
  summarizePatternCatalog
} = require('../src/aurora-xml-patterns');
const { elementRanges, xmlMarkupText, setTagAttribute, attrMap } = require('../src/aurora-xml-patterns');
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
  assert.match(finding('damage-resistance-grant-type').node.xml, /<grant type="Condition Immunity"/);
  assert.match(finding('damage-resistance-grant-type').repairs[0].sample, /type="Condition"/);
  assert.equal(finding('spell-supports-level-token').repairs[0].replacementValue, 'Wizard');
  assert.match(finding('spell-supports-level-token').node.xml, /<supports>Wizard, 1<\/supports>/);
  assert.match(finding('spell-supports-level-token').repairs[0].sample, /<supports>Wizard<\/supports>/);
  assert.equal(finding('class-missing-hit-die').repairs[0].snippet, '<set name="hd">d8</set>');
  assert.match(finding('class-missing-hit-die').repairs[0].sample, /<setters>/);
  assert.equal(finding('duplicate-element-id').repairs[0].kind, 'regenerate-element-id');
  assert.ok(finding('select-missing-required-attribute').repairs.some(repair => repair.attribute === 'supports'));
  assert.match(finding('select-missing-required-attribute').node.xml, /<select type="Proficiency" name="Skill" \/>/);
  assert.match(finding('select-missing-required-attribute').repairs.find(repair => repair.attribute === 'supports').sample, /supports="SUPPORT TOKEN"/);
});

test('Aurora XML diagnostics preserve valid unfiltered Feat and Language choices', () => {
  const xml = `<elements>
  <element name="Ability Score Improvement" type="Class Feature" source="Pattern Fixture" id="ID_FIXTURE_CLASS_FEATURE_ASI">
    <rules>
      <select type="Feat" name="Feat (Artificer)" level="4" />
      <select type="Language" name="Language (Favored Enemy)" level="1" />
    </rules>
  </element>
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'feat-select.xml', xml }]);
  assert.equal(analysis.diagnostics.some(item => item.category === 'select-missing-required-attribute'), false);
});

test('Aurora XML diagnostics include observed candidates for ambiguous select supports', () => {
  const xml = `<elements>
  <element name="Known Skills" type="Class Feature" source="Pattern Fixture" id="ID_FIXTURE_CLASS_FEATURE_KNOWN_SKILLS">
    <rules>
      <select type="Proficiency" name="Skill A" supports="Skill" />
      <select type="Proficiency" name="Skill B" supports="Skill" />
      <select type="Proficiency" name="Skill C" supports="Skill" />
      <select type="Proficiency" name="Language A" supports="Language" />
      <select type="Proficiency" name="Language B" supports="Language" />
      <select type="Proficiency" name="Tool A" supports="Tool" />
      <select type="Proficiency" name="Tool B" supports="Tool" />
      <select type="Proficiency" name="Armor A" supports="Armor" />
      <select type="Proficiency" name="Missing Support" />
    </rules>
  </element>
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'proficiency-select.xml', xml }]);
  const finding = analysis.diagnostics.find(item => item.category === 'select-missing-required-attribute');
  const repair = finding.repairs.find(item => item.attribute === 'supports');

  assert.equal(repair.valuePlaceholder, 'SUPPORT TOKEN');
  assert.deepEqual(
    repair.candidateValues.map(candidate => [candidate.value, candidate.count]),
    [['Skill', 3], ['Language', 2], ['Tool', 2]]
  );
  assert.equal(repair.candidateValues[0].reason, 'observed on select type="Proficiency"');
  assert.match(repair.sample, /supports="SUPPORT TOKEN"/);
});

test('Aurora XML repair applies a selected rule attribute to its exact source node', () => {
  const xml = `<elements>
  <element name="Repair Fixture" type="Class Feature" source="Pattern Fixture" id="ID_FIXTURE_CLASS_FEATURE_REPAIR">
    <rules>
      <select type="Spell" name="Choose a spell" />
      <grant type="Spell" />
    </rules>
  </element>
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'repair.xml', xml }]);
  const selectFinding = analysis.diagnostics.find(item => item.category === 'select-missing-required-attribute');
  const selectRepair = selectFinding.repairs.find(item => item.attribute === 'supports');
  const selected = applyRepairToXml(xml, selectFinding, selectRepair, 'Wizard');

  assert.ok(selected);
  assert.match(selected.xml, /<select type="Spell" name="Choose a spell" supports="Wizard" \/>/);

  const updatedAnalysis = analyzeAuroraXmlDocuments([{ fileName: 'repair.xml', xml: selected.xml }]);
  const grantFinding = updatedAnalysis.diagnostics.find(item => item.category === 'grant-missing-required-attribute');
  const grantRepair = grantFinding.repairs.find(item => item.attribute === 'id');
  const completed = applyRepairToXml(selected.xml, grantFinding, grantRepair, 'ID_FIXTURE_SPELL_TARGET');

  assert.ok(completed);
  assert.match(completed.xml, /<grant type="Spell" id="ID_FIXTURE_SPELL_TARGET" \/>/);
  assert.equal(analyzeAuroraXmlDocuments([{ fileName: 'repair.xml', xml: completed.xml }]).diagnostics.length, 0);
});

test('Aurora XML repair replaces an empty single-quoted attribute without duplicating it', () => {
  const xml = `<elements>
  <element name="Quoted Repair Fixture" type="Class Feature" source="Pattern Fixture" id="ID_FIXTURE_QUOTED_REPAIR">
    <rules>
      <select type='Spell' name='Choose a spell' supports='' />
    </rules>
  </element>
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'quoted-repair.xml', xml }]);
  const finding = analysis.diagnostics.find(item => item.category === 'select-missing-required-attribute');
  const repair = finding?.repairs.find(item => item.attribute === 'supports');

  assert.ok(repair);
  const applied = applyRepairToXml(xml, finding, repair, '$& Wizard');

  assert.ok(applied);
  assert.match(applied.xml, /<select type='Spell' name='Choose a spell' supports="\$&amp; Wizard" \/>/);
  assert.equal([...applied.xml.matchAll(/\bsupports\s*=/g)].length, 1);
  assert.equal(analyzeAuroraXmlDocuments([{ fileName: 'quoted-repair.xml', xml: applied.xml }]).diagnostics.length, 0);
});

test('Aurora XML diagnostics require an actual elements root before suppressing root repair', () => {
  const fragmentXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- TODO: wrap this fragment in <elements>. -->
<element name="Loose Spell" type="Spell" source="Pattern Fixture" id="ID_FIXTURE_SPELL_LOOSE" />`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'fragment.xml', xml: fragmentXml }]);
  const rootFinding = analysis.diagnostics.find(finding => finding.category === 'root-shape');

  assert.equal(rootFinding.severity, 'error');
  assert.equal(rootFinding.repairs[0].kind, 'wrap-document-root');
  assert.equal(rootFinding.repairs[0].target.fileName, 'fragment.xml');
});

test('Aurora XML diagnostics accept elements roots after internal doctype subsets', () => {
  const doctypeXml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE elements [
  <!ELEMENT elements (info?, element*)>
  <!ELEMENT element ANY>
]>
<elements>
  <element name="Doctype Spell" type="Spell" source="Pattern Fixture" id="ID_FIXTURE_SPELL_DOCTYPE" />
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'doctype.xml', xml: doctypeXml }]);

  assert.equal(analysis.diagnostics.some(finding => finding.category === 'root-shape'), false);
});

test('Aurora XML diagnostics ignore markup delimiters in internal doctype comments', () => {
  const doctypeXml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE elements [
  <!-- literal ] and > characters here are comment text -->
  <?pattern literal ] and > characters here are processing instruction text?>
  <!ELEMENT elements (info?, element*)>
  <!ELEMENT element ANY>
]>
<elements>
  <element name="Doctype Comment Spell" type="Spell" source="Pattern Fixture" id="ID_FIXTURE_SPELL_DOCTYPE_COMMENT" />
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'doctype-comment.xml', xml: doctypeXml }]);

  assert.equal(analysis.diagnostics.some(finding => finding.category === 'root-shape'), false);
});

test('Aurora XML diagnostics include repair targets for missing element attributes', () => {
  const brokenXml = `<elements>
  <element source="Pattern Fixture" />
</elements>`;
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'missing-attributes.xml', xml: brokenXml }]);
  const findings = analysis.diagnostics.filter(finding => finding.category === 'missing-element-attribute');
  const byAttribute = Object.fromEntries(findings.map(finding => [finding.repairs[0].attribute, finding]));

  assert.deepEqual(Object.keys(byAttribute).sort(), ['id', 'name', 'type']);
  assert.equal(byAttribute.id.repairs[0].kind, 'set-element-attribute');
  assert.equal(byAttribute.id.repairs[0].valuePlaceholder, 'ID_SOURCE_TYPE_NAME');
  assert.equal(byAttribute.name.repairs[0].target.fileName, 'missing-attributes.xml');
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
  try {
    const xmlPath = path.join(tempRoot, 'fixture.xml');
    fs.writeFileSync(xmlPath, sampleXml, 'utf8');
    const args = parseArgs(['--xml', tempRoot, '--top', '3', '--json']);
    const docs = readDocuments(args.xml);
    assert.equal(args.top, 3);
    assert.equal(args.json, true);
    assert.deepEqual(docs.map(doc => path.basename(doc.fileName)), ['fixture.xml']);
    assert.throws(() => parseArgs(['--xml', tempRoot, '--top', '0']), /--top must be a positive integer/);
  } finally {
    assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('inactive XML examples cannot become repair targets or catalogue definitions', () => {
  const xml = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE elements [<!ENTITY example \'<element name="DTD Example" />\'>]>',
    '<elements>',
    '<!-- <element name="Comment" type="Class" source="X" id="ID_COMMENT"><rules><grant /></rules></element> -->',
    '<element name="Real > Example" type="Class Feature" source="X" id="ID_REAL">',
    '<description><![CDATA[Literal <element name="CDATA example" /> & details.]]></description>',
    '<rules><!-- <grant type="Not A Type" /> --><grant type="Spell" id="ID_SPELL" /></rules>',
    '</element></elements>'
  ].join('\n');
  const elements = parseAuroraElements(xml);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].name, 'Real > Example');
  assert.equal(elements[0].description, 'Literal <element name="CDATA example" /> & details.');
  assert.equal(elements[0].ruleRecords.length, 1);
  assert.equal(elements[0].ruleRecords[0].attrs.id, 'ID_SPELL');
  assert.equal(elements[0].openTagRange.text, xml.slice(elements[0].openTagRange.start, elements[0].openTagRange.end));
  const ranges = elementRanges(xml);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, xml.indexOf('<element name="Real'));
  assert.equal(ranges[0].xml, xml.slice(ranges[0].start, ranges[0].end));
  const masked = xmlMarkupText(xml);
  assert.equal(masked.length, xml.length);
  assert.equal(masked.split('\n').length, xml.split('\n').length);
  assert.ok(!masked.includes('CDATA example') && !masked.includes('DTD Example') && !masked.includes('Not A Type'));
});

test('attribute repairs do not alter lookalike attribute text inside quoted values or interpret dollar substitutions', () => {
  const tag = '<select note=" name=\'Leave this alone\' > quoted" type="Feat" name="Old" />';
  const changed = setTagAttribute(tag, 'name', '$1 $& "$2"');
  assert.match(changed, /note=" name='Leave this alone' > quoted"/);
  assert.equal(attrMap(changed).name, '$1 $& "$2"');
  const added = setTagAttribute('<select type="Feat" />', 'name', '$1 $& $2');
  assert.equal(attrMap(added).name, '$1 $& $2');
  assert.equal(attrMap(setTagAttribute(tag, 'number', 0)).number, '0');
});

test('repairing a long rule retains the complete source and quote-aware attribute boundary', () => {
  const detail = 'Long text '.repeat(160);
  const xml = '<elements><element name="Long rule" type="Class Feature" source="X" id="ID_LONG"><rules>'
    + '<select name="A > B ' + detail + '" type="Spell" /></rules></element></elements>';
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'long.xml', xml }]);
  const finding = analysis.diagnostics.find(finding => finding.category === 'select-missing-required-attribute');
  const repair = finding.repairs.find(repair => repair.attribute === 'supports');
  const result = applyRepairToXml(xml, finding, repair, 'Wizard');
  assert.ok(result);
  assert.ok(result.xml.includes(detail));
  assert.ok(result.xml.endsWith('</rules></element></elements>'));
  assert.doesNotMatch(result.xml, /\n\.\.\./);
  assert.equal(parseAuroraElements(result.xml)[0].ruleRecords[0].attrs.supports, 'Wizard');
});

test('repair metadata ignores commented info nodes and accepts a valid index root', () => {
  const xml = '<index><!-- <info><n>Do not rename</n></info> --><info><name>Collection</name>'
    + '<update version="1"><file name="x.index" url="x.index" /></update></info><files /></index>';
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'x.index', xml }]);
  assert.ok(!analysis.diagnostics.some(finding => ['root-shape', 'info-uses-n-tag', 'missing-info-update'].includes(finding.category)));
});

test('fuzzy setter renames are withheld when the correct setter already has a value', () => {
  const reference = {
    types: ['Spell'],
    ids: {},
    typeCounts: { Spell: 20 }, setterNamesByType: { Spell: { range: 20 } }
  };
  const xml = '<elements><element name="Conflict" type="Spell" source="X" id="ID_CONFLICT"><setters>'
    + '<set name="rang">60 feet</set><set name="range">30 feet</set></setters></element></elements>';
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'conflict.xml', xml }], { reference });
  const conflict = analysis.diagnostics.find(finding => finding.category === 'setter-name-conflict');
  assert.ok(conflict);
  assert.equal(conflict.repairs[0].confidence, 'manual');
  assert.equal(conflict.repairs[0].kind, 'resolve-setter-conflict');
  assert.ok(!analysis.diagnostics.flatMap(finding => finding.repairs).some(repair => repair.kind === 'rename-setter'));
});
