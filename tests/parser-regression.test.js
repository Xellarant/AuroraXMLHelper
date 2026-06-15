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
  const storage = {};
  const elements = {
    sourceName: createStubElement('Validator Sample Source'),
    sourceAbbr: createStubElement('VSS'),
    sourceAuthor: createStubElement('Codex Test'),
    sourceYear: createStubElement(''),
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
      getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
      setItem(key, value) { storage[key] = String(value); },
      removeItem(key) { delete storage[key]; },
      clear() { Object.keys(storage).forEach(key => delete storage[key]); }
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

test('2024 Artificer class XML mirrors canonical table-derived shape', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  const text = [
    '## Artificer',
    '### Core Artificer Traits',
    '| Trait | Details |',
    '| --- | --- |',
    '| Primary Ability | Intelligence |',
    '| Hit Point Die | D8 per Artificer level |',
    '| Saving Throw Proficiencies | Constitution and Intelligence |',
    '| Skill Proficiencies | Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception, or Sleight of Hand |',
    '| Weapon Proficiencies | Simple weapons |',
    "| Tool Proficiencies | Thieves' Tools, Tinker's Tools, and one type of Artisan's Tools of your choice |",
    '| Armor Training | Light and Medium armor and Shields |',
    "| Starting Equipment | Choose A or B: (A) Studded Leather Armor, Dagger, Thieves' Tools, Tinker's Tools, Dungeoneer's Pack, and 16 GP; or (B) 150 GP |",
    '### Class Features',
    '| Level | PB | Features | Plans Known | Magic Items | Cantrips | Prepared Spells | 1st | 2nd | 3rd | 4th | 5th |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    "| 1 | +2 | Spellcasting, Tinker's Magic | - | - | 2 | 2 | 2 | - | - | - | - |",
    '| 2 | +2 | Replicate Magic Item | 4 | 2 | 2 | 3 | 2 | - | - | - | - |',
    '| 3 | +2 | Artificer Subclass | 4 | 2 | 2 | 4 | 3 | - | - | - | - |',
    '| 4 | +2 | Ability Score Improvement | 4 | 2 | 2 | 5 | 3 | - | - | - | - |',
    '| 5 | +3 | Subclass Feature | 4 | 2 | 2 | 6 | 4 | 2 | - | - | - |',
    '| 6 | +3 | Magic Item Tinker | 5 | 3 | 2 | 6 | 4 | 2 | - | - | - |',
    '| 10 | +4 | Magic Item Adept | 6 | 4 | 3 | 9 | 4 | 3 | 2 | - | - |',
    '| 11 | +4 | Spell-Storing Item | 6 | 4 | 3 | 10 | 4 | 3 | 3 | - | - |',
    '| 14 | +5 | Advanced Artifice | 7 | 5 | 4 | 11 | 4 | 3 | 3 | 1 | - |',
    '| 18 | +6 | Magic Item Master | 8 | 6 | 4 | 14 | 4 | 3 | 3 | 3 | 1 |',
    '| 19 | +6 | Epic Boon | 8 | 6 | 4 | 15 | 4 | 3 | 3 | 3 | 2 |',
    '| 20 | +6 | Soul of Artifice | 8 | 6 | 4 | 15 | 4 | 3 | 3 | 3 | 2 |',
    '#### Spellcasting (Level 1)',
    'Intelligence is your spellcasting ability for your Artificer spells. You know two Artificer cantrips of your choice.',
    "#### Tinker's Magic (Level 1)",
    "You know the Mending cantrip. As a Magic action while holding Tinker's Tools, you can create one item.",
    '#### Replicate Magic Item (Level 2)',
    'You have learned arcane plans that you use to make magic items.',
    '#### Artificer Subclass (Level 3)',
    'You gain an Artificer subclass of your choice.',
    '#### Ability Score Improvement (Level 4)',
    'You gain the Ability Score Improvement feat or another feat of your choice for which you qualify.',
    '#### Magic Item Tinker (Level 6)',
    'Your Replicate Magic Item feature gains additional options.',
    '#### Magic Item Adept (Level 10)',
    'You can now attune to up to four magic items at once.',
    '#### Spell-Storing Item (Level 11)',
    'The spell stays in the object until used a number of times equal to twice your Intelligence modifier.',
    '#### Advanced Artifice (Level 14)',
    'You can now attune to up to five magic items at once.',
    '#### Magic Item Master (Level 18)',
    'You can now attune to up to six magic items at once.',
    '#### Epic Boon (Level 19)',
    'You gain an Epic Boon feat or another feat of your choice for which you qualify.',
    '#### Soul of Artifice (Level 20)',
    'You gain the following benefits.'
  ].join('\n');

  const classes = context.parseClassesFromText(text);
  setExtractedData(context, { spell: [], archetype: [], item: [], feat: [], magic: [], race: [], background: [], class: classes, other: [] });
  const xml = runInApp(context, 'generateXml()');

  assert.equal(classes[0].hitDie, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(classes[0].toolProficiencies)), ["Thieves' Tools", "Tinker's Tools", "one type of Artisan's Tools of your choice"]);
  assert.ok(xml.includes('<grant type="Class Feature" id="ID_VSS_CLASS_FEATURE_ARTIFICER_SUBCLASS" level="3" />'));
  assert.ok(!xml.includes('ID_VSS_CLASS_FEATURE_ARTIFICER_ARTIFICER_SUBCLASS'));
  assert.ok(!xml.includes('ID_VSS_CLASS_FEATURE_ARTIFICER_" level='));
  assert.ok(!xml.includes('<element name="Subclass Feature" type="Class Feature"'));
  assert.ok(xml.includes('<grant type="Proficiency" id="ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS" requirements="!ID_VSS_MULTICLASS_ARTIFICER" />'));
  assert.ok(xml.includes('<select type="Proficiency" name="Artisan\'s Tool (Artificer)" supports="Artisan tools" requirements="!ID_VSS_MULTICLASS_ARTIFICER" />'));
  assert.ok(xml.includes('<multiclass id="ID_VSS_MULTICLASS_ARTIFICER">'));
  assert.ok(xml.includes('<stat name="artificer:spellcasting:slots:2" value="2" level="5" />'));
  assert.ok(xml.includes('<stat name="replicate:plans:known" value="4" level="2" />'));
  assert.ok(xml.includes('<select type="Feat" name="Feat (Artificer)" />'));
  assert.ok(xml.includes('<select type="Feat" name="Epic Boon (Artificer)" supports="Epic Boon" />'));
});

