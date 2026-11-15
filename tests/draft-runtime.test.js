const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const draft = require('../src/draft-storage');
const { loadApp } = require('../scripts/app-vm-harness');

const copy = value => JSON.parse(JSON.stringify(value));
function state(name = '') {
  const value = loadApp().context.window.AuroraXMLHelper.captureWorkspaceDraft();
  value.fields.sourceName = name;
  return value;
}

function recovery({ saved = null, confirm = async () => true, restoreFailure } = {}) {
  let current = state();
  const values = new Map(saved == null ? [] : [[draft.KEY, saved]]);
  const listeners = { window: {}, document: {} };
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let failWrites = false;
  const element = id => {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const value = { value: '', textContent: '', className: '', files: [], handlers: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener(name, handler) { value.handlers[name] = handler; }, click() {} };
    elements.set(id, value);
    return value;
  };
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (failWrites) throw new Error('Quota exceeded'); values.set(key, value); },
    removeItem: key => values.delete(key)
  };
  const api = {
    captureWorkspaceDraft: () => copy(current),
    restoreWorkspaceDraft(value) {
      current = copy(value); // Deliberately mutate before failing to exercise rollback.
      if (restoreFailure?.(value)) throw new Error('Could not render imported draft');
    },
    confirmAction: confirm
  };
  const window = {
    AuroraXMLHelper: api, AuroraDraftStorage: draft, localStorage: storage,
    addEventListener: (name, handler) => { listeners.window[name] = handler; }
  };
  const context = vm.createContext({
    window, document: {
      getElementById: element,
      addEventListener: (name, handler) => { listeners.document[name] = handler; },
      createElement: () => element('download'),
      visibilityState: 'visible'
    }, Blob, Date, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/draft-recovery.js'), 'utf8'), context);
  listeners.window.DOMContentLoaded();
  const edit = name => {
    current.fields.sourceName = name;
    listeners.document.input({ target: { type: 'text', closest: () => ({}) } });
  };
  const importFile = (text, size = text.length) => {
    const input = element('draftImport');
    input.value = 'test.json';
    input.files = [{ size, text: typeof text === 'function' ? text : async () => text }];
    return input.handlers.change({ target: input });
  };
  return { api, window, listeners, elements, element, storage, values, edit, importFile,
    current: () => copy(current), flush: () => window.AuroraDraftRecovery.flush(),
    failWrites: value => { failWrites = value; } };
}

test('recovery flushes the final unblurred edit on pagehide and leaves a cleared draft absent', async () => {
  const runtime = recovery();
  runtime.edit('Last unblurred edit');
  runtime.listeners.window.pagehide();
  assert.equal(draft.decode(runtime.storage.getItem(draft.KEY)).state.fields.sourceName, 'Last unblurred edit');
  await runtime.element('draftClear').handlers.click();
  assert.equal(runtime.current().fields.sourceName, 'Last unblurred edit');
  runtime.listeners.window.pagehide();
  assert.equal(runtime.storage.getItem(draft.KEY), null);
  runtime.edit('A later edit');
  runtime.flush();
  assert.equal(draft.decode(runtime.storage.getItem(draft.KEY)).state.fields.sourceName, 'A later edit');
});

test('failed autosaves retain dirty work and warn before leaving while keeping the last saved copy', () => {
  const runtime = recovery({ saved: draft.encode(state('Previous saved work')) });
  const previous = runtime.storage.getItem(draft.KEY);
  runtime.failWrites(true);
  runtime.edit('Latest unsaved work');
  runtime.flush();
  let prevented = false;
  runtime.listeners.window.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(runtime.storage.getItem(draft.KEY), previous);
  assert.equal(runtime.current().fields.sourceName, 'Latest unsaved work');
  assert.match(runtime.element('draftStatus').textContent, /could not save/);
});

test('cancelling an asynchronous draft import preserves the open workspace and future autosaves', async () => {
  const runtime = recovery({ confirm: async () => false });
  runtime.edit('Keep this workspace');
  runtime.flush();
  await runtime.importFile(draft.encode(state('Cancelled imported work')));
  assert.equal(runtime.current().fields.sourceName, 'Keep this workspace');
  assert.equal(runtime.element('draftImport').value, '');
  runtime.edit('Still editable');
  runtime.flush();
  assert.equal(draft.decode(runtime.storage.getItem(draft.KEY)).state.fields.sourceName, 'Still editable');
});

test('a failed import rolls back partial restoration and retains the prior saved draft', async () => {
  const runtime = recovery({ saved: draft.encode(state('Original')), restoreFailure: value => value.fields.sourceName === 'Cannot render' });
  const previous = runtime.storage.getItem(draft.KEY);
  await runtime.importFile(draft.encode(state('Cannot render')));
  assert.equal(runtime.current().fields.sourceName, 'Original');
  assert.equal(runtime.storage.getItem(draft.KEY), previous);
  assert.match(runtime.element('draftStatus').textContent, /Could not render imported draft/);
});

test('an older slow file import cannot replace a newer chosen draft', async () => {
  const runtime = recovery();
  let finishFirst;
  const first = runtime.importFile(() => new Promise(resolve => { finishFirst = resolve; }), 10);
  await runtime.importFile(draft.encode(state('Newer import')));
  finishFirst(draft.encode(state('Older slow import')));
  await first;
  assert.equal(runtime.current().fields.sourceName, 'Newer import');
  assert.equal(draft.decode(runtime.storage.getItem(draft.KEY)).state.fields.sourceName, 'Newer import');
});

test('importing while another tab owns the save keeps that copy and explains the paused save', async () => {
  const runtime = recovery({ saved: draft.encode(state('First copy')) });
  const other = draft.encode(state('Other tab work'));
  runtime.storage.setItem(draft.KEY, other);
  runtime.listeners.window.storage({ key: draft.KEY });
  await runtime.importFile(draft.encode(state('Imported into this tab')));
  assert.equal(runtime.current().fields.sourceName, 'Imported into this tab');
  assert.equal(runtime.storage.getItem(draft.KEY), other);
  assert.match(runtime.element('draftStatus').textContent, /imported into the open workspace.*paused/i);
  await runtime.element('draftRetry').handlers.click();
  assert.equal(draft.decode(runtime.storage.getItem(draft.KEY)).state.fields.sourceName, 'Imported into this tab');
});

test('malformed nested imported data is rejected before the current workspace is replaced', async () => {
  const valid = state('Good copy');
  const bad = copy(valid);
  bad.data.class = [{ name: 'Bad Class', features: 'not a feature list' }];
  const raw = JSON.stringify({ format: draft.FORMAT, version: 1, savedAt: new Date().toISOString(), state: bad });
  const runtime = recovery({ saved: draft.encode(valid) });
  await runtime.importFile(raw);
  assert.equal(runtime.current().fields.sourceName, 'Good copy');
  assert.match(runtime.element('draftStatus').textContent, /invalid or incomplete workspace/);
});
