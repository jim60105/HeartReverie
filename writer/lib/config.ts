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

import { join, resolve } from "@std/path";

const ROOT_DIR: string = resolve(import.meta.dirname!, "../..");
const PLAYGROUND_DIR: string =
  Deno.env.get("PLAYGROUND_DIR") || join(ROOT_DIR, "playground");
const READER_DIR: string = Deno.env.get("READER_DIR") || join(ROOT_DIR, "reader-dist");
const PLUGINS_DIR: string = join(ROOT_DIR, "plugins");
const PORT: number = parseInt(Deno.env.get("PORT") || "8443", 10);
const CERT_FILE: string | undefined = Deno.env.get("CERT_FILE");
const KEY_FILE: string | undefined = Deno.env.get("KEY_FILE");
const LLM_API_URL: string =
  Deno.env.get("LLM_API_URL") || "https://openrouter.ai/api/v1/chat/completions";
const LLM_MODEL: string =
  Deno.env.get("LLM_MODEL") || "deepseek/deepseek-v3.2";

/** Parse a numeric env var with a fallback default. */
function numEnv(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const LLM_TEMPERATURE: number = numEnv("LLM_TEMPERATURE", 0.1);
const LLM_FREQUENCY_PENALTY: number = numEnv("LLM_FREQUENCY_PENALTY", 0.13);
const LLM_PRESENCE_PENALTY: number = numEnv("LLM_PRESENCE_PENALTY", 0.52);
const LLM_TOP_K: number = numEnv("LLM_TOP_K", 10);
const LLM_TOP_P: number = numEnv("LLM_TOP_P", 0);
const LLM_REPETITION_PENALTY: number = numEnv("LLM_REPETITION_PENALTY", 1.2);
const LLM_MIN_P: number = numEnv("LLM_MIN_P", 0);
const LLM_TOP_A: number = numEnv("LLM_TOP_A", 1);
const BACKGROUND_IMAGE: string =
  Deno.env.get("BACKGROUND_IMAGE") || "/assets/heart.webp";
const PROMPT_FILE: string = (() => {
  const raw = Deno.env.get("PROMPT_FILE");
  if (!raw) return join(PLAYGROUND_DIR, "_prompts", "system.md");
  // Resolve relative paths against ROOT_DIR
  return raw.startsWith("/") ? raw : resolve(ROOT_DIR, raw);
})();

export {
  ROOT_DIR,
  PLAYGROUND_DIR,
  READER_DIR,
  PLUGINS_DIR,
  PORT,
  CERT_FILE,
  KEY_FILE,
  LLM_API_URL,
  LLM_MODEL,
  LLM_TEMPERATURE,
  LLM_FREQUENCY_PENALTY,
  LLM_PRESENCE_PENALTY,
  LLM_TOP_K,
  LLM_TOP_P,
  LLM_REPETITION_PENALTY,
  LLM_MIN_P,
  LLM_TOP_A,
  BACKGROUND_IMAGE,
  PROMPT_FILE,
};
