# 1.0 release candidate acceptance — November 15, 2026

Candidate: **1.0.0-rc.1**. This report distinguishes completed checks from pending
acceptance. The candidate tag is separate from the eventual stable 1.0 tag.

| Check | Result |
| --- | --- |
| Dependency security | Compatible updates installed; npm audit reports zero known vulnerabilities, including development dependencies. |
| Automated regression suite | 361 tests pass before the desktop acceptance pass; final result will be recorded below. |
| Remembered corrections | Individual named feature/option edits and level-keyed row edits preserve fresh prose, new siblings, and source references. Renamed, ambiguous, structurally changed, and older broad corrections are held for review. Regression coverage includes persistence, safe display, forgetting, and restoring the fresh baseline. |
| Chromium and Firefox | Both engines configured in CI and live verification; remote acceptance pending. Local interactive checks use the in-app browser. |
| Large PDF | The 129,592,597-byte, 161-page local Sword Coast source exposed split metadata that initially yielded zero spells. After the bounded OCR fix it yields four spells and shape-valid XML. Last run: 4.75 seconds reading, 9.28 seconds overall, 471 MiB peak process memory. These are local observations, not performance guarantees. |
| Browser PDF/export workflow | Book-sized synthetic fixture expanded to 250 pages, with availability evidence on page 1 and its exact expected spell on page 250. CI measures extraction time, verifies recovery, and checks clean and warning-confirmed exports. Remote results pending. |
| Aurora class acceptance | Isolated content/settings/cache setup prepared; desktop checks in progress. |

## Reproduce

- Run `npm ci`, `npm audit`, and `npm test` using Node 24 LTS.
- Generate the synthetic desktop content with
  `node scripts/create-class-runtime-fixtures.js`. The original source and generated
  XML are in `tests/fixtures/aurora-runtime/class-progression`.
- In an isolated Aurora documents folder, install that XML alongside the required
  first-party definitions. Create a disposable Mistkeeper character and check level
  gains, choice counts and prerequisites, spells, and save/reopen behavior.
- Run the private large-file check with
  `node scripts/run-node20.js scripts/check-large-pdf.js "<local PDF path>"`.
  It emits aggregate metadata and timings only. The source book is not committed.
- GitHub browser jobs install matching Playwright Chromium/Firefox builds on
  Ubuntu 24.04. `AURORA_BROWSER=firefox` selects Firefox for those checks.

## Release contract

The 1.0 scope is an assisted authoring workflow with review before export.
Unresolved mechanics remain visible; a successful XML check does not certify every
game rule. Draft format version 1 is retained. Changes to draft formats require
compatibility tests or an explicit migration and backup path. Preserve annotated
release tags and use a new version for subsequent changes.

Before stable 1.0, all acceptance rows above must have an observed outcome and any
remaining limitation must be stated in the release notes. A stable tag is not a
substitute for completing those checks.
