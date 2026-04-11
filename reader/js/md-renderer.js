// js/md-renderer.js — Markdown rendering pipeline

import { frontendHooks, applyDisplayStrip } from './plugin-loader.js';

/**
 * Render a raw markdown chapter through the plugin-driven pipeline:
 *
 *  1. Dispatch 'frontend-render' hooks    → extraction + placeholders
 *  2. Apply declarative displayStripTags    → tag removal
 *  3. Quote normalisation                 → ASCII "
 *  4. Newline doubling                    → \n → \n\n
 *  5. Markdown → HTML via marked.parse()
 *  6. Reinsert rendered component HTML
 *  7. Sanitize HTML via DOMPurify
 *
 * @param {string} rawMarkdown
 * @param {object} options
 * @returns {string} Final HTML string
 */
export function renderChapter(rawMarkdown, options = {}) {
  let text = rawMarkdown;
  const placeholderMap = new Map();

  // 1. Plugin-driven tag extraction and rendering
  const renderContext = { text, placeholderMap, options };
  frontendHooks.dispatch('frontend-render', renderContext);
  text = renderContext.text;

  // 2. Declarative display strip tag removal
  text = applyDisplayStrip(text);

  // 3. Quote normalisation
  text = text.replace(/[\u201c\u201d\u00ab\u00bb\u300c\u300d\uff62\uff63\u300a\u300b\u201e]/g, '"');

  // 4. Newline doubling
  text = text.replace(/\n/g, '\n\n');

  // 5. Markdown → HTML
  let html = marked.parse(text, { breaks: true });

  // 6. Reinsert rendered component HTML
  html = reinjectPlaceholders(html, placeholderMap);

  // 7. Sanitize HTML via DOMPurify
  return DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['open'] });
}

/**
 * Replace placeholder comment tokens in rendered HTML with the corresponding
 * rendered component HTML.
 *
 * @param {string} html  The HTML output from marked.parse()
 * @param {Map<string, string>} map  Placeholder → rendered HTML
 * @returns {string} HTML with placeholders replaced
 */
export function reinjectPlaceholders(html, map) {
  let result = html;
  for (const [placeholder, rendered] of map) {
    // Placeholders may appear verbatim or HTML-encoded inside paragraphs.
    // marked preserves HTML comments as-is, so a simple string replace works.
    result = result.split(placeholder).join(rendered);
  }
  return result;
}
