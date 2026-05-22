# Parser Generation Notes

## Eberron: Forge of the Artificer review

Use these rules when tightening deterministic Aurora XML generation:

- When a source declares a 2024 Player's Handbook dependency, prefer `ID_WOTC_PHB24_*` spell and feat IDs over legacy `ID_PHB_*` IDs. Include renamed spell mappings such as Branding Smite to Shining Smite, and verify edge cases such as Melf's Acid Arrow.
- Background ability score increases should use `Ability Score Improvement` combination grants and also grant `ID_INTERNAL_GRANTS_BACKGROUND_ASI`, matching the 2024 core background pattern.
- Damage resistances should be emitted as `grant type="Condition"` entries, not `Condition Immunity`.
- When Aurora stat expressions do not support multiplication cleanly, emit repeated stat entries for level-scaled totals, such as five `level:artificer` entries for five times Artificer level.
- Companion stat blocks should be represented as real `Companion` elements with `traits`, `actions`, and `reactions` setters, plus child `Companion Trait`, `Companion Action`, and `Companion Reaction` elements.
- Spell `<supports>` values should stay focused on class/tags. Spell level belongs in setters/rules, not as an extra supports token.
- Avoid placeholder-shaped `ID_*` text in XML comments because validators that scan raw text can treat comments as unresolved ID references.
