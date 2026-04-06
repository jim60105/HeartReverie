## REMOVED Requirements

### Requirement: Keyboard chapter navigation

The application previously registered a global `keydown` listener that mapped ArrowLeft to the previous chapter and ArrowRight to the next chapter. This requirement is removed.

**Reason**: Arrow-key navigation conflicts with normal text editing and scrolling interactions. The user does not need keyboard-based chapter switching — button-based and URL-hash-based navigation remain fully functional.

**Migration**: Use the Previous/Next buttons in the header or the URL hash (`#chapter=N`) to navigate between chapters.
