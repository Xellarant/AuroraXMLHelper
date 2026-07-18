#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeAuroraXmlDocuments,
  renderPatternReport
} = require('../src/aurora-xml-patterns');

function usage() {
  return [
    'Usage:',
    '  node scripts/aurora-pattern-report.js --xml <file-or-dir> [--xml <file-or-dir> ...] [options]',
    '',
    'Options:',
    '  --top <n>       Limit each pattern count bucket to the top n entries in JSON/Markdown output.',
    '  --out <file>    Write the report to a file.',
    '  --json          Print JSON instead of Markdown.',
    '',
    'The report summarizes observed Aurora element shapes and flags common XML repair issues.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { xml: [], json: false, top: 12 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    switch (arg) {
      case '--xml': args.xml.push(next()); break;
      case '--top': {
        const value = Number(next());
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('--top must be a positive integer');
        args.top = value;
        break;
      }
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
  if (!args.xml.length) throw new Error('Missing --xml');
  return args;
}

function listXmlFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`XML path does not exist: ${inputPath}`);
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

function readDocuments(paths) {
  const files = Array.from(new Set(paths.flatMap(listXmlFiles))).sort();
  if (!files.length) throw new Error('No .xml files were found.');
  return files.map(fileName => ({ fileName, xml: fs.readFileSync(fileName, 'utf8') }));
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const docs = readDocuments(args.xml);
    const analysis = analyzeAuroraXmlDocuments(docs, { top: args.top });
    const output = args.json
      ? JSON.stringify({
        files: docs.map(doc => doc.fileName),
        catalog: analysis.catalog,
        diagnostics: analysis.diagnostics
      }, null, 2)
      : renderPatternReport(analysis, { top: args.top });
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
  listXmlFiles,
  parseArgs,
  readDocuments
};
