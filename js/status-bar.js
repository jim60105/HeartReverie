// js/status-bar.js — <status> block extraction, parsing, and rendering

/**
 * Extract all <status>…</status> blocks from text, replacing each with a
 * placeholder comment. Returns the modified text and an array of block
 * entries with placeholder string and rendered HTML.
 *
 * @param {string} text
 * @returns {{ text: string, blocks: Array<{placeholder: string, html: string}> }}
 */
export function extractStatusBlocks(text) {
  const blocks = [];
  let index = 0;

  const processed = text.replace(/<status>([\s\S]*?)<\/status>/gi, (_match, inner) => {
    const placeholder = `<!--STATUS_BLOCK_${index}-->`;
    try {
      const parsed = parseStatus(inner);
      const html = renderStatusPanel(parsed);
      blocks.push({ placeholder, html });
    } catch {
      // Fallback: display raw block text on parse failure
      const fallback = `<div class="main-card"><pre class="variable-content">${escapeHtml(inner.trim())}</pre></div>`;
      blocks.push({ placeholder, html: fallback });
    }
    index++;
    return placeholder;
  });

  return { text: processed, blocks };
}

/**
 * Parse the raw content inside a <status> block into a structured object.
 * Handles partial / missing sections gracefully.
 *
 * @param {string} blockContent
 * @returns {{ name: string, title: string, scene: string, thought: string, items: string,
 *             clothes: string, shoes: string, socks: string, accessories: string,
 *             closeUps: Array<{part: string, description: string}> }}
 */
export function parseStatus(blockContent) {
  const data = {
    name: '', title: '', scene: '', thought: '', items: '',
    clothes: '', shoes: '', socks: '', accessories: '',
    closeUps: [],
  };

  // ── 基礎 section ──
  const baseMatch = blockContent.match(/基礎[:：]\s*\[([\s\S]*?)\]/);
  if (baseMatch) {
    const fields = splitPipe(baseMatch[1]);
    data.name = fields[0] || '';
    data.title = fields[1] || '';
    data.scene = fields[2] || '';
    data.thought = fields[3] || '';
    data.items = fields[4] || '';
  }

  // ── 服飾 section ──
  const outfitMatch = blockContent.match(/服飾[:：]\s*\[([\s\S]*?)\]/);
  if (outfitMatch) {
    const fields = splitPipe(outfitMatch[1]);
    data.clothes = fields[0] || '';
    data.shoes = fields[1] || '';
    data.socks = fields[2] || '';
    data.accessories = fields[3] || '';
  }

  // ── 特寫 section — one or more [Part|Description] entries ──
  const closeUpSection = blockContent.match(/特寫[:：]\s*([\s\S]*)$/);
  if (closeUpSection) {
    const cuRegex = /\[([\s\S]*?)\|([\s\S]*?)\]/g;
    let m;
    while ((m = cuRegex.exec(closeUpSection[1])) !== null) {
      data.closeUps.push({ part: m[1].trim(), description: m[2].trim() });
    }
  }

  return data;
}

/**
 * Render a parsed status object into themed HTML.
 *
 * @param {{ name: string, title: string, scene: string, thought: string, items: string,
 *           clothes: string, shoes: string, socks: string, accessories: string,
 *           closeUps: Array<{part: string, description: string}> }} data
 * @returns {string} HTML string
 */
export function renderStatusPanel(data) {
  const esc = escapeHtml;

  // ── Character header ──
  let html = `<div class="status-panel main-card status-float">`;

  if (data.name || data.title) {
    html += `<div class="char-header">`;
    if (data.name) html += `<div class="char-name">${esc(data.name)}</div>`;
    if (data.title) html += `<div class="char-title">${esc(data.title)}</div>`;
    html += `</div>`;
  }

  // ── Info rows (scene, thought, items) ──
  const infoRows = [];
  if (data.scene) {
    infoRows.push(`<div class="info-item scene-box"><span class="emoji-icon">📍</span><span class="item-label">場景:</span><span class="stat-val">${esc(data.scene)}</span></div>`);
  }
  if (data.thought) {
    infoRows.push(`<div class="info-item plain-box"><span class="item-label">💭 想法:</span><span class="stat-val">${esc(data.thought)}</span></div>`);
  }
  if (data.items) {
    infoRows.push(`<div class="info-item plain-box"><span class="emoji-icon">👜</span><span class="item-label">物品:</span><span class="stat-val">${esc(data.items)}</span></div>`);
  }

  if (infoRows.length) {
    html += `<div class="stats-container"><div class="grid-info">${infoRows.join('')}</div></div>`;
  }

  // ── 穿着 (outfit) collapsible ──
  const outfitItems = [];
  if (data.clothes) outfitItems.push({ emoji: '👚', label: '衣物', value: data.clothes });
  if (data.shoes)   outfitItems.push({ emoji: '🧦', label: '鞋襪', value: data.shoes });
  if (data.socks)   outfitItems.push({ emoji: '💍', label: '襪類', value: data.socks });
  if (data.accessories) outfitItems.push({ emoji: '⛓️', label: '飾品', value: data.accessories });

  if (outfitItems.length) {
    html += `<details class="fold-section status-details">`;
    html += `<summary class="fold-header"><span class="fold-icon">▼</span> 👗 穿着</summary>`;
    html += `<div class="fold-content"><div class="grid-info two-col">`;
    for (const item of outfitItems) {
      html += `<div class="info-item"><span class="emoji-icon">${item.emoji}</span><div><span class="item-label">${item.label}:</span><span class="stat-val">${esc(item.value)}</span></div></div>`;
    }
    html += `</div></div></details>`;
  }

  // ── 特寫 (close-up) collapsible ──
  if (data.closeUps.length) {
    html += `<details class="fold-section status-details">`;
    html += `<summary class="fold-header"><span class="fold-icon">▼</span> 🔍 特寫</summary>`;
    html += `<div class="fold-content">`;
    for (const cu of data.closeUps) {
      html += `<div class="stat-row"><span class="stat-label">${esc(cu.part)}:</span><span class="stat-val">${esc(cu.description)}</span></div>`;
    }
    html += `</div></details>`;
  }

  html += `</div>`;
  return html;
}

// ── Helpers ──

function splitPipe(str) {
  return str.split('|').map(s => s.trim());
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
