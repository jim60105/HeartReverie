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

import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import { registerTemplateReadRoutes } from "./templates-read.ts";
import { registerTemplateValidateRoutes } from "./templates-validate.ts";
import { registerTemplateWriteRoutes } from "./templates-write.ts";

export function registerTemplateRoutes(app: Hono, deps: AppDeps): void {
  registerTemplateReadRoutes(app, deps);
  registerTemplateValidateRoutes(app, deps);
  registerTemplateWriteRoutes(app, deps);
}
