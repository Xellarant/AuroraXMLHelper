#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const defaultCustomRoot = path.join(process.env.USERPROFILE || '', 'Documents', '5e Character Builder', 'custom');

const ELEMENT_TYPES = ['spell', 'archetype', 'feat', 'magic', 'item', 'race', 'background', 'class'];
const PARSERS = {
  spell: 'parseSpellsFromText',
  archetype: 'parseArchetypesFromText',
  feat: 'parseFeatsFromText',
  magic: 'parseMagicItemsFromText',
  item: 'parseItemsFromText',
  race: 'parseRacesFromText',
  background: 'parseBackgroundsFromText',
  class: 'parseClassesFromText'
};

function usage() {
  return [
    'Usage:',
    '  node scripts/benchmark-corpus.js --source <text-md-or-pdf-file> --canonical <file-or-dir> [options]',
    '',
    'Options:',
    '  --type <type>             Include one parser type. May be repeated. Defaults to all supported types.',
    '  --source-name <name>      Source name to use while generating XML.',
    '  --source-abbr <abbr>      Source abbreviation to use while generating XML.',
    '  --source-author <name>    Source author to use while generating XML.',
    '  --source-year <year>      Publication year; 2024+ uses 2024 generation rules.',
    '  --custom-root <dir>       Canonical Aurora custom root for dependency lookups.',
    '  --out <file>              Write a Markdown report to this path.',
    '  --json                    Print JSON instead of Markdown.',
    '',
    'PDF sources use pdfjs-dist text extraction, matching the browser app as closely as possible.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    canonical: [],
    types: [],
    customRoot: defaultCustomRoot,
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    switch (arg) {
      case '--source': args.source = next(); break;
      case '--canonical': args.canonical.push(next()); break;
      case '--type': args.types.push(next().toLowerCase()); break;
      case '--source-name': args.sourceName = next(); break;
      case '--source-abbr': args.sourceAbbr = next(); break;
      case '--source-author': args.sourceAuthor = next(); break;
      case '--source-year': args.sourceYear = next(); break;
      case '--custom-root': args.customRoot = next(); break;
      case '--out': args.out = next(); break;
      case '--json': args.json = true; break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!args.source) throw new Error('Missing --source');
  if (!args.canonical.length) throw new Error('Missing --canonical');
  args.types = args.types.length ? args.types : ELEMENT_TYPES;
  for (const type of args.types) {
    if (!ELEMENT_TYPES.includes(type)) throw new Error(`Unsupported benchmark type: ${type}`);
  }
  return args;
}

function createStubElement(value = '') {
  const element = {
    value,
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return element; },
    appendChild() {},
    insertAdjacentHTML() {},
    focus() {},
    remove() {},
    scrollIntoView() {}
  };
  return element;
}

function loadApp(sourceMeta) {
  const elements = {
    sourceName: createStubElement(sourceMeta.name || 'Benchmark Source'),
    sourceAbbr: createStubElement(sourceMeta.abbr || 'BENCH'),
    sourceAuthor: createStubElement(sourceMeta.author || 'Benchmark'),
    sourceYear: createStubElement(sourceMeta.year || ''),
    pageRange: createStubElement('')
  };
  const fallbackElement = createStubElement();
  const document = {
    getElementById(id) {
      return elements[id] || fallbackElement;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return createStubElement(); },
    addEventListener() {},
    documentElement: { dataset: {} }
  };
  const window = {
    addEventListener() {},
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };
  const context = {
    console,
    document,
    window,
    localStorage: window.localStorage,
    Blob: class Blob {},
    URL: {
      createObjectURL() { return ''; },
      revokeObjectURL() {}
    },
    confirm() { return true; },
    alert() {},
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  const appScript = fs.readFileSync(path.join(repoRoot, 'src', 'app.js'), 'utf8');
  vm.runInContext(appScript, context, { filename: 'src/app.js' });
  return { context, elements };
}

function runInApp(context, code) {
  return vm.runInContext(code, context);
}

function listXmlFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`Canonical path does not exist: ${inputPath}`);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return resolved.toLowerCase().endsWith('.xml') ? [resolved] : [];
  const files = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) files.push(...listXmlFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) files.push(full);
  }
  return files;
}

