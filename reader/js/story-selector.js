// js/story-selector.js — Story selector panel logic

import { getAuthHeaders } from './passphrase-gate.js';

export async function loadSeriesList() {
    const res = await fetch('/api/stories', { headers: { ...getAuthHeaders() } });
    if (!res.ok) throw new Error('Failed to load series');
    return res.json();
}

export async function loadStoryList(series) {
    const res = await fetch(`/api/stories/${encodeURIComponent(series)}`, { headers: { ...getAuthHeaders() } });
    if (!res.ok) throw new Error('Failed to load stories');
    return res.json();
}

export async function createStory(series, name) {
    const res = await fetch(
        `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(name)}/init`,
        { method: 'POST', headers: { ...getAuthHeaders() } }
    );
    if (!res.ok) throw new Error('Failed to create story');
    return res.json();
}

let els = {};
let onLoadStory = null;

export function initStorySelector(elements, { onLoad }) {
    els = elements;
    onLoadStory = onLoad;

    els.selectSeries.addEventListener('change', handleSeriesChange);
    els.btnCreate.addEventListener('click', handleCreate);
    els.btnLoad.addEventListener('click', handleLoad);

    // Initial population
    populateSeriesList();
}

async function populateSeriesList() {
    try {
        const series = await loadSeriesList();
        els.selectSeries.innerHTML = '<option value="">-- 選擇系列 --</option>';
        for (const s of series) {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            els.selectSeries.appendChild(opt);
        }
    } catch {
        els.selectSeries.innerHTML = '<option value="">載入失敗</option>';
    }
}

async function handleSeriesChange() {
    const series = els.selectSeries.value;
    els.selectStory.innerHTML = '<option value="">-- 選擇故事 --</option>';
    if (!series) return;

    try {
        const stories = await loadStoryList(series);
        for (const s of stories) {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            els.selectStory.appendChild(opt);
        }
    } catch {
        els.selectStory.innerHTML = '<option value="">載入失敗</option>';
    }
}

async function handleCreate() {
    const series = els.selectSeries.value;
    const name = els.inputNewStory.value.trim();
    if (!series) return;
    if (!name) {
        els.inputNewStory.focus();
        return;
    }

    try {
        await createStory(series, name);
        // Add to dropdown and select
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        els.selectStory.appendChild(opt);
        els.selectStory.value = name;
        els.inputNewStory.value = '';
        // Auto-load
        if (onLoadStory) await onLoadStory(series, name);
    } catch (err) {
        console.error('Create story failed:', err);
    }
}

async function handleLoad() {
    const series = els.selectSeries.value;
    const story = els.selectStory.value;
    if (!series || !story) return;
    if (onLoadStory) await onLoadStory(series, story);
}
