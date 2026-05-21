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

import { errorMessage } from "../../writer/lib/errors.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import type { DynamicVariableContext } from "../../writer/types.ts";

const FRAGMENT_FILE = join(
  dirname(fromFileUrl(import.meta.url)),
  "think-before-reply.md",
);

export async function getDynamicVariables(
  context: DynamicVariableContext,
): Promise<Record<string, unknown>> {
  const settings = await context.getSettings?.() ?? {};
  const injectInstruction = settings.injectInstruction !== false;

  if (!injectInstruction) {
    return { think_before_reply: "" };
  }

  try {
    const content = await Deno.readTextFile(FRAGMENT_FILE);
    return { think_before_reply: content };
  } catch (err: unknown) {
    const message = errorMessage(err);
    console.error(
      `[thinking] Failed to read think-before-reply.md: ${message}`,
    );
    return { think_before_reply: "" };
  }
}
