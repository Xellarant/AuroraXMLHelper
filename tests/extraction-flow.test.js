const assert = require('node:assert/strict');
const { loadApp, runInApp, createStubElement } = require('../scripts/app-vm-harness');

const copy = value => JSON.parse(JSON.stringify(value));
const feat = name => ({ name, description: 'Original synthetic rules.', benefits: ['You can read a harmless signal.'] });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = name => ({ name, type: 'application/pdf', size: 100, arrayBuffer: async () => new ArrayBuffer(8) });

function extraction({ populated = true, skippedOnly = false } = {}) {
  const app = loadApp({ name: 'Existing Source', abbr: 'EXIST', author: 'Existing Author', year: '2016' });
  const { context, elements } = app;
  const type = createStubElement('feat');
  type.checked = true;
  elements.sourceAbbr.dataset.userEdited = '1';
  elements.sourceYear.dataset.rulesetEvidence = 'Existing evidence';
  const selected = [type];
  const controls = [elements.sourceName, elements.sourceYear, context.document.getElementById('pageRange'), type];
  elements.sourceYear.disabled = true;
  context.document.querySelectorAll = selector => {
    if (selector === '.type-check input:checked') return selected.filter(input => input.checked);
    if (selector === '.type-check input') return selected;
    if (selector === '#stepUpload input, #stepOptions input, #stepOptions select, #stepOptions button') return controls;
    return [];
  };
  context.window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument() { throw new Error('Test must provide PDF extraction'); } };
  const data = Object.fromEntries(['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'].map(type => [type, []]));
  if (populated && !skippedOnly) data.feat.push(feat('Existing Feat'));
  const skipped = skippedOnly || populated ? [{ name: 'Incomplete Spell', elementType: 'spell', type: 'Spells', missing: ['description'], item: { name: 'Incomplete Spell', classes: [] } }] : [];
  runInApp(context, 'extractedData = ' + JSON.stringify(data) + '; generatedBaselineData = ' + JSON.stringify(data)
    + '; skippedItems = ' + JSON.stringify(skipped) + '; discoveredPageRanges = { feat: [2, 3] };'
    + 'sourceReviewContext = { kind: "pdf", fileName: "existing.pdf", types: ["feat"], selectedPages: [2], continuationPages: [], availabilityPages: [] };');
  return { ...app, selected, controls, snapshot: () => copy(context.window.AuroraXMLHelper.captureWorkspaceDraft()) };
}

function setDriver(context, driver) {
  context.extractionDriver = driver;
  runInApp(context, 'deterministicExtract = (...args) => extractionDriver(...args);');
}

test('the shared in-page confirmation defaults to cancel and restores focus when closed', async () => {
  const { context, elements } = extraction({ populated: false });
  const handlers = new Map();
  let previousFocused = 0, cancelFocused = 0;
  context.document.activeElement = { focus() { previousFocused++; } };
  const dialog = createStubElement();
  dialog.open = false;
  dialog.addEventListener = (name, handler) => handlers.set(name, handler);
  dialog.removeEventListener = (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); };
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = value => {
    if (value !== undefined) dialog.returnValue = value;
    dialog.open = false;
    handlers.get('close')?.();
  };
  elements.workspaceConfirm = dialog;
  context.document.getElementById('workspaceConfirmCancel').focus = () => { cancelFocused++; };
  const accepted = context.confirmAction('Replace this workspace?', { title: 'Review replacement', acceptLabel: 'Replace' });
  assert.equal(dialog.open, true);
  assert.equal(elements.workspaceConfirmTitle.textContent, 'Review replacement');
  assert.equal(elements.workspaceConfirmMessage.textContent, 'Replace this workspace?');
  assert.equal(elements.workspaceConfirmAccept.textContent, 'Replace');
  assert.equal(cancelFocused, 1);
  assert.equal(context.confirmAction('A competing confirmation'), false);
  dialog.close();
  assert.equal(await accepted, false);
  assert.equal(previousFocused, 1);
  const confirmed = context.confirmAction('Try again');
  dialog.close('accept');
  assert.equal(await confirmed, true);
  assert.equal(previousFocused, 2);
});

