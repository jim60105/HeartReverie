// js/plugin-loader.js — Load frontend plugin modules from backend

import { FrontendHookDispatcher } from './plugin-hooks.js';
import { getAuthHeaders } from './passphrase-gate.js';

export const frontendHooks = new FrontendHookDispatcher();
let initialized = false;

export async function initPlugins() {
  if (initialized) return;
  try {
    const res = await fetch('/api/plugins', { headers: getAuthHeaders() });
    if (!res.ok) { console.warn('Failed to load plugins:', res.status); return; }
    const plugins = await res.json();

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
