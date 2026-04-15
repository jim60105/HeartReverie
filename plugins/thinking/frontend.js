// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Plugin: thinking — Fold <thinking> and <think> tags into collapsible details

import { escapeHtml } from '../_shared/utils.js';

export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    const result = extractThinkingBlocks(context.text);
    context.text = result.text;
    for (const block of result.blocks) {
      context.placeholderMap.set(block.placeholder, block.html);
    }
  }, 50);
}

/**
 * Extract all <thinking>…</thinking> and <think>…</think> (complete) and
 * unclosed <thinking>/<think> (incomplete) blocks from text, replacing each
 * with a placeholder comment.
 *
 * Tag matching is case-insensitive.
 *
 * @param {string} text
 * @returns {{ text: string, blocks: Array<{placeholder: string, html: string}> }}
 */
export function extractThinkingBlocks(text) {
  const blocks = [];
  let index = 0;

  // 1. Extract COMPLETE blocks: <think(ing)?>…</think(ing)?>
  text = text.replace(
    /<(think(?:ing)?)>\s*((?:(?!<\1>)[\s\S])*?)\s*<\/\1>/gi,
    (_match, _tag, inner) => {
      const placeholder = `<!--THINKING_BLOCK_${index}-->`;
      const html = renderThinkingBlock(inner, true);
      blocks.push({ placeholder, html });
      index++;
      return placeholder;
    }
  );

  // 2. Extract INCOMPLETE blocks: <think(ing)?> with no closing tag
  text = text.replace(
    /<(think(?:ing)?)>(?![\s\S]*<\/\1>)\s*((?:(?!<\1>)[\s\S])*)\s*$/gi,
    (_match, _tag, inner) => {
      const placeholder = `<!--THINKING_BLOCK_${index}-->`;
      const html = renderThinkingBlock(inner, false);
      blocks.push({ placeholder, html });
      index++;
      return placeholder;
    }
  );

  return { text, blocks };
}

/**
 * Render a thinking block as a collapsible <details> element.
 * - Complete blocks: "思考過程"
 * - Incomplete blocks: "思考中..."
 * All default to collapsed.
 *
 * @param {string} content  Inner text
 * @param {boolean} isComplete  Whether the block had a closing tag
 * @returns {string} HTML string
 */
export function renderThinkingBlock(content, isComplete) {
  const summary = isComplete ? '思考過程' : '思考中...';
  const escaped = escapeHtml(content.trim());
  const openAttr = isComplete ? '' : ' open';

  let html = `<details class="thinking-block fold-section"${openAttr}>`;
  html += `<summary class="fold-header"><span class="fold-icon">▼</span> ${summary}</summary>`;
  html += `<div class="fold-content"><pre class="thinking-content">${escaped}</pre></div>`;
  html += '</details>';
  return html;
}
