#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInApp, createStubElement } = require('./app-vm-harness');
const patterns = require('../src/aurora-xml-patterns');
const repair = require('../src/aurora-xml-repair');

const outputDirectory = path.resolve(__dirname, '../tests/fixtures/aurora-runtime');
const source = 'Aurora XML Helper Runtime Checks';
const { context, elements } = loadApp({ name: source, abbr: 'AXHRT', author: 'Synthetic test fixture', year: '2021' });
const data = {
  feat: [
    { name: 'XML Helper Strength Check', description: 'A synthetic feat for checking the generated ability score rule.', benefits: ['Increase your Strength score by 1, to a maximum of 20.'] },
    { name: 'XML Helper Spell Check', description: 'You learn the XML Helper Beacon cantrip.', benefits: ['The spell creates harmless light for a runtime check.'] }
  ],
  spell: [{ name: 'XML Helper Beacon', level: 0, school: 'Evocation', castingTime: '1 action', range: 'Touch', duration: '1 minute', hasVerbal: true, hasSomatic: true, hasMaterial: false, classes: ['Wizard'], description: 'A touched object sheds a harmless blue light for one minute.' }]
};
runInApp(context, `extractedData = ${JSON.stringify(data)}`);
const docs = context.window.AuroraXMLHelper.buildZipXmlDocuments(context.window.AuroraXMLHelper.getSourceMeta());
const featDocument = docs.find(doc => /type="Feat"/.test(doc.xml));
elements.authoringTemplateXml.value = featDocument.xml;
elements.authoringTemplateXml.selectionStart = featDocument.xml.indexOf('name="XML Helper Spell Check"');
elements.authoringRuleType.value = 'spell-grant';
const spellFields = {
  authoringRuleSpellId: createStubElement('ID_AXHRT_SPELL_XML_HELPER_BEACON'),
  authoringRuleSpellcasting: createStubElement('Eldritch Knight'),
  authoringRulePrepared: createStubElement('false')
};
const getElementById = context.document.getElementById;
context.document.getElementById = id => spellFields[id] || getElementById(id);
context.insertAuthoringRuleSnippet();
featDocument.xml = elements.authoringTemplateXml.value;
if (!/<stat name="strength" value="1" \/>/.test(featDocument.xml) || /requirements="strength:max/.test(featDocument.xml)) {
  throw new Error('The generated Strength feat does not use the compatible first-party stat shape.');
}

const brokenXml = `<elements>
  <info><n>XML Helper repaired fixture</n><update version="0.1.0"><file name="repaired.xml" url="repaired.xml" /></update></info>
  <element name="XML Helper Repair Check" type="Feat" source="${source}" id="ID_AXHRT_FEAT_REPAIR_CHECK">
    <description><p>You have resistance to fire damage.</p></description>
    <sheet><description>You have resistance to fire damage.</description></sheet>
    <rules><grant type="Condition Immunity" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" /></rules>
  </element>
</elements>`;
const brokenDocs = [{ fileName: 'repaired.xml', xml: brokenXml }];
const analysis = patterns.analyzeAuroraXmlDocuments(brokenDocs);
const result = repair.applyRepairs(brokenDocs, analysis.diagnostics.flatMap(finding => finding.repairs).filter(item => item.confidence === 'high'));
const verification = repair.verifyRepairedXml(brokenDocs, result.docs, { beforeAnalysis: analysis });
if (result.skipped.length || verification.introduced.length || verification.remaining.length) {
  throw new Error('The synthetic repair fixture did not repair cleanly.');
}
docs.push(result.docs[0]);
fs.mkdirSync(outputDirectory, { recursive: true });
for (const doc of docs) fs.writeFileSync(path.join(outputDirectory, doc.fileName), doc.xml + '\n', 'utf8');
fs.writeFileSync(path.join(outputDirectory, 'repair-input.txt'), brokenXml + '\n', 'utf8');
console.log(JSON.stringify({ outputDirectory, files: docs.map(doc => doc.fileName), resolvedRepairs: verification.resolved.map(finding => finding.category), strengthRulePresent: /<stat name="strength" value="1"/.test(featDocument.xml) }, null, 2));
