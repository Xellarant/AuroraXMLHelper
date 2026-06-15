Browser bundles used by `index.html`.

These files are copied from npm packages so the static app can run without CDN access:

- `jszip.min.js` from `jszip`
- `pdf.min.mjs` from `pdfjs-dist`
- `pdf.worker.min.mjs` from `pdfjs-dist`
- `pdf-lib.min.js` from `pdf-lib`

Run `npm run vendor:browser` after dependency version changes.
