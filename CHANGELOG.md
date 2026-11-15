# Release notes

## 1.0.0 — 2026-11-15

First stable release of the assisted PDF-to-Aurora authoring workflow. This
promotes the verified 1.0.0-rc.1 functionality, with updated version labels and
documentation.

### Included

- Local extraction of supported spells, subclasses, equipment, feats, magic
  items, races, backgrounds, and classes, with editable results and source references.
- Base spell lists and conditional access, recognized class progression, and
  source-backed choices. Unresolved items remain visible for review before export.
- XML authoring, validation, repair, comparison, and undo.
- Draft recovery and backups, conflicting-tab protection, and remembered
  corrections that preserve fresh source content or ask for review.
- OCR metadata and shared cantrip spell-list fixes, plus correct learned-spell
  behavior and spellcasting prerequisite recognition in Aurora.

### Upgrade and compatibility

- Use **Export draft** to keep a backup before updating or clearing browser data.
  Draft format version 1 remains supported. Drafts and remembered corrections
  remain local to each browser profile and site; older broad corrections may need
  review and resaving.
- Readable text or prior OCR is required. Review source wording and unresolved
  mechanics before using generated content in Aurora. XML shape validation checks
  structure and does not certify every game rule.
- Classic equipment starters omit 2024 weapon mastery. Companion statistics,
  activated or situational effects, unfamiliar resources and prerequisites, and
  damaged numeric tables can require manual work.
- Acceptance covers Chromium and Firefox, and Aurora 1.0.3 / assembly
  1.0.166.7407. Safari, mobile browsers, and other Aurora builds have not received
  this acceptance pass.

### Validation

The promoted candidate passed 365 regression tests, Chromium and Firefox browser
checks and automated live release verification, a 250-page PDF workflow, and a
129 MB / 161-page private source check. Aurora class progression and choices were
checked through level 20, including save/restart/reopen. See the
[acceptance report](docs/release-checks/2026-11-15/README.md) for evidence, measurements,
and reproduction steps.

## 1.0.0-rc.1 — 2026-11-15

Release candidate for the assisted PDF-to-Aurora authoring workflow, subsequently
promoted to 1.0.0 after completing acceptance and review.

- Parse supported spell, subclass, equipment, feat, magic-item, race, background,
  and class layouts locally. Review physical PDF page references, editable fields,
  skipped entries, and actionable unresolved items before export.
- Resolve base spell lists and conditional access separately; generate recognized
  class progression and source-backed choices without inventing unknown rules.
- Author XML from templates and inspect, repair, compare, and undo existing XML.
- Recover drafts, export/import backups, protect against failed replacements and
  conflicting tabs, and include unresolved-item reports with XML exports.
- Remember individual feature and option changes while preserving new source
  content. Hold ambiguous and older broad corrections for explicit review.
- Update vulnerable development/test dependencies. Add Firefox alongside Chromium
  to browser and live-release verification, including a 250-page PDF export case.
- Recover OCR-split cantrip headers, duration labels, duration values, and range
  units observed during the large-file acceptance check.
- Attach explicitly stated shared cantrip class lists to adjacent definitions,
  retaining their source references and stopping at unrelated sections.
- Keep learned-spell classes and spellbooks from automatically knowing their
  entire spell list. Grant Aurora's spellcasting feature marker so prerequisite
  checks recognize generated spellcasters.

### Compatibility and limits

- Draft format version 1 remains readable. Existing correction records remain
  stored; older full-entry or list corrections may need review and resaving.
- Back up a workspace with **Export draft** before updating or clearing browser
  data. Drafts and correction preferences are local to a browser profile and site.
- Readable text or prior OCR is required. Shape validation checks XML structure;
  compare source wording and intended behavior in Aurora for unsupported mechanics.
- Desktop acceptance uses Aurora 1.0.3 / assembly 1.0.166.7407 and the reproducible
  synthetic class fixtures. Other Aurora versions are not certified by that check.
- Classic equipment starters omit 2024 weapon mastery. Companion statistics,
  activated/situational effects, unfamiliar resources, and some prerequisites
  remain manual. Damaged numeric tables need a readable reference.

The [acceptance report](docs/release-checks/2026-11-15/README.md) records actual
results and any items still outstanding.