test('declining replacement confirmation leaves work intact and releases the busy state', async () => {
  const { context, snapshot } = extraction();
  const before = snapshot();
  let calls = 0;
  context.confirm = () => false;
  context.setFile(file('Replacement.pdf'));
  setDriver(context, async () => { calls++; return { feat: [feat('Unwanted Feat')] }; });
  assert.equal(await context.startExtraction(), false);
  assert.equal(calls, 0);
  assert.equal(runInApp(context, 'extractionBusy'), false);
  assert.deepEqual(snapshot().data, before.data);
  assert.deepEqual(snapshot().fields, before.fields);
});

test('selecting and removing a new PDF preserves the existing source metadata and parsed work', () => {
  const { context, snapshot } = extraction();
  const before = snapshot();
  assert.equal(context.setFile(file('Replacement_Source_2025.pdf')), true);
  assert.deepEqual(snapshot().fields, before.fields);
  assert.deepEqual(snapshot().data, before.data);
  context.clearFile();
  assert.equal(runInApp(context, 'pdfFile'), null);
  assert.deepEqual(snapshot().fields, before.fields);
  assert.deepEqual(snapshot().data, before.data);
});

test('a first PDF selection preserves source details already typed before selecting the file', () => {
  const { context, snapshot } = extraction({ populated: false });
  const before = snapshot();
  assert.equal(context.setFile(file('Different_Name_2025.pdf')), true);
  context.clearFile();
  assert.deepEqual(snapshot().fields, before.fields);
  assert.deepEqual(snapshot().sourceFlags, before.sourceFlags);
});

test('an invalid replacement file leaves the selected PDF, source, and existing entries intact', () => {
  const { context, elements, snapshot } = extraction();
  const original = file('Valid.pdf');
  context.setFile(original);
  const before = snapshot();
  assert.equal(context.setFile({ name: 'not-a-pdf.txt', type: 'text/plain', size: 10 }), false);
  assert.equal(runInApp(context, 'pdfFile'), original);
  assert.deepEqual(snapshot().fields, before.fields);
  assert.deepEqual(snapshot().data, before.data);
  assert.match(elements.fileSizeWarning.textContent, /Choose a PDF.*current work has been kept/);
});

test('failed extraction rolls back records, baselines, skipped work, source metadata, and source context', async () => {
  const { context, elements, snapshot } = extraction();
  const before = snapshot();
  context.setFile(file('Replacement_2025.pdf'));
  setDriver(context, async () => {
    elements.sourceAuthor.value = 'Detected different author';
    elements.sourceYear.dataset.rulesetEvidence = 'Detected new evidence';
    runInApp(context, 'sourceReviewContext = null; discoveredPageRanges = {};');
    throw new Error('Unreadable PDF');
  });
  assert.equal(await context.startExtraction(), false);
  const after = snapshot();
  for (const field of ['data', 'baseline', 'skipped', 'fields', 'sourceFlags', 'reviewContext', 'pageRanges']) assert.deepEqual(after[field], before[field], field);
  assert.equal(runInApp(context, 'extractionBusy'), false);
  assert.equal(elements.sourceName.disabled, false);
  assert.equal(elements.sourceYear.disabled, true, 'Previously disabled controls must stay disabled.');
  assert.match(elements.extractErrors.textContent, /Parsing did not replace your work.*could not be read.*save a new copy/);
});

test('successful extraction replaces the entries and baseline only after parsing resolves', async () => {
  const { context, elements, snapshot } = extraction();
  const started = deferred();
  const result = deferred();
  context.setFile(file('Replacement_2025.pdf'));
  setDriver(context, async () => { started.resolve(); return result.promise; });
  const parsing = context.startExtraction();
  await started.promise;
  assert.equal(snapshot().data.feat[0].name, 'Existing Feat');
  result.resolve({ feat: [feat('Replacement Feat')] });
  assert.equal(await parsing, true);
  const after = snapshot();
  assert.equal(after.data.feat[0].name, 'Replacement Feat');
  assert.equal(after.baseline.feat[0].name, 'Replacement Feat');
  assert.deepEqual(after.skipped, []);
  assert.equal(elements.sourceName.value, 'Replacement 2025');
  assert.equal(elements.sourceYear.value, '2025');
  assert.equal(runInApp(context, 'extractionBusy'), false);
});

