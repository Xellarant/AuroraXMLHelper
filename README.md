# Aurora XML Helper

A browser-based tool for converting text/OCR D&D supplement PDFs into
Aurora Builder-compatible XML files.

The helper now uses deterministic, local parsing rules instead of sending the
PDF to an AI model. It reads selectable PDF text in the browser, extracts
high-confidence D&D element blocks, lets you review/edit the results, and then
exports Aurora XML.

**Live app:** https://xellarant.github.io/AuroraXMLHelper/

---

## Prerequisites

- A text-based or OCR-processed PDF.
- A modern browser.

No API key is required for the deterministic parser.

---

## Supported deterministic element types

| Type | Notes |
|------|-------|
| Spells | Full spell blocks with school/level, casting time, range, components, duration, and description |
| Subclasses | Generates parent `Archetype` elements plus `Archetype Feature` children |
| Items / Equipment | Equipment rows with cost and weight |
| Feats | DDB-style and bullet/list style feat blocks, including prerequisites and benefits |
| Magic Items | Rarity lines, attunement, charges, recharge, and descriptions |
| Races | Core race fields, traits, language grants, and language choices |
| Backgrounds | Skill/tool/language/equipment fields and background features |
| Classes | Class traits, progression, spell and cantrip gains, repeated improvements, subclass selection, and source option pickers |

The generic "Other" parser is disabled for now. Each supported type has its own
deterministic parser and Aurora XML generator.

---

## How to use it

### 1. Upload your PDF

Drag and drop or browse for a supplement PDF. The app reads selectable text
locally in your browser. OCR quality matters: if the OCR says `Bare Smit`, the
app can correct a few known cases, but you should still review names and rules.

### 2. Choose element types

Select the element types you want to parse. You can optionally enter a page range
such as `24-32` to focus extraction on a known section.

### 3. Parse

Click **Parse PDF**. The parser scans the selected pages with repeatable layout
rules. It is intentionally conservative: it prefers fewer high-confidence
elements over guessed content. You can cancel an active parse. Replacement parsing
asks before replacing existing entries; failure or an empty result keeps the prior
workspace and its source details.

### 4. Review and edit

Extracted elements appear in tabs. Expand each entry to review and edit fields.
Each parsed entry and named feature includes an **Original source reference**
with the PDF filename, physical page number, extracted line, and a short text
excerpt. Page numbers include covers and front matter. The review screen also
shows the selected pages and any additional continuation pages read for context.
Pasted sections use text line references; manually added or older entries may
have no reference. If a heading cannot be located, the app asks you to check it
instead of assigning a guessed page.

**Unresolved items** lists all known missing fields, suspicious OCR text, empty
selected sections, skipped entries, and XML shape findings. Use **Go to field**
to open and focus the relevant editor. The list updates as you edit, and each
entry shows its remaining count. **Restore entry** brings an incomplete skipped
record back for editing. **Add missing feature** creates a blank description
linked to the class progression table; it stays unresolved until you supply the
rule. Missing spell lists should be checked against the book's class spell-list
pages. Validation warnings are also shown before download.

These checks identify known gaps; an empty list does not certify complete source
coverage or correct rules automation. Compare the original source and test the
intended behavior in Aurora before relying on an export.

Edits are one-off by default and affect only the current export. Use
**Remember Correction** on an edited element when you want that correction to be
applied automatically the next time the same generated element appears. Use
**Forget** to stop reusing a remembered correction without reverting the current
edit. Remembered corrections reuse content while preserving the newly parsed
source references, so a previous page number or manual source check is not
carried into a different extraction. New corrections match individual features and options by name, and progression
rows by level, while keeping fresh unedited prose, new siblings, and source references.
Ambiguous matches, changed text lists, and older whole-entry corrections are held
for review instead of replacing fresh content. Expand **Review saved correction**
to compare saved values, reapply only the intended edits, and choose **Remember
Correction** again. **Forget** discards the saved correction; **Revert to Generated**
restores this parse's original result.

Removed entries and nested features, traits, benefits, choices, and options offer
**Undo removal** for the last removal in the open workspace.

