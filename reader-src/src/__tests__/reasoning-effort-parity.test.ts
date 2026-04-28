// Parity test: locks the frontend `REASONING_EFFORTS` tuple in
// `reader-src/src/types/index.ts` against the backend tuple in
// `writer/types.ts`. The two toolchains (Vite/TS vs Deno) cannot share a
// literal import (the backend file uses Deno-flavored imports that won't
// resolve under Vite). Instead, we read the backend source from disk and
// regex-extract the tuple at test time.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { REASONING_EFFORTS } from "@/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function extractBackendTuple(): readonly string[] {
  const path = resolve(__dirname, "../../../writer/types.ts");
  const source = readFileSync(path, "utf8");
  const match = source.match(
    /export\s+const\s+REASONING_EFFORTS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
  );
  if (!match) {
    throw new Error(
      "Could not locate `export const REASONING_EFFORTS = [ ... ] as const` in writer/types.ts. " +
        "The backend tuple must be declared so the parity test can verify it matches the frontend.",
    );
  }
  const inner = match[1]!;
  return inner
    .split(",")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .map((s: string) => s.replace(/^["']|["']$/g, ""));
}

describe("REASONING_EFFORTS parity", () => {
  it("frontend tuple matches backend tuple in writer/types.ts", () => {
    const backend = extractBackendTuple();
    expect(JSON.stringify(backend)).toBe(JSON.stringify([...REASONING_EFFORTS]));
  });
});
