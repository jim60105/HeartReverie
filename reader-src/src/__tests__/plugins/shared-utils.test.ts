// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

// Contract tests for plugins/_shared/utils.js helpers.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type UtilsModule = {
  escapeHtml: (s: string) => string;
  getPluginSettings: (hooks: unknown) => Record<string, unknown>;
  createPluginLogger: (
    context: unknown,
    tag: string,
  ) => { info: (...args: unknown[]) => void };
};

let utils: UtilsModule;

beforeAll(async () => {
  // @ts-expect-error — plain JS plugin module, no type declaration
  utils = await import("../../../../plugins/_shared/utils.js");
});

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(utils.escapeHtml(`<a href="b">&'</a>`)).toBe(
      "&lt;a href=&quot;b&quot;&gt;&amp;&#x27;&lt;/a&gt;",
    );
  });
});

describe("getPluginSettings", () => {
  it("returns {} when hooks is missing", () => {
    expect(utils.getPluginSettings(undefined)).toEqual({});
    expect(utils.getPluginSettings(null)).toEqual({});
  });

  it("returns {} when getSettings is not a function", () => {
    expect(utils.getPluginSettings({})).toEqual({});
    expect(utils.getPluginSettings({ getSettings: "nope" })).toEqual({});
  });

  it("returns {} when getSettings returns null or a primitive", () => {
    expect(utils.getPluginSettings({ getSettings: () => null })).toEqual({});
    expect(utils.getPluginSettings({ getSettings: () => 42 })).toEqual({});
    expect(utils.getPluginSettings({ getSettings: () => "str" })).toEqual({});
  });

  it("returns {} when getSettings returns an array", () => {
    expect(utils.getPluginSettings({ getSettings: () => [1, 2] })).toEqual({});
  });

  it("returns the object when getSettings returns one", () => {
    const value = { enabled: true, foo: "bar" };
    expect(utils.getPluginSettings({ getSettings: () => value })).toBe(value);
  });
});

describe("createPluginLogger", () => {
  const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

  afterEach(() => {
    infoSpy.mockClear();
  });

  it("returns the provided logger when context.logger.info is a function", () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = utils.createPluginLogger({ logger }, "tag");
    expect(result).toBe(logger);
  });

  it("falls back to a console.info-backed logger when context is missing", () => {
    const result = utils.createPluginLogger(undefined, "demo");
    result.info("hello", 1);
    expect(infoSpy).toHaveBeenCalledWith("[demo]", "hello", 1);
  });

  it("falls back when context.logger lacks .info", () => {
    const result = utils.createPluginLogger(
      { logger: { warn: vi.fn() } },
      "demo",
    );
    result.info("x");
    expect(infoSpy).toHaveBeenCalledWith("[demo]", "x");
  });

  it("uses a generic prefix when tag is empty", () => {
    const result = utils.createPluginLogger(undefined, "");
    result.info("y");
    expect(infoSpy).toHaveBeenCalledWith("[plugin]", "y");
  });
});
