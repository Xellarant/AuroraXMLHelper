#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInApp } = require('./app-vm-harness');
const { classChoiceSource } = require('../tests/fixtures/class-choice-source');

function classRuntimeSource() {
  const slots = level => [
    level === 1 ? 2 : level === 2 ? 3 : 4,
    level < 3 ? 0 : level === 3 ? 2 : 3,
    level < 5 ? 0 : level === 5 ? 2 : 3,
    level < 7 ? 0 : level === 7 ? 1 : level === 8 ? 2 : 3,
    level < 9 ? 0 : level === 9 ? 1 : level < 18 ? 2 : 3,
    level < 11 ? 0 : level < 19 ? 1 : 2,
    level < 13 ? 0 : level < 20 ? 1 : 2,
    level < 15 ? 0 : 1,
    level < 17 ? 0 : 1
  ];
  return classChoiceSource().split('\n').filter(line => !/^\|/.test(line)).flatMap(line => line === 'The Mistkeeper' ? [
    line, '| Level | Proficiency Bonus | Features | Hexes Known | Cantrips | Spells Known | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th | 9th |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Array.from({ length: 20 }, (_, i) => {
      const level = i + 1;
      const features = [...(level === 1 ? ['Spellcasting', 'Mist Curse', 'Hexes'] : []),
        ...(level === 2 ? ['Familiar'] : []), ...([4, 8, 12, 16, 19].includes(level) ? ['Ability Score Improvement'] : []),
        ...([11, 13, 15, 18].includes(level) ? ['Grand Hex'] : [])].join(', ') || '—';
      return '| ' + [level, '+' + (2 + Math.floor((level - 1) / 4)), features, level < 5 ? 2 : 3,
        level < 4 ? 2 : 4, level < 5 ? 2 : 4, ...slots(level).map(value => value || '—')].join(' | ') + ' |';
    })
  ] : [line]).join('\n');
}

function buildClassRuntimeFixtures() {
  const { context } = loadApp({ name: 'XML Helper Class Acceptance', abbr: 'AXHCLASS', year: '2016' });
  const source = classRuntimeSource();
  const cls = context.parseClassesFromText(source)[0];
  const spells = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2].map((level, index) => ({
    name: 'Copper Signal ' + (index + 1), level, school: 'Evocation', castingTime: '1 action', range: '30 feet',
    duration: '1 minute', hasVerbal: true, hasSomatic: true, hasMaterial: false, classes: ['Mistkeeper'],
    description: 'A harmless signal of copper light appears. Original synthetic acceptance content.'
  }));
  runInApp(context, 'extractedData = ' + JSON.stringify({ class: [cls], spell: spells }) + '; ensureExtractedDataBuckets();');
  return { source, cls, docs: context.buildZipXmlDocuments(context.getSourceMeta()) };
}

if (require.main === module) {
  const directory = path.resolve(__dirname, '../tests/fixtures/aurora-runtime/class-progression');
  const { source, docs } = buildClassRuntimeFixtures();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'source.txt'), source + '\n');
  for (const doc of docs) fs.writeFileSync(path.join(directory, doc.fileName), doc.xml + '\n');
  console.log(JSON.stringify({ directory, files: docs.map(doc => doc.fileName) }));
}
module.exports = { classRuntimeSource, buildClassRuntimeFixtures };
