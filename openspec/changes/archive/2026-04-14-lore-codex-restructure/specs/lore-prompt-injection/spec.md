## REMOVED Requirements

### Requirement: Scenario Migration Compatibility
**Reason**: The migration from `scenario.md` to lore passages is no longer needed. The `lore_scenario` variable still naturally emerges from the general tag-specific variable generation requirement whenever passages are tagged with "scenario" — no dedicated migration compatibility requirement is necessary.
**Migration**: The `lore_scenario` variable continues to work via the existing "Tag-Specific Variable Generation" requirement. Any passage tagged with "scenario" will produce `lore_scenario` as before. Remove `scripts/migrate-scenario.ts` and scenario.md references from documentation.
