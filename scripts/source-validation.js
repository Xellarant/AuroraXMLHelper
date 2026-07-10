const path = require('node:path');

const TEXT_KEYS = new Set([
  'description',
  'fullText',
  'higherLevels',
  'equipment',
  'prerequisite',
  'action',
  'usage'
]);

const TEXT_ARRAY_KEYS = new Set([
  'benefits',
  'features',
  'traits',
  'actions',
  'reactions'
]);

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeSpace(value).toLowerCase();
}

function collectText(value, parts = [], key = '') {
  if (value == null) return parts;
  if (typeof value === 'string') {
    if (TEXT_KEYS.has(key) || TEXT_ARRAY_KEYS.has(key)) parts.push(value);
    return parts;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts, key);
    return parts;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === 'name') continue;
      collectText(childValue, parts, childKey);
    }
  }
  return parts;
}

function splitTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => normalizeSpace(cell))
    .filter(Boolean);
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

function isTableLine(line) {
  const text = String(line || '');
  return (text.match(/\|/g) || []).length >= 2;
}

function extractMarkdownTables(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i])) continue;
    const block = [];
    while (i < lines.length && isTableLine(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }
    i -= 1;
    if (block.length < 2) continue;
    const separatorIndex = block.findIndex(isTableSeparator);
    const headerIndex = separatorIndex > 0 ? separatorIndex - 1 : 0;
    const rowStart = separatorIndex >= 0 ? separatorIndex + 1 : headerIndex + 1;
    tables.push({
      headers: splitTableRow(block[headerIndex]),
      rows: block.slice(rowStart).map(splitTableRow).filter(row => row.length),
      rawLines: block.map(line => line.trim())
    });
  }
  return tables;
}

function pickMetadata(type, entity) {
  const keys = [
    'class',
    'supports',
    'prerequisite',
    'level',
    'school',
    'castingTime',
    'range',
    'duration',
    'abilityScores',
    'feat',
    'skillProficiencies',
    'toolProficiencies',
    'languages',
    'languageChoices',
    'size',
    'speed',
    'hitDie',
    'cost',
    'weight',
    'rarity',
    'category'
  ];
  const metadata = {};
  for (const key of keys) {
    if (entity[key] != null && entity[key] !== '' && !(Array.isArray(entity[key]) && !entity[key].length)) {
      metadata[key] = entity[key];
    }
  }
  if (type === 'spell') {
    metadata.components = {
      verbal: !!entity.hasVerbal,
      somatic: !!entity.hasSomatic,
      material: !!entity.hasMaterial,
      materialText: entity.material || ''
    };
    metadata.flags = {
      ritual: !!entity.isRitual,
      concentration: !!entity.isConcentration,
      technomagic: !!entity.isTechnomagic
    };
  }
  return metadata;
}

function featureList(entity) {
  if (Array.isArray(entity.features)) return entity.features;
  if (Array.isArray(entity.traits)) return entity.traits;
  if (Array.isArray(entity.actions)) return entity.actions;
  if (Array.isArray(entity.reactions)) return entity.reactions;
  return [];
}

function normalizeFeature(feature) {
  const textParts = collectText(feature);
  const bodyText = textParts.join('\n').trim();
  return {
    name: feature.name || '',
    level: feature.level || null,
    action: feature.action || '',
    usage: feature.usage || '',
    description: feature.description || '',
    bodyText,
    textLength: normalizeSpace(bodyText).length
  };
}

function normalizeEntity(type, entity, sourceRecords, sourceContextForName) {
  const textParts = collectText(entity);
  const rawBodyText = textParts.join('\n').trim();
  const bodyText = normalizeSpace(rawBodyText);
  const features = featureList(entity).map(normalizeFeature);
  const tableLikeLineCount = rawBodyText.split(/\r?\n/).filter(isTableLine).length;
  return {
    type,
    name: entity.name || '',
    sourceContext: sourceContextForName(sourceRecords, entity.name || ''),
    metadata: pickMetadata(type, entity),
    description: entity.description || '',
    descriptionLength: normalizeSpace(entity.description || '').length,
    bodyText,
    textLength: bodyText.length,
    features,
    tables: extractMarkdownTables(rawBodyText),
    tableLikeLineCount
  };
}

