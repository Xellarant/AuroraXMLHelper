#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  ELEMENT_TYPES,
  loadApp,
  runInApp,
  readSource,
  generateBenchmarkXml,
  sourceLineRecords,
  sourceContextForName
} = require('./benchmark-corpus');
const {
  createSourceModel,
  validateSourceModel,
  renderSourceCoverageMarkdown
} = require('./source-validation');

const repoRoot = path.resolve(__dirname, '..');
const defaultManifest = path.join(repoRoot, 'tests', 'fixtures', 'local-corpus.json');

function usage() {
  return [
    'Usage:',
    '  node scripts/source-fixture-report.js --source <text-md-or-pdf-file> [options]',
    '  node scripts/source-fixture-report.js --manifest <file> --name <entry name> [options]',
    '',
    'Options:',
    '  --manifest <file>        Read a local corpus manifest entry.',
    '  --name <entry name>      Select a manifest benchmark by name.',
    '  --source <file>          Source text, Markdown, or selectable-text PDF.',
    '  --type <type>            Include one parser type. May be repeated. Defaults to all supported types.',
    '  --source-name <name>     Source name to use while parsing.',
    '  --source-abbr <abbr>     Source abbreviation to use while parsing.',
    '  --source-author <name>   Source author to use while parsing.',
    '  --source-year <year>     Publication year; 2024+ uses 2024 generation rules.',
    '  --expect <file>          JSON file containing sourceValidation expectations.',
    '  --out-dir <dir>          Write normalized-source.json, source-coverage-report.md, and source-coverage-summary.json.',
    '  --model-out <file>       Write only the normalized source model JSON.',
    '  --report-out <file>      Write only the Markdown source coverage report.',
    '  --summary-out <file>     Write only the source coverage summary JSON.',
    '  --json                   Print JSON instead of Markdown.',
    '',
    'The source gate fails only on error findings by default. Warnings and review findings are reportable work, not hard failures.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    manifest: '',
    name: '',
    types: [],
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    switch (arg) {
      case '--manifest': args.manifest = next(); break;
      case '--name': args.name = next(); break;
      case '--source': args.source = next(); break;
      case '--type': args.types.push(next().toLowerCase()); break;
      case '--source-name': args.sourceName = next(); break;
      case '--source-abbr': args.sourceAbbr = next(); break;
      case '--source-author': args.sourceAuthor = next(); break;
      case '--source-year': args.sourceYear = next(); break;
      case '--expect': args.expect = next(); break;
      case '--out-dir': args.outDir = next(); break;
      case '--model-out': args.modelOut = next(); break;
      case '--report-out': args.reportOut = next(); break;
      case '--summary-out': args.summaryOut = next(); break;
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
  return args;
}

function expandLocalPath(value) {
  return String(value || '')
    .replace(/\{USERPROFILE\}/g, process.env.USERPROFILE || '')
    .replace(/\{HOME\}/g, process.env.HOME || '')
    .replace(/\{REPO_ROOT\}/g, repoRoot);
}

function loadManifestEntry(args) {
  const manifestPath = path.resolve(expandLocalPath(args.manifest || defaultManifest));
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = manifest.benchmarks || [];
  const entry = args.name
    ? entries.find(candidate => candidate.name === args.name)
    : entries[0];
  if (!entry) throw new Error(args.name ? `Manifest entry not found: ${args.name}` : 'Manifest has no benchmark entries.');
  return entry;
}

function sourceMetaFromArgs(args, entry, sourcePath) {
  const entryMeta = entry?.sourceMeta || {};
  const sourceBase = path.basename(sourcePath || 'Source', path.extname(sourcePath || ''));
  return {
    name: args.sourceName || entryMeta.name || sourceBase.replace(/[_-]/g, ' '),
    abbr: args.sourceAbbr || entryMeta.abbr || sourceBase.split(/\s+/).map(word => word[0]).join('').toUpperCase().slice(0, 8) || 'SRC',
    author: args.sourceAuthor || entryMeta.author || 'Source Fixture',
    year: args.sourceYear || entryMeta.year || ''
  };
}

function loadExpectations(args, entry) {
  const expectations = { ...(entry?.sourceValidation || {}) };
  if (args.expect) {
    const fileExpectations = JSON.parse(fs.readFileSync(path.resolve(expandLocalPath(args.expect)), 'utf8'));
    return { ...expectations, ...fileExpectations };
  }
  return expectations;
}

function writeText(filePath, content) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
}

async function buildSourceReport(rawArgs) {
  const args = { ...rawArgs };
  const entry = args.manifest || (!args.source && fs.existsSync(defaultManifest))
    ? loadManifestEntry(args)
    : null;
  const sourcePath = path.resolve(expandLocalPath(args.source || entry?.source || ''));
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`);
  const source = await readSource(sourcePath);
  const sourceMeta = sourceMetaFromArgs(args, entry, sourcePath);
  const types = (args.types.length ? args.types : entry?.sourceValidation?.types || entry?.types || ELEMENT_TYPES)
    .map(type => type.toLowerCase());
  for (const type of types) {
    if (!ELEMENT_TYPES.includes(type)) throw new Error(`Unsupported source fixture type: ${type}`);
  }

  const { context, elements } = loadApp(sourceMeta);
  runInApp(context, `detectSourceMetaFromText(${JSON.stringify(source.pages)});`);
  elements.sourceName.value = sourceMeta.name;
  elements.sourceAbbr.value = sourceMeta.abbr;
  elements.sourceAuthor.value = sourceMeta.author;
  elements.sourceYear.value = String(sourceMeta.year || '');

  const generated = generateBenchmarkXml(context, source.text, types);
  const sourceRecords = sourceLineRecords(source.pages);
  const model = createSourceModel({
    sourcePath,
    sourceKind: source.kind,
    pages: source.pages,
    sourceMeta,
    generatedMeta: generated.meta,
    parsedData: generated.data,
    types,
    sourceRecords,
    sourceContextForName
  });
  const coverage = validateSourceModel(model, loadExpectations(args, entry));
  const markdown = renderSourceCoverageMarkdown(model, coverage);
  return { model, coverage, markdown };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.source && !args.manifest && !fs.existsSync(defaultManifest)) {
      throw new Error('Missing --source or --manifest');
    }
    const result = await buildSourceReport(args);
    if (args.outDir) {
      const outDir = path.resolve(expandLocalPath(args.outDir));
      writeText(path.join(outDir, 'normalized-source.json'), JSON.stringify(result.model, null, 2));
      writeText(path.join(outDir, 'source-coverage-report.md'), result.markdown);
      writeText(path.join(outDir, 'source-coverage-summary.json'), JSON.stringify(result.coverage, null, 2));
    }
    if (args.modelOut) writeText(expandLocalPath(args.modelOut), JSON.stringify(result.model, null, 2));
    if (args.reportOut) writeText(expandLocalPath(args.reportOut), result.markdown);
    if (args.summaryOut) writeText(expandLocalPath(args.summaryOut), JSON.stringify(result.coverage, null, 2));

    console.log(args.json ? JSON.stringify({ model: result.model, coverage: result.coverage }, null, 2) : result.markdown);
    if (!result.coverage.summary.pass) process.exit(1);
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
  buildSourceReport,
  parseArgs
};
