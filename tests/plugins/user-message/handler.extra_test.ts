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

import { assertEquals } from "@std/assert";
import type {
  HookHandler,
  HookStage,
  PluginHooks,
} from "../../../writer/types.ts";
import { createLogger } from "../../../writer/lib/logger.ts";
import { register } from "../../../plugins/user-message/handler.ts";

const testLogger = createLogger("plugin", {
  baseData: { plugin: "user-message" },
});

/**
 * A minimal hooks recorder that captures the registered handler so the test
 * can drive it directly — bypassing HookDispatcher's automatic
 * `context.logger` injection. This lets us cover the
 * `(context.logger as Logger | undefined) ?? logger` fallback branch.
 */
function makeRecordingHooks(): {
  hooks: PluginHooks;
  registered: Array<
    { stage: HookStage; handler: HookHandler; priority?: number }
  >;
} {
  const registered: Array<
    { stage: HookStage; handler: HookHandler; priority?: number }
  > = [];
  const hooks: PluginHooks = {
    register(stage, handler, priority) {
      registered.push({ stage, handler, priority });
    },
  };
  return { hooks, registered };
}

Deno.test("user-message handler — additional coverage", async (t) => {
  await t.step(
    "registers exactly one pre-write handler at priority 100",
    () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      assertEquals(registered.length, 1);
      assertEquals(registered[0]!.stage, "pre-write");
      assertEquals(registered[0]!.priority, 100);
    },
  );

  await t.step(
    "falls back to the closure logger when context.logger is missing",
    async () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      const handler = registered[0]!.handler;
      // No logger present in context — handler must NOT throw and must still
      // wrap the message correctly via the `?? logger` fallback.
      const ctx: Record<string, unknown> = {
        message: "fallback-test",
        preContent: "",
      };
      await handler(ctx);
      assertEquals(
        ctx.preContent,
        "<user_message>\nfallback-test\n</user_message>\n\n",
      );
    },
  );

  await t.step(
    "uses context.logger when present (overrides closure logger)",
    async () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      const handler = registered[0]!.handler;
      // Provide an explicit context.logger to exercise the non-fallback path.
      const calls: Array<{ level: string; msg: string }> = [];
      const ctxLogger = {
        debug: (msg: string) => calls.push({ level: "debug", msg }),
        info: (msg: string) => calls.push({ level: "info", msg }),
        warn: (msg: string) => calls.push({ level: "warn", msg }),
        error: (msg: string) => calls.push({ level: "error", msg }),
        withContext: () => ctxLogger,
      };
      const ctx: Record<string, unknown> = {
        message: "ctx-logger-test",
        preContent: "",
        logger: ctxLogger,
      };
      await handler(ctx);
      assertEquals(
        ctx.preContent,
        "<user_message>\nctx-logger-test\n</user_message>\n\n",
      );
      // Confirm the per-context logger received the wrap debug log.
      assertEquals(
        calls.some((c) => c.level === "debug" && c.msg.includes("Wrapped")),
        true,
      );
    },
  );

  await t.step(
    "non-string message is treated as empty (skip-wrapping branch)",
    async () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      const handler = registered[0]!.handler;
      const calls: string[] = [];
      const ctxLogger = {
        debug: (msg: string) => calls.push(msg),
        info: () => {},
        warn: () => {},
        error: () => {},
        withContext: () => ctxLogger,
      };
      // `message` is undefined — the `typeof message === "string"` guard fails
      // and we hit the skip branch. `preContent` must remain untouched.
      const ctx: Record<string, unknown> = {
        preContent: "untouched",
        logger: ctxLogger,
      };
      await handler(ctx);
      assertEquals(ctx.preContent, "untouched");
      assertEquals(calls.some((m) => m.includes("Skipping")), true);
    },
  );

  await t.step(
    "numeric message value is treated as non-string and skipped",
    async () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      const handler = registered[0]!.handler;
      const ctx: Record<string, unknown> = {
        message: 42,
        preContent: "",
      };
      await handler(ctx);
      // typeof message === "string" is false → skip path → preContent untouched.
      assertEquals(ctx.preContent, "");
    },
  );

  await t.step(
    "preserves a pre-existing preContent on the empty-message skip path",
    async () => {
      const { hooks, registered } = makeRecordingHooks();
      register({ hooks, logger: testLogger });
      const handler = registered[0]!.handler;
      // Earlier hook already wrote something into preContent — the user-message
      // handler must NOT clobber it when message is empty.
      const ctx: Record<string, unknown> = {
        message: "",
        preContent: "<other>\nprior\n</other>\n",
      };
      await handler(ctx);
      assertEquals(ctx.preContent, "<other>\nprior\n</other>\n");
    },
  );
});
