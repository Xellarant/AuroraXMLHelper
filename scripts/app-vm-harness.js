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

function loadApp(sourceMeta = {}, options = {}) {
  const storage = {};
  const defaults = {
    name: 'Fixture Source',
    abbr: 'FIX',
    author: 'Fixture Author',
    year: '',
    ...(options.defaults || {})
  };
  const elements = {
    sourceName: createStubElement(sourceMeta.name || defaults.name),
    sourceAbbr: createStubElement(sourceMeta.abbr || defaults.abbr),
    sourceAuthor: createStubElement(sourceMeta.author || defaults.author),
    sourceYear: createStubElement(sourceMeta.year || defaults.year),
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
    alert() {},
    setTimeout: options.immediateTimers === false
      ? setTimeout
      : function immediateTimeout(callback) {
        if (typeof callback === 'function') callback();
        return 0;
      },
    clearTimeout: options.immediateTimers === false ? clearTimeout : function clearImmediateTimeout() {}
  };

  vm.createContext(context);
  for (const scriptPath of [
    path.join(repoRoot, 'src', 'aurora-xml-shape.js'),
    path.join(repoRoot, 'src', 'pdf-text-layout.js'),
    path.join(repoRoot, 'src', 'pdf-page-range.js'),
    path.join(repoRoot, 'src', 'app.js')
  ]) {
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context, {
      filename: path.relative(repoRoot, scriptPath).replace(/\\/g, '/')
    });
  }
  return { context, elements };
}

function runInApp(context, code) {
  return vm.runInContext(code, context);
}

module.exports = {
  ELEMENT_TYPES,
  PARSERS,
  repoRoot,
  createStubElement,
  loadApp,
  runInApp
};
