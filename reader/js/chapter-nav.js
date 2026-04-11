// js/chapter-nav.js — Chapter navigation & state management

import {
    pickDirectory,
    listChapterFiles,
    readFileContent,
    saveDirectoryHandle,
    restoreDirectoryHandle,
    clearDirectoryHandle
} from './file-reader.js';
import { getAuthHeaders } from './passphrase-gate.js';

// Task 7.1: Module-scoped state (private, not exported)
const state = {
    directoryHandle: null,
    files: [],
    currentIndex: 0,
    currentContent: '',
    // Backend mode state
    backendChapters: null,   // [{ number, content }] or null
    currentSeries: null,
    currentStory: null
};

// DOM element references (set by initChapterNav)
let els = {};

// Task 5.1: Cached header height for scroll offset
let headerOffset = 0;

// Auto-reload polling interval ID
let pollIntervalId = null;

// Backend poll interval with rate-limit backoff
const POLL_INTERVAL_BASE = 3000;
const POLL_INTERVAL_MAX = 30000;
let currentPollInterval = POLL_INTERVAL_BASE;

// Try to load renderChapter; fall back to marked.parse
let renderChapter = null;
try {
    const mod = await import('./md-renderer.js');
    renderChapter = mod.renderChapter;
} catch {
    // md-renderer.js not yet available — use marked.js fallback
}

function render(raw, options = {}) {
    if (renderChapter) return renderChapter(raw, options);
    return typeof marked !== 'undefined' ? marked.parse(raw) : raw;
}

// ── Internal helpers ──

function moveStatusToSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    const panels = els.content.querySelectorAll('.status-float');
    panels.forEach(panel => sidebar.appendChild(panel));
}

async function loadChapter(index) {
    let totalChapters;
    if (state.backendChapters && state.backendChapters.length > 0) {
        // Backend mode
        totalChapters = state.backendChapters.length;
        if (index < 0 || index >= totalChapters) return;
        state.currentIndex = index;
        state.currentContent = state.backendChapters[index].content;
    } else {
        // FSA mode (existing)
        totalChapters = state.files.length;
        if (index < 0 || index >= totalChapters) return;
        state.currentIndex = index;
        state.currentContent = await readFileContent(state.files[index]);
    }

    // Determine if this is the last chapter
    const isLastChapter = index === totalChapters - 1;

    // Re-run pipeline, replace content in DOM
    els.content.innerHTML = render(state.currentContent, { isLastChapter });

    // Move status panel to sidebar (right column)
    moveStatusToSidebar();

    // Update button disabled states
    updateNavState();

    // Sync URL hash (1-based)
    history.replaceState(null, '', `#chapter=${index + 1}`);

    // Scroll to top of content area, offset by sticky header
    window.scrollTo({ top: els.content.offsetTop - headerOffset, behavior: 'smooth' });

    // Notify listeners about chapter change
    if (onChapterChangeCallback) {
        onChapterChangeCallback({ isLastChapter });
    }
}

// Task 7.5/7.6: Update button disabled states and progress indicator
function updateNavState() {
    const totalChapters = state.backendChapters?.length || state.files.length;
    els.btnPrev.disabled = state.currentIndex <= 0;
    els.btnNext.disabled = state.currentIndex >= totalChapters - 1;

    els.chapterProgress.textContent =
        `${state.currentIndex + 1} / ${totalChapters}`;

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

/**
 * Poll the directory for new chapter files.
 * Updates the file list and nav state if new files are detected.
 */
async function pollDirectory() {
    if (!state.directoryHandle) return;
    try {
        const newFiles = await listChapterFiles(state.directoryHandle);
        if (newFiles.length !== state.files.length) {
            state.files = newFiles;
            updateNavState();
        }
    } catch {
        // Directory may have been removed or permission revoked — ignore silently
    }
}

// Handle a directory handle (shared by pick and restore)
async function handleDirectorySelected(handle) {
    // Clear any existing polling interval
    if (pollIntervalId !== null) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }

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
        els.btnPrev.classList.add('hidden');
        els.chapterProgress.classList.add('hidden');
        els.btnNext.classList.add('hidden');
        els.btnReload.classList.add('hidden');
        return;
    }

    els.btnPrev.classList.remove('hidden');
    els.chapterProgress.classList.remove('hidden');
    els.btnNext.classList.remove('hidden');
    els.btnReload.classList.remove('hidden');
    await saveDirectoryHandle(handle);

    // Task 7.7: Check URL hash for starting chapter
    const hashMatch = window.location.hash.match(/chapter=(\d+)/);
    const startIndex = hashMatch
        ? Math.min(parseInt(hashMatch[1], 10) - 1, state.files.length - 1)
        : 0;

    // Task 7.2: Load first chapter (or hash-specified chapter)
    await loadChapter(Math.max(0, startIndex));

    // Start auto-reload polling (1-second interval)
    pollIntervalId = setInterval(pollDirectory, 1000);
}

