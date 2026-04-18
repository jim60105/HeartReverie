## Context

`ChatInput.vue` stores the user's input text in a local `ref("")`. When Vue destroys and recreates the component (e.g., user navigates away from the last chapter, then back), the ref resets and the draft is lost. The existing spec already says "SHALL NOT clear the textarea after a successful send" but does not address component remounting.

## Goals / Non-Goals

**Goals:**
- Persist chat input text across component remounts
- Persist across page reloads within the same tab
- Save automatically on send/resend so the last submitted message is recoverable
- Load persisted text on component initialization

**Non-Goals:**
- Cross-tab synchronization (not needed for single-user app)
- Full draft history or undo (just the latest text)
- Server-side storage of input drafts
- localStorage (session-scoped is sufficient; sessionStorage clears on tab close which is acceptable)

## Decisions

1. **Use `sessionStorage` with story-scoped key** — Survives page reloads and component remounts within the same tab. Clears on tab close, which is acceptable behavior (no stale drafts). Key: `"heartreverie:chat-input:<series>:<story>"` to prevent cross-story leakage. Access is wrapped in try/catch to handle restricted environments gracefully (falls back to empty string).

2. **Save on send/resend** — Write to sessionStorage in `handleSend()` and `handleResend()` before emitting. This ensures the last submitted message is always recoverable.

3. **Load on component setup** — Read from sessionStorage in `<script setup>` during initialization to populate `inputText` ref.

4. **No debounced auto-save on keystroke** — The spec only requires "save on send and load on init". Saving per keystroke would add complexity for minimal benefit in this use case.

## Risks / Trade-offs

- **Risk**: sessionStorage has a ~5MB limit. Chat messages are small (< 10KB typically), so this is not a practical concern.
- **Risk**: sessionStorage may throw in restricted environments (private browsing, disabled storage). Mitigated by wrapping all access in try/catch.
- **Trade-off**: If the user types but never sends, the draft is NOT persisted (only send/resend triggers save). This is an explicit non-goal — "save when sending" keeps implementation minimal and matches the stated requirement.
