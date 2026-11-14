(function () {
  'use strict';
  let store;
  let timer;
  let ready = false;
  let dirty = false;
  let blocked = false;
  let lastState = '';
  const status = () => document.getElementById('draftStatus');

  function notice(message, warning = false) {
    status().textContent = message;
    status().className = warning ? 'alert alert-warning' : 'text-muted';
  }

  function failed(error) {
    blocked = true;
    notice(error.message || 'Draft saving failed. Export a draft file to keep your work.', true);
    document.getElementById('draftRetry').classList.remove('hidden');
  }

  function flush({ overwrite = false } = {}) {
    clearTimeout(timer);
    if (!ready || (!dirty && !overwrite) || (blocked && !overwrite)) return;
    try {
      const state = window.AuroraXMLHelper.captureWorkspaceDraft();
      const serialized = JSON.stringify(state);
      if (serialized === lastState && !overwrite) { dirty = false; return; }
      const entry = store.save(state, { overwrite });
      lastState = serialized;
      blocked = false;
      dirty = false;
      document.getElementById('draftRetry').classList.add('hidden');
      notice(`Draft saved in this browser at ${new Date(entry.savedAt).toLocaleTimeString()}.`);
    } catch (error) { failed(error); }
  }

  function changed() {
    if (!ready) return;
    dirty = true;
    clearTimeout(timer);
    if (!blocked) timer = setTimeout(flush, 500);
  }

  function download() {
    try {
      // File exports are allowed to exceed the smaller autosave limit.
      const api = window.AuroraDraftStorage;
      const state = api.validateState(window.AuroraXMLHelper.captureWorkspaceDraft());
      const raw = api.encode(state, undefined, api.MAX_FILE_LENGTH);
      const blob = new Blob([raw], { type: 'application/json' });
      if (blob.size > api.MAX_FILE_LENGTH) throw new Error('This workspace is too large for one draft file. Download your XML files separately.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'aurora-workspace-draft.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notice(error.message, true); }
  }

  window.AuroraDraftRecovery = { changed, flush };

  function restore(state) {
    const previous = window.AuroraXMLHelper.captureWorkspaceDraft();
    try { window.AuroraXMLHelper.restoreWorkspaceDraft(state); }
    catch (error) {
      window.AuroraXMLHelper.restoreWorkspaceDraft(previous);
      throw error;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const api = window.AuroraDraftStorage;
    try {
      store = api.createStore(window.localStorage);
      const entry = store.load();
      if (entry) {
        restore(entry.state);
        notice(`Draft restored from ${new Date(entry.savedAt).toLocaleString()}. To parse the PDF again, reselect the original file.`);
      }
      lastState = JSON.stringify(window.AuroraXMLHelper.captureWorkspaceDraft());
    } catch (error) { failed(error); }
    ready = true;

    document.addEventListener('input', event => {
      if (event.target.closest('main') && event.target.type !== 'file') changed();
    });
    document.addEventListener('change', event => {
      if (event.target.closest('main') && event.target.type !== 'file') changed();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', () => flush());
    window.addEventListener('beforeunload', event => {
      flush();
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('storage', event => {
      if (event.key === api.KEY || event.key === null) {
        clearTimeout(timer);
        failed(new Error('Another tab changed the saved draft. Automatic saving is paused. Export this tab’s draft or choose Save this tab.'));
      }
    });
    document.getElementById('draftExport').addEventListener('click', download);
    document.getElementById('draftImportButton').addEventListener('click', () => document.getElementById('draftImport').click());
    document.getElementById('draftRetry').addEventListener('click', () => {
      if (!window.confirm('Replace the saved draft with this tab’s current work? Export a draft first if you want to keep both copies.')) return;
      try {
        if (!store) store = api.createStore(window.localStorage);
        flush({ overwrite: true });
      } catch (error) { failed(error); }
    });
    document.getElementById('draftClear').addEventListener('click', () => {
      if (!window.confirm('Delete the saved draft from this browser? Your open work stays here and the next edit will save a new draft.')) return;
      try {
        if (!store) store = api.createStore(window.localStorage);
        store.clear();
        clearTimeout(timer);
        blocked = false;
        dirty = false;
        lastState = JSON.stringify(window.AuroraXMLHelper.captureWorkspaceDraft());
        document.getElementById('draftRetry').classList.add('hidden');
        notice('Saved draft cleared. Your open work is unchanged; the next edit will save a new draft.');
      } catch (error) { failed(error); }
    });
    document.getElementById('draftImport').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > api.MAX_FILE_LENGTH) throw new Error('This draft file is too large to import.');
        const entry = api.decode(await file.text(), api.MAX_FILE_LENGTH);
        if (!window.confirm('Replace your open workspace with this draft file? Export your current draft first if you want to keep it.')) return;
        ready = false;
        restore(entry.state);
        ready = true;
        changed();
        flush();
      } catch (error) { notice(error.message, true); }
      finally { ready = true; event.target.value = ''; }
    });
  });
})();
