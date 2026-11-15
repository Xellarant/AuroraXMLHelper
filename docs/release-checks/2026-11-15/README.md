# 1.0 release acceptance — November 15, 2026

Stable release: **[1.0.0](https://github.com/Xellarant/AuroraXMLHelper/releases/tag/v1.0.0)**,
promoted from **1.0.0-rc.1**. The original candidate tag is retained. Changes were
merged through [PR #3](https://github.com/Xellarant/AuroraXMLHelper/pull/3).
The merged application at `5a643cb` passed [post-merge tests](https://github.com/Xellarant/AuroraXMLHelper/actions/runs/43706422748)
and [automatically triggered live verification](https://github.com/Xellarant/AuroraXMLHelper/actions/runs/43706470600)
in Chromium and Firefox, with all 20 deployed files matching. Stable promotion
changes version labels and documentation; the application behavior is unchanged.

| Check | Result |
| --- | --- |
| Dependency security | Compatible updates installed; npm audit reports zero known vulnerabilities, including development dependencies. |
| Automated regression suite | 365 tests pass across 29 files. New coverage checks nested correction merging, the actual Node minimum versions, split spell metadata, shared spell-list evidence and its boundaries, and learned versus whole-list spellcasting. |
| Remembered corrections | Individual named feature/option edits and level-keyed row edits preserve fresh prose, new siblings, and source references. Renamed, ambiguous, structurally changed, and older broad corrections are held for review. Regression coverage includes persistence, safe display, forgetting, and restoring the fresh baseline. |
| Chromium and Firefox | Both engines passed candidate and post-merge tests, and automated verification of the deployed app. See the linked post-merge runs above and the [candidate checks](https://github.com/Xellarant/AuroraXMLHelper/pull/3/checks). No local Chrome session was started. |
| Large PDF | The 129,592,597-byte, 161-page local Sword Coast source exposed split metadata that initially yielded zero spells. After the bounded OCR and shared-introduction fixes it yields four spells, all with base class lists, and shape-valid XML. Observed run: 3.71 seconds reading, 8.22 seconds overall, 475 MiB peak process memory. These are local observations, not performance guarantees. |
| Browser PDF/export workflow | A 250-page synthetic fixture has availability evidence on page 1 and its expected spell on page 250. Both engines passed extraction, recovery, and clean and warning-confirmed exports. On [run 43700048628](https://github.com/Xellarant/AuroraXMLHelper/actions/runs/43700048628), extraction took 1.49 seconds in Chromium and 2.55 seconds in Firefox. The generated files were approximately 294 KB; the separate private PDF supplied the large-byte-size check. |
| Aurora class acceptance | Passed in Aurora 1.0.3 / assembly 1.0.166.7407. The synthetic Mistkeeper was advanced from level 1 to 20, saved, and reopened after a full app restart. Detailed outcomes follow. |

## Aurora outcomes and fixes

| Level/check | Observed result |
| --- | --- |
| 1 | Class, one curse picker, and two hex pickers work. Selecting Ember grants Produce Flame. Already selected hexes disappear from other pickers. Mist Anchor is unavailable without Familiar. |
| 2 | Familiar grants Find Familiar and first-level slots increase from two to three. |
| 4 | Two additional cantrip pickers appear. Both ability-improvement picks can select Charisma, increasing it by two. |
| 5 | The additional hex picker offers Mist Anchor after its Familiar prerequisite is met. Two additional spell pickers appear, with correct spell-level and duplicate filtering. |
| 11, 13, 15, 18 | Each level adds one Grand Hex picker. Four different options were selected, with already selected options excluded from later pickers. |
| 20 | Spell slots are `4/3/3/3/3/2/2/1/1`. Save data contains ten ability-improvement picks at levels 4, 8, 12, 16, and 19, four cantrip picks, and four learned-spell picks. |
| Full restart | All three selected hexes, four Grand Hexes, the selected cantrips and leveled spells, Produce Flame, Find Familiar, and level-20 slots survive reopening. |

Aurora exposed an unconditional `known="true"` class-list attribute: a class that
learned individual spells displayed its entire catalogue before choosing them.
Generation now grants the whole catalogue only when explicit preparation wording
supports it; known-spell classes, spellbooks, ambiguous wording, and conditional
statements do not receive that grant. Generated casters also receive Aurora's
spellcasting marker for prerequisite checks. Regression tests cover both changes.

This was a focused class acceptance character. Unrelated background/equipment
setup and unused spell/ability choices were intentionally left unfilled. The
check does not certify every build, multiclass combination, or game mechanic.

Evidence: [level-4 ability improvement](aurora-level-4-abilities.png),
[level-5 choices](aurora-level-5-choices.png),
[level-20 choices after reopening](aurora-level-20-choices.png), and
[level-20 spellcasting after reopening](aurora-level-20-spells-reopened.png).

## Compatibility and remaining limits

The browser check uses Playwright 1.57's Chromium and Firefox on Ubuntu 24.04.
Desktop acceptance uses the Windows Aurora build named above. Safari, mobile
browsers, other Aurora builds, and very large sources beyond the measured file
have not received this acceptance pass.

Damaged prose still needs review. The private source's split spell metadata and
explicit shared cantrip list statement are now recognized; other broken words
are not silently rewritten. Shared cantrip evidence is limited to an explicit,
matching class heading and list statement across two adjacent physical pages.
Longer or unfamiliar scopes remain for manual review.

Companion statistics, activated or situational effects, unfamiliar resources and
prerequisites, and damaged numeric tables retain their documented manual-review
requirements. Shape validation cannot certify game-rule accuracy.

Aurora's own news endpoint returned HTTP 406, and its normal startup reported a
pre-existing Hero character display-properties error. Neither prevented the
isolated test. Existing character files were not opened for editing or repaired.

## Cleanup

The disposable Aurora session and the capture helper started for these checks
were stopped and their process IDs verified absent. The two settings files were
restored and compared with their backups. All 1,291 backed-up cache files match
their saved hashes, with no extra files in the normal index-cache folder.
The isolated content folder, test character, backups, inspection scripts, and
other disposable intermediates were removed after restoration was verified.
Only the synthetic fixtures and evidence images are retained for reproduction.

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

All acceptance rows above have observed outcomes. The stable release notes retain
the remaining limitations. Future releases should complete the relevant acceptance
checks before publishing a stable tag.
