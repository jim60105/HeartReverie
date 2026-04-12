// Plugin: options — Options panel extraction, parsing, and rendering

import { escapeHtml } from '../_shared/utils.js';

export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    const result = extractOptionsBlocks(context.text, { render: context.options?.isLastChapter !== false });
    context.text = result.text;
    for (const block of result.blocks) {
      context.placeholderMap.set(block.placeholder, block.html);
    }
  }, 50);
}

/**
 * Extract all <options>…</options> blocks from text, replacing each with a
 * placeholder comment. Returns the modified text and an array of block
 * entries with placeholder string and rendered HTML.
 *
 * @param {string} text
 * @returns {{ text: string, blocks: Array<{placeholder: string, html: string}> }}
 */
export function extractOptionsBlocks(text, { render = true } = {}) {
  const blocks = [];
  let index = 0;

  const processed = text.replace(/<options>([\s\S]*?)<\/options>/gi, (_match, inner) => {
    const placeholder = `<!--OPTIONS_BLOCK_${index}-->`;
    const items = parseOptions(inner);
    const html = render ? renderOptionsPanel(items) : '';
    blocks.push({ placeholder, html });
    index++;
    return placeholder;
  });

  return { text: processed, blocks };
}

/**
 * Parse the raw content inside an <options> block.
 * Accepts lines like `1:【text】`, `1: text`, `option1: text`, etc.
 * Returns up to 4 items. Handles fewer than 4 gracefully.
 *
 * @param {string} blockContent
 * @returns {Array<{number: number, text: string}>}
 */
export function parseOptions(blockContent) {
  const items = [];
  // Match each numbered option line
  const lineRegex = /(?:option)?(\d)(?:[:：.])\s*(?:【)?(.*?)(?:】)?\s*$/gm;
  let m;
  while ((m = lineRegex.exec(blockContent)) !== null && items.length < 4) {
    const text = m[2].trim();
    if (text) {
      items.push({ number: parseInt(m[1], 10), text });
    }
  }
  return items;
}

/**
 * Render parsed option items into a themed 2×2 CSS Grid of buttons.
 * Each button copies its text to clipboard on click with brief feedback.
 *
 * @param {Array<{number: number, text: string}>} items
 * @returns {string} HTML string
 */
export function renderOptionsPanel(items) {
  const esc = escapeHtml;

  let html = `<div class="options-panel era-actions-container">`;
  html += `<div class="era-actions-header"><h4 class="era-actions-title">✦ 行動選項 ✦</h4><div class="header-line"></div></div>`;
  html += `<div class="era-action-buttons">`;

  // Always render 4 grid cells; empty cells if fewer items
  for (let i = 0; i < 4; i++) {
    if (i < items.length) {
      const item = items[i];
      const escaped = esc(item.text);
      // Use data attribute for the raw text to copy
      html += `<button class="era-action-btn" data-option-text="${escaped}"><span class="era-action-num">${item.number}.</span> ${escaped}</button>`;
    } else {
      // Empty cell placeholder
      html += `<div class="era-action-btn era-action-btn--empty"></div>`;
    }
  }

  html += `</div></div>`;
  return html;
}

// Event delegation for option buttons
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-option-text]');
    if (!btn) return;
    const text = btn.dataset.optionText;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.textContent = '已複製!';
        setTimeout(() => { btn.innerHTML = orig; }, 1000);
    });
    // Dispatch custom event for Vue ChatInput to pick up
    document.dispatchEvent(new CustomEvent('option-selected', { detail: { text } }));
});
