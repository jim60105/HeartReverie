## 1. Replace hardcoded colours with theme variable

- [ ] 1.1 In `StorySelector.vue`, replace `background: #1a0810` with `background: var(--panel-bg)`
- [ ] 1.2 In `LoreEditor.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in `.tag-suggestion-list`
- [ ] 1.3 In `LoreEditor.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in `.confirm-dialog`
- [ ] 1.4 In `LoreBrowser.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in the search results dropdown

## 2. Gate PluginActionBar with showChatInput

- [ ] 2.1 In `MainLayout.vue`, add `v-if="showChatInput"` to the `<PluginActionBar>` element
- [ ] 2.2 Update `usePluginActions` test expectations: `backend-only` on non-last chapter should now NOT render (layout gate prevents mount)

## 3. Validation

- [ ] 3.1 Run `deno task check` to confirm no type errors
- [ ] 3.2 Run `deno task test` to confirm all existing tests pass (update tests for new `backend-only` semantics)
- [ ] 3.3 Visually verify in podman build that theme switch updates panel backgrounds and action bar hides correctly
