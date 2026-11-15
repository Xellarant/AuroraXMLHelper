const assert = require('node:assert/strict');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const progression = require('../src/class-progression');
const availability = require('../src/spell-availability');
const review = require('../src/source-review');

function app() {
  return loadApp({ name: 'Feature Audit', abbr: 'AUD', year: '2014' }, { referenceIndex: true });
}
function spell(name, level = 1) {
  return { name, level, classes: [], description: 'Original synthetic spell.' };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('repeated class choices ignore unrelated spell levels and honor the table acquisition level', () => {
  const feature = { name: 'Grand Hex', level: 11, description: 'At 11th level you learn one grand hex, and another at 13th, 15th, and 18th level. A grand hex can reproduce a 9th-level spell.' };
  assert.deepEqual(progression.featureLevels({ features: [feature] }, feature), [11, 13, 15, 18]);
  const cls = { features: [feature], progression: [{ level: 12, features: ['Grand Hex'] }, { level: 18, features: ['Grand Hex'] }] };
  assert.deepEqual(progression.featureLevels(cls, feature), [12, 13, 15, 18]);
  assert.ok(progression.findings(cls).some(issue => /disagrees with the progression table/.test(issue.msg)));
});

test('nonstandard ability improvement amounts require review and an explicit zero count is not changed to one', () => {
  const cls = { name: 'Mistkeeper', features: [{ name: 'Ability Score Improvement', level: 4, description: 'Increase one ability score by 1.' }] };
  progression.build(cls, '');
  assert.equal(cls.choices[0].mode, 'unresolved');
  const { context } = app();
  assert.equal(context.classChoiceRules(cls, cls.features[0], context.getSourceMeta()).length, 0);
  const choice = { feature: 'Ability Score Improvement', mode: 'asi', count: 0, levels: [4] };
  assert.deepEqual(progression.events(cls, choice), [{ level: 4, count: 0 }]);
});

test('conditional spell tables preserve names containing conjunctions and do not match fragments', () => {
  const spells = [spell('Detect Poison and Disease'), spell('Purify Food and Drink'), spell('Protection from Evil and Good'), spell('Evil'), spell('Copper Flash')];
  availability.resolve(spells, { text: [
    'Feat: Gentle Light', 'You always have the following spells prepared.',
    '| Character Level | Spells |', '| --- | --- |',
    '| 3 | Detect Poison and Disease, Purify Food and Drink and Protection from Evil and Good |',
    '| 5 | Copper Flash |'
  ].join('\n'), kind: 'pasted' });
  for (const item of spells.filter(item => item.name !== 'Evil')) assert.equal(item.availability.conditional.length, 1, item.name);
  assert.equal(spells.find(item => item.name === 'Evil').availability.conditional.length, 0);
});

test('unreadable or out-of-range conditional table levels stay actionable instead of corrupting a draft', () => {
  const spells = [spell('Mist One'), spell('Mist Two'), spell('Mist Three'), spell('Mist Four'), spell('Mist Five')];
  availability.resolve(spells, { text: [
    'Feat: Mist Reader', 'You always have the following spells prepared.',
    '| Character Level | Spells |', '| --- | --- |', '| 0 | Mist One |', '| ? | Mist Two |',
    '| Cantrip | Mist Three |', '| | Mist Four |', '| 3 | Mist Five |'
  ].join('\n'), kind: 'pasted' });
  for (const item of spells.slice(0, 4)) {
    assert.equal(item.availability.conditional[0]?.levelUnclear, true, item.name);
    assert.equal(item.availability.conditional[0]?.level, undefined);
    assert.equal(item.availability.conditional[0]?.levelField, 'level');
  }
  assert.equal(spells[4].availability.conditional[0].level, 3);
  const bySpellLevel = [spell('Mist One', 0), spell('Mist Two')];
  availability.resolve(bySpellLevel, { text: [
    'Subclass: Mist Patron', 'These spells are added to your spell list.',
    '| Spell Level | Spells |', '| --- | --- |', '| Cantrip | Mist One |', '| 10 | Mist Two |'
  ].join('\n'), kind: 'pasted' });
  assert.equal(bySpellLevel[0].availability.conditional[0].spellLevel, 0);
  assert.equal(bySpellLevel[1].availability.conditional[0].levelUnclear, true);
});

test('temporary, negated, chosen, and other-creature bonuses never become permanent feat or racial grants', () => {
  const { context } = app();
  const meta = context.getSourceMeta();
  const feats = [
    { name: 'Mist Runner', benefits: ['While transformed, your speed increases by 10 feet.', 'If your ally is dying, you gain proficiency in the Medicine skill.'] },
    { name: 'Sealed Knowledge', benefits: ['You can’t gain proficiency in the Survival skill.'] },
    { name: 'Mist Ward', benefits: ['You gain resistance to fire or cold damage, chosen when you use this action.'] },
    { name: 'Mist Strike', benefits: ['Your attacks ignore resistance to fire damage.'] }
  ];
  for (const feat of feats) assert.equal(context.inferFeatRules(feat, meta).length, 0, feat.name);
  assert.equal(context.inferRacialTraitRules({ name: 'Dawn Folk' }, { name: 'Daylight Eyes', description: 'You do not have darkvision.' }, meta).length, 0);
  assert.equal(context.inferRacialTraitRules({ name: 'Dawn Folk' }, { name: 'Warm Friends', description: 'Your allies have resistance to cold damage.' }, meta).length, 0);
  assert.equal(context.skillChoiceRuleFromText({ name: 'Dawn Folk' }, { name: 'Night Hunter', description: 'While transformed, you gain proficiency in the Survival skill.' }), null);
});

test('direct permanent benefits survive beside separately conditional sentences and fixed skills are grants', () => {
  const { context } = app();
  const feat = { name: 'Copper Ward', benefits: ['You have resistance to lightning damage. When you touch a wand, sparks appear.'] };
  assert.ok(context.inferFeatRules(feat, context.getSourceMeta()).some(rule => /DAMAGE_RESISTANCE_LIGHTNING/.test(rule.xml)));
  const skills = context.skillChoiceRuleFromText({ name: 'Dawn Folk' }, { name: 'Lore', description: 'You gain proficiency in the Arcana and Survival skills.' });
  assert.match(skills.xml, /SKILL_ARCANA/);
  assert.match(skills.xml, /SKILL_SURVIVAL/);
  assert.doesNotMatch(skills.xml, /select type=/);
  assert.ok(context.inferRacialTraitRules({ name: 'Dawn Folk' }, { name: 'Darkvision', description: 'You can see in dim light within 60 feet as if it were bright light.' }, context.getSourceMeta()).some(rule => /ID_VISION_DARKVISION/.test(rule.xml)));
});

test('language choices retain their restrictions without granting all listed alternatives', () => {
  const { context } = app();
  assert.deepEqual(plain(context.parseLanguageInfo('Common and one language of your choice from Elvish or Sylvan')),
    { languages: ['Common'], choices: 1, choiceFrom: ['Elvish', 'Sylvan'] });
  assert.deepEqual(plain(context.parseLanguageInfo('Common and Elvish or Sylvan')),
    { languages: ['Common'], choices: 1, choiceFrom: ['Elvish', 'Sylvan'] });
  assert.deepEqual(plain(context.parseLanguageInfo('Choose two from Elvish, Sylvan, and Draconic')),
    { languages: [], choices: 2, choiceFrom: ['Elvish', 'Sylvan', 'Draconic'] });
  assert.deepEqual(plain(context.parseLanguageInfo('Common and one other language, typically Goblin')),
    { languages: ['Common'], choices: 1 });
  const race = context.parseRaceBlock('Dawn Folk', ['Size: Medium', 'Speed: 30 feet', 'Languages: Common and one language of your choice from Elvish or Sylvan', 'Bright Eyes. You enjoy sunlight.']);
  assert.deepEqual(plain(race.languages), ['Common']);
  assert.deepEqual(plain(race.languageChoiceFrom), ['Elvish', 'Sylvan']);
  const xml = context.genRaceXml(race, 'Audit', 'ID_AUD', context.getSourceMeta()).join('\n');
  assert.match(xml, /grant type="Language" id="ID_LANGUAGE_COMMON"/);
  assert.match(xml, /supports="ID_LANGUAGE_ELVISH\|ID_LANGUAGE_SYLVAN"/);
  assert.doesNotMatch(xml, /grant type="Language" id="ID_LANGUAGE_(ELVISH|SYLVAN)"/);
});

test('unknown language definitions, unresolved restrictions, and invalid choice counts stay actionable', () => {
  const { context } = app();
  assert.equal(context.languageElementId("Thieves' Cant"), 'ID_WOTC_PHB_LANGUAGE_THIEVES_CANT');
  assert.equal(context.languageElementId('Memory Speech'), '');
  assert.equal(context.languageChoiceSelect('Dawn Folk', 1, ['Memory Speech']), '');
  assert.equal(context.languageChoiceSelect('Dawn Folk', 2.5), '');
  assert.equal(context.languageChoiceSelect('Dawn Folk', 1, [], 'One secret language'), '');
  const findings = context.languageReviewFindings({ languages: ['Memory Speech'], languageChoices: 2, languageChoiceFrom: ['Elvish'], languageChoiceRestriction: 'One secret language' });
  assert.ok(findings.some(issue => /No bundled language definition/.test(issue.msg)));
  assert.ok(findings.some(issue => /fewer allowed languages/.test(issue.msg)));
  assert.ok(findings.some(issue => /restriction/.test(issue.msg)));
});

test('magic item charge capacity is distinct from its spending costs and recharge amounts', () => {
  const { context } = app();
  assert.equal(context.parseCharges('You can expend 2 charges to cast mist step. This wand has 10 charges.'), 10);
  assert.equal(context.parseCharges('The ring holds three charges. It regains 1 charge at dawn.'), 3);
  assert.equal(context.parseCharges('You can expend 2 charges to cast mist step. It regains 1d4 charges at dawn.'), 0);
});

test('withheld mechanics and missing charge or companion data remain visible in source review', () => {
  const issues = review.findings({
    feat: [{ name: 'Mist Runner', benefits: ['While transformed, your speed increases by 10 feet.'] }],
    race: [{ name: 'Copper Folk', traits: [{ name: 'Mist Ward', description: 'You gain resistance to fire or cold damage.' }] }],
    magic: [{ name: 'Mist Wand', charges: 0, description: 'You can expend 2 charges to cast mist step.' }],
    archetype: [{ name: 'Copper Smith', features: [{ name: 'Steel Defender', level: 3, description: 'You create a companion.' }] }]
  });
  assert.ok(issues.some(issue => issue.field === 'benefits.0' && /conditional or chosen benefit/.test(issue.msg)));
  assert.ok(issues.some(issue => issue.field === 'charges' && /capacity is missing/.test(issue.msg)));
  assert.ok(issues.some(issue => /Companion definition/.test(issue.msg)));
  assert.equal(review.findings({ feat: [{ name: 'Mist Gesture', benefits: ['As an action, choose one creature within 30 feet to hear a bell.'] }] }).length, 0);
  const { context } = app();
  assert.equal(context.inferFeatRules({ name: 'Strange Gift', benefits: ['Increase one ability score of your choice by 2.'] }, context.getSourceMeta()).length, 0);
  assert.ok(review.findings({ feat: [{ name: 'Strange Gift', benefits: ['Increase one ability score of your choice by 2.'] }] }).some(issue => /chosen benefit/.test(issue.msg)));
});

test('invalid feature levels cannot silently become level-one choices and foreign-class prerequisites stay unresolved', () => {
  const cls = { name: 'Mistkeeper', features: [{ name: 'Mist Curse', level: 0, description: 'Choose one of the options below.\nCopper. You can see copper.\nSilver. You can see silver.' }] };
  progression.build(cls, '');
  assert.equal(progression.events(cls, cls.choices[0])[0].level, 0);
  const { context } = app();
  assert.equal(context.validClassChoiceEvents(cls, cls.choices[0]).length, 0);
  const invoker = { name: 'Invoker', features: [{ name: 'Eldritch Invocations', level: 2, description: 'Choose invocations.' }] };
  progression.build(invoker, ['Eldritch Invocations', 'The following options are presented in alphabetical order.',
    'Foreign Sight', 'Prerequisites: 9th-level Wizard', 'You can see mist.', 'Invoker Subclasses'].join('\n'));
  assert.equal(invoker.choices[0].options[0].minimumLevel, undefined);
  assert.equal(invoker.choices[0].options[0].unresolvedPrerequisite, '9th-level Wizard');
});

test('simple fixed feat cantrips grant resolved spells without inventing spellcasting ability or duplicate dragonmark grants', () => {
  const { context } = app();
  const meta = context.getSourceMeta();
  const feat = { name: 'Copper Adept', benefits: ['You learn the Mending cantrip.', 'You know the cantrip Mage Hand.'] };
  const rules = context.inferFeatRules(feat, meta).map(rule => rule.xml).join('\n');
  assert.match(rules, /ID_PHB_SPELL_MENDING/);
  assert.match(rules, /ID_PHB_SPELL_MAGE_HAND/);
  assert.doesNotMatch(rules, /<spellcasting\b|ability=/);
  const marked = context.inferFeatRules({ name: 'Mark of Copper', benefits: ['You know the Mending cantrip.'] }, meta)
    .filter(rule => /grant type="Spell"[^>]*_MENDING"/.test(rule.xml));
  assert.equal(marked.length, 1);
  assert.ok(context.AuroraSourceReview.findings({ feat: [feat] }).some(issue => /casting feature and ability/.test(issue.msg)));
});

test('unknown feat cantrips remain unresolved while exported cantrips resolve locally', () => {
  const { context } = app();
  const feat = { name: 'Copper Adept', benefits: ['You learn the Memory Beacon cantrip.'] };
  assert.equal(context.inferFeatRules(feat, context.getSourceMeta()).length, 0);
  assert.ok(context.AuroraSourceReview.findings({ feat: [feat] }).some(issue => /no bundled or exported spell definition.*Memory Beacon/.test(issue.msg)));
  runInApp(context, 'extractedData.spell = [{ name: "Memory Beacon", level: 0 }];');
  assert.match(context.inferFeatRules(feat, context.getSourceMeta())[0].xml, /ID_AUD_SPELL_MEMORY_BEACON/);
  assert.equal(context.inferFeatRules({ name: 'Late Gift', benefits: ['You learn the Mending cantrip at 3rd level.'] }, context.getSourceMeta()).length, 0);
});

test('curly negations and conditional cantrip choices do not grant permanent spells or table access', () => {
  const { context } = app();
  for (const text of ['You can’t gain proficiency in the Survival skill.', 'You don’t learn the Mending cantrip.',
    'You learn the Mending cantrip while you hold a lantern.', 'You learn one cantrip from the Wizard spell list.']) {
    assert.equal(context.inferFeatRules({ name: 'Sealed Gift', benefits: [text] }, context.getSourceMeta()).length, 0, text);
  }
  const access = context.featureSpellAccess('You don’t always have the following spells prepared.\n| Class Level | Spells |\n| --- | --- |\n| 3 | Shield |', 'Cleric', context.getSourceMeta());
  assert.equal(access.rules.length, 0);
  assert.equal(access.expanded.length, 0);
});

test('spell class metadata stays in availability rather than descriptive XML and preserves canonical fields', () => {
  const { context } = app();
  for (const label of ['Classes: Wizard', 'Class: Wizard', 'Spell List: Wizard', 'Spell Lists. Wizard']) {
    const source = ['Metadata Spark', '1st-level evocation', 'Casting Time: 1 action', 'Range: 30 feet',
      'Components: V, S, M (a copper bell)', 'Duration: Instantaneous', label,
      'A harmless copper light appears.', 'At Higher Levels. The light reaches 5 feet farther for each slot level above 1.'].join('\n');
    const [parsed] = context.parseSpellsFromText(source);
    assert.deepEqual(plain(parsed.classes), ['Wizard'], label);
    assert.ok(parsed.availability.base.some(entry => entry.name === 'Wizard'), label);
    assert.equal(parsed.description, 'A harmless copper light appears.', label);
    assert.equal(parsed.castingTime, '1 action');
    assert.equal(parsed.range, '30 feet');
    assert.equal(parsed.hasMaterial, true);
    assert.equal(parsed.material, 'a copper bell');
    assert.equal(parsed.duration, 'Instantaneous');
    assert.match(parsed.higherLevels, /^The light reaches 5 feet farther/);
    runInApp(context, 'extractedData.spell = ' + JSON.stringify([parsed]) + ';');
    const xml = context.generateXml();
    assert.doesNotMatch(xml, /Classes?: Wizard|Spell Lists?[.:] Wizard/);
    assert.match(xml, /<supports>Wizard/);
  }
});

test('class metadata does not contaminate wrapped casting time or spell continuation prose', () => {
  const { context } = app();
  const definition = ['Metadata Spark', '1st-level evocation', 'Casting Time: 1 reaction, which you take',
    'Class: Wizard', 'when a bell rings', 'Range: 30 feet', 'Components: V, S', 'Duration: Instantaneous',
    'A harmless copper light appears.', '12 CHAPTER 1'];
  const row = (text, y) => ({ text, y, items: [{ str: text, x: 50, y, width: text.length * 5, height: 10 }] });
  const page = { page: 1, text: definition.join('\n'), layout: { columns: [{ side: 'left',
    rows: definition.map((text, index) => row(text, 750 - index * 15)) }] } };
  const tail = ['The bell stays audible until your next turn.', 'Classes: Wizard', 'At Higher Levels.',
    'The light reaches 5 feet farther for each slot level above 1.'];
  const continuation = { page: 2, text: tail.join('\n'), layout: { columns: [{ side: 'left',
    rows: tail.map((text, index) => row(text, 750 - index * 15)) }] } };
  const [parsed] = context.parseSpellsFromText(page.text, { pages: [page], continuationPages: [continuation] });
  assert.deepEqual(plain(parsed.classes), ['Wizard']);
  assert.equal(parsed.castingTime, '1 reaction, which you take when a bell rings');
  assert.match(parsed.description, /bell stays audible until your next turn/);
  assert.doesNotMatch(parsed.description, /Classes?: Wizard/);
  assert.match(parsed.higherLevels, /^The light reaches 5 feet farther/);
});

test('direct have or gain skill proficiencies and other effects in one feat benefit are all preserved', () => {
  const { context } = app();
  const feat = { name: 'Copper Sage', benefits: [
    'Increase your Intelligence score by 1. You have proficiency in the Arcana skill. You gain proficiency in the History and Nature skills. You learn the Mending cantrip.'
  ] };
  const xml = context.inferFeatRules(feat, context.getSourceMeta()).map(rule => rule.xml).join('\n');
  assert.match(xml, /stat name="intelligence" value="1"/);
  for (const skill of ['ARCANA', 'HISTORY', 'NATURE']) assert.match(xml, new RegExp('ID_PROFICIENCY_SKILL_' + skill));
  assert.match(xml, /ID_PHB_SPELL_MENDING/);
  assert.equal(context.inferFeatRules({ name: 'Shared Lessons', benefits: ['Your companions have proficiency in the Arcana skill.'] }, context.getSourceMeta()).length, 0);
});

test('a spell Class field does not turn its prose into a granting class feature', () => {
  const { context } = app();
  const definition = (name, body) => [name, '1st-level evocation', 'Casting Time: 1 action', 'Range: 30 feet',
    'Components: V, S', 'Duration: Instantaneous', body].join('\n');
  const spells = context.parseSpellsFromText(definition('Metadata Spark', 'Class: Wizard\nYou learn the Copper Flash spell from an illustration.')
    + '\n' + definition('Copper Flash', 'A harmless light appears.'));
  assert.deepEqual(plain(spells[0].classes), ['Wizard']);
  assert.equal(spells[1].availability.conditional.length, 0);
});

test('standard Extra Attack timing keeps its permanent class stat', () => {
  const { context } = app();
  for (const description of [
    'You can attack twice, instead of once, whenever you take the Attack action on your turn.',
    'You can attack twice, instead of once, when you take the Attack action.',
    'You can attack twice, instead of once.'
  ]) {
    const rules = context.inferArchetypeFeatureRules({ name: 'Copper Smith', class: 'Artificer' },
      { name: 'Extra Attack', level: 5, description }, context.getSourceMeta());
    assert.ok(rules.some(rule => /stat name="extra attack:count" value="2" level="5"/.test(rule.xml)), description);
  }
});

test('temporary, transformed, negative, and companion Extra Attack statements do not change this character permanently', () => {
  const { context } = app();
  for (const description of [
    'While transformed, you can attack twice, instead of once, whenever you take the Attack action on your turn.',
    'Activate your mist form. You can attack twice, instead of once, whenever you take the Attack action on your turn.',
    'You cannot attack twice, instead of once, whenever you take the Attack action on your turn.',
    'Your companion can attack twice, instead of once, whenever you take the Attack action on your turn.',
    'You can attack twice, instead of once, whenever you take the Attack action on your turn, as long as you hold a lantern.'
  ]) {
    const rules = context.inferArchetypeFeatureRules({ name: 'Copper Smith', class: 'Artificer' },
      { name: 'Extra Attack', level: 5, description }, context.getSourceMeta());
    assert.ok(!rules.some(rule => /extra attack:count/.test(rule.xml)), description);
  }
});

test('modeled standard class improvements avoid generic manual-choice warnings while unsupported conditions stay visible', () => {
  const feature = { name: 'Ability Score Improvement', level: 4,
    description: 'When you reach 4th level, and again at 8th level, you can increase one ability score by 2 or two ability scores by 1.' };
  const cls = { name: 'Copper Sage', features: [feature], progression: [{ level: 4, features: [feature.name] }, { level: 8, features: [feature.name] }] };
  progression.build(cls, '');
  const generic = item => review.findings({ class: [item] }).filter(issue => /conditional or chosen benefit/.test(issue.msg));
  assert.equal(generic(cls).length, 0);
  const unresolved = plain(cls);
  unresolved.choices[0].mode = 'unresolved';
  assert.equal(generic(unresolved).length, 1);
  const invalid = plain(cls);
  invalid.choices[0].schedule = [{ level: 0, count: 1 }];
  assert.equal(generic(invalid).length, 1);
  const temporary = plain(cls);
  temporary.features[0].description += ' While transformed, this increase applies only to your transformed shape.';
  assert.equal(generic(temporary).length, 1);
});
