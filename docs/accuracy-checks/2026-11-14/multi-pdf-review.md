# Additional PDF structure review — November 14, 2026

**Follow-up:** The sidebar and class failures recorded below are resolved in the
[subsequent fixes and regression report](sidebar-class-fixes.md). This document
preserves the original review findings.

Reviewed four contrasting local PDFs from `Documents/DnD/books and docs` using
the production PDF reader, parsers, source validation, and XML generator.
Compared extracted data with rendered source pages. Page numbers below are PDF
page numbers, including cover and front matter.

| Source and selected pages | Structure | Result after fixes |
| --- | --- | --- |
| Elemental Evil Players Companion.pdf, 15–16; continuation 17 | Two columns, spaced metadata labels, wrapped reaction trigger, descriptions across columns and pages | **Definition checks pass: 9/9 spells**, zero source findings. Initially 8/9, with a truncated reaction trigger and continued description. |
| Mordenkainens Tome of Marvelous Magic.pdf, 6–7 (printed 5–6) | Dense item catalogue, split decorative heading glyphs, wrapped attunement, handwritten sidebars | **20/20 named items recovered**, initially zero. Required metadata and sampled mechanics pass; the source gate **fails on three sidebar intrusions**. |
| UA_RevisedRanger.pdf, 2–4; continuation 5 | Full-width 20-level progression table and older class-feature headings | **Fails: zero classes extracted**. The expected Ranger is missing. |
| Complete Witch.pdf, 4–6; continuation 7 | Homebrew class progression table, multiple columns, sidebar and illustration | **Fails: zero classes extracted**. The expected Witch is missing. |

## Scope of the passing spell sample

The nine definitions include the previously missed Create Bonfire. Absorb
Elements retains its complete reaction trigger; Control Winds retains its
continued opening and all three named effects. The gate checks all nine names,
selected field values, and required mechanics phrases. It is not a word-for-word
rules certification.

Class spell-list pages are outside this selected section. The nine extracted
spell `classes` arrays remain empty, so this result does **not** establish a
complete Aurora conversion with correct class availability. Those associations
still need manual input or a separate class-list accuracy pass.

## Fixes and regression coverage

- Accept spaces before spell field colons and preserve wrapped casting-time and
  range values.
- Strip non-printing encoding artifacts so corrupted numeric footers are removed.
- Recover a partially captured spell from the immediate continuation page,
  including an opening mid-sentence, without importing the next spell.
- Recognize item fragments longer than 120 lines without a section heading,
  wrapped attunement metadata, and the observed split `L`/`LL` heading glyphs.
  The letter repair uses a narrow word list and preserves ambiguous names such
  as `Ring L`.
- Preserve attunement conditions such as caster-class restrictions as description
  text, alongside the attunement flag. These conditions are not automated.
- Prefer matching definition headings even when decorative fonts split letters
  with spaces, improving page references in source reports.
- Add source expectations for exact metadata values and known unwanted text.
  Missing entities and sidebar contamination remain failures rather than being
  accepted as successful empty or partial imports.

Four synthetic parser regressions reproduced the new extraction bugs before
the fixes. A source-validation regression covers metadata values (including
zero and false) and sidebar rejection. The manifest contains short expectation
phrases; full extracted source text and page images are not committed.

## Remaining work

The catalogue still mixes handwritten comments into **Anklet of Hobbling**,
**Bag of Flame**, and **Bell of Freedom**. All three are explicitly rejected by
the audit. Automatic removal needs layout or text-style information: deleting
unfamiliar prose could also delete actual rules. Review these descriptions
manually before export.

Both class samples need broader support for older/homebrew class headings,
unlevelled features, and full-width progression tables. The Witch sidebar page
also falls back to a single column and interleaves prose. Earlier screening of
the Elemental Evil race pages showed similar column-order trouble; that material
is outside the passing spell sample. These are larger layout/class-parser gaps,
not formats this review establishes as supported.

Prioritize preserving columns around full-width tables and sidebars, then class
feature/progression extraction. Use these deliberately failing audits to measure
that work before treating either class as importable.

## Validation and reproduction

- Automated suite: **150 tests passed in 14 files**.
- Existing focused Fizban source gate: **7/7 spells, zero findings**.
- Elemental Evil gate: **9/9 spells, zero findings**.
- Catalogue gate: **three errors**, all known sidebar contamination.
- Each class gate: **two errors**, minimum count and named class missing.
- Generated spell and item XML: **two files checked, zero structural errors or
  warnings**. Valid XML does not resolve the source-content gaps listed above.

The reusable manifest is
[`tests/fixtures/complex-pdf-audits.json`](../../../tests/fixtures/complex-pdf-audits.json).
For example:

```powershell
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Elemental Evil - spell definitions"
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Marvelous Magic - item catalogue"
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Revised Ranger - class and progression table"
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Complete Witch - class with sidebar"
```

The last three commands intentionally exit unsuccessfully while these gaps
remain. They require the user's local PDFs and do not run in CI. The synthetic
regressions run with `npm test`. See the
[fixture guide](../../../tests/fixtures/README.md) for the expectation format.

This was source extraction and XML review, not another Aurora runtime or browser
test. Source PDFs were read without modification.

Removed temporary extracted text, rendered pages, generated XML, audit outputs,
and inspection helpers after verification. No PDF rendering or capture helpers
remain running.
