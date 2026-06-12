#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const vitestCli = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

function nodeVersion(command) {
  const result = spawnSync(command, ['-e', 'process.stdout.write(process.versions.node)'], {
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) return null;
  const version = String(result.stdout || '').trim();
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) ? { command, version, major } : null;
}

function localNodeCandidates() {
  const candidates = [];
  if (process.env.AURORA_NODE) candidates.push(process.env.AURORA_NODE);

  const localPrograms = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs-lts')
    : '';
  if (localPrograms && fs.existsSync(localPrograms)) {
    for (const entry of fs.readdirSync(localPrograms, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nodePath = path.join(localPrograms, entry.name, 'node.exe');
      if (fs.existsSync(nodePath)) candidates.push(nodePath);
    }
  }

  candidates.push('node');
  return Array.from(new Set(candidates));
}

function selectNode() {
  const versions = localNodeCandidates()
    .map(nodeVersion)
    .filter(Boolean)
    .sort((a, b) => b.major - a.major);
  return versions.find(version => version.major >= 20) || versions[0] || null;
}

const selected = selectNode();
if (!selected || selected.major < 20) {
  const current = selected ? `${selected.version} at ${selected.command}` : 'none found';
  console.error(`Vitest 4 requires Node 20 or newer; available Node is ${current}.`);
  console.error('Install Node 20+ or set AURORA_NODE to a compatible node.exe path.');
  process.exit(1);
}

const args = [vitestCli, ...process.argv.slice(2)];
const result = spawnSync(selected.command, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${path.dirname(selected.command)}${path.delimiter}${process.env.PATH || ''}`
  }
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
