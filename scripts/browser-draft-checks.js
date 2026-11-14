const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function checkDraftRecovery(browser, url, reportDirectory) {
  const context = await browser.newContext({ acceptDownloads: true });
  let page;
  try {
    page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    const errors = [];
    context.on('weberror', error => errors.push(error.error().message));
    const open = async target => {
      await target.goto(url, { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => Boolean(window.AuroraDraftRecovery));
    };
    const saved = async target => {
      await target.waitForFunction(() => document.querySelector('#draftStatus').textContent.includes('Draft saved'));
    };
    const checks = [];
    await open(page);
    await page.locator('#sourceName').fill('Draft Recovery Fixture');
    await page.locator('#sourceAbbr').fill('DRF');
    await page.locator('#sourceYear').fill('2024');
    await page.locator('button[onclick="startManualAuthoring()"]').click();
    await page.locator('#manualAddType').selectOption('feat');
    await page.locator('button[onclick="addManualElement()"]').click();
    await page.locator('[data-id="feat-0"][data-field="name"]').fill('Recovered Feat');
    await page.locator('[data-id="feat-0"][data-field="description"]').fill('Text typed immediately before refreshing, without leaving the field.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('[data-id="feat-0"][data-field="name"]').inputValue(), 'Recovered Feat');
    assert.match(await page.locator('[data-id="feat-0"][data-field="description"]').inputValue(), /without leaving the field/);
    assert.equal(await page.locator('#sourceYear').inputValue(), '2024');
    await page.locator('#sourceName').fill('Renamed Recovery Fixture');
    assert.equal(await page.locator('#sourceAbbr').inputValue(), 'DRF', 'The custom abbreviation must stay custom after recovery.');
    assert.equal(await page.locator('#pdfFile').inputValue(), '');
    checks.push('Review edits, source metadata, and the last unblurred field survive refresh');

    await page.locator('[data-workspace-tab="author"]').click();
    const authoredXml = (await page.locator('#authoringTemplateXml').inputValue()) + '\n<!-- Recovered author XML -->';
    await page.locator('#authoringTemplateXml').fill(authoredXml);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#authoringTemplateXml').inputValue(), authoredXml);
    assert.equal(await page.locator('[data-workspace-tab="author"]').getAttribute('aria-selected'), 'true');
    checks.push('Authored XML and the active workspace survive refresh');

    await page.locator('[data-workspace-tab="repair"]').click();
    const originalXml = fs.readFileSync(path.join(__dirname, '../tests/fixtures/aurora-runtime/repair-input.txt'));
    await page.locator('#repairXmlFile').setInputFiles([
      { name: 'first.xml', mimeType: 'application/xml', buffer: originalXml },
      { name: 'second.xml', mimeType: 'application/xml', buffer: Buffer.from('<elements><info><name>Second fixture</name><update version="1"><file name="second.xml" url="second.xml" /></update></info></elements>') }
    ]);
    await page.locator('button[onclick="inspectRepairXml()"]').click();
    await page.locator('button[onclick="applySelectedRepairs()"]').click();
    const repaired = await page.evaluate(() => window.AuroraXMLHelper.repairState.docs.map(doc => ({ ...doc })));
    assert.match(repaired[0].xml, /grant type="Condition"/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.deepEqual(await page.evaluate(() => window.AuroraXMLHelper.repairState.docs), repaired);
    assert.equal(await page.locator('#repairXmlInput').getAttribute('readonly'), '');
    assert.equal(await page.locator('#undoRepairBtn').isEnabled(), true);
    assert.equal(await page.locator('button[onclick="downloadRepairedXml()"]').isVisible(), true);
    const fixedDownloadPromise = page.waitForEvent('download');
    await page.locator('button[onclick="downloadRepairedXml()"]').click();
    const fixedDownload = await fixedDownloadPromise;
    assert.match(fs.readFileSync(await fixedDownload.path(), 'utf8'), /grant type="Condition"/);
    await page.locator('#undoRepairBtn').click();
    assert.equal(await page.evaluate(() => window.AuroraXMLHelper.repairState.docs[0].xml), originalXml.toString());
    checks.push('Multi-file repairs recover their originals, download controls, and undo');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#draftExport').click();
    const download = await downloadPromise;
    const backup = fs.readFileSync(await download.path());
    assert.equal(JSON.parse(backup).state.data.feat[0].name, 'Recovered Feat');
    await page.locator('#draftClear').click();
    assert.equal(await page.evaluate(() => localStorage.getItem(window.AuroraDraftStorage.KEY)), null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#sourceName').inputValue(), '');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#draftImportButton').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await saved(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#authoringTemplateXml').inputValue(), authoredXml);
    assert.equal(await page.evaluate(() => window.AuroraXMLHelper.captureWorkspaceDraft().data.feat[0].name), 'Recovered Feat');
    checks.push('Export, clear, import, and reopen preserve the full workspace');

    const second = await context.newPage();
    second.on('dialog', dialog => dialog.accept());
    await open(second);
    await page.locator('[data-workspace-tab="author"]').click();
    await page.locator('#authoringTemplateXml').fill(authoredXml + '\n<!-- First tab -->');
    await saved(page);
    await second.waitForFunction(() => document.querySelector('#draftStatus').textContent.includes('Another tab'));
    await second.locator('[data-workspace-tab="author"]').click();
    await second.locator('#authoringTemplateXml').fill(authoredXml + '\n<!-- Second tab -->');
    await second.evaluate(() => window.AuroraDraftRecovery.flush());
    assert.match(await second.evaluate(() => localStorage.getItem(window.AuroraDraftStorage.KEY)), /First tab/);
    await second.locator('#draftRetry').click();
    await saved(second);
    assert.match(await second.evaluate(() => localStorage.getItem(window.AuroraDraftStorage.KEY)), /Second tab/);
    checks.push('A stale tab cannot silently overwrite a newer saved draft');
    await second.close();

    await page.evaluate(() => localStorage.setItem(window.AuroraDraftStorage.KEY, '{broken draft'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.match(await page.locator('#draftStatus').textContent(), /could not be read/);
    await page.locator('#sourceName').fill('Keep corrupt backup intact');
    await page.evaluate(() => window.AuroraDraftRecovery.flush());
    assert.equal(await page.evaluate(() => localStorage.getItem(window.AuroraDraftStorage.KEY)), '{broken draft');
    await page.locator('#draftRetry').click();
    await saved(page);
    await page.locator('button[onclick="startManualAuthoring()"]').click();
    await page.locator('details.manual-paste summary').click();
    await page.locator('#manualSourceText').fill('Discard this pasted section when starting over');
    await page.locator('button[onclick="resetAll()"]').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#manualSourceText').inputValue(), '');
    assert.equal(await page.locator('#sourceName').inputValue(), '');
    checks.push('Unreadable drafts are preserved until an explicit choice; Start Over stays cleared');
    assert.deepEqual(errors, [], 'Draft recovery must not produce browser errors.');
    return checks;
  } catch (error) {
    if (reportDirectory && page) await page.screenshot({ path: path.join(reportDirectory, 'draft-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function checkPdfExport(browser, url, reportDirectory) {
  const context = await browser.newContext({ acceptDownloads: true });
  let page;
  try {
    page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const pdf = await page.evaluate(async () => {
      const doc = await window.PDFLib.PDFDocument.create();
      const sheet = doc.addPage([600, 800]);
      const font = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
      const lines = [
        'Clockwork Beacon', '2nd-level evocation', 'Casting Time: 1 action',
        'Range: 30 feet', 'Components: V, S', 'Duration: 1 minute',
        'You create a harmless blue light in a space within range.',
        'The light illuminates a small area until the spell ends.'
      ];
      lines.forEach((text, i) => sheet.drawText(text, { x: 40, y: 740 - i * 22, size: 12, font }));
      return Array.from(await doc.save());
    });
    await page.locator('#pdfFile').setInputFiles({ name: 'Release Fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    for (const type of ['archetype', 'item', 'feat', 'magic', 'race', 'background', 'class']) await page.locator(`#chk-${type} input`).uncheck();
    await page.locator('#extractBtn').click();
    const name = page.locator('[data-id="spell-0"][data-field="name"]');
    await name.waitFor({ state: 'attached' });
    assert.equal(await name.inputValue(), 'Clockwork Beacon');
    assert.match(await page.locator('#reviewSourceScope').textContent(), /Release Fixture\.pdf.*Selected PDF pages: 1/);
    assert.match(await page.locator('#body-spell-0 .source-reference').textContent(), /PDF page 1/);
    const unresolved = page.locator('#reviewIssuesList li').filter({ hasText: 'no spell lists assigned' });
    await unresolved.getByRole('button', { name: 'Go to field' }).click();
    const classes = page.locator('[data-id="spell-0"][data-field="classes"]');
    assert.ok(await classes.evaluate(element => document.activeElement === element));
    await classes.fill('Wizard');
    await unresolved.waitFor({ state: 'detached' });
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem(window.AuroraDraftStorage.KEY) || 'null');
      return saved?.state.data.spell?.[0]?.classes.includes('Wizard') && saved.state.data.spell[0]._source?.page === 1;
    });
    await page.reload();
    await name.waitFor({ state: 'attached' });
    assert.match(await page.locator('#body-spell-0 .source-reference').textContent(), /PDF page 1/);
    assert.equal(await classes.inputValue(), 'Wizard');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button[onclick="downloadZip()"]').click();
    const download = await downloadPromise;
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    assert.ok(Object.keys(zip.files).some(file => file.endsWith('/source.xml')), 'ZIP must contain source.xml inside its source folder.');
    const spellFile = Object.keys(zip.files).find(file => file.endsWith('-spells.xml'));
    assert.ok(spellFile, 'ZIP must contain the parsed spell XML.');
    const xml = await zip.file(spellFile).async('string');
    assert.match(xml, /name="Clockwork Beacon" type="Spell"/);
    assert.match(xml, /<set name="level">2<\/set>/);
    return 'Upload a synthetic PDF, review its source, resolve a linked warning, recover those edits, and export the spell/source XML';
  } catch (error) {
    if (reportDirectory && page) await page.screenshot({ path: path.join(reportDirectory, 'export-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

module.exports = { checkDraftRecovery, checkPdfExport };