test('browser namespace exposes parser and generator API', () => {
  const context = loadApp();

  assert.equal(typeof context.window.AuroraXMLHelper, 'object');
  assert.equal(typeof context.window.AuroraXMLHelper.parseFeatsFromText, 'function');
  assert.equal(typeof context.window.AuroraXMLHelper.getSourceMeta, 'function');
  assert.equal(typeof context.window.AuroraXMLHelper.detectModernRulesetSignals, 'function');
  assert.equal(typeof context.window.AuroraXMLHelper.generateXml, 'function');
});

test('source ruleset defaults to 2014 unless year or 5.5e signal proves 2024', () => {
  const context = loadApp();

  let meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  assert.equal(meta.ruleset, '2014');

  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  assert.equal(meta.ruleset, '2024');
  assert.equal(meta.rulesetConfidence, 'explicit-year');
  assert.deepEqual(meta.rulesetEvidence, ['Publication year 2025']);

  assert.equal(runInApp(context, `detectModernRulesetSignal('This feature uses the Magic action.')`), 'Magic action');
  assert.deepEqual(
    JSON.parse(runInApp(context, `JSON.stringify(detectModernRulesetSignals('Level 19: Epic Boon. You can take the Magic action.'))`)),
    ['Epic Boon feat', 'Magic action']
  );
  assert.equal(runInApp(context, `detectModernRulesetSignal('This old feature uses an action.')`), '');
  assert.equal(runInApp(context, `detectModernRulesetSignal('This rule tells you to take the Search action.')`), '');
  assert.equal(runInApp(context, `detectModernRulesetSignal('Range: Self (10-foot Emanation)')`), 'Emanation area');
  assert.equal(runInApp(context, `detectModernRulesetSignal('Level 19: Epic Boon')`), 'Epic Boon feat');
  assert.equal(runInApp(context, `detectModernRulesetSignal('Choose one Mastery property for this weapon.')`), 'Weapon Mastery property');

  runInApp(context, `
    document.getElementById('sourceYear').value = '2014';
    detectSourceMetaFromText([{ page: 1, text: 'Copyright 2014\\nThis subclass uses the Magic action. Level 19: Epic Boon.' }]);
  `);
  meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  assert.equal(meta.ruleset, '2024');
  assert.equal(meta.year, 2014);
  assert.equal(meta.rulesetConfidence, '5.5e-signal');
  assert.deepEqual(meta.rulesetEvidence, ['Epic Boon feat', 'Magic action']);
  assert.match(meta.rulesetDecision, /Epic Boon feat/);
  assert.equal(runInApp(context, `document.getElementById('sourceYear').dataset.rulesetEvidence`), 'Epic Boon feat|Magic action');
});

test('source title detection normalizes curly and mojibake apostrophes', () => {
  const context = loadApp();

  runInApp(context, `
    document.getElementById('sourceName').value = '';
    document.getElementById('sourceAbbr').value = '';
    detectSourceMetaFromText([{ page: 1, text: 'Mordenkainen\\u2019s Clockwork Codex\\nby Arcane Press' }]);
  `);
  assert.equal(runInApp(context, `document.getElementById('sourceName').value`), "Mordenkainen's Clockwork Codex");
  assert.equal(runInApp(context, `document.getElementById('sourceAbbr').value`), 'MCC');
  assert.equal(runInApp(context, `looksLikeTitle('Mordenkainen\\u2019s Clockwork Codex')`), true);

  runInApp(context, `
    document.getElementById('sourceName').value = '';
    document.getElementById('sourceAbbr').value = '';
    detectSourceMetaFromText([{ page: 1, text: 'Tasha\\u00e2\\u20ac\\u2122s Arcane Appendix\\nby Test Author' }]);
  `);
  assert.equal(runInApp(context, `document.getElementById('sourceName').value`), "Tasha's Arcane Appendix");
  assert.equal(runInApp(context, `document.getElementById('sourceAbbr').value`), 'TAA');
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

test('2024 background blocks with feat rows are not parsed as feats', () => {
  const context = loadApp();
  const text = [
    'House Vadalis Heir',
    'You have grown up with respect for both family and nature.',
    'Ability Scores: Constitution, Wisdom, Charisma',
    'Feat: Mark of Handling',
    'Skill Proficiencies: Animal Handling and Nature',
    'Tool Proficiencies: Herbalism Kit',
    'Equipment: Herbalism Kit, Fine Clothes, Net, 29 GP',
    'Inquisitive',
    'You have honed your talents of investigation and deduction.',
    'Ability Scores: Constitution, Intelligence, Charisma',
    'Feat: Alert',
    'Skill Proficiencies: Insight and Investigation',
    "Tool Proficiencies: Thieves' Tools",
    "Equipment: Thieves' Tools, Bullseye Lantern, Crowbar, Traveler's Clothes, 10 GP"
  ].join('\n');

  const feats = context.parseFeatsFromText(text);
  const backgrounds = context.parseBackgroundsFromText(text);

  assert.equal(feats.length, 0);
  assert.equal(backgrounds.length, 2);
  assert.equal(backgrounds[0].feat, 'Mark of Handling');
  assert.equal(backgrounds[1].feat, 'Alert');
});

test('long non-feat sections do not use loose prose feat starts', () => {
  const context = loadApp();
  const source = [
    'Chapter 1',
    'Guilds of the City',
    ...Array.from({ length: 90 }, (_, i) => `Background lore line ${i + 1}`),
    'Celebrated',
    'You have earned a reputation among your peers.',
    'This paragraph describes social standing, not a feat benefit.'
  ].join('\n');
  const manualSnippet = [
    'Celebrated',
    'You have earned a reputation among your peers.'
  ].join('\n');

  assert.equal(context.parseFeatsFromText(source).length, 0);
  assert.equal(context.parseFeatsFromText(manualSnippet).length, 1);
});

test('magic parser rejects non-item rarity blocks but keeps item categories', () => {
  const context = loadApp();
  const text = [
    'Magic Items',
    'Echo of Dragonsight',
    'Supernatural Gift, rare',
    'You receive a draconic blessing.',
    'Flail of Tiamat',
    'Weapon (flail), legendary (requires attunement)',
    'This magic flail has five heads.'
  ].join('\n');

  const items = context.parseMagicItemsFromText(text);

  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Flail of Tiamat');
  assert.equal(items[0].type, 'Weapon (Flail)');
});

test('background parser rejects TOC rows and prose fragments', () => {
  const context = loadApp();
  const text = [
    'Backgrounds',
    'Background: Azorius Functionary .................. 33',
    'You might be a true believer, inspired by the example of',
    'Skill Proficiencies: Religion and Persuasion',
    'Equipment: A uniform and 10 gp',
    'Rakdos Cultist',
    'Skill Proficiencies: Acrobatics and Performance',
    "Tool Proficiencies: one Musical Instrument",
    'Languages: Abyssal or Giant',
    'Equipment: A costume and 10 gp'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);

  assert.equal(backgrounds.length, 1);
  assert.equal(backgrounds[0].name, 'Rakdos Cultist');
});

test('background metadata ignores feature body tables and uses canonical feature ids', () => {
  const context = loadApp();
  const text = [
    'Boros Legionnaire',
    'Skill Proficiencies: Athletics and Intimidation',
    'Tool Proficiencies: one type of gaming set',
    'Languages: one of your choice',
    'Feature: Legion Station',
    'Cantrip fire bolt, sacred flame',
    'Languages: Goblin, Celestial, and Draconic'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);
  assert.equal(backgrounds.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(backgrounds[0].languages)), []);
  assert.equal(backgrounds[0].languageChoices, 1);
  assert.equal(backgrounds[0].features[0].name, 'Legion Station');

  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: backgrounds,
    class: [],
    other: []
  });
  const xml = runInApp(context, `generateXml()`);

  assert.ok(xml.includes('<element name="Feature: Legion Station" type="Background Feature"'));
  assert.ok(xml.includes('<supports>Background Feature</supports>'));
  assert.ok(xml.includes('ID_VSS_BACKGROUND_FEATURE_BOROS_LEGIONNAIRE_LEGION_STATION'));
  assert.ok(!xml.includes('ID_VSS_BACKGROUND_BOROS_LEGIONNAIRE_FEATURE_LEGION_STATION'));
});

