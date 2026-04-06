// js/chapter-nav.js — Chapter navigation & state management

import {
    pickDirectory,
    listChapterFiles,
    readFileContent,
    saveDirectoryHandle,
    restoreDirectoryHandle
} from './file-reader.js';

// Task 7.1: Module-scoped state (private, not exported)
const state = {
    directoryHandle: null,
    files: [],
    currentIndex: 0,
    currentContent: ''
};

// DOM element references (set by initChapterNav)
let els = {};

// Try to load renderChapter; fall back to marked.parse
let renderChapter = null;
try {
    const mod = await import('./md-renderer.js');
    renderChapter = mod.renderChapter;
} catch {
    // md-renderer.js not yet available — use marked.js fallback
}

function render(raw) {
    if (renderChapter) return renderChapter(raw);
    return typeof marked !== 'undefined' ? marked.parse(raw) : raw;
}

// ── Internal helpers ──

async function loadChapter(index) {
    if (index < 0 || index >= state.files.length) return;

    state.currentIndex = index;
    state.currentContent = await readFileContent(state.files[index]);

    // Task 7.3/7.4: Re-run pipeline, replace content in DOM
    els.content.innerHTML = render(state.currentContent);

    // Task 7.5: Update button disabled states
    updateNavState();

    // Task 7.7: Sync URL hash (1-based)
    history.replaceState(null, '', `#chapter=${index + 1}`);

    // Task 7.8: Scroll to top of content area
    els.content.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Task 7.5/7.6: Update button disabled states and progress indicator
function updateNavState() {
    els.btnPrev.disabled = state.currentIndex <= 0;
    els.btnNext.disabled = state.currentIndex >= state.files.length - 1;

    els.chapterProgress.textContent =
        `${state.currentIndex + 1} / ${state.files.length}`;

    // Re-bind hover styles for enabled/disabled buttons
    [els.btnPrev, els.btnNext].forEach(btn => {
        if (!btn.disabled) {
            btn.onmouseover = () => {
                btn.style.background = 'var(--btn-hover-bg)';
                btn.style.borderColor = 'var(--btn-hover-border)';
            };
            btn.onmouseout = () => {
                btn.style.background = 'var(--btn-bg)';
                btn.style.borderColor = 'var(--btn-border)';
            };
        } else {
            btn.onmouseover = null;
            btn.onmouseout = null;
        }
    });
}

// Handle a directory handle (shared by pick and restore)
async function handleDirectorySelected(handle) {
    state.directoryHandle = handle;
    els.folderName.textContent = handle.name;

    state.files = await listChapterFiles(handle);

    if (state.files.length === 0) {
        els.content.innerHTML = `
            <section class="flex flex-col items-center justify-center py-20 text-center gap-4">
                <p class="text-lg" style="color: var(--text-title);">📭 找不到章節檔案</p>
                <p style="color: var(--text-main);">所選資料夾中沒有符合格式的章節檔案（如 <code class="px-1 rounded" style="background: var(--item-bg);">1.md</code>、<code class="px-1 rounded" style="background: var(--item-bg);">2.md</code> 等）。</p>
                <p class="text-sm" style="color: var(--text-label);">請選擇包含以數字命名的 .md 檔案的資料夾。</p>
            </section>`;
        els.chapterNav.classList.add('hidden');
        return;
    }

    els.chapterNav.classList.remove('hidden');
    await saveDirectoryHandle(handle);

    // Task 7.7: Check URL hash for starting chapter
    const hashMatch = window.location.hash.match(/chapter=(\d+)/);
    const startIndex = hashMatch
        ? Math.min(parseInt(hashMatch[1], 10) - 1, state.files.length - 1)
        : 0;

    // Task 7.2: Load first chapter (or hash-specified chapter)
    await loadChapter(Math.max(0, startIndex));
}

// ── Exported API ──

/**
 * Initialise chapter navigation with DOM element references.
 * Sets up hashchange listener and keyboard navigation.
 */
export function initChapterNav(elements) {
    els = elements;

    // Task 7.7: hashchange listener
    window.addEventListener('hashchange', () => {
        if (state.files.length === 0) return;
        const match = window.location.hash.match(/chapter=(\d+)/);
        if (!match) return;
        const idx = parseInt(match[1], 10) - 1;
        if (idx >= 0 && idx < state.files.length && idx !== state.currentIndex) {
            loadChapter(idx);
        }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (state.files.length === 0) return;
        if (e.key === 'ArrowLeft') loadChapter(state.currentIndex - 1);
        if (e.key === 'ArrowRight') loadChapter(state.currentIndex + 1);
    });
}

/**
 * Called when the folder picker button is clicked.
 */
export async function handleFolderSelect() {
    const handle = await pickDirectory();
    if (!handle) return;
    await handleDirectorySelected(handle);
}

/** Task 7.3: Go to next chapter */
export function handleNext() {
    loadChapter(state.currentIndex + 1);
}

/** Task 7.4: Go to previous chapter */
export function handlePrev() {
    loadChapter(state.currentIndex - 1);
}

/**
 * Attempt to restore a previously saved directory handle on page load.
 */
export async function tryRestoreSession() {
    const restored = await restoreDirectoryHandle();
    if (restored) {
        await handleDirectorySelected(restored);
    }
}
