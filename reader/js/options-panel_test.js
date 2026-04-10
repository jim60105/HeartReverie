// js/options-panel.test.js — Tests for options-panel extraction, parsing, and rendering

import { assert as assertTrue, assertEquals } from '@std/assert';

// Stub DOM APIs needed at module load time (options-panel.js calls document.addEventListener)
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { addEventListener: () => {}, querySelector: () => null, getElementById: () => null };
}
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: () => Promise.resolve() } },
    writable: true,
    configurable: true,
  });
}

const { extractOptionsBlocks, parseOptions, renderOptionsPanel } = await import(
  './options-panel.js'
);

// ── parseOptions ──

Deno.test('parseOptions', async (t) => {
  await t.step('parses numbered options like "1: text"', () => {
    const input = '1: 前進\n2: 後退\n3: 觀察\n4: 休息';
    const items = parseOptions(input);
    assertEquals(items.length, 4);
    assertEquals(items[0], { number: 1, text: '前進' });
    assertEquals(items[3], { number: 4, text: '休息' });
  });

  await t.step('parses options with【】brackets', () => {
    const input = '1:【探索洞穴】\n2:【返回村莊】';
    const items = parseOptions(input);
    assertEquals(items.length, 2);
    assertEquals(items[0].text, '探索洞穴');
    assertEquals(items[1].text, '返回村莊');
  });

  await t.step('parses options with full-width colon', () => {
    const input = '1：往前走\n2：往後退';
    const items = parseOptions(input);
    assertEquals(items.length, 2);
    assertEquals(items[0].text, '往前走');
  });

  await t.step('parses "option1:" prefix style', () => {
    const input = 'option1: hello\noption2: world';
    const items = parseOptions(input);
    assertEquals(items.length, 2);
    assertEquals(items[0].text, 'hello');
    assertEquals(items[1].text, 'world');
  });

  await t.step('limits to 4 items maximum', () => {
    const input = '1: a\n2: b\n3: c\n4: d\n5: e';
    const items = parseOptions(input);
    assertEquals(items.length, 4);
  });

  await t.step('handles fewer than 4 options', () => {
    const input = '1: only one';
    const items = parseOptions(input);
    assertEquals(items.length, 1);
    assertEquals(items[0].text, 'only one');
  });

  await t.step('skips lines that do not match the option pattern', () => {
    const input = 'no match here\n2: valid';
    const items = parseOptions(input);
    assertEquals(items.length, 1);
    assertEquals(items[0].text, 'valid');
  });

  await t.step('returns empty array for unparseable content', () => {
    const items = parseOptions('no options here');
    assertEquals(items.length, 0);
  });

  await t.step('parses options with period separator', () => {
    const input = '1. 探索\n2. 逃跑';
    const items = parseOptions(input);
    assertEquals(items.length, 2);
    assertEquals(items[0].text, '探索');
    assertEquals(items[1].text, '逃跑');
  });

  await t.step('skips options where text is only whitespace', () => {
    const input = '1:   ';
    const items = parseOptions(input);
    assertEquals(items.length, 0);
  });

  await t.step('handles mixed separator styles', () => {
    const input = '1: first\n2. second\n3：third';
    const items = parseOptions(input);
    assertEquals(items.length, 3);
    assertEquals(items[0].text, 'first');
    assertEquals(items[1].text, 'second');
    assertEquals(items[2].text, 'third');
  });

  await t.step('returns empty array for empty input', () => {
    const items = parseOptions('');
    assertEquals(items.length, 0);
  });

  await t.step('parses option prefix with bracket style combined', () => {
    const input = 'option1:【探索洞穴】\noption2:【返回村莊】';
    const items = parseOptions(input);
    assertEquals(items.length, 2);
    assertEquals(items[0].text, '探索洞穴');
    assertEquals(items[1].text, '返回村莊');
  });
});

// ── renderOptionsPanel ──

