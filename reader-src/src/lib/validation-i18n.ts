// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Translation table for server-side validation `messageKey` values.
// Messages are written in Traditional Chinese (zh-TW) with full-width punctuation
// and a single ASCII-Chinese boundary space, per project convention.

export interface ValidationError {
  path: string;
  keyword: string;
  messageKey: string;
  params: Record<string, unknown>;
}

type Formatter = (params: Record<string, unknown>) => string;

function p(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join("、");
  return String(v);
}

const TABLE: Record<string, Formatter> = {
  type: (params) => `型別錯誤：必須為 ${p(params, "expected") || p(params, "type") || "正確型別"}`,
  required: (params) => {
    const name = p(params, "property") || p(params, "missing");
    return name ? `缺少必填欄位：${name}` : "缺少必填欄位";
  },
  enum: (params) => {
    const allowed = p(params, "allowed") || p(params, "enum");
    return allowed ? `值必須為下列之一：${allowed}` : "值不在允許清單中";
  },
  const: (params) => {
    const v = p(params, "const");
    return v ? `值必須為 ${v}` : "值不符合常數限制";
  },
  pattern: (params) => {
    const pat = p(params, "pattern");
    return pat ? `值不符合格式：${pat}` : "值不符合格式要求";
  },
  minLength: (params) => `長度不可少於 ${p(params, "minLength") || p(params, "limit")} 個字元`,
  maxLength: (params) => `長度不可超過 ${p(params, "maxLength") || p(params, "limit")} 個字元`,
  minimum: (params) => `數值不可小於 ${p(params, "minimum") || p(params, "limit")}`,
  maximum: (params) => `數值不可大於 ${p(params, "maximum") || p(params, "limit")}`,
  exclusiveMinimum: (params) =>
    `數值必須大於 ${p(params, "exclusiveMinimum") || p(params, "limit")}`,
  exclusiveMaximum: (params) =>
    `數值必須小於 ${p(params, "exclusiveMaximum") || p(params, "limit")}`,
  multipleOf: (params) => `數值必須為 ${p(params, "multipleOf") || p(params, "divisor")} 的倍數`,
  minItems: (params) => `項目數量不可少於 ${p(params, "minItems") || p(params, "limit")} 個`,
  maxItems: (params) => `項目數量不可超過 ${p(params, "maxItems") || p(params, "limit")} 個`,
  uniqueItems: () => "項目不可重複",
  additionalProperties: (params) => {
    const name = p(params, "property") || p(params, "additionalProperty");
    return name ? `不允許額外屬性：${name}` : "不允許額外屬性";
  },
  format: (params) => {
    const fmt = p(params, "format");
    return fmt ? `格式錯誤：${fmt}` : "格式錯誤";
  },
  schema_version_mismatch: (params) => {
    const v = p(params, "version") || p(params, "schemaVersion");
    return v
      ? `此插件宣告的 schema 版本（${v}）不受支援，請更新引擎或插件`
      : "插件 schema 版本不受支援";
  },
};

export function formatValidationError(err: ValidationError): string {
  const formatter = TABLE[err.messageKey];
  if (formatter) {
    try {
      return formatter(err.params ?? {});
    } catch {
      // fall through to generic
    }
  }
  return formatGeneric(err);
}

function formatGeneric(err: ValidationError): string {
  const parts: string[] = [];
  parts.push(`驗證失敗（${err.keyword || err.messageKey || "unknown"}）`);
  const params = err.params ?? {};
  const keys = Object.keys(params);
  if (keys.length > 0) {
    const detail = keys
      .map((k) => `${k}=${p(params, k)}`)
      .filter((s) => s.length > 0)
      .join("，");
    if (detail) parts.push(`：${detail}`);
  }
  return parts.join("");
}

export function hasMessageKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE, key);
}
