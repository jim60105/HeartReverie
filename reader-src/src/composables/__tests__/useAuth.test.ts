import { stubSessionStorage } from "@/__tests__/setup";

function mockFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      }),
    ),
  );
}

describe("useAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch(200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getUseAuth() {
    const mod = await import("@/composables/useAuth");
    return mod.useAuth();
  }

  it("initial state: passphrase empty, not authenticated", async () => {
    const auth = await getUseAuth();
    expect(auth.passphrase.value).toBe("");
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it("verify() with valid passphrase: sets isAuthenticated", async () => {
    mockFetch(200);
    const auth = await getUseAuth();
    const result = await auth.verify("secret123");
    expect(result).toBe(true);
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.passphrase.value).toBe("secret123");
  });

  it("verify() saves passphrase to sessionStorage", async () => {
    mockFetch(200);
    const auth = await getUseAuth();
    await auth.verify("mypass");
    expect(sessionStorage.setItem).toHaveBeenCalledWith("passphrase", "mypass");
  });

  it("verify() with invalid passphrase: remains not authenticated", async () => {
    mockFetch(401);
    const auth = await getUseAuth();
    const result = await auth.verify("wrong");
    expect(result).toBe(false);
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it("verify() with empty passphrase returns false", async () => {
    const auth = await getUseAuth();
    const result = await auth.verify("");
    expect(result).toBe(false);
  });

  it("verify() with no argument and empty passphrase returns false", async () => {
    const auth = await getUseAuth();
    const result = await auth.verify();
    expect(result).toBe(false);
  });

  it("getAuthHeaders() returns headers with passphrase when set", async () => {
    mockFetch(200);
    const auth = await getUseAuth();
    await auth.verify("pass123");
    const headers = auth.getAuthHeaders();
    expect(headers["X-Passphrase"]).toBe("pass123");
  });

  it("getAuthHeaders() returns empty object when no passphrase", async () => {
    const auth = await getUseAuth();
    const headers = auth.getAuthHeaders();
    expect(headers["X-Passphrase"]).toBeUndefined();
  });

  it("sessionStorage persistence: restores passphrase on module load", async () => {
    (sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
      "restored",
    );
    const auth = await getUseAuth();
    expect(auth.passphrase.value).toBe("restored");
  });

  it("verify() catches network errors and returns false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network"))),
    );
    const auth = await getUseAuth();
    const result = await auth.verify("test");
    expect(result).toBe(false);
  });
});
