# Test Fixtures

This directory keeps regression fixtures small and source-safe.

- `golden/` contains committed synthetic source snippets plus expected XML shape manifests. These protect canonical Aurora generation patterns without committing book text.
- `local-corpus.example.json` shows how to wire local real-world text, Markdown, PDFs, and canonical Aurora folders into `npm run corpus:local`.
- `local-corpus.json` is gitignored. Copy the example to that name and adjust paths for your machine.
- Set `"pageRange": "21-23"` on a PDF fixture to keep a corpus gate narrow. The browser and CLI accept individual pages and comma-separated ascending ranges, such as `21,24-26`; malformed ranges fail instead of scanning the whole source.
- When a selected range ends at a parsed spell header with no body text, or a partial spell description ends at a page footer, the reader may use the immediate next page as continuation context. It stops before the next spell definition. This does not expand the fixture's source page range or entity scope; benchmark and source reports list continuation pages separately.
- Set `"enabled": false` on source candidates you want documented but not run yet.
- `fizban-spells.expect.json` defines the focused spell-section accuracy check for PDF pages 21–23 (printed pages 19–21), with page 24 as continuation context. It requires all seven spells, key mechanics text, the complete roll-result labels, and the referenced creature statistics. The source PDF stays outside the repository.
- Use `minExtracted`, `minExtractedTotal`, `minGenerated`, or `minMatched` to prevent vacuous passes when a source extracts nothing.
- Use `maxHighSeverity` in local thresholds to fail on missing canonical IDs, grants, choices, or stats even when the exact-match percentage still looks healthy.
- Add a `sourceValidation` block when a local fixture should also validate source interpretation before XML generation. It can declare expected entities, minimum parsed counts, required descriptions, and required feature names.
- Use `sourceValidation.types` when the source gate should parse a broader set of element types than the XML benchmark currently compares. This is useful for proving source coverage before a generator category has reached first-party-like XML shape.
- Source gates fail on errors by default. Use `sourceValidation.maxWarnings` and `sourceValidation.maxReview` when a strict fixture should also fail on warning or review findings.
- Use `requiredText: { "spell": { "Name": ["required phrase"] } }` in source expectations to catch omitted or incorrectly extracted mechanics. Comparisons ignore case and whitespace; ambiguous dice notation and missing named stat blocks are also reported.
- Use `requiredMetadata: { "spell": { "Name": { "level": 0, "castingTime": "1 action" } } }` to check captured field values. Strings ignore case and whitespace; numbers and booleans must match exactly, including zero and false.
- Use `forbiddenText: { "magic": { "Name": ["known sidebar phrase"] } }` to flag unwanted commentary in a captured description. These checks identify known contamination; they do not remove it automatically.
- `complex-pdf-audits.json` records four contrasting PDFs in six local checks, including expanded base-class sections for Ranger and Witch. All six source checks pass after the [sidebar and class fixes](../../docs/accuracy-checks/2026-11-14/sidebar-class-fixes.md). This private-source audit is opt-in and is not a CI gate. Source coverage does not certify complete rules automation; the app separately flags table features without descriptions.
- `../source-review.test.js` uses original synthetic text to cover PDF references, continuation context, pasted lines, warning navigation, live updates, skipped-entry restoration, missing class features, remembered corrections, metadata detection, and draft recovery. The [source review milestone report](../../docs/accuracy-checks/2026-11-14/source-review-milestone.md) records the corresponding checks against the existing local PDFs. Browser release checks also exercise PDF source references, warning correction, and recovery before ZIP export.
- `../spell-availability.test.js` adds source-wide base lists and conditional access checks using original text and a generated three-page PDF. It covers source boundaries, custom classes, class membership conflicts, conditional owners and choices, split or wrapped tables, cantrip rows, unreadable levels and corrections, prerequisites, XML supports, and draft recovery. The private Elemental Evil and Fizban expectations now require complete class membership sets. See the [spell availability report](../../docs/accuracy-checks/2026-11-14/spell-availability.md).
- The original class-choice fixture and class-progression tests cover schedules, prerequisites, conditional grants, damaged tables, repairs, recovery, and XML shape. Run node scripts/audit-class-progression.js for opt-in checks against the private Ranger, Witch, and Artificer sources. See the [class progression report](../../docs/accuracy-checks/2026-11-14/class-progression.md).
- Older class features use progression-table levels or explicit feature levels. The immediate continuation page may finish the last selected feature, but does not import new base features or subclasses. Choice catalogues use separately disclosed context. Inset reference prose is retained in the class overview.

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

Run the focused spell-section gate against the local PDF with:

```powershell
npm run source:fixture -- --source "$env:USERPROFILE\Documents\DnD\books and docs\Fizban's Treasury of Dragons [HQ] [OCR] [Bookmarked].pdf" --type spell --page-range 21-23 --source-name "Fizban's Treasury of Dragons" --source-abbr WOTC_FTOD --source-year 2021 --expect tests/fixtures/fizban-spells.expect.json
```

`pdf-spell-accuracy.test.js` exercises the same failure patterns using an original
two-column, two-page PDF generated in the test. It runs in CI without the source book.

Run one of the additional PDF audits with:

```powershell
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Elemental Evil - spell definitions"
```

Choose another entry's exact name to reproduce its findings. The paths resolve
against `USERPROFILE`; source PDFs and generated reports stay local.
`pdf-complex-structures.test.js` covers the corrected parsing patterns with
synthetic content in CI.
`pdf-class-extraction.test.js` adds a generated two-page class PDF and checks
feature levels, metadata, scope, and XML. `pdf-text-layout.test.js` covers wide
tables, uneven columns, annotations, and reference text using synthetic positions
and font metadata. Source-book files and fonts are not required by these tests.

Run the Aurora XML shape validator in required mode with:

```powershell
npm run test:validator:required
```

Required mode fails instead of skipping when PowerShell cannot be found. `npm test` still skips that validator check on machines without PowerShell so the portable fixture tests can run anywhere.

PowerShell discovery shares a 30-second startup budget across candidates and
caches successful discovery until the executable settings change. Each validator
process has a separate 30-second limit. The two integration tests allow 70 seconds
for startup, validation, and fixture cleanup; a timed-out process fails explicitly
and is terminated. Invalid XML still fails without an automatic retry.
