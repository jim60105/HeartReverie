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

import type { PluginRegisterContext } from "../../writer/types.ts";
import type { Logger } from "../../writer/lib/logger.ts";

/**
 * Register the pre-write hook that wraps user messages in <user_message> tags.
 */
export function register({ hooks, logger }: PluginRegisterContext): void {
  logger.info("Registering user-message plugin");

  hooks.register("pre-write", async (context) => {
    const log = (context.logger as Logger | undefined) ?? logger;
    const message = context.message as string;
    if (typeof message === "string" && message.length > 0) {
      context.preContent = `<user_message>\n${message}\n</user_message>\n\n`;
      log.debug("Wrapped user message in <user_message> tags", { messageLength: message.length });
    } else {
      log.debug("Skipping user message wrapping: empty message");
    }
  }, 100);
}