Deno.test('renderOptionsPanel', async (t) => {
  await t.step('renders 4 grid cells (fills empty slots)', () => {
    const items = [
      { number: 1, text: 'A' },
      { number: 2, text: 'B' },
    ];
    const html = renderOptionsPanel(items);
    // 2 real buttons + 2 empty placeholders
    const btnCount = (html.match(/era-action-btn/g) || []).length;
    // 2 real + 2 empty = 4, but each has the class, empty has extra class
    assertTrue(btnCount >= 4);
    assertTrue(html.includes('era-action-btn--empty'));
  });

  await t.step('renders button text with data-option-text attribute', () => {
    const items = [{ number: 1, text: 'Go' }];
    const html = renderOptionsPanel(items);
    assertTrue(html.includes('data-option-text="Go"'));
    assertTrue(html.includes('<span class="era-action-num">1.</span> Go'));
  });

  await t.step('escapes HTML in option text', () => {
    const items = [{ number: 1, text: '<script>' }];
    const html = renderOptionsPanel(items);
    assertTrue(html.includes('&lt;script&gt;'));
    assertTrue(!html.includes('<script>'));
  });

  await t.step('renders header with title', () => {
    const items = [];
    const html = renderOptionsPanel(items);
    assertTrue(html.includes('行動選項'));
  });

  await t.step('renders all 4 items with no empty slots', () => {
    const items = [
      { number: 1, text: 'A' },
      { number: 2, text: 'B' },
      { number: 3, text: 'C' },
      { number: 4, text: 'D' },
    ];
    const html = renderOptionsPanel(items);
    // All 4 buttons, no empty placeholders
    assertTrue(!html.includes('era-action-btn--empty'));
    assertTrue(html.includes('data-option-text="A"'));
    assertTrue(html.includes('data-option-text="D"'));
  });

  await t.step('renders 4 empty cells when no items', () => {
    const html = renderOptionsPanel([]);
    const emptyCount = (html.match(/era-action-btn--empty/g) || []).length;
    assertEquals(emptyCount, 4);
  });
});

// ── extractOptionsBlocks ──

Deno.test('extractOptionsBlocks', async (t) => {
  await t.step('extracts options block and returns placeholder', () => {
    const input = 'text <options>1: Go\n2: Stay</options> more';
    const { text, blocks } = extractOptionsBlocks(input);
    assertEquals(blocks.length, 1);
    assertTrue(text.includes('<!--OPTIONS_BLOCK_0-->'));
    assertTrue(!text.includes('<options>'));
  });

  await t.step('renders HTML by default', () => {
    const input = '<options>1: A\n2: B</options>';
    const { blocks } = extractOptionsBlocks(input);
    assertTrue(blocks[0].html.includes('class="options-panel'));
  });

  await t.step('skips rendering when render option is false', () => {
    const input = '<options>1: A</options>';
    const { blocks } = extractOptionsBlocks(input, { render: false });
    assertEquals(blocks[0].html, '');
  });

  await t.step('returns original text when no options blocks exist', () => {
    const { text, blocks } = extractOptionsBlocks('nothing');
    assertEquals(text, 'nothing');
    assertEquals(blocks.length, 0);
  });

  await t.step('is case-insensitive for tag matching', () => {
    const input = '<Options>1: X</OPTIONS>';
    const { blocks } = extractOptionsBlocks(input);
    assertEquals(blocks.length, 1);
  });

  await t.step('extracts multiple options blocks with sequential placeholders', () => {
    const input = '<options>1: A</options> middle <options>1: B</options>';
    const { text, blocks } = extractOptionsBlocks(input);
    assertEquals(blocks.length, 2);
    assertTrue(text.includes('<!--OPTIONS_BLOCK_0-->'));
    assertTrue(text.includes('<!--OPTIONS_BLOCK_1-->'));
    assertTrue(text.includes('middle'));
  });
});
