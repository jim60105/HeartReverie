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

import type { InternalContext } from "./schema-validator-types.ts";

export function numericChecks(
  schema: Record<string, unknown>,
  value: number,
  path: string,
  ctx: InternalContext,
): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    ctx.errors.push({
      path,
      keyword: "minimum",
      messageKey: "minimum",
      params: { minimum: schema.minimum },
    });
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    ctx.errors.push({
      path,
      keyword: "maximum",
      messageKey: "maximum",
      params: { maximum: schema.maximum },
    });
  }
  if (
    typeof schema.exclusiveMinimum === "number" &&
    value <= schema.exclusiveMinimum
  ) {
    ctx.errors.push({
      path,
      keyword: "exclusiveMinimum",
      messageKey: "exclusiveMinimum",
      params: { exclusiveMinimum: schema.exclusiveMinimum },
    });
  }
  if (
    typeof schema.exclusiveMaximum === "number" &&
    value >= schema.exclusiveMaximum
  ) {
    ctx.errors.push({
      path,
      keyword: "exclusiveMaximum",
      messageKey: "exclusiveMaximum",
      params: { exclusiveMaximum: schema.exclusiveMaximum },
    });
  }
  if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
    const ratio = value / schema.multipleOf;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      ctx.errors.push({
        path,
        keyword: "multipleOf",
        messageKey: "multipleOf",
        params: { multipleOf: schema.multipleOf },
      });
    }
  }
}
