const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

function createStubElement(value = '') {
  const element = {
    value,
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return element; },
    appendChild() {},
    insertAdjacentHTML() {},
    focus() {},
    remove() {},
    scrollIntoView() {}
  };
  return element;
}

function loadApp() {
  const elements = {
    sourceName: createStubElement('Validator Sample Source'),
    sourceAbbr: createStubElement('VSS'),
    sourceAuthor: createStubElement('Codex Test'),
    pageRange: createStubElement('')
  };

  const fallbackElement = createStubElement();
  const document = {
    getElementById(id) {
      return elements[id] || fallbackElement;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createStubElement();
    },
    addEventListener() {}
  };

  const window = {
    addEventListener() {},
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

  const context = {
    console,
    document,
    window,
    localStorage: window.localStorage,
    Blob: class Blob {},
    URL: {
      createObjectURL() { return ''; },
      revokeObjectURL() {}
    },
    confirm() { return true; },
    setTimeout(callback) {
      if (typeof callback === 'function') callback();
      return 0;
    },
    clearTimeout() {}
  };

  vm.createContext(context);
  const appScript = fs.readFileSync(path.join(repoRoot, 'src', 'app.js'), 'utf8');
  vm.runInContext(appScript, context, { filename: 'src/app.js' });
  return context;
}

function runInApp(context, code) {
  return vm.runInContext(code, context);
}

function setExtractedData(context, data) {
  runInApp(context, `extractedData = ${JSON.stringify(data)};`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('leveled class and subclass features are not parsed as feats', () => {
  const context = loadApp();
  const text = [
    'Core Artificer Traits',
    'Hit Point Die D8 per Artificer level',
    'Saving Throw Proficiencies Constitution and Intelligence',
    'Skill Proficiencies. Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception, Sleight of Hand',
    'Weapon Proficiencies Simple weapons',
    'Armor Training Light and Medium armor and Shields',
    'Starting Equipment Choose two simple weapons.',
    'LeveL 1: SPELLCASTING',
    'Intelligence is your spellcasting ability for your Artificer spells.',
    'Levet 2: REPLICATE MAGIC ITEM',
    'You learn how to replicate magic items.',
    'LeveL 3: ARTIFICER SUBCLASS',
    'Choose an Artificer subclass.',
    'ARTIFICER SUBCLASSES',
    'ALCHEMIST',
    'You use alchemical supplies to create magical effects.',
    'Level 3: TOOLS OF THE TRADE',
    'You gain proficiency with alchemist supplies.'
  ].join('\n');

  const feats = context.parseFeatsFromText(text);
  const classes = context.parseClassesFromText(text);

  assert.equal(feats.length, 0);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].name, 'Artificer');
  assert.equal(classes[0].hitDie, 8);
  assert.equal(classes[0].archetypeLevel, 3);
  assert.ok(classes[0].features.some(feature => /spellcasting/i.test(feature.name)));
});

test('browser namespace exposes parser and generator API', () => {
  const context = loadApp();

  assert.equal(typeof context.window.AuroraXMLHelper, 'object');
  assert.equal(typeof context.window.AuroraXMLHelper.parseFeatsFromText, 'function');
  assert.equal(typeof context.window.AuroraXMLHelper.generateXml, 'function');
});

test('DDB-style feat blocks parse prerequisite and grouped benefits', () => {
  const context = loadApp();
  const text = [
    'GreaTer Mark oF Hosprtauity',
    'General Feat (Prerequisite: Level 4+, Mark of Hospitality Feat)',
    'ARTIST: LEE MOVER',
    'You gain the following benefits.',
    'Ability Score Increase. Increase one ability score of your choice by 1, to a maximum of 20.',
    'Improved Intuition. When you use the Ever Hospitable benefit of your Mark of Hospitality feat,',
    'you can roll 1d6 instead of 1d4.',
    'Inspired Hospitality. When you cast Purify Food and Drink, you can modify the spell.'
  ].join('\n');

  const feats = context.parseFeatsFromText(text);

  assert.equal(feats.length, 1);
  assert.equal(feats[0].name, 'Greater Mark of Hospitality');
  assert.equal(feats[0].prerequisite, 'Level 4+, Mark of Hospitality Feat');
  assert.equal(feats[0].benefits.length, 3);
  assert.ok(feats[0].benefits[1].includes('you can roll 1d6'));
  assert.ok(!feats[0].benefits.join(' ').includes('ARTIST'));
});

test('subclass headings normalize common OCR damage', () => {
  const context = loadApp();
  const text = [
    'ARTIFICER SUBCLASSES',
    'Bare Smit',
    'You craft a defender and specialize in battlefield repairs.',
    'Level 3: Battle Ready',
    'You gain proficiency with martial weapons.',
    'Level 3: Steel Defender',
    'You create a steel defender.'
  ].join('\n');

  const archetypes = context.parseArchetypesFromText(text);

  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].name, 'Battle Smith');
  assert.equal(archetypes[0].class, 'Artificer');
  assert.equal(archetypes[0].features.length, 2);
});

