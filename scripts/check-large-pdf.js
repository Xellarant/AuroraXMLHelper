#!/usr/bin/env node
// Opt-in acceptance check. Reports counts and timings, never source excerpts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readSource, loadApp, generateBenchmarkXml } = require('./benchmark-corpus');
const { runAuroraShapeValidator } = require('./aurora-shape-validator');

async function checkLargePdf(file) {
  const started = Date.now();
  const bytes = fs.statSync(file).size;
  const source = await readSource(file, '', { spellAvailability: true });
  const readMs = Date.now() - started;
  const { context } = loadApp({ name: 'Large PDF Acceptance', abbr: 'LPA', year: '2015' });
  const result = generateBenchmarkXml(context, source.text, ['spell'], source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-large-pdf-'));
  try {
    fs.writeFileSync(path.join(directory, 'spells.xml'), result.xml);
    const validation = runAuroraShapeValidator({ rootPath: directory });
    assert.equal(validation.ok, true, validation.stderr || validation.stdout);
    return { file: path.basename(file), bytes, pages: source.totalPageCount, readMs,
      totalMs: Date.now() - started, spells: result.data.spell.length,
      shapeValid: true, peakMemoryMiB: Math.round(process.resourceUsage().maxRSS / 1024) };
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Choose a local PDF: node scripts/check-large-pdf.js <file.pdf>'); process.exitCode = 1; }
  else checkLargePdf(path.resolve(file)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { checkLargePdf };
