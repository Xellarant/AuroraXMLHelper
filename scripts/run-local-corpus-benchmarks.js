#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { ELEMENT_TYPES, benchmark, renderMarkdown } = require('./benchmark-corpus');

const repoRoot = path.resolve(__dirname, '..');
const defaultManifest = path.join(repoRoot, 'tests', 'fixtures', 'local-corpus.json');

function usage() {
  return [
    'Usage:',
    '  node scripts/run-local-corpus-benchmarks.js [--manifest <file>] [--verbose]',
    '',
    'The default manifest is tests/fixtures/local-corpus.json, which is gitignored.',
    'Copy tests/fixtures/local-corpus.example.json to that path and adjust local paths.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { manifest: defaultManifest, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    switch (arg) {
      case '--manifest': args.manifest = next(); break;
      case '--verbose': args.verbose = true; break;
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

function normalizeCanonical(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.map(expandLocalPath).filter(Boolean);
}

function exactPercent(result) {
  return result.matchedCount ? (result.exactShapeMatches / result.matchedCount) * 100 : 0;
}

function shouldSkipEntry(entry) {
  if (entry.enabled === false) return 'disabled in manifest';
  if (entry.optional && !fs.existsSync(expandLocalPath(entry.source))) return 'optional source missing';
  return '';
}

async function runBenchmark(entry) {
  const sourceMeta = entry.sourceMeta || {};
  return benchmark({
    source: expandLocalPath(entry.source),
    canonical: normalizeCanonical(entry.canonical),
    types: entry.types || ELEMENT_TYPES,
    sourceName: sourceMeta.name,
    sourceAbbr: sourceMeta.abbr,
    sourceAuthor: sourceMeta.author,
    sourceYear: sourceMeta.year,
    customRoot: expandLocalPath(entry.customRoot || ''),
    json: false
  });
}

function checkThresholds(entry, result) {
  const thresholds = entry.thresholds || {};
  const failures = [];
  const extractedTotal = Object.values(result.extractedCounts || {}).reduce((sum, count) => sum + count, 0);
  if (Number.isFinite(thresholds.minGenerated) && result.generatedCount < thresholds.minGenerated) {
    failures.push(`generated ${result.generatedCount} < ${thresholds.minGenerated}`);
  }
  if (Number.isFinite(thresholds.minMatched) && result.matchedCount < thresholds.minMatched) {
    failures.push(`matched ${result.matchedCount} < ${thresholds.minMatched}`);
  }
  if (Number.isFinite(thresholds.minExtractedTotal) && extractedTotal < thresholds.minExtractedTotal) {
    failures.push(`extracted ${extractedTotal} < ${thresholds.minExtractedTotal}`);
  }
  if (thresholds.minExtracted && typeof thresholds.minExtracted === 'object') {
    for (const [type, minimum] of Object.entries(thresholds.minExtracted)) {
      const count = result.extractedCounts?.[type] || 0;
      if (Number.isFinite(minimum) && count < minimum) {
        failures.push(`${type} extracted ${count} < ${minimum}`);
      }
    }
  }
  if (Number.isFinite(thresholds.minExactPercent) && exactPercent(result) < thresholds.minExactPercent) {
    failures.push(`exact ${exactPercent(result).toFixed(1)}% < ${thresholds.minExactPercent}%`);
  }
  if (Number.isFinite(thresholds.maxUnmatched) && result.unmatchedCount > thresholds.maxUnmatched) {
    failures.push(`unmatched ${result.unmatchedCount} > ${thresholds.maxUnmatched}`);
  }
  if (Number.isFinite(thresholds.maxDifferent) && result.differentMatches > thresholds.maxDifferent) {
    failures.push(`different ${result.differentMatches} > ${thresholds.maxDifferent}`);
  }
  if (Number.isFinite(thresholds.maxHighSeverity) && result.highSeverityMatches > thresholds.maxHighSeverity) {
    failures.push(`high severity ${result.highSeverityMatches} > ${thresholds.maxHighSeverity}`);
  }
  return failures;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const manifestPath = path.resolve(args.manifest);
    if (!fs.existsSync(manifestPath)) {
      console.log(`No local corpus manifest found at ${manifestPath}.`);
      console.log('Copy tests/fixtures/local-corpus.example.json to tests/fixtures/local-corpus.json to enable local corpus checks.');
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = manifest.benchmarks || [];
    if (!entries.length) throw new Error('Manifest has no benchmarks.');
    let failed = false;
    for (const entry of entries) {
      const skipReason = shouldSkipEntry(entry);
      const name = entry.name || entry.source;
      if (skipReason) {
        console.log(`${name}: skipped (${skipReason})`);
        continue;
      }
      const result = await runBenchmark(entry);
      const pct = exactPercent(result).toFixed(1);
      console.log(`${name}: ${result.exactShapeMatches}/${result.matchedCount} exact (${pct}%), unmatched=${result.unmatchedCount}, different=${result.differentMatches}, high=${result.highSeverityMatches}`);
      if (args.verbose) {
        console.log(renderMarkdown(result));
      }
      const failures = checkThresholds(entry, result);
      if (failures.length) {
        failed = true;
        console.error(`Threshold failure for ${name}: ${failures.join('; ')}`);
      }
    }
    if (failed) process.exit(1);
  } catch (error) {
    console.error(error.message);
    console.error('');
    console.error(usage());
    process.exit(1);
  }
}

main();
