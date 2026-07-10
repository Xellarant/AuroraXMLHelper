# Project Audit - 2026-06-15

## Scope

Full audit of Aurora XML Helper after the recent deterministic parser, source validation, corpus benchmark, and CI work. The goal was to identify existing bugs and future concerns for a project whose correctness target is source-faithful extraction, Aurora-compatible XML, and first-party-like generated shape.

The active repository is `C:\Users\Ralla\source\repos\AuroraXMLHelper`. The older `C:\Users\Ralla\source\repos\Aurora XML Helper` folder is only a pointer workspace and is not the source of truth.

## 2026-06-22 Follow-up: Narrow Fizban Spell Corpus

Multi-column PDF ordering is resolved for the verified Fizban spell scope. Browser and CLI now share positioned-text layout logic, preserve row-first ordering on ordinary pages, and read accepted two-column pages left-to-right by column. The Fizban pages `21-23` spell benchmark extracts the seven expected spells and reaches 7/7 exact canonical shape matches with no unmatched or high-severity differences.

The fix preserves positioned rows alongside flattened prose and uses that structure to bind the spell-table class/concentration/ritual columns. A selected page range can now read its immediate next page as disclosed continuation context when a spell header has no selected-page body, allowing Summon Draconic Spirit to retain its prose without expanding the fixture's entity scope. Broader multi-column tables remain an open risk: this evidence does not prove general table extraction for races, subclasses, feats, magic items, or other Fizban sections. Those remain separate corpus scopes.

The follow-up cleanup keeps Draconic Transformation's page-break benefit prose, removes spell-list class-column bleed from that description, and removes page chrome/sidebar OCR from Fizban's Platinum Shield while preserving Nathair's Mischief's actual `d4 Effect` table. The Fizban spell source gate now reports zero errors, warnings, or review findings for the seven-spell scope.

The local corpus runner now executes `sourceValidation` for entries that declare it, and strict source fixtures can opt into warning/review limits with `sourceValidation.maxWarnings` and `sourceValidation.maxReview`. Duplicate element IDs inside one XML file, generated XML comment escaping, and duplicate extracted source-entity findings are also covered by current code and tests.

## Validation Run

- `npm test`: pass, 5 test files and 51 tests.
- `npm run corpus:local`: pass.
- EFA corpus result: 146/147 exact matches, 99.3%, unmatched=0, high-severity=0.
- Fizban corpus result: 0/2 exact matches, unmatched=1, different=2, high-severity=0.
- Direct EFA source gate: pass, errors=0, warnings=0, review=0.

## Findings

### Source validation is not enforced by `npm run corpus:local`

`tests/fixtures/local-corpus.json` defines a rich EFA `sourceValidation` block, but `scripts/run-local-corpus-benchmarks.js` only runs the XML benchmark and threshold checks. This means the one-command local corpus gate does not yet enforce the normalized source model checks described in the roadmap.

Recommendation: have the local corpus runner execute `sourceValidation` for entries that declare it, and fail when the source gate reports errors. Keep warnings and review findings visible but non-fatal unless a fixture opts into stricter behavior.

### Duplicate element IDs inside one XML file are missed

The browser validator stores duplicate IDs in a `Set` of filenames. If the same ID appears twice in one XML file, the set still has one filename and no issue is reported. The PowerShell validator has the same issue because it de-duplicates locations before checking for duplicates.

Recommendation: track occurrence counts or full locations rather than only unique filenames. A duplicate ID should be reported whenever it appears more than once, even in the same file.

### Some generated XML comments are not comment-safe

Most inferred rule comments now use `escXmlComment`, but section labels and a few fallback background comments still interpolate text into XML comments without comment-specific escaping. Text containing `--` can produce invalid XML comments.

Recommendation: route every generated XML comment through `escXmlComment`, including section labels and fallback/manual-note comments.

### Source-validation indexing can hide duplicate extracted entities

`source-validation.js` indexes entities by normalized `type::name` and overwrites earlier entries. Duplicate extracted entities can therefore mask extraction noise or a split-boundary bug.

Recommendation: store arrays per key and add a warning or review finding for duplicate extracted source entities.

### Legacy AI extraction code is still present but mostly unreachable

The UI presents the deterministic parser as the product path, and `startExtraction()` returns after deterministic extraction. Old Gemini/Ollama controls and model-call code remain hidden or unreachable.

Recommendation: either remove the legacy AI path or quarantine it behind an explicit feature flag with tests. This reduces confusion and avoids preserving unused API-key/localStorage/network-call surfaces.

### Mojibake remains in parser-adjacent code

Some corrupted quote/dash sequences remain in strings and regexes. Most are harmless legacy prompts, but source-title detection still includes corrupted punctuation in its character class.

Recommendation: normalize remaining mojibake in parser-adjacent code and add focused tests for source titles with real curly punctuation.

### Corpus coverage is strong for EFA but weak for other sources

EFA is now a useful golden corpus. Fizban currently functions only as a loose smoke benchmark and should not be interpreted as broad parser correctness.

Recommendation: graduate more local sources into strict manifests with named expected entities, source validation, and stronger exact-match thresholds.

## Future Concerns

### `src/app.js` is too large for the project's correctness burden

`src/app.js` is over 6,000 lines and owns parsing, UI rendering, validation, XML generation, override persistence, download behavior, and legacy AI code. That makes future changes harder to review and harder to test precisely.

Recommendation: split pure parser, source model, XML generator, validator, and UI shell modules. Keep tests close to the pure modules, then add a small browser smoke test for upload, manual authoring, preview, and export.

### Static app dependencies rely on CDNs

`index.html` loads JSZip, pdf.js, pdf-lib, and fonts from external CDNs. That is fragile for a local deterministic tool and makes offline use less reliable.

Recommendation: vendor or bundle core JavaScript dependencies, or add integrity/fallback behavior if the app remains CDN-backed.

### CI produces duplicate checks on PR branches

The test workflow runs on both `push` and `pull_request`, so the same branch can produce duplicate parser-regression checks.

Recommendation: add workflow concurrency cancellation and consider limiting push checks to the default branch.

## Suggested Next Fix Order

1. Start module extraction around the pure parser, generator, and validator surfaces.
2. Add the next strict source/corpus scope after Fizban spells, without claiming broader Fizban coverage.
3. Continue replacing broad parser heuristics with narrow block-shape guards as each real PDF fixture proves a failure mode.
