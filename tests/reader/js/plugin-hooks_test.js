// js/plugin-hooks.test.js — Tests for FrontendHookDispatcher

import { assert as assertTrue, assertEquals, assertStrictEquals } from '@std/assert';
import { FrontendHookDispatcher } from '../../../reader/js/plugin-hooks.js';

Deno.test('FrontendHookDispatcher', async (t) => {
  await t.step('registers and dispatches a handler', () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    d.register('frontend-render', () => { called = true; });
    d.dispatch('frontend-render', {});
    assertTrue(called);
  });

  await t.step('passes context to handler', () => {
    const d = new FrontendHookDispatcher();
    d.register('frontend-render', (ctx) => { ctx.value = 42; });
    const ctx = {};
    d.dispatch('frontend-render', ctx);
    assertEquals(ctx.value, 42);
  });

  await t.step('returns context from dispatch', () => {
    const d = new FrontendHookDispatcher();
    const ctx = { x: 1 };
    const result = d.dispatch('frontend-render', ctx);
    assertStrictEquals(result, ctx);
  });

  await t.step('runs handlers in priority order (lower first)', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('frontend-render', () => order.push('low'), 10);
    d.register('frontend-render', () => order.push('high'), 200);
    d.register('frontend-render', () => order.push('mid'), 100);
    d.dispatch('frontend-render', {});
    assertEquals(order, ['low', 'mid', 'high']);
  });

  await t.step('uses default priority of 100', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('frontend-render', () => order.push('first-default'));
    d.register('frontend-render', () => order.push('early'), 50);
    d.dispatch('frontend-render', {});
    assertEquals(order, ['early', 'first-default']);
  });

  await t.step('isolates errors — other handlers still run', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('frontend-render', () => order.push('before'), 1);
    d.register('frontend-render', () => { throw new Error('boom'); }, 2);
    d.register('frontend-render', () => order.push('after'), 3);
    d.dispatch('frontend-render', {});
    assertEquals(order, ['before', 'after']);
  });

  await t.step('returns context unchanged for unregistered stage', () => {
    const d = new FrontendHookDispatcher();
    const ctx = { key: 'value' };
    const result = d.dispatch('unknown', ctx);
    assertStrictEquals(result, ctx);
    assertEquals(result.key, 'value');
  });

  await t.step('supports multiple handlers on the same stage', () => {
    const d = new FrontendHookDispatcher();
    let count = 0;
    d.register('frontend-render', () => count++);
    d.register('frontend-render', () => count++);
    d.register('frontend-render', () => count++);
    d.dispatch('frontend-render', {});
    assertEquals(count, 3);
  });

  await t.step('rejects invalid stage names', () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    d.register('frontend-strip', () => { called = true; });
    d.dispatch('frontend-strip', {});
    assertTrue(!called);
  });
});
