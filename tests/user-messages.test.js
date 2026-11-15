const assert = require('node:assert/strict');
const messages = require('../src/user-messages');
const { xmlSyntaxMessage } = require('../src/aurora-xml-shape');
const { analyzeAuroraXmlDocuments } = require('../src/aurora-xml-patterns');
const { parsePageRange, selectPageNumbers } = require('../src/pdf-page-range');
const { loadApp, runInApp } = require('../scripts/app-vm-harness');

test('PDF failures explain how to recover without exposing raw library messages', () => {
  const password = messages.message({ name: 'PasswordException', message: 'code=1; worker:42' }, 'pdf');
  assert.match(password, /password-protected.*PDF reader.*try Parse PDF/);
  assert.doesNotMatch(password, /worker|code=/);
  assert.match(messages.message({ name: 'MissingPDFException' }, 'pdf'), /Select the file again/);
  assert.match(messages.message({ name: 'AbortError' }, 'pdf'), /interrupted.*try Parse PDF/);
  const corrupt = messages.message(new Error('InvalidPDFException: xref:17, secret source excerpt'), 'pdf');
  assert.match(corrupt, /PDF could not be read.*save a new copy/);
  assert.doesNotMatch(corrupt, /xref|secret|Exception/);
});

test('clipboard errors always offer manual copying or downloading, including the legacy fallback', () => {
  for (const error of [new Error('NotAllowedError: document is not focused'), messages.error('Clipboard access is unavailable.'), null]) {
    const text = messages.message(error, 'clipboard');
    assert.match(text, /copy.*manually.*download/);
    assert.doesNotMatch(text, /NotAllowed|document is not focused|unavailable/);
  }
});

test('page range errors retain their actionable help through the extraction error boundary', () => {
  let error;
  try { parsePageRange('5-2'); } catch (caught) { error = caught; }
  const text = messages.message(error, 'pdf');
  assert.match(text, /5-2.*2-5, 8.*smaller page first/);
  assert.throws(() => selectPageNumbers(8, [{ start: 20, end: 22 }]), /Choose pages between 1 and 8.*including covers/);
});

test('unrecognized errors and non-error values get operation-specific recovery steps', () => {
  for (const [operation, action] of [
    ['xml-read', /Select them again/], ['xml-inspect', /Inspect XML again/],
    ['xml-repair', /review the selected repairs/], ['zip', /Single XML/],
    ['draft-save', /Export draft/], ['draft-import', /another backup/],
    ['draft-export', /download your XML files separately/], ['draft-clear', /Clear saved draft again/]
  ]) {
    const text = messages.message({ message: 'TypeError: internal implementation' }, operation);
    assert.match(text, action);
    assert.doesNotMatch(text, /TypeError|implementation|undefined|\[object Object\]/);
  }
  assert.match(messages.message(undefined), /Export a draft.*refresh/);
});

test('XML syntax help extracts Chrome and Firefox locations without echoing parser markup or source text', () => {
  const chrome = xmlSyntaxMessage('This page contains the following errors:error on line 4 at column 18: Opening and ending tag mismatch: element line 2 and elements Below is a rendering <secret>source</secret>');
  assert.match(chrome, /line 4, column 18.*Match each closing tag/);
  assert.doesNotMatch(chrome, /Below|rendering|secret|mismatch:/);
  const firefox = xmlSyntaxMessage('XML Parsing Error: no element found\nLocation: https://private.example/\nLine Number 7, Column 3:');
  assert.match(firefox, /line 7, column 3.*missing closing tags/);
  assert.doesNotMatch(firefox, /private\.example/);
  assert.match(xmlSyntaxMessage('EntityRef: expecting semicolon'), /&amp;/);
  assert.match(xmlSyntaxMessage('AttValue: quote expected'), /matching quotes/);
});

