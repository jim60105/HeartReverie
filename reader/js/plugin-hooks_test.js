// js/plugin-hooks.test.js — Tests for FrontendHookDispatcher

import { assert as assertTrue, assertEquals, assertStrictEquals } from '@std/assert';
import { FrontendHookDispatcher } from './plugin-hooks.js';

Deno.test('FrontendHookDispatcher', async (t) => {
  await t.step('registers and dispatches a handler', () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    d.register('test', () => { called = true; });
    d.dispatch('test', {});
    assertTrue(called);
  });

  await t.step('passes context to handler', () => {
    const d = new FrontendHookDispatcher();
    d.register('stage', (ctx) => { ctx.value = 42; });
    const ctx = {};
    d.dispatch('stage', ctx);
    assertEquals(ctx.value, 42);
  });

  await t.step('returns context from dispatch', () => {
    const d = new FrontendHookDispatcher();
    const ctx = { x: 1 };
    const result = d.dispatch('stage', ctx);
    assertStrictEquals(result, ctx);
  });

  await t.step('runs handlers in priority order (lower first)', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('s', () => order.push('low'), 10);
    d.register('s', () => order.push('high'), 200);
    d.register('s', () => order.push('mid'), 100);
    d.dispatch('s', {});
    assertEquals(order, ['low', 'mid', 'high']);
  });

  await t.step('uses default priority of 100', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('s', () => order.push('first-default'));
    d.register('s', () => order.push('early'), 50);
    d.dispatch('s', {});
    assertEquals(order, ['early', 'first-default']);
  });

  await t.step('isolates errors — other handlers still run', () => {
    const d = new FrontendHookDispatcher();
    const order = [];
    d.register('s', () => order.push('before'), 1);
    d.register('s', () => { throw new Error('boom'); }, 2);
    d.register('s', () => order.push('after'), 3);
    d.dispatch('s', {});
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
    d.register('s', () => count++);
    d.register('s', () => count++);
    d.register('s', () => count++);
    d.dispatch('s', {});
    assertEquals(count, 3);
  });

  await t.step('keeps stages independent', () => {
    const d = new FrontendHookDispatcher();
    let aCalled = false;
    let bCalled = false;
    d.register('a', () => { aCalled = true; });
    d.register('b', () => { bCalled = true; });
    d.dispatch('a', {});
    assertTrue(aCalled);
    assertTrue(!bCalled);
  });
});
