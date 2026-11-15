const assert = require('node:assert/strict');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');
const { parseAuroraElements, childXmlRanges, attrMap } = require('../src/aurora-xml-patterns');

const element = (name, body = '') => '<element name="' + name + '" type="Class Feature" source="Fixture" id="ID_' + name.toUpperCase() + '">' + body + '</element>';
function editor(xml, cursor = 0) {
  const app = loadApp();
  app.elements.authoringTemplateXml.value = xml;
  app.elements.authoringTemplateXml.selectionStart = cursor;
  return app;
}

test('authoring targets the following adjacent element at its opening boundary and ignores commented examples', () => {
  const first = element('First');
  const second = element('Second', '<description>Actual content</description>');
  const xml = '<elements><!-- ' + element('Comment') + ' -->' + first + second + '</elements>';
  const { context } = editor(xml);
  const target = context.findAuthoringElementTarget(xml, xml.indexOf(second)).target;
  assert.equal(target.xml, second);
  assert.equal(context.AuroraXmlPatterns.elementRanges(xml).length, 2);
});

test('authoring rule insertion leaves comments and CDATA examples intact and edits only the selected element', () => {
  const comment = '<!-- <rules><stat name="example" value="99" /></rules> -->';
  const example = '<description><![CDATA[Example </element><rules/> remains text.]]></description>';
  const first = element('First');
  const second = element('Second', comment + example);
  const xml = '<elements>' + first + second + '</elements>';
  const { context, elements } = editor(xml, xml.indexOf(second));
  elements.authoringRuleType.value = 'ac'; elements.authoringRuleAmount.value = '2';
  context.insertAuthoringRuleSnippet();
  const result = elements.authoringTemplateXml.value;
  assert.ok(result.includes(comment) && result.includes(example));
  const parsed = parseAuroraElements(result);
  assert.equal(parsed[0].ruleRecords.length, 0);
  assert.equal(parsed[1].ruleRecords.length, 1);
  assert.equal(parsed[1].ruleRecords[0].attrs.name, 'ac:misc');
  assert.equal(parsed[1].ruleRecords[0].attrs.value, '2');
});

test('authoring upserts actual direct children rather than nested description examples', () => {
  const description = '<description><supports>Example support</supports></description>';
  const xml = '<elements>' + element('Support', description + '<supports>Old support</supports>') + '</elements>';
  const { context } = editor(xml);
  const target = context.findAuthoringElementTarget(xml, xml.indexOf('Support')).target;
  const result = context.applyAuthoringElementNode(xml, target, 'supports', '<supports>New support</supports>');
  assert.ok(result.xml.includes(description));
  assert.ok(result.xml.includes('</description><supports>New support</supports>'));
  assert.equal(childXmlRanges(result.xml.slice(target.start, result.xml.lastIndexOf('</element>') + 10)).filter(node => node.name === 'supports').length, 1);
});

test('authoring expands a live self-closing setters block and ignores commented setters', () => {
  const comment = '<!-- <setters><set name="range">Example</set></setters> -->';
  const xml = '<elements>' + element('Setters', comment + '<setters note="a > b" />') + '</elements>';
  const { context } = editor(xml);
  const target = context.findAuthoringElementTarget(xml, 0).target;
  const result = context.applyAuthoringSetter(xml, target, 'range', '<set name="range">60 feet</set>');
  assert.ok(result.xml.includes(comment));
  assert.match(result.xml, /<setters note="a > b" >\s*<set name="range">60 feet<\/set>/);
  assert.equal(parseAuroraElements(result.xml)[0].setters.range, '60 feet');
});

test('AC detail synchronization edits only the real stat value, preserving quoted lookalikes and comments', () => {
  const comment = '<!-- <stat name="ac:shield" value="99" /> -->';
  const xml = '<elements>' + element('Shield', '<rules>' + comment + '<stat note=" value=\'77\'" name="ac:shield" value="1" /></rules>') + '</elements>';
  const { context } = editor(xml);
  const target = context.findAuthoringElementTarget(xml, 0).target;
  const result = context.updateAuthoringACRule(xml, target, 'ac:shield', '+2', xml.length);
  assert.equal(result.synced, true);
  assert.ok(result.xml.includes(comment) && result.xml.includes('note=" value=\'77\'"'));
  assert.equal(parseAuroraElements(result.xml)[0].ruleRecords[0].attrs.value, '2');
});

