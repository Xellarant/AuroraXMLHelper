const assert = require('node:assert/strict');
const { supportsNode } = require('../scripts/node-compat');
test('development commands enforce the actual Vite runtime minimum, including Node minor versions', () => {
  for (const version of ['20.19.0', '20.20.0', '22.12.0', '24.16.0']) assert.equal(supportsNode(version), true, version);
  for (const version of ['18.20.0', '20.18.3', '21.7.0', '22.11.0', '', '24', 'invalid']) assert.equal(supportsNode(version), false, version);
});