function createSourceModel(options) {
  const {
    sourcePath,
    sourceKind,
    pages,
    pageRange,
    continuationPageCount,
    totalPageCount,
    sourceMeta,
    generatedMeta,
    parsedData,
    types,
    sourceRecords,
    sourceContextForName
  } = options;
  const entities = [];
  const entitiesByType = {};
  for (const type of types) {
    const items = Array.isArray(parsedData[type]) ? parsedData[type] : [];
    entitiesByType[type] = items.map(item => normalizeEntity(type, item, sourceRecords, sourceContextForName));
    entities.push(...entitiesByType[type]);
  }
  const counts = Object.fromEntries(Object.entries(entitiesByType)
    .filter(([, items]) => items.length)
    .map(([type, items]) => [type, items.length]));

  return {
    schemaVersion: 1,
    source: {
      path: sourcePath ? path.resolve(sourcePath) : '',
      kind: sourceKind,
      pageCount: pages?.length || 0,
      pageRange: pageRange || '',
      continuationPageCount: continuationPageCount || 0,
      totalPageCount: totalPageCount || pages?.length || 0,
      name: sourceMeta?.name || '',
      abbr: sourceMeta?.abbr || '',
      author: sourceMeta?.author || '',
      year: sourceMeta?.year || '',
      ruleset: generatedMeta?.ruleset || '',
      rulesetConfidence: generatedMeta?.rulesetConfidence || '',
      rulesetEvidence: generatedMeta?.rulesetEvidence || []
    },
    counts,
    entitiesByType,
    entities
  };
}

function expectedEntityEntries(expectations) {
  const entries = [];
  const expected = expectations.expected || {};
  for (const [type, names] of Object.entries(expected)) {
    for (const name of names || []) entries.push({ type, name });
  }
  for (const item of expectations.expectedEntities || []) {
    if (typeof item === 'string') {
      const [type, ...nameParts] = item.split(':');
      if (type && nameParts.length) entries.push({ type, name: nameParts.join(':') });
    } else if (item?.type && item?.name) {
      entries.push({ type: item.type, name: item.name });
    }
  }
  return entries;
}

