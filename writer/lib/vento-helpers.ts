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
 * Canonical Vento built-in pipe-filter list (backend-side authoritative copy).
 *
 * The frontend file `reader-src/src/lib/template.ts` MUST mirror this list
 * exactly; `scripts/check-vento-helpers.ts` verifies both the backend list
 * against `ventoEnv.filters` upstream AND the frontend mirror against this
 * file, so any divergence breaks CI.
 *
 * Backend imports (lint pipeline variable catalog, drift check) read from
 * this module; the frontend cannot import across the writer/reader-src
 * boundary at container build time (the `deno-cache` stage caches the
 * backend before `reader-src/` is copied), so the frontend keeps its own
 * literal mirror enforced by the drift script.
 */
export const VENTO_HELPERS = [
  "empty",
  "escape",
  "unescape",
] as const;

/** Union type of valid Vento helper names. */
export type VentoHelper = typeof VENTO_HELPERS[number];
