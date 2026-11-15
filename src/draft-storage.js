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
  const ELEMENT_TYPES = ['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'];
  const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const docs = value => Array.isArray(value) && value.every(doc => object(doc) && typeof doc.fileName === 'string' && typeof doc.xml === 'string');
  const buckets = value => object(value) && Object.entries(value).every(([type, items]) =>
    ELEMENT_TYPES.includes(type)
    && Array.isArray(items) && items.every(item => elementRecord(type, item)));
  const availability = value => value == null || object(value)
    && Array.isArray(value.base) && value.base.every(entry => object(entry) && typeof entry.name === 'string')
    && Array.isArray(value.conditional) && value.conditional.every(entry => object(entry)
      && ['owner', 'kind', 'access', 'condition'].every(field => typeof entry[field] === 'string')
      && (entry._reviewed == null || typeof entry._reviewed === 'boolean')
      && (entry.levelUnclear == null || typeof entry.levelUnclear === 'boolean')
      && (entry.levelField == null || ['level', 'spellLevel'].includes(entry.levelField))
      && (entry.level == null || Number.isInteger(entry.level) && entry.level >= 1 && entry.level <= 20)
      && (entry.spellLevel == null || Number.isInteger(entry.spellLevel) && entry.spellLevel >= 0 && entry.spellLevel <= 9))
    && Array.isArray(value.conflicts) && value.conflicts.every(entry => object(entry) && typeof entry.message === 'string')
    && ['_conditionalOnlyConfirmed', '_conflictsReviewed'].every(field => value[field] == null || typeof value[field] === 'boolean');

  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function sourceReference(value) {
    if (value == null) return true;
    if (!object(value)) return false;
    for (const collection of ['related', 'progression']) {
      if (value[collection] != null && (!Array.isArray(value[collection])
        || !value[collection].every(entry => object(entry) && sourceReference(entry)))) return false;
    }
    return true;
  }

  function elementRecord(type, value) {
    if (!object(value)) return false;
    if (!sourceReference(value._source)) return false;
    // Incomplete entries remain editable. Reject shapes that would crash the
    // editors before restoration can safely replace the current workspace.
    for (const field of ['name', 'description', 'fullText', 'higherLevels', 'prerequisite', 'class', 'supports']) {
      if (value[field] != null && typeof value[field] !== 'string') return false;
    }
    for (const field of ['classes', 'languages', 'savingThrows', 'armorProficiencies', 'weaponProficiencies',
      'toolProficiencies', 'skillProficiencies', 'benefits']) {
      if (value[field] != null && (!Array.isArray(value[field]) || !value[field].every(entry => typeof entry === 'string'))) return false;
    }
    for (const field of ['features', 'traits', 'actions', 'reactions', 'subraces']) {
      if (value[field] != null && (!Array.isArray(value[field]) || !value[field].every(entry => object(entry)
        && sourceReference(entry._source)
        && ['name', 'description', 'action', 'usage'].every(name => entry[name] == null || typeof entry[name] === 'string')))) return false;
    }
    if (type === 'background' && value.abilityScores != null
      && (!Array.isArray(value.abilityScores) || !value.abilityScores.every(entry => typeof entry === 'string'))) return false;
    if (type === 'race' && value.abilityScores != null && !object(value.abilityScores)) return false;
    if (value.skillChoices != null && (!object(value.skillChoices)
      || value.skillChoices.from != null && (!Array.isArray(value.skillChoices.from) || !value.skillChoices.from.every(entry => typeof entry === 'string')))) return false;
    return true;
  }

  function classProgression(value) {
    if (value.progression != null && (!Array.isArray(value.progression) || !value.progression.every(row => object(row)
      && typeof row.level === 'number' && Array.isArray(row.features) && row.features.every(name => typeof name === 'string')
      && (row.slots == null || Array.isArray(row.slots))
      && (row._errors == null || Array.isArray(row._errors) && row._errors.every(error => typeof error === 'string'))))) return false;
    if (value.choices == null) return true; // Older drafts acquire choices when opened.
    return Array.isArray(value.choices) && value.choices.every(choice => object(choice)
      && ['name', 'feature', 'mode'].every(field => typeof choice[field] === 'string')
      && sourceReference(choice._source)
      && (choice.levels == null || Array.isArray(choice.levels) && choice.levels.every(level => typeof level === 'number'))
      && (choice.schedule == null || Array.isArray(choice.schedule) && choice.schedule.every(event => object(event)
        && typeof event.level === 'number' && typeof event.count === 'number'))
      && Array.isArray(choice.options) && choice.options.every(option => object(option)
        && sourceReference(option._source)
        && typeof option.name === 'string' && typeof option.description === 'string'));
  }

  function validElementRecord(type, value) {
    return ELEMENT_TYPES.includes(type) && elementRecord(type, value)
      && (type !== 'spell' || availability(value.availability))
      && (type !== 'class' || classProgression(value));
  }

  function validateState(state) {
    const review = state?.reviewContext;
    if (review != null && (!object(review) || review.kind !== 'pdf' || typeof review.fileName !== 'string'
      || !Array.isArray(review.types) || !review.types.every(type => ELEMENT_TYPES.includes(type))
      || ![review.selectedPages, review.continuationPages, review.availabilityPages || []].every(pages => Array.isArray(pages) && pages.every(page => Number.isInteger(page) && page > 0)))) {
      throw failure('invalid', 'This draft has invalid source review details.');
    }
    if (!object(state) || !['parse', 'repair', 'author'].includes(state.workspace)
      || !object(state.fields) || !Object.values(state.fields).every(value => typeof value === 'string')
      || !object(state.sourceFlags) || !['abbrEdited', 'rulesetEvidence'].every(key => typeof state.sourceFlags[key] === 'string')
      || !Array.isArray(state.selectedTypes)
      || !state.selectedTypes.every(type => ELEMENT_TYPES.includes(type))
      || !buckets(state.data) || !buckets(state.baseline) || !Array.isArray(state.skipped)
      || !state.skipped.every(entry => object(entry) && (entry.item == null || elementRecord(entry.elementType || entry.type, entry.item))
        && (entry.missing == null || Array.isArray(entry.missing) && entry.missing.every(field => typeof field === 'string')))
      || !object(state.pageRanges) || typeof state.changed !== 'boolean'
      || !object(state.author) || !['templateId', 'fileName', 'originalXml', 'xml'].every(key => typeof state.author[key] === 'string')
      || !object(state.repair) || !docs(state.repair.inputDocs) || !docs(state.repair.originalDocs)
      || !docs(state.repair.docs) || !(state.repair.undoDocs === null || docs(state.repair.undoDocs))
      || typeof state.repair.inspected !== 'boolean') {
      throw failure('invalid', 'This draft has an invalid or incomplete workspace.');
    }
    if (![...(state.data.spell || []), ...(state.baseline.spell || [])].every(spell => availability(spell.availability))) {
      throw failure('invalid', 'This draft has invalid spell availability details.');
    }
    if (![...(state.data.class || []), ...(state.baseline.class || [])].every(classProgression)) {
      throw failure('invalid', 'This draft has invalid class progression or choice details.');
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

  return { KEY, FORMAT, MAX_LENGTH, MAX_FILE_LENGTH, validElementRecord, validateState, encode, decode, createStore };
});