test('sheet actions expand the correct hidden sheet and preserve display-like text in other attributes', () => {
  const comment = '<!-- <sheet display="false" /> -->';
  for (const sheet of ['<sheet note=" display=\'false\'" display="false" />',
    '<sheet note=" display=\'false\'" display="false"><description>Existing action</description></sheet>']) {
    const xml = '<elements>' + element('Action', comment + sheet) + '</elements>';
    const { context, elements } = editor(xml);
    const target = context.findAuthoringElementTarget(xml, 0).target;
    context.insertAuthoringSheetDescription(elements.authoringTemplateXml, target, '<description action="Action">New action</description>');
    const result = elements.authoringTemplateXml.value;
    assert.ok(result.includes(comment) && result.includes('note=" display=\'false\'"'));
    const liveSheet = childXmlRanges(context.findAuthoringElementTarget(result, 0).target.xml).find(node => node.name === 'sheet');
    assert.equal(attrMap(liveSheet.openingTag).display, 'true');
    assert.ok(liveSheet.xml.includes('New action'));
    if (sheet.includes('Existing action')) assert.ok(liveSheet.xml.includes('Existing action'));
  }
});

test('ambiguous XML upload names are rejected before clearing the existing repair workspace', async () => {
  const { context, elements } = loadApp();
  const original = '<elements><info><n>Original</n></info></elements>';
  context.loadRepairDocs([{ fileName: 'original.xml', xml: original }]);
  context.inspectRepairXml();
  const before = runInApp(context, 'JSON.stringify(repairState)');
  await context.handleRepairXmlFileSelect({ target: { files: [
    { name: 'duplicate.xml', text: async () => '<elements />' },
    { name: 'DUPLICATE.xml', text: async () => '<elements />' }
  ] } });
  assert.equal(runInApp(context, 'JSON.stringify(repairState)'), before);
  assert.equal(elements.repairXmlInput.value, original);
  assert.match(elements.repairPreviewStatus.textContent, /unique.*previous workspace is unchanged/);
});

test('unreadable or partly empty XML uploads preserve the repair workspace and give a useful error', async () => {
  const { context, elements } = loadApp();
  context.loadRepairDocs([{ fileName: 'original.xml', xml: '<elements />' }]);
  await context.handleRepairXmlFileSelect({ target: { files: [{ name: 'broken.xml', text: async () => { throw new Error('Read failed'); } }] } });
  assert.equal(elements.repairXmlInput.value, '<elements />');
  assert.match(elements.repairPreviewStatus.textContent, /could not read the XML files.*Select them again.*unchanged/);
  await context.handleRepairXmlFileSelect({ target: { files: [
    { name: 'valid.xml', text: async () => '<elements />' }, { name: 'empty.xml', text: async () => ' ' }
  ] } });
  assert.equal(elements.repairXmlInput.value, '<elements />');
  assert.match(elements.repairPreviewStatus.textContent, /empty.xml.*empty.*unchanged/);
});

test('a slow XML read cannot overwrite a newer selection or repopulate a cleared workspace', async () => {
  const { context, elements } = loadApp();
  let finishOld;
  const old = context.handleRepairXmlFileSelect({ target: { files: [{ name: 'old.xml', text: () => new Promise(resolve => { finishOld = resolve; }) }] } });
  await context.handleRepairXmlFileSelect({ target: { files: [{ name: 'new.xml', text: async () => '<elements><info /></elements>' }] } });
  finishOld('<elements />'); await old;
  assert.equal(elements.repairXmlInput.value, '<elements><info /></elements>');
  let finishPending;
  const pending = context.handleRepairXmlFileSelect({ target: { files: [{ name: 'pending.xml', text: () => new Promise(resolve => { finishPending = resolve; }) }] } });
  context.clearRepairXmlPreview();
  finishPending('<elements />'); await pending;
  assert.equal(elements.repairXmlInput.value, '');
  assert.equal(runInApp(context, 'repairState.uploadedDocs.length'), 0);
});

