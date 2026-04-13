## 1. Reference Files

- [x] 1.1 Create `references/manifest-schema.md` with complete `plugin.json` field definitions, valid types, promptFragments format, tag strip pattern syntax (plain text and regex), and parameters array format
- [x] 1.2 Create `references/hook-api.md` with the three active backend hook stages (prompt-assembly, pre-write, post-response), their context parameters, registration patterns, and the frontend-render hook details

## 2. SKILL.md

- [x] 2.1 Create `skills/heartreverie-create-plugin/SKILL.md` with YAML frontmatter (`name: heartreverie-create-plugin`, comprehensive `description` with trigger phrases) and the guided plugin creation workflow
- [x] 2.2 Include plugin type selection logic (prompt-only, full-stack, hook-only, frontend-only) with decision criteria
- [x] 2.3 Include manifest generation instructions with all field patterns from existing plugins
- [x] 2.4 Include tag strip configuration guidance (plain text vs regex, displayStripTags vs promptStripTags)
- [x] 2.5 Include prompt fragment file creation with priority guidance and system.md integration reminder
- [x] 2.6 Include backend and frontend module scaffolding templates with correct export signatures
- [x] 2.7 Include README.md generation instructions (zh-TW, full-width punctuation, standard sections)
- [x] 2.8 Add progressive disclosure directives: reference `references/manifest-schema.md` and `references/hook-api.md` with clear when-to-read guidance

## 3. Validation

- [x] 3.1 Verify SKILL.md is under 500 lines
- [x] 3.2 Verify all reference files are correctly linked from SKILL.md
- [x] 3.3 Verify the skill covers all 10 spec requirements and their scenarios
