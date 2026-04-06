// js/chat-input.js — Chat input logic for backend-driven stories

let els = {};
let getStoryContext = null;
let onMessageSent = null;

export function initChatInput(elements, { getContext, onSent }) {
    els = elements;
    getStoryContext = getContext;
    onMessageSent = onSent;

    els.sendBtn.addEventListener('click', handleSend);
    els.resendBtn.addEventListener('click', handleResend);

    // Enter submits; Shift+Enter inserts newline
    els.textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
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

export function appendToInput(text) {
    if (!els.textarea) return;
    const current = els.textarea.value;
    els.textarea.value = current ? `${current}\n${text}` : text;
}

function setControlsDisabled(disabled) {
    els.textarea.disabled = disabled;
    els.sendBtn.disabled = disabled;
    els.resendBtn.disabled = disabled;
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

    setControlsDisabled(true);
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

        els.errorSpan.textContent = '';
        if (onMessageSent) await onMessageSent();
    } catch (err) {
        els.errorSpan.textContent = err.message || '發送失敗';
    } finally {
        setControlsDisabled(false);
        els.sendBtn.textContent = '✨ 發送';
    }
}

async function handleResend() {
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

    setControlsDisabled(true);
    els.resendBtn.textContent = '⏳ 重送中…';

    try {
        // Delete last chapter
        const delRes = await fetch(
            `/api/stories/${encodeURIComponent(ctx.series)}/${encodeURIComponent(ctx.story)}/chapters/last`,
            { method: 'DELETE' }
        );

        if (!delRes.ok && delRes.status !== 404) {
            const text = await delRes.text();
            throw new Error(text || `DELETE failed: HTTP ${delRes.status}`);
        }

        // Re-send the message
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

        els.errorSpan.textContent = '';
        if (onMessageSent) await onMessageSent();
    } catch (err) {
        els.errorSpan.textContent = err.message || '重送失敗';
    } finally {
        setControlsDisabled(false);
        els.resendBtn.textContent = '🔄 重送';
    }
}
