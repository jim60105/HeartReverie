// js/prompt-editor.js — System prompt template editor (編排器)

import { getAuthHeaders } from './passphrase-gate.js';
import { getBackendContext } from './chapter-nav.js';
import { showPromptPreview } from './prompt-preview.js';

const STORAGE_KEY = 'story-editor-template';
let editorPanel = null;
let editorTextarea = null;
let originalTemplate = null;
let savedTemplate = null;
let parameterPills = [];
let saveTimer = null;

// Eagerly load the server template + localStorage override (call after auth)
export async function initEditorState() {
  try {
    const res = await fetch('/api/template', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    originalTemplate = data.content;
  } catch {
    return;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored !== originalTemplate) {
    savedTemplate = stored;
  }
}

export function initPromptEditor() {
  editorPanel = document.createElement('div');
  editorPanel.id = 'prompt-editor-panel';
  editorPanel.className = 'prompt-editor-panel hidden';
  editorPanel.innerHTML = `
    <div class="editor-header">
      <h3>🎛️ 編排器</h3>
      <div class="editor-header-actions">
        <button id="editor-reset-btn" class="editor-btn-sm" title="重設為伺服器版本">↻ 重設</button>
        <button id="close-editor" class="editor-close-btn">✕</button>
      </div>
    </div>
    <div class="editor-variables">
      <div class="editor-variables-label">變數 <span class="editor-hint">(點擊插入)</span></div>
      <div id="variable-pills" class="variable-pills"></div>
    </div>
    <div class="editor-textarea-wrap">
      <textarea id="editor-textarea" class="editor-textarea" spellcheck="false" placeholder="載入中..."></textarea>
    </div>
    <div class="editor-actions">
      <button id="editor-preview-btn" class="editor-btn">預覽 Prompt</button>
    </div>
  `;
  document.body.appendChild(editorPanel);

  editorTextarea = document.getElementById('editor-textarea');
  editorTextarea.value = savedTemplate || originalTemplate || '';

  editorTextarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistToStorage, 500);
  });

  document.getElementById('close-editor').addEventListener('click', () => {
    editorPanel.classList.add('hidden');
    document.dispatchEvent(new CustomEvent('panel-closed'));
  });

  document.getElementById('editor-reset-btn').addEventListener('click', resetTemplate);

  document.getElementById('editor-preview-btn').addEventListener('click', () => {
    const ctx = getBackendContext();
    if (!ctx.isBackendMode || !ctx.series || !ctx.story) {
      alert('請先載入一個故事再使用預覽功能。');
      return;
    }
    const message = document.getElementById('chat-message')?.value || '(preview)';
    const template = editorTextarea.value;
    showPromptPreview(ctx.series, ctx.story, message, template);
  });

  loadParameters();
}

function persistToStorage() {
  if (!editorTextarea || !originalTemplate) return;
  const current = editorTextarea.value;
  if (current === originalTemplate) {
    localStorage.removeItem(STORAGE_KEY);
    savedTemplate = null;
  } else {
    localStorage.setItem(STORAGE_KEY, current);
    savedTemplate = current;
  }
}

function resetTemplate() {
  if (!editorTextarea || !originalTemplate) return;
  editorTextarea.value = originalTemplate;
  localStorage.removeItem(STORAGE_KEY);
  savedTemplate = null;
}

async function loadParameters() {
  try {
    const res = await fetch('/api/plugins/parameters', { headers: getAuthHeaders() });
    if (!res.ok) return;
    parameterPills = await res.json();
    renderPills();
  } catch {
    // Ignore
  }
}

function renderPills() {
  const container = document.getElementById('variable-pills');
  if (!container) return;

  container.textContent = '';
  for (const p of parameterPills) {
    const btn = document.createElement('button');
    btn.className = `variable-pill ${p.source === 'core' ? 'pill-core' : 'pill-plugin'}`;
    btn.dataset.var = p.name;
    btn.title = `${p.source}: ${p.type}`;
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      insertAtCursor(`{{ ${p.name} }}`);
    });
    container.appendChild(btn);
  }
}

function insertAtCursor(text) {
  if (!editorTextarea) return;
  editorTextarea.focus();
  const start = editorTextarea.selectionStart;
  const end = editorTextarea.selectionEnd;
  const before = editorTextarea.value.substring(0, start);
  const after = editorTextarea.value.substring(end);
  editorTextarea.value = before + text + after;
  const newPos = start + text.length;
  editorTextarea.setSelectionRange(newPos, newPos);
  persistToStorage();
}

export function getEditorTemplate() {
  // Works even before the panel is opened — uses savedTemplate from localStorage
  if (savedTemplate) return savedTemplate;
  if (editorTextarea && originalTemplate) {
    const current = editorTextarea.value;
    return current !== originalTemplate ? current : undefined;
  }
  return undefined;
}

export function hideEditor() {
  if (editorPanel) editorPanel.classList.add('hidden');
}

export function toggleEditor() {
  if (!editorPanel) initPromptEditor();
  editorPanel.classList.toggle('hidden');
}
