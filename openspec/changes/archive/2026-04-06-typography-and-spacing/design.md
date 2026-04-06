# Typography and Spacing — Design

## Context

The MD Story Reader uses a generic system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...`) for all text. Headings use default browser bold weight. The `#content` div has no padding — prose text sits flush against the grid column boundary. The scroll-to-top logic in `chapter-nav.js` caches `header.offsetHeight` but does not account for `<main>`'s `py-6` (24px) padding-top, causing the scroll target to be 24px too high.

---

## Goals / Non-Goals

**Goals:**
- G1: Apply a CJK-optimised system-ui font stack for body text and an antique/serif stack with Iansui web font for headings.
- G2: Add padding to `#content` for comfortable prose reading margins.
- G3: Fix scroll-to-top offset to account for `<main>` padding-top.

**Non-Goals:**
- No changes to accent colours, theme variables, or dark background.
- No changes to rendering pipeline or custom block parsing.
- No font loading strategy beyond a single `@font-face` declaration.

---

## Decisions

### D1 — Custom Font Stacks

**Approach:** Add two new CSS custom properties to `:root`:

```css
--font-system-ui: Noto Sans TC, Noto Sans JP, Noto Sans SC, Noto Sans,
    Noto Color Emoji, Microsoft JhengHei, Heiti TC, system-ui, sans-serif;
--font-antique: Iansui, Superclarendon, "Bookman Old Style", "URW Bookman",
    "URW Bookman L", "Georgia Pro", Georgia, serif;
```

Load Iansui via `@font-face` from Google Fonts CDN (woff2 format). Apply `--font-antique` (with `--font-system-ui` fallback) to h1–h6 headings with `font-weight: normal; line-height: normal`. Update `body` `font-family` to use `var(--font-system-ui)` instead of the current `var(--font-stack)`.

**Why keep `--font-stack` as-is and add new variables:**
The existing `--font-stack` is referenced in the `body` rule. Rather than modifying it, we replace the body's `font-family` value with the new `--font-system-ui` variable. The old `--font-stack` can be removed or left as dead code — removing it is cleaner.

**Why `font-weight: normal` on headings:**
The Iansui font is a decorative/antique typeface that looks best at normal weight. Bold weight would distort its character shapes.

### D2 — Content Padding

**Approach:** Add padding to `#content` (e.g., `padding: 0 1rem`) so text has breathing room within the grid column. The exact value should be small enough not to waste horizontal space on mobile but sufficient to prevent text from touching container edges.

### D3 — Scroll Offset Fix

**Approach:** In `chapter-nav.js`, update the `headerOffset` calculation in `initChapterNav()` to include the `<main>` element's computed padding-top. Currently:

```js
headerOffset = document.querySelector('header').offsetHeight;
```

Change to:

```js
const mainPaddingTop = parseFloat(getComputedStyle(document.querySelector('main')).paddingTop);
headerOffset = document.querySelector('header').offsetHeight + mainPaddingTop;
```

This ensures `window.scrollTo({ top: els.content.offsetTop - headerOffset })` lands at the correct position below both the header and the main padding.

---

## Risks / Trade-offs

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Iansui font loaded from Google Fonts CDN adds a network dependency. If the CDN is down, headings fall back to Superclarendon → Bookman → Georgia → serif. | Acceptable — fallback fonts are system-installed and provide a similar serif/antique feel. No FOUT since `@font-face` doesn't block rendering. |
| R2 | Adding `#content` padding may affect existing prose layout on narrow screens. | Use modest padding (1rem) that works on all viewport sizes. |
