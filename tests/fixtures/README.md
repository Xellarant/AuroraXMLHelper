# Test Fixtures

This directory keeps regression fixtures small and source-safe.

- `golden/` contains committed synthetic source snippets plus expected XML shape manifests. These protect canonical Aurora generation patterns without committing book text.
- `local-corpus.example.json` shows how to wire local real-world text, Markdown, PDFs, and canonical Aurora folders into `npm run corpus:local`.
- `local-corpus.json` is gitignored. Copy the example to that name and adjust paths for your machine.
- Set `"enabled": false` on source candidates you want documented but not run yet.
- Use `minExtracted`, `minExtractedTotal`, `minGenerated`, or `minMatched` to prevent vacuous passes when a source extracts nothing.
- Use `maxHighSeverity` in local thresholds to fail on missing canonical IDs, grants, choices, or stats even when the exact-match percentage still looks healthy.

Run the committed fixtures with:

```powershell
npm run test:fixtures
```

Run local real-world corpus checks with:

```powershell
npm run corpus:local
```

Run the Aurora XML shape validator in required mode with:

```powershell
npm run test:validator:required
```

Required mode fails instead of skipping when PowerShell cannot be found. `npm test` still skips that validator check on machines without PowerShell so the portable fixture tests can run anywhere.
