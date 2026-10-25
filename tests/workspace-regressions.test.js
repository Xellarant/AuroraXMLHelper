const assert = require('node:assert/strict');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');

const repairXml = `<elements>
  <element name="Original" type="Class Feature" source="X" id="ID_X_FEATURE">
    <rules><select type="Feat" name="Choose a feat" /><grant type="Spell" /></rules>
  </element>
</elements>`;

function inspect(context, elements, xml = repairXml) {
  elements.repairXmlInput.value = xml;
  context.inspectRepairXml();
  return context.window.AuroraXMLHelper;
}

function suggestion(context, category, value) {
  const diagnostics = context.window.AuroraXMLHelper.repairState.analysis.diagnostics;
  const index = diagnostics.findIndex(finding => finding.category === category);
  context.applyRepairSuggestion(index, 0, value);
}

for (const action of ['bulk', 'suggestion']) {
  test(`${action} repairs keep leading whitespace and use its original source offsets`, () => {
    const { context, elements } = loadApp();
    const xml = '\ufeff \r\n  ' + repairXml;
    const api = inspect(context, elements, xml);
    if (action === 'bulk') {
      const finding = api.repairState.analysis.diagnostics.find(item => item.category === 'select-missing-required-attribute');
      api.applyRepairSelection([finding.repairs[0].id]);
    } else {
      suggestion(context, 'select-missing-required-attribute', 'feat');
    }
    assert.equal(elements.repairXmlInput.value, xml.replace('name="Choose a feat" />', 'name="Choose a feat" supports="feat" />'));
    assert.equal(api.repairState.originalDocs[0].xml, xml);
    assert.equal(api.changedRepairDocs()[0].xml, elements.repairXmlInput.value);
  });
}

test('edits after inspection block stale repairs and survive reinspection', () => {
  const { context, elements } = loadApp();
  const api = inspect(context, elements);
  const ids = api.repairState.analysis.diagnostics.flatMap(finding => finding.repairs).filter(repair => repair.confidence === 'high').map(repair => repair.id);
  const edited = repairXml.replace('Original', 'Manual edit');
  elements.repairXmlInput.value = edited;
  assert.throws(() => api.applyRepairSelection(ids), /changed since inspection/);
  assert.equal(elements.repairXmlInput.value, edited);
  context.inspectRepairXml();
  suggestion(context, 'select-missing-required-attribute', 'feat');
  assert.match(api.changedRepairDocs()[0].xml, /name="Manual edit"/);
});

test('reinspection preserves applied repairs, the original diff, and undo', () => {
  const { context, elements } = loadApp();
  const api = inspect(context, elements);
  suggestion(context, 'select-missing-required-attribute', 'feat');
  const fixed = elements.repairXmlInput.value;
  context.inspectRepairXml();
  assert.equal(api.repairState.docs[0].xml, fixed);
  assert.equal(api.repairState.originalDocs[0].xml, repairXml);
  assert.equal(api.changedRepairDocs().length, 1);
  assert.match(elements.repairPreviewResults.innerHTML, /Download Fixed XML/);
  suggestion(context, 'grant-missing-required-attribute', 'ID_X_SPELL');
  context.undoLastRepair();
  assert.equal(elements.repairXmlInput.value, fixed);
  context.resetRepairedXml();
  assert.equal(elements.repairXmlInput.value, repairXml);
  assert.equal(api.changedRepairDocs().length, 0);
});

test('multiple uploaded documents stay in sync after repair and undo', () => {
  const { context, elements } = loadApp();
  const docs = [{ fileName: 'first.xml', xml: repairXml }, { fileName: 'second.xml', xml: '<elements />' }];
  context.loadRepairDocs(docs);
  context.inspectRepairXml();
  suggestion(context, 'select-missing-required-attribute', 'feat');
  const api = context.window.AuroraXMLHelper;
  assert.match(api.repairState.uploadedDocs[0].xml, /supports="feat"/);
  assert.equal(elements.repairXmlInput.readOnly, true);
  context.inspectRepairXml();
  assert.equal(api.changedRepairDocs().length, 1);
  context.resetRepairedXml();
  assert.equal(api.repairState.uploadedDocs[0].xml, repairXml);
});

test('loading another file invalidates the previous repair session', () => {
  const { context, elements } = loadApp();
  const api = inspect(context, elements);
  context.loadRepairDocs([{ fileName: 'new.xml', xml: '<elements />' }]);
  assert.throws(() => api.applyRepairSelection(['r1']), /Inspect XML/);
  assert.equal(elements.repairXmlInput.value, '<elements />');
});

const authoringXml = `<elements>
  <element name="First" type="Spell" source="X" id="ID_FIRST" />
  <element name="Second" type="Spell" source="X" id="ID_SECOND"><supports>Wizard</supports><rules /></element>
</elements>`;

for (const action of ['rule', 'detail']) {
  test(`authoring ${action} insertion never edits a following element when a self-closing element is selected`, () => {
    const { context, elements } = loadApp();
    elements.authoringTemplateXml.value = authoringXml;
    elements.authoringTemplateXml.selectionStart = authoringXml.indexOf('First');
    elements.authoringRuleType.value = 'ac';
    elements.authoringRuleAmount.value = '1';
    elements.authoringElementProperty.value = 'supports';
    elements.authoringElementPropertyValue.value = 'Bard';
    runInApp(context, "selectedAuthoringTemplateId = 'spell-2021'");
    const insert = action === 'rule' ? context.insertAuthoringRuleSnippet : context.applyAuthoringElementProperty;
    insert();
    assert.equal(elements.authoringTemplateXml.value, authoringXml);
    assert.match(elements.authoringTemplateStatus.textContent, /self-closing/);
    elements.authoringTemplateXml.selectionStart = authoringXml.indexOf('Second');
    insert();
    assert.ok(elements.authoringTemplateXml.value.includes('<element name="First" type="Spell" source="X" id="ID_FIRST" />'));
    assert.match(elements.authoringTemplateXml.value, action === 'rule' ? /<stat name="ac:misc" value="1" \/>/ : /<supports>Bard<\/supports>/);
  });
}
