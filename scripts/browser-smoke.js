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

    const result = await page.evaluate(() => ({
      title: document.title,
      readyState: document.readyState,
      jszipLoaded: document.documentElement.dataset.jszipLoaded,
      pdfLibLoaded: document.documentElement.dataset.pdfLibLoaded,
      pdfjsLoaded: document.documentElement.dataset.pdfjsLoaded,
      auroraShapeLoaded: document.documentElement.dataset.auroraShapeLoaded,
      pdfTextLayoutLoaded: document.documentElement.dataset.pdfTextLayoutLoaded,
      auroraAppLoaded: document.documentElement.dataset.auroraAppLoaded,
      hasPdfInput: Boolean(document.querySelector('input[type=file]')),
      hasPageRange: Boolean(document.querySelector('#pageRange')),
      hasExtractButton: Boolean(document.querySelector('#extractBtn'))
    }));

    const expectedFlags = [
      'jszipLoaded',
      'pdfLibLoaded',
      'pdfjsLoaded',
      'auroraShapeLoaded',
      'pdfTextLayoutLoaded',
      'auroraAppLoaded'
    ];
    const missing = expectedFlags.filter(flag => result[flag] !== 'true');
    if (missing.length || !result.hasPdfInput || !result.hasPageRange || !result.hasExtractButton) {
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