test('a draft captured during parsing pairs old entries with their original source details', async () => {
  const { context, elements, snapshot } = extraction();
  const before = snapshot();
  const started = deferred(), result = deferred();
  context.setFile(file('Replacement_2025.pdf'));
  setDriver(context, async () => { started.resolve(); return result.promise; });
  const parsing = context.startExtraction();
  await started.promise;
  try {
    assert.equal(elements.sourceName.value, 'Replacement 2025', 'The active parsing UI can display pending source details.');
    const captured = snapshot();
    assert.deepEqual(captured.data, before.data);
    assert.deepEqual(captured.baseline, before.baseline);
    for (const field of ['sourceName', 'sourceAbbr', 'sourceAuthor', 'sourceYear']) assert.equal(captured.fields[field], before.fields[field], field);
    assert.deepEqual(captured.sourceFlags, before.sourceFlags);
    assert.deepEqual(captured.reviewContext, before.reviewContext);
  } finally {
    context.cancelExtraction();
    result.resolve({ feat: [feat('Discarded pending result')] });
    await parsing;
  }
});

test('an empty extraction keeps previous parsed and previously skipped-only work', async () => {
  for (const skippedOnly of [false, true]) {
    const { context, snapshot } = extraction({ skippedOnly });
    const before = snapshot();
    context.setFile(file('Empty_2025.pdf'));
    setDriver(context, async () => ({ feat: [] }));
    assert.equal(await context.startExtraction(), false);
    assert.deepEqual(snapshot().data, before.data);
    assert.deepEqual(snapshot().skipped, before.skipped);
    assert.deepEqual(snapshot().fields, before.fields);
  }
});

test('cancellation invalidates the parser callback and discards a late successful result', async () => {
  const { context, elements, snapshot } = extraction();
  const before = snapshot();
  const started = deferred(), result = deferred();
  let report, isCurrent;
  context.setFile(file('Replacement_2025.pdf'));
  setDriver(context, async (file, types, progress, options) => {
    report = progress; isCurrent = options.isCurrent;
    started.resolve();
    return result.promise;
  });
  const parsing = context.startExtraction();
  await started.promise;
  assert.equal(isCurrent(), true);
  context.cancelExtraction();
  assert.equal(isCurrent(), false);
  elements.progressMsg.textContent = 'Current progress after cancellation';
  report(99, 'Stale progress from cancelled parse');
  assert.equal(elements.progressMsg.textContent, 'Current progress after cancellation');
  result.resolve({ feat: [feat('Late Feat')] });
  assert.equal(await parsing, false);
  assert.deepEqual(snapshot().data, before.data);
  assert.deepEqual(snapshot().fields, before.fields);
  assert.equal(runInApp(context, 'extractionBusy'), false);
});

test('restoring a draft invalidates a pending extraction so its late result cannot overwrite imported work', async () => {
  const { context, snapshot } = extraction();
  const imported = snapshot();
  imported.data = { feat: [feat('Imported Feat')] };
  imported.baseline = copy(imported.data);
  imported.fields.sourceName = 'Imported source';
  const started = deferred(), result = deferred();
  context.setFile(file('Pending_2025.pdf'));
  setDriver(context, async () => { started.resolve(); return result.promise; });
  const parsing = context.startExtraction();
  await started.promise;
  context.window.AuroraXMLHelper.restoreWorkspaceDraft(imported);
  result.resolve({ feat: [feat('Stale PDF Feat')] });
  assert.equal(await parsing, false);
  assert.equal(snapshot().data.feat[0].name, 'Imported Feat');
  assert.equal(snapshot().fields.sourceName, 'Imported source');
  assert.equal(runInApp(context, 'pdfFile'), null);
});

test('a second parse or file replacement cannot start while a parse is active', async () => {
  const { context } = extraction();
  const started = deferred(), result = deferred();
  const firstFile = file('First.pdf');
  let calls = 0;
  context.setFile(firstFile);
  setDriver(context, async () => { calls++; started.resolve(); return result.promise; });
  const first = context.startExtraction();
  await started.promise;
  assert.equal(await context.startExtraction(), false);
  assert.equal(context.setFile(file('Second.pdf')), false);
  assert.equal(runInApp(context, 'pdfFile'), firstFile);
  assert.equal(calls, 1);
  result.resolve({ feat: [feat('Finished Feat')] });
  assert.equal(await first, true);
});