You can also click **Manual Author** to start without a parsed PDF result, add a
blank element for any supported type, or paste a missed section into the review
screen. Pasted text is first sent through the deterministic parser for the
selected type; if it does not match a known layout, the app creates an editable
seed record instead of dropping the text.

The **Create & Author** workspace includes built-in spell XML starters for
2020–21 and 2024 shape conventions, plus feat, adventuring gear, melee and ranged
weapon, armor, shield, and magic item starters based on reviewed Aurora XML
examples. Weapon, armor, and shield starters follow classic PHB XML shapes; the
weapon starters do not include 2024 mastery rules. All sample text is synthetic
and no reference files need to be uploaded. Edit, check, copy, or download the
XML in the workspace. Shape checks do not validate game mechanics or whether
edition-specific supports, prerequisites, categories, and rules are appropriate.
The rule picker inserts AC bonuses, increases an existing normal or innate fly
speed, grants a fly speed, and adds skill modifiers or ability score increases
to the selected element’s `<rules>` block, creating one when needed. It can also
grant an existing spell element by ID or add a limited-use
sheet action with action and recharge metadata. Sheet action text is descriptive;
add separate rules for mechanics Aurora should calculate. To list a granted spell
on Aurora's Magic page, use the exact name of an existing spellcasting feature,
such as Wizard or Eldritch Knight. The grant does not create that feature. In files with multiple
elements, place the cursor inside the target element first. Expand self-closing
element tags into opening and closing tags before inserting content. Adding a sheet action
to a hidden sheet makes the entire sheet visible, including any existing entries.

The element detail picker adapts to the selected starter: spell lists and spell
setters, feat supports and prerequisite text, or common gear, weapon, armor, and
magic item setters. It replaces an existing value with the same property name.
Feat prerequisite text is for display and does not create a dynamic requirement.
Leave optional Feat supports or prerequisite values blank to clear them.

### 5. Download

- **Download ZIP** creates one XML file per element type plus `source.xml`.
- **Single XML** creates one combined XML file for quick testing.

If incomplete elements were skipped, the ZIP includes `skipped-elements.txt`.
Known review findings accompany exports in `unresolved-items.txt` inside the ZIP
or a comment in Single XML. Previewing XML keeps the pending-edit indicator;
edits made during ZIP creation remain marked as pending.

### Spell availability

When parsing spells, the app checks the PDF for class spell lists and granting
features, including pages outside your selected range. The selected range still
controls which spell definitions are extracted. Additional pages used as
availability evidence are listed separately in review and source reports.

The **Classes** field contains base spell lists. **Spell availability** shows the
evidence for each assignment and keeps subclass, feat, background, and racial
access separate. Conditional entries retain their owner, source, grant text,
choice requirements, and any readable acquisition level or spell-table level.
Those two kinds of level are kept distinct. Named grants, expanded lists,
prepared spells, and choices from a specified class list are supported; an
incidental class or spell mention does not establish availability.

Review each conditional entry against its granting feature. An unreadable table
level stays unresolved and has a field where you can enter the source's value.
If the source intentionally provides conditional access only, you can confirm
that explicitly instead of assigning an invented base class. Review decisions
and level corrections survive draft recovery. A new extraction requires a fresh
review; remembered level corrections retain the new source reference.

Base classes become Aurora spell supports. Conditional access is included as
reference text in the spell description and requires the owning feature's grant,
spellcasting extension, or choice rules. A review acknowledgement does not create
those rules or grant a spell to a whole class. Class choices can now generate
owning option elements and a limited set of source-supported spell grants.

Availability is established from the current source, rather than a universal
database across books or editions. Unrecognized layouts, missing lists, conflicting
metadata, and unclear conditions still need review.

### Class progression and choices

Expand **Class progression** to review or repair the level table. The editor
accepts pipe-separated tables with Level and Features headers. It preserves
unreadable values for review, flags missing or duplicate levels and decreasing
counts, and retains unfamiliar columns without claiming to automate them.
Click **Apply progression table** after editing; unapplied text stays in your
draft and appears in unresolved items.

