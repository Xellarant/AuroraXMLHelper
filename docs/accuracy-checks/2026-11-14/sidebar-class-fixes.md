# Sidebar and class extraction fixes — November 14, 2026

Follow-up to the [multi-PDF review](multi-pdf-review.md). Reused its original
four checks without weakening their expectations, and added two larger ranges
to cover the full base-class sections. Page numbers are PDF page numbers.

| Source / range | Result |
| --- | --- |
| Elemental Evil Players Companion.pdf, 15–16 | 9/9 spells; existing definition checks still pass. |
| Mordenkainens Tome of Marvelous Magic.pdf, 6–7 | 20/20 items; all three handwritten sidebar intrusions removed from rules text. Required mechanics and attunement conditions remain. |
| UA_RevisedRanger.pdf, 2–4 | Ranger extracted, 10 selected features, complete 20-row progression; the last feature's continuation is retained without importing the next feature. |
| Complete Witch.pdf, 4–6 | Witch extracted, two selected features and complete 20-row progression; the curse's remaining options continue on the next page. |
| UA_RevisedRanger.pdf, 2–5 | All 13 base-class feature descriptions captured, with levels, saves, proficiencies, skill choices, equipment, casting ability, and progression. Stops before Ranger Conclaves. |
| Complete Witch.pdf, 4–8 | All 11 standalone base-class feature descriptions captured, with class metadata and progression. Stops before the alphabetical hex catalogue. |

All six source checks pass with zero source-validation errors, warnings, or
review findings. The separate in-app class warning described below remains
intentional. This is extraction coverage, not certification of every automated
Aurora mechanic.

## What changed

The browser and CLI now share a PDF page reader that retains font and geometry
information. Recognized marginal handwriting is separated from rules text and
retained in layout references. Unknown alternate fonts and sources whose main
text uses script are preserved. An inset reference block in a contrasting font
is kept separate from the main column; class parsing places it in the class
overview. The Witch sidebar, including its short final line, no longer enters
Spellcasting or Witch's Curse. Main-column spell formulas using the same font
remain intact.

Wide progression tables are reconstructed from aligned cells before the prose
above and below them is read by column. Duplicate painted labels are collapsed.
Column detection uses the occupied text widths and tolerates uneven columns,
large centered chapter lettering, and small full-width citations. It preserves
ordinary single-column label/value rows and closely spaced inline fragments.

Older `Class Features / As a ...` introductions are recognized for arbitrary
class names. Their feature levels come from the progression table or explicit
level headings. Wrapped proficiency, skill, and equipment fields are preserved;
worded choice counts are recognized. Base-class parsing stops before another
class, subclasses, and alphabetical option catalogues. A continuation can finish
the last selected feature without expanding the selected feature scope.

Class tables retain known spells, cantrips, hex counts, and slots through ninth
level. Generated spell rules include known-spell choices and higher-level slots.
Ranger uses its own multiclass slot grant rather than Artificer's half-up rule.
Unknown homebrew multiclass rules are not inferred. Grants to uncaptured feature
elements are omitted and missing descriptions are called out in app review.

## Source limitations that still need review

The Witch table lists **Ability Score Improvement** at levels 4, 8, 12, 16, and
19, but the selected base-class section has no standalone description for it.
The progression is preserved. App review explicitly asks for the missing
description instead of silently exporting a grant to a nonexistent feature.
Add the intended rules in Manual Author before using that class. Custom hex,
familiar, curse, and subclass choices also still need ordinary rules review.

The Elemental Evil definition sample still excludes its class spell lists.
Class availability therefore remains outside that sample's passing scope.
Unrecognized typography and other source layouts can require manual review.

## Regression tests and verification

- **161 automated tests pass in 15 files.** Eleven new tests cover class
  extraction, XML, progression tables, column ordering, and sidebar separation.
- The class tests generate an original two-page PDF in a temporary folder and
  exercise the production PDF reader, parser, and XML generator. They also cover
  explicit feature levels without a table, partial selections, adjacent classes,
  subclass boundaries, and missing-description warnings.
- Typography tests retain ordinary alternate fonts, all-script sources, short
  sidebar endings, and main-column formulas. A centered-heading regression
  protects the earlier Fizban layout.
- All six local source checks pass. Additional assertions check 20 progression
  rows, Ranger's final spell counts/slots, Witch's hex counts/ninth-level slot,
  equipment continuation, and sidebar ownership.
- The existing Fizban pages 21–23 check still passes for all seven spells,
  including the referenced creature statistics recovered from continuation page
  24, with zero source findings.
- Generated XML from the four sources passes the Aurora shape validator:
  **four files checked, zero errors and warnings**.

No browser, external Chrome, desktop capture, or Aurora runtime session was
started for this work. The source PDFs were read without modification. The
regressions use synthetic text and standard fonts; the real books remain local.
Temporary extracted text, rendered pages, generated XML, reports, and inspection
scripts were removed after verification. No rendering or capture helpers remain.

## Reproduce

The [manifest](../../../tests/fixtures/complex-pdf-audits.json) retains the
original four entries and adds `Revised Ranger - complete base class` and
`Complete Witch - complete base class`. Run any exact entry name, for example:

```powershell
npm run source:fixture -- --manifest tests/fixtures/complex-pdf-audits.json --name "Complete Witch - complete base class"
npm test
```

See the [fixture guide](../../../tests/fixtures/README.md) for the original spell
check and local source paths.