test('cancelling while replacement confirmation is pending never starts the parser', async () => {
  const { context, snapshot } = extraction();
  const before = snapshot(), confirmation = deferred();
  context.confirmAction = () => confirmation.promise;
  let calls = 0;
  setDriver(context, async () => { calls++; return { feat: [feat('Unexpected Feat')] }; });
  context.setFile(file('Pending.pdf'));
  const parsing = context.startExtraction();
  assert.equal(runInApp(context, 'extractionBusy'), true);
  context.cancelExtraction();
  confirmation.resolve(true);
  assert.equal(await parsing, false);
  assert.equal(calls, 0);
  assert.deepEqual(snapshot().data, before.data);
  assert.deepEqual(snapshot().fields, before.fields);
});

test('metadata edits made after selecting a replacement PDF are respected when parsing succeeds', async () => {
  const { context, elements } = extraction();
  context.setFile(file('Replacement_2025.pdf'));
  elements.sourceName.value = 'Chosen source title';
  elements.sourceAuthor.value = 'Chosen source author';
  elements.sourceYear.value = '2020';
  elements.sourceAbbr.value = 'CHOSEN';
  setDriver(context, async () => ({ feat: [feat('New Feat')] }));
  assert.equal(await context.startExtraction(), true);
  assert.equal(elements.sourceName.value, 'Chosen source title');
  assert.equal(elements.sourceAuthor.value, 'Chosen source author');
  assert.equal(elements.sourceYear.value, '2020');
  assert.equal(elements.sourceAbbr.value, 'CHOSEN');
});

test('opening manual authoring keeps previously skipped entries available to restore', () => {
  const { context, snapshot } = extraction({ skippedOnly: true });
  const before = snapshot();
  context.startManualAuthoring();
  assert.deepEqual(snapshot().skipped, before.skipped);
});

test('a cancelled slow PDF load cannot replace the active PDF document of a newer extraction', async () => {
  const { context } = extraction({ populated: false });
  const oldLoad = deferred(), oldRequested = deferred(), newPage = deferred(), newStarted = deferred();
  let oldCurrent = true, newCurrent = true, calls = 0, oldDestroyed = 0, newDestroyed = 0;
  const oldPdf = { numPages: 1, getPage: async () => ({}), destroy: async () => { oldDestroyed++; } };
  const newPdf = { numPages: 1, getPage: async () => { newStarted.resolve(); return newPage.promise; }, destroy: async () => { newDestroyed++; } };
  context.window.pdfjsLib.getDocument = () => {
    calls++;
    if (calls === 1) { oldRequested.resolve(); return { promise: oldLoad.promise }; }
    return { promise: Promise.resolve(newPdf) };
  };
  const old = context.extractPdfPages(file('Old.pdf'), { isCurrent: () => oldCurrent });
  const oldRejected = assert.rejects(old, /Parsing cancelled/);
  await oldRequested.promise;
  oldCurrent = false;
  const newer = context.extractPdfPages(file('New.pdf'), { isCurrent: () => newCurrent });
  const newerRejected = assert.rejects(newer, /Parsing cancelled/);
  await newStarted.promise;
  oldLoad.resolve(oldPdf);
  await oldRejected;
  assert.equal(runInApp(context, 'activePdfDocument'), newPdf);
  assert.equal(oldDestroyed, 1);
  newCurrent = false;
  context.invalidateExtraction();
  await Promise.resolve();
  assert.ok(newDestroyed >= 1, 'Cancelling the newer extraction must still destroy its document.');
  newPage.resolve({});
  await newerRejected;
});

