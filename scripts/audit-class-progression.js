#!/usr/bin/env node
// Opt-in checks against the user's private library. No source excerpts are written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSource, loadApp, generateBenchmarkXml, runInApp } = require('./benchmark-corpus');
const { events, findings } = require('../src/class-progression');
const { runAuroraShapeValidator } = require('./aurora-shape-validator');

const cases = [
  { file: 'UA_RevisedRanger.pdf', range: '2-5', year: '2016', name: 'Ranger', rows: 20, features: 13,
    options: { 'Favored Enemy': 5, 'Fighting Style': 4, 'Greater Favored Enemy': 7 },
    schedules: { 'Ability Score Improvement': [[4, 1], [8, 1], [12, 1], [16, 1], [19, 1]] } },
  { file: 'Complete Witch.pdf', range: '4-8', year: '2016', name: 'Witch', rows: 20, features: 11,
    options: { "Witch's Curse": 11, Hexes: 26, 'Grand Hex': 10 },
    schedules: { Hexes: [[1, 2], [2, 1], [5, 1], [9, 1], [13, 1], [17, 1]], 'Grand Hex': [[11, 1], [13, 1], [15, 1], [18, 1]] } },
  { file: 'Eberron_Forge_of_the_Artificer_OCR.pdf', range: '10-19', year: '2025', name: 'Artificer', rows: 0, features: 13,
    options: { 'Replicate Magic Item': 56 }, incomplete: true },
  { file: 'Eberron_ Forge of the Artificer.md', year: '2025', name: 'Artificer', rows: 20, features: 13,
    options: { 'Replicate Magic Item': 56 },
    schedules: { 'Replicate Magic Item': [[2, 4], [6, 1], [10, 1], [14, 1], [18, 1]], 'Ability Score Improvement': [[4, 1], [8, 1], [12, 1], [16, 1]] } }
];

async function auditClassProgression(root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-class-audit-'));
  const results = [];
  let damagedClass;
  try {
    for (const entry of cases) {
      const source = await readSource(path.join(root, entry.file), entry.range || '', { classChoices: true });
      const { context } = loadApp({ name: 'Private Class Audit', abbr: 'PCA', year: entry.year });
      const generated = generateBenchmarkXml(context, source.text, ['class'], source);
      assert.equal(generated.data.class.length, 1, entry.file);
      const cls = generated.data.class[0];
      assert.equal(cls.name, entry.name);
      assert.equal(cls.progression.length, entry.rows, entry.file + ': progression');
      assert.equal(cls.features.length, entry.features, entry.file + ': features');
      for (const [name, expected] of Object.entries(entry.options)) {
        assert.equal(cls.choices.find(choice => choice.name === name)?.options.length, expected, entry.file + ': ' + name);
      }
      for (const [name, expected] of Object.entries(entry.schedules || {})) {
        const actual = cls.choices.find(choice => choice.name === name);
        assert.deepEqual(JSON.parse(JSON.stringify(events(cls, actual).map(event => [event.level, event.count]))), expected, entry.file + ': ' + name);
      }
      const review = findings(cls);
      if (entry.incomplete) {
        damagedClass = JSON.parse(JSON.stringify(cls));
        assert.ok(review.some(issue => /No progression table/.test(issue.msg)));
        assert.ok(cls.choices[0].options.some(option => option.unresolvedPrerequisite));
        assert.ok(!context.classChoiceRules(cls, cls.features.find(feature => feature.name === 'Replicate Magic Item'), generated.meta).length);
      }
      if (entry.name === 'Witch') {
        assert.equal(cls.choices.find(choice => choice.name === 'Hexes').options.find(option => option.name === 'Beckon Familiar').requiredFeature, 'Familiar');
        assert.ok(generated.xml.includes('ID_PHB_SPELL_PRODUCE_FLAME'));
        assert.ok(generated.xml.includes('ID_PHB_SPELL_FIND_FAMILIAR'));
        const missing = context.validateAll({ includeXml: false }).filter(issue => issue.action === 'add-feature');
        assert.ok(missing.some(issue => issue.featureName === 'Ability Score Improvement'));
      }
      const xmlDirectory = path.join(directory, String(results.length));
      fs.mkdirSync(xmlDirectory);
      fs.writeFileSync(path.join(xmlDirectory, 'class.xml'), generated.xml);
      const validation = runAuroraShapeValidator({ rootPath: xmlDirectory });
      assert.equal(validation.ok, true, validation.stderr || validation.stdout);
      results.push({ file: entry.file, selectedPages: source.pageRange || 'all', class: cls.name, levels: cls.progression.length,
        features: cls.features.length, choices: cls.choices.map(choice => ({ name: choice.name, options: choice.options.length,
          withheldOptions: choice.options.filter(option => option.unresolvedPrerequisite).length,
          schedule: events(cls, choice) })), shapeValid: true, findings: review.length });
      if (entry.file.endsWith('.md')) {
        // Exercise the same user-facing repair handlers using the readable companion source.
        damagedClass.progressionDraft = context.classProgressionText(cls);
        damagedClass.choices[0].catalogueDraft = source.text;
        runInApp(context, 'extractedData.class = ' + JSON.stringify([damagedClass]) + ';');
        assert.equal(context.applyClassProgression('class-0'), true);
        assert.equal(context.importClassChoiceOptions('class-0', 0), true);
        const repaired = runInApp(context, 'extractedData.class[0]');
        assert.equal(repaired.progression.length, 20);
        assert.equal(repaired.choices[0].options.length, 56);
        assert.equal(repaired.choices[0].options.filter(option => option.unresolvedPrerequisite).length, 0);
        assert.deepEqual(JSON.parse(JSON.stringify(events(repaired, repaired.choices[0]).map(event => [event.level, event.count]))),
          [[2, 4], [6, 1], [10, 1], [14, 1], [18, 1]]);
        assert.ok(repaired.choices[0].options.every(option => option._source.kind === 'pasted'));
        const repairedDirectory = path.join(directory, 'repaired');
        fs.mkdirSync(repairedDirectory);
        fs.writeFileSync(path.join(repairedDirectory, 'class.xml'), runInApp(context, 'generateXml()'));
        assert.equal(runAuroraShapeValidator({ rootPath: repairedDirectory }).ok, true);
        results.push({ file: 'Artificer PDF with companion-source corrections', levels: 20, plans: 56, withheldOptions: 0, shapeValid: true });
      }
    }
    return results;
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const root = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Documents', 'DnD', 'books and docs');
  auditClassProgression(root).then(results => console.log(JSON.stringify(results, null, 2))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
module.exports = { auditClassProgression };
