import {
  useNotification,
  __resetNotificationStateForTests,
} from "@/composables/useNotification";

function installNotificationStub(options: {
  permission?: NotificationPermission;
  throwOnConstruct?: boolean;
  requestImpl?: () => Promise<NotificationPermission>;
} = {}) {
  const ctor = vi.fn(function NotificationMock(title: string) {
    if (options.throwOnConstruct) {
      throw new Error(`failed:${title}`);
    }
  });
  const stub = Object.assign(ctor, {
    permission: options.permission ?? "default",
    requestPermission: vi.fn(options.requestImpl ?? (async () => options.permission ?? "default")),
  });
  vi.stubGlobal("Notification", stub);
  return stub as unknown as {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };
}

describe("useNotification additional coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetNotificationStateForTests();
  });

  it("system/default requests permission when page is visible", async () => {
    const stub = installNotificationStub({ permission: "default", requestImpl: async () => "granted" });
    __resetNotificationStateForTests();

    const { notify } = useNotification();
    expect(notify({ title: "system-visible", channel: "system" })).toBe("");
    await Promise.resolve();

    expect(stub.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("auto/granted falls back to toast when Notification constructor throws", () => {
    installNotificationStub({ permission: "granted", throwOnConstruct: true });
    __resetNotificationStateForTests();

    const { notify, toasts } = useNotification();
    notify({ title: "auto-fallback", channel: "auto", duration: 0 });

    expect(toasts.value.some((t) => t.title === "auto-fallback")).toBe(true);
  });

  it("requestPermission handles unsupported and exception paths", async () => {
    vi.stubGlobal("Notification", undefined);
    __resetNotificationStateForTests();

    const first = useNotification();
    expect(await first.requestPermission()).toBe("denied");
    expect(first.permissionState.value).toBe("unsupported");

    const stub = installNotificationStub({
      permission: "default",
      requestImpl: async () => {
        throw new Error("boom");
      },
    });
    __resetNotificationStateForTests();

    const second = useNotification();
    expect(await second.requestPermission()).toBe("denied");
    expect(stub.requestPermission).toHaveBeenCalled();
    expect(second.permissionState.value).toBe("denied");
  });

  it("auto/default visible requests permission and shows toast when denied", async () => {
    const stub = installNotificationStub({ permission: "default", requestImpl: async () => "denied" });
    __resetNotificationStateForTests();

    const { notify, toasts } = useNotification();
    expect(notify({ title: "auto-denied", channel: "auto", duration: 0 })).toBe("");
    await Promise.resolve();
    await Promise.resolve();

    expect(stub.requestPermission).toHaveBeenCalledTimes(1);
    expect(toasts.value.some((t) => t.title === "auto-denied")).toBe(true);
  });
});