function attrMap(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
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

function parseElements(xml, fileName = '') {
  const elements = [];
  const elementRegex = /<element\b([^>]*)>([\s\S]*?)<\/element>/gi;
  let match;
  while ((match = elementRegex.exec(xml))) {
    const attrs = attrMap(match[1]);
    const body = match[2];
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
    const rules = [];
    for (const rule of rulesBody.matchAll(/<(grant|select|stat|append)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi)) {
      const kind = rule[1];
      const ruleAttrs = attrMap(rule[2]);
      const signature = [kind]
        .concat(Object.keys(ruleAttrs).sort().map(key => `${key}=${ruleAttrs[key]}`))
        .join('|');
      rules.push(signature);
    }
    elements.push({
      fileName,
      name: attrs.name || '',
      type: attrs.type || '',
      source: attrs.source || '',
      id: attrs.id || '',
      supports,
      description,
      setters,
      setterAttrs,
      rules: rules.sort(),
      key: `${normalizeName(attrs.type)}::${normalizeName(attrs.name)}`
    });
  }
  return elements;
}

function compareValues(generated, canonical) {
  if (generated === canonical) return null;
  return { generated, canonical };
}

function compareMaps(generated, canonical) {
  const diffs = [];
  const keys = new Set([...Object.keys(generated), ...Object.keys(canonical)]);
  for (const key of Array.from(keys).sort()) {
    const diff = compareValues(generated[key] || '', canonical[key] || '');
    if (diff) diffs.push({ name: key, ...diff });
  }
  return diffs;
}

function compareRules(generated, canonical) {
  const generatedSet = new Set(generated);
  const canonicalSet = new Set(canonical);
  return {
    missing: canonical.filter(rule => !generatedSet.has(rule)),
    extra: generated.filter(rule => !canonicalSet.has(rule))
  };
}

function splitSupportTokens(value) {
  return normalizeSpace(value)
    .split(/\s*(?:,|\|)\s*/)
    .map(token => token.trim())
    .filter(Boolean);
}

function compareTokenSets(generatedTokens, canonicalTokens) {
  const generatedSet = new Set(generatedTokens.map(token => token.toLowerCase()));
  const canonicalSet = new Set(canonicalTokens.map(token => token.toLowerCase()));
  return {
    missing: canonicalTokens.filter(token => !generatedSet.has(token.toLowerCase())),
    extra: generatedTokens.filter(token => !canonicalSet.has(token.toLowerCase())),
    same: generatedSet.size === canonicalSet.size && Array.from(generatedSet).every(token => canonicalSet.has(token))
  };
}

function compareSupports(generated, canonical) {
  if (generated === canonical) return null;
  const generatedTokens = splitSupportTokens(generated);
  const canonicalTokens = splitSupportTokens(canonical);
  const tokenDiff = compareTokenSets(generatedTokens, canonicalTokens);
  return {
    generated,
    canonical,
    missing: tokenDiff.missing,
    extra: tokenDiff.extra,
    meaningful: !tokenDiff.same,
    note: tokenDiff.same ? 'same support tokens in a different order or separator style' : ''
  };
}

function classifySetterDiff(name) {
  const key = String(name || '').toLowerCase();
  if (['keywords', 'level', 'school', 'time', 'range', 'duration', 'components', 'material', 'isritual', 'isconcentration'].includes(key)) {
    return 'spell-metadata';
  }
  if (['short', 'category', 'slot', 'cost', 'weight', 'rarity', 'type', 'armor', 'weapon'].includes(key)) {
    return 'element-metadata';
  }
  return 'setter';
}

function classifyRuleSignature(signature) {
  const kind = String(signature || '').split('|')[0] || 'rule';
  if (kind === 'grant') return 'grant-rules';
  if (kind === 'select') return 'choice-rules';
  if (kind === 'stat') return 'stat-rules';
  if (kind === 'append') return 'append-rules';
  return 'rules';
}

function summarizeSemanticDiffs({ idDiff, supportsDiff, setterDiffs, rules }) {
  const categories = new Set();
  let severity = 'none';
  const bump = next => {
    const order = { none: 0, low: 1, medium: 2, high: 3 };
    if (order[next] > order[severity]) severity = next;
  };

  if (idDiff) {
    categories.add('id');
    bump('high');
  }
  if (supportsDiff) {
    categories.add('support-tags');
    bump(supportsDiff.meaningful ? 'medium' : 'low');
  }
  for (const setter of setterDiffs) {
    categories.add(classifySetterDiff(setter.name));
    bump('medium');
  }
  for (const rule of rules.missing) {
    categories.add(classifyRuleSignature(rule));
    bump('high');
  }
  for (const rule of rules.extra) {
    categories.add(classifyRuleSignature(rule));
    bump('high');
  }

  return {
    severity,
    categories: Array.from(categories).sort()
  };
}

function indexByKey(elements) {
  const index = new Map();
  for (const element of elements) {
    if (!index.has(element.key)) index.set(element.key, []);
    index.get(element.key).push(element);
  }
  return index;
}

function generateBenchmarkXml(context, text, types) {
  const data = {};
  for (const type of ELEMENT_TYPES) data[type] = [];
  data.other = [];
  for (const type of types) {
    const parserName = PARSERS[type];
    const parsed = context[parserName](text);
    data[type] = type === 'feat' ? parsed.map(feat => context.parseFeatFullText(feat)) : parsed;
  }
  runInApp(context, `extractedData = ${JSON.stringify(data)};`);
  const xml = runInApp(context, 'generateXml()');
  const meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  return { data, xml, meta };
}

function summarizeExtractedData(data) {
  return Object.fromEntries(Object.entries(data)
    .filter(([, items]) => Array.isArray(items) && items.length)
    .map(([type, items]) => [type, items.length]));
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLineRecords(pages) {
  const records = [];
  for (const page of pages) {
    String(page.text || '').split(/\r?\n/).forEach((text, index) => {
      const line = text.trim();
      if (line) records.push({ page: page.page, line: index + 1, text: line });
    });
  }
  return records;
}

function sourceContextForName(records, name) {
  const normalizedName = normalizeSearchText(name);
  if (!normalizedName) return null;
  const words = normalizedName.split(' ').filter(Boolean);
  const needles = [
    normalizedName,
    words.slice(0, 6).join(' '),
    words.slice(0, 4).join(' ')
  ].filter(needle => needle.length >= 8);

  let matchIndex = -1;
  for (const needle of needles) {
    matchIndex = records.findIndex(record => normalizeSearchText(record.text).includes(needle));
    if (matchIndex !== -1) break;
  }
  if (matchIndex === -1) return null;
  const match = records[matchIndex];
  return {
    page: match.page,
    line: match.line,
    before: records.slice(Math.max(0, matchIndex - 2), matchIndex).map(record => record.text),
    text: match.text,
    after: records.slice(matchIndex + 1, matchIndex + 3).map(record => record.text)
  };
}

function textItemsToLines(items) {
  const rows = [];
  for (const item of items) {
    const y = Math.round((item.transform?.[5] || 0) * 2) / 2;
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x: item.transform?.[4] || 0, str: item.str || '' });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.items
      .sort((a, b) => a.x - b.x)
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

async function extractPdfPages(sourcePath) {
  let pdfjsLib;
  const shouldSuppressPdfJsWarning = args => /Cannot polyfill `(DOMMatrix|Path2D)`/.test(String(args[0] || ''));
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  try {
    console.log = (...args) => { if (!shouldSuppressPdfJsWarning(args)) originalLog(...args); };
    console.warn = (...args) => { if (!shouldSuppressPdfJsWarning(args)) originalWarn(...args); };
    console.error = (...args) => { if (!shouldSuppressPdfJsWarning(args)) originalError(...args); };
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  } catch (error) {
    throw new Error(`PDF source support requires pdfjs-dist and Node 20+: ${error.message}`);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  const data = new Uint8Array(fs.readFileSync(sourcePath));
  const pdf = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl: path.join(repoRoot, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep
  }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push({ page: p, text: textItemsToLines(content.items).join('\n') });
  }
  return pages;
}

async function readSource(sourcePath) {
  if (/\.pdf$/i.test(sourcePath)) {
    const pages = await extractPdfPages(sourcePath);
    const text = pages.map(page => page.text).join('\n\n');
    if (!text.trim()) throw new Error(`No selectable text was found in PDF source: ${sourcePath}`);
    return { kind: 'pdf', pages, text };
  }
  const text = fs.readFileSync(sourcePath, 'utf8');
  return { kind: 'text', pages: [{ page: 1, text }], text };
}

async function benchmark(args) {
  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${args.source}`);
  const source = await readSource(sourcePath);
  const sourceText = source.text;
  const sourceBase = path.basename(sourcePath, path.extname(sourcePath));
  const sourceMeta = {
    name: args.sourceName || sourceBase.replace(/[_-]/g, ' '),
    abbr: args.sourceAbbr || sourceBase.split(/\s+/).map(word => word[0]).join('').toUpperCase().slice(0, 8) || 'BENCH',
    author: args.sourceAuthor || 'Benchmark',
    year: args.sourceYear || ''
  };
  const { context, elements } = loadApp(sourceMeta);
  runInApp(context, `detectSourceMetaFromText(${JSON.stringify(source.pages)});`);
  if (args.sourceName) elements.sourceName.value = args.sourceName;
  if (args.sourceAbbr) elements.sourceAbbr.value = args.sourceAbbr;
  if (args.sourceAuthor) elements.sourceAuthor.value = args.sourceAuthor;
  if (args.sourceYear) elements.sourceYear.value = args.sourceYear;

  const generated = generateBenchmarkXml(context, sourceText, args.types);
  const generatedElements = parseElements(generated.xml, sourcePath).filter(element => element.type !== 'Source');
  const sourceRecords = sourceLineRecords(source.pages);
  const canonicalFiles = args.canonical.flatMap(listXmlFiles);
  const canonicalElements = [];
  for (const file of canonicalFiles) {
    canonicalElements.push(...parseElements(fs.readFileSync(file, 'utf8'), file));
  }
  const canonicalIndex = indexByKey(canonicalElements);
  const matches = [];
  const unmatched = [];
  for (const element of generatedElements) {
    const candidates = canonicalIndex.get(element.key) || [];
    if (!candidates.length) {
      unmatched.push(element);
      continue;
    }
    const canonical = candidates.find(candidate => candidate.id === element.id) || candidates[0];
    const setterDiffs = compareMaps(element.setters, canonical.setters);
    const rules = compareRules(element.rules, canonical.rules);
    const supportsDiff = compareSupports(element.supports, canonical.supports);
    const idDiff = compareValues(element.id, canonical.id);
    const semantic = summarizeSemanticDiffs({ idDiff, supportsDiff, setterDiffs, rules });
    matches.push({
      generated: element,
      canonical,
      idDiff,
      supportsDiff,
      setterDiffs,
      rules,
      semantic,
      different: semantic.severity !== 'none'
    });
  }
  const severityCounts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const match of matches) severityCounts[match.semantic.severity] += 1;
  return {
    source: sourcePath,
    sourceKind: source.kind,
    pageCount: source.pages.length,
    canonical: canonicalFiles,
    meta: generated.meta,
    extractedCounts: summarizeExtractedData(generated.data),
    generatedCount: generatedElements.length,
    canonicalCount: canonicalElements.length,
    matchedCount: matches.length,
    exactShapeMatches: matches.filter(match => !match.different).length,
    differentMatches: matches.filter(match => match.different).length,
    severityCounts,
    highSeverityMatches: severityCounts.high,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.slice(0, 40).map(element => ({
        type: element.type,
        name: element.name,
        id: element.id,
        sourceContext: sourceContextForName(sourceRecords, element.name)
      })),
    matches: matches
      .filter(match => match.different)
      .slice(0, 40)
      .map(match => ({
        type: match.generated.type,
        name: match.generated.name,
        generatedId: match.generated.id,
        canonicalId: match.canonical.id,
        canonicalFile: match.canonical.fileName,
        severity: match.semantic.severity,
        categories: match.semantic.categories,
        id: match.idDiff,
        supports: match.supportsDiff,
        setters: match.setterDiffs.slice(0, 12),
        missingRules: match.rules.missing.slice(0, 12),
        extraRules: match.rules.extra.slice(0, 12),
        sourceContext: sourceContextForName(sourceRecords, match.generated.name)
      }))
  };
}

function renderMarkdown(result) {
  const pct = result.matchedCount
    ? ((result.exactShapeMatches / result.matchedCount) * 100).toFixed(1)
    : '0.0';
  const lines = [];
  lines.push('# Corpus Benchmark Report');
  lines.push('');
  lines.push(`- Source: \`${result.source}\``);
  lines.push(`- Source kind: ${result.sourceKind}${result.pageCount ? ` (${result.pageCount} page${result.pageCount === 1 ? '' : 's'})` : ''}`);
  lines.push(`- Canonical files scanned: ${result.canonical.length}`);
  lines.push(`- Source ruleset: ${result.meta.ruleset}${result.meta.year ? ` (${result.meta.year})` : ''}`);
  lines.push(`- Ruleset confidence: ${result.meta.rulesetConfidence || 'unknown'}`);
  if (result.meta.rulesetEvidence?.length) lines.push(`- Ruleset evidence: ${result.meta.rulesetEvidence.join('; ')}`);
  lines.push(`- Extracted counts: ${Object.entries(result.extractedCounts).map(([type, count]) => `${type}=${count}`).join(', ') || 'none'}`);
  lines.push(`- Generated elements: ${result.generatedCount}`);
  lines.push(`- Matched canonical elements by name/type: ${result.matchedCount}`);
  lines.push(`- Exact shape matches among matched elements: ${result.exactShapeMatches}/${result.matchedCount} (${pct}%)`);
  lines.push(`- Differing matched elements: ${result.differentMatches}`);
  lines.push(`- Difference severity: high=${result.severityCounts.high}, medium=${result.severityCounts.medium}, low=${result.severityCounts.low}`);
  lines.push(`- Unmatched generated elements: ${result.unmatchedCount}`);
  lines.push('');
  if (result.matches.length) {
    lines.push('## Differing Matched Elements');
    lines.push('');
    for (const match of result.matches) {
      lines.push(`### ${match.type}: ${match.name}`);
      lines.push(`- Generated ID: \`${match.generatedId}\``);
      lines.push(`- Canonical ID: \`${match.canonicalId}\``);
      lines.push(`- Canonical file: \`${match.canonicalFile}\``);
      lines.push(`- Severity: ${match.severity}`);
      if (match.categories.length) lines.push(`- Categories: ${match.categories.join(', ')}`);
      if (match.id) {
        lines.push(`- ID: generated \`${match.id.generated}\`, canonical \`${match.id.canonical}\``);
      }
      if (match.supports) {
        lines.push(`- Supports: generated \`${match.supports.generated}\`, canonical \`${match.supports.canonical}\``);
        if (match.supports.note) lines.push(`- Supports note: ${match.supports.note}`);
        if (match.supports.missing.length) lines.push(`- Missing support tags: ${match.supports.missing.map(tag => `\`${tag}\``).join(', ')}`);
        if (match.supports.extra.length) lines.push(`- Extra support tags: ${match.supports.extra.map(tag => `\`${tag}\``).join(', ')}`);
      }
      for (const setter of match.setters) {
        lines.push(`- Setter \`${setter.name}\`: generated \`${setter.generated}\`, canonical \`${setter.canonical}\``);
      }
      for (const rule of match.missingRules) lines.push(`- Missing rule: \`${rule}\``);
      for (const rule of match.extraRules) lines.push(`- Extra rule: \`${rule}\``);
      if (match.sourceContext) {
        lines.push(`- Source context: page ${match.sourceContext.page}, line ${match.sourceContext.line}: \`${match.sourceContext.text}\``);
      }
      lines.push('');
    }
  }
  if (result.unmatched.length) {
    lines.push('## Unmatched Generated Elements');
    lines.push('');
    for (const element of result.unmatched) {
      lines.push(`- ${element.type}: ${element.name} (\`${element.id}\`)`);
      if (element.sourceContext) {
        lines.push(`  Source context: page ${element.sourceContext.page}, line ${element.sourceContext.line}: \`${element.sourceContext.text}\``);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await benchmark(args);
    const output = args.json ? JSON.stringify(result, null, 2) : renderMarkdown(result);
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, output, 'utf8');
    }
    console.log(output);
  } catch (error) {
    console.error(error.message);
    console.error('');
    console.error(usage());
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ELEMENT_TYPES,
  benchmark,
  renderMarkdown,
  compareSupports,
  summarizeSemanticDiffs,
  loadApp,
  runInApp,
  readSource,
  generateBenchmarkXml,
  sourceLineRecords,
  sourceContextForName,
  summarizeExtractedData,
  parseElements,
  listXmlFiles
};
