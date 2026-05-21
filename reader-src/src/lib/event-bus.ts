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

import { errorMessage } from "@/lib/errors";
type EventPayloads = {
  "plugin-settings:changed": {
    name: string;
    settings: Record<string, unknown>;
  };
};

type EventName = keyof EventPayloads;
type EventHandler<T extends EventName> = (payload: EventPayloads[T]) => void;

const listeners = new Map<EventName, Set<EventHandler<EventName>>>();

export function onEvent<T extends EventName>(
  event: T,
  handler: EventHandler<T>,
): () => void {
  const set = listeners.get(event) ?? new Set<EventHandler<EventName>>();
  set.add(handler as EventHandler<EventName>);
  listeners.set(event, set);
  return () => {
    set.delete(handler as EventHandler<EventName>);
    if (set.size === 0) listeners.delete(event);
  };
}

export function emitEvent<T extends EventName>(
  event: T,
  payload: EventPayloads[T],
): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      (handler as EventHandler<T>)(payload);
    } catch (err: unknown) {
      console.warn(
        `[event-bus] handler for ${event} failed:`,
        errorMessage(err),
      );
    }
  }
}
