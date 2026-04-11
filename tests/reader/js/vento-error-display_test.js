// js/vento-error-display.test.js — Tests for Vento error rendering

import { assert as assertTrue } from '@std/assert';
import { renderVentoError } from '../../../reader/js/vento-error-display.js';

Deno.test('renderVentoError', async (t) => {
  await t.step('renders error card with message', () => {
    const html = renderVentoError({ message: 'Something broke' });
    assertTrue(html.includes('class="vento-error-card"'));
    assertTrue(html.includes('模板渲染錯誤'));
    assertTrue(html.includes('Something broke'));
  });

  await t.step('renders source file info', () => {
    const html = renderVentoError({ message: 'err', source: 'template.vto' });
    assertTrue(html.includes('檔案: template.vto'));
  });

  await t.step('renders source with line number', () => {
    const html = renderVentoError({ message: 'err', source: 'a.vto', line: 42 });
    assertTrue(html.includes('檔案: a.vto (行 42)'));
  });

  await t.step('renders suggestion', () => {
    const html = renderVentoError({ message: 'err', suggestion: 'Try this' });
    assertTrue(html.includes('💡 Try this'));
  });

  await t.step('omits source section when source is missing', () => {
    const html = renderVentoError({ message: 'err' });
    assertTrue(!html.includes('class="vento-error-source"'));
  });

  await t.step('omits suggestion section when suggestion is missing', () => {
    const html = renderVentoError({ message: 'err' });
    assertTrue(!html.includes('class="vento-error-suggestion"'));
  });

  await t.step('omits line number when line is missing but source is present', () => {
    const html = renderVentoError({ message: 'err', source: 'b.vto' });
    assertTrue(html.includes('檔案: b.vto'));
    assertTrue(!html.includes('行'));
  });

  await t.step('escapes HTML in message', () => {
    const html = renderVentoError({ message: '<img onerror=alert(1)>' });
    assertTrue(html.includes('&lt;img onerror=alert(1)&gt;'));
    assertTrue(!html.includes('<img onerror'));
  });

  await t.step('escapes HTML in source', () => {
    const html = renderVentoError({ message: 'x', source: '<b>bad</b>' });
    assertTrue(html.includes('&lt;b&gt;bad&lt;/b&gt;'));
  });

  await t.step('escapes HTML in suggestion', () => {
    const html = renderVentoError({ message: 'x', suggestion: '& use <code>' });
    assertTrue(html.includes('&amp; use &lt;code&gt;'));
  });

  await t.step('renders all fields together', () => {
    const html = renderVentoError({
      message: 'Undefined variable',
      source: 'main.vto',
      line: 7,
      suggestion: 'Check variable name',
    });
    assertTrue(html.includes('Undefined variable'));
    assertTrue(html.includes('main.vto (行 7)'));
    assertTrue(html.includes('Check variable name'));
  });
});
