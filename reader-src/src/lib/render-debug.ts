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

/**
 * Opt-in render-pipeline instrumentation.
 *
 * Enabled when either:
 *   - `import.meta.env.VITE_RENDER_DEBUG` is truthy at build time, OR
 *   - `localStorage.getItem("RENDER_DEBUG") === "true"` at runtime.
 *
 * Used to confirm or rule out the residual reload race described in
 * `openspec/changes/fix-frontend-render-on-edit-and-reload/design.md`
 * (Decision 6) without leaving permanent console noise.
 */
function isEnabled(): boolean {
  try {
    const envFlag = (import.meta as { env?: Record<string, unknown> }).env?.VITE_RENDER_DEBUG;
    if (envFlag) return true;
  } catch {
    // import.meta.env not available — fall through
  }
  try {
    if (typeof localStorage !== "undefined"
      && localStorage.getItem("RENDER_DEBUG") === "true") {
      return true;
    }
  } catch {
    // localStorage may throw in restricted contexts
  }
  return false;
}

export function renderDebug(event: string, payload?: unknown): void {
  if (!isEnabled()) return;
  if (payload === undefined) {
    console.debug(`[render-debug] ${event}`);
  } else {
    console.debug(`[render-debug] ${event}`, payload);
  }
}
