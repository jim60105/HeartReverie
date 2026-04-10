// js/utils.test.js — Tests for escapeHtml utility

import { assertEquals } from '@std/assert';
import { escapeHtml } from './utils.js';

Deno.test('escapeHtml', async (t) => {
  await t.step('escapes & to &amp;', () => {
    assertEquals(escapeHtml('a & b'), 'a &amp; b');
  });

  await t.step('escapes < and > to &lt; and &gt;', () => {
    assertEquals(escapeHtml('<div>'), '&lt;div&gt;');
  });

  await t.step('escapes " to &quot;', () => {
    assertEquals(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  });

  await t.step("escapes ' to &#x27;", () => {
    assertEquals(escapeHtml("it's"), "it&#x27;s");
  });

  await t.step('returns empty string unchanged', () => {
    assertEquals(escapeHtml(''), '');
  });

  await t.step('returns safe string unchanged', () => {
    assertEquals(escapeHtml('hello world'), 'hello world');
  });

  await t.step('escapes multiple special chars in one string', () => {
    assertEquals(
      escapeHtml('<a href="x">&'),
      '&lt;a href=&quot;x&quot;&gt;&amp;'
    );
  });

  await t.step('escapes all five special chars together', () => {
    assertEquals(
      escapeHtml(`&<>"'`),
      '&amp;&lt;&gt;&quot;&#x27;'
    );
  });
});
