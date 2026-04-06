## Why

The story reader uses generic system fonts and lacks typographic personality. Headings should use an antique/serif font stack featuring Iansui (loaded via Google Fonts) for a literary feel, while body text uses a CJK-optimised system-ui stack. The `#content` area has no padding, making prose feel cramped against grid edges. The scroll-to-top logic only accounts for the header height but ignores the `<main>` padding-top, causing content to appear slightly offset after navigation.

## What Changes

- **Custom font stacks**: Add `--font-system-ui` and `--font-antique` CSS custom properties to `:root`. Load Iansui via `@font-face` from Google Fonts CDN. Apply `--font-antique` to all heading elements (h1–h6) and `--font-system-ui` to body text. Set heading `font-weight: normal` and `line-height: normal`.
- **Content padding**: Add padding to `#content` so prose text has breathing room within the grid column.
- **Scroll offset fix**: Update the scroll-to-top calculation in `chapter-nav.js` to account for `<main>` element's padding-top in addition to the header height.

## Capabilities

### New Capabilities

### Modified Capabilities
- `page-layout`: New font CSS custom properties, `@font-face` for Iansui, heading font rules, `#content` padding
- `chapter-navigation`: Scroll offset calculation includes `<main>` padding-top

## Impact

- `index.html`: Add `--font-system-ui` and `--font-antique` to `:root`, `@font-face` for Iansui, heading font rules (h1–h6), update `body` `font-family`, add `#content` padding
- `js/chapter-nav.js`: Update `headerOffset` calculation to include `<main>` padding-top
