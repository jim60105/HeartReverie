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

import { join } from "@std/path";

/** Read the custom prompt file; fall back to system.md only when the custom file does not exist. */
export async function readTemplate(
  config: { PROMPT_FILE: string; ROOT_DIR: string },
): Promise<{ content: string; source: "custom" | "default" }> {
  try {
    const content = await Deno.readTextFile(config.PROMPT_FILE);
    return { content, source: "custom" };
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    const content = await Deno.readTextFile(join(config.ROOT_DIR, "system.md"));
    return { content, source: "default" };
  }
}
