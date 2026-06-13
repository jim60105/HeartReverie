// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Escape HTML special characters to prevent XSS in plugin-rendered output.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

/**
 * Read the API passphrase from sessionStorage. Returns "" when absent or when
 * storage access throws (private-mode browsers). Reads only the "passphrase"
 * key written by the core (reader-src/src/composables/useAuth.ts); no legacy
 * fallback key is consulted.
 * @returns {string}
 */
export function getPassphrase() {
  try {
    return sessionStorage.getItem("passphrase") || "";
  } catch (_err) {
    return "";
  }
}

/**
 * Build auth headers for plugin API calls. Returns `{ "X-Passphrase": <pp> }`
 * when a passphrase is stored and `{}` when it is empty, so unauthenticated dev
 * deployments send no header. Defined in terms of getPassphrase() so the single
 * "passphrase"-key read lives in exactly one place.
 * @returns {Record<string, string>}
 */
export function getAuthHeaders() {
  const p = getPassphrase();
  return p ? { "X-Passphrase": p } : {};
}

/**
 * Read plugin settings from the hooks object, returning an empty object when
 * the host runtime does not expose `getSettings` (older engine builds, tests).
 * @param {{ getSettings?: () => Record<string, unknown> }} hooks
 * @returns {Record<string, unknown>}
 */
export function getPluginSettings(hooks) {
  if (!hooks || typeof hooks.getSettings !== "function") return {};
  const value = hooks.getSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

/**
 * Resolve the logger from a plugin register context, falling back to a
 * `console.info`-backed tagged logger when the host does not provide one.
 * Always exposes at least an `info` method; callers that need warn/error
 * should guard or extend the returned object.
 * @param {{ logger?: { info?: (...args: unknown[]) => void } } | undefined} context
 * @param {string} tag short plugin identifier prefixed to console output
 * @returns {{ info: (...args: unknown[]) => void }}
 */
export function createPluginLogger(context, tag) {
  if (context && context.logger && typeof context.logger.info === "function") {
    return context.logger;
  }
  const prefix = tag ? `[${tag}]` : "[plugin]";
  return {
    info: (...args) => console.info(prefix, ...args),
  };
}
