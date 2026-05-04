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
import { getTheme, listThemes } from "../lib/themes.ts";
import { problemJson } from "../lib/errors.ts";

export function registerThemeRoutes(app: Hono, _deps: AppDeps): void {
  app.get("/api/themes", (c) => {
    return c.json(listThemes());
  });

  app.get("/api/themes/:id", (c) => {
    const id = c.req.param("id");
    const theme = getTheme(id);
    if (!theme) {
      return c.json(problemJson("Not Found", 404, `Theme "${id}" not found`), 404);
    }
    return c.json(theme);
  });
}
