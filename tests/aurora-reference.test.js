const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  analyzeAuroraXmlDocuments,
  buildReferenceIndex,
  closestNames,
  editDistance
} = require('../src/aurora-xml-patterns');
const { applyRepairs, verifyRepairedXml } = require('../src/aurora-xml-repair');
const { loadReferenceIndex, renderReferenceIndexScript } = require('../scripts/aurora-pattern-report');

function spell(abbr, name, extra = '') {
  const id = `ID_${abbr}_SPELL_${name.toUpperCase().replace(/\s+/g, '_')}`;
  return `<element name="${name}" type="Spell" source="${abbr}" id="${id}">
    <description><p>Prose that must not reach the index.</p></description>
    <setters><set name="level">1</set><set name="school">Evocation</set>${extra}</setters>
  </element>`;
}

// Synthetic stand-in for first-party content: 10+ spells so setter profiles are trusted.
const firstPartyXml = `<elements>
  <info><name>First Party</name><update version="1"><file name="fp.xml" url="fp.xml" /></update></info>
  ${['Fire Bolt', 'Cause Fear', 'Magic Missile', 'Shield', 'Sleep', 'Thunderwave', 'Burning Hands', 'Grease', 'Jump', 'Longstrider']
    .map(name => spell(name === 'Cause Fear' ? 'XGTE' : 'PHB', name)).join('\n')}
  <element name="Darkvision" type="Racial Trait" source="PHB" id="ID_PHB_RACIAL_TRAIT_DARKVISION" />
  <element name="Stealth" type="Proficiency" source="PHB" id="ID_PROFICIENCY_SKILL_STEALTH" />
  <element name="Elf" type="Race" source="PHB" id="ID_PHB_RACE_ELF">
    <rules>
      <grant type="Racial Trait" id="ID_PHB_RACIAL_TRAIT_DARKVISION" />
      <grant type="Size" id="ID_SIZE_MEDIUM" />
      <grant type="Proficiency" id="ID_PROFICIENCY_SKILL_STEALTH" />
      <grant type="Spell" id="ID_PHB_SPELL_FIRE_BOLT" />
      <select type="Feat" name="Feat" supports="Feat" />
      <stat name="speed" value="30" />
      <stat name="innate speed:fly" value="30" />
    </rules>
  </element>
</elements>`;

const reference = buildReferenceIndex([{ fileName: 'fp.xml', xml: firstPartyXml }], { generatedAt: 'fixed' });

const homebrewXml = `<elements>
  <info><n>Homebrew</n></info>
  <element name="Star Elf" type="Race" source="HB" id="ID_HB_RACE_STAR_ELF">
    <rules>
      <grant type="Racial Traid" id="ID_PHB_RACIAL_TRAIT_DARKVISION" />
      <grant type="Spell" id="ID_PHB_SPELL_CAUSE_FEAR" />
      <grant type="Spell" id="ID_PHB_SPELL_FIRE_BLOT" />
      <grant type="Proficiency" id="ID_HB_UNKNOWN_THING" />
      <grant type="Spell" id="ID_PHB_RACIAL_TRAIT_DARKVISION" />
      <grant type="Size" id="ID_SIZE_MEDIUM" />
      <select type="Feet" name="Feat" supports="Feat" />
      <stat name="innate sped:fly" value="5" />
      <stat name="custom:points" value="2" />
    </rules>
  </element>
  <element name="Starlight" type="Spell" source="HB" id="ID_HB_SPELL_STARLIGHT">
    <setters><set name="levle">2</set></setters>
  </element>
</elements>`;

function analyzeHomebrew() {
  const docs = [{ fileName: 'homebrew.xml', xml: homebrewXml }];
  return { docs, analysis: analyzeAuroraXmlDocuments(docs, { reference }) };
}

function findingsFor(analysis, category) {
  return analysis.diagnostics.filter(finding => finding.category === category);
}

test('reference index keeps ids, types, and shape counts but no prose', () => {
  assert.equal(reference.types[reference.ids.ID_PHB_SPELL_FIRE_BOLT[0]], 'Spell');
  assert.equal(reference.ids.ID_PHB_SPELL_FIRE_BOLT[1], 'Fire Bolt');
  assert.deepEqual(reference.builtinIds, ['ID_SIZE_MEDIUM']);
  assert.equal(reference.grantTypes['Racial Trait'], 1);
  assert.equal(reference.setterNamesByType.Spell.level, 10);
  assert.ok(!JSON.stringify(reference).includes('Prose that must not reach the index'));
});

test('reference index script round-trips through require', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-reference-'));
  const file = path.join(tempRoot, 'index.js');
  fs.writeFileSync(file, renderReferenceIndexScript(reference));
  assert.deepEqual(loadReferenceIndex(file).ids, reference.ids);
});

