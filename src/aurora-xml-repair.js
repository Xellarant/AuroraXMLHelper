(function attachAuroraXmlRepair(root, factory) {
  const patterns = (typeof module === 'object' && module.exports)
    ? require('./aurora-xml-patterns')
    : root?.AuroraXmlPatterns;
  const shape = (typeof module === 'object' && module.exports)
    ? require('./aurora-xml-shape')
    : root?.AuroraXmlShape;
  const api = factory(root, patterns, shape);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AuroraXmlRepair = api;
  if (root?.window) root.window.AuroraXmlRepair = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAuroraXmlRepair(root, patterns, shape) {
  function getPatterns() {
    const api = patterns || root?.AuroraXmlPatterns;
    if (!api?.analyzeAuroraXmlDocuments) throw new Error('Aurora XML pattern support is not loaded.');
    return api;
  }

  function getShape() {
    return shape || root?.AuroraXmlShape || null;
  }

  // Attribute edits run before insertions so a combined anchor edit stays predictable.
  const KIND_ORDER = {
    'set-element-attribute': 0,
    'regenerate-element-id': 0,
    'set-rule-attribute': 0,
    'rename-setter': 0,
    'replace-reference-id': 0,
    'replace-supports-text': 0,
    'rename-tag': 0,
    'insert-setter': 1,
    'insert-snippet': 1
  };

  function isApplicableKind(kind) {
    return Object.prototype.hasOwnProperty.call(KIND_ORDER, kind);
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function lineIndent(xml, index) {
    const lineStart = String(xml || '').lastIndexOf('\n', Math.max(0, index - 1)) + 1;
    return (String(xml || '').slice(lineStart, index).match(/^[ \t]*/) || [''])[0];
  }

  function resolveRepairValue(repair, values = {}) {
    const supplied = values[repair.id];
    if (supplied !== undefined && supplied !== null && String(supplied).trim() !== '') return String(supplied).trim();
    if (repair.replacementValue !== undefined && repair.replacementValue !== null && String(repair.replacementValue) !== '') {
      return String(repair.replacementValue);
    }
    return null;
  }

  function repairNeedsValue(repair) {
    return repair.replacementValue === undefined || repair.replacementValue === null || String(repair.replacementValue) === '';
  }

  function isRepairApplicable(repair) {
    return Boolean(repair && isApplicableKind(repair.kind) && repair.anchor && Number.isFinite(repair.anchor.start));
  }

  function transformAnchor(text, repair, value, context) {
    const { setTagAttribute } = getPatterns();
    switch (repair.kind) {
      case 'set-element-attribute':
      case 'set-rule-attribute':
      case 'regenerate-element-id':
      case 'rename-setter':
        return setTagAttribute(text, repair.attribute, value);
      case 'replace-reference-id': {
        const current = String(repair.currentValue || '');
        if (!current) return null;
        const pattern = new RegExp(`(^|[^A-Za-z0-9_])${current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
        if (!pattern.test(text)) return null;
        pattern.lastIndex = 0;
        return text.replace(pattern, (match, lead) => `${lead}${value}`);
      }
      case 'replace-supports-text':
        if (!/<supports\b[^>]*>[\s\S]*?<\/supports>/i.test(text)) return null;
        return text.replace(/(<supports\b[^>]*>)[\s\S]*?(<\/supports>)/i, (match, open, close) => `${open}${escapeText(value)}${close}`);
      case 'rename-tag': {
        const from = String(repair.fromTag || '');
        const to = String(repair.toTag || value || '');
        if (!from || !to) return null;
        const pattern = new RegExp(`^<${from}\\b([^>]*)>([\\s\\S]*)</${from}>$`);
        if (!pattern.test(text)) return null;
        return text.replace(pattern, `<${to}$1>$2</${to}>`);
      }
      case 'insert-setter': {
        const setter = `<set name="${repair.setterName}">${escapeText(value)}</set>`;
        if (repair.anchor.mode === 'after-setters-open') {
          if (context.inlineAfter) return `${text}${setter}`;
          return `${text}\n${context.indent}  ${setter}`;
        }
        if (repair.anchor.mode === 'after-element-open') {
          if (/\/>\s*$/.test(text)) return null;
          // A previous insert in this group already created the setters block.
          const created = text.match(/\n[ \t]*<setters>/);
          if (created) {
            const insertAt = created.index + created[0].length;
            return `${text.slice(0, insertAt)}\n${context.indent}    ${setter}${text.slice(insertAt)}`;
          }
          return `${text}\n${context.indent}  <setters>\n${context.indent}    ${setter}\n${context.indent}  </setters>`;
        }
        return null;
      }
      case 'insert-snippet': {
        const snippet = String(value || '')
          .split('\n')
          .map((line, index) => (index === 0 ? line : `${context.indent}  ${line}`))
          .join('\n');
        if (repair.anchor.mode === 'before') return `${snippet}\n${context.indent}${text}`;
        return `${text}\n${context.indent}  ${snippet}`;
      }
      default:
        return null;
    }
  }

  function repairValueFor(repair, values) {
    if (repair.kind === 'rename-tag') return repair.toTag || resolveRepairValue(repair, values);
    if (repair.kind === 'insert-snippet') return resolveRepairValue(repair, values) || repair.snippet || null;
    return resolveRepairValue(repair, values);
  }

  function applyRepairs(docs, repairs, options = {}) {
    const values = options.values || {};
    const outputDocs = (docs || []).map(doc => ({ fileName: doc.fileName || '', xml: String(doc.xml || ''), changed: false }));
    const byFile = new Map(outputDocs.map(doc => [doc.fileName, doc]));
    const applied = [];
    const skipped = [];
    const groups = new Map();

    for (const repair of repairs || []) {
      if (!isRepairApplicable(repair)) {
        skipped.push({ repair, reason: 'This repair needs a manual edit; it cannot be applied automatically.' });
        continue;
      }
      const doc = byFile.get(repair.anchor.fileName || '');
      if (!doc) {
        skipped.push({ repair, reason: `File '${repair.anchor.fileName}' is not loaded.` });
        continue;
      }
      if (doc.xml.slice(repair.anchor.start, repair.anchor.end) !== repair.anchor.text) {
        skipped.push({ repair, reason: 'The target XML changed since it was inspected. Re-inspect and try again.' });
        continue;
      }
      const value = repairValueFor(repair, values);
      if (value === null) {
        skipped.push({ repair, reason: 'Enter a value before applying this repair.' });
        continue;
      }
      const key = `${repair.anchor.fileName}\u0000${repair.anchor.start}\u0000${repair.anchor.end}`;
      if (!groups.has(key)) groups.set(key, { doc, anchor: repair.anchor, entries: [] });
      groups.get(key).entries.push({ repair, value });
    }

    const groupsByFile = new Map();
    for (const group of groups.values()) {
      if (!groupsByFile.has(group.doc.fileName)) groupsByFile.set(group.doc.fileName, []);
      groupsByFile.get(group.doc.fileName).push(group);
    }

    for (const [fileName, fileGroups] of groupsByFile.entries()) {
      const doc = byFile.get(fileName);
      const original = doc.xml;
      fileGroups.sort((a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end);
      const accepted = [];
      let lastEnd = -1;
      for (const group of fileGroups) {
        if (group.anchor.start < lastEnd) {
          for (const entry of group.entries) {
            skipped.push({ repair: entry.repair, reason: 'Overlaps another selected repair. Apply it, re-inspect, then apply this one.' });
          }
          continue;
        }
        const context = {
          indent: lineIndent(original, group.anchor.start),
          inlineAfter: !/^[ \t]*(\r?\n|$)/.test(original.slice(group.anchor.end, group.anchor.end + 200))
        };
        let text = group.anchor.text;
        const groupApplied = [];
        const ordered = group.entries.slice().sort((a, b) => KIND_ORDER[a.repair.kind] - KIND_ORDER[b.repair.kind]);
        for (const entry of ordered) {
          const next = transformAnchor(text, entry.repair, entry.value, context);
          if (next === null || next === undefined) {
            skipped.push({ repair: entry.repair, reason: 'The target XML does not have the expected shape for this repair.' });
            continue;
          }
          text = next;
          groupApplied.push({ repair: entry.repair, value: entry.value });
        }
        if (!groupApplied.length) continue;
        accepted.push({ start: group.anchor.start, end: group.anchor.end, text });
        applied.push(...groupApplied);
        lastEnd = group.anchor.end;
      }

      let xml = original;
      for (const edit of accepted.slice().reverse()) {
        xml = `${xml.slice(0, edit.start)}${edit.text}${xml.slice(edit.end)}`;
      }
      doc.changed = xml !== original;
      doc.xml = xml;
    }

    return { docs: outputDocs, applied, skipped };
  }

  function findingKey(finding) {
    return [finding.category, finding.fileName, finding.elementType, finding.elementName].join('\u0000');
  }

  function shapeIssues(docs, options) {
    const validator = getShape();
    if (!validator?.validateAuroraXmlDocuments) return null;
    const DOMParserCtor = options.DOMParser || root?.DOMParser;
    if (!DOMParserCtor) return null;
    return validator.validateAuroraXmlDocuments(docs, 'Shape', { DOMParser: DOMParserCtor });
  }

  function verifyRepairedXml(beforeDocs, afterDocs, options = {}) {
    const api = getPatterns();
    const analysisOptions = options.analysisOptions || {};
    const before = options.beforeAnalysis || api.analyzeAuroraXmlDocuments(beforeDocs, analysisOptions);
    const after = api.analyzeAuroraXmlDocuments(afterDocs, analysisOptions);
    const remainingCounts = new Map();
    for (const finding of after.diagnostics) {
      const key = findingKey(finding);
      remainingCounts.set(key, (remainingCounts.get(key) || 0) + 1);
    }
    const resolved = [];
    const beforeCounts = new Map();
    for (const finding of before.diagnostics) {
      const key = findingKey(finding);
      beforeCounts.set(key, (beforeCounts.get(key) || 0) + 1);
      if (remainingCounts.get(key)) {
        remainingCounts.set(key, remainingCounts.get(key) - 1);
      } else {
        resolved.push(finding);
      }
    }
    const introduced = [];
    const remaining = [];
    const seen = new Map();
    for (const finding of after.diagnostics) {
      const key = findingKey(finding);
      seen.set(key, (seen.get(key) || 0) + 1);
      if (seen.get(key) > (beforeCounts.get(key) || 0)) introduced.push(finding);
      else remaining.push(finding);
    }
    const shapeBefore = shapeIssues(beforeDocs, options);
    const shapeAfter = shapeIssues(afterDocs, options);
    return {
      analysis: after,
      resolved,
      remaining,
      introduced,
      shape: shapeAfter === null ? null : {
        before: shapeBefore || [],
        after: shapeAfter,
        parseErrorsAfter: shapeAfter.filter(issue => / XmlParse - /.test(issue.msg))
      }
    };
  }

  function diffLines(beforeText, afterText, options = {}) {
    const a = String(beforeText || '').split(/\r\n|\r|\n/);
    const b = String(afterText || '').split(/\r\n|\r|\n/);
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix
      && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
    const midA = a.slice(prefix, a.length - suffix);
    const midB = b.slice(prefix, b.length - suffix);
    const rows = [];
    if (midA.length * midB.length > 1000000) {
      midA.forEach((line, i) => rows.push({ op: '-', line, a: prefix + i + 1 }));
      midB.forEach((line, i) => rows.push({ op: '+', line, b: prefix + i + 1 }));
    } else {
      const lcs = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
      for (let i = midA.length - 1; i >= 0; i -= 1) {
        for (let j = midB.length - 1; j >= 0; j -= 1) {
          lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < midA.length || j < midB.length) {
        if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
          rows.push({ op: ' ', line: midA[i], a: prefix + i + 1, b: prefix + j + 1 });
          i += 1;
          j += 1;
        } else if (i < midA.length && (j >= midB.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
          rows.push({ op: '-', line: midA[i], a: prefix + i + 1 });
          i += 1;
        } else {
          rows.push({ op: '+', line: midB[j], b: prefix + j + 1 });
          j += 1;
        }
      }
    }

    const context = Number.isFinite(options.context) ? options.context : 2;
    const full = [
      ...a.slice(0, prefix).map((line, i) => ({ op: ' ', line, a: i + 1, b: i + 1 })),
      ...rows,
      ...a.slice(a.length - suffix).map((line, i) => ({
        op: ' ',
        line,
        a: a.length - suffix + i + 1,
        b: b.length - suffix + i + 1
      }))
    ];
    const keep = new Array(full.length).fill(false);
    full.forEach((row, index) => {
      if (row.op === ' ') return;
      for (let k = Math.max(0, index - context); k <= Math.min(full.length - 1, index + context); k += 1) keep[k] = true;
    });
    const hunks = [];
    let current = null;
    full.forEach((row, index) => {
      if (!keep[index]) {
        current = null;
        return;
      }
      if (!current) {
        current = [];
        hunks.push(current);
      }
      current.push(row);
    });
    return hunks;
  }

  return {
    applyRepairs,
    diffLines,
    isRepairApplicable,
    repairNeedsValue,
    resolveRepairValue,
    verifyRepairedXml
  };
}));