A named feature is granted once at its first level. Repeated ability score
improvements and other choices have their own schedules. Spell slots, known
spells, prepared counts, cantrips, hexes, and Artificer plan counts use positive
progression differences. Cantrip pickers retain both the acquisition level and
the number gained. Proficiency bonus is left to Aurora's class system.

**Class choices** shows the parent feature, choice type, level:count schedule,
options, prerequisites, and source references. Supported source patterns include
fighting styles, favored enemies and languages, inline curse options, hex and
grand hex catalogues, and Artificer plan tables. Option catalogues can be read
outside the selected pages; those additional pages are disclosed in the editor.
They do not add other base features or subclasses to the selection.

Use **Add choice**, **Add option**, or **Import or repair options from source
text** for missed sections. Unknown prerequisites, incomplete catalogues, empty
pickers, and insufficient eligible options stay unresolved. Ambiguous options
are withheld. Choices are scoped to their class and source. Optional 2014 feats
retain Aurora's optional-feats requirement; source-defined 2024 feat choices
retain their actual levels.

Option descriptions stay on the character sheet. Exact supported rules such as
Archery, Defense, resolved cantrip grants, Find Familiar, and conditional bonus
spell choices are generated where recognized. Situational effects, special
companion statistics, cross-class fighting-style duplication, and unfamiliar
resources still need review. Subclass and spell definitions must be installed
with compatible supports in Aurora. Learning an Artificer plan does not create
or equip an item. Known-spell replacement uses Aurora's spellcasting replacement
support; hex and plan replacement instructions remain explicit, with no extra
selections granted.

Progression repairs, option edits, prerequisites, and schedules survive draft
recovery. Remembered corrections retain the new extraction's option references.
The [accuracy report](docs/accuracy-checks/2026-11-14/class-progression.md)
records the existing-PDF checks and remaining source limitations.

### Draft recovery

The app saves a working draft in this browser after a short pause in editing and
when you leave the page. Returning or refreshing restores source details, parsed
elements and their edits, pasted source text, authoring XML, the active workspace,
and loaded repair files. Recovered repairs retain their original XML and last
undo; diagnostics are recalculated when restored.

Use **Export draft** for a separate JSON backup, and **Import draft** to reopen
that backup in this or another browser. These drafts contain your workspace text,
including source references, short excerpts, and unresolved review context,
not the PDF file or provider credentials. To parse again after recovery, select
the PDF again. Remembered corrections remain separate browser preferences.

Autosave belongs to this browser profile and site address; clearing site data or
using another device will not carry it over. Storage failures leave the last
saved copy intact and show a warning so you can export the current work. If
another tab changes the saved draft, saving pauses until you explicitly choose
**Save this tab** or reopen the saved version. **Clear saved draft** removes the
saved copy while keeping your open work; the next edit saves a new draft.
**Start Over** clears the parsing workspace while retaining work in the authoring
and repair workspaces.

---

## Aurora XML validation

The app performs in-browser Aurora shape validation before preview/download.
The repository also includes a PowerShell validator for generated or hand-edited
Aurora XML repositories:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-AuroraXmlShape.ps1 -RootPath .
```

The validator checks XML parsing, root shape, `/elements/info/update`, required
element attributes, duplicate IDs, class hit-die setters, multiclass IDs, and
optional local/external ID references.

---

## Release and compatibility

The current development version is **1.0.0-rc.1**. See the
[release notes](CHANGELOG.md) and [release acceptance checklist](docs/release-checks/2026-11-15/README.md).
The stable 1.0 scope is an assisted PDF-to-Aurora authoring workflow: review the
source references and unresolved items before exporting. Readable text/OCR is
required; the app does not perform OCR. Custom resources, activated or situational
mechanics, companions, and unfamiliar choices can require manual implementation.

Browser automation covers Chromium and Firefox on the release workflows. Desktop
acceptance targets the installed Aurora 1.0.3 (assembly 1.0.166.7407); other builds
need their own acceptance check. Draft format version 1 remains supported. Export
a draft backup before an app update; remembered corrections remain browser-local
and are reviewed conservatively when their older format lacks edit history.

Report problems through this repository's GitHub Issues with the app version,
browser version, the action that failed, and a minimal synthetic example when
possible. Review draft backups before sharing them: they contain workspace text
and source excerpts.

## Development

Use Node.js **24 LTS** for development (the toolchain also accepts Node 20.19+
or 22.12+). Install locked dependencies with `npm ci` and check them with
`npm audit`. Both browser engines run in GitHub Actions; local interactive checks
can use the in-app browser.

The browser app is static, but PDF.js is loaded as a local module, so run it
through the tiny local server instead of opening `index.html` directly:

```powershell
npm run serve
```

Then open `http://127.0.0.1:4173/`.

