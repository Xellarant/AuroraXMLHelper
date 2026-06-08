const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

const ELEMENT_TYPES = ['spell', 'archetype', 'feat', 'magic', 'item', 'race', 'background', 'class'];
const PARSERS = {
  spell: 'parseSpellsFromText',
  archetype: 'parseArchetypesFromText',
  feat: 'parseFeatsFromText',
  magic: 'parseMagicItemsFromText',
  item: 'parseItemsFromText',
  race: 'parseRacesFromText',
  background: 'parseBackgroundsFromText',
  class: 'parseClassesFromText'
};

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
      toggle() {},
      contains() { return true; }
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

function loadApp(sourceMeta = {}) {
  const elements = {
    sourceName: createStubElement(sourceMeta.name || 'Fixture Source'),
    sourceAbbr: createStubElement(sourceMeta.abbr || 'FIX'),
    sourceAuthor: createStubElement(sourceMeta.author || 'Fixture Author'),
    sourceYear: createStubElement(sourceMeta.year || ''),
    pageRange: createStubElement('')
  };
  const fallbackElement = createStubElement();
  const document = {
    getElementById(id) {
      return elements[id] || fallbackElement;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return createStubElement(); },
    addEventListener() {},
    documentElement: { dataset: {} }
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
    alert() {},
    setTimeout(callback) {
      if (typeof callback === 'function') callback();
      return 0;
    },
    clearTimeout() {}
  };
  vm.createContext(context);
  const appScript = fs.readFileSync(path.join(repoRoot, 'src', 'app.js'), 'utf8');
  vm.runInContext(appScript, context, { filename: 'src/app.js' });
  return { context, elements };
}

function runInApp(context, code) {
  return vm.runInContext(code, context);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveFixturePath(fixtureFile, relativePath) {
  return path.resolve(path.dirname(fixtureFile), relativePath);
}

function generateFromFixtureFile(fixtureFile) {
  const fixture = readJson(fixtureFile);
  return generateFromFixture(fixture, fixtureFile);
}

function generateFromFixture(fixture, fixtureFile = '') {
  const sourceFile = fixtureFile
    ? resolveFixturePath(fixtureFile, fixture.source)
    : path.resolve(repoRoot, fixture.source);
  const sourceText = fs.readFileSync(sourceFile, 'utf8');
  const sourceMeta = fixture.sourceMeta || {};
  const { context, elements } = loadApp(sourceMeta);
  runInApp(context, `detectSourceMetaFromText([{ page: 1, text: ${JSON.stringify(sourceText)} }]);`);
  if (sourceMeta.name) elements.sourceName.value = sourceMeta.name;
  if (sourceMeta.abbr) elements.sourceAbbr.value = sourceMeta.abbr;
  if (sourceMeta.author) elements.sourceAuthor.value = sourceMeta.author;
  if (sourceMeta.year) elements.sourceYear.value = String(sourceMeta.year);

  const types = fixture.types || ELEMENT_TYPES;
  const data = {};
  for (const type of ELEMENT_TYPES) data[type] = [];
  data.other = [];
  for (const type of types) {
    const parserName = PARSERS[type];
    if (!parserName) throw new Error(`Unsupported fixture type: ${type}`);
    const parsed = context[parserName](sourceText);
    data[type] = type === 'feat' ? parsed.map(feat => context.parseFeatFullText(feat)) : parsed;
  }
  runInApp(context, `extractedData = ${JSON.stringify(data)};`);
  const xml = runInApp(context, 'generateXml()');
  const meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  return { fixture, sourceFile, sourceText, data, xml, meta };
}

module.exports = {
  ELEMENT_TYPES,
  repoRoot,
  generateFromFixtureFile,
  generateFromFixture
};
