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
    insertAdjacentHTML() {},
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