`index.html` loads the application logic from `src/app.js` and browser bundles
from `vendor/`. Run `npm run vendor:browser` after changing browser dependency
versions.

Run parser and generator regression tests with:

```powershell
npm test
```

Tests run with Vitest and require Node 20.19+ or 22.12+. `npm test` uses
`scripts/run-vitest.js`, which prefers `AURORA_NODE`, then a local Node install
under `%LOCALAPPDATA%\Programs\nodejs-lts`, then `node` on `PATH`.

Run the browser smoke test with:

```powershell
npm run smoke:browser
```

The smoke test starts the local static server, opens Playwright Chromium by default, and
checks that the app and browser-only dependencies finish loading. It also tests
refresh recovery, the last field typed before refreshing, repair downloads and
undo, draft export/import, corrupt drafts, tab conflicts, and PDF-to-ZIP export.
The PDF case spans 250 pages and checks spell-list context from a distant page.
Set `AURORA_BROWSER=firefox` and install Firefox with `npx playwright install firefox`
to run the same checks in Firefox. CI runs both engines.
It uses isolated browser contexts and does not access your normal browser data
or start a desktop screen capture session. It prefers
Playwright's bundled Chromium headless shell when available, then falls back to
installed Google Chrome or Microsoft Edge. If you want the bundled shell, install
it with:

```powershell
npm run install:browser
```

If local security software blocks the Playwright browser cache or the bundled
shell install stalls, use an installed browser explicitly:

```powershell
$env:AURORA_BROWSER_CHANNEL="chrome"
npm run smoke:browser
```

### Automated release verification

