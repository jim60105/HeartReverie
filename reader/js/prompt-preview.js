// js/prompt-preview.js — Prompt preview panel

import { getAuthHeaders } from './passphrase-gate.js';

let previewPanel = null;

export function initPromptPreview() {
  previewPanel = document.createElement('div');
  previewPanel.id = 'prompt-preview-panel';
  previewPanel.className = 'prompt-preview-panel hidden';
  previewPanel.innerHTML = `
    <div class="preview-header">
      <h3>📝 Prompt Preview</h3>
      <button id="close-preview" class="preview-close-btn">✕</button>
    </div>
    <div class="preview-meta" id="preview-meta"></div>
    <pre class="preview-content" id="preview-content"></pre>
  `;
  document.body.appendChild(previewPanel);

  document.getElementById('close-preview').addEventListener('click', () => {
    previewPanel.classList.add('hidden');
    document.dispatchEvent(new CustomEvent('panel-closed'));
  });
}

export function hidePromptPreview() {
  if (previewPanel) previewPanel.classList.add('hidden');
}

export async function showPromptPreview(series, story, message, template) {
  if (!previewPanel) initPromptPreview();

  const contentEl = document.getElementById('preview-content');
  const metaEl = document.getElementById('preview-meta');

  contentEl.textContent = 'Loading...';
  metaEl.textContent = '';
  previewPanel.classList.remove('hidden');

  try {
    const body = { message: message || '(preview)' };
    if (typeof template === 'string') body.template = template;

    const res = await fetch(`/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/preview-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      contentEl.textContent = `Error: ${err.message || err.detail || 'Unknown error'}`;
      return;
    }

    const data = await res.json();
    contentEl.textContent = data.prompt;

    const metaParts = [];
    if (data.fragments?.length) metaParts.push(`Plugins: ${data.fragments.join(', ')}`);
    if (data.variables) metaParts.push(`Chapters: ${data.variables.previous_context}`);
    metaEl.textContent = metaParts.join(' | ');
  } catch (err) {
    contentEl.textContent = `Error: ${err.message}`;
  }
}
