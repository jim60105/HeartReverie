// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { formatValidationError, hasMessageKey } from "@/lib/validation-i18n";

describe("validation-i18n", () => {
  it("formats known messageKeys in zh-TW", () => {
    expect(
      formatValidationError({
        path: "x",
        keyword: "minimum",
        messageKey: "minimum",
        params: { minimum: 50 },
      }),
    ).toContain("不可小於 50");
    expect(
      formatValidationError({
        path: "x",
        keyword: "enum",
        messageKey: "enum",
        params: { allowed: ["a", "b"] },
      }),
    ).toContain("a、b");
    expect(
      formatValidationError({
        path: "x",
        keyword: "pattern",
        messageKey: "pattern",
        params: { pattern: "^[a-z]+$" },
      }),
    ).toContain("^[a-z]+$");
    expect(
      formatValidationError({
        path: "x",
        keyword: "required",
        messageKey: "required",
        params: { property: "name" },
      }),
    ).toContain("name");
  });

  it("falls back to generic formatter for unknown messageKeys", () => {
    const msg = formatValidationError({
      path: "x",
      keyword: "custom-rule",
      messageKey: "novel_thing",
      params: { foo: "bar" },
    });
    expect(msg).toContain("custom-rule");
    expect(msg).toContain("foo=bar");
  });

  it("knows the documented keys", () => {
    for (const k of [
      "type",
      "required",
      "enum",
      "const",
      "pattern",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "minItems",
      "maxItems",
      "uniqueItems",
      "additionalProperties",
      "format",
      "schema_version_mismatch",
    ]) {
      expect(hasMessageKey(k)).toBe(true);
    }
  });
});
