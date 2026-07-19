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

  function elementTarget(element, extra = {}) {
    return {
      fileName: element?.fileName || '',
      elementId: element?.id || '',
      elementName: element?.name || '',
      elementType: element?.type || '',
      ...extra
    };
  }

  function diagnostic(element, severity, category, message, suggestion = '', repairs = []) {
    return {
      severity,
      category,
      fileName: element?.fileName || '',
      elementId: element?.id || '',
      elementName: element?.name || '',
      elementType: element?.type || '',
      message,
      suggestion,
      repairs
    };
  }

  function diagnoseAuroraElements(elements, docs = []) {
    const findings = [];
    const idLocations = new Map();

    for (const doc of docs || []) {
      if (!/<elements\b/i.test(doc.xml || '')) {
        findings.push(diagnostic(
          { fileName: doc.fileName },
          'error',
          'root-shape',
          'XML document does not appear to have an <elements> root.',
          'Wrap Aurora content in an <elements> document with an <info> block.',
          [repair('wrap-document-root', 'Create an <elements> root with an <info> block, then move element nodes inside it.', {
            confidence: 'manual',
            target: { fileName: doc.fileName },
            wrapper: '<elements>\\n  <info>...</info>\\n  ...\\n</elements>'
          })]
        ));
      }
      for (const comment of String(doc.xml || '').matchAll(/<!--([\s\S]*?)-->/g)) {
        if (/\bID_[A-Z0-9_]+\b/.test(comment[1])) {
          findings.push(diagnostic(
            { fileName: doc.fileName },
            'review',
            'id-like-comment',
            'XML comment contains ID-shaped text that can confuse raw ID-reference checks.',
            'Keep IDs in XML attributes/rules, or remove placeholder ID text from comments.',
            [repair('edit-comment-text', 'Remove ID-shaped placeholder text from the XML comment.', {
              confidence: 'manual',
              target: { fileName: doc.fileName },
              removedPattern: '\\bID_[A-Z0-9_]+\\b'
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
              attribute: attr,
              valuePlaceholder: attr === 'id' ? 'ID_SOURCE_TYPE_NAME' : attr.toUpperCase()
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
            setterName: 'hd',
            valuePlaceholder: 'd8',
            snippet: '<set name="hd">d8</set>'
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
              currentValue: element.supports,
              replacementValue: cleanedTokens.join(', '),
              removedTokens: numericTokens
            })]
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
                attribute: attr,
                valuePlaceholder: attr === 'id' ? 'ID_TARGET_ELEMENT' : 'TARGET TYPE'
              }))
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
                attribute: 'type',
                currentValue: 'Condition Immunity',
                replacementValue: 'Condition'
              })]
            ));
          }
        } else if (rule.kind === 'select') {
          const missing = ['type', 'name', 'supports'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            findings.push(diagnostic(
              element,
              'warning',
              'select-missing-required-attribute',
              `Select rule is missing ${missing.join(', ')} attribute(s).`,
              'Select rules should usually include type, name, and supports.',
              missing.map(attr => repair('set-rule-attribute', `Set select ${attr} attribute.`, {
                confidence: 'manual',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                attribute: attr,
                valuePlaceholder: attr === 'supports' ? 'SUPPORT TOKEN' : attr.toUpperCase()
              }))
            ));
          }
        } else if (rule.kind === 'stat') {
          const missing = ['name', 'value'].filter(attr => !rule.attrs[attr]);
          if (missing.length) {
            findings.push(diagnostic(
              element,
              'warning',
              'stat-missing-required-attribute',
              `Stat rule is missing ${missing.join(', ')} attribute(s).`,
              'Stat rules should include name and value.',
              missing.map(attr => repair('set-rule-attribute', `Set stat ${attr} attribute.`, {
                confidence: 'manual',
                target: elementTarget(element, { ruleKind: rule.kind, ruleSignature: rule.signature }),
                attribute: attr,
                valuePlaceholder: attr === 'name' ? 'stat:name' : 'VALUE'
              }))
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
            currentValue: id,
            valuePlaceholder: `${id}_${index + 2}`
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
    return {
      catalog: summarizePatternCatalog(elements, options),
      diagnostics: diagnoseAuroraElements(elements, docs),
      authoringProfiles: buildAuthoringProfiles(elements, options),
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
    decodeXml,
    diagnoseAuroraElements,
    elementTarget,
    normalizeName,
    normalizeSpace,
    parseAuroraElements,
    parseElements: parseAuroraElements,
    repair,
    renderPatternReport,
    ruleSignature,
    splitSupportTokens,
    stripTags,
    summarizePatternCatalog
  };
}));