test('background feature headings strip same-line OCR prose tails', () => {
  const context = loadApp();
  const text = [
    'House Agent',
    'Skill Proficiencies: Investigation and Persuasion',
    'Feature: HOUSE CONNECTIONS about secret societies and hidden demons.',
    'You have contacts in your house.'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);

  assert.equal(backgrounds.length, 1);
  assert.equal(backgrounds[0].features[0].name, 'House Connections');
});

test('archetype parser rejects prose fragments inside subclass chapters', () => {
  const context = loadApp();
  const text = [
    'Paladin Subclasses',
    'If you are a paladin who swears the Oath of Devotion,',
    'Paladin subclass features are described in the Player Handbook.',
    'Oath of the Signal',
    'Paladin subclass',
    'Level 3: Signal Spells',
    'You learn special spells.'
  ].join('\n');

  const archetypes = context.parseArchetypesFromText(text);

  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].name, 'Oath of the Signal');
});

test('magic parser rejects prose headings even before valid item detail lines', () => {
  const context = loadApp();
  const text = [
    'Magic Items',
    'For example, you might communicate fear caused by',
    'Wondrous Item, rare',
    'This sentence is part of a paragraph, not an item.',
    'Mizzium Mortar',
    'Wondrous Item, rare',
    'This item has 4 charges.'
  ].join('\n');

  const items = context.parseMagicItemsFromText(text);

  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Mizzium Mortar');
});

test('Markdown-style DDB blocks parse headings and compact possessive ids', () => {
  const context = loadApp();
  const text = [
    '## Spell',
    "This new spell appears on the Artificer's spell list.",
    '### Homunculus Servant',
    '*Level 2 Conjuration (ritual)*',
    '**Casting Time:** 1 hour (ritual)',
    '**Range:** 10 feet',
    '**Components:** V, S, M (a gem worth 100+ GP)',
    '**Duration:** instant',
    'You summon a special homunculus in an unoccupied space within range.',
    '**Using a Higher-Level Spell Slot.** Use the spell slot level for the spell.',
    '------',
    '## Artificer Subclasses',
    '### Alchemist (Artificer Subclass)',
    '*Craft Magic Elixirs and Potions*',
    '#### Tools of the Trade (Level 3)',
    'You gain the following benefits.',
    "**Tool Proficiency.** You gain proficiency with Alchemist's Supplies.",
    '#### Alchemist Spells (Level 3)',
    'When you reach an Artificer level specified in the Alchemist Spells table, you have spells prepared.',
    '| Artificer Level | Spells |',
    '| --- | --- |',
    "| 5 | Flaming Sphere, Melf's Acid Arrow |"
  ].join('\n');

  const spells = context.parseSpellsFromText(text);
  const archetypes = context.parseArchetypesFromText(text);

  assert.equal(spells.length, 1);
  assert.equal(spells[0].classes.join(','), 'Artificer');
  assert.equal(spells[0].castingTime, '1 hour or Ritual');
  assert.equal(spells[0].duration, 'Instantaneous');
  assert.equal(spells[0].higherLevels, 'Use the spell slot level for the spell.');
  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].supports, 'Artificer Specialist');
  assert.equal(archetypes[0].features.map(feature => feature.name).join('|'), 'Tools of the Trade|Alchemist Spells');
  assert.equal(runInApp(context, `idify("Melf's Acid Arrow")`), 'MELFS_ACID_ARROW');
  assert.equal(runInApp(context, `idify("Adventurer's Atlas")`), 'ADVENTURERS_ATLAS');

  runInApp(context, `document.getElementById('sourceYear').value = '2024';`);
  setExtractedData(context, {
    spell: [],
    archetype: archetypes,
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });
  const xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('ID_VSS_ARCHETYPE_FEATURE_ALCHEMIST_SPELLS'));
  assert.ok(!xml.includes('ID_VSS_ARCHETYPE_FEATURE_ALCHEMIST_ALCHEMIST_SPELLS'));
  assert.ok(xml.includes('ID_PROFICIENCY_TOOL_PROFICIENCY_ALCHEMISTS_SUPPLIES'));
  assert.ok(xml.includes('ID_WOTC_PHB24_SPELL_MELFS_ACID_ARROW'));
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

