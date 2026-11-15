# Release notes

## 1.0.0-rc.1 — 2026-11-15

Release candidate for the assisted PDF-to-Aurora authoring workflow. The stable
1.0 tag follows completion of the acceptance checklist and review of the candidate.

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