test('class parsing stops before subclass section and normalizes OCR feature names', () => {
  const context = loadApp();
  const text = [
    'Core Artificer Traits',
    'Hit Point Die D8 per Artificer level',
    'Saving Throw Proficiencies Constitution and Intelligence',
    'Skill Proficiencies. Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception, Sleight of Hand',
    'LeveL 1: SPELLCASTING',
    'Intelligence is your spellcasting ability for your Artificer spells.',
    'Levet 2: Repuicate Macic Item',
    'You learn how to replicate magic items.',
    'ARTIFICER SUBCLASSES',
    'Alchemist',
    'A specialist in alchemical magic.',
    'Level 3: Toots oF THE TRADE',
    'You gain alchemist supplies.'
  ].join('\n');

  const classes = context.parseClassesFromText(text);
  const archetypes = context.parseArchetypesFromText(text);

  assert.equal(classes.length, 1);
  assert.equal(classes[0].features.map(feature => feature.name).join('|'), 'Spellcasting|Replicate Magic Item');
  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].features[0].name, 'Tools of the Trade');
});

test('DDB-style species parse from title plus inline trait paragraphs', () => {
  const context = loadApp();
  const text = [
    'CHANGELING',
    'With ever-changing appearances, changelings reside in many societies undetected.',
    'CHANGELING TRAITS',
    'Creature Type: Fey',
    'Size: Medium or Small, chosen when you select this species',
    'Speed: 30 feet',
    'As a Changeling, you have these special traits.',
    'Changeling Instincts. You gain proficiency in two skills of your choice.',
    'Shape-Shifter. As an action, you can change your appearance.'
  ].join('\n');

  const races = context.parseRacesFromText(text);

  assert.equal(races.length, 1);
  assert.equal(races[0].name, 'Changeling');
  assert.equal(races[0].size, 'Medium');
  assert.equal(races[0].speed, 30);
  assert.equal(races[0].traits.map(trait => trait.name).join('|'), 'Changeling Instincts|Shape-Shifter');
});

test('2024-style backgrounds do not require background feature blocks', () => {
  const context = loadApp();
  const text = [
    'Aperrant HEIR',
    'Ability Scores: Strength, Constitution, Charisma',
    'Feat: Aberrant Dragonmark (see Dragonmark Feats)',
    'Skill Proficiencies: History and Intimidation',
    'Tool Proficiency: Disguise Kit',
    'Equipment: Choose A or B: Dagger or 50 GP',
    'Your aberrant dragonmark has made life challenging since it manifested.'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);

  assert.equal(backgrounds.length, 1);
  assert.equal(backgrounds[0].name, 'Aberrant Heir');
  assert.equal(backgrounds[0].abilityScores.join('|'), 'Strength|Constitution|Charisma');
  assert.equal(backgrounds[0].feat, 'Aberrant Dragonmark');
  assert.equal(backgrounds[0].skillProficiencies.join('|'), 'History|Intimidation');

  setExtractedData(context, { spell: [], archetype: [], item: [], feat: [{ name: 'Aberrant Dragonmark', benefits: ['You gain a mark.'] }], magic: [], race: [], background: backgrounds, class: [], other: [] });
  const xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('<stat name="strength" value="1" />'));
  assert.ok(xml.includes('<grant type="Feat" id="ID_VSS_FEAT_ABERRANT_DRAGONMARK" />'));
  assert.equal(context.checkCompleteness(backgrounds[0], 'background').keep, true);
});

test('dragonmark feat headings are recognized as feats', () => {
  const context = loadApp();
  const text = [
    'Mark oF DETECTION',
    'Dragonmark Feat (Prerequisite: Eberron Campaign, Can’t Have Another Dragonmark Feat)',
    'You gain the following benefits.',
    'Deductive Intuition. When you make an Intelligence check, you can roll 1d4.',
    'Magical Detection. You always have the Detect Magic spell prepared.'
  ].join('\n');

  const feats = context.parseFeatsFromText(text);

  assert.equal(feats.length, 1);
  assert.equal(feats[0].name, 'Mark of Detection');
  assert.match(feats[0].prerequisite, /Eberron Campaign/);
  assert.equal(feats[0].benefits.length, 2);
});

test('generated XML strips OCR control characters that XML forbids', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [{ name: 'Glitch Proof', description: 'Before\u0015After', benefits: ['Keep\u0014going.'] }],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(xml));
  assert.ok(xml.includes('BeforeAfter'));
  assert.ok(xml.includes('Keepgoing.'));
});

