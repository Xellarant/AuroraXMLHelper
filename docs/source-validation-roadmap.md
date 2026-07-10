# Source Validation Roadmap

## Goal

Improve Aurora XML Helper so source interpretation and Aurora XML generation are validated against the right standard:

> Not merely well-formed XML, but source-faithful content, Aurora-compatible element shape, and first-party-like rendering behavior.

Use Eberron: Forge of the Artificer as the first golden corpus because it exposed several real failure modes: missing source text, duplicated selects, incorrect class shape, weak picker descriptions, source duplication, overly specific supports, and Aurora runtime/load issues.

## Golden Fixture

The Eberron: Forge of the Artificer fixture should include or reference:

- canonical markdown extraction
- OCR/page text output, when available
- mirror-derived structured data, when available
- current Aurora XML files
- comparable first-party XML files

The fixture should be runnable from one command and should produce every report needed to understand whether the source passed.

## Second Golden Corpus: Fizban Spells

Fizban's Treasury of Dragons is the second, deliberately narrow golden corpus. Its current scope is spell parsing only:

- physical PDF pages `21-23`
- exactly seven expected spells: Ashardalon's Stride, Draconic Transformation, Fizban's Platinum Shield, Nathair's Mischief, Raulothim's Psychic Lance, Rime's Binding Ice, and Summon Draconic Spirit
- `WOTC_FTOD`, Wizards of the Coast, 2021 metadata
- strict corpus thresholds: seven extracted, seven matched, 100% exact shape matches, and zero unmatched/different/high-severity elements

The fixture remains disabled in the committed local-corpus example until a developer explicitly opts into its local paths. It does not establish coverage for Fizban races, feats, subclasses, magic items, or any other section.

When a selected range ends at an entity header, the runner may read the immediately following page as bounded continuation context. The selected range still determines source coverage and report page counts; continuation pages are disclosed separately and cannot introduce new in-scope entities.

## Normalized Source Model

Before generating XML, parse source material into structured JSON/entities. The model should preserve the source's own content and capture enough context to explain every generated rule:

- sources
- classes and subclasses
- species/races
- feats
- backgrounds
- spells
- items and magic items
- vehicles
- monsters and NPCs
- supports, selects, descriptions, and source-rule snippets

Description prose is part of the source model. Parser guards should reject prose fragments only when they are being mistaken for element titles or section starts. Once an entity boundary is established, its descriptive body text should be preserved unless a later validation gate identifies a specific OCR or source-boundary defect.

## Source Interpretation Gate

Validate source interpretation before XML generation. These checks should report source-model findings, not XML findings:

- expected entities are present for the source
- full descriptions are captured
- tables are captured with headers, rows, and footnotes
- referenced feature descriptions are expanded where useful for pickers
- no obvious OCR artifacts or tag artifacts remain in names, descriptions, or rules
- no unexplained omissions exist compared to mirror data, OCR text, markdown extraction, or expected source sections

## Aurora Shape Gate

Validate Aurora XML after generation. These checks should report Aurora-structure findings:

- XML is well formed
- required element attributes and properties are present
- required class fields such as hit die are present
- multiclass rules use valid Aurora shape
- a single element does not duplicate equivalent selects
- source elements are centralized instead of duplicated across generated files
- select lists exist for sizes, subclasses, and options that Aurora expects users to choose
- supports are broad enough to be useful without being unnecessarily book-specific
- descriptions are present where Aurora or Aurora MAUI displays picker text

Do not solve XML interpretation problems with MAUI-specific logic unless legacy Aurora behavior truly cannot be represented in XML. The default fix should be generated XML that behaves like first-party Aurora content.

## First-Party Comparison Gate

Compare generated XML against similar first-party files:

- class XML against PHB or 2024 PHB class files
- subclass XML against official subclass files
- species/race XML against official species/race files
- feat XML against official feat files
- item and magic item XML against official item files
- vehicle, monster, and stat block XML against official examples

Structural differences should be fixed or explicitly accepted. Notes and accepted differences should be reviewable, not silent.

## Display-Readiness Gate

Generated content should behave well in Aurora's UI:

- picker/select descriptions are useful, not placeholder-level text
- option names are concise but distinguishable
- descriptions explain the rule the XML is trying to express
- source-rule XML comments exist next to inferred rules where they help a human reviewer
- comments do not contain placeholder IDs or text that validation tools can mistake for unresolved references

## Finding Categories

Reports should categorize differences so a reviewer can act on them:

- error: likely breaks Aurora loading or behavior
- warning: likely display, fidelity, or source-coverage issue
- review: intentional difference or ambiguous source interpretation requiring human judgment

## Verification Gates

A source should not be considered complete until all gates pass:

1. Canonical source coverage gate: all expected source entities are present, and known source sections are accounted for.
2. Aurora shape gate: XML passes Aurora-specific structural validation, not just XML parsing.
3. First-party comparison gate: structural differences from official XML are either fixed or explicitly accepted.
4. Display-readiness gate: picker/select descriptions are useful and not truncated to placeholder-level text.
5. Regression gate: EFA remains green after changes to parsers, validators, or generators.

## First Milestone Definition Of Done

The first milestone is complete when Aurora XML Helper can run one command against the EFA fixture and produce:

- normalized source model
- generated or validated Aurora XML
- source coverage report
- Aurora shape report
- first-party comparison report
- clear pass/fail summary

The bar is not no warnings. The bar is that every warning is actionable, explainable, and categorized correctly.