The **Tests** workflow runs unit/regression tests and the headless browser checks
on pull requests and pushes to main. **Verify live release** runs after a
successful `pages-build-deployment` for the current main commit. It can also be
started manually from the Actions page on main. This follows GitHub's
[`workflow_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and preserves the existing branch-based Pages publishing setup.

The live verifier checks the home page, every local script it loads, and the
PDF worker against the checked-out commit. It retries for up to three minutes to
allow publishing caches to update, then runs the browser workflows on the live
URL. Mixed or stale files fail verification, even when the home page loads.
Text comparisons normalize UTF-8 byte-order marks and line endings so Windows
checkouts can be used too.
These are post-deployment checks; they report failures and do not roll back or
block the existing Pages deployment.

To check the release represented by your current checkout manually:

```powershell
$env:RELEASE_BASE_URL="https://xellarant.github.io/AuroraXMLHelper/"
npm run verify:release
```

Set `SMOKE_BASE_URL` to run only the browser checks against an existing site,
without starting a local server. Set `SMOKE_REPORT_DIR` to retain a JSON report
and screenshots; `verify:release` defaults to `artifacts/release`. GitHub Actions
retains browser results for seven days and release results for fourteen days.
The workflows must be merged into main before the automatic checks become active.

Run local corpus comparisons with:

```powershell
npm run corpus:local
```

`npm run corpus:local` uses the same local Node selection strategy and can read
text, Markdown, and selectable-text PDFs. Copy
`tests/fixtures/local-corpus.example.json` to
`tests/fixtures/local-corpus.json` for machine-local benchmark entries.

Run a source interpretation gate for a local fixture with:

```powershell
npm run source:fixture -- --manifest tests/fixtures/local-corpus.json --name "Eberron: Forge of the Artificer" --out-dir reports/efa
```

This writes `normalized-source.json`, `source-coverage-report.md`, and
`source-coverage-summary.json`. The source gate validates the parsed source
model before XML shape comparison, so parser/OCR omissions can be separated
from Aurora XML generation issues.

Build an observed Aurora XML pattern/repair report with:

```powershell
npm run patterns:xml -- --xml path\to\aurora\xml-or-folder
```

The pattern report summarizes the shapes found in existing Aurora XML: element
types, setter names, support tokens, rule kinds, grant types, select types, and
related counts. It also derives authoring profiles for each observed element
type, including required/common setters, support/category hints, rule-shape
hints, and example elements. Finally, it flags initial repair-oriented
diagnostics such as duplicate element IDs, missing element attributes, malformed
grant/select/stat rules, damage resistance encoded as `Condition Immunity`,
numeric spell-level support tokens, class elements without hit dice, and
ID-shaped placeholders in comments. Diagnostics include machine-readable repair
records (with exact source offsets) where the fix shape is known. This report is
the shared evidence layer for custom authoring and broken-XML repair assistance.

Pass `--reference src/aurora-reference-index.js` to also check content against
the bundled first-party reference index:

- unresolved `ID_*` references in grant ids and requirements, with
  same-name/different-source-prefix and close-spelling suggestions
- unknown grant/select types
- grant types that do not match the granted element
- near-miss stat and setter names
- setters that almost every first-party element of that type sets

`<info><n>` and a missing `<info><update>` are reported without the index.

### Reference index

`src/aurora-reference-index.js` is generated from a local first-party Aurora
content folder and contains structure only:

- element ids, types, and names
- ids built into the Aurora app (referenced by first-party content but never
  defined in XML)
- observed grant/select/stat/setter counts

It contains no descriptions or rules text. Rebuild it with:

```powershell
$custom = "$env:USERPROFILE/Documents/5e Character Builder/custom"
npm run reference:build -- --xml "$custom/core" --xml "$custom/supplements"
```

Add `--no-names` to drop element names if the file needs to be smaller.

### Lint & Repair workspace

The **Lint & Repair** tab runs the same diagnostics in the browser against
pasted XML or one or more uploaded files.

- Each repair that can be applied automatically has an **Apply** checkbox.
  High-confidence repairs are preselected.
- Repairs that need a value show an input, prefilled when there is a single
  candidate.
- **Apply Selected Repairs** edits only the targeted text and skips any target
  that changed since inspection. It then re-runs the diagnostics and shows what
  was resolved, what remains, and any new findings, plus a diff against the
  original.
- You can download or copy the fixed files, or undo all repairs.
- Applied repairs also update the XML input. After editing that input, inspect
  it again before applying further repairs.

---

## Installation into Aurora Builder

Extract the ZIP and copy the XML files into your Aurora custom content folder,
for example:

```text
%localappdata%\Aurora Legacy\custom\user\local
```

or for older builds:

```text
\5e Character Builder\custom\user\local
```

Load Aurora and the new source should appear under **Manage Content**. If it
does not, run the validator script against the generated folder and fix any
reported XML shape issues.

---

## Known limitations

- OCR quality still matters. Deterministic parsing cannot recover text the OCR
  never captured correctly.
- The parser targets common D&D/DDB-style layouts. Unusual page layouts may need
  manual page ranges or Manual Author cleanup.
- Older and homebrew class features can use captured progression tables for
  their levels. Table entries without feature descriptions need review, and
  class options or complex mechanics can still need manual Aurora rules.
- Recognized handwritten annotations are separated from rules. Unfamiliar
  sidebar styles can still need manual review. The
  [sidebar and class follow-up](docs/accuracy-checks/2026-11-14/sidebar-class-fixes.md)
  records the supported samples and remaining source limitations.
- Rules are generated conservatively. Some mechanics may require manual Aurora
  rule edits after import.
- Spell list tables are not treated as full spell definitions unless complete
  spell blocks are present.
- Named creature stat blocks can be retained as editable spell reference text
  when they precede the continued description in a selected or continuation
  column. Missing named blocks are flagged before export. This does not create
  an automated companion, and recovered statistics still need source review.

---

Good luck and happy dungeoning.


## Feature and workflow review

The [November 2026 audit](docs/accuracy-checks/2026-11-14/feature-flow-audit/README.md)
records the parsing, editing, authoring, repair, recovery, export, and code quality
fixes, their checks, and remaining limitations.
