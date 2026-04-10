// js/md-renderer.test.js — Tests for md-renderer pure functions

import { assert as assertTrue, assertEquals } from '@std/assert';

// Stub globals required by renderChapter before importing the module
globalThis.marked = { parse: (text, _opts) => `<p>${text}</p>` };
globalThis.DOMPurify = { sanitize: (html, _opts) => html };

import { reinjectPlaceholders, renderChapter } from './md-renderer.js';
import { frontendHooks } from './plugin-loader.js';

Deno.test('reinjectPlaceholders', async (t) => {
  await t.step('replaces a single placeholder', () => {
    const map = new Map([['<!--P0-->', '<div>hello</div>']]);
    const result = reinjectPlaceholders('before <!--P0--> after', map);
    assertEquals(result, 'before <div>hello</div> after');
  });

  await t.step('replaces multiple different placeholders', () => {
    const map = new Map([
      ['<!--A-->', '<a>'],
      ['<!--B-->', '<b>'],
    ]);
    const result = reinjectPlaceholders('<!--A--> and <!--B-->', map);
    assertEquals(result, '<a> and <b>');
  });

  await t.step('handles placeholder appearing multiple times in HTML', () => {
    const map = new Map([['<!--X-->', 'REPLACED']]);
    const result = reinjectPlaceholders('<!--X--> mid <!--X-->', map);
    assertEquals(result, 'REPLACED mid REPLACED');
  });

  await t.step('leaves text unchanged when placeholder is not found in HTML', () => {
    const map = new Map([['<!--MISSING-->', 'value']]);
    const result = reinjectPlaceholders('no placeholders here', map);
    assertEquals(result, 'no placeholders here');
  });

  await t.step('returns original HTML with empty map', () => {
    const map = new Map();
    const result = reinjectPlaceholders('<p>hello</p>', map);
    assertEquals(result, '<p>hello</p>');
  });

  await t.step('handles empty HTML string', () => {
    const map = new Map([['<!--P-->', 'val']]);
    const result = reinjectPlaceholders('', map);
    assertEquals(result, '');
  });

  await t.step('preserves surrounding content', () => {
    const map = new Map([['<!--STATUS_BLOCK_0-->', '<div class="status">ok</div>']]);
    const html = '<p>chapter start</p><!--STATUS_BLOCK_0--><p>chapter end</p>';
    const result = reinjectPlaceholders(html, map);
    assertEquals(result, '<p>chapter start</p><div class="status">ok</div><p>chapter end</p>');
  });

  await t.step('handles placeholder with special regex chars in value', () => {
    const map = new Map([['<!--P0-->', '$1 \\n (special)']]);
    const result = reinjectPlaceholders('<!--P0-->', map);
    assertEquals(result, '$1 \\n (special)');
  });
});

// ── renderChapter ──

Deno.test('renderChapter', async (t) => {
  await t.step('returns sanitized HTML for simple text', () => {
    const html = renderChapter('hello');
    assertTrue(typeof html === 'string');
    assertTrue(html.length > 0);
  });

  await t.step('normalises curly double quotes to ASCII', () => {
    // Use a marked mock that preserves input so we can inspect normalisation
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\u201cHello\u201d');
      assertTrue(captured.includes('"Hello"'), 'left/right curly quotes should become ASCII "');
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('normalises guillemets to ASCII quotes', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\u00abHello\u00bb');
      assertTrue(captured.includes('"Hello"'), 'guillemets should become ASCII "');
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('normalises CJK corner brackets to ASCII quotes', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\u300cHello\u300d');
      assertTrue(captured.includes('"Hello"'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('normalises halfwidth corner brackets', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\uff62Hello\uff63');
      assertTrue(captured.includes('"Hello"'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('normalises double angle brackets', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\u300aHello\u300b');
      assertTrue(captured.includes('"Hello"'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('normalises low-9 quotation mark', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('\u201eHello');
      assertTrue(captured.includes('"Hello'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('doubles newlines for markdown paragraph breaks', () => {
    const origParse = globalThis.marked.parse;
    let captured = '';
    globalThis.marked.parse = (text, _opts) => { captured = text; return text; };
    try {
      renderChapter('line1\nline2');
      assertTrue(captured.includes('line1\n\nline2'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('handles empty input', () => {
    const html = renderChapter('');
    assertTrue(typeof html === 'string');
  });

  await t.step('uses default empty options when none provided', () => {
    const html = renderChapter('text');
    assertTrue(typeof html === 'string');
  });

  await t.step('passes options through to hook context', () => {
    // frontendHooks has no registered hooks by default in test,
    // so this just verifies no crash with custom options
    const html = renderChapter('text', { custom: true });
    assertTrue(typeof html === 'string');
  });

  await t.step('calls DOMPurify.sanitize with correct config', () => {
    const origSanitize = globalThis.DOMPurify.sanitize;
    let capturedOpts = null;
    globalThis.DOMPurify.sanitize = (html, opts) => { capturedOpts = opts; return html; };
    try {
      renderChapter('test');
      assertTrue(capturedOpts !== null);
      assertTrue(capturedOpts.ADD_TAGS.includes('details'));
      assertTrue(capturedOpts.ADD_TAGS.includes('summary'));
      assertTrue(capturedOpts.ADD_ATTR.includes('open'));
    } finally {
      globalThis.DOMPurify.sanitize = origSanitize;
    }
  });

  await t.step('calls marked.parse with breaks option', () => {
    const origParse = globalThis.marked.parse;
    let capturedOpts = null;
    globalThis.marked.parse = (text, opts) => { capturedOpts = opts; return text; };
    try {
      renderChapter('test');
      assertTrue(capturedOpts !== null);
      assertEquals(capturedOpts.breaks, true);
    } finally {
      globalThis.marked.parse = origParse;
    }
  });

  await t.step('reinserts placeholders added by hooks into final HTML', () => {
    frontendHooks.register('frontend-render', (ctx) => {
      const placeholder = '<!--TEST_PH-->';
      ctx.text = ctx.text.replace('REPLACE_ME', placeholder);
      ctx.placeholderMap.set(placeholder, '<div>injected</div>');
    });

    const origParse = globalThis.marked.parse;
    globalThis.marked.parse = (text, _opts) => text;
    try {
      const html = renderChapter('before REPLACE_ME after');
      assertTrue(html.includes('<div>injected</div>'));
      assertTrue(html.includes('before'));
      assertTrue(html.includes('after'));
    } finally {
      globalThis.marked.parse = origParse;
    }
  });
});
