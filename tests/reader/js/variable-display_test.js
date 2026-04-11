// js/variable-display.test.js — Tests for variable-display extraction and rendering

import { assert as assertTrue, assertEquals } from '@std/assert';
import { extractVariableBlocks, renderVariableBlock } from '../../../reader/js/variable-display.js';

// ── renderVariableBlock ──

Deno.test('renderVariableBlock', async (t) => {
  await t.step('renders complete block with "變數更新詳情" summary', () => {
    const html = renderVariableBlock('some content', true);
    assertTrue(html.includes('變數更新詳情'));
    assertTrue(html.includes('class="variable-block'));
  });

  await t.step('renders incomplete block with "變數更新中..." summary', () => {
    const html = renderVariableBlock('partial', false);
    assertTrue(html.includes('變數更新中...'));
  });

  await t.step('escapes HTML in content', () => {
    const html = renderVariableBlock('<script>alert("xss")</script>', true);
    assertTrue(html.includes('&lt;script&gt;'));
    assertTrue(!html.includes('<script>alert'));
  });

  await t.step('trims whitespace from content', () => {
    const html = renderVariableBlock('  hello  ', true);
    assertTrue(html.includes('>hello<'));
  });

  await t.step('renders as collapsed details element (no open attribute)', () => {
    const html = renderVariableBlock('data', true);
    assertTrue(html.includes('<details'));
    assertTrue(!html.includes('open'));
  });
});

// ── extractVariableBlocks ──

Deno.test('extractVariableBlocks', async (t) => {
  await t.step('extracts complete <UpdateVariable> block', () => {
    const input = 'before <UpdateVariable>data</UpdateVariable> after';
    const { text, blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 1);
    assertTrue(text.includes('<!--VARIABLE_BLOCK_0-->'));
    assertTrue(!text.includes('<UpdateVariable>'));
    assertTrue(blocks[0].html.includes('變數更新詳情'));
  });

  await t.step('extracts incomplete <UpdateVariable> block (no closing tag)', () => {
    const input = 'before <UpdateVariable>streaming data';
    const { text, blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 1);
    assertTrue(text.includes('<!--VARIABLE_BLOCK_0-->'));
    assertTrue(blocks[0].html.includes('變數更新中...'));
  });

  await t.step('extracts short form <update> tag', () => {
    const input = '<update>content</update>';
    const { text, blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 1);
    assertTrue(text.includes('<!--VARIABLE_BLOCK_0-->'));
  });

  await t.step('extracts incomplete short form <update> tag', () => {
    const input = 'text <update>partial content';
    const { text, blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 1);
    assertTrue(blocks[0].html.includes('變數更新中...'));
  });

  await t.step('handles both complete and incomplete blocks', () => {
    const input = '<UpdateVariable>done</UpdateVariable> then <UpdateVariable>streaming';
    const { text, blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 2);
    assertTrue(blocks[0].html.includes('變數更新詳情'));
    assertTrue(blocks[1].html.includes('變數更新中...'));
  });

  await t.step('returns original text when no variable blocks exist', () => {
    const { text, blocks } = extractVariableBlocks('plain text');
    assertEquals(text, 'plain text');
    assertEquals(blocks.length, 0);
  });

  await t.step('is case-insensitive for tag matching', () => {
    const input = '<updatevariable>data</UPDATEVARIABLE>';
    const { blocks } = extractVariableBlocks(input);
    assertEquals(blocks.length, 1);
  });
});
