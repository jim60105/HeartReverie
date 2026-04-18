// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import {
  useNotification,
  __resetNotificationStateForTests,
} from "@/composables/useNotification";

function installNotificationStub(
  permission: NotificationPermission = "default",
  ctor?: ReturnType<typeof vi.fn>,
): ReturnType<typeof vi.fn> {
  const NotifCtor = ctor ?? vi.fn();
  const stub = Object.assign(NotifCtor, {
    permission,
    requestPermission: vi.fn(async () => permission),
  });
  vi.stubGlobal("Notification", stub);
  return stub as ReturnType<typeof vi.fn>;
}

describe("useNotification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installNotificationStub("default");
    __resetNotificationStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("notify creates a toast in the queue", () => {
    const { notify, toasts } = useNotification();
    const id = notify({ title: "hello", channel: "in-app" });
    expect(id).toBeTruthy();
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.title).toBe("hello");
    expect(toasts.value[0]!.level).toBe("info");
  });

  it("dismiss removes toast", () => {
    const { notify, dismiss, toasts } = useNotification();
    const id = notify({ title: "x", channel: "in-app" });
    expect(toasts.value).toHaveLength(1);
    dismiss(id);
    expect(toasts.value).toHaveLength(0);
  });

  it("auto-dismisses after duration", () => {
    const { notify, toasts } = useNotification();
    notify({ title: "x", channel: "in-app", duration: 1000 });
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(toasts.value).toHaveLength(0);
  });

  it("persistent when duration is 0", () => {
    const { notify, toasts } = useNotification();
    notify({ title: "x", channel: "in-app", duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);
  });

  it("defaults: warning/error = 8000ms, info/success = 5000ms", () => {
    const { notify, toasts } = useNotification();
    notify({ title: "info", level: "info", channel: "in-app" });
    notify({ title: "warn", level: "warning", channel: "in-app", position: "bottom-right" });
    vi.advanceTimersByTime(5001);
    expect(toasts.value.some((t) => t.title === "info")).toBe(false);
    expect(toasts.value.some((t) => t.title === "warn")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(toasts.value.some((t) => t.title === "warn")).toBe(false);
  });

  it("caps at 5 per position, evicts oldest", () => {
    const { notify, toasts } = useNotification();
    for (let i = 0; i < 7; i++) {
      notify({ title: `t${i}`, channel: "in-app", duration: 0, position: "top-right" });
    }
    const atPos = toasts.value.filter((t) => t.position === "top-right");
    expect(atPos).toHaveLength(5);
    expect(atPos.map((t) => t.title)).toEqual(["t2", "t3", "t4", "t5", "t6"]);
  });

  it("cap applies per position independently", () => {
    const { notify, toasts } = useNotification();
    for (let i = 0; i < 6; i++) {
      notify({ title: `a${i}`, channel: "in-app", duration: 0, position: "top-right" });
    }
    for (let i = 0; i < 3; i++) {
      notify({ title: `b${i}`, channel: "in-app", duration: 0, position: "bottom-left" });
    }
    expect(toasts.value.filter((t) => t.position === "top-right")).toHaveLength(5);
    expect(toasts.value.filter((t) => t.position === "bottom-left")).toHaveLength(3);
  });

  it("singleton state is shared across callers", () => {
    const a = useNotification();
    const b = useNotification();
    a.notify({ title: "shared", channel: "in-app", duration: 0 });
    expect(b.toasts.value).toHaveLength(1);
    expect(b.toasts.value[0]!.title).toBe("shared");
  });

  it("system channel silently drops when denied", () => {
    const NotifCtor = installNotificationStub("denied");
    __resetNotificationStateForTests();
    const { notify, toasts } = useNotification();
    const id = notify({ title: "sys", channel: "system" });
    expect(id).toBe("");
    expect(toasts.value).toHaveLength(0);
    expect(NotifCtor).not.toHaveBeenCalled();
  });

  it("system channel uses Notification when granted", () => {
    const NotifCtor = installNotificationStub("granted");
    __resetNotificationStateForTests();
    const { notify, toasts } = useNotification();
    notify({ title: "sys", channel: "system", body: "hey" });
    expect(NotifCtor).toHaveBeenCalledTimes(1);
    expect(NotifCtor).toHaveBeenCalledWith("sys", { body: "hey" });
    expect(toasts.value).toHaveLength(0);
  });

  it("auto channel falls back to in-app when denied", () => {
    installNotificationStub("denied");
    __resetNotificationStateForTests();
    const { notify, toasts } = useNotification();
    notify({ title: "auto", channel: "auto", duration: 0 });
    expect(toasts.value).toHaveLength(1);
  });

  it("auto channel does not prompt when page hidden", () => {
    const NotifCtor = installNotificationStub("default");
    __resetNotificationStateForTests();
    const visSpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const { notify, toasts } = useNotification();
      notify({ title: "auto", channel: "auto", duration: 0 });
      expect(toasts.value).toHaveLength(1);
      const reqPermission = (NotifCtor as unknown as { requestPermission: ReturnType<typeof vi.fn> })
        .requestPermission;
      expect(reqPermission).not.toHaveBeenCalled();
    } finally {
      visSpy.mockRestore();
    }
  });

  it("permissionState is 'unsupported' when Notification API missing", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Notification", undefined);
    __resetNotificationStateForTests();
    const { permissionState } = useNotification();
    expect(permissionState.value).toBe("unsupported");
  });

  it("requestPermission updates permissionState", async () => {
    installNotificationStub("default");
    __resetNotificationStateForTests();
    const stub = (globalThis as unknown as { Notification: { requestPermission: ReturnType<typeof vi.fn> } })
      .Notification;
    stub.requestPermission.mockResolvedValue("granted");
    const { requestPermission, permissionState } = useNotification();
    const result = await requestPermission();
    expect(result).toBe("granted");
    expect(permissionState.value).toBe("granted");
  });
});
