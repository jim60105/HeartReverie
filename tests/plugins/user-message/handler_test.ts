// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { assertEquals } from "@std/assert";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { register } from "../../../plugins/user-message/handler.ts";

Deno.test("user-message handler", async (t) => {
  await t.step("sets preContent with user_message tags", async () => {
    const hd = new HookDispatcher();
    register(hd);

    const ctx: Record<string, unknown> = {
      message: "Hello world",
      chapterPath: "/tmp/001.md",
      storyDir: "/tmp/story",
      series: "test",
      name: "test-story",
      preContent: "",
    };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "<user_message>\nHello world\n</user_message>\n\n");
  });

  await t.step("preserves empty preContent when message is empty", async () => {
    const hd = new HookDispatcher();
    register(hd);

    const ctx: Record<string, unknown> = {
      message: "",
      chapterPath: "/tmp/001.md",
      storyDir: "/tmp/story",
      series: "test",
      name: "test-story",
      preContent: "",
    };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "");
  });

  await t.step("registers at default priority 100", async () => {
    const hd = new HookDispatcher();
    const order: string[] = [];

    // Register a handler at priority 50 (should run before user-message)
    hd.register("pre-write", async () => {
      order.push("early");
    }, 50);

    register(hd);

    // Register a handler at priority 200 (should run after user-message)
    hd.register("pre-write", async () => {
      order.push("late");
    }, 200);

    const ctx: Record<string, unknown> = {
      message: "test",
      preContent: "",
    };
    await hd.dispatch("pre-write", ctx);
    assertEquals(order, ["early", "late"]);
    assertEquals(ctx.preContent, "<user_message>\ntest\n</user_message>\n\n");
  });

  await t.step("handles multiline messages", async () => {
    const hd = new HookDispatcher();
    register(hd);

    const ctx: Record<string, unknown> = {
      message: "line 1\nline 2\nline 3",
      preContent: "",
    };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "<user_message>\nline 1\nline 2\nline 3\n</user_message>\n\n");
  });
});