test('repair inspection reports malformed XML before suggesting edits and retains that error after other files are repaired', () => {
  const { context } = loadApp();
  class DOMParser {
    parseFromString(xml) {
      const error = xml.includes('MALFORMED') ? { textContent: 'Closing element is missing.' } : null;
      return { querySelector() { return error; } };
    }
  }
  context.DOMParser = DOMParser;
  const malformed = '<elements>MALFORMED<element name="Broken" type="Class" source="X" id="ID_BAD">';
  const valid = '<elements><element name="Fine" type="Class Feature" source="X" id="ID_FINE"><rules><grant type="Spell" /></rules></element></elements>';
  context.loadRepairDocs([{ fileName: 'bad.xml', xml: malformed }, { fileName: 'fine.xml', xml: valid }]);
  context.inspectRepairXml();
  const api = context.window.AuroraXMLHelper;
  const parseError = api.repairState.analysis.diagnostics.find(finding => finding.category === 'xml-parse');
  assert.equal(parseError.severity, 'error');
  assert.equal(parseError.fileName, 'bad.xml');
  assert.equal(parseError.repairs.length, 0);
  assert.equal(api.repairState.analysis.catalog.totalElements, 1);
  const repair = api.repairState.analysis.diagnostics.find(finding => finding.category === 'grant-missing-required-attribute').repairs[0];
  // Pattern verification uses the same parser options, so malformed input
  // cannot disappear from the findings when a different file is repaired.
  const after = context.AuroraXmlRepair.applyRepairs(api.repairState.docs, [repair], { values: { [repair.id]: 'ID_SPELL' } });
  const verify = context.AuroraXmlRepair.verifyRepairedXml(api.repairState.docs, after.docs,
    { beforeAnalysis: api.repairState.analysis, analysisOptions: context.repairAnalysisOptions() });
  assert.ok(verify.analysis.diagnostics.some(finding => finding.category === 'xml-parse' && finding.fileName === 'bad.xml'));
});

test('repair inspection recognizes Chromium XHTML parser errors nested below a partial document root', () => {
  const { context, elements } = loadApp();
  class DOMParser {
    parseFromString() {
      const error = { namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: 'Unexpected closing tag. element line 1 and elements.' };
      return { documentElement: { tagName: 'elements' }, querySelector() { return error; }, getElementsByTagNameNS() { return [error]; } };
    }
  }
  context.DOMParser = DOMParser;
  elements.repairXmlInput.value = '<elements><element name="Broken" type="Feat" source="X" id="ID_BROKEN"></elements>';
  context.inspectRepairXml();
  const diagnostics = context.window.AuroraXMLHelper.repairState.analysis.diagnostics;
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].category, 'xml-parse');
  assert.equal(diagnostics[0].repairs.length, 0);
  assert.match(elements.repairPreviewStatus.textContent, /1 error/);
  assert.doesNotMatch(elements.repairPreviewResults.innerHTML, /No issues were found/);
});

test('optional feat category and prerequisite editors can clear existing values while required details remain guarded', () => {
  const xml = '<elements><element name="Gift" type="Feat" source="Fixture" id="ID_GIFT">'
    + '<supports>Epic Boon</supports><prerequisite>Level 19</prerequisite><requirements>[level:19]</requirements></element></elements>';
  const { context, elements } = editor(xml);
  runInApp(context, "selectedAuthoringTemplateId = 'feat-general';");
  for (const property of ['supports', 'prerequisite']) {
    elements.authoringElementProperty.value = property;
    elements.authoringElementPropertyValue.value = '   ';
    context.updateAuthoringElementPropertyPreview();
    assert.equal(elements.applyAuthoringElementPropertyBtn.disabled, false);
    assert.equal(context.getSelectedAuthoringElementPropertySnippet(), '<' + property + ' />');
    context.applyAuthoringElementProperty();
    assert.ok(elements.authoringTemplateXml.value.includes('<' + property + ' />'));
  }
  assert.ok(!elements.authoringTemplateXml.value.includes('Epic Boon'));
  assert.ok(!elements.authoringTemplateXml.value.includes('Level 19'));
  assert.ok(elements.authoringTemplateXml.value.includes('<requirements>[level:19]</requirements>'));
  runInApp(context, "selectedAuthoringTemplateId = 'spell-2021';");
  for (const property of ['supports', 'level', 'range']) {
    elements.authoringElementProperty.value = property;
    context.updateAuthoringElementPropertyPreview();
    assert.equal(elements.applyAuthoringElementPropertyBtn.disabled, true);
    assert.equal(context.getSelectedAuthoringElementPropertySnippet(), '');
  }
});
