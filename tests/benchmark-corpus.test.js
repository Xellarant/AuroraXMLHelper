const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { benchmark, compareSupports, summarizeSemanticDiffs } = require('../scripts/benchmark-corpus');
const { generateFromFixtureFile, repoRoot } = require('./fixture-harness');

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function makeTextPdf(lines) {
  const textOps = lines.flatMap((line, index) => (
    index === 0 ? [`(${escapePdfText(line)}) Tj`] : ['0 -16 Td', `(${escapePdfText(line)}) Tj`]
  ));
  const stream = ['BT', '/F1 12 Tf', '72 720 Td', ...textOps, 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  ];
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
