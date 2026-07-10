const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { benchmark, compareMaps, compareSupports, continuationPageNumbers, parseArgs, readSource, summarizeSemanticDiffs } = require('../scripts/benchmark-corpus');
const { runBenchmark, runEntry } = require('../scripts/run-local-corpus-benchmarks');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function makeTextPdf(lines) {
  return makeTextPdfPages([lines]);
}

function makeTextPdfPages(pageLines) {
  const pageCount = pageLines.length;
  const pageObjectNumber = index => 3 + (index * 2);
  const contentObjectNumber = index => pageObjectNumber(index) + 1;
  const fontObjectNumber = 3 + (pageCount * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageLines.map((_, index) => `${pageObjectNumber(index)} 0 R`).join(' ')}] /Count ${pageCount} >>`
  ];
  for (let pageIndex = 0; pageIndex < pageLines.length; pageIndex++) {
    const lines = pageLines[pageIndex];
    const textOps = lines.flatMap((line, index) => (
      index === 0 ? [`(${escapePdfText(line)}) Tj`] : ['0 -16 Td', `(${escapePdfText(line)}) Tj`]
    ));
    const stream = ['BT', '/F1 12 Tf', '72 720 Td', ...textOps, 'ET'].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber(pageIndex)} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('support token ordering is reported as low severity only', () => {
  const supports = compareSupports('Dragonmark, General Feat', 'General Feat, Dragonmark');
  const semantic = summarizeSemanticDiffs({
    idDiff: null,
    supportsDiff: supports,
    setterDiffs: [],
    rules: { missing: [], extra: [] }
  });

  assert.equal(supports.meaningful, false);
  assert.equal(semantic.severity, 'low');
  assert.deepEqual(semantic.categories, ['support-tags']);
});

test('benchmark extracts selectable text from PDF sources', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-pdf-benchmark-'));
  const sourcePath = path.join(tempRoot, 'memory-spark.pdf');
  fs.writeFileSync(sourcePath, makeTextPdf([
    'Memory Spark',
    '1st-level evocation',
    'Casting Time: 1 Action',
    'Range: 30 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'A brief flare of light.'
  ]));

  const result = await benchmark({
    source: sourcePath,
    canonical: [tempRoot],
    types: ['spell'],
    sourceName: 'PDF Fixture',
    sourceAbbr: 'PDF',
    sourceAuthor: 'Codex Fixture'
  });

  assert.equal(result.sourceKind, 'pdf');
  assert.equal(result.pageCount, 1);
  assert.equal(result.extractedCounts.spell, 1);
  assert.equal(result.unmatched[0].name, 'Memory Spark');
  assert.equal(result.unmatched[0].sourceContext.page, 1);
  assert.equal(result.unmatched[0].sourceContext.text, 'Memory Spark');
});

test('benchmark treats a material cost spacing variant as source-equivalent', () => {
  assert.deepEqual(compareMaps(
    { materialComponent: 'an engraved object worth at least 500 gp' },
    { materialComponent: 'an engraved object worth at least 500gp' }
  ), []);
});

test('benchmark parses and reports only the selected PDF page range', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-page-range-'));
  const sourcePath = path.join(tempRoot, 'two-spell-pages.pdf');
  fs.writeFileSync(sourcePath, makeTextPdfPages([
    [
      'First Page Spark',
      '1st-level evocation',
      'Casting Time: 1 Action',
      'Range: 30 feet',
      'Components: V, S',
      'Duration: Instantaneous',
      'A first-page flare.'
    ],
    [
      'Second Page Spark',
      '2nd-level evocation',
      'Casting Time: 1 Action',
      'Range: 60 feet',
      'Components: V, S',
      'Duration: Instantaneous',
      'A second-page flare.'
    ]
  ]));

  const result = await benchmark({
    source: sourcePath,
    canonical: [tempRoot],
    types: ['spell'],
    sourceName: 'Page Range Fixture',
    sourceAbbr: 'PRF',
    sourceAuthor: 'Codex Fixture',
    pageRange: '2'
  });

  assert.equal(result.pageRange, '2');
  assert.equal(result.pageCount, 1);
  assert.equal(result.totalPageCount, 2);
  assert.equal(result.extractedCounts.spell, 1);
  assert.equal(result.unmatched[0].name, 'Second Page Spark');
  assert.equal(result.unmatched[0].sourceContext.page, 2);
});

test('PDF page ranges retain only the immediate next page as continuation context', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-continuation-'));
  const sourcePath = path.join(tempRoot, 'three-pages.pdf');
  fs.writeFileSync(sourcePath, makeTextPdfPages([
    ['Selected page'],
    ['Continuation page'],
    ['Out of scope page']
  ]));

  const source = await readSource(sourcePath, '1');

  assert.deepEqual(source.pages.map(page => page.page), [1]);
  assert.deepEqual(source.continuationPages.map(page => page.page), [2]);
  assert.equal(source.text.includes('Continuation page'), false);
  assert.deepEqual(continuationPageNumbers(5, [1, 2, 4]), [3, 5]);
});

test('invalid PDF page ranges fail instead of falling back to the whole source', () => {
  assert.throws(
    () => parseArgs(['--source', 'fixture.pdf', '--canonical', 'canonical', '--page-range', '21-']),
    /Invalid page range: 21-/
  );
  assert.throws(
    () => parseArgs(['--source', 'fixture.pdf', '--canonical', 'canonical', '--page-range', '23-21']),
    /Invalid page range: 23-21/
  );
});

test('benchmark classifies missing canonical rules as high severity', async () => {
  const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.fixture.json');
  const sourcePath = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'synthetic-2024.source.txt');
  const { xml } = generateFromFixtureFile(fixturePath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-xml-helper-benchmark-'));
  const canonicalPath = path.join(tempRoot, 'synthetic-canonical.xml');
  const canonicalXml = xml.replace(
    '</rules>',
    '\t\t\t<stat name="fixture:canonical-only" value="1" />\n\t\t</rules>'
  );
  fs.writeFileSync(canonicalPath, canonicalXml, 'utf8');

  const result = await benchmark({
    source: sourcePath,
    canonical: [tempRoot],
    types: ['spell', 'archetype', 'feat', 'background'],
    sourceName: 'Synthetic 2024 Shape Fixture',
    sourceAbbr: 'FXT',
    sourceAuthor: 'Codex Fixture',
    sourceYear: '2025'
  });

  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.highSeverityMatches, 1);
  assert.equal(result.severityCounts.high, 1);
  assert.ok(result.matches.some(match => (
    match.severity === 'high' &&
    match.categories.includes('stat-rules') &&
    match.missingRules.includes('stat|name=fixture:canonical-only|value=1')
  )));
});

function passingBenchmarkResult() {
  return {
    exactShapeMatches: 1,
    matchedCount: 1,
    unmatchedCount: 0,
    differentMatches: 0,
    highSeverityMatches: 0,
    extractedCounts: {}
  };
}

test('local corpus entry fails when declared source validation has errors', async () => {
  const errors = [];
  const result = await runEntry({
    name: 'Source Gate Fixture',
    source: 'fixture.txt',
    sourceValidation: { expected: { spell: ['Missing Spell'] } },
    thresholds: {}
  }, {
    benchmarkFn: async () => passingBenchmarkResult(),
    sourceValidationFn: async () => ({
      markdown: '# Source Coverage Report',
      coverage: {
        summary: { error: 1, warning: 0, review: 0, pass: false },
        issues: [{ severity: 'error', category: 'missing-entity', message: 'Missing Spell' }]
      }
    }),
    log() {},
    error(message) { errors.push(message); }
  });

  assert.equal(result.failed, true);
  assert.deepEqual(result.failures, ['source errors 1 > 0']);
  assert.ok(errors[0].includes('Threshold failure for Source Gate Fixture'));
});

test('local corpus entry reports source warnings without failing', async () => {
  const logs = [];
  const result = await runEntry({
    name: 'Warning Fixture',
    source: 'fixture.txt',
    sourceValidation: { requireTextTypes: ['feat'] },
    thresholds: {}
  }, {
    benchmarkFn: async () => passingBenchmarkResult(),
    sourceValidationFn: async () => ({
      markdown: '# Source Coverage Report',
      coverage: {
        summary: { error: 0, warning: 1, review: 1, pass: true },
        issues: []
      }
    }),
    log(message) { logs.push(message); },
    error() { throw new Error('warning-only source gate should not fail'); }
  });

  assert.equal(result.failed, false);
  assert.ok(logs.some(message => message.includes('source gate PASS (errors=0, warnings=1, review=1)')));
});

test('local corpus benchmark forwarding preserves manifest pageRange', async () => {
  await runBenchmark({
    source: 'fixture.pdf',
    canonical: 'canonical',
    pageRange: '21-23',
    sourceMeta: {}
  }, async args => {
    assert.equal(args.pageRange, '21-23');
    return { ok: true };
  });
});
