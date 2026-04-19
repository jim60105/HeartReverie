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
