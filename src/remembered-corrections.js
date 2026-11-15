(function attachCorrections(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AuroraCorrections = api;
  if (root.window) root.window.AuroraCorrections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCorrections() {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const safeKey = name => !name.startsWith('_') && !['constructor', 'prototype'].includes(name);
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const key = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();

  function content(value) {
    if (Array.isArray(value)) return value.map(content);
    if (!object(value)) return value;
    return Object.fromEntries(Object.keys(value).filter(safeKey).sort().map(name => [name, content(value[name])]));
  }

  const equal = (left, right) => JSON.stringify(content(left)) === JSON.stringify(content(right));

  function capture(baseline, item) {
    return { version: 2, baseline: content(baseline), item: content(item),
      fields: [...new Set([...Object.keys(baseline), ...Object.keys(item)])]
        .filter(name => safeKey(name) && !equal(baseline[name], item[name])) };
  }

  function identityFor(values) {
    if (values.every(value => object(value) && typeof value.name === 'string' && value.name.trim())) {
      return value => JSON.stringify([key(value.name), key(value.feature || '')]);
    }
    if (values.every(value => object(value) && Number.isInteger(value.level))) return value => 'level:' + value.level;
    if (values.every(value => object(value) && typeof value.owner === 'string' && value.owner.trim())) {
      return value => JSON.stringify([value.owner, value.kind, value.access, value.condition].map(value => key(value || '')));
    }
    return null;
  }

  function apply(current, record) {
    const issues = [];
    const hold = (path, reason) => {
      const field = path[0] || 'name';
      const label = path.join(' / ') || 'entry';
      issues.push({ field, message: 'Saved correction for ' + label + ' was not applied: ' + reason
        + ' Fresh source content was kept. Review the saved correction below, reapply the intended edits, then choose Remember Correction.' });
    };

    function mergeArray(fresh, before, after, path) {
      if (!Array.isArray(fresh)) { hold(path, 'the source no longer has the same list.'); return copy(fresh); }
      if ([...before, ...after].every(value => value === null || typeof value !== 'object')) {
        if (equal(fresh, before) || equal(fresh, after)) return copy(after);
        hold(path, 'this list changed in the new source.'); return copy(fresh);
      }
      const identify = identityFor([...before, ...after, ...fresh]);
      if (!identify) { hold(path, 'its entries cannot be matched safely.'); return copy(fresh); }
      const maps = [before, after, fresh].map(values => new Map(values.map(value => [identify(value), value])));
      if (maps.some((map, i) => map.size !== [before, after, fresh][i].length)) {
        hold(path, 'more than one entry has the same name or level.'); return copy(fresh);
      }
      const [oldEntries, edits, source] = maps;
      let result = copy(fresh);
      const issueCount = issues.length;
      for (const [id, original] of oldEntries) {
        const edited = edits.get(id);
        const present = source.get(id);
        if (!edits.has(id)) {
          if (present && !equal(present, original)) hold([...path, original.name || original.level], 'the entry marked for removal changed in the source.');
          else result = result.filter(value => identify(value) !== id);
        } else if (!equal(original, edited)) {
          if (!present) hold([...path, original.name || original.level], 'the edited entry is missing or was renamed in the source.');
          else result[result.findIndex(value => identify(value) === id)] = merge(present, original, edited, [...path, original.name || original.level]);
        }
      }
      for (const [id, edited] of edits) if (!oldEntries.has(id)) {
        if (!source.has(id)) result.push(copy(edited));
        else if (!equal(source.get(id), edited)) hold([...path, edited.name || edited.level], 'a different entry with that name or level is already present.');
      }
      // A partial list edit could turn a rename into a duplicate. Keep this list
      // intact when any of its edits are ambiguous; other top-level edits can apply.
      return issues.length === issueCount ? result : copy(fresh);
    }

    function merge(fresh, before, after, path) {
      if (equal(before, after)) return copy(fresh);
      if (Array.isArray(before) && Array.isArray(after)) return mergeArray(fresh, before, after, path);
      if (object(after) && (object(before) || before === undefined) && object(fresh)) {
        const result = copy(fresh);
        for (const name of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
          if (!safeKey(name) || equal(before?.[name], after[name])) continue;
          if (!Object.hasOwn(after, name)) {
            if (Object.hasOwn(fresh, name) && !equal(fresh[name], before[name])) hold([...path, name], 'this value changed in the source.');
            else delete result[name];
          } else result[name] = merge(fresh[name], before?.[name], after[name], [...path, name]);
        }
        return result;
      }
      // Structural replacements cannot discard an improved source value.
      if ((Array.isArray(after) || object(after) || Array.isArray(before) || object(before)) && !equal(fresh, before)) {
        hold(path, 'the source structure changed.'); return copy(fresh);
      }
      return content(after);
    }

    if (record.version === 2) return { item: merge(current, record.baseline, record.item, []), issues };
    const item = copy(current);
    if (!Array.isArray(record.fields)) hold([], 'this older correction has no field history.');
    else for (const field of record.fields) {
      if (!safeKey(field) || !Object.hasOwn(record.item, field)) continue;
      if (Array.isArray(record.item[field]) || object(record.item[field])) hold([field], 'this older correction has no history for matching individual entries.');
      else item[field] = record.item[field];
    }
    return { item, issues };
  }

  function describe(value, depth = 0) {
    if (value == null) return '(empty)';
    if (Array.isArray(value)) return value.length ? value.map(entry => describe(entry, depth)).join('\n\n') : '(empty list)';
    if (!object(value)) return String(value);
    return Object.entries(value).filter(([name]) => safeKey(name)).map(([name, entry]) =>
      '  '.repeat(depth) + name.replace(/([a-z])([A-Z])/g, '$1 $2') + ': '
      + (object(entry) || Array.isArray(entry) ? '\n' + describe(entry, depth + 1) : describe(entry, depth))).join('\n');
  }

  return { capture, apply, content, describe };
});
