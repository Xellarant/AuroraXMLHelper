# Aurora XML Helper

A browser-based tool for converting D&D supplement PDFs into Aurora Builder-compatible XML files. No installation required — just a Google Gemini API key and a PDF.

**Live app:** https://xellarant.github.io/AuroraXMLHelper/

---

## Prerequisites

- A free Google Gemini API key from [aistudio.google.com](https://aistudio.google.com)
- A PDF of the supplement you want to convert (OCR copies work best — scanned image-only PDFs may yield poor results)

---

## How to use it

### Step 1 — API key

Enter your Gemini key at the top of the page and click **Save Key**. The key is stored in your browser's `localStorage` and never sent anywhere other than Google's API directly. Use **Test Key** to verify it's working before you start.

### Step 2 — Upload your PDF

Drag and drop or browse for your supplement PDF. The app will immediately pre-fill the source name and abbreviation from the filename.

A note on file sizes:
- **Under 5 MB** — the full PDF is sent directly to Gemini for each extraction call.
- **5–30 MB** — the app reads the table of contents first to identify which pages contain which element types, then sends only the relevant pages per call. This significantly reduces token usage.
- **30+ MB** — same TOC-guided approach, but you may also want to use the **Manual Page Range Override** field (see below) to help the app focus on specific sections.

### Step 3 — Extraction options

**Source details** are auto-filled from the PDF on upload and refined during extraction (the app reads the cover page to find the proper title and author). You can override any of these fields manually.

**Element types** — check the types you want to extract:

| Type | Notes |
|------|-------|
| Spells | Fully supported, including technomagic keyword |
| Subclasses | Generates parent Archetype + individual Archetype Feature elements |
| Items / Equipment | Weapons, armor, tools, and gear |
| Feats | Includes rule inference for ability score increases and proficiency grants |
| Magic Items | Includes attunement, charges, and recharge |
| Other *(experimental)* | Attempts to extract anything else — races, classes, backgrounds, companions, languages, etc. Results use a generic XML template and are grouped into separate files by detected type |

**Manual Page Range Override** — if you know which pages a section occupies (e.g. `45-62`), entering it here skips the TOC detection step and tells Gemini exactly where to look. Useful for very large supplements or when the TOC detection misses a section. This field overrides TOC auto-detection entirely.

### Step 4 — Extract

Click **Extract from PDF**. The progress bar will walk through each selected type. For large files, you'll see a TOC read step first, followed by per-type extraction. If a type's response is too large for a single call, the app automatically retries in two alphabetic halves and merges the results.

**Completeness filtering** runs automatically after extraction. Any element that is missing more than 20% of its required fields (e.g. a spell with no casting time, school, or description) is quietly removed and logged. If anything was filtered, you'll see a note in the extraction summary and a `skipped-elements.txt` file will appear in your ZIP explaining what was dropped and why.

### Step 5 — Review and edit

Extracted elements appear in tabs, one per type. Each entry can be expanded to review and edit all fields individually. Changes are saved to memory immediately — a **changes pending** badge on the download buttons lets you know when the output is out of date relative to your edits.

Use the **search bar** at the top of each tab to filter by name or type.

For feats, use **+ Add Benefit** to manually add bullet points that Gemini may have missed. For subclasses, use **+ Add Feature** to add features that weren't captured.

**Pre-download validation** runs when you click either download button. It checks for blank names, invalid spell levels, archetypes with no features, duplicate IDs, and other issues. Problems are flagged with a red `!` badge on the affected card and listed in a summary. You'll be given the option to download anyway if you want to proceed despite warnings.

### Step 6 — Download

- **Download ZIP** — recommended. Produces a folder named after your source slug containing one XML file per element type (e.g. `mh-spells.xml`, `mh-archetypes.xml`) plus a `source.xml` index file. All filenames are prefixed with your source abbreviation to avoid collisions when you have multiple supplements installed.
- **Single XML** — all elements combined into one file, useful for quick testing.

Both options also include `skipped-elements.txt` in the ZIP if any elements were filtered.

---

## Installation into Aurora Builder

Extract the ZIP and copy the folder contents into:

```
%localappdata%\Aurora Legacy\custom\user\local
```

or for older builds:

```
\5e Character Builder\custom\user\local
```

Load Aurora and the new source should appear under **Manage Content**. If you don't see it, check that `source.xml` is present in the folder and that the file URLs are either blank or valid — Aurora will skip files it can't reach.

---

## Known limitations

- **Rate limits** — the free Gemini tier allows roughly 5 requests per minute and 20 per day. Extracting all five element types from a single supplement uses 5–7 calls (more if truncation retry kicks in). Space out sessions accordingly.
- **Incomplete elements** — if a supplement mentions a spell or item by name but doesn't include its full stat block, the app will flag it as incomplete and skip it. See `skipped-elements.txt` in the ZIP for the full list.
- **The "Other" extractor** is experimental. It will attempt to handle races, classes, backgrounds, and similar types, but the resulting XML uses a generic template. It will load in Aurora, but you may need to manually add rules, proficiency grants, and other mechanics that require type-specific handling.
- **Scanned PDFs** — Gemini can process these, but text quality depends heavily on the scan. OCR-processed PDFs yield significantly better results.
- **Very large supplements (80+ MB)** — the app will do its best with TOC-guided extraction, but some supplements may require manual page range splits across multiple extraction sessions.

---

## Roadmap

- **Ollama support** — the goal is to replace Gemini calls with a locally-run model, which would eliminate API keys, rate limits, and file size constraints entirely. The extraction architecture is already designed to swap backends cleanly.
- **Custom class and race generators** — dedicated XML generators for Class, Race, Background, and Companion types, replacing the current generic template.

---

Good luck and happy dungeoning.
