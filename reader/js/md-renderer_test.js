// js/md-renderer.test.js — Tests for reinjectPlaceholders (pure function)

import { assertEquals } from '@std/assert';
import { reinjectPlaceholders } from './md-renderer.js';

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
});