test('without a reference index, reference checks stay silent', () => {
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'homebrew.xml', xml: homebrewXml }]);
  assert.equal(findingsFor(analysis, 'unresolved-id-reference').length, 0);
  assert.equal(findingsFor(analysis, 'unknown-grant-type').length, 0);
  assert.equal(findingsFor(analysis, 'info-uses-n-tag').length, 1);
});

test('first-party content is clean against its own index', () => {
  const analysis = analyzeAuroraXmlDocuments([{ fileName: 'fp.xml', xml: firstPartyXml }], { reference });
  const categories = new Set(analysis.diagnostics.map(finding => finding.category));
  for (const category of ['unresolved-id-reference', 'unknown-grant-type', 'unknown-select-type', 'grant-type-mismatch', 'unexpected-setter', 'unknown-stat-name']) {
    assert.ok(!categories.has(category), `${category} should not fire on first-party content`);
  }
});

test('typo grant types are fixed from the granted element type', () => {
  const { analysis } = analyzeHomebrew();
  const [finding] = findingsFor(analysis, 'unknown-grant-type');
  assert.equal(finding.repairs[0].replacementValue, 'Racial Trait');
  assert.equal(finding.repairs[0].confidence, 'high');
  assert.match(finding.repairs[0].inferenceReason, /Racial Trait element/);
  assert.ok(!findingsFor(analysis, 'grant-type-mismatch').some(item => /Racial Traid/.test(item.message)));
});

test('unresolved ids suggest same-name ids under another source prefix and close spellings', () => {
  const { analysis } = analyzeHomebrew();
  const byId = Object.fromEntries(findingsFor(analysis, 'unresolved-id-reference').map(finding => [finding.repairs[0].currentValue, finding.repairs[0]]));
  assert.equal(byId.ID_PHB_SPELL_CAUSE_FEAR.replacementValue, 'ID_XGTE_SPELL_CAUSE_FEAR');
  assert.equal(byId.ID_PHB_SPELL_CAUSE_FEAR.confidence, 'high');
  assert.equal(byId.ID_PHB_SPELL_FIRE_BLOT.replacementValue, 'ID_PHB_SPELL_FIRE_BOLT');
  assert.equal(byId.ID_HB_UNKNOWN_THING.confidence, 'manual');
  assert.ok(!byId.ID_SIZE_MEDIUM, 'built-in ids are known');
});

test('grant type mismatches, unknown select types, stat typos, and setter typos are reported', () => {
  const { analysis } = analyzeHomebrew();
  const mismatch = findingsFor(analysis, 'grant-type-mismatch')[0];
  assert.equal(mismatch.repairs[0].replacementValue, 'Racial Trait');
  assert.equal(mismatch.repairs[0].confidence, 'medium');
  assert.equal(findingsFor(analysis, 'unknown-select-type')[0].repairs[0].replacementValue, 'Feat');
  const stats = findingsFor(analysis, 'unknown-stat-name');
  assert.equal(stats.length, 1);
  assert.equal(stats[0].repairs[0].candidateValues[0].value, 'innate speed:fly');
  const setter = findingsFor(analysis, 'unexpected-setter')[0];
  assert.equal(setter.repairs[0].replacementValue, 'level');
  const missingSetters = findingsFor(analysis, 'missing-common-setter').map(finding => finding.message);
  assert.ok(missingSetters.some(message => /'school'/.test(message)));
  assert.ok(!missingSetters.some(message => /'level'/.test(message)), 'the levle rename already covers level');
  assert.equal(findingsFor(analysis, 'info-uses-n-tag').length, 1);
  assert.equal(findingsFor(analysis, 'missing-info-update').length, 1);
});

test('high-confidence reference repairs apply cleanly and verify', () => {
  const { docs, analysis } = analyzeHomebrew();
  const repairs = analysis.diagnostics.flatMap(finding => finding.repairs).filter(item => item.confidence === 'high');
  const result = applyRepairs(docs, repairs);
  const xml = result.docs[0].xml;
  assert.match(xml, /<info><name>Homebrew<\/name><\/info>/);
  assert.match(xml, /<grant type="Racial Trait" id="ID_PHB_RACIAL_TRAIT_DARKVISION" \/>/);
  assert.match(xml, /id="ID_XGTE_SPELL_CAUSE_FEAR"/);
  assert.match(xml, /id="ID_PHB_SPELL_FIRE_BOLT"/);
  assert.match(xml, /<select type="Feat" name="Feat"/);
  assert.match(xml, /<set name="level">2<\/set>/);
  const verify = verifyRepairedXml(docs, result.docs, { beforeAnalysis: analysis, analysisOptions: { reference } });
  assert.equal(verify.introduced.length, 0);
  assert.ok(verify.resolved.length >= 6);
});

test('closestNames and editDistance respect the distance budget', () => {
  assert.equal(editDistance('Proficency', 'Proficiency'), 1);
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3);
  assert.deepEqual(closestNames('Grants', ['Feat', 'Spell'], { maxDistance: 1 }), []);
});
