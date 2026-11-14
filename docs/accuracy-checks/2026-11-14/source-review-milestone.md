# Source review milestone

The parsing workspace now keeps physical PDF page and extracted-line references,
short excerpts, selected-page context, and continuation references alongside the
editable source model. Named class features and creature-statistics references
have their own locations. Pasted text has line references. Unlocated headings
remain explicitly unlocated, with a manual source-check action.

The Unresolved items list exposes all known findings, grouped by missing
information, source checks, selected sections, skipped entries, and XML checks.
Actions focus the relevant field, restore a skipped record, open a pasted-section
editor, or seed a missing class feature from its progression table. Creating a
feature does not supply its rules or resolve its blank description.

Source references survive working-draft recovery and draft export/import. They
do not change generated Aurora XML. Remembered content corrections retain the
current extraction's references rather than reusing an earlier page or source
acknowledgement. Shared OCR checks are used by both the app and source reports.

## Existing PDF checks

These are physical PDF pages, including front matter. All source files stayed in
the user's local library; no PDFs or extracted book text were added to the repo.
The six existing strict source checks continue to pass. Their configured coverage
requirements are separate from the more actionable app findings below.

| Local source | Selected pages | Result and unresolved work |
| --- | --- | --- |
| Elemental Evil Player's Companion | 15–16 | Nine spells have definition references on pages 15–16, rather than references to a spell-list heading. All nine correctly warn that spell lists are unassigned; the class-list pages are outside this selection. |
| Mordenkainen's Tome of Marvelous Magic | 6–7 | Twenty items have heading references on pages 6–7. No app findings in this range; previously fixed handwritten sidebars remain excluded. |
| Unearthed Arcana: Revised Ranger | 2–4 | One class, ten selected features, and twenty progression rows. Three missing descriptions remain explicit: Vanish, Feral Senses, and Foe Slayer. Their progression references point to page 2. |
| Complete Witch | 4–6 | One class, two selected features, and twenty progression rows. Ten progression features lack captured descriptions; their table references point to page 5. |
| Unearthed Arcana: Revised Ranger | 2–5 | All thirteen base-class features have references; twenty progression rows; no app findings. |
| Complete Witch | 4–8 | Eleven standalone features have references; twenty progression rows. Ability Score Improvement is listed in the table on page 5 but has no standalone description in this selection. It stays unresolved. |
| Fizban's Treasury of Dragons | 21–23 | Seven spell definitions have references on pages 21–23. Summon Draconic Spirit also links its creature statistics on continuation page 24. No app findings in this range. |

All root entries and captured named class features in these checks resolved to
source locations. Four generated XML exports (spells, magic items, and the two
expanded base classes) passed the PowerShell shape validator with zero errors or
warnings. Shape success does not remove the source omissions described above.

## Browser checks

Used only the in-app browser against a temporary local server:

- Uploaded the actual Elemental Evil PDF, selected pages 15–16 and spells, and
  verified nine unresolved spell-list findings with page references.
- Followed the Absorb Elements warning and verified that it focused the classes
  field. Expanded its source reference and confirmed the filename, page 15,
  line 17, and definition excerpt.
- Entered a temporary spell-list value: the count changed from nine to eight
  without rebuilding the editor. Reloaded and confirmed that the edit, source
  reference, selection, and unresolved count recovered.
- Uploaded Complete Witch and selected pages 4–8. The remaining table-feature
  warning linked to page 5. Add missing feature created Ability Score Improvement
  at level 4, focused its blank description, and retained the unresolved finding.
- Found and fixed an existing author-detection bug: a wrapped sentence beginning
  with “by” was treated as an author credit. Detection now requires a standalone,
  name-shaped byline and preserves user-supplied credits.

Temporary test entries were discarded after verification; no remembered content
corrections were created.

## Regression coverage

`tests/source-review.test.js` adds thirteen tests covering heading disambiguation,
page boundaries, split heading glyphs, class introductions and progression rows,
nested features, continuation statistics, unlocated headings, safe excerpt
rendering, pasted lines, all findings beyond the old eight-item cutoff, field
navigation, live correction, skipped entries, missing-feature seeds, metadata,
remembered-correction provenance, compatible draft recovery, empty selections,
and unchanged XML output.

The full suite passed: **179 tests in 17 files**.

The browser release check now verifies PDF references, warning navigation and
correction, and recovery of the source plus edit before downloading the ZIP.
Those browser assertions run in CI; local UI verification used the in-app browser.

## Remaining limits

References identify matching source headings and short context; they are not a
proof that every rule was captured or automated. Source-specific omissions,
unrecognized sections, missing external rules, and ambiguous OCR still need human
review. No source rule was invented to clear a warning. The wider source-validation
roadmap and its Eberron corpus completion criteria remain separate work.
