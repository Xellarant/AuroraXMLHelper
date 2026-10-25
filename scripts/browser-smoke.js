#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const requestedPort = Number(process.env.PORT || 0);
const startupTimeoutMs = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 10000);
const navigationTimeoutMs = Number(process.env.SMOKE_NAVIGATION_TIMEOUT_MS || 15000);

function findOpenPort() {
  if (requestedPort) return Promise.resolve(requestedPort);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error('Could not allocate a local smoke-test port.'));
        else resolve(port);
      });
    });
  });
}

function waitForServer(url) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      const request = http.get(url, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.once('error', retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - started > startupTimeoutMs) {
        reject(new Error(`Static server did not become ready within ${startupTimeoutMs}ms.`));
        return;
      }
      setTimeout(probe, 150);
    }

    probe();
  });
}

function startStaticServer(port) {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'serve-static.js'), String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  return child;
}

function stopStaticServer(child) {
  if (!child || child.killed) return;
  child.kill();
}

function browserLaunchCandidates() {
  if (process.env.AURORA_CHROME_PATH) {
    return [{
      name: `configured executable (${process.env.AURORA_CHROME_PATH})`,
      options: { headless: true, executablePath: process.env.AURORA_CHROME_PATH }
    }];
  }

  if (process.env.AURORA_BROWSER_CHANNEL) {
    return [{
      name: `configured channel (${process.env.AURORA_BROWSER_CHANNEL})`,
      options: { headless: true, channel: process.env.AURORA_BROWSER_CHANNEL }
    }];
  }

  const candidates = [{
    name: 'Playwright Chromium headless shell',
    options: { headless: true }
  }];

  const executableCandidates = [
    ['Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    ['Google Chrome (x86)', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
    ['Microsoft Edge', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
    ['Microsoft Edge (x86)', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  ];
  for (const [name, executablePath] of executableCandidates) {
    if (fs.existsSync(executablePath)) {
      candidates.push({ name, options: { headless: true, executablePath } });
    }
  }

  candidates.push({ name: 'Google Chrome channel', options: { headless: true, channel: 'chrome' } });
  candidates.push({ name: 'Microsoft Edge channel', options: { headless: true, channel: 'msedge' } });
  return candidates;
}

async function launchBrowser() {
  const failures = [];
  for (const candidate of browserLaunchCandidates()) {
    try {
      const browser = await chromium.launch(candidate.options);
      return { browser, browserName: candidate.name };
    } catch (error) {
      failures.push({
        name: candidate.name,
        message: String(error && error.message ? error.message : error).split('\n')[0]
      });
    }
  }

  const detail = failures
    .map(failure => `- ${failure.name}: ${failure.message}`)
    .join('\n');
  throw new Error(`Could not launch any browser candidate.\n${detail}`);
}

function explainLaunchFailure(error) {
  const message = String(error && error.message ? error.message : error);
  if (message.includes('Executable doesn\'t exist') || message.includes('Please run the following command')) {
    return [
      message,
      '',
      'Playwright is installed, but its matching Chromium headless shell is missing.',
      'Either run:',
      '  npm run install:browser',
      'or use installed Chrome/Edge with:',
      '  $env:AURORA_BROWSER_CHANNEL="chrome"; npm run smoke:browser'
    ].join('\n');
  }
  if (message.includes('spawn EPERM')) {
    return [
      message,
      '',
      'The browser launch was blocked by the OS or security software.',
      'Allow this repo, node.exe, and the Playwright browser cache, then retry:',
      '  npm run smoke:browser'
    ].join('\n');
  }
  return message;
}

async function run() {
  const port = await findOpenPort();
  const url = `http://${host}:${port}/`;
  const server = startStaticServer(port);
  let browser;
  let browserName;

  try {
    await waitForServer(url);
    ({ browser, browserName } = await launchBrowser());
    const page = await browser.newPage();
    const consoleIssues = [];
    const pageErrors = [];

    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleIssues.push({ type: message.type(), text: message.text() });
      }
    });
    page.on('pageerror', error => {
      pageErrors.push({ name: error.name, message: error.message });
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await page.waitForFunction(() => document.documentElement.dataset.auroraAppLoaded === 'true', null, {
      timeout: navigationTimeoutMs
    });
    await page.waitForLoadState('networkidle', { timeout: navigationTimeoutMs }).catch(() => null);

    const result = await page.evaluate(async () => {
      const smokeXml = `<elements>
        <element name="Smoke Spell" type="Spell" source="Smoke Fixture" id="ID_SMOKE_SPELL">
          <supports>Wizard, 1</supports>
          <setters><set name="level">1</set></setters>
        </element>
      </elements>`;
      const repairPreviewCanAnalyze = Boolean(window.AuroraXMLHelper?.analyzeRepairXmlText)
        && (() => {
          const analysis = window.AuroraXMLHelper.analyzeRepairXmlText(smokeXml, 'smoke.xml');
          return analysis.catalog.totalElements === 1
            && analysis.diagnostics.some(finding => finding.category === 'spell-supports-level-token');
        })();
      const repairInteractionChecks = (() => {
        const app = window.AuroraXMLHelper;
        const input = document.querySelector('#repairXmlInput');
        if (!app?.switchWorkspaceView || !input) return null;
        const repairXml = `<elements>
          <element name="Feat Chooser" type="Class Feature" source="Smoke Fixture" id="ID_SMOKE_FEAT_CHOOSER">
            <rules><select type="Feat" name="Choose a feat" /></rules>
          </element>
          <element name="Spell Grant" type="Magic Item" source="Smoke Fixture" id="ID_SMOKE_SPELL_GRANT">
            <rules><grant type="Spell" /></rules>
          </element>
          <element name="Known Proficiencies" type="Class Feature" source="Smoke Fixture" id="ID_SMOKE_PROFICIENCIES">
            <rules>
              <select type="Proficiency" name="Skills" supports="Skill" />
              <select type="Proficiency" name="Languages" supports="Language" />
              <select type="Proficiency" name="Missing support" />
            </rules>
          </element>
        </elements>`;
        app.switchWorkspaceView('repair');
        input.value = repairXml;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#stepRepair button[onclick="inspectRepairXml()"]')?.click();
        const suggestionButton = document.querySelector('[data-repair-action][data-repair-value="feat"]');
        suggestionButton?.click();
        const safeSuggestedApplied = input.value.includes('<select type="Feat" name="Choose a feat" supports="feat" />');
        const supportCandidate = document.querySelector('[data-repair-action][data-repair-value="Skill"]');
        supportCandidate?.click();
        const candidateSelected = input.value.includes('<select type="Proficiency" name="Missing support" supports="Skill" />');
        const manualButton = document.querySelector('[data-repair-action][data-repair-value-input]');
        let manualInputFound = false;
        if (manualButton) {
          const valueInput = document.getElementById(manualButton.dataset.repairValueInput);
          manualInputFound = Boolean(valueInput);
          if (valueInput) {
            valueInput.value = 'ID_SMOKE_SPELL_TARGET';
            manualButton.click();
          }
        }
        const manualGrantApplied = input.value.includes('<grant type="Spell" id="ID_SMOKE_SPELL_TARGET" />');
        const undoButton = document.querySelector('#undoRepairBtn');
        const undoAvailable = Boolean(undoButton && !undoButton.disabled);
        undoButton?.click();
        const undoWorked = input.value.includes('supports="feat"')
          && input.value.includes('name="Missing support" supports="Skill"')
          && input.value.includes('<grant type="Spell" />')
          && !input.value.includes('ID_SMOKE_SPELL_TARGET');
        app.switchWorkspaceView('parse');
        return {
          safeSuggestedApplied,
          candidateSelected,
          manualButtonFound: Boolean(manualButton),
          manualInputFound,
          manualGrantApplied,
          undoAvailable,
          undoWorked
        };
      })();
      const workspaceLabels = Array.from(document.querySelectorAll('[data-workspace-tab]'))
        .map(button => button.textContent.trim());
      const hasWorkspaceViews = ['parse', 'repair', 'author']
        .every(name => Boolean(document.querySelector(`[data-workspace-view="${name}"]`)));
      const workspaceCanSwitch = Boolean(window.AuroraXMLHelper?.switchWorkspaceView)
        && (() => {
          window.AuroraXMLHelper.switchWorkspaceView('repair');
          const repairVisible = !document.querySelector('[data-workspace-view="repair"]').classList.contains('hidden');
          const parseHiddenAfterRepair = document.querySelector('[data-workspace-view="parse"]').classList.contains('hidden');
          window.AuroraXMLHelper.switchWorkspaceView('author');
          const authorVisible = !document.querySelector('[data-workspace-view="author"]').classList.contains('hidden');
          window.AuroraXMLHelper.switchWorkspaceView('parse');
          const parseVisible = !document.querySelector('[data-workspace-view="parse"]').classList.contains('hidden');
          return repairVisible && parseHiddenAfterRepair && authorVisible && parseVisible;
        })();
      const repairUiCanApply = (() => {
        window.AuroraXMLHelper.switchWorkspaceView('repair');
        document.querySelector('#repairXmlInput').value = smokeXml;
        Array.from(document.querySelectorAll('button'))
          .find(button => button.textContent.trim() === 'Inspect XML')
          .click();
        const preselected = document.querySelectorAll('#repairPreviewResults input[data-repair-select]:checked');
        if (preselected.length !== 1) return false;
        Array.from(document.querySelectorAll('#repairPreviewResults button'))
          .find(button => button.textContent.trim() === 'Apply Selected Repairs')
          .click();
        const results = document.querySelector('#repairPreviewResults');
        const status = document.querySelector('#repairPreviewStatus').textContent;
        const fixed = window.AuroraXMLHelper.changedRepairDocs();
        const ok = /resolved 1 finding/.test(status)
          && Boolean(results.querySelector('.repair-diff-line.add'))
          && fixed.length === 1
          && /<supports>Wizard<\/supports>/.test(fixed[0].xml)
          && !results.querySelector('.repair-apply-result .alert-error');
        window.clearRepairXmlPreview();
        window.AuroraXMLHelper.switchWorkspaceView('parse');
        return ok;
      })();
      const acPickerChecks = (() => {
        const app = window.AuroraXMLHelper;
        const xmlInput = document.querySelector('#authoringTemplateXml');
        if (!app?.switchWorkspaceView || !xmlInput) return null;
        app.switchWorkspaceView('author');
        const originalConfirm = window.confirm;
        window.confirm = () => true;

        const applyAC = (templateId, value, ruleName, ruleValue) => {
          document.querySelector(`[data-authoring-template="${templateId}"]`)?.click();
          const property = document.querySelector('#authoringElementProperty');
          const valueInput = document.querySelector('#authoringElementPropertyValue');
          property.value = 'armorClass';
          property.dispatchEvent(new Event('change', { bubbles: true }));
          valueInput.value = value;
          valueInput.dispatchEvent(new Event('input', { bubbles: true }));
          const elementStart = xmlInput.value.indexOf('<element');
          xmlInput.setSelectionRange(elementStart + 5, elementStart + 5);
          document.querySelector('#applyAuthoringElementPropertyBtn').click();
          const status = document.querySelector('#authoringTemplateStatus').textContent;
          const expectedSetter = `<set name="armorClass">${value}</set>`;
          const expectedRule = `<stat name="${ruleName}" value="${ruleValue}"`;
          return {
            setterUpdated: xmlInput.value.includes(expectedSetter),
            ruleUpdated: xmlInput.value.includes(expectedRule),
            statusMentionsRule: /AC rule/i.test(status)
          };
        };

        const armor = applyAC('armor-light', '13 + Dex modifier', 'ac:armored:armor', '13');
        const shield = applyAC('armor-shield', '+2', 'ac:shield', '2');
        document.querySelector('[data-authoring-template="armor-light"]')?.click();
        const property = document.querySelector('#authoringElementProperty');
        const valueInput = document.querySelector('#authoringElementPropertyValue');
        property.value = 'armorClass';
        property.dispatchEvent(new Event('change', { bubbles: true }));
        valueInput.value = 'Dexterity + 2';
        valueInput.dispatchEvent(new Event('input', { bubbles: true }));
        const invalidACDisabled = document.querySelector('#applyAuthoringElementPropertyBtn').disabled;
        const beforeInvalidAC = xmlInput.value;
        document.querySelector('#applyAuthoringElementPropertyBtn').click();
        const invalidACUnchanged = xmlInput.value === beforeInvalidAC;
        window.confirm = originalConfirm;
        app.switchWorkspaceView('parse');
        return { armor, shield, invalidACDisabled, invalidACUnchanged };
      })();
      const authoringChecks = (() => {
        const app = window.AuroraXMLHelper;
        const xmlInput = document.querySelector('#authoringTemplateXml');
        const buttons = Array.from(document.querySelectorAll('[data-authoring-template]'));
        if (!app?.switchWorkspaceView || !xmlInput || !buttons.length) return null;
        app.switchWorkspaceView('author');

        const originalConfirm = window.confirm;
        xmlInput.value += '\n<!-- keep this draft -->';
        xmlInput.dispatchEvent(new Event('input', { bubbles: true }));
        let discardPrompt = '';
        window.confirm = message => {
          discardPrompt = message;
          return false;
        };
        const firstSwitch = buttons.find(button => button.dataset.authoringTemplate !== document.querySelector('[data-authoring-template][aria-pressed="true"]')?.dataset.authoringTemplate);
        firstSwitch?.click();
        const cancelledSwitchPreservedDraft = xmlInput.value.includes('<!-- keep this draft -->')
          && Boolean(discardPrompt);
        window.confirm = () => true;
        firstSwitch?.click();
        const acceptedSwitchDiscardedDraft = !xmlInput.value.includes('<!-- keep this draft -->');
        window.confirm = originalConfirm;

        const templateValidation = [];
        for (const button of buttons) {
          button.click();
          document.querySelector('#stepAuthoring button[onclick="validateAuthoringTemplateXml()"]')?.click();
          templateValidation.push({
            id: button.dataset.authoringTemplate,
            passed: document.querySelector('#authoringTemplateStatus').textContent === 'Shape check passed.'
          });
        }

        window.confirm = () => true;
        document.querySelector('[data-authoring-template="item-magic"]')?.click();
        const ruleType = document.querySelector('#authoringRuleType');
        xmlInput.value = `<elements>
          <element name="First Target" type="Item" source="Smoke Fixture" id="ID_SMOKE_FIRST_TARGET">
            <rules />
          </element>
          <element name="Second Target" type="Item" source="Smoke Fixture" id="ID_SMOKE_SECOND_TARGET">
            <rules />
          </element>
        </elements>`;
        xmlInput.dispatchEvent(new Event('input', { bubbles: true }));
        const secondTargetStart = xmlInput.value.indexOf('<element name="Second Target"');
        xmlInput.setSelectionRange(secondTargetStart + 10, secondTargetStart + 10);
        ruleType.value = 'ac';
        ruleType.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#insertAuthoringRuleSnippetBtn').click();
        const firstTargetEnd = xmlInput.value.indexOf('</element>');
        const secondTargetStartAfterEdit = xmlInput.value.indexOf('<element name="Second Target"');
        const secondTargetEnd = xmlInput.value.indexOf('</element>', secondTargetStartAfterEdit);
        const emptyRulesBlockReused = xmlInput.value.slice(0, firstTargetEnd).includes('<rules />')
          && !xmlInput.value.slice(secondTargetStartAfterEdit, secondTargetEnd).includes('<rules />')
          && /<rules>\s*<stat name="ac:misc" value="1" \/>/.test(xmlInput.value.slice(secondTargetStartAfterEdit, secondTargetEnd));

        ruleType.value = 'fly-increase';
        ruleType.dispatchEvent(new Event('change', { bubbles: true }));
        const normalFlyPreview = document.querySelector('#authoringRuleSnippetPreview').textContent;
        document.querySelector('#insertAuthoringRuleSnippetBtn').click();
        ruleType.value = 'fly-increase-innate';
        ruleType.dispatchEvent(new Event('change', { bubbles: true }));
        const innateFlyPreview = document.querySelector('#authoringRuleSnippetPreview').textContent;
        document.querySelector('#insertAuthoringRuleSnippetBtn').click();
        const flySpeedSnippetsCorrect = normalFlyPreview.includes('requirements="[speed:fly:1]"')
          && innateFlyPreview.includes('name="innate speed:fly:misc"')
          && innateFlyPreview.includes('requirements="[innate speed:fly:1]"')
          && xmlInput.value.includes('name="speed:fly:misc"')
          && xmlInput.value.includes('name="innate speed:fly:misc"');

        ruleType.value = 'spell-grant';
        ruleType.dispatchEvent(new Event('change', { bubbles: true }));
        const spellId = document.querySelector('#authoringRuleSpellId');
        spellId.value = 'ID_SMOKE_SPELL_TARGET';
        spellId.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#insertAuthoringRuleSnippetBtn').click();
        const spellGrantInserted = xmlInput.value.includes('<grant type="Spell" id="ID_SMOKE_SPELL_TARGET" />');

        ruleType.value = 'spell-effect';
        ruleType.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#authoringRuleAction').value = 'Bonus Action';
        document.querySelector('#authoringRuleAction').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#authoringRuleUsage').value = '1/Day';
        document.querySelector('#authoringRuleUsage').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#authoringRuleEffect').value = 'A & B <C>';
        document.querySelector('#authoringRuleEffect').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#insertAuthoringRuleSnippetBtn').click();
        const spellEffectInserted = xmlInput.value.includes('<description action="Bonus Action" usage="1/Day">A &amp; B &lt;C&gt;</description>');

        document.querySelector('[data-authoring-template="weapon-melee"]')?.click();
        const weaponPropertyOptions = Array.from(document.querySelectorAll('#authoringElementProperty option')).map(option => option.value);
        const invalidWeaponPropertiesOmitted = !weaponPropertyOptions.includes('properties');

        document.querySelector('[data-authoring-template="feat-general"]')?.click();
        const property = document.querySelector('#authoringElementProperty');
        const propertyValue = document.querySelector('#authoringElementPropertyValue');
        property.value = 'prerequisite';
        property.dispatchEvent(new Event('change', { bubbles: true }));
        propertyValue.value = 'Strength 13';
        propertyValue.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#applyAuthoringElementPropertyBtn').click();
        const featPrerequisiteInserted = xmlInput.value.includes('<prerequisite>Strength 13</prerequisite>');

        window.confirm = originalConfirm;
        app.switchWorkspaceView('parse');
        return {
          cancelledSwitchPreservedDraft,
          acceptedSwitchDiscardedDraft,
          templateValidation,
          emptyRulesBlockReused,
          flySpeedSnippetsCorrect,
          spellGrantInserted,
          spellEffectInserted,
          invalidWeaponPropertiesOmitted,
          featPrerequisiteInserted
        };
      })();
      let pdfExtractionCanReadText = false;
      let pdfExtractionError = '';
      try {
        const pdfDoc = await window.PDFLib.PDFDocument.create();
        const page = pdfDoc.addPage([300, 200]);
        const font = await pdfDoc.embedFont(window.PDFLib.StandardFonts.Helvetica);
        page.drawText('Smoke PDF Text', { x: 40, y: 140, size: 12, font });
        const bytes = await pdfDoc.save();
        const file = new File([bytes], 'smoke.pdf', { type: 'application/pdf' });
        const pages = await window.AuroraXMLHelper.extractPdfPages(file);
        pdfExtractionCanReadText = pages.length === 1 && /Smoke PDF Text/.test(pages[0].text);
      } catch (error) {
        pdfExtractionError = String(error && error.message ? error.message : error);
      }

      return {
        title: document.title,
        readyState: document.readyState,
        jszipLoaded: document.documentElement.dataset.jszipLoaded,
        pdfLibLoaded: document.documentElement.dataset.pdfLibLoaded,
        pdfjsLoaded: document.documentElement.dataset.pdfjsLoaded,
        auroraShapeLoaded: document.documentElement.dataset.auroraShapeLoaded,
        auroraPatternsLoaded: document.documentElement.dataset.auroraPatternsLoaded,
        auroraRepairLoaded: document.documentElement.dataset.auroraRepairLoaded,
        auroraReferenceLoaded: document.documentElement.dataset.auroraReferenceLoaded,
        auroraAuthoringTemplatesLoaded: document.documentElement.dataset.auroraAuthoringTemplatesLoaded,
        pdfTextLayoutLoaded: document.documentElement.dataset.pdfTextLayoutLoaded,
        pdfPageRangeLoaded: document.documentElement.dataset.pdfPageRangeLoaded,
        auroraAppLoaded: document.documentElement.dataset.auroraAppLoaded,
        hasPdfInput: Boolean(document.querySelector('input[type=file]')),
        hasPageRange: Boolean(document.querySelector('#pageRange')),
        hasExtractButton: Boolean(document.querySelector('#extractBtn')),
        hasRepairXmlInput: Boolean(document.querySelector('#repairXmlInput')),
        hasRepairInspectButton: Array.from(document.querySelectorAll('button'))
          .some(button => button.textContent.trim() === 'Inspect XML'),
        repairInteractionChecks,
        workspaceLabels,
        hasWorkspaceViews,
        workspaceCanSwitch,
        acPickerChecks,
        authoringChecks,
        repairPreviewCanAnalyze,
        repairUiCanApply,
        pdfExtractionCanReadText,
        pdfExtractionError
      };
    });

    const expectedFlags = [
      'jszipLoaded',
      'pdfLibLoaded',
      'pdfjsLoaded',
      'auroraShapeLoaded',
      'auroraPatternsLoaded',
      'auroraRepairLoaded',
      'auroraReferenceLoaded',
      'auroraAuthoringTemplatesLoaded',
      'pdfTextLayoutLoaded',
      'pdfPageRangeLoaded',
      'auroraAppLoaded'
    ];
    const missing = expectedFlags.filter(flag => result[flag] !== 'true');
    if (
      missing.length
      || !result.hasPdfInput
      || !result.hasPageRange
      || !result.hasExtractButton
      || !result.hasRepairXmlInput
      || !result.hasRepairInspectButton
      || !result.repairInteractionChecks?.safeSuggestedApplied
      || !result.repairInteractionChecks?.candidateSelected
      || !result.repairInteractionChecks?.manualButtonFound
      || !result.repairInteractionChecks?.manualInputFound
      || !result.repairInteractionChecks?.manualGrantApplied
      || !result.repairInteractionChecks?.undoAvailable
      || !result.repairInteractionChecks?.undoWorked
      || !result.workspaceLabels.includes('Upload & Parse')
      || !result.workspaceLabels.includes('Lint & Repair')
      || !result.workspaceLabels.includes('Create & Author')
      || !result.hasWorkspaceViews
      || !result.workspaceCanSwitch
      || !result.acPickerChecks?.armor.setterUpdated
      || !result.acPickerChecks?.armor.ruleUpdated
      || !result.acPickerChecks?.armor.statusMentionsRule
      || !result.acPickerChecks?.shield.setterUpdated
      || !result.acPickerChecks?.shield.ruleUpdated
      || !result.acPickerChecks?.shield.statusMentionsRule
      || !result.acPickerChecks?.invalidACDisabled
      || !result.acPickerChecks?.invalidACUnchanged
      || !result.authoringChecks?.cancelledSwitchPreservedDraft
      || !result.authoringChecks?.acceptedSwitchDiscardedDraft
      || !result.authoringChecks?.templateValidation.length
      || !result.authoringChecks.templateValidation.every(item => item.passed)
      || !result.authoringChecks?.emptyRulesBlockReused
      || !result.authoringChecks?.flySpeedSnippetsCorrect
      || !result.authoringChecks?.spellGrantInserted
      || !result.authoringChecks?.spellEffectInserted
      || !result.authoringChecks?.invalidWeaponPropertiesOmitted
      || !result.authoringChecks?.featPrerequisiteInserted
      || !result.repairPreviewCanAnalyze
      || !result.repairUiCanApply
      || !result.pdfExtractionCanReadText
    ) {
      throw new Error(`Browser smoke failed app readiness checks: ${JSON.stringify({ missing, result }, null, 2)}`);
    }
    if (pageErrors.length) {
      throw new Error(`Browser smoke saw page errors: ${JSON.stringify(pageErrors, null, 2)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      url,
      browser: browserName,
      httpStatus: response && response.status(),
      title: result.title,
      flags: expectedFlags.reduce((flags, flag) => ({ ...flags, [flag]: result[flag] }), {}),
      consoleIssues
    }, null, 2));
  } catch (error) {
    console.error(explainLaunchFailure(error));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    stopStaticServer(server);
  }
}

run().catch(error => {
  console.error(explainLaunchFailure(error));
  process.exitCode = 1;
});
