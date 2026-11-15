const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Call once while defining a test file, so its hook owns only that file's paths.
function temporaryDirectories() {
  const owned = new Map();
  const parent = path.resolve(os.tmpdir());
  afterEach(() => {
    for (const [directory, prefix] of owned) {
      assert.equal(path.dirname(directory), parent, 'Temporary cleanup must stay inside the system temp directory.');
      assert.ok(path.basename(directory).startsWith(prefix), 'Temporary cleanup must match its recorded task prefix.');
      fs.rmSync(directory, { recursive: true, force: true });
      owned.delete(directory);
    }
  });
  return prefix => {
    assert.match(prefix, /^aurora-[a-z0-9-]+-$/i);
    const directory = path.resolve(fs.mkdtempSync(path.join(parent, prefix)));
    owned.set(directory, prefix);
    return directory;
  };
}

module.exports = { temporaryDirectories };
