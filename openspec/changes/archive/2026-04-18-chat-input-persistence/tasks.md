## 1. Implementation

- [x] 1.1 Add sessionStorage persistence to `ChatInput.vue`: wrap storage access in try/catch; use story-scoped key `"heartreverie:chat-input:<series>:<story>"`; read from sessionStorage during `<script setup>` to populate `inputText` ref; add save calls in `handleSend()` and `handleResend()` before emitting events

## 2. Testing

- [x] 2.1 Add unit tests for persistence behavior: verify save on send, save on resend, restore on mount, default empty string when no stored value, survival across simulated remount, story isolation (different key per story), graceful handling when sessionStorage throws

## 3. Verification

- [x] 3.1 Run full frontend test suite (`deno task test:frontend`) and confirm all tests pass including new persistence tests
