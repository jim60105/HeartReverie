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
 * Safely extract a human-readable message from an unknown thrown value.
 *
 * Replaces the boilerplate `err instanceof Error ? err.message : String(err)`
 * idiom scattered across the codebase with a single source of truth.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
