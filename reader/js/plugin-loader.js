// js/plugin-loader.js — Load frontend plugin modules from backend

import { FrontendHookDispatcher } from './plugin-hooks.js';
import { getAuthHeaders } from './passphrase-gate.js';

export const frontendHooks = new FrontendHookDispatcher();
let initialized = false;

/** @type {RegExp | null} Combined display strip pattern compiled from all plugins */
let displayStripRegex = null;

/**
 * Apply compiled displayStripTags patterns to text, removing matched blocks.
 * @param {string} text
 * @returns {string}
 */
export function applyDisplayStrip(text) {
  if (!displayStripRegex) return text;
  return text.replace(displayStripRegex, '');
}

/**
 * Escape special regex characters in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test a regex pattern for catastrophic backtracking using a probe string.
 * @param {string} pattern
 * @returns {boolean} true if safe
 */
function isRegexSafe(pattern) {
  const probe = 'a'.repeat(25) + '!';
  try {
    const re = new RegExp(pattern);
    const start = performance.now();
    re.test(probe);
    return (performance.now() - start) < 100;
  } catch {
    return false;
  }
}

/**
 * Compile displayStripTags entries from all plugins into a single RegExp.
 * @param {Array<{displayStripTags?: string[]}>} plugins
 */
function compileDisplayStripPatterns(plugins) {
  const patterns = [];

  for (const p of plugins) {
    if (!Array.isArray(p.displayStripTags)) continue;
    for (const tag of p.displayStripTags) {
      if (typeof tag !== 'string' || tag.length === 0) continue;

      if (tag.startsWith('/')) {
        // Regex pattern: extract inner pattern from /pattern/flags
        const lastSlash = tag.lastIndexOf('/');
        if (lastSlash <= 0) continue;
        const inner = tag.slice(1, lastSlash);
        if (inner.length === 0) continue;
        try {
          new RegExp(inner); // validate syntax
          if (!isRegexSafe(inner)) {
            console.warn(`Skipping unsafe displayStripTags regex (possible ReDoS): ${tag}`);
            continue;
          }
          patterns.push(inner);
        } catch {
          console.warn(`Invalid displayStripTags regex: ${tag}`);
        }
      } else {
        // Plain tag name: auto-wrap
        patterns.push(`<${escapeRegex(tag)}>[\\s\\S]*?</${escapeRegex(tag)}>`);
      }
    }
  }

  if (patterns.length > 0) {
    displayStripRegex = new RegExp(patterns.join('|'), 'gi');
  }
}

export async function initPlugins() {
  if (initialized) return;
  try {
    const res = await fetch('/api/plugins', { headers: getAuthHeaders() });
    if (!res.ok) { console.warn('Failed to load plugins:', res.status); return; }
    const plugins = await res.json();

    // Compile declarative display strip patterns from all plugins
    compileDisplayStripPatterns(plugins);

    const frontendPlugins = plugins.filter(p => p.hasFrontendModule);

    await Promise.all(frontendPlugins.map(async (p) => {
      try {
        const mod = await import(`/plugins/${p.name}/frontend.js`);
        if (typeof mod.register === 'function') {
          mod.register(frontendHooks);
          console.log(`Plugin loaded: ${p.name}`);
        }
      } catch (err) {
        console.error(`Failed to load plugin ${p.name}:`, err.message);
      }
    }));

    initialized = true;
  } catch (err) {
    console.warn('Plugin loading failed:', err.message);
  }
}
