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

import { ref } from 'vue';
import type {
  UseWebSocketReturn,
  WsClientMessage,
  WsServerMessage,
} from '@/types';

// ── Module-level singleton state ──

const isConnected = ref(false);
const isAuthenticated = ref(false);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let intentionalClose = false;
let storedUrl = '';
let storedPassphrase = '';

const RECONNECT_CAP = 30000;

type MessageHandler = (msg: never) => void;
const handlers = new Map<string, Set<MessageHandler>>();

// ── Internal helpers ──

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (intentionalClose) return;
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createConnection(storedUrl, storedPassphrase);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_CAP);
}

function dispatch(msg: WsServerMessage): void {
  const set = handlers.get(msg.type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(msg as never);
    } catch {
      // Silent error handling
    }
  }
}

function createConnection(url: string, passphrase: string): void {
  // Clean up previous socket if any
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }

  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnected.value = true;
    reconnectDelay = 1000;
    // Authentication handshake
    send({ type: 'auth', passphrase });
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: WsServerMessage;
    try {
      msg = JSON.parse(event.data as string) as WsServerMessage;
    } catch {
      return;
    }

    if (msg.type === 'auth:ok') {
      isAuthenticated.value = true;
    } else if (msg.type === 'auth:error') {
      isAuthenticated.value = false;
    }

    dispatch(msg);
  };

  ws.onclose = () => {
    ws = null;
    isConnected.value = false;
    isAuthenticated.value = false;
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // The close event will follow; reconnection is handled there
  };
}

// ── Public API ──

/**
 * Send a typed message over the WebSocket.
 * Only sends if the socket is open.
 */
function send(message: WsClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Register a handler for a specific server message type.
 * Returns an unsubscribe function.
 */
function onMessage<T extends WsServerMessage['type']>(
  type: T,
  handler: (msg: Extract<WsServerMessage, { type: T }>) => void,
): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const wrapped = handler as MessageHandler;
  set.add(wrapped);
  return () => {
    set!.delete(wrapped);
    if (set!.size === 0) {
      handlers.delete(type);
    }
  };
}

/**
 * Open a WebSocket connection and authenticate.
 * Stores credentials for automatic reconnection.
 */
function connect(url: string, passphrase: string): void {
  intentionalClose = false;
  storedUrl = url;
  storedPassphrase = passphrase;
  reconnectDelay = 1000;
  clearReconnectTimer();
  createConnection(url, passphrase);
}

/**
 * Close the WebSocket and stop reconnection.
 * Handlers are preserved for potential future connections.
 */
function disconnect(): void {
  intentionalClose = true;
  clearReconnectTimer();
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  isConnected.value = false;
  isAuthenticated.value = false;
}

/** Singleton composable for WebSocket connection management. */
export function useWebSocket(): UseWebSocketReturn {
  return {
    isConnected,
    isAuthenticated,
    send,
    onMessage,
    connect,
    disconnect,
  };
}
