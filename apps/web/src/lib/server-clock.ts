'use client';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Server-synchronized clock.
 *
 * Business time on the client (countdowns, "days remaining", window open/close hints) must follow the
 * SERVER clock, never the device clock: drivers' phones are frequently wrong and a skewed clock would show
 * a window as open/closed incorrectly. Every API response carries `X-Server-Time`; the API client feeds it
 * here and we keep `offset = serverTime - deviceTime` (compensating half the round trip).
 *
 * `deviceNow()` is THE ONLY allowed read of the device clock in apps/web (GUIDELINES §1.1). Everything
 * else calls `serverNow()` / `useServerClock().now`. UI hints only — the backend enforces all time rules.
 */

let offsetMs = 0;
let synced = false;
const listeners = new Set<() => void>();

/** Raw device clock. Use only for measuring round-trip time and computing the offset. */
export function deviceNow(): number {
  return Date.now();
}

/** Record a server timestamp observed for a request sent at `sentAt` and received at `receivedAt`. */
export function recordServerTime(serverIso: string, sentAt: number, receivedAt: number): void {
  const server = Date.parse(serverIso);
  if (Number.isNaN(server)) return;
  const midpoint = sentAt + (receivedAt - sentAt) / 2;
  offsetMs = Math.round(server - midpoint);
  synced = true;
  listeners.forEach((l) => l());
}

export function serverNow(): number {
  return deviceNow() + offsetMs;
}

export function getServerOffset(): { offsetMs: number; synced: boolean } {
  return { offsetMs, synced };
}

/** Test helper. */
export function resetServerClock(): void {
  offsetMs = 0;
  synced = false;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useServerClock(): { now: () => number; offsetMs: number; synced: boolean } {
  const offset = useSyncExternalStore(
    subscribe,
    () => offsetMs,
    () => 0,
  );
  const isSynced = useSyncExternalStore(
    subscribe,
    () => synced,
    () => false,
  );
  const now = useCallback(() => serverNow(), []);
  return { now, offsetMs: offset, synced: isSynced };
}
