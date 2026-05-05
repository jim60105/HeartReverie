import { isReadingRoute } from "@/router/isReadingRoute";

describe("isReadingRoute", () => {
  it("rejects exactly /settings", () => {
    expect(isReadingRoute("/settings")).toBe(false);
  });

  it("rejects /settings/* child paths", () => {
    expect(isReadingRoute("/settings/prompt-editor")).toBe(false);
    expect(isReadingRoute("/settings/llm")).toBe(false);
  });

  it("rejects exactly /tools", () => {
    expect(isReadingRoute("/tools")).toBe(false);
  });

  it("rejects /tools/* child paths", () => {
    expect(isReadingRoute("/tools/new-series")).toBe(false);
    expect(isReadingRoute("/tools/import-character-card")).toBe(false);
  });

  it("accepts /settings-archive/<story> (substring is not prefix)", () => {
    expect(isReadingRoute("/settings-archive/x")).toBe(true);
  });

  it("accepts /tools-archive/<story> (substring is not prefix)", () => {
    expect(isReadingRoute("/tools-archive/x")).toBe(true);
  });

  it("accepts a regular two-segment story path", () => {
    expect(isReadingRoute("/storyA/storyB")).toBe(true);
  });

  it("accepts the root /", () => {
    expect(isReadingRoute("/")).toBe(true);
  });

  it("accepts a chapter path", () => {
    expect(isReadingRoute("/storyA/storyB/chapter/3")).toBe(true);
  });
});
