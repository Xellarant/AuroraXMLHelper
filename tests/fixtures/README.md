# Test Fixtures

This directory keeps regression fixtures small and source-safe.

- `golden/` contains committed synthetic source snippets plus expected XML shape manifests. These protect canonical Aurora generation patterns without committing book text.
- `local-corpus.example.json` shows how to wire local real-world text, Markdown, PDFs, and canonical Aurora folders into `npm run corpus:local`.
- `local-corpus.json` is gitignored. Copy the example to that name and adjust paths for your machine.
- Set `"pageRange": "21-23"` on a PDF fixture to keep a corpus gate narrow. The CLI accepts individual pages and comma-separated ascending ranges, such as `21,24-26`; malformed ranges fail instead of scanning the whole source.
- When a selected range ends at a parsed entity header with no body text, the reader may use the immediate next page as continuation context. This does not expand the fixture's source page range or entity scope; benchmark and source reports list continuation pages separately.
- Set `"enabled": false` on source candidates you want documented but not run yet.
- Use `minExtracted`, `minExtractedTotal`, `minGenerated`, or `minMatched` to prevent vacuous passes when a source extracts nothing.
- Use `maxHighSeverity` in local thresholds to fail on missing canonical IDs, grants, choices, or stats even when the exact-match percentage still looks healthy.
- Add a `sourceValidation` block when a local fixture should also validate source interpretation before XML generation. It can declare expected entities, minimum parsed counts, required descriptions, and required feature names.
- Use `sourceValidation.types` when the source gate should parse a broader set of element types than the XML benchmark currently compares. This is useful for proving source coverage before a generator category has reached first-party-like XML shape.
- Source gates fail on errors by default. Use `sourceValidation.maxWarnings` and `sourceValidation.maxReview` when a strict fixture should also fail on warning or review findings.

Run the committed fixtures with:

```powershell
npm run test:fixtures
```

Run local real-world corpus checks with:

```powershell
npm run corpus:local
```

Run the source interpretation gate for a local fixture with:

```powershell
npm run source:fixture -- --manifest tests/fixtures/local-corpus.json --name "Eberron: Forge of the Artificer" --out-dir reports/efa
```

Run the Aurora XML shape validator in required mode with:

```powershell
npm run test:validator:required
```

Required mode fails instead of skipping when PowerShell cannot be found. `npm test` still skips that validator check on machines without PowerShell so the portable fixture tests can run anywhere.
