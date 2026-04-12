/**
 * Escape HTML special characters to prevent XSS in plugin-rendered output.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
