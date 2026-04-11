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

import { assertEquals, assertMatch } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { verifyPassphrase, validateParams } from "../../../writer/lib/middleware.ts";

function createTestApp(middleware: MiddlewareHandler) {
  const app = new Hono();
  app.use("/*", middleware);
  app.all("/*", (c) => c.json({ ok: true }));
  return app;
}

Deno.test("verifyPassphrase", async (t) => {
  await t.step("calls next() with correct passphrase", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "test-secret");

    const app = createTestApp(verifyPassphrase);
    const res = await app.fetch(new Request("http://localhost/test", {
      headers: { "x-passphrase": "test-secret" },
    }));

    assertEquals(res.status, 200);
    if (original !== undefined) Deno.env.set("PASSPHRASE", original);
    else Deno.env.delete("PASSPHRASE");
  });

  await t.step("returns 401 for wrong passphrase", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "correct-pass");

    const app = createTestApp(verifyPassphrase);
    const res = await app.fetch(new Request("http://localhost/test", {
      headers: { "x-passphrase": "wrong-pass" },
    }));
    const body = await res.json();

    assertEquals(res.status, 401);
    assertEquals(body.title, "Unauthorized");
    if (original !== undefined) Deno.env.set("PASSPHRASE", original);
    else Deno.env.delete("PASSPHRASE");
  });

  await t.step("returns 401 for missing passphrase header", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "test-secret");

    const app = createTestApp(verifyPassphrase);
    const res = await app.fetch(new Request("http://localhost/test"));

    assertEquals(res.status, 401);
    if (original !== undefined) Deno.env.set("PASSPHRASE", original);
    else Deno.env.delete("PASSPHRASE");
  });

  await t.step("returns 503 when PASSPHRASE env var is not set", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.delete("PASSPHRASE");

    const app = createTestApp(verifyPassphrase);
    const res = await app.fetch(new Request("http://localhost/test", {
      headers: { "x-passphrase": "any" },
    }));
    const body = await res.json();

    assertEquals(res.status, 503);
    assertEquals(body.title, "Service Unavailable");
    if (original !== undefined) Deno.env.set("PASSPHRASE", original);
    else Deno.env.delete("PASSPHRASE");
  });

  await t.step("uses timing-safe comparison (always runs timingSafeEqual)", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "abc");

    // Different-length passphrase — should still return 401 without throwing
    const app = createTestApp(verifyPassphrase);
    const res = await app.fetch(new Request("http://localhost/test", {
      headers: { "x-passphrase": "a" },
    }));

    assertEquals(res.status, 401);
    if (original !== undefined) Deno.env.set("PASSPHRASE", original);
    else Deno.env.delete("PASSPHRASE");
  });

  await t.step("failed auth logs audit message via console.warn", async () => {
    const original = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "correct-pass");

    const warnCalls: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(args.join(" ")); };

    try {
      const app = createTestApp(verifyPassphrase);
      await app.fetch(new Request("http://localhost/test", {
        headers: { "x-passphrase": "wrong-pass" },
      }));

      const hasAuditLog = warnCalls.some((msg) => msg.includes("[auth]") && msg.includes("Rejected"));
      assertEquals(hasAuditLog, true, "console.warn should log [auth] rejection");
    } finally {
      console.warn = origWarn;
      if (original !== undefined) Deno.env.set("PASSPHRASE", original);
      else Deno.env.delete("PASSPHRASE");
    }
  });

  await t.step("passphrase value is NOT in audit log output", async () => {
    const original = Deno.env.get("PASSPHRASE");
    const secretPassphrase = "super-secret-value-12345";
    Deno.env.set("PASSPHRASE", secretPassphrase);

    const warnCalls: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(args.join(" ")); };

    try {
      const app = createTestApp(verifyPassphrase);
      await app.fetch(new Request("http://localhost/test", {
        headers: { "x-passphrase": "wrong" },
      }));

      for (const msg of warnCalls) {
        assertEquals(msg.includes(secretPassphrase), false, "Passphrase value must not appear in logs");
        assertEquals(msg.includes("wrong"), false, "Provided passphrase must not appear in logs");
      }
    } finally {
      console.warn = origWarn;
      if (original !== undefined) Deno.env.set("PASSPHRASE", original);
      else Deno.env.delete("PASSPHRASE");
    }
  });
});

Deno.test("validateParams", async (t) => {
  await t.step("calls next() for valid params", async () => {
    const app = new Hono();
    app.use("/:series/:name", validateParams);
    app.all("/:series/:name", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/my-series/my-story"),
    );
    assertEquals(res.status, 200);
  });

  await t.step("returns 400 for path traversal in param", async () => {
    const app = new Hono();
    app.use("/:series", validateParams);
    app.all("/:series", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/..%2Fetc"),
    );
    const body = await res.json();

    assertEquals(res.status, 400);
    assertMatch(body.detail, /Invalid parameter/);
  });

  await t.step("returns 400 for null byte in param", async () => {
    const app = new Hono();
    app.use("/:name", validateParams);
    app.all("/:name", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/foo%00bar"),
    );

    assertEquals(res.status, 400);
  });
});
