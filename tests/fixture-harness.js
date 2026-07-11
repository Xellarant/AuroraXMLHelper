const fs = require('node:fs');
const path = require('node:path');
const {
  ELEMENT_TYPES,
  PARSERS,
  repoRoot,
  loadApp,
  runInApp
} = require('../scripts/app-vm-harness');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveFixturePath(fixtureFile, relativePath) {
  return path.resolve(path.dirname(fixtureFile), relativePath);
}

function generateFromFixtureFile(fixtureFile) {
  const fixture = readJson(fixtureFile);
  return generateFromFixture(fixture, fixtureFile);
}

function generateFromFixture(fixture, fixtureFile = '') {
  const sourceFile = fixtureFile
    ? resolveFixturePath(fixtureFile, fixture.source)
    : path.resolve(repoRoot, fixture.source);
  const sourceText = fs.readFileSync(sourceFile, 'utf8');
  const sourceMeta = fixture.sourceMeta || {};
  const { context, elements } = loadApp(sourceMeta);
  runInApp(context, `detectSourceMetaFromText([{ page: 1, text: ${JSON.stringify(sourceText)} }]);`);
  if (sourceMeta.name) elements.sourceName.value = sourceMeta.name;
  if (sourceMeta.abbr) elements.sourceAbbr.value = sourceMeta.abbr;
  if (sourceMeta.author) elements.sourceAuthor.value = sourceMeta.author;
  if (sourceMeta.year) elements.sourceYear.value = String(sourceMeta.year);

  const types = fixture.types || ELEMENT_TYPES;
  const data = {};
  for (const type of ELEMENT_TYPES) data[type] = [];
  data.other = [];
  for (const type of types) {
    const parserName = PARSERS[type];
    if (!parserName) throw new Error(`Unsupported fixture type: ${type}`);
    const parsed = context[parserName](sourceText);
    data[type] = type === 'feat' ? parsed.map(feat => context.parseFeatFullText(feat)) : parsed;
  }
  runInApp(context, `extractedData = ${JSON.stringify(data)};`);
  const xml = runInApp(context, 'generateXml()');
  const meta = JSON.parse(runInApp(context, 'JSON.stringify(getSourceMeta())'));
  return { fixture, sourceFile, sourceText, data, xml, meta };
}

module.exports = {
  ELEMENT_TYPES,
  repoRoot,
  generateFromFixtureFile,
  generateFromFixture
};
