(function attachAuroraXmlPatterns(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AuroraXmlPatterns = api;
  if (root?.window) root.window.AuroraXmlPatterns = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAuroraXmlPatterns() {
  function attrMap(tag) {
    const attrs = {};
    for (const match of String(tag || '').matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
      attrs[match[1]] = decodeXml(match[2]);
    }
    return attrs;
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function stripTags(value) {
    return decodeXml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeName(value) {
    return normalizeSpace(decodeXml(value)).toLowerCase();
  }

  function splitSupportTokens(value) {
    return normalizeSpace(value)
      .split(/\s*(?:,|\|)\s*/)
      .map(token => token.trim())
      .filter(Boolean);
  }

  function ruleSignature(kind, attrs) {
    return [kind]
      .concat(Object.keys(attrs || {}).sort().map(key => `${key}=${attrs[key]}`))
      .join('|');
  }

  function parseAuroraElements(xml, fileName = '') {
    const elements = [];
    const elementRegex = /<element\b([^>]*?)(\/>|>([\s\S]*?)<\/element>)/gi;
    let match;
    while ((match = elementRegex.exec(xml))) {
      const attrs = attrMap(match[1]);
      const body = match[3] || '';
      const supports = stripTags((body.match(/<supports\b[^>]*>([\s\S]*?)<\/supports>/i) || [])[1] || '');
      const description = stripTags((body.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '');
      const setters = {};
      const setterAttrs = {};
      const settersBody = (body.match(/<setters\b[^>]*>([\s\S]*?)<\/setters>/i) || [])[1] || '';
      for (const setter of settersBody.matchAll(/<set\b([^>]*?)(?:\/>|>([\s\S]*?)<\/set>)/gi)) {
        const setAttrs = attrMap(setter[1]);
        if (!setAttrs.name) continue;
        setters[setAttrs.name] = stripTags(setter[2] || '');
        setterAttrs[setAttrs.name] = setAttrs;
      }

      const rulesBody = (body.match(/<rules\b[^>]*>([\s\S]*?)<\/rules>/i) || [])[1] || '';
      const ruleRecords = [];
      for (const rule of rulesBody.matchAll(/<(grant|select|stat|append)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
        const kind = rule[1].toLowerCase();
        const ruleAttrs = attrMap(rule[2]);
        ruleRecords.push({
          kind,
          attrs: ruleAttrs,
          text: stripTags(rule[3] || ''),
          signature: ruleSignature(kind, ruleAttrs)
        });
      }

      elements.push({
        fileName,
        name: attrs.name || '',
        type: attrs.type || '',
        source: attrs.source || '',
        id: attrs.id || '',
        attrs,
        supports,
        supportTokens: splitSupportTokens(supports),
        description,
        setters,
        setterAttrs,
        ruleRecords,
        rules: ruleRecords.map(rule => rule.signature).sort(),
        key: `${normalizeName(attrs.type)}::${normalizeName(attrs.name)}`
      });
    }
    return elements;
  }

  function increment(map, key, amount = 1) {
    if (!key) return;
    map[key] = (map[key] || 0) + amount;
  }

  function sortedCounts(map, limit = 0) {
    const entries = Object.entries(map || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return Object.fromEntries(limit > 0 ? entries.slice(0, limit) : entries);
  }

  function summarizePatternCatalog(elements, options = {}) {
    const top = Number(options.top || 0);
    const catalog = {
      files: Array.from(new Set((elements || []).map(element => element.fileName).filter(Boolean))).sort(),
      totalElements: (elements || []).length,
      types: {}
    };

    for (const element of elements || []) {
      const type = element.type || '(missing type)';
      if (!catalog.types[type]) {
        catalog.types[type] = {
          count: 0,
          sources: {},
          setterNames: {},
          supportTokens: {},
          ruleKinds: {},
          grantTypes: {},
          selectTypes: {},
          statNames: {},
          appendNames: {},
          emptyRules: 0
        };
      }
      const bucket = catalog.types[type];
      bucket.count += 1;
      increment(bucket.sources, element.source || '(missing source)');
      for (const setterName of Object.keys(element.setters || {})) increment(bucket.setterNames, setterName);
      for (const token of element.supportTokens || []) increment(bucket.supportTokens, token);
      if (!element.ruleRecords?.length) bucket.emptyRules += 1;
      for (const rule of element.ruleRecords || []) {
        increment(bucket.ruleKinds, rule.kind);
        if (rule.kind === 'grant') increment(bucket.grantTypes, rule.attrs.type || '(missing type)');
        if (rule.kind === 'select') increment(bucket.selectTypes, rule.attrs.type || '(missing type)');
        if (rule.kind === 'stat') increment(bucket.statNames, rule.attrs.name || '(missing name)');
        if (rule.kind === 'append') increment(bucket.appendNames, rule.attrs.name || rule.attrs.id || '(missing name)');
      }
    }

    for (const bucket of Object.values(catalog.types)) {
      bucket.sources = sortedCounts(bucket.sources, top);
      bucket.setterNames = sortedCounts(bucket.setterNames, top);
      bucket.supportTokens = sortedCounts(bucket.supportTokens, top);
      bucket.ruleKinds = sortedCounts(bucket.ruleKinds, top);
      bucket.grantTypes = sortedCounts(bucket.grantTypes, top);
      bucket.selectTypes = sortedCounts(bucket.selectTypes, top);
      bucket.statNames = sortedCounts(bucket.statNames, top);
      bucket.appendNames = sortedCounts(bucket.appendNames, top);
    }
    catalog.types = Object.fromEntries(Object.entries(catalog.types).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])));
    return catalog;
  }

  function diagnostic(element, severity, category, message, suggestion = '') {
    return {
      severity,
      category,
      fileName: element?.fileName || '',
      elementId: element?.id || '',
      elementName: element?.name || '',
      elementType: element?.type || '',
      message,
      suggestion
    };
  }

  function diagnoseAuroraElements(elements, docs = []) {
    const findings = [];
    const idLocations = new Map();

    for (const doc of docs || []) {
      if (!/<elements\b/i.test(doc.xml || '')) {
        findings.push(diagnostic({ fileName: doc.fileName }, 'error', 'root-shape', 'XML document does not appear to have an <elements> root.', 'Wrap Aurora content in an <elements> document with an <info> block.'));
      }
      for (const comment of String(doc.xml || '').matchAll(/<!--([\s\S]*?)-->/g)) {
        if (/\bID_[A-Z0-9_]+\b/.test(comment[1])) {
          findings.push(diagnostic({ fileName: doc.fileName }, 'review', 'id-like-comment', 'XML comment contains ID-shaped text that can confuse raw ID-reference checks.', 'Keep IDs in XML attributes/rules, or remove placeholder ID text from comments.'));
        }
      }
    }

    for (const element of elements || []) {
      for (const attr of ['name', 'type', 'source', 'id']) {
        if (!String(element[attr] || '').trim()) {
          findings.push(diagnostic(element, 'error', 'missing-element-attribute', `Element is missing required '${attr}' attribute.`, `Add a non-empty ${attr} attribute before loading in Aurora.`));
        }
      }
      if (element.id) {
        if (!idLocations.has(element.id)) idLocations.set(element.id, []);
        idLocations.get(element.id).push(element);
      }

      if (element.type === 'Class' && !String(element.setters?.hd || '').trim()) {
        findings.push(diagnostic(element, 'error', 'class-missing-hit-die', `Class '${element.name}' is missing a non-empty hd setter.`, 'Add <set name="hd">dN</set> under <setters>.'));
      }

      if (element.type === 'Spell') {
        const numericTokens = (element.supportTokens || []).filter(token => /^\d+$/.test(token));
        if (numericTokens.length) {
          findings.push(diagnostic(element, 'warning', 'spell-supports-level-token', `Spell supports includes numeric level token(s): ${numericTokens.join(', ')}.`, 'Keep spell level in setters/rules; supports should describe classes/tags.'));
        }
      }

      for (const rule of element.ruleRecords || []) {
        if (rule.kind === 'grant') {
          if (!rule.attrs.type || !rule.attrs.id) {
            findings.push(diagnostic(element, 'error', 'grant-missing-required-attribute', `Grant rule is missing ${!rule.attrs.type ? 'type' : 'id'} attribute.`, 'Grant rules should include both type and id.'));
          }
          if (rule.attrs.type === 'Condition Immunity' && /^ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_/i.test(rule.attrs.id || '')) {
            findings.push(diagnostic(element, 'error', 'damage-resistance-grant-type', 'Damage resistance is encoded as Condition Immunity.', 'Use grant type="Condition" for damage resistance IDs.'));
          }
        } else if (rule.kind === 'select') {
          const missing = ['type', 'name', 'supports'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            findings.push(diagnostic(element, 'warning', 'select-missing-required-attribute', `Select rule is missing ${missing.join(', ')} attribute(s).`, 'Select rules should usually include type, name, and supports.'));
          }
        } else if (rule.kind === 'stat') {
          const missing = ['name', 'value'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            findings.push(diagnostic(element, 'warning', 'stat-missing-required-attribute', `Stat rule is missing ${missing.join(', ')} attribute(s).`, 'Stat rules should include name and value.'));
          }
        }
      }
    }

    for (const [id, locations] of idLocations.entries()) {
      if (locations.length > 1) {
        const files = Array.from(new Set(locations.map(element => element.fileName || '(unknown file)'))).join(', ');
        findings.push(diagnostic(locations[0], 'error', 'duplicate-element-id', `Duplicate element id '${id}' appears ${locations.length} times in ${files}.`, 'Make every element id globally unique within the source set.'));
      }
    }

    return findings.sort((a, b) => {
      const severityOrder = { error: 0, warning: 1, review: 2 };
      return (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
        || a.category.localeCompare(b.category)
        || a.fileName.localeCompare(b.fileName)
        || a.elementName.localeCompare(b.elementName);
    });
  }

  function analyzeAuroraXmlDocuments(docs, options = {}) {
    const elements = [];
    for (const doc of docs || []) {
      elements.push(...parseAuroraElements(doc.xml || '', doc.fileName || ''));
    }
    return {
      catalog: summarizePatternCatalog(elements, options),
      diagnostics: diagnoseAuroraElements(elements, docs),
      elements
    };
  }

  function renderCountMap(map, indent = '  ') {
    const entries = Object.entries(map || {});
    if (!entries.length) return [`${indent}- none`];
    return entries.map(([key, count]) => `${indent}- ${key}: ${count}`);
  }

  function renderPatternReport(analysis, options = {}) {
    const catalog = analysis.catalog || summarizePatternCatalog(analysis.elements || [], options);
    const diagnostics = analysis.diagnostics || [];
    const lines = ['# Aurora XML Pattern Report', ''];
    lines.push(`- Files scanned: ${catalog.files.length}`);
    lines.push(`- Elements scanned: ${catalog.totalElements}`);
    lines.push(`- Diagnostics: errors=${diagnostics.filter(finding => finding.severity === 'error').length}, warnings=${diagnostics.filter(finding => finding.severity === 'warning').length}, review=${diagnostics.filter(finding => finding.severity === 'review').length}`);
    lines.push('');

    lines.push('## Element Type Patterns');
    lines.push('');
    for (const [type, bucket] of Object.entries(catalog.types)) {
      lines.push(`### ${type}`);
      lines.push(`- Count: ${bucket.count}`);
      lines.push('- Setter names:');
      lines.push(...renderCountMap(bucket.setterNames));
      lines.push('- Support tokens:');
      lines.push(...renderCountMap(bucket.supportTokens));
      lines.push('- Rule kinds:');
      lines.push(...renderCountMap(bucket.ruleKinds));
      lines.push('- Grant types:');
      lines.push(...renderCountMap(bucket.grantTypes));
      lines.push('- Select types:');
      lines.push(...renderCountMap(bucket.selectTypes));
      lines.push('');
    }

    if (diagnostics.length) {
      lines.push('## Diagnostics');
      lines.push('');
      for (const finding of diagnostics) {
        const label = [finding.fileName, finding.elementType, finding.elementName].filter(Boolean).join(' / ');
        lines.push(`- [${finding.severity}] ${finding.category}${label ? ` (${label})` : ''}: ${finding.message}`);
        if (finding.suggestion) lines.push(`  Suggestion: ${finding.suggestion}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  return {
    analyzeAuroraXmlDocuments,
    attrMap,
    decodeXml,
    diagnoseAuroraElements,
    normalizeName,
    normalizeSpace,
    parseAuroraElements,
    parseElements: parseAuroraElements,
    renderPatternReport,
    ruleSignature,
    splitSupportTokens,
    stripTags,
    summarizePatternCatalog
  };
}));