test('repair findings use the same syntax guidance while preserving machine-readable categories', () => {
  class DOMParser {
    parseFromString() {
      const node = { namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: 'error on line 1 at column 3: Unexpected closing tag: elements != element' };
      return { documentElement: node, getElementsByTagNameNS() { return [node]; } };
    }
  }
  const { diagnostics } = analyzeAuroraXmlDocuments([{ fileName: 'broken.xml', xml: '<bad>' }], { DOMParser });
  assert.equal(diagnostics[0].category, 'xml-parse');
  assert.match(diagnostics[0].message, /syntax error near line 1, column 3.*Match each closing tag/);
  assert.match(diagnostics[0].suggestion, /Inspect XML.*No automatic repairs/);
  assert.equal(diagnostics[0].repairs.length, 0);
});

test('clipboard failure in either workspace offers recovery and leaves the XML intact', async () => {
  const { context, elements } = loadApp();
  context.navigator = { clipboard: { writeText: async () => { throw new Error('NotAllowedError: Focus denied'); } } };
  elements.authoringTemplateXml.value = '<elements><!-- keep me --></elements>';
  await context.copyAuthoringTemplateXml();
  assert.match(elements.authoringTemplateStatus.textContent, /copy.*manually.*download/);
  assert.equal(elements.authoringTemplateXml.value, '<elements><!-- keep me --></elements>');
  runInApp(context, 'repairState.originalDocs = [{fileName:"a.xml",xml:"<elements />"}]; repairState.docs = [{fileName:"a.xml",xml:"<elements><!-- repaired --></elements>"}];');
  await context.copyRepairedXml();
  assert.match(elements.repairPreviewStatus.textContent, /copy.*manually.*download/);
  assert.doesNotMatch(elements.repairPreviewStatus.textContent, /NotAllowed|Focus denied/);
});

test('failed authoring and repaired-file downloads show recovery steps and retain the documents', async () => {
  const { context, elements } = loadApp();
  elements.authoringTemplateXml.value = '<elements><!-- keep me --></elements>';
  context.downloadBlobFile = () => { throw new Error('Blob or download exception'); };
  assert.equal(context.downloadAuthoringTemplateXml(), false);
  assert.match(elements.authoringTemplateStatus.textContent, /Copy the XML text instead/);
  assert.equal(elements.authoringTemplateXml.value, '<elements><!-- keep me --></elements>');
  runInApp(context, 'repairState.originalDocs = [{fileName:"a.xml",xml:"<elements />"}]; repairState.docs = [{fileName:"a.xml",xml:"<elements><!-- repaired --></elements>"}];');
  const before = runInApp(context, 'JSON.stringify(repairState.docs)');
  assert.equal(await context.downloadRepairedXml(), false);
  assert.match(elements.repairPreviewStatus.textContent, /Try Download Fixed XML again.*Export a draft/);
  assert.equal(runInApp(context, 'JSON.stringify(repairState.docs)'), before);
});

test('a failed repaired ZIP reports the failure instead of rejecting its click handler', async () => {
  const { context, elements } = loadApp();
  runInApp(context, 'repairState.originalDocs = [{fileName:"a.xml",xml:"<elements />"},{fileName:"b.xml",xml:"<elements />"}]; repairState.docs = repairState.originalDocs.map(doc=>({...doc,xml:"<elements><!-- repaired --></elements>"}));');
  context.JSZip = class { file() {} async generateAsync() { throw new Error('compression stack'); } };
  assert.equal(await context.downloadRepairedXml(), false);
  assert.match(elements.repairPreviewStatus.textContent, /Export a draft.*before refreshing/);
  assert.doesNotMatch(elements.repairPreviewStatus.textContent, /compression stack/);
});

test('single XML download failure keeps edits pending and tells the user how to save the XML', () => {
  const { context, elements } = loadApp();
  runInApp(context, 'extractedData = {feat:[{name:"Copper Gift",description:"A synthetic benefit.",benefits:["A synthetic benefit."]}]}; ensureExtractedDataBuckets(); markChanged();');
  context.validateAll = () => [];
  context.downloadBlobFile = () => { throw new Error('download stack'); };
  assert.equal(context.generateAndDownload(), false);
  assert.match(elements.manualAuthorStatus.textContent, /Copy the XML text instead.*export a draft/);
  assert.equal(runInApp(context, 'hasUnsavedChanges'), true);
});
