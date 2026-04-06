// js/passphrase-gate.js — Passphrase gate for API access control

const STORAGE_KEY = 'passphrase';

export function getPassphrase() {
    return sessionStorage.getItem(STORAGE_KEY) || '';
}

function setPassphrase(value) {
    sessionStorage.setItem(STORAGE_KEY, value);
}

export function getAuthHeaders() {
    const pp = getPassphrase();
    return pp ? { 'X-Passphrase': pp } : {};
}

async function checkPassphraseRequired() {
    try {
        const res = await fetch('/api/auth/verify');
        return res.status === 401;
    } catch {
        return true;
    }
}

async function verifyPassphrase(value) {
    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'X-Passphrase': value }
        });
        return res.ok;
    } catch {
        return false;
    }
}

export async function initPassphraseGate(overlayEl, onUnlocked) {
    // Check if already have a valid stored passphrase
    const stored = getPassphrase();
    if (stored) {
        const valid = await verifyPassphrase(stored);
        if (valid) {
            overlayEl.classList.add('hidden');
            onUnlocked();
            return;
        }
        // Stored passphrase is invalid, clear it
        sessionStorage.removeItem(STORAGE_KEY);
    }

    // Check if passphrase is required
    const required = await checkPassphraseRequired();
    if (!required) {
        overlayEl.classList.add('hidden');
        onUnlocked();
        return;
    }

    // Show overlay
    overlayEl.classList.remove('hidden');

    const input = overlayEl.querySelector('#passphrase-input');
    const btn = overlayEl.querySelector('#passphrase-submit');
    const error = overlayEl.querySelector('#passphrase-error');

    async function handleSubmit() {
        const value = input.value.trim();
        if (!value) {
            error.textContent = '請輸入通行密語';
            return;
        }

        btn.disabled = true;
        btn.textContent = '驗證中…';
        error.textContent = '';

        const valid = await verifyPassphrase(value);
        if (valid) {
            setPassphrase(value);
            overlayEl.classList.add('hidden');
            onUnlocked();
        } else {
            error.textContent = '通行密語錯誤';
            btn.disabled = false;
            btn.textContent = '進入';
        }
    }

    btn.addEventListener('click', handleSubmit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    });

    input.focus();
}