test('cancelled page and layout promises cannot write stale progress or start later layout work', async () => {
  for (const duringLayout of [false, true]) {
    const { context, elements } = extraction({ populated: false });
    const page = deferred(), layout = deferred(), requested = deferred(), layoutStarted = deferred();
    let current = true, layoutCalls = 0, destroyed = 0;
    const pdf = { numPages: 1, getPage: async () => { requested.resolve(); return page.promise; }, destroy: async () => { destroyed++; } };
    context.window.pdfjsLib.getDocument = () => ({ promise: Promise.resolve(pdf) });
    context.window.AuroraPdfTextLayout = { extractPageLayout: async () => { layoutCalls++; layoutStarted.resolve(); return layout.promise; } };
    const reading = context.extractPdfPages(file('Pending.pdf'), { isCurrent: () => current });
    const rejected = assert.rejects(reading, /Parsing cancelled/);
    await requested.promise;
    if (duringLayout) { page.resolve({}); await layoutStarted.promise; }
    current = false;
    elements.progressMsg = context.document.getElementById('progressMsg');
    elements.progressMsg.textContent = 'New extraction progress';
    if (duringLayout) layout.resolve({ lines: ['Discarded source text'] }); else page.resolve({});
    await rejected;
    assert.equal(elements.progressMsg.textContent, 'New extraction progress');
    assert.equal(layoutCalls, duringLayout ? 1 : 0);
    assert.equal(destroyed, 1);
  }
});

test('cancelling an unresolved PDF loading task destroys it and preserves existing work', async () => {
  const { context, snapshot } = extraction();
  const before = snapshot(), requested = deferred(), loading = deferred();
  let destroyed = 0;
  const task = { promise: loading.promise, destroy: async () => { destroyed++; loading.reject(new Error('Loading cancelled')); } };
  context.window.pdfjsLib.getDocument = () => { requested.resolve(); return task; };
  context.setFile(file('Slow_Load.pdf'));
  const parsing = context.startExtraction();
  await requested.promise;
  try {
    context.cancelExtraction();
    await Promise.resolve();
    assert.ok(destroyed >= 1, 'Cancel must destroy the loading task before a PDF proxy exists.');
    assert.equal(await parsing, false);
    assert.deepEqual(snapshot().data, before.data);
    assert.deepEqual(snapshot().fields, before.fields);
    assert.equal(runInApp(context, 'activePdfDocument'), null);
  } finally {
    loading.reject(new Error('Ensure the test loading promise is settled'));
    await parsing;
  }
});

test('cancellation while the PDF library loads prevents even reading the file buffer', async () => {
  const { context } = extraction({ populated: false });
  const library = deferred();
  let current = true, buffers = 0, loads = 0;
  context.ensurePdfJsLoaded = () => library.promise;
  const selected = { ...file('Cancelled.pdf'), arrayBuffer: async () => { buffers++; return new ArrayBuffer(8); } };
  const reading = context.extractPdfPages(selected, { isCurrent: () => current });
  const rejected = assert.rejects(reading, /Parsing cancelled/);
  current = false;
  library.resolve({ GlobalWorkerOptions: {}, getDocument() { loads++; throw new Error('Stale load must not start'); } });
  await rejected;
  assert.equal(buffers, 0);
  assert.equal(loads, 0);
});

test('cancellation while the file buffer loads prevents starting a PDF worker', async () => {
  const { context } = extraction({ populated: false });
  const buffer = deferred(), requested = deferred();
  let current = true, loads = 0;
  context.window.pdfjsLib.getDocument = () => { loads++; throw new Error('Stale load must not start'); };
  const selected = { ...file('Cancelled.pdf'), arrayBuffer: async () => { requested.resolve(); return buffer.promise; } };
  const reading = context.extractPdfPages(selected, { isCurrent: () => current });
  const rejected = assert.rejects(reading, /Parsing cancelled/);
  await requested.promise;
  current = false;
  buffer.resolve(new ArrayBuffer(8));
  await rejected;
  assert.equal(loads, 0);
});

test('a failed PDF loading task is destroyed and its active handle is released', async () => {
  const { context } = extraction({ populated: false });
  let destroyed = 0;
  context.window.pdfjsLib.getDocument = () => ({ promise: Promise.reject(new Error('Malformed PDF')), destroy: async () => { destroyed++; } });
  await assert.rejects(context.extractPdfPages(file('Broken.pdf'), { isCurrent: () => true }), /Malformed PDF/);
  assert.equal(destroyed, 1);
  assert.equal(runInApp(context, 'activePdfDocument'), null);
});
