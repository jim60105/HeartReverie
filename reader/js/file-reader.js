// js/file-reader.js — File System Access API helpers

const DB_NAME = 'storyReaderDB';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'directoryHandle';

/**
 * Prompt user to pick a directory.
 * Returns a FileSystemDirectoryHandle or null on cancellation.
 */
export async function pickDirectory() {
    try {
        return await window.showDirectoryPicker();
    } catch (err) {
        if (err.name === 'AbortError') {
            // User cancelled the picker
            return null;
        }
        throw err;
    }
}

/**
 * List chapter files matching /^\d+\.md$/ in the given directory,
 * sorted numerically by leading digits.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<FileSystemFileHandle[]>}
 */
export async function listChapterFiles(dirHandle) {
    const chapterPattern = /^\d+\.md$/;
    const entries = [];

    for await (const [name, handle] of dirHandle) {
        if (handle.kind === 'file' && chapterPattern.test(name)) {
            entries.push({ name, handle });
        }
    }

    entries.sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    return entries.map(e => e.handle);
}

/**
 * Read a file's content as UTF-8 text.
 * Uses getFile() which returns a snapshot blob — no persistent file lock is held,
 * so other applications can freely edit the file while the reader has it open.
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<string>}
 */
export async function readFileContent(fileHandle) {
    const file = await fileHandle.getFile();
    return file.text();
}

// ── IndexedDB helpers ──

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save a directory handle to IndexedDB for later restoration.
 * @param {FileSystemDirectoryHandle} handle
 */
export async function saveDirectoryHandle(handle) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // IndexedDB unavailable — silently ignore
    }
}

/**
 * Clear the saved directory handle from IndexedDB.
 */
export async function clearDirectoryHandle() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // IndexedDB unavailable — silently ignore
    }
}

/**
 * Restore a previously saved directory handle from IndexedDB.
 * Re-requests read permission; returns null if denied or not found.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function restoreDirectoryHandle() {
    try {
        const db = await openDB();
        const handle = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!handle) return null;

        // Re-request permission
        const permission = await handle.requestPermission({ mode: 'read' });
        if (permission === 'granted') {
            return handle;
        }
        return null;
    } catch {
        // IndexedDB or permission error — fall back to picker
        return null;
    }
}
