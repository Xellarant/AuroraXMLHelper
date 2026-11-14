# Aurora runtime checks — November 14, 2026

All three cases passed in the installed **Aurora 1.0.3** desktop application
(assembly version 1.0.166.7407), after fixing two feat-generation defects.
These are actual character checks, separate from the automated browser and unit tests.

The checks used synthetic content generated through the production generator,
Manual Author spell-grant insertion, and XML repair functions. Aurora loaded a
temporary documents folder containing a copy of the installed core content and
the four fixture XML files. The disposable character was a level 8 Human Fighter
with the Eldritch Knight archetype and three feat selections.

| Case | Observed result | Evidence |
| --- | --- | --- |
| Generated feat | Selecting XML Helper Strength Check raised Strength from 11 to 12. Aurora attributed the extra point to the generated feat. | [Strength screenshot](strength.jpg) |
| Spell grant | XML Helper Spell Check granted XML Helper Beacon to the existing Eldritch Knight spellcasting feature. After saving, closing Aurora, and reloading the character with the scoped grant, the spell appeared on that feature's Magic tab. Its details showed 1 action, Touch, V/S, and 1 minute. | [Spell screenshot](spell-grant.jpg) |
| Repaired XML | The repair changed the fire-resistance grant from Condition Immunity to Condition and corrected the info name tag. Selecting XML Helper Repair Check displayed Resistance (Fire) in the character information pane. | [Resistance screenshot](fire-resistance.jpg) |

## Fixes found by these checks

- The ability-score parser consumed “Strength score” as the ability name and
  omitted the stat rule. It now recognizes the standard wording correctly.
- An inferred `requirements="strength:max20"` expression caused Aurora to crash
  when the feat was acquired. The generator now emits the plain stat rule used
  by first-party feats. The maximum remains in the description; this check does
  not establish automatic enforcement of that maximum.
- Spell-grant help now asks for the exact name of an existing spellcasting
  feature. An unscoped grant did not appear on the Magic page in this setup;
  entering `Eldritch Knight` made it appear. The grant itself does not create a
  spellcasting feature.

The automated regression covers all six ability names. The focused parser,
workspace, repair, and reference test run passed **87 tests in four files**:

```text
node scripts/run-vitest.js run tests/parser-regression.test.js tests/workspace-regressions.test.js tests/aurora-repair.test.js tests/aurora-reference.test.js
```

## Reproduce the fixtures

Run `node scripts/create-runtime-fixtures.js` from the repository root. It uses
the production functions to write the synthetic fixtures into
[`tests/fixtures/aurora-runtime`](../../../tests/fixtures/aurora-runtime).
Copy only the four `.xml` files into an isolated Aurora custom-content folder
alongside the required core content. `repair-input.txt` preserves the broken
input for comparing the repair output; it is not Aurora content.

On a test character, select the three XML Helper feats and an existing Eldritch
Knight spellcasting feature. Check Strength, the Magic > Eldritch Knight tab,
and the character's Conditions display. Save and reopen the character to check
that the grant remains available.

## Scope and cleanup

This verifies these three representative cases on the installed legacy Aurora
build. It does not establish compatibility with every Aurora version or every
generated rule. The original documents folder also produced an existing
Hero.dnd5e display-properties error during startup; that character was left
untouched and was not used for these checks.

The test Aurora processes were stopped. Original application settings and both
pre-existing cache files were restored and verified byte-for-byte against their
backups. The temporary documents folder, copied core content, disposable
character, backups, and setup/cleanup scripts were removed. Only reproducible
synthetic fixtures and these result screenshots were retained.
