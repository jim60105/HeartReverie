// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

// Plugin: dialogue-colorize
// Paint dialogue quote runs using the CSS Custom Highlight API. The plugin
// never mutates the DOM: it registers Range objects on named Highlight
// instances and lets `::highlight(name)` CSS rules paint them.

const PAIRS = [
  // [openerChar, closerChar, suffix]
  ['"', '"', 'straight'],
  ['\u201C', '\u201D', 'curly'],
  ['\u00AB', '\u00BB', 'guillemet'],
  ['\u300C', '\u300D', 'corner'],
  ['\uFF62', '\uFF63', 'corner-half'],
  ['\u300A', '\u300B', 'book'],
];

const SKIP_ANCESTORS = new Set(['CODE', 'PRE', 'KBD', 'SAMP']);

// Module-scoped Highlight registry, lazily populated.
const highlightBySuffix = new Map();
// Per-container range bookkeeping for cleanup on re-dispatch.
const rangesByContainer = new WeakMap();

function ensureHighlight(suffix) {
  let h = highlightBySuffix.get(suffix);
  if (!h) {
    h = new Highlight();
    highlightBySuffix.set(suffix, h);
    CSS.highlights.set(`dialogue-quote-${suffix}`, h);
  }
  return h;
}

function escapeForCharClass(ch) {
  return ch.replace(/[\\\]^-]/g, '\\$&');
}

function buildPairRegexes() {
  return PAIRS.map(([open, close, suffix]) => {
    const sameChar = open === close;
    const openEsc = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const closeEsc = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // For symmetric pairs ("…"), forbid the same char inside the body so we
    // greedy-match shortest pair. For asymmetric, forbid the closer.
    const forbidden = sameChar
      ? `[^${escapeForCharClass(close)}\\n]`
      : `[^${escapeForCharClass(close)}\\n]`;
    const pattern = `${openEsc}(${forbidden}+?)${closeEsc}`;
    return { regex: new RegExp(pattern, 'g'), suffix };
  });
}

const PAIR_REGEXES = buildPairRegexes();

// Quick fast-path: skip work entirely if container text contains no opener.
function containsAnyOpener(text) {
  for (const [open] of PAIRS) {
    if (text.indexOf(open) !== -1) return true;
  }
  return false;
}

function shouldSkipText(node, container) {
  let parent = node.parentElement;
  while (parent && parent !== container) {
    if (SKIP_ANCESTORS.has(parent.tagName)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function collectMatchesInText(text) {
  const matches = [];
  for (const { regex, suffix } of PAIR_REGEXES) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Skip empty body (regex requires +?, so at minimum 1 char body, but guard anyway).
      if (end - start <= 2) continue;
      matches.push({ start, end, suffix });
      // Avoid infinite loops on zero-width.
      if (m.index === regex.lastIndex) regex.lastIndex++;
    }
  }
  // Leftmost-longest non-overlapping sweep.
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  let cursor = 0;
  for (const mat of matches) {
    if (mat.start < cursor) continue;
    kept.push(mat);
    cursor = mat.end;
  }
  return kept;
}

function clearPriorRanges(container) {
  const prior = rangesByContainer.get(container);
  if (!prior) return;
  for (const { suffix, range } of prior) {
    const h = highlightBySuffix.get(suffix);
    if (h) h.delete(range);
  }
  rangesByContainer.delete(container);
}

function colorize(container) {
  clearPriorRanges(container);

  const text = container.textContent ?? '';
  if (!containsAnyOpener(text)) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipText(node, container)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const newRanges = [];
  let node = walker.nextNode();
  while (node) {
    const data = node.nodeValue ?? '';
    if (data.length > 0 && containsAnyOpener(data)) {
      const matches = collectMatchesInText(data);
      for (const { start, end, suffix } of matches) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        ensureHighlight(suffix).add(range);
        newRanges.push({ suffix, range });
      }
    }
    node = walker.nextNode();
  }

  if (newRanges.length > 0) {
    rangesByContainer.set(container, newRanges);
  }
}

function isHighlightApiAvailable() {
  return (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.CSS !== 'undefined' &&
    globalThis.CSS &&
    typeof globalThis.CSS.highlights !== 'undefined' &&
    typeof globalThis.Highlight === 'function'
  );
}

export function register(hooks, context) {
  const logger = context && context.logger
    ? context.logger
    : {
        info: (...args) => console.info('[dialogue-colorize]', ...args),
      };

  if (!isHighlightApiAvailable()) {
    logger.info(
      'CSS Custom Highlight API unavailable; dialogue-colorize is a no-op on this browser',
    );
    return;
  }

  hooks.register(
    'chapter:dom:ready',
    (ctx) => {
      const container = ctx && ctx.container;
      if (!(container instanceof HTMLElement)) return;
      try {
        colorize(container);
      } catch (err) {
        logger.info(
          'dialogue-colorize handler error:',
          err && err.message ? err.message : err,
        );
      }
    },
    100,
  );

  hooks.register(
    'chapter:dom:dispose',
    (ctx) => {
      const container = ctx && ctx.container;
      if (!(container instanceof HTMLElement)) return;
      try {
        clearPriorRanges(container);
      } catch (err) {
        logger.info(
          'dialogue-colorize dispose error:',
          err && err.message ? err.message : err,
        );
      }
    },
    100,
  );
}

// Exported for tests only — kept on a side-channel to avoid bloating the
// public plugin contract surface.
export const __test__ = {
  PAIRS,
  PAIR_REGEXES,
  collectMatchesInText,
  colorize,
  clearPriorRanges,
  highlightBySuffix,
  rangesByContainer,
  isHighlightApiAvailable,
};
