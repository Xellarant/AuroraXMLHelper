const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const staleFiles = [
  'vendor/pdf.min.js'
];

const files = [
  {
    from: 'node_modules/jszip/dist/jszip.min.js',
    to: 'vendor/jszip.min.js'
  },
  {
    from: 'node_modules/pdfjs-dist/build/pdf.min.mjs',
    to: 'vendor/pdf.min.mjs'
  },
  {
    from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    to: 'vendor/pdf.worker.min.mjs'
  },
  {
    from: 'node_modules/pdf-lib/dist/pdf-lib.min.js',
    to: 'vendor/pdf-lib.min.js'
  },
  {
    from: 'node_modules/jszip/LICENSE.markdown',
    to: 'vendor/licenses/jszip-LICENSE.markdown'
  },
  {
    from: 'node_modules/pdfjs-dist/LICENSE',
    to: 'vendor/licenses/pdfjs-dist-LICENSE'
  },
  {
    from: 'node_modules/pdf-lib/LICENSE.md',
    to: 'vendor/licenses/pdf-lib-LICENSE.md'
  }
];

for (const staleFile of staleFiles) {
  const target = path.join(root, staleFile);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    console.log(`removed ${staleFile}`);
  }
}

function copyBrowserDependency(entry) {
  const source = path.join(root, entry.from);
  const target = path.join(root, entry.to);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing dependency file: ${entry.from}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`${entry.from} -> ${entry.to}`);
}

for (const file of files) copyBrowserDependency(file);
