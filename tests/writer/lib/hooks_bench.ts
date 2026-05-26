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

import { HookDispatcher } from "../../../writer/lib/hooks.ts";

function createSerialDispatcher(count: number, delayMs: number): HookDispatcher {
  const hd = new HookDispatcher();
  for (let i = 0; i < count; i++) {
    hd.register(
      "prompt-assembly",
      async () => {
        await new Promise((r) => setTimeout(r, delayMs));
      },
      100 + i,
      `serial-${i}`,
    );
  }
  return hd;
}

function createParallelDispatcher(count: number, delayMs: number): HookDispatcher {
  const hd = new HookDispatcher();
  for (let i = 0; i < count; i++) {
    hd.register(
      "post-response",
      async () => {
        await new Promise((r) => setTimeout(r, delayMs));
      },
      { parallel: true, readOnly: true, priority: 100 + i },
      `parallel-${i}`,
    );
  }
  return hd;
}

// Suppress console output during benchmarks
const noop = () => {};
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

Deno.bench("dispatch — 20 serial handlers @ 50ms", { group: "serial-vs-parallel" }, async () => {
  console.log = noop;
  console.warn = noop;
  console.error = noop;
  try {
    const hd = createSerialDispatcher(20, 50);
    await hd.dispatch("prompt-assembly", {});
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
});

Deno.bench("dispatch — 20 parallel handlers @ 50ms", { group: "serial-vs-parallel" }, async () => {
  console.log = noop;
  console.warn = noop;
  console.error = noop;
  try {
    const hd = createParallelDispatcher(20, 50);
    await hd.dispatch("post-response", {});
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
});