test('artificer subclass helper rules infer canonical repeated stats and selects', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  setExtractedData(context, {
    spell: [],
    archetype: [
      {
        name: 'Alchemist',
        class: 'Artificer',
        supports: 'Artificer Specialist',
        description: '',
        features: [{
          name: 'Experimental Elixir',
          level: 3,
          description: 'You magically produce two elixirs. You can make a total of three at level 5, four at level 9, and five at level 15.'
        }]
      },
      {
        name: 'Artillerist',
        class: 'Artificer',
        supports: 'Artificer Specialist',
        description: '',
        features: [{ name: 'Eldritch Cannon', level: 3, description: 'You create an Eldritch Cannon.' }]
      },
      {
        name: 'Battle Smith',
        class: 'Artificer',
        supports: 'Artificer Specialist',
        description: '',
        features: [{ name: 'Steel Defender', level: 3, description: 'Your tinkering has borne you a companion, a Steel Defender.' }]
      },
      {
        name: 'Cartographer',
        class: 'Artificer',
        supports: 'Artificer Specialist',
        description: '',
        features: [
          { name: "Adventurer's Atlas", level: 3, description: 'You create maps up to a maximum number of creatures equal to 1 plus your Intelligence modifier.' },
          { name: 'Superior Atlas', level: 15, description: "The creature's Hit Points instead change to a number equal to twice your Artificer level." }
        ]
      }
    ],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<stat name="alchemist:elixirs:max" value="2" level="3" />'));
  assert.ok(xml.includes('<stat name="alchemist:elixirs:max" value="1" level="15" />'));
  assert.equal((xml.match(/<stat name="cannon:hp" value="level:artificer" \/>/g) || []).length, 5);
  assert.ok(xml.includes('<select type="Companion" name="Steel Defender" supports="VSS Steel Defender" default="ID_VSS_COMPANION_ARTIFICER_STEEL_DEFENDER" />'));
  assert.ok(xml.includes('<stat name="atlas:targets" value="intelligence:modifier" />'));
  assert.equal((xml.match(/<stat name="atlas:safe haven:hp" value="level:artificer" \/>/g) || []).length, 2);
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

test('2024 species parse compact creature type size speed metadata', () => {
  const context = loadApp();
  const text = [
    '## Species Descriptions',
    '### Changeling',
    'With ever-changing appearances, changelings reside in many societies undetected.',
    '*Creature Type: Humanoid; Size: Small or Medium; Speed: 30 ft.*',
    '**Changeling Instincts.**',
    'Thanks to your connection to the fey realm, you gain proficiency in two skills.',
    '**Shape-Shifter.**',
    'As an action, you can shape-shift to change your appearance and your voice.',
    '### Kalashtar',
    'Kalashtar are linked to quori spirits.',
    '*Creature Type: Humanoid; Size: Medium; Speed: 30 ft.*',
    '**Dual Mind.**',
    'You have Advantage on Wisdom and Charisma saving throws.'
  ].join('\n');

  const races = context.parseRacesFromText(text);

  assert.equal(races.length, 2);
  assert.equal(races[0].name, 'Changeling');
  assert.equal(races[0].size, 'Small');
  assert.equal(races[0].speed, 30);
  assert.equal(races[0].traits.map(trait => trait.name).join('|'), 'Changeling Instincts|Shape-Shifter');
  assert.equal(races[1].name, 'Kalashtar');
  assert.equal(races[1].traits.map(trait => trait.name).join('|'), 'Dual Mind');
});

test('race ability score rules are gated against background ASI', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [{
      name: 'Testborn',
      size: 'Medium',
      speed: 30,
      languages: ['Common'],
      languageChoices: '',
      abilityScores: { strength: 2, charisma: 1 },
      description: 'A test species.',
      traits: []
    }],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<!-- Source rule: Increase strength by 2 unless a background provides ability scores. -->'));
  assert.ok(xml.includes('<stat name="strength" value="2" requirements="!ID_INTERNAL_GRANTS_BACKGROUND_ASI" />'));
  assert.ok(xml.includes('<stat name="charisma" value="1" requirements="!ID_INTERNAL_GRANTS_BACKGROUND_ASI" />'));
  assert.ok(!xml.includes('ID_INTERNAL_GRANT_RACE_TESTBORN'));
});

test('2024 species XML mirrors canonical Aurora race trait shape', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  const text = [
    '## Species Descriptions',
    '### Changeling',
    '*Creature Type: Humanoid; Size: Small or Medium; Speed: 30 ft.*',
    '**Changeling Instincts.**',
    'You gain proficiency in two of the following skills of your choice: Deception, Insight, Intimidation, Performance, or Persuasion.',
    '**Shape-Shifter.**',
    'As an action, you can change your appearance.',
    '### Khoravar',
    '*Creature Type: Humanoid; Size: Small or Medium; Speed: 30 ft.*',
    '**Darkvision.**',
    'You have Darkvision with a range of 60 feet.',
    '**Fey Gift.**',
    'You know the Friends cantrip. Intelligence, Wisdom, or Charisma is your spellcasting ability for it.',
    '**Skill Versatility.**',
    'You gain proficiency in one skill or with one tool of your choice.',
    '### Shifter',
    '*Creature Type: Humanoid; Size: Small or Medium; Speed: 30 ft.*',
    '**Bestial Instincts.**',
    'You gain proficiency in one of the following skills of your choice: Acrobatics, Athletics, Intimidation, or Survival.',
    '**Shifting.**',
    'When you shift, you gain Temporary Hit Points equal to 2 times your Proficiency Bonus. Choose Beasthide: You gain more temporary hit points. Longtooth: You can bite. Swiftstride: Your speed increases. Wildhunt: You focus your senses.',
    '### Warforged',
    '*Creature Type: Humanoid; Size: Small or Medium; Speed: 30 ft.*',
    '**Construct Resilience.**',
    'You have Resistance to Poison damage.',
    '**Integrated Protection.**',
    'You gain a +1 bonus to your Armor Class.',
    '**Specialized Design.**',
    'You gain one skill proficiency and one tool proficiency of your choice.'
  ].join('\n');

  const races = context.parseRacesFromText(text);
  setExtractedData(context, { spell: [], archetype: [], item: [], feat: [], magic: [], race: races, background: [], class: [], other: [] });
  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<select type="Racial Trait" name="Size (Changeling)" supports="ID_INTERNAL_RACIAL_TRAIT_SMALL|ID_INTERNAL_RACIAL_TRAIT_MEDIUM" />'));
  assert.ok(xml.includes('<grant type="Racial Trait" id="ID_VSS_RACIAL_TRAIT_CHANGELING_INSTINCTS" />'));
  assert.ok(!xml.includes('ID_VSS_RACIAL_TRAIT_CHANGELING_CHANGELING_INSTINCTS'));
  assert.ok(xml.includes('<select type="Proficiency" name="Changeling Instincts" number="2" supports="Skill,(Deception||Insight||Intimidation||Performance||Persuasion)" />'));
  assert.ok(xml.includes('<grant type="Grants" id="ID_INTERNAL_GRANT_RACE_HALF_ELF" />'));
  assert.ok(xml.includes('<grant type="Spell" id="ID_WOTC_PHB24_SPELL_FRIENDS" />'));
  assert.ok(xml.includes('<select type="Racial Trait" name="Spellcasting Ability (Khoravar)" supports="Khoravar Spellcasting Ability" />'));
  assert.ok(xml.includes('<element name="Intelligence (Khoravar)" type="Racial Trait" source="Validator Sample Source" id="ID_VSS_RACIAL_TRAIT_KHORAVAR_INTELLIGENCE">'));
  assert.ok(xml.includes('<select type="Racial Trait" name="Shifting Form (Shifter)" supports="VSS Shifter Form" />'));
  assert.ok(xml.includes('<element name="Beasthide" type="Racial Trait" source="Validator Sample Source" id="ID_VSS_RACIAL_TRAIT_SHIFTER_BEASTHIDE">'));
  assert.ok(xml.includes('<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_POISON" />'));
  assert.ok(xml.includes('<stat name="ac:misc" value="1" />'));
  assert.ok(xml.includes('<select type="Proficiency" name="Skill Proficiency (Warforged)" supports="Skill" />'));
  assert.ok(xml.includes('<select type="Proficiency" name="Tool Proficiency (Warforged)" supports="Tool" />'));
});

test('2024-style backgrounds do not require background feature blocks', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
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
  assert.ok(xml.includes('<ul class="unstyled" style="text-indent:-1em; margin-left:1em; margin-bottom:5px">'));
  assert.ok(xml.includes('<div class="reference">'));
  assert.ok(xml.includes('<!-- Source rule: Choose +2/+1 or +1/+1/+1 among Strength, Constitution, Charisma. -->'));
  assert.ok(xml.includes('<grant type="Ability Score Improvement" id="ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_STR_CON_CHA" />'));
  assert.ok(xml.includes('<grant type="Grants" id="ID_INTERNAL_GRANTS_BACKGROUND_ASI" />'));
  assert.ok(xml.includes('<grant type="Feat" id="ID_VSS_FEAT_ABERRANT_DRAGONMARK" />'));
  assert.ok(xml.includes('<set name="short">Strength, Constitution, Charisma, Aberrant Dragonmark Feat, History and Intimidation Skills, Disguise Kit</set>'));
  assert.equal(context.checkCompleteness(backgrounds[0], 'background').keep, true);
});

