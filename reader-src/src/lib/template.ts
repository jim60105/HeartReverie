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
 * Source of truth for the Vento built-in pipe-filter names that the template
 * editor offers as autocomplete after `|>`. Kept in sync with the actual
 * `ventoEnv.filters` set registered by ventojs@^2.3.1 via the CI drift script
 * `scripts/check-vento-helpers.ts`; any addition or removal in upstream
 * ventojs MUST be reflected here in the same commit, otherwise CI fails.
 *
 * The literal `as const` cast pins the tuple type so consumers (CodeMirror
 * completion sources, lint pipeline variable catalog) get exhaustive
 * narrowing.
 */
export const VENTO_HELPERS = [
  "empty",
  "escape",
  "unescape",
] as const;

/** Union type of valid Vento helper names. */
export type VentoHelper = typeof VENTO_HELPERS[number];
