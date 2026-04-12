describe("useBackground", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getBackground() {
    const mod = await import("@/composables/useBackground");
    return mod.useBackground();
  }

  it("backgroundUrl starts empty", async () => {
    const bg = await getBackground();
    expect(bg.backgroundUrl.value).toBe("");
  });

  it("applyBackground sets body background style", async () => {
    const bg = await getBackground();
    await bg.applyBackground();
    expect(document.body.style.backgroundImage).toContain("url(");
  });

  it("applyBackground uses default URL when backgroundUrl is empty", async () => {
    const bg = await getBackground();
    await bg.applyBackground();
    expect(document.body.style.backgroundImage).toContain("heart.webp");
  });

  it("applyBackground uses custom URL when set", async () => {
    const bg = await getBackground();
    bg.backgroundUrl.value = "/custom/bg.png";
    await bg.applyBackground();
    expect(document.body.style.backgroundImage).toContain("/custom/bg.png");
  });

  it("sets backgroundSize to cover", async () => {
    const bg = await getBackground();
    await bg.applyBackground();
    expect(document.body.style.backgroundSize).toBe("cover");
  });

  it("sets backgroundPosition to center", async () => {
    const bg = await getBackground();
    await bg.applyBackground();
    expect(document.body.style.backgroundPosition).toBe("center center");
  });
});
