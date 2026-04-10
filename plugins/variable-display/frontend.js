// Plugin: variable-display — UpdateVariable block extraction, parsing, and rendering
import { escapeHtml } from '/js/utils.js';

export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    const result = extractVariableBlocks(context.text);
    context.text = result.text;
    for (const block of result.blocks) {
      context.placeholderMap.set(block.placeholder, block.html);
    }
  }, 60);
}

/**
 * Extract all <UpdateVariable>…</UpdateVariable> (complete) and unclosed
 * <UpdateVariable> (incomplete) blocks from text, replacing each with a
 * placeholder comment. Complete blocks are extracted first so their opening
 * tags are not consumed by the incomplete pattern.
 *
 * Tag matching is case-insensitive and also accepts the short form <update>.
 *
 * @param {string} text
 * @returns {{ text: string, blocks: Array<{placeholder: string, html: string}> }}
 */
export function extractVariableBlocks(text) {
  const blocks = [];
  let index = 0;

  // 1. Extract COMPLETE blocks first: <update(variable)?>…</update(variable)?>
  text = text.replace(
    /<(update(?:variable)?)>\s*((?:(?!<\1>)[\s\S])*?)\s*<\/\1>/gi,
    (_match, _tag, inner) => {
      const placeholder = `<!--VARIABLE_BLOCK_${index}-->`;
      const html = renderVariableBlock(inner, true);
      blocks.push({ placeholder, html });
      index++;
      return placeholder;
    }
  );

  // 2. Extract INCOMPLETE blocks: <update(variable)?> with no closing tag (greedy to end-of-string)
  text = text.replace(
    /<(update(?:variable)?)>(?![\s\S]*<\/\1>)\s*((?:(?!<\1>)[\s\S])*)\s*$/gi,
    (_match, _tag, inner) => {
      const placeholder = `<!--VARIABLE_BLOCK_${index}-->`;
      const html = renderVariableBlock(inner, false);
      blocks.push({ placeholder, html });
      index++;
      return placeholder;
    }
  );

  return { text, blocks };
}

/**
 * Render a variable block as a collapsible <details> element.
 * - Complete blocks get summary "變數更新詳情"
 * - Incomplete blocks get summary "變數更新中..."
 * All default to collapsed (no `open` attribute).
 *
 * @param {string} content  Inner text (may contain <Analysis>, <JSONPatch>, etc.)
 * @param {boolean} isComplete  Whether the block had a closing tag
 * @returns {string} HTML string
 */
export function renderVariableBlock(content, isComplete) {
  const summary = isComplete ? '變數更新詳情' : '變數更新中...';
  const escaped = escapeHtml(content.trim());

  let html = `<details class="variable-block fold-section">`;
  html += `<summary class="fold-header"><span class="fold-icon">▼</span> ${summary}</summary>`;
  html += `<div class="fold-content"><pre class="variable-content">${escaped}</pre></div>`;
  html += `</details>`;
  return html;
}
