// js/vento-error-display.js — Display Vento template rendering errors

export function renderVentoError(error) {
  const { message, source, line, suggestion } = error;

  let html = `<div class="vento-error-card">`;
  html += `<div class="vento-error-header">⚠️ 模板渲染錯誤</div>`;
  html += `<div class="vento-error-body">`;
  html += `<div class="vento-error-message">${escapeForDisplay(message)}</div>`;
  if (source) html += `<div class="vento-error-source">檔案: ${escapeForDisplay(source)}${line ? ` (行 ${line})` : ''}</div>`;
  if (suggestion) html += `<div class="vento-error-suggestion">💡 ${escapeForDisplay(suggestion)}</div>`;
  html += `</div></div>`;
  return html;
}

function escapeForDisplay(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
