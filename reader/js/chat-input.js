// js/chat-input.js — Chat input logic for backend-driven stories

let els = {};
let getStoryContext = null;
let onMessageSent = null;

export function initChatInput(elements, { getContext, onSent }) {
    els = elements;
    getStoryContext = getContext;
    onMessageSent = onSent;

    els.sendBtn.addEventListener('click', handleSend);

    // Allow Ctrl+Enter to send
    els.textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSend();
        }
    });
}

export function showChatInput() {
    els.chatArea.classList.remove('hidden');
}

export function hideChatInput() {
    els.chatArea.classList.add('hidden');
}

async function handleSend() {
    els.errorSpan.textContent = '';

    const message = els.textarea.value.trim();
    if (!message) {
        els.errorSpan.textContent = '請輸入故事指令';
        return;
    }

    const ctx = getStoryContext ? getStoryContext() : null;
    if (!ctx || !ctx.series || !ctx.story) {
        els.errorSpan.textContent = '未選擇故事';
        return;
    }

    // Disable input
    els.textarea.disabled = true;
    els.sendBtn.disabled = true;
    els.sendBtn.textContent = '⏳ 發送中…';

    try {
        const res = await fetch(
            `/api/stories/${encodeURIComponent(ctx.series)}/${encodeURIComponent(ctx.story)}/chat`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            }
        );

        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
        }

        // Success — clear textarea and reload chapters
        els.textarea.value = '';
        els.errorSpan.textContent = '';
        if (onMessageSent) await onMessageSent();
    } catch (err) {
        els.errorSpan.textContent = err.message || '發送失敗';
    } finally {
        els.textarea.disabled = false;
        els.sendBtn.disabled = false;
        els.sendBtn.textContent = '✨ 發送';
    }
}
