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

/**
 * Structured validation error. The shape is i18n-ready: `messageKey` is a
 * stable identifier, `params` carries the keyword parameters for templating.
 */
export interface ValidationError {
  readonly path: string;
  readonly keyword: string;
  readonly messageKey: string;
  readonly params: Record<string, unknown>;
}

/**
 * Per-invocation context for the validator. `format: "path"` requires the
 * project root and the hardcoded allowlist; pure-shape validations do not.
 */
export interface ValidateOptions {
  readonly projectRoot?: string;
  readonly hardcodedPathRoots?: readonly string[];
  readonly absolutePathRoots?: readonly string[];
}

export interface InternalContext {
  readonly errors: ValidationError[];
  readonly options: ValidateOptions;
  readonly seenUnknownKeywords: Set<string>;
}

export const KEYWORDS_HANDLED = new Set([
  // structural / type
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  // numeric
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // string
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // array
  "minItems",
  "maxItems",
  "uniqueItems",
  // annotation (no validation)
  "title",
  "description",
  "default",
  "writeOnly",
  "examples",
  "$schema",
  "$id",
  "$comment",
]);

export const KNOWN_X_KEYWORDS = new Set([
  "x-show-when",
  "x-options-url",
  "x-format",
  "x-path-roots",
  "x-previous-names",
  "x-legacy",
  "x-schema-version",
]);

export const FORMAT_WHITELIST = new Set([
  "path",
  "color",
  "url",
  "email",
  "uuid",
]);
