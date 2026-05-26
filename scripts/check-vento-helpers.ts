// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Drift check: ensures both the backend canonical `writer/lib/vento-helpers.ts`
// and the frontend mirror `reader-src/src/lib/template.ts` agree with the
// actual default filter registry exposed by ventojs at runtime. Exits
// non-zero if any of the three lists diverge so CI/pre-commit catches
// upstream changes or mismatched mirrors.

import vento from "ventojs";
import { VENTO_HELPERS as BACKEND_HELPERS } from "../writer/lib/vento-helpers.ts";
import { VENTO_HELPERS as FRONTEND_HELPERS } from "../reader-src/src/lib/template.ts";

const env = vento();
const actual = Object.keys(env.filters).sort();
const backend = [...BACKEND_HELPERS].sort();
const frontend = [...FRONTEND_HELPERS].sort();

function diff(declared: string[]): { missing: string[]; extra: string[] } {
  return {
    missing: actual.filter((k) => !declared.includes(k)),
    extra: declared.filter((k) => !actual.includes(k)),
  };
}

const backendDiff = diff(backend);
const frontendDiff = diff(frontend);
const mirrorDrift = backend.join(",") !== frontend.join(",");

const fail = backendDiff.missing.length > 0 ||
  backendDiff.extra.length > 0 ||
  frontendDiff.missing.length > 0 ||
  frontendDiff.extra.length > 0 ||
  mirrorDrift;

if (fail) {
  console.error("VENTO_HELPERS drift detected");
  console.error("  runtime: ", actual);
  console.error("  backend: ", backend);
  console.error("  frontend:", frontend);
  if (backendDiff.missing.length > 0) console.error("  backend missing:", backendDiff.missing);
  if (backendDiff.extra.length > 0) console.error("  backend extra:  ", backendDiff.extra);
  if (frontendDiff.missing.length > 0) console.error("  frontend missing:", frontendDiff.missing);
  if (frontendDiff.extra.length > 0) console.error("  frontend extra:  ", frontendDiff.extra);
  if (mirrorDrift) console.error("  backend vs frontend mirror mismatch");
  Deno.exit(1);
}
console.log(`VENTO_HELPERS in sync (${backend.length} entries):`, backend.join(", "));