test('manual author templates are available for every supported type', () => {
  const context = loadApp();
  const types = ['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'];
  const templates = JSON.parse(runInApp(context, `JSON.stringify(${JSON.stringify(types)}.map(type => [type, createBlankElement(type)]))`));
  const byType = Object.fromEntries(templates);

  assert.equal(byType.spell.school, '');
  assert.deepEqual(byType.feat.benefits, []);
  assert.deepEqual(byType.race.traits, []);
  assert.deepEqual(byType.background.abilityScores, []);
  assert.deepEqual(byType.class.features, []);
  assert.equal(byType.other.type, '');
});

test('manual pasted text uses deterministic parser when it matches a known layout', () => {
  const context = loadApp();
  const text = [
    'Mark oF Handling',
    'Dragonmark Feat (Prerequisite: Eberron Campaign)',
    'You gain the following benefits.',
    'Animal Intuition. When you make a Wisdom check involving animals, roll 1d4.',
    'Primal Connection. You learn the Animal Friendship spell.'
  ].join('\n');

  const parsed = JSON.parse(runInApp(context, `JSON.stringify(parseManualTextForType('feat', ${JSON.stringify(text)}))`));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Mark of Handling');
  assert.equal(parsed[0].benefits.length, 2);
});

test('manual pasted text falls back to an editable seeded record', () => {
  const context = loadApp();
  const text = [
    'Mystic Gizmo',
    'This section has enough text to seed a manual record, but not enough structure for a spell parser.'
  ].join('\n');

  const parsed = JSON.parse(runInApp(context, `JSON.stringify(parseManualTextForType('spell', ${JSON.stringify(text)}))`));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Mystic Gizmo');
  assert.equal(parsed[0].school, '');
  assert.match(parsed[0].description, /seed a manual record/);
});

test('manual added elements participate in XML generation', () => {
  const context = loadApp();
  runInApp(context, `
    addManualElement('feat', {
      name: 'Manual Spark',
      prerequisite: '',
      description: 'A manually authored feat.',
      benefits: ['You gain proficiency in the Arcana skill.']
    });
  `);

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('ID_VSS_FEAT_MANUAL_SPARK'));
  assert.ok(xml.includes('<grant type="Proficiency" id="ID_PROFICIENCY_SKILL_ARCANA" />'));
});

test('manual elements can be removed before export', () => {
  const context = loadApp();
  runInApp(context, `
    addManualElement('feat', {
      name: 'Temporary Feat',
      prerequisite: '',
      description: 'A draft feat.',
      benefits: ['You can remove this.']
    });
    removeElement('feat-0');
  `);

  const xml = runInApp(context, 'generateXml()');

  assert.ok(!xml.includes('TEMPORARY_FEAT'));
});

test('generated XML metadata matches Aurora shape expectations', () => {
  const context = loadApp();
  const sampleData = {
    spell: [],
    archetype: [],
    item: [],
    feat: [{
      name: 'Arcane Tinker',
      prerequisite: 'Intelligence 13',
      description: 'You improve your technical spellwork.',
      benefits: ['Increase your Intelligence score by 1, to a maximum of 20.']
    }],
    magic: [],
    race: [],
    background: [],
    class: [{
      name: 'Artificer',
      description: 'Masters of magical invention.',
      hitDie: 8,
      savingThrows: ['Constitution', 'Intelligence'],
      armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
      weaponProficiencies: ['Simple weapons'],
      skillChoices: { count: 2, from: ['Arcana', 'Investigation'] },
      startingEquipment: 'Choose two simple weapons.',
      archetypeLevel: 3,
      archetypeLabel: 'Artificer',
      archetypeSupports: 'Artificer',
      spellcastingAbility: 'Intelligence',
      spellcastingList: 'Artificer',
      spellcastingPrepare: true,
      ritualCasting: true,
      features: [
        { name: 'Spellcasting', level: 1, description: 'You cast spells through tools.' },
        { name: 'Artificer Subclass', level: 3, description: 'Choose an Artificer subclass.' }
      ]
    }],
    other: []
  };

  setExtractedData(context, sampleData);
  const xml = runInApp(context, 'generateXml()');
  const zipDocs = runInApp(context, 'buildZipXmlDocuments(getSourceMeta())');

  assert.ok(xml.includes('<info>'));
  assert.ok(xml.includes('<name>Validator Sample Source</name>'));
  assert.ok(!xml.includes('<n>'));
  assert.match(xml, /<file name="validator_sample_source\.xml" url="validator_sample_source\.xml" \/>/);
  assert.ok(xml.includes('<set name="hd">d8</set>'));
  assert.ok(zipDocs.some(doc => doc.fileName === 'source.xml'));
  assert.ok(zipDocs.every(doc => /<update version="0\.1\.0">/.test(doc.xml)));
  assert.ok(zipDocs.every(doc => !/<file\b[^>]*url=""/.test(doc.xml)));
});