// ── Exported API ──

// Callback for chapter change events
let onChapterChangeCallback = null;

/**
 * Initialise chapter navigation with DOM element references.
 * Sets up hashchange listener and keyboard navigation.
 */
export function initChapterNav(elements, options = {}) {
    els = elements;
    onChapterChangeCallback = options.onChapterChange || null;

    // Task 5.1: Cache header height + main padding for scroll-to-top offset
    const mainPaddingTop = parseFloat(getComputedStyle(document.querySelector('main')).paddingTop);
    headerOffset = document.querySelector('header').offsetHeight + mainPaddingTop;

    // Task 7.7: hashchange listener
    window.addEventListener('hashchange', () => {
        const totalChapters = state.backendChapters?.length || state.files.length;
        if (totalChapters === 0) return;
        const match = window.location.hash.match(/chapter=(\d+)/);
        if (!match) return;
        const idx = parseInt(match[1], 10) - 1;
        if (idx >= 0 && idx < totalChapters && idx !== state.currentIndex) {
            loadChapter(idx);
        }
    });
}

/**
 * Called when the folder picker button is clicked.
 * Clears any backend state and proceeds with FSA flow.
 */
export async function handleFolderSelect() {
    // Clear backend state
    state.backendChapters = null;
    state.currentSeries = null;
    state.currentStory = null;

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

/** Manually re-scan the directory for new chapter files */
export async function handleReload() {
    await pollDirectory();
}

/**
 * Attempt to restore a previously saved directory handle on page load.
 */
export async function tryRestoreSession() {
    const restored = await restoreDirectoryHandle();
    if (restored) {
        try {
            await handleDirectorySelected(restored);
        } catch {
            await clearDirectoryHandle();
        }
    }
}

/**
 * Load chapters from the backend API instead of the filesystem.
 */
export async function loadFromBackend(series, storyName) {
    // Clear FSA state
    if (pollIntervalId !== null) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
    state.directoryHandle = null;
    state.files = [];
    state.currentSeries = series;
    state.currentStory = storyName;

    // Fetch chapters from backend
    const res = await fetch(`/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(storyName)}/chapters`, { headers: { ...getAuthHeaders() } });
    if (!res.ok) throw new Error('Failed to load chapters');
    const chapterNums = await res.json();

    state.backendChapters = [];
    for (const num of chapterNums) {
        const chRes = await fetch(`/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(storyName)}/chapters/${num}`, { headers: { ...getAuthHeaders() } });
        if (!chRes.ok) continue;
        const { content } = await chRes.json();
        state.backendChapters.push({ number: num, content });
    }

    if (state.backendChapters.length === 0) {
        els.content.innerHTML = `
            <section class="flex flex-col items-center justify-center py-20 text-center gap-4">
                <p class="text-lg" style="color: var(--text-title);">📭 尚無章節</p>
                <p style="color: var(--text-main);">此故事尚未有任何章節內容。</p>
                <p class="text-sm" style="color: var(--text-label);">請使用下方的聊天輸入框發送指令以開始創作。</p>
            </section>`;
        moveStatusToSidebar();
        els.folderName.textContent = `${series} / ${storyName}`;
        els.btnPrev.classList.add('hidden');
        els.chapterProgress.classList.add('hidden');
        els.btnNext.classList.add('hidden');
        els.btnReload.classList.add('hidden');
        // Notify listeners so chat input shows for empty stories
        if (onChapterChangeCallback) {
            onChapterChangeCallback({ isLastChapter: true });
        }
        // Keep polling so new chapters are detected after resend
        pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
        return;
    }

    // Show nav buttons, load first chapter
    els.folderName.textContent = `${series} / ${storyName}`;
    els.btnPrev.classList.remove('hidden');
    els.chapterProgress.classList.remove('hidden');
    els.btnNext.classList.remove('hidden');
    els.btnReload.classList.remove('hidden');

    await loadChapter(0);

    // Start polling for new chapters
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
}

/**
 * Load from backend and navigate to the last chapter.
 */
export async function reloadFromBackendToLast() {
    if (!state.currentSeries || !state.currentStory) return;
    const series = state.currentSeries;
    const storyName = state.currentStory;

    if (pollIntervalId !== null) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }

    const res = await fetch(`/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(storyName)}/chapters`, { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const chapterNums = await res.json();

    state.backendChapters = [];
    for (const num of chapterNums) {
        const chRes = await fetch(`/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(storyName)}/chapters/${num}`, { headers: { ...getAuthHeaders() } });
        if (!chRes.ok) continue;
        const { content } = await chRes.json();
        state.backendChapters.push({ number: num, content });
    }

    if (state.backendChapters.length === 0) {
        // Keep polling so new chapters are detected after resend
        pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
        return;
    }

    els.btnPrev.classList.remove('hidden');
    els.chapterProgress.classList.remove('hidden');
    els.btnNext.classList.remove('hidden');
    els.btnReload.classList.remove('hidden');

    await loadChapter(state.backendChapters.length - 1);
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
}

/**
 * Get current backend story context.
 */
export function getBackendContext() {
    return {
        series: state.currentSeries,
        story: state.currentStory,
        isBackendMode: state.backendChapters !== null
    };
}

function restartPollInterval(interval) {
    if (pollIntervalId !== null) {
        clearInterval(pollIntervalId);
    }
    currentPollInterval = interval;
    pollIntervalId = setInterval(pollBackend, currentPollInterval);
}

async function pollBackend() {
    if (!state.currentSeries || !state.currentStory) return;
    try {
        const res = await fetch(`/api/stories/${encodeURIComponent(state.currentSeries)}/${encodeURIComponent(state.currentStory)}/chapters`, { headers: { ...getAuthHeaders() } });

        if (res.status === 429) {
            const backoff = Math.min(currentPollInterval * 2, POLL_INTERVAL_MAX);
            restartPollInterval(backoff);
            return;
        }

        // Reset to base interval after successful response
        if (currentPollInterval !== POLL_INTERVAL_BASE) {
            restartPollInterval(POLL_INTERVAL_BASE);
        }

        const nums = await res.json();
        const cachedLen = state.backendChapters?.length || 0;

        if (nums.length !== cachedLen) {
            // New chapters detected — reload all and navigate to last
            await loadFromBackend(state.currentSeries, state.currentStory);
            if (state.backendChapters && state.backendChapters.length > 0) {
                await loadChapter(state.backendChapters.length - 1);
            }
            return;
        }

        // Poll the last chapter's content for streaming updates
        if (nums.length > 0 && state.backendChapters && state.backendChapters.length > 0) {
            const lastNum = nums[nums.length - 1];
            const chRes = await fetch(`/api/stories/${encodeURIComponent(state.currentSeries)}/${encodeURIComponent(state.currentStory)}/chapters/${lastNum}`, { headers: { ...getAuthHeaders() } });
            if (!chRes.ok) return;
            const { content } = await chRes.json();
            const lastIdx = state.backendChapters.length - 1;
            if (content !== state.backendChapters[lastIdx].content) {
                state.backendChapters[lastIdx].content = content;
                // Re-render if currently viewing the last chapter
                if (state.currentIndex === lastIdx) {
                    const isLastChapter = lastIdx === state.backendChapters.length - 1;
                    els.content.innerHTML = render(content, { isLastChapter });
                    moveStatusToSidebar();
                }
            }
        }
    } catch {
        // Ignore polling errors silently
    }
}