test('2024 background short text and choice tool selects match canonical phrasing', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  const text = [
    'House Agent',
    'Ability Scores: Strength, Intelligence, Charisma',
    'Feat: Lucky',
    'Skill Proficiencies: Investigation and Persuasion',
    "Tool Proficiency: Choose one kind of Artisan's Tools",
    'Equipment: Choose A or B'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);
  setExtractedData(context, { spell: [], archetype: [], item: [], feat: [], magic: [], race: [], background: backgrounds, class: [], other: [] });
  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<set name="short">Strength, Intelligence, Charisma, Lucky Feat, Investigation and Persuasion Skills, one Artisan\'s Tool</set>'));
  assert.ok(xml.includes('<select type="Proficiency" name="Artisan\'s Tool (House Agent)" supports="Artisan tools" />'));
});

test('unknown-year backgrounds default to 2014 direct ability grants', () => {
  const context = loadApp();
  const text = [
    'Wandering Student',
    'Ability Scores: Dexterity, Intelligence, Wisdom',
    'Feat: Skilled',
    'Skill Proficiencies: History and Survival',
    "Tool Proficiencies: Cartographer's Tools",
    'You studied maps and old roads.'
  ].join('\n');

  const backgrounds = context.parseBackgroundsFromText(text);
  setExtractedData(context, { spell: [], archetype: [], item: [], feat: [], magic: [], race: [], background: backgrounds, class: [], other: [] });
  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<stat name="dexterity" value="1" />'));
  assert.ok(xml.includes('<stat name="intelligence" value="1" />'));
  assert.ok(xml.includes('<stat name="wisdom" value="1" />'));
  assert.ok(!xml.includes('ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_DEX_INT_WIS'));
  assert.ok(!xml.includes('ID_INTERNAL_GRANTS_BACKGROUND_ASI'));
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

test('dragonmark and epic boon feat rules infer Aurora supports and spell grants', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2025';`);
  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [
      {
        name: 'Mark of Storm',
        prerequisite: "Eberron campaign; can't already have a Dragonmark feat",
        description: '',
        benefits: [
          "Storm's Boon. You have Resistance to Lightning damage.",
          "Storm Magic. You know the Thunderclap cantrip. When you reach character level 3, you also always have the Gust of Wind spell prepared.",
          "Spells of the Mark. If you have the Spellcasting or Pact Magic class feature, the spells on the Mark of Storm Spells table are added to that feature's spell list. | Spell Level | Spells | | --- | --- | | 1 | Feather Fall, Fog Cloud |"
        ]
      },
      {
        name: 'Greater Mark of Handling',
        prerequisite: 'mark of handling; Level 4',
        description: 'Ability Score Increase. Increase one ability score of your choice by 1, to a maximum of 20.',
        benefits: [
          'Subdue Animal. The target must succeed on a Wisdom saving throw (DC 8 plus your Wisdom modifier and Proficiency Bonus).'
        ]
      },
      {
        name: 'Greater Mark of Hospitality',
        prerequisite: 'mark of hospitality; Level 4',
        description: 'Ability Score Increase. Increase one ability score of your choice by 1, to a maximum of 20.',
        benefits: [
          "Improved Hospitality. A creature gains Temporary Hit Points equal to your Proficiency Bonus plus your Intelligence, Wisdom, or Charisma modifier (choose when you select this feat)."
        ]
      },
      {
        name: 'Potent Dragonmark',
        prerequisite: 'Level 4',
        description: 'Ability Score Increase. Increase the spellcasting ability score used by your Dragonmark feat by 1, to a maximum of 20.',
        benefits: [
          "Dragonmark Spellcasting. The spell slot's level is half your level (round up), to a maximum of level 5."
        ]
      },
      {
        name: 'Boon of Siberys',
        prerequisite: 'Level 19; Eberron campaign',
        description: 'Ability Score Increase. Increase one ability score of your choice by 1, to a maximum of 20.',
        benefits: [
          'Aberrant Magic. Choose a level 8 or lower spell from the Sorcerer spell list.'
        ]
      }
    ],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<supports>Dragonmark</supports>'));
  assert.ok(xml.includes('<supports>Epic Boon</supports>'));
  assert.ok(xml.includes('<grant type="Spell" id="ID_WOTC_PHB24_SPELL_THUNDERCLAP" prepared="true" />'));
  assert.ok(xml.includes('<grant type="Spell" id="ID_WOTC_PHB24_SPELL_GUST_OF_WIND" prepared="true" level="3" />'));
  assert.ok(xml.includes('<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_LIGHTNING" />'));
  assert.ok(xml.includes('<select type="Feat Feature" name="Spellcasting Ability (Mark of Storm)" supports="ID_VSS_FEAT_FEATURE_DRAGONMARK_INTELLIGENCE|ID_VSS_FEAT_FEATURE_DRAGONMARK_WISDOM|ID_VSS_FEAT_FEATURE_DRAGONMARK_CHARISMA" />'));
  assert.ok(xml.includes('<grant type="Feat Feature" id="ID_VSS_FEAT_FEATURE_MARK_OF_STORM_SPELLS_OF_THE_MARK" />'));
  assert.ok(xml.includes('<element name="Spells of the Mark" type="Feat Feature" source="Validator Sample Source" id="ID_VSS_FEAT_FEATURE_MARK_OF_STORM_SPELLS_OF_THE_MARK">'));
  assert.ok(xml.includes('<extend>ID_WOTC_PHB24_SPELL_FEATHER_FALL</extend>'));
  assert.ok(xml.includes('<element name="Intelligence" type="Feat Feature" source="Validator Sample Source" id="ID_VSS_FEAT_FEATURE_DRAGONMARK_INTELLIGENCE">'));
  assert.ok(xml.includes('<select type="Ability Score Improvement" name="Ability Score Increase (Greater Mark of Handling)" supports="Ability Score Increase" />'));
  assert.ok(xml.includes('<stat name="subdue animal:dc" value="wisdom:modifier" />'));
  assert.ok(xml.includes('<select type="Feat Feature" name="Hospitality Ability (Greater Mark of Hospitality)" supports="ID_VSS_FEAT_FEATURE_GREATER_MARK_OF_HOSPITALITY_INTELLIGENCE|ID_VSS_FEAT_FEATURE_GREATER_MARK_OF_HOSPITALITY_WISDOM|ID_VSS_FEAT_FEATURE_GREATER_MARK_OF_HOSPITALITY_CHARISMA" />'));
  assert.ok(xml.includes('<element name="Charisma" type="Feat Feature" source="Validator Sample Source" id="ID_VSS_FEAT_FEATURE_GREATER_MARK_OF_HOSPITALITY_CHARISMA">'));
  assert.ok(xml.includes('<stat name="hospitality:temp hp" value="charisma:modifier" bonus="ability" />'));
  assert.ok(xml.includes('<stat name="potent dragonmark:slot level" value="level:half:up" maximum="5" />'));
  assert.ok(xml.includes('<select type="Ability Score Improvement" name="Ability Score Increase (Boon of Siberys)" supports="Ability Score Increase, 30" />'));
  assert.ok(xml.includes('<select type="Spell" name="Siberys Spell (Boon of Siberys)" supports="Sorcerer,(1||2||3||4||5||6||7||8)" />'));
});

test('spell XML uses canonical sparse setters', () => {
  const context = loadApp();
  runInApp(context, `document.getElementById('sourceYear').value = '2024';`);
  setExtractedData(context, {
    spell: [{
      name: 'Clean Spark',
      level: 1,
      school: 'Evocation',
      castingTime: 'Action',
      range: '60 feet',
      hasVerbal: true,
      hasSomatic: false,
      hasMaterial: false,
      material: '',
      duration: 'Instantaneous',
      isRitual: false,
      isConcentration: false,
      classes: ['Wizard'],
      description: 'A precise spark leaps to a target.'
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<set name="level">1</set>\n\t\t\t<set name="school">Evocation</set>'));
  assert.ok(xml.includes('<set name="hasVerbalComponent">true</set>'));
  assert.ok(!xml.includes('<set name="keywords"></set>'));
  assert.ok(!xml.includes('<set name="isRitual">false</set>'));
  assert.ok(!xml.includes('<set name="hasSomaticComponent">false</set>'));
  assert.ok(!xml.includes('<set name="hasMaterialComponent">false</set>'));
  assert.ok(!xml.includes('<set name="materialComponent"></set>'));
  assert.ok(!xml.includes('<set name="isConcentration">false</set>'));
});

test('spell XML defaults to legacy explicit setters for unknown-year sources', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [{
      name: 'Clean Spark',
      level: 1,
      school: 'Evocation',
      castingTime: 'Action',
      range: '60 feet',
      hasVerbal: true,
      hasSomatic: false,
      hasMaterial: false,
      material: '',
      duration: 'Instantaneous',
      isRitual: false,
      isConcentration: false,
      classes: ['Wizard'],
      description: 'A precise spark leaps to a target.'
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('<set name="keywords"></set>'));
  assert.ok(xml.includes('<set name="hasSomaticComponent">false</set>'));
  assert.ok(xml.includes('<set name="hasMaterialComponent">false</set>'));
  assert.ok(xml.includes('<set name="materialComponent" />'));
  assert.ok(xml.includes('<set name="isConcentration">false</set>'));
  assert.ok(xml.includes('<set name="isRitual">false</set>'));
});

test('spell supports and inferred keywords follow source ruleset', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [{
      name: 'Flame Verdict',
      level: 1,
      school: 'Evocation',
      castingTime: 'Action',
      range: '60 feet',
      hasVerbal: true,
      hasSomatic: true,
      hasMaterial: false,
      material: '',
      duration: 'Instantaneous',
      isRitual: false,
      isConcentration: false,
      classes: ['Wizard'],
      description: 'A target makes a Dexterity saving throw. On a failed save, it takes fire damage.',
      higherLevels: 'The damage increases by 1d6 for each slot level above 1.'
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  });

  let xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('<supports>Wizard, Spell Saving Throw</supports>'));
  assert.ok(!xml.includes('Damaging Spell'));
  assert.ok(xml.includes('<set name="keywords">fire, dexterity, save, damage, saving throws, saves, higher levels</set>'));

  runInApp(context, `document.getElementById('sourceYear').value = '2024';`);
  xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('<supports>Wizard, Spell Saving Throw, Damaging Spell</supports>'));
  assert.ok(xml.includes('<set name="keywords">fire, dexterity, save, damage, saving throws, saves, upcasting, higher-level spell slot</set>'));
});

test('spell upcast wording follows source ruleset', () => {
  const context = loadApp();
  const sampleData = {
    spell: [{
      name: 'Scaling Spark',
      level: 1,
      school: 'Evocation',
      castingTime: 'Action',
      range: '60 feet',
      hasVerbal: true,
      hasSomatic: true,
      hasMaterial: false,
      material: '',
      duration: 'Instantaneous',
      isRitual: false,
      isConcentration: false,
      classes: ['Wizard'],
      description: 'A spark leaps to a target.',
      higherLevels: 'The damage increases by 1d6 for each slot level above 1.'
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  };

  setExtractedData(context, sampleData);
  let xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('<b><i>At Higher Levels.</i></b>'));
  assert.ok(!xml.includes('Using a Higher-Level Spell Slot.'));

  runInApp(context, `document.getElementById('sourceYear').value = '2024';`);
  xml = runInApp(context, 'generateXml()');
  assert.ok(xml.includes('<b><i>Using a Higher-Level Spell Slot.</i></b>'));
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
  assert.ok(xml.includes('<!-- Source rule: Gain proficiency in arcana. -->'));
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

test('review edits are one-off unless explicitly remembered', () => {
  const context = loadApp();
  const sampleData = {
    spell: [{
      name: 'Memory Spark',
      school: 'Evocation',
      level: 1,
      castingTime: '1 Action',
      range: '30 feet',
      duration: 'Instantaneous',
      hasVerbal: true,
      hasSomatic: true,
      hasMaterial: false,
      isConcentration: false,
      isRitual: false,
      classes: ['Wizard'],
      description: 'A brief flare of light.',
      higherLevels: ''
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  };

  setExtractedData(context, sampleData);
  runInApp(context, `
    captureGeneratedBaseline();
    extractedData.spell[0].range = '60 feet';
    extractedData = JSON.parse(JSON.stringify(generatedBaselineData));
    captureGeneratedBaseline();
    applyRememberedOverridesToExtractedData();
  `);

  const range = runInApp(context, `extractedData.spell[0].range`);
  assert.equal(range, '30 feet');
});

test('remembered corrections opt in to future parse application and can be forgotten', () => {
  const context = loadApp();
  const sampleData = {
    spell: [{
      name: 'Memory Spark',
      school: 'Evocation',
      level: 1,
      castingTime: '1 Action',
      range: '30 feet',
      duration: 'Instantaneous',
      hasVerbal: true,
      hasSomatic: true,
      hasMaterial: false,
      isConcentration: false,
      isRitual: false,
      classes: ['Wizard'],
      description: 'A brief flare of light.',
      higherLevels: ''
    }],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: []
  };

  setExtractedData(context, sampleData);
  runInApp(context, `
    captureGeneratedBaseline();
    extractedData.spell[0].range = '60 feet';
    rememberOverride('spell-0');
    extractedData = JSON.parse(JSON.stringify(generatedBaselineData));
    captureGeneratedBaseline();
  `);
  const applied = runInApp(context, `applyRememberedOverridesToExtractedData()`);
  assert.equal(applied, 1);
  assert.equal(runInApp(context, `extractedData.spell[0].range`), '60 feet');

  runInApp(context, `
    forgetOverride('spell-0');
    extractedData = JSON.parse(JSON.stringify(generatedBaselineData));
    captureGeneratedBaseline();
  `);
  const appliedAfterForget = runInApp(context, `applyRememberedOverridesToExtractedData()`);
  assert.equal(appliedAfterForget, 0);
  assert.equal(runInApp(context, `extractedData.spell[0].range`), '30 feet');
});

test('manual authoring initializes empty data buckets', () => {
  const context = loadApp();

  runInApp(context, `
    extractedData = {};
    startManualAuthoring();
  `);
  const bucketLengths = JSON.parse(runInApp(context, `
    JSON.stringify(['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other']
      .map(type => [type, extractedData[type].length]))
  `));

  assert.deepEqual(Object.fromEntries(bucketLengths), {
    spell: 0,
    archetype: 0,
    item: 0,
    feat: 0,
    magic: 0,
    race: 0,
    background: 0,
    class: 0,
    other: 0
  });
});

test('manual other elements export with their custom Aurora type', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [],
    class: [],
    other: [{
      name: 'Shield Guardian',
      type: 'Companion',
      description: 'A construct bound to a control amulet.',
      features: [{ name: 'Bound', description: 'The guardian obeys its wearer.' }]
    }]
  });

  const zipDocs = JSON.parse(runInApp(context, 'JSON.stringify(buildZipXmlDocuments(getSourceMeta()))'));
  const companionDoc = zipDocs.find(doc => doc.fileName === 'vss-companion.xml');

  assert.ok(companionDoc);
  assert.ok(companionDoc.xml.includes('type="Companion"'));
  assert.ok(companionDoc.xml.includes('ID_VSS_COMPANION_SHIELD_GUARDIAN'));
  assert.ok(companionDoc.xml.includes('type="Companion Feature"'));
  assert.ok(zipDocs.find(doc => doc.fileName === 'source.xml').xml.includes('vss-companion.xml'));
});

test('generated XML comments are safe when source text contains comment delimiters', () => {
  const context = loadApp();
  setExtractedData(context, {
    spell: [],
    archetype: [],
    item: [],
    feat: [],
    magic: [],
    race: [],
    background: [{
      name: 'Delimiter Tester',
      description: 'A background for comment safety.',
      skillProficiencies: [],
      abilityScores: [],
      feat: 'Bad -- Feat',
      toolProficiencies: ['Bad -- Tool'],
      languages: [],
      equipment: '',
      features: []
    }],
    class: [],
    other: [{
      name: 'Oddity',
      type: 'Bad -- Type',
      description: 'An odd generated element.',
      features: []
    }]
  });

  const xml = runInApp(context, 'generateXml()');

  assert.ok(xml.includes('BAD - - TYPE'));
  assert.ok(xml.includes('Background feat: Bad - - Feat - include'));
  assert.ok(xml.includes('Tool proficiency: Bad - - Tool - add ID manually'));
  const commentBodies = Array.from(xml.matchAll(/<!--([\s\S]*?)-->/g)).map(match => match[1]);
  assert.ok(commentBodies.some(comment => comment.includes('BAD - - TYPE')));
  assert.ok(commentBodies.some(comment => comment.includes('Bad - - Feat')));
  assert.ok(commentBodies.some(comment => comment.includes('Bad - - Tool')));
  assert.ok(commentBodies.every(comment => !comment.includes('--')));
});

test('legacy AI helpers are disabled in deterministic mode', async () => {
  const context = loadApp();
  let fetchCalls = 0;
  context.fetch = () => {
    fetchCalls += 1;
    throw new Error('network should not be called');
  };

  const ranges = await runInApp(context, `discoverPageRanges('AAAA', false, () => { throw new Error('progress should not run'); })`);
  await runInApp(context, `detectSourceMeta('AAAA', false)`);
  await runInApp(context, `testKey()`);
  await runInApp(context, `testOllama()`);
  await assert.rejects(runInApp(context, `geminiRaw('AAAA', false, 'prompt')`), /AI extraction is disabled/);
  await assert.rejects(runInApp(context, `ollamaRaw('text', 'prompt')`), /AI extraction is disabled/);
  await assert.rejects(runInApp(context, `callModel(null, 'AAAA', 'spell', () => {})`), /AI extraction is disabled/);

  assert.equal(JSON.stringify(ranges), '{}');
  assert.equal(fetchCalls, 0);
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

test('browser Aurora validator catches duplicate element IDs in one document', () => {
  const context = loadApp();
  const elementNode = attrs => ({
    tagName: 'element',
    getAttribute(name) { return attrs[name] || ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  const updateNode = {
    getAttribute(name) { return name === 'version' ? '0.1.0' : ''; },
    querySelectorAll(selector) {
      return selector === 'file'
        ? [{ getAttribute(name) { return name === 'name' ? 'duplicate.xml' : 'duplicate.xml'; } }]
        : [];
    }
  };
  const infoNode = {
    querySelector(selector) {
      if (selector === 'update') return updateNode;
      return null;
    }
  };
  context.DOMParser = class DOMParser {
    parseFromString() {
      return {
        querySelector() { return null; },
        documentElement: {
          tagName: 'elements',
          children: [
            elementNode({ name: 'First', type: 'Feat', source: 'Duplicate Fixture', id: 'ID_DUPLICATE_FIXTURE_FEAT_REPEAT' }),
            elementNode({ name: 'Second', type: 'Feat', source: 'Duplicate Fixture', id: 'ID_DUPLICATE_FIXTURE_FEAT_REPEAT' })
          ],
          querySelector(selector) {
            if (selector === 'info') return infoNode;
            return null;
          }
        }
      };
    }
  };
  const issues = JSON.parse(runInApp(context, `
    JSON.stringify(validateAuroraXmlDocuments([{
      fileName: 'duplicate.xml',
      xml: '<elements></elements>'
    }], 'Unit Test'))
  `));

  assert.ok(issues.some(issue => issue.msg.includes('DuplicateElementIds') && issue.msg.includes('duplicate.xml')));
});
