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
import { Hono } from "@hono/hono";
import { rateLimiter } from "../app.js";

function createRateLimitApp({ windowMs, limit }) {
  const app = new Hono();
  app.use("/*", rateLimiter({ windowMs, limit }));
  app.all("/*", (c) => c.json({ ok: true }));
  return app;
}

function makeReq(app, ip = "127.0.0.1") {
  return app.fetch(
    new Request("http://localhost/test"),
    { remoteAddr: { hostname: ip } },
  );
}

Deno.test({ name: "rateLimiter", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  await t.step("requests within limit succeed", async () => {
    const app = createRateLimitApp({ windowMs: 60_000, limit: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await makeReq(app);
      assertEquals(res.status, 200);
    }
  });

  await t.step("requests over limit get 429", async () => {
    const app = createRateLimitApp({ windowMs: 60_000, limit: 3 });
    for (let i = 0; i < 3; i++) {
      await makeReq(app);
    }
    const res = await makeReq(app);
    assertEquals(res.status, 429);
    const body = await res.json();
    assertEquals(body.status, 429);
  });

  await t.step("window reset allows new requests", async () => {
    const app = createRateLimitApp({ windowMs: 50, limit: 1 });
    const res1 = await makeReq(app);
    assertEquals(res1.status, 200);

    const res2 = await makeReq(app);
    assertEquals(res2.status, 429);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 100));

    const res3 = await makeReq(app);
    assertEquals(res3.status, 200);
  });

  await t.step("different IPs are tracked independently", async () => {
    const app = createRateLimitApp({ windowMs: 60_000, limit: 1 });

    const res1 = await makeReq(app, "10.0.0.1");
    assertEquals(res1.status, 200);

    const res2 = await makeReq(app, "10.0.0.2");
    assertEquals(res2.status, 200);

    // First IP is now over limit
    const res3 = await makeReq(app, "10.0.0.1");
    assertEquals(res3.status, 429);

    // Second IP is now over limit
    const res4 = await makeReq(app, "10.0.0.2");
    assertEquals(res4.status, 429);
  });
} });
