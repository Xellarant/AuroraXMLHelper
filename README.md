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
| Classes | Class traits, hit die, proficiencies, class features, spellcasting metadata, and subclass selection |

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
elements over guessed content.

### 4. Review and edit

Extracted elements appear in tabs. Expand each entry to review and edit fields.
Validation warnings are shown before download when required Aurora fields or
shape rules are missing.

### 5. Download

- **Download ZIP** creates one XML file per element type plus `source.xml`.
- **Single XML** creates one combined XML file for quick testing.

If incomplete elements were skipped, the ZIP includes `skipped-elements.txt`.

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
  manual page ranges or hand cleanup.
- Rules are generated conservatively. Some mechanics may require manual Aurora
  rule edits after import.
- Spell list tables are not treated as full spell definitions unless complete
  spell blocks are present.

---

Good luck and happy dungeoning.
