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

  function lineForIndex(value, index) {
    if (!Number.isFinite(index) || index < 0) return 0;
    return String(value || '').slice(0, index).split(/\r\n|\r|\n/).length;
  }

  function trimSnippet(value, maxLength = 1200) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trimEnd()}\n...`;
  }

  function encodeAttributeValue(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function xmlWithAttribute(rawXml, attr, value) {
    const xml = trimSnippet(rawXml);
    if (!xml || !attr) return '';
    const escaped = encodeAttributeValue(value);
    const attrPattern = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*"[^"]*"`);
    if (attrPattern.test(xml)) return xml.replace(attrPattern, `${attr}="${escaped}"`);
    return xml.replace(/\s*(\/?>)\s*$/, ` ${attr}="${escaped}"$1`);
  }

  function setTagAttribute(tag, attr, value) {
    const text = String(tag || '');
    if (!text || !attr) return text;
    const escaped = encodeAttributeValue(value);
    const attrPattern = new RegExp(`(\\s)${escapeRegExp(attr)}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
    if (attrPattern.test(text)) return text.replace(attrPattern, (match, space) => `${space}${attr}="${escaped}"`);
    return text.replace(/(\s*)(\/?>)$/, ` ${attr}="${escaped}"$1$2`);
  }

  function xmlWithAttributes(rawXml, attrs) {
    return Object.entries(attrs || {}).reduce(
      (xml, [attr, value]) => xmlWithAttribute(xml, attr, value),
      trimSnippet(rawXml)
    );
  }

  function inferSelectSupports(rule) {
    const type = normalizeSpace(rule?.attrs?.type || '');
    if (/^feat$/i.test(type)) {
      return {
        value: 'feat',
        reason: 'select type="Feat"'
      };
    }
    return null;
  }

  function selectAttributePlaceholder(attr, rule) {
    if (attr === 'supports') return inferSelectSupports(rule)?.value || 'SUPPORT TOKEN';
    return attr.toUpperCase();
  }

  function buildSelectSupportsCandidates(elements) {
    const byType = new Map();
    for (const element of elements || []) {
      for (const rule of element.ruleRecords || []) {
        if (rule.kind !== 'select') continue;
        const typeKey = normalizeName(rule.attrs.type || '');
        const supports = normalizeSpace(rule.attrs.supports || '');
        if (!typeKey || !supports) continue;
        if (!byType.has(typeKey)) byType.set(typeKey, new Map());
        const counts = byType.get(typeKey);
        counts.set(supports, (counts.get(supports) || 0) + 1);
      }
    }
    const candidates = new Map();
    for (const [typeKey, counts] of byType.entries()) {
      candidates.set(typeKey, Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, 3));
    }
    return candidates;
  }

  function candidateSelectSupports(rule, selectSupportsCandidates) {
    const type = normalizeSpace(rule?.attrs?.type || '');
    const typeKey = normalizeName(type);
    if (!typeKey) return [];
    return (selectSupportsCandidates.get(typeKey) || []).map(candidate => ({
      ...candidate,
      reason: `observed on select type="${type}"`
    }));
  }

  function parseAuroraElements(xml, fileName = '') {
    const elements = [];
    const elementRegex = /<element\b([^>]*?)(\/>|>([\s\S]*?)<\/element>)/gi;
    let match;
    while ((match = elementRegex.exec(xml))) {
      const attrs = attrMap(match[1]);
      const rawXml = match[0];
      const openingTag = (rawXml.match(/^<element\b[^>]*>/i) || [])[0] || '';
      const selfClosing = match[2] === '/>';
      const bodyStart = match.index + openingTag.length;
      const line = lineForIndex(xml, match.index);
      const body = match[3] || '';
      const supportsMatch = body.match(/<supports\b[^>]*>([\s\S]*?)<\/supports>/i);
      const supports = stripTags((supportsMatch || [])[1] || '');
      const supportsRawXml = supportsMatch?.[0] || '';
      const supportsLine = supportsMatch ? lineForIndex(xml, bodyStart + supportsMatch.index) : 0;
      const description = stripTags((body.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '');
      const setters = {};
      const setterAttrs = {};
      const settersMatch = body.match(/<setters\b[^>]*>([\s\S]*?)<\/setters>/i);
      const settersBody = (settersMatch || [])[1] || '';
      const settersOpenTag = settersMatch ? settersMatch[0].match(/^<setters\b[^>]*>/i)[0] : '';
      const setterRanges = {};
      const settersBodyStart = settersMatch ? bodyStart + settersMatch.index + settersOpenTag.length : -1;
      for (const setter of settersBody.matchAll(/<set\b([^>]*?)(?:\/>|>([\s\S]*?)<\/set>)/gi)) {
        const setAttrs = attrMap(setter[1]);
        if (!setAttrs.name) continue;
        setters[setAttrs.name] = stripTags(setter[2] || '');
        setterAttrs[setAttrs.name] = setAttrs;
        const setOpenTag = (setter[0].match(/^<set\b[^>]*>/i) || [])[0] || setter[0];
        setterRanges[setAttrs.name] = {
          start: settersBodyStart + setter.index,
          end: settersBodyStart + setter.index + setOpenTag.length,
          text: setOpenTag
        };
      }

      const rulesMatch = body.match(/<rules\b[^>]*>([\s\S]*?)<\/rules>/i);
      const rulesBody = (rulesMatch || [])[1] || '';
      const rulesBodyOffset = rulesMatch ? rulesMatch.index + rulesMatch[0].indexOf(rulesBody) : -1;
      const ruleRecords = [];
      for (const rule of rulesBody.matchAll(/<(grant|select|stat|append)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
        const kind = rule[1].toLowerCase();
        const ruleAttrs = attrMap(rule[2]);
        const ruleStart = bodyStart + rulesBodyOffset + rule.index;
        const ruleLine = rulesBodyOffset >= 0
          ? lineForIndex(xml, ruleStart)
          : line;
        const ruleOpenTag = (rule[0].match(/^<[^>]*>/) || [])[0] || rule[0];
        ruleRecords.push({
          kind,
          attrs: ruleAttrs,
          text: stripTags(rule[3] || ''),
          signature: ruleSignature(kind, ruleAttrs),
          rawXml: trimSnippet(rule[0]),
          line: ruleLine,
          openTagRange: { start: ruleStart, end: ruleStart + ruleOpenTag.length, text: ruleOpenTag }
        });
      }

      elements.push({
        fileName,
        line,
        name: attrs.name || '',
        type: attrs.type || '',
        source: attrs.source || '',
        id: attrs.id || '',
        attrs,
        openingTag: trimSnippet(openingTag),
        rawXml: trimSnippet(rawXml),
        supports,
        supportsRawXml: trimSnippet(supportsRawXml),
        supportsLine,
        supportTokens: splitSupportTokens(supports),
        description,
        setters,
        setterAttrs,
        setterRanges,
        ruleRecords,
        rules: ruleRecords.map(rule => rule.signature).sort(),
        key: `${normalizeName(attrs.type)}::${normalizeName(attrs.name)}`,
        selfClosing,
        range: { start: match.index, end: match.index + rawXml.length },
        openTagRange: { start: match.index, end: match.index + openingTag.length, text: openingTag },
        supportsRange: supportsMatch
          ? { start: bodyStart + supportsMatch.index, end: bodyStart + supportsMatch.index + supportsRawXml.length, text: supportsRawXml }
          : null,
        settersOpenTagRange: settersMatch
          ? { start: bodyStart + settersMatch.index, end: bodyStart + settersMatch.index + settersOpenTag.length, text: settersOpenTag }
          : null
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

  function countRows(map, total, options = {}) {
    const limit = Number(options.limit || options.top || 0);
    const minRatio = Number(options.minRatio || 0);
    const minCount = Number(options.minCount || 0);
    const rows = Object.entries(map || {})
      .map(([name, count]) => ({
        name,
        count,
        percent: total ? Math.min(100, Number(((count / total) * 100).toFixed(1))) : 0,
        perElement: total ? Number((count / total).toFixed(2)) : 0
      }))
      .filter(row => row.count >= minCount && (!minRatio || (total && row.count / total >= minRatio)))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return limit > 0 ? rows.slice(0, limit) : rows;
  }

  function listNames(rows) {
    return (rows || []).map(row => row.name).join(', ');
  }

  function addHint(hints, category, message, evidence = '', suggestion = '') {
    hints.push({ category, message, evidence, suggestion });
  }

  function observedElementText(type, count) {
    return `${count} observed ${type} element${count === 1 ? '' : 's'}`;
  }

  function profileConfidence(count) {
    if (count >= 10) return 'high';
    if (count >= 3) return 'medium';
    return 'low';
  }

  function buildAuthoringProfile(type, elements, options = {}) {
    const count = elements.length;
    const top = Number(options.top || 8);
    const commonThreshold = Number(options.commonThreshold || 0.5);
    const catalog = summarizePatternCatalog(elements, { top: 0 });
    const bucket = catalog.types[type] || catalog.types['(missing type)'] || {
      setterNames: {},
      supportTokens: {},
      ruleKinds: {},
      grantTypes: {},
      selectTypes: {},
      statNames: {},
      appendNames: {},
      emptyRules: 0
    };
    const requiredSetters = countRows(bucket.setterNames, count, { minCount: count });
    const commonSetters = countRows(bucket.setterNames, count, { minRatio: commonThreshold, limit: top })
      .filter(row => row.count !== count);
    const observedSetters = countRows(bucket.setterNames, count, { limit: top });
    const supportTokens = countRows(bucket.supportTokens, count, { limit: top });
    const ruleKinds = countRows(bucket.ruleKinds, count, { limit: top });
    const grantTypes = countRows(bucket.grantTypes, count, { limit: top });
    const selectTypes = countRows(bucket.selectTypes, count, { limit: top });
    const statNames = countRows(bucket.statNames, count, { limit: top });
    const appendNames = countRows(bucket.appendNames, count, { limit: top });
    const descriptionCount = elements.filter(element => String(element.description || '').trim()).length;
    const examples = elements.slice(0, top).map(element => ({
      name: element.name,
      id: element.id,
      fileName: element.fileName
    }));
    const hints = [];

    addHint(
      hints,
      'required-attributes',
      'Aurora elements should start with non-empty name, type, source, and id attributes.',
      `${observedElementText(type, count)} ${count === 1 ? 'was' : 'were'} scanned.`,
      'Generate stable IDs from the source abbreviation, element type, and normalized element name.'
    );

    if (requiredSetters.length) {
      addHint(
        hints,
        'required-setters',
        `Every observed ${type} element has setter(s): ${listNames(requiredSetters)}.`,
        requiredSetters.map(row => `${row.name}=${row.count}/${count}`).join(', '),
        'Use these as the first draft fields for this element type unless a broader corpus disproves the pattern.'
      );
    } else if (observedSetters.length) {
      addHint(
        hints,
        'observed-setters',
        `Observed ${type} setters include: ${listNames(observedSetters)}.`,
        observedSetters.map(row => `${row.name}=${row.percent}%`).join(', '),
        'Treat these as candidate fields, not mandatory fields.'
      );
    }

    if (bucket.emptyRules === count) {
      addHint(
        hints,
        'rules',
        `Observed ${type} elements in this corpus do not use rules.`,
        `${bucket.emptyRules}/${count} have no grant/select/stat/append rules.`,
        'Do not add rules unless the authored content actually grants, selects, or modifies something.'
      );
    } else if (ruleKinds.length) {
      addHint(
        hints,
        'rules',
        `Observed ${type} rule kinds: ${listNames(ruleKinds)}.`,
        ruleKinds.map(row => `${row.name}=${row.count}`).join(', '),
        'Model authored mechanics with the same rule kinds before inventing a new rule shape.'
      );
    }

    if (grantTypes.length) {
      addHint(
        hints,
        'grant-types',
        `Observed grant target type(s): ${listNames(grantTypes)}.`,
        grantTypes.map(row => `${row.name}=${row.count}`).join(', '),
        'Use grant rules for direct, deterministic benefits.'
      );
    }
    if (selectTypes.length) {
      addHint(
        hints,
        'select-types',
        `Observed select target type(s): ${listNames(selectTypes)}.`,
        selectTypes.map(row => `${row.name}=${row.count}`).join(', '),
        'Use select rules for user choices and provide useful name/supports values.'
      );
    }
    if (supportTokens.length) {
      addHint(
        hints,
        'supports',
        `Observed supports token(s): ${listNames(supportTokens)}.`,
        supportTokens.map(row => `${row.name}=${row.count}`).join(', '),
        'Use supports to place elements into Aurora picker categories; avoid unrelated metadata tokens.'
      );
    }

    if (type === 'Spell') {
      addHint(
        hints,
        'spell-metadata',
        'Spell level belongs in a level setter; supports should stay focused on classes and useful spell tags.',
        'Numeric support tokens are flagged by repair diagnostics.',
        'Author spell metadata in setters first, then add class/tag supports.'
      );
    }
    if (type === 'Class') {
      addHint(
        hints,
        'class-shape',
        'Class elements require a non-empty hit die setter.',
        'The repair diagnostics flag Class elements missing <set name="hd">.',
        'Include hd before adding class feature grants or multiclass support.'
      );
    }

    return {
      type,
      count,
      confidence: profileConfidence(count),
      requiredAttributes: ['name', 'type', 'source', 'id'],
      requiredSetters,
      commonSetters,
      observedSetters,
      supportTokens,
      ruleKinds,
      grantTypes,
      selectTypes,
      statNames,
      appendNames,
      descriptionCoverage: {
        count: descriptionCount,
        percent: count ? Number(((descriptionCount / count) * 100).toFixed(1)) : 0
      },
      emptyRules: {
        count: bucket.emptyRules,
        percent: count ? Number(((bucket.emptyRules / count) * 100).toFixed(1)) : 0
      },
      examples,
      hints
    };
  }

  function buildAuthoringProfiles(elements, options = {}) {
    const byType = new Map();
    for (const element of elements || []) {
      const type = element.type || '(missing type)';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(element);
    }
    return Array.from(byType.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([type, typeElements]) => buildAuthoringProfile(type, typeElements, options));
  }

  function repair(kind, description, details = {}) {
    return {
      kind,
      confidence: details.confidence || 'manual',
      description,
      ...details
    };
  }

  function withoutLeadingDoctype(xml) {
    const value = String(xml || '');
    const match = value.match(/^\s*<!DOCTYPE\b/i);
    if (!match) return value;

    let quote = '';
    let subsetDepth = 0;
    for (let index = match[0].length; index < value.length; index += 1) {
      const char = value[index];
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (subsetDepth > 0 && value.startsWith('<!--', index)) {
        const commentEnd = value.indexOf('-->', index + 4);
        if (commentEnd === -1) return value;
        index = commentEnd + 2;
        continue;
      }
      if (subsetDepth > 0 && value.startsWith('<?', index)) {
        const instructionEnd = value.indexOf('?>', index + 2);
        if (instructionEnd === -1) return value;
        index = instructionEnd + 1;
        continue;
      }
      if (char === '[') {
        subsetDepth += 1;
        continue;
      }
      if (char === ']' && subsetDepth > 0) {
        subsetDepth -= 1;
        continue;
      }
      if (char === '>' && subsetDepth === 0) return value.slice(index + 1);
    }
    return value;
  }

  function xmlWithoutLeadingPreamble(xml) {
    let remaining = String(xml || '').replace(/^\uFEFF/, '');
    let previous = '';
    while (remaining !== previous) {
      previous = remaining;
      remaining = withoutLeadingDoctype(remaining
        .replace(/^\s*<\?xml\b[\s\S]*?\?>/i, '')
        .replace(/^\s*<!--[\s\S]*?-->/, ''));
    }
    return remaining.trimStart();
  }

  function hasElementsRoot(xml) {
    return /^<elements\b/i.test(xmlWithoutLeadingPreamble(xml));
  }

  function elementTarget(element, extra = {}) {
    const target = {
      fileName: element?.fileName || '',
      elementId: element?.id || '',
      elementName: element?.name || '',
      elementType: element?.type || '',
    };
    if (element?.line) target.line = element.line;
    if (element?.openingTag) target.nodeXml = element.openingTag;
    return { ...target, ...extra };
  }

  function anchorFor(element, range, extra = {}) {
    if (!range || !Number.isFinite(range.start)) return null;
    return { fileName: element?.fileName || '', start: range.start, end: range.end, text: range.text, ...extra };
  }

  function nodeFromElement(element, fallbackKind = 'element') {
    const node = {
      kind: element?.nodeKind || fallbackKind
    };
    if (element?.line) node.line = element.line;
    const xml = element?.nodeXml || element?.openingTag || '';
    if (xml) node.xml = trimSnippet(xml);
    return node;
  }

  function nodeFromRule(rule) {
    const node = {
      kind: rule?.kind || 'rule'
    };
    if (rule?.line) node.line = rule.line;
    if (rule?.rawXml) node.xml = trimSnippet(rule.rawXml);
    return node;
  }

  function nodeFromSupports(element) {
    const node = {
      kind: 'supports'
    };
    if (element?.supportsLine) node.line = element.supportsLine;
    if (element?.supportsRawXml) node.xml = trimSnippet(element.supportsRawXml);
    return node;
  }

  function diagnostic(element, severity, category, message, suggestion = '', repairs = [], details = {}) {
    return {
      severity,
      category,
      fileName: element?.fileName || '',
      elementId: element?.id || '',
      elementName: element?.name || '',
      elementType: element?.type || '',
      message,
      suggestion,
      node: details.node || nodeFromElement(element),
      repairs
    };
  }

  function editDistance(a, b, maxDistance = Infinity) {
    const left = String(a || '');
    const right = String(b || '');
    if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const current = [i];
      let rowMin = i;
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        if (current[j] < rowMin) rowMin = current[j];
      }
      if (rowMin > maxDistance) return maxDistance + 1;
      previous = current;
    }
    return previous[right.length];
  }

  function typeNameDistance(value) {
    return Math.max(1, Math.floor(String(value || '').length / 4));
  }

  function closestNames(value, names, options = {}) {
    const target = String(value || '');
    const maxDistance = Number.isFinite(options.maxDistance)
      ? options.maxDistance
      : Math.max(2, Math.floor(target.length * 0.12));
    const caseInsensitive = options.caseInsensitive !== false;
    const probe = caseInsensitive ? target.toLowerCase() : target;
    const matches = [];
    for (const name of names || []) {
      if (!name || name === target) continue;
      const distance = editDistance(probe, caseInsensitive ? String(name).toLowerCase() : name, maxDistance);
      if (distance <= maxDistance) matches.push({ value: name, distance });
    }
    return matches
      .sort((a, b) => a.distance - b.distance || a.value.localeCompare(b.value))
      .slice(0, options.limit || 3);
  }

  // Bundled index shape: { types: [...], ids: { ID: [typeIndex, name] }, builtinIds: [...],
  // grantTypes, selectTypes, statNames: { name: count }, setterNamesByType: { type: { name: count } },
  // typeCounts: { type: count } }.
  function normalizeReferenceIndex(reference) {
    if (!reference) return null;
    if (reference.__normalized) return reference;
    const types = reference.types || [];
    const idTypes = new Map();
    const idNames = new Map();
    for (const [id, entry] of Object.entries(reference.ids || {})) {
      const [typeIndex, name] = Array.isArray(entry) ? entry : [entry, ''];
      idTypes.set(id, types[typeIndex] ?? typeIndex ?? '');
      if (name) idNames.set(id, name);
    }
    const normalized = {
      __normalized: true,
      idTypes,
      idNames,
      builtinIds: new Set(reference.builtinIds || []),
      grantTypes: Object.keys(reference.grantTypes || {}),
      selectTypes: Object.keys(reference.selectTypes || {}),
      statNames: Object.keys(reference.statNames || {}),
      setterNamesByType: new Map(Object.entries(reference.setterNamesByType || {})
        .map(([type, counts]) => [type, counts || {}])),
      typeCounts: reference.typeCounts || {},
      idsByType: new Map()
    };
    for (const [id, type] of idTypes.entries()) {
      if (!normalized.idsByType.has(type)) normalized.idsByType.set(type, []);
      normalized.idsByType.get(type).push(id);
    }
    return normalized;
  }

  function attributeValueRanges(tagRange, attr) {
    if (!tagRange?.text) return [];
    const pattern = new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*"([^"]*)"`);
    const match = tagRange.text.match(pattern);
    if (!match) return [];
    const valueStart = tagRange.start + match.index + match[0].length - match[1].length - 1;
    const ranges = [];
    for (const token of match[1].matchAll(/ID_[A-Za-z0-9_]+/g)) {
      ranges.push({ start: valueStart + token.index, end: valueStart + token.index + token[0].length, text: token[0] });
    }
    return ranges;
  }

  // Same element name under a different source prefix, e.g. ID_PHB_SPELL_X -> ID_XGTE_SPELL_X.
  function sameNameDifferentPrefix(id, pool) {
    const parts = String(id || '').split('_');
    // The shared suffix must cover at least half of the id so generic tails like _ORIGIN_SPELLS don't match.
    const minSegments = Math.max(2, Math.ceil((parts.length - 1) / 2));
    for (let start = 2; parts.length - start >= minSegments; start += 1) {
      const suffix = `_${parts.slice(start).join('_')}`;
      const matches = pool.filter(candidate => candidate !== id && candidate.endsWith(suffix));
      if (matches.length) return matches.slice(0, 3).map(value => ({ value, distance: 0 }));
    }
    return [];
  }

  function referenceCandidates(id, expectedType, reference, localIds) {
    const pool = [];
    if (expectedType && reference.idsByType.has(expectedType)) pool.push(...reference.idsByType.get(expectedType));
    for (const [localId, localType] of localIds.entries()) {
      if (!expectedType || localType === expectedType) pool.push(localId);
    }
    const allIds = () => Array.from(reference.idTypes.keys()).concat(Array.from(localIds.keys()));
    let matches = closestNames(id, pool, { caseInsensitive: false });
    if (!matches.length) matches = sameNameDifferentPrefix(id, expectedType ? pool : allIds());
    if (!matches.length && expectedType) {
      matches = closestNames(id, allIds(), { caseInsensitive: false });
    }
    return matches.map(match => ({
      value: match.value,
      distance: match.distance,
      reason: [reference.idTypes.get(match.value) || localIds.get(match.value), reference.idNames.get(match.value)]
        .filter(Boolean)
        .join(': ') || 'similar id'
    }));
  }

  function diagnoseReferences(elements, docs, referenceInput) {
    const findings = [];
    const reference = normalizeReferenceIndex(referenceInput);

    for (const doc of docs || []) {
      const xml = String(doc.xml || '');
      const infoMatch = xml.match(/<info\b[^>]*>([\s\S]*?)<\/info>/i);
      if (infoMatch) {
        const infoBodyStart = infoMatch.index + infoMatch[0].indexOf(infoMatch[1]);
        const nameTag = infoMatch[1].match(/<n\b[^>]*>[\s\S]*?<\/n>/i);
        if (nameTag) {
          const start = infoBodyStart + nameTag.index;
          const node = { kind: 'info', line: lineForIndex(xml, start), xml: nameTag[0] };
          findings.push(diagnostic(
            { fileName: doc.fileName, nodeKind: 'info', nodeXml: nameTag[0], line: node.line },
            'error',
            'info-uses-n-tag',
            'The <info> block uses <n> for the content name; Aurora reads <name>.',
            'Rename <n> to <name>.',
            [repair('rename-tag', 'Rename <n> to <name> inside <info>.', {
              confidence: 'high',
              target: { fileName: doc.fileName },
              anchor: { fileName: doc.fileName, start, end: start + nameTag[0].length, text: nameTag[0] },
              fromTag: 'n',
              toTag: 'name',
              replacementValue: 'name',
              sample: nameTag[0].replace(/^<n\b/, '<name').replace(/<\/n>$/, '</name>')
            })],
            { node }
          ));
        }
        if (!/<update\b/i.test(infoMatch[1])) {
          const fileLabel = String(doc.fileName || 'content.xml').split(/[\\/]/).pop();
          findings.push(diagnostic(
            { fileName: doc.fileName, nodeKind: 'info', nodeXml: trimSnippet(infoMatch[0], 400), line: lineForIndex(xml, infoMatch.index) },
            'warning',
            'missing-info-update',
            'The <info> block has no <update> node, so Aurora cannot track this file for updates.',
            'Add an <update version="..."> node with a <file name="..." url="..." /> entry.',
            [repair('insert-update-node', 'Add an <update> block inside <info>; fill in the URL where the file is hosted.', {
              confidence: 'manual',
              target: { fileName: doc.fileName },
              sample: `<update version="0.0.1">\n  <file name="${fileLabel}" url="https://example.com/${fileLabel}" />\n</update>`
            })]
          ));
        }
      }
    }

    if (!reference) return findings;

    const localIds = new Map();
    for (const element of elements || []) {
      if (element.id) localIds.set(element.id, element.type);
    }
    for (const doc of docs || []) {
      for (const match of String(doc.xml || '').matchAll(/<multiclass\b[^>]*\bid="([^"]+)"/gi)) {
        if (!localIds.has(match[1])) localIds.set(match[1], 'Multiclass');
      }
    }
    const typeOf = id => localIds.get(id) || reference.idTypes.get(id) || '';
    const isKnown = id => localIds.has(id) || reference.idTypes.has(id) || reference.builtinIds.has(id);
    const knownGrantTypes = new Set(reference.grantTypes);
    const knownSelectTypes = new Set(reference.selectTypes);
    const knownStatNames = new Set(reference.statNames);

    for (const element of elements || []) {
      for (const rule of element.ruleRecords || []) {
        const ruleNode = nodeFromRule(rule);
        const ruleTarget = elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature });

        const grantTypeUnknown = rule.kind === 'grant' && rule.attrs.type && knownGrantTypes.size && !knownGrantTypes.has(rule.attrs.type);
        if (grantTypeUnknown) {
          // The granted element's own type is the strongest evidence; fall back to spelling.
          const grantedTypes = Array.from(new Set((String(rule.attrs.id || '').match(/ID_[A-Za-z0-9_]+/g) || [])
            .map(typeOf)
            .filter(type => type && type !== 'Multiclass')));
          const fromTarget = grantedTypes.length === 1 && knownGrantTypes.has(grantedTypes[0]) ? grantedTypes[0] : '';
          const candidates = fromTarget
            ? [{ value: fromTarget, reason: `granted id is a ${fromTarget} element` }]
            : closestNames(rule.attrs.type, reference.grantTypes, { maxDistance: typeNameDistance(rule.attrs.type) })
              .map(candidate => ({ value: candidate.value, reason: 'known grant type' }));
          findings.push(diagnostic(
            element,
            'error',
            'unknown-grant-type',
            `Grant type '${rule.attrs.type}' is not used by any first-party content.`,
            candidates.length ? `Did you mean '${candidates[0].value}'?` : 'Use a grant type Aurora recognizes.',
            [repair('set-rule-attribute', 'Change the grant type to a known Aurora grant type.', {
              confidence: candidates.length === 1 ? 'high' : 'manual',
              target: ruleTarget,
              anchor: anchorFor(element, rule.openTagRange),
              attribute: 'type',
              currentValue: rule.attrs.type,
              ...(candidates.length === 1 ? { replacementValue: candidates[0].value } : { valuePlaceholder: 'GRANT TYPE' }),
              ...(fromTarget ? { inferenceReason: candidates[0].reason } : {}),
              candidateValues: candidates.length
                ? candidates
                : reference.grantTypes.slice(0, 6).map(value => ({ value, reason: 'known grant type' })),
              sample: xmlWithAttribute(rule.rawXml, 'type', candidates[0]?.value || 'GRANT TYPE')
            })],
            { node: ruleNode }
          ));
        }

        if (rule.kind === 'select' && rule.attrs.type && knownSelectTypes.size && !knownSelectTypes.has(rule.attrs.type)) {
          const candidates = closestNames(rule.attrs.type, reference.selectTypes, { maxDistance: typeNameDistance(rule.attrs.type) });
          findings.push(diagnostic(
            element,
            'warning',
            'unknown-select-type',
            `Select type '${rule.attrs.type}' is not used by any first-party content.`,
            candidates.length ? `Did you mean '${candidates[0].value}'?` : 'Use a select type Aurora recognizes.',
            [repair('set-rule-attribute', 'Change the select type to a known Aurora select type.', {
              confidence: candidates.length === 1 ? 'high' : 'manual',
              target: ruleTarget,
              anchor: anchorFor(element, rule.openTagRange),
              attribute: 'type',
              currentValue: rule.attrs.type,
              ...(candidates.length === 1 ? { replacementValue: candidates[0].value } : { valuePlaceholder: 'SELECT TYPE' }),
              candidateValues: candidates.map(candidate => ({ value: candidate.value, reason: 'known select type' })),
              sample: xmlWithAttribute(rule.rawXml, 'type', candidates[0]?.value || 'SELECT TYPE')
            })],
            { node: ruleNode }
          ));
        }

        if (rule.kind === 'stat' && rule.attrs.name && knownStatNames.size && !knownStatNames.has(rule.attrs.name)) {
          // Custom stat names are legitimate; only flag near-misses of a known name.
          const candidates = rule.attrs.name.length >= 6
            ? closestNames(rule.attrs.name, reference.statNames, { maxDistance: 1 })
            : [];
          if (candidates.length) {
            findings.push(diagnostic(
              element,
              'review',
              'unknown-stat-name',
              `Stat name '${rule.attrs.name}' is close to known stat '${candidates[0].value}'.`,
              'If this was meant to modify the known stat, correct the spelling; custom stat names are otherwise fine.',
              [repair('set-rule-attribute', 'Use the known stat name.', {
                confidence: 'manual',
                target: ruleTarget,
                anchor: anchorFor(element, rule.openTagRange),
                attribute: 'name',
                currentValue: rule.attrs.name,
                valuePlaceholder: candidates[0].value,
                candidateValues: candidates.map(candidate => ({ value: candidate.value, reason: 'known stat name' })),
                sample: xmlWithAttribute(rule.rawXml, 'name', candidates[0].value)
              })],
              { node: ruleNode }
            ));
          }
        }

        const referenceRanges = [];
        if (rule.kind === 'grant') {
          for (const range of attributeValueRanges(rule.openTagRange, 'id')) referenceRanges.push({ range, attr: 'id', expectedType: rule.attrs.type });
        }
        for (const range of attributeValueRanges(rule.openTagRange, 'requirements')) referenceRanges.push({ range, attr: 'requirements', expectedType: '' });

        for (const { range, attr, expectedType } of referenceRanges) {
          const id = range.text;
          if (isKnown(id)) {
            const actualType = typeOf(id);
            if (attr === 'id' && !grantTypeUnknown && expectedType && actualType && actualType !== 'Multiclass' && actualType !== expectedType) {
              findings.push(diagnostic(
                element,
                'warning',
                'grant-type-mismatch',
                `Grant type '${expectedType}' does not match '${id}', which is a ${actualType} element.`,
                `Use grant type="${actualType}" so Aurora resolves the granted element.`,
                [repair('set-rule-attribute', `Change the grant type to ${actualType}.`, {
                  confidence: 'medium',
                  target: ruleTarget,
                  anchor: anchorFor(element, rule.openTagRange),
                  attribute: 'type',
                  currentValue: expectedType,
                  replacementValue: actualType,
                  inferenceReason: `${id} is defined as type="${actualType}"`,
                  sample: xmlWithAttribute(rule.rawXml, 'type', actualType)
                })],
                { node: ruleNode }
              ));
            }
            continue;
          }
          const candidates = referenceCandidates(id, attr === 'id' ? expectedType : '', reference, localIds);
          const single = candidates.length === 1 || (candidates.length > 1 && candidates[0].distance < candidates[1].distance);
          findings.push(diagnostic(
            element,
            'warning',
            'unresolved-id-reference',
            `${rule.kind} ${attr} references '${id}', which is not defined in the loaded files or first-party content.`,
            candidates.length
              ? `Did you mean '${candidates[0].value}'? If the id comes from another content pack, load that file too or ignore this.`
              : 'Check the id spelling. If it comes from another content pack, load that file too or ignore this.',
            [repair('replace-reference-id', 'Replace the unresolved id with a known id.', {
              confidence: candidates.length && single ? 'high' : 'manual',
              target: ruleTarget,
              anchor: anchorFor(element, range),
              currentValue: id,
              ...(candidates.length && single ? { replacementValue: candidates[0].value } : { valuePlaceholder: 'ID_KNOWN_ELEMENT' }),
              candidateValues: candidates,
              sample: rule.rawXml.replace(id, candidates[0]?.value || 'ID_KNOWN_ELEMENT')
            })],
            { node: ruleNode }
          ));
        }
      }

      const setterCounts = reference.setterNamesByType.get(element.type);
      const typeCount = Number(reference.typeCounts[element.type] || 0);
      if (setterCounts && typeCount >= 10) {
        const knownSetters = Object.keys(setterCounts);
        const renameTargets = new Set();
        for (const setterName of Object.keys(element.setters || {})) {
          if (setterCounts[setterName]) continue;
          const candidates = closestNames(setterName, knownSetters, { maxDistance: 2 });
          if (!candidates.length) continue;
          renameTargets.add(candidates[0].value);
          const range = element.setterRanges?.[setterName];
          findings.push(diagnostic(
            element,
            'warning',
            'unexpected-setter',
            `Setter '${setterName}' is never used on first-party ${element.type} elements; '${candidates[0].value}' is.`,
            `Rename the setter to '${candidates[0].value}' if that was intended.`,
            [repair('rename-setter', `Rename the setter to ${candidates[0].value}.`, {
              confidence: candidates.length === 1 ? 'high' : 'manual',
              target: elementTarget(element),
              anchor: range ? anchorFor(element, range) : null,
              attribute: 'name',
              currentValue: setterName,
              ...(candidates.length === 1 ? { replacementValue: candidates[0].value } : { valuePlaceholder: candidates[0].value }),
              candidateValues: candidates.map(candidate => ({ value: candidate.value, reason: `first-party ${element.type} setter` })),
              sample: `<set name="${candidates[0].value}">${escapeXmlText(element.setters[setterName])}</set>`
            })],
            { node: range ? { kind: 'setter', line: lineForIndex(docXml(docs, element.fileName), range.start), xml: range.text } : nodeFromElement(element) }
          ));
        }
        if (!element.selfClosing) {
          for (const [setterName, count] of Object.entries(setterCounts)) {
            if (count / typeCount < 0.95 || Object.prototype.hasOwnProperty.call(element.setters || {}, setterName)) continue;
            if (renameTargets.has(setterName)) continue;
            if (element.type === 'Class' && setterName === 'hd') continue;
            findings.push(diagnostic(
              element,
              'review',
              'missing-common-setter',
              `${element.type} '${element.name}' has no '${setterName}' setter, which ${Math.round((count / typeCount) * 100)}% of first-party ${element.type} elements set.`,
              `Add <set name="${setterName}"> if it applies to this element.`,
              [repair('insert-setter', `Insert a ${setterName} setter.`, {
                confidence: 'manual',
                target: elementTarget(element),
                anchor: element.settersOpenTagRange
                  ? anchorFor(element, element.settersOpenTagRange, { mode: 'after-setters-open' })
                  : anchorFor(element, element.openTagRange, { mode: 'after-element-open' }),
                setterName,
                valuePlaceholder: setterName.toUpperCase(),
                snippet: `<set name="${setterName}">VALUE</set>`,
                sample: `<setters>\n  <set name="${setterName}">VALUE</set>\n</setters>`
              })]
            ));
          }
        }
      }
    }
    return findings;
  }

  function escapeXmlText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function docXml(docs, fileName) {
    return String((docs || []).find(doc => doc.fileName === fileName)?.xml || '');
  }

  function diagnoseAuroraElements(elements, docs = [], options = {}) {
    const findings = diagnoseReferences(elements, docs, options.reference);
    const idLocations = new Map();
    const selectSupportsCandidates = buildSelectSupportsCandidates(elements);

    for (const doc of docs || []) {
      if (!hasElementsRoot(doc.xml)) {
        const preview = trimSnippet(String(doc.xml || '').replace(/^\s+/, '').slice(0, 240));
        findings.push(diagnostic(
          { fileName: doc.fileName, nodeKind: 'document', nodeXml: preview, line: 1 },
          'error',
          'root-shape',
          'XML document does not appear to have an <elements> root.',
          'Wrap Aurora content in an <elements> document with an <info> block.',
          [repair('wrap-document-root', 'Create an <elements> root with an <info> block, then move element nodes inside it.', {
            confidence: 'manual',
            target: { fileName: doc.fileName },
            wrapper: '<elements>\\n  <info>...</info>\\n  ...\\n</elements>',
            sample: '<elements>\n  <info>...</info>\n  ...\n</elements>'
          })]
        ));
      }
      for (const comment of String(doc.xml || '').matchAll(/<!--([\s\S]*?)-->/g)) {
        if (/\bID_[A-Z0-9_]+\b/.test(comment[1])) {
          findings.push(diagnostic(
            {
              fileName: doc.fileName,
              nodeKind: 'comment',
              nodeXml: trimSnippet(comment[0]),
              line: lineForIndex(doc.xml, comment.index)
            },
            'review',
            'id-like-comment',
            'XML comment contains ID-shaped text that can confuse raw ID-reference checks.',
            'Keep IDs in XML attributes/rules, or remove placeholder ID text from comments.',
            [repair('edit-comment-text', 'Remove ID-shaped placeholder text from the XML comment.', {
              confidence: 'manual',
              target: { fileName: doc.fileName },
              removedPattern: '\\bID_[A-Z0-9_]+\\b',
              sample: '<!-- Comment text without placeholder ID values. -->'
            })]
          ));
        }
      }
    }

    for (const element of elements || []) {
      for (const attr of ['name', 'type', 'source', 'id']) {
        if (!String(element[attr] || '').trim()) {
          findings.push(diagnostic(
            element,
            'error',
            'missing-element-attribute',
            `Element is missing required '${attr}' attribute.`,
            `Add a non-empty ${attr} attribute before loading in Aurora.`,
            [repair('set-element-attribute', `Set a non-empty ${attr} attribute on the element.`, {
              confidence: 'manual',
              target: elementTarget(element),
              anchor: anchorFor(element, element.openTagRange),
              attribute: attr,
              valuePlaceholder: attr === 'id' ? 'ID_SOURCE_TYPE_NAME' : attr.toUpperCase(),
              sample: xmlWithAttribute(element.openingTag || '<element />', attr, attr === 'id' ? 'ID_SOURCE_TYPE_NAME' : attr.toUpperCase())
            })]
          ));
        }
      }
      if (element.id) {
        if (!idLocations.has(element.id)) idLocations.set(element.id, []);
        idLocations.get(element.id).push(element);
      }

      if (element.type === 'Class' && !String(element.setters?.hd || '').trim()) {
        findings.push(diagnostic(
          element,
          'error',
          'class-missing-hit-die',
          `Class '${element.name}' is missing a non-empty hd setter.`,
          'Add <set name="hd">dN</set> under <setters>.',
          [repair('insert-setter', 'Insert a hit die setter under <setters>.', {
            confidence: 'manual',
            target: elementTarget(element),
            anchor: element.settersOpenTagRange
              ? anchorFor(element, element.settersOpenTagRange, { mode: 'after-setters-open' })
              : anchorFor(element, element.openTagRange, { mode: 'after-element-open' }),
            setterName: 'hd',
            valuePlaceholder: 'd8',
            candidateValues: ['d6', 'd8', 'd10', 'd12'].map(value => ({ value, reason: 'standard hit die' })),
            snippet: '<set name="hd">d8</set>',
            sample: '<setters>\n  <set name="hd">d8</set>\n</setters>'
          })]
        ));
      }

      if (element.type === 'Spell') {
        const numericTokens = (element.supportTokens || []).filter(token => /^\d+$/.test(token));
        if (numericTokens.length) {
          const cleanedTokens = (element.supportTokens || []).filter(token => !/^\d+$/.test(token));
          findings.push(diagnostic(
            element,
            'warning',
            'spell-supports-level-token',
            `Spell supports includes numeric level token(s): ${numericTokens.join(', ')}.`,
            'Keep spell level in setters/rules; supports should describe classes/tags.',
            [repair('replace-supports-text', 'Remove numeric spell-level tokens from <supports>.', {
              confidence: 'high',
              target: elementTarget(element),
              anchor: anchorFor(element, element.supportsRange),
              currentValue: element.supports,
              replacementValue: cleanedTokens.join(', '),
              removedTokens: numericTokens,
              sample: `<supports>${cleanedTokens.length ? cleanedTokens.join(', ') : 'CLASS_OR_TAG'}</supports>`
            })],
            { node: nodeFromSupports(element) }
          ));
        }
      }

      for (const rule of element.ruleRecords || []) {
        if (rule.kind === 'grant') {
          if (!rule.attrs.type || !rule.attrs.id) {
            const missing = ['type', 'id'].filter(attr => !rule.attrs[attr]);
            findings.push(diagnostic(
              element,
              'error',
              'grant-missing-required-attribute',
              `Grant rule is missing ${missing.join(', ')} attribute${missing.length === 1 ? '' : 's'}.`,
              'Grant rules should include both type and id.',
              missing.map(attr => repair('set-rule-attribute', `Set grant ${attr} attribute.`, {
                confidence: 'manual',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                anchor: anchorFor(element, rule.openTagRange),
                attribute: attr,
                valuePlaceholder: attr === 'id' ? 'ID_TARGET_ELEMENT' : 'TARGET TYPE',
                sample: xmlWithAttribute(rule.rawXml || '<grant />', attr, attr === 'id' ? 'ID_TARGET_ELEMENT' : 'TARGET TYPE')
              })),
              { node: nodeFromRule(rule) }
            ));
          }
          if (rule.attrs.type === 'Condition Immunity' && /^ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_/i.test(rule.attrs.id || '')) {
            findings.push(diagnostic(
              element,
              'error',
              'damage-resistance-grant-type',
              'Damage resistance is encoded as Condition Immunity.',
              'Use grant type="Condition" for damage resistance IDs.',
              [repair('set-rule-attribute', 'Change the grant type from Condition Immunity to Condition.', {
                confidence: 'high',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                anchor: anchorFor(element, rule.openTagRange),
                attribute: 'type',
                currentValue: 'Condition Immunity',
                replacementValue: 'Condition',
                sample: xmlWithAttribute(rule.rawXml || '<grant />', 'type', 'Condition')
              })],
              { node: nodeFromRule(rule) }
            ));
          }
        } else if (rule.kind === 'select') {
          const missing = ['type', 'name', 'supports'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            const inferredSupports = inferSelectSupports(rule);
            const supportsCandidates = inferredSupports ? [] : candidateSelectSupports(rule, selectSupportsCandidates);
            const sampleAttrs = Object.fromEntries(missing.map(attr => [
              attr,
              selectAttributePlaceholder(attr, rule)
            ]));
            findings.push(diagnostic(
              element,
              'warning',
              'select-missing-required-attribute',
              `Select rule is missing ${missing.join(', ')} attribute(s).`,
              'Select rules should usually include type, name, and supports.',
              missing.map(attr => repair('set-rule-attribute', `Set select ${attr} attribute.`, {
                confidence: attr === 'supports' && inferredSupports ? 'high' : 'manual',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                anchor: anchorFor(element, rule.openTagRange),
                attribute: attr,
                ...(attr === 'supports' && inferredSupports
                  ? {
                    replacementValue: inferredSupports.value,
                    inferenceReason: inferredSupports.reason
                  }
                  : {
                    valuePlaceholder: selectAttributePlaceholder(attr, rule),
                    ...(attr === 'supports' && supportsCandidates.length ? { candidateValues: supportsCandidates } : {})
                  }),
                sample: xmlWithAttribute(rule.rawXml || '<select />', attr, selectAttributePlaceholder(attr, rule)),
                completeSample: xmlWithAttributes(rule.rawXml || '<select />', sampleAttrs)
              })),
              { node: nodeFromRule(rule) }
            ));
          }
        } else if (rule.kind === 'stat') {
          const missing = ['name', 'value'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            const sampleAttrs = Object.fromEntries(missing.map(attr => [
              attr,
              attr === 'name' ? 'stat:name' : 'VALUE'
            ]));
            findings.push(diagnostic(
              element,
              'warning',
              'stat-missing-required-attribute',
              `Stat rule is missing ${missing.join(', ')} attribute(s).`,
              'Stat rules should include name and value.',
              missing.map(attr => repair('set-rule-attribute', `Set stat ${attr} attribute.`, {
                confidence: 'manual',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                anchor: anchorFor(element, rule.openTagRange),
                attribute: attr,
                valuePlaceholder: attr === 'name' ? 'stat:name' : 'VALUE',
                sample: xmlWithAttribute(rule.rawXml || '<stat />', attr, attr === 'name' ? 'stat:name' : 'VALUE'),
                completeSample: xmlWithAttributes(rule.rawXml || '<stat />', sampleAttrs)
              })),
              { node: nodeFromRule(rule) }
            ));
          }
        }
      }
    }

    for (const [id, locations] of idLocations.entries()) {
      if (locations.length > 1) {
        const files = Array.from(new Set(locations.map(element => element.fileName || '(unknown file)'))).join(', ');
        findings.push(diagnostic(
          locations[0],
          'error',
          'duplicate-element-id',
          `Duplicate element id '${id}' appears ${locations.length} times in ${files}.`,
          'Make every element id globally unique within the source set.',
          locations.slice(1).map((element, index) => repair('regenerate-element-id', `Regenerate duplicate element id occurrence ${index + 2}.`, {
            confidence: 'manual',
            target: elementTarget(element),
            anchor: anchorFor(element, element.openTagRange),
            attribute: 'id',
            currentValue: id,
            valuePlaceholder: `${id}_${index + 2}`,
            sample: xmlWithAttribute(element.openingTag || '<element />', 'id', `${id}_${index + 2}`)
          }))
        ));
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
    const diagnostics = diagnoseAuroraElements(elements, docs, { reference: options.reference });
    let repairIndex = 0;
    for (const finding of diagnostics) {
      for (const item of finding.repairs || []) item.id = `r${++repairIndex}`;
    }
    return {
      catalog: summarizePatternCatalog(elements, options),
      diagnostics,
      authoringProfiles: buildAuthoringProfiles(elements, options),
      elements
    };
  }

  // Builds the bundled first-party reference index: ids, types, and observed shape counts only.
  // Descriptions and other prose are deliberately excluded.
  function buildReferenceIndex(docs, options = {}) {
    const elements = [];
    for (const doc of docs || []) elements.push(...parseAuroraElements(doc.xml || '', doc.fileName || ''));
    const types = [];
    const typeIndex = new Map();
    const indexForType = type => {
      if (!typeIndex.has(type)) {
        typeIndex.set(type, types.length);
        types.push(type);
      }
      return typeIndex.get(type);
    };
    const ids = {};
    const typeCounts = {};
    const grantTypes = {};
    const selectTypes = {};
    const statNames = {};
    const setterNamesByType = {};
    const referenced = new Set();
    for (const element of elements) {
      if (element.id) ids[element.id] = options.includeNames === false ? [indexForType(element.type)] : [indexForType(element.type), element.name];
      increment(typeCounts, element.type);
      if (!setterNamesByType[element.type]) setterNamesByType[element.type] = {};
      for (const setterName of Object.keys(element.setters || {})) increment(setterNamesByType[element.type], setterName);
      for (const rule of element.ruleRecords || []) {
        if (rule.kind === 'grant') {
          increment(grantTypes, rule.attrs.type);
          for (const token of String(rule.attrs.id || '').match(/ID_[A-Za-z0-9_]+/g) || []) referenced.add(token);
        }
        if (rule.kind === 'select') increment(selectTypes, rule.attrs.type);
        if (rule.kind === 'stat') increment(statNames, rule.attrs.name);
        for (const token of String(rule.attrs.requirements || '').match(/ID_[A-Za-z0-9_]+/g) || []) referenced.add(token);
      }
    }
    const multiclassType = indexForType('Multiclass');
    for (const doc of docs || []) {
      for (const match of String(doc.xml || '').matchAll(/<multiclass\b[^>]*\bid="([^"]+)"/gi)) {
        if (!ids[match[1]]) ids[match[1]] = [multiclassType];
      }
    }
    // Ids first-party content relies on but never defines are built into the Aurora app itself.
    const builtinIds = Array.from(referenced).filter(id => !ids[id]).sort();
    const profiles = buildAuthoringProfiles(elements, { top: 8 }).map(profile => ({
      ...profile,
      examples: profile.examples.map(example => ({ name: example.name, id: example.id }))
    }));
    return {
      version: 1,
      generatedAt: options.generatedAt || new Date().toISOString(),
      corpus: options.corpusLabel || '',
      fileCount: (docs || []).length,
      elementCount: elements.length,
      types,
      ids,
      builtinIds,
      typeCounts: sortedCounts(typeCounts),
      grantTypes: sortedCounts(grantTypes),
      selectTypes: sortedCounts(selectTypes),
      statNames: sortedCounts(statNames),
      setterNamesByType: Object.fromEntries(Object.entries(setterNamesByType).map(([type, counts]) => [type, sortedCounts(counts)])),
      profiles
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

    const profiles = analysis.authoringProfiles || buildAuthoringProfiles(analysis.elements || [], options);
    if (profiles.length) {
      lines.push('## Authoring Profiles');
      lines.push('');
      for (const profile of profiles) {
        lines.push(`### ${profile.type}`);
        lines.push(`- Observed elements: ${profile.count}`);
        lines.push(`- Evidence confidence: ${profile.confidence}`);
        lines.push(`- Required attributes: ${profile.requiredAttributes.join(', ')}`);
        lines.push(`- Required setters: ${profile.requiredSetters.length ? listNames(profile.requiredSetters) : 'none observed across every element'}`);
        lines.push(`- Common setters: ${profile.commonSetters.length ? listNames(profile.commonSetters) : 'none'}`);
        lines.push(`- Common supports: ${profile.supportTokens.length ? listNames(profile.supportTokens) : 'none'}`);
        lines.push(`- Rule kinds: ${profile.ruleKinds.length ? listNames(profile.ruleKinds) : 'none'}`);
        lines.push(`- Empty rules: ${profile.emptyRules.count}/${profile.count} (${profile.emptyRules.percent}%)`);
        if (profile.examples.length) lines.push(`- Examples: ${profile.examples.map(example => example.name || example.id).filter(Boolean).join(', ')}`);
        lines.push('- Hints:');
        for (const hint of profile.hints) {
          lines.push(`  - ${hint.category}: ${hint.message}`);
          if (hint.suggestion) lines.push(`    Suggestion: ${hint.suggestion}`);
        }
        lines.push('');
      }
    }

    if (diagnostics.length) {
      lines.push('## Diagnostics');
      lines.push('');
      for (const finding of diagnostics) {
        const label = [finding.fileName, finding.elementType, finding.elementName].filter(Boolean).join(' / ');
        lines.push(`- [${finding.severity}] ${finding.category}${label ? ` (${label})` : ''}: ${finding.message}`);
        if (finding.suggestion) lines.push(`  Suggestion: ${finding.suggestion}`);
        for (const item of finding.repairs || []) {
          const detail = item.replacementValue ? ` -> ${item.replacementValue}`
            : item.valuePlaceholder ? ` -> ${item.valuePlaceholder}`
              : '';
          lines.push(`  Repair: ${item.kind} (${item.confidence})${detail} - ${item.description}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  return {
    analyzeAuroraXmlDocuments,
    attrMap,
    buildAuthoringProfile,
    buildAuthoringProfiles,
    buildReferenceIndex,
    closestNames,
    decodeXml,
    diagnoseAuroraElements,
    elementTarget,
    editDistance,
    encodeAttributeValue,
    normalizeName,
    normalizeReferenceIndex,
    normalizeSpace,
    parseAuroraElements,
    parseElements: parseAuroraElements,
    repair,
    renderPatternReport,
    ruleSignature,
    setTagAttribute,
    splitSupportTokens,
    stripTags,
    summarizePatternCatalog
  };
}));
