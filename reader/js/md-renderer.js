// js/md-renderer.js — Markdown rendering pipeline

import { extractStatusBlocks } from './status-bar.js';
import { extractOptionsBlocks } from './options-panel.js';
import { extractVariableBlocks } from './variable-display.js';

/**
 * Render a raw markdown chapter through the full pipeline:
 *
 *  1. Extract & render <status> blocks       → placeholders
 *  2. Extract & render <options> blocks      → placeholders
 *  3. Extract & render <UpdateVariable>      → placeholders
 *  4. Strip <imgthink>…</imgthink>           → removed
 *  5. Strip <disclaimer>…</disclaimer>       → removed
 *  6. Quote normalisation                    → ASCII "
 *  7. Newline doubling                       → \n → \n\n
 *  8. Markdown → HTML via marked.parse()
 *  9. Reinsert rendered component HTML
 *
 * @param {string} rawMarkdown
 * @returns {string} Final HTML string
 */
export function renderChapter(rawMarkdown, options = {}) {
  let text = rawMarkdown;
  const placeholderMap = new Map();

  // 1. Extract <status> blocks
  const statusResult = extractStatusBlocks(text);
  text = statusResult.text;
  for (const block of statusResult.blocks) {
    placeholderMap.set(block.placeholder, block.html);
  }

  // 2. Extract <options> blocks
  const optionsResult = extractOptionsBlocks(text, { render: options.isLastChapter !== false });
  text = optionsResult.text;
  for (const block of optionsResult.blocks) {
    placeholderMap.set(block.placeholder, block.html);
  }

  // 3. Extract <UpdateVariable> blocks (complete and incomplete)
  const variableResult = extractVariableBlocks(text);
  text = variableResult.text;
  for (const block of variableResult.blocks) {
    placeholderMap.set(block.placeholder, block.html);
  }

  // 4. Strip <imgthink>…</imgthink>
  text = text.replace(/<imgthink>[\s\S]*?<\/imgthink>/gi, '');

  // 5. Strip <disclaimer>…</disclaimer>
  text = text.replace(/<disclaimer>[\s\S]*?<\/disclaimer>/gi, '');

  // 5a. Strip <user_message>…</user_message>
  text = text.replace(/<user_message>[\s\S]*?<\/user_message>/gi, '');

  // 5c. Strip <T-task...>…</T-task...> but keep plain <T-task>…</T-task>
  text = text.replace(/<T-task[^>]+>[\s\S]*?<\/T-task[^>]+>/g, '');



  // 6. Quote normalisation
  text = text.replace(/[\u201c\u201d\u00ab\u00bb\u300c\u300d\uff62\uff63\u300a\u300b\u201e]/g, '"');

  // 7. Newline doubling
  text = text.replace(/\n/g, '\n\n');

  // 8. Markdown → HTML
  let html = marked.parse(text, { breaks: true });

  // 9. Reinsert rendered component HTML
  html = reinjectPlaceholders(html, placeholderMap);

  // 10. Sanitize HTML to prevent XSS
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
