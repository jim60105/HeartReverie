# Typography and Spacing — Tasks

## 1. Custom Font Stacks

- [x] 1.1 In `index.html` `:root`, add `--font-system-ui` and `--font-antique` CSS custom properties with the specified font stacks
- [x] 1.2 Add `@font-face` declaration for Iansui (woff2 from Google Fonts CDN) before the `:root` block
- [x] 1.3 Update `body` `font-family` from `var(--font-stack)` to `var(--font-system-ui)`
- [x] 1.4 Remove the old `--font-stack` custom property from `:root` (replaced by `--font-system-ui`)
- [x] 1.5 Add heading font rule: `h1, h2, h3, h4, h5, h6 { font-weight: normal; line-height: normal; font-family: var(--font-antique), var(--font-system-ui); }`

## 2. Content Padding

- [x] 2.1 Add padding to `#content` (e.g., `padding: 0 1rem`) in the `<style>` block

## 3. Scroll Offset Fix

- [x] 3.1 In `js/chapter-nav.js` `initChapterNav()`, update `headerOffset` to include `<main>` padding-top: `headerOffset = document.querySelector('header').offsetHeight + parseFloat(getComputedStyle(document.querySelector('main')).paddingTop)`

## 4. Verification

- [x] 4.1 Verify body text renders with Noto Sans TC / system-ui font stack
- [x] 4.2 Verify headings (h1–h6) render with Iansui / antique font stack and normal weight
- [x] 4.3 Verify `#content` has visible horizontal padding
- [x] 4.4 Verify scroll-to-top positions content correctly below header + main padding
