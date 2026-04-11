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

import { join, resolve } from "@std/path";

const ROOT_DIR: string = resolve(import.meta.dirname!, "../..");
const PLAYGROUND_DIR: string =
  Deno.env.get("PLAYGROUND_DIR") || join(ROOT_DIR, "playground");
const READER_DIR: string = Deno.env.get("READER_DIR") || join(ROOT_DIR, "reader");
const PLUGINS_DIR: string = join(ROOT_DIR, "plugins");
const PORT: number = parseInt(Deno.env.get("PORT") || "8443", 10);
const CERT_FILE: string | undefined = Deno.env.get("CERT_FILE");
const KEY_FILE: string | undefined = Deno.env.get("KEY_FILE");
const OPENROUTER_API_URL: string = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL: string =
  Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-v3.2";

export {
  ROOT_DIR,
  PLAYGROUND_DIR,
  READER_DIR,
  PLUGINS_DIR,
  PORT,
  CERT_FILE,
  KEY_FILE,
  OPENROUTER_API_URL,
  OPENROUTER_MODEL,
};
