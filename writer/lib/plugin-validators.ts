// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Barrel module for pure plugin-manifest validators extracted from
 * `PluginManager`. Each validator lives in its own focused sibling file:
 *
 * - `plugin-validators-hooks.ts`           — `validateHookDeclarations`
 * - `plugin-validators-action-buttons.ts`  — `validateActionButtons`
 * - `plugin-validators-frontend-styles.ts` — `validateFrontendStyles`
 * - `plugin-validators-frontend-imports.ts` — `validateFrontendImports`
 * - `plugin-validators-schema.ts`          — `extractSchemaDefaults`
 *
 * Consumers inside the package import from this barrel; the per-domain
 * modules are also importable directly when tree-shaking matters.
 */

export { validateHookDeclarations } from "./plugin-validators-hooks.ts";
export { validateActionButtons } from "./plugin-validators-action-buttons.ts";
export { validateFrontendStyles } from "./plugin-validators-frontend-styles.ts";
export { validateFrontendImports } from "./plugin-validators-frontend-imports.ts";
export { extractSchemaDefaults } from "./plugin-validators-schema.ts";