function entityGroups(model) {
  const groups = new Map();
  for (const entity of model.entities || []) {
    const key = `${normalizeKey(entity.type)}::${normalizeKey(entity.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entity);
  }
  return groups;
}

function requiredFeatureEntries(expectations) {
  const entries = [];
  const required = expectations.requiredFeatures || {};
  for (const [type, entities] of Object.entries(required)) {
    for (const [name, features] of Object.entries(entities || {})) {
      for (const feature of features || []) entries.push({ type, name, feature });
    }
  }
  return entries;
}

function isFragmentShapedName(name) {
  const words = normalizeSpace(name).split(/\s+/).filter(Boolean);
  if (words.length > 10) return true;
  if (/^(you|your|when|while|if|as|the|this|that|these|those)\b/i.test(name)) return true;
  if (/[,:;]$/.test(name)) return true;
  return false;
}

function artifactFindings(text) {
  const value = String(text || '');
  const findings = [];
  const checks = [
    { pattern: /\uFFFD|\u00c2|\u00c3|\u00e2\u20ac|\u25a1/, label: 'encoding artifact' },
    { pattern: /\bCant rip\b/i, label: 'OCR split for Cantrip' },
    { pattern: /<\/?[A-Za-z][^>]*>/, label: 'raw tag artifact' }
  ];
  for (const check of checks) {
    if (check.pattern.test(value)) findings.push(check.label);
  }
  return findings;
}

function summarizeIssues(issues) {
  const counts = { error: 0, warning: 0, review: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] != null) counts[issue.severity] += 1;
  }
  return {
    ...counts,
    pass: counts.error === 0
  };
}

function validateSourceModel(model, expectations = {}) {
  const issues = [];
  const groups = entityGroups(model);
  const add = (severity, category, message, extra = {}) => {
    issues.push({ severity, category, message, ...extra });
  };

  const minCounts = {
    ...(expectations.minCounts || {}),
    ...(expectations.minExtracted || {})
  };
  for (const [type, minimum] of Object.entries(minCounts)) {
    const count = model.counts?.[type] || 0;
    if (Number.isFinite(minimum) && count < minimum) {
      add('error', 'missing-entity', `${type} count ${count} is below expected minimum ${minimum}.`, { type });
    }
  }

  for (const expected of expectedEntityEntries(expectations)) {
    const key = `${normalizeKey(expected.type)}::${normalizeKey(expected.name)}`;
    if (!groups.has(key)) {
      add('error', 'missing-entity', `Expected ${expected.type} "${expected.name}" was not extracted.`, expected);
    }
  }

  for (const entities of groups.values()) {
    if (entities.length <= 1) continue;
    const first = entities[0];
    add('warning', 'duplicate-entity', `${first.type} "${first.name}" was extracted ${entities.length} times.`, {
      type: first.type,
      name: first.name,
      count: entities.length,
      sourceContext: first.sourceContext
    });
  }

  const minTextLength = Number.isFinite(expectations.minTextLength) ? expectations.minTextLength : 20;
  const minFeatureTextLength = Number.isFinite(expectations.minFeatureTextLength) ? expectations.minFeatureTextLength : 20;
  const requireTextTypes = new Set(expectations.requireTextTypes || expectations.requireDescriptions || []);
  const requireFeaturesForTypes = new Set(expectations.requireFeaturesForTypes || []);
  const requireFeatureTextTypes = new Set(expectations.requireFeatureTextTypes || []);

  for (const entity of model.entities || []) {
    if (!normalizeSpace(entity.name)) {
      add('error', 'missing-name', `Extracted ${entity.type} has no name.`, { type: entity.type });
      continue;
    }
    if (isFragmentShapedName(entity.name)) {
      add('review', 'fragment-shaped-name', `${entity.type} "${entity.name}" looks like prose rather than an element name.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    for (const artifact of artifactFindings(entity.name)) {
      add('warning', 'ocr-artifact', `${entity.type} "${entity.name}" contains a possible ${artifact}.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    for (const artifact of artifactFindings(entity.bodyText)) {
      add('warning', 'ocr-artifact', `${entity.type} "${entity.name}" body contains a possible ${artifact}.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    if (requireTextTypes.has(entity.type) && entity.textLength < minTextLength) {
      add('warning', 'missing-description', `${entity.type} "${entity.name}" has only ${entity.textLength} characters of captured body text.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    if (requireFeaturesForTypes.has(entity.type) && !entity.features.length) {
      add('warning', 'missing-feature', `${entity.type} "${entity.name}" has no parsed features or traits.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    if (requireFeatureTextTypes.has(entity.type)) {
      for (const feature of entity.features) {
        if (feature.textLength < minFeatureTextLength) {
          add('warning', 'missing-feature-description', `${entity.type} "${entity.name}" feature "${feature.name}" has only ${feature.textLength} characters of captured body text.`, {
            type: entity.type,
            name: entity.name,
            feature: feature.name,
            sourceContext: entity.sourceContext
          });
        }
      }
    }
    if (entity.tableLikeLineCount && !entity.tables.length) {
      add('review', 'table-capture', `${entity.type} "${entity.name}" has table-like text that was not normalized into a table.`, {
        type: entity.type,
        name: entity.name,
        sourceContext: entity.sourceContext
      });
    }
    for (const table of entity.tables) {
      if (!table.headers.length || !table.rows.length) {
        add('warning', 'table-capture', `${entity.type} "${entity.name}" has an incomplete table capture.`, {
          type: entity.type,
          name: entity.name,
          sourceContext: entity.sourceContext
        });
      }
    }
  }

  for (const expected of requiredFeatureEntries(expectations)) {
    const entities = groups.get(`${normalizeKey(expected.type)}::${normalizeKey(expected.name)}`) || [];
    if (!entities.length) continue;
    const hasFeature = entities.some(entity => (
      entity.features || []
    ).some(feature => normalizeKey(feature.name) === normalizeKey(expected.feature)));
    if (!hasFeature) {
      add('error', 'missing-feature', `Expected ${expected.type} "${expected.name}" feature "${expected.feature}" was not extracted.`, expected);
    }
  }

  return {
    summary: summarizeIssues(issues),
    issues
  };
}

function renderIssue(issue) {
  const target = [issue.type, issue.name].filter(Boolean).join(': ');
  const prefix = target ? `${target} - ` : '';
  let line = `- ${issue.severity.toUpperCase()} [${issue.category}] ${prefix}${issue.message}`;
  if (issue.sourceContext) {
    line += ` (page ${issue.sourceContext.page}, line ${issue.sourceContext.line}: ${issue.sourceContext.text})`;
  }
  return line;
}

function renderSourceCoverageMarkdown(model, coverage) {
  const lines = [];
  lines.push('# Source Coverage Report');
  lines.push('');
  lines.push(`- Source: \`${model.source.path}\``);
  lines.push(`- Source kind: ${model.source.kind}${model.source.pageCount ? ` (${model.source.pageCount} page${model.source.pageCount === 1 ? '' : 's'})` : ''}`);
  lines.push(`- Selected page range: ${model.source.pageRange || 'all'} (${model.source.pageCount}/${model.source.totalPageCount || model.source.pageCount} page${(model.source.totalPageCount || model.source.pageCount) === 1 ? '' : 's'})`);
  if (model.source.continuationPageCount) lines.push(`- Continuation pages read: ${model.source.continuationPageCount}`);
  lines.push(`- Source name: ${model.source.name || '(unknown)'}`);
  lines.push(`- Source abbreviation: ${model.source.abbr || '(unknown)'}`);
  lines.push(`- Ruleset: ${model.source.ruleset || '(unknown)'}`);
  if (model.source.rulesetConfidence) lines.push(`- Ruleset confidence: ${model.source.rulesetConfidence}`);
  if (model.source.rulesetEvidence?.length) lines.push(`- Ruleset evidence: ${model.source.rulesetEvidence.join('; ')}`);
  lines.push(`- Extracted counts: ${Object.entries(model.counts).map(([type, count]) => `${type}=${count}`).join(', ') || 'none'}`);
  lines.push(`- Findings: errors=${coverage.summary.error}, warnings=${coverage.summary.warning}, review=${coverage.summary.review}`);
  lines.push(`- Source gate: ${coverage.summary.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');

  if (coverage.issues.length) {
    lines.push('## Findings');
    lines.push('');
    for (const severity of ['error', 'warning', 'review']) {
      const issues = coverage.issues.filter(issue => issue.severity === severity);
      if (!issues.length) continue;
      lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)}`);
      lines.push('');
      for (const issue of issues) lines.push(renderIssue(issue));
      lines.push('');
    }
  }

  lines.push('## Extracted Entity Summary');
  lines.push('');
  for (const [type, entities] of Object.entries(model.entitiesByType)) {
    if (!entities.length) continue;
    lines.push(`### ${type}`);
    lines.push('');
    for (const entity of entities) {
      const featureText = entity.features.length ? `, features=${entity.features.length}` : '';
      const tableText = entity.tables.length ? `, tables=${entity.tables.length}` : '';
      lines.push(`- ${entity.name} (text=${entity.textLength}${featureText}${tableText})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  createSourceModel,
  validateSourceModel,
  renderSourceCoverageMarkdown,
  extractMarkdownTables,
  normalizeSpace,
  normalizeKey
};
