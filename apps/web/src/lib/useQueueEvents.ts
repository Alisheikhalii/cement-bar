'use client';
import { useEffect, useRef } from 'react';
import { QUEUE_EVENT_NAMES, type QueueEventName, type QueueSseEvent } from '@cb/shared';

const EVENTS_URL = '/api/events';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Parse one named SSE message into the shared `QueueSseEvent` shape. The event name is authoritative
 * (browsers deliver it separately from `data`); a malformed body yields null and is ignored.
 */
export function parseQueueSseEvent(type: QueueEventName, data: string): QueueSseEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as Record<string, unknown>;
  return {
    type,
    tenantId: str(body.tenantId) ?? '',
    hallId: str(body.hallId),
    userId: str(body.userId),
    at: str(body.at) ?? '',
    payload: record(body.payload),
  };
}

/**
 * Subscribe to the queue event stream (`GET /api/events`) for the signed-in driver.
 *
 * Client-only and safe under SSR: no `window`/`EventSource` access at module load. Reconnection is the
 * browser's native EventSource behaviour; a stale session simply ends the stream and API calls still
 * drive the UI. The handler is kept in a ref so a new function identity never reopens the connection.
 */
export function useQueueEvents(handler: (ev: QueueSseEvent) => void, enabled = true): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    try {
      source = new EventSource(EVENTS_URL);
    } catch {
      return;
    }
    const es = source;
    const listeners: [QueueEventName, (event: Event) => void][] = QUEUE_EVENT_NAMES.map((name) => {
      const listener = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (typeof message.data !== 'string') return;
        const parsed = parseQueueSseEvent(name, message.data);
        if (parsed) handlerRef.current(parsed);
      };
      es.addEventListener(name, listener);
      return [name, listener];
    });

    return () => {
      for (const [name, listener] of listeners) es.removeEventListener(name, listener);
      es.close();
    };
  }, [enabled]);
}
