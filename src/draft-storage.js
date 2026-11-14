(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AuroraDraftStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'aurora_xml_helper_draft_v1';
  const FORMAT = 'aurora-xml-helper-draft';
  const MAX_LENGTH = 4 * 1024 * 1024;
  const MAX_FILE_LENGTH = 50 * 1024 * 1024;
  const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const docs = value => Array.isArray(value) && value.every(doc => object(doc) && typeof doc.fileName === 'string' && typeof doc.xml === 'string');
  const buckets = value => object(value) && Object.entries(value).every(([type, items]) =>
    ['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'].includes(type)
    && Array.isArray(items) && items.every(object));

  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function validateState(state) {
    const review = state?.reviewContext;
    if (review != null && (!object(review) || review.kind !== 'pdf' || typeof review.fileName !== 'string'
      || !Array.isArray(review.types) || !review.types.every(type => ['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'].includes(type))
      || ![review.selectedPages, review.continuationPages].every(pages => Array.isArray(pages) && pages.every(page => Number.isInteger(page) && page > 0)))) {
      throw failure('invalid', 'This draft has invalid source review details.');
    }
    if (!object(state) || !['parse', 'repair', 'author'].includes(state.workspace)
      || !object(state.fields) || !Object.values(state.fields).every(value => typeof value === 'string')
      || !object(state.sourceFlags) || !['abbrEdited', 'rulesetEvidence'].every(key => typeof state.sourceFlags[key] === 'string')
      || !Array.isArray(state.selectedTypes)
      || !state.selectedTypes.every(type => typeof type === 'string')
      || !buckets(state.data) || !buckets(state.baseline) || !Array.isArray(state.skipped)
      || !object(state.pageRanges) || typeof state.changed !== 'boolean'
      || !object(state.author) || !['templateId', 'fileName', 'originalXml', 'xml'].every(key => typeof state.author[key] === 'string')
      || !object(state.repair) || !docs(state.repair.inputDocs) || !docs(state.repair.originalDocs)
      || !docs(state.repair.docs) || !(state.repair.undoDocs === null || docs(state.repair.undoDocs))
      || typeof state.repair.inspected !== 'boolean') {
      throw failure('invalid', 'This draft has an invalid or incomplete workspace.');
    }
    return state;
  }

  function encode(state, savedAt = new Date().toISOString(), maxLength = MAX_LENGTH) {
    const raw = JSON.stringify({ format: FORMAT, version: 1, savedAt, state: validateState(state) });
    if (raw.length > maxLength) throw failure('size', maxLength === MAX_LENGTH
      ? 'This draft is too large for automatic saving. Export a draft file to keep your work.'
      : 'This workspace is too large for one draft file. Download your XML files separately.');
    decode(raw, maxLength);
    return raw;
  }

  function decode(raw, maxLength = MAX_LENGTH) {
    if (typeof raw !== 'string' || raw.length > maxLength) throw failure('invalid', 'This draft file is too large or unreadable.');
    let entry;
    try {
      entry = JSON.parse(raw, (key, value) => {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsupported property');
        return value;
      });
    } catch {
      throw failure('invalid', 'The saved draft could not be read. It has been left untouched.');
    }
    if (entry?.format !== FORMAT || entry.version !== 1) throw failure('version', 'This draft uses an unsupported format or version. It has been left untouched.');
    if (typeof entry.savedAt !== 'string' || !Number.isFinite(Date.parse(entry.savedAt))) throw failure('invalid', 'This draft has no valid save date.');
    validateState(entry.state);
    return entry;
  }

  function createStore(storage) {
    let lastRaw;
    function readRaw() {
      try { return storage.getItem(KEY); }
      catch { throw failure('storage', 'Draft saving is unavailable in this browser. Export a draft file to keep your work.'); }
    }
    function load() {
      lastRaw = readRaw();
      return lastRaw === null ? null : decode(lastRaw);
    }
    function checkCurrent(overwrite) {
      if (!overwrite && readRaw() !== lastRaw) throw failure('conflict', 'Another tab changed the saved draft. Automatic saving is paused to protect both copies. Export this tab’s draft or choose Save this tab.');
    }
    return {
      load,
      save(state, { overwrite = false } = {}) {
        const raw = encode(state);
        checkCurrent(overwrite);
        try { storage.setItem(KEY, raw); }
        catch { throw failure('storage', 'The browser could not save this draft. The previous saved copy is unchanged. Export a draft file to keep your latest work.'); }
        lastRaw = raw;
        return decode(raw);
      },
      clear() {
        // Clearing is an explicit user action, including for unreadable drafts.
        try { storage.removeItem(KEY); }
        catch { throw failure('storage', 'The browser could not remove the saved draft.'); }
        lastRaw = null;
      }
    };
  }

  return { KEY, FORMAT, MAX_LENGTH, MAX_FILE_LENGTH, validateState, encode, decode, createStore };
});
