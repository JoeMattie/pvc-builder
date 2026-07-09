// Dev-only bridge between an external process (Claude Code / curl) and the live
// browser session, so the running model + selection + every `window.__pvc` seam
// can be queried and driven from outside the browser. Relay hub only — it holds
// no app logic; it forwards RPC to the browser and fans out live store-change
// events. `apply: 'serve'` keeps it out of production builds entirely (CLAUDE.md:
// no runtime network in prod). See docs/CODE-MAP.md → `vite/`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

/** How long a `/__pvc/call` waits for the browser to answer before erroring. */
const CALL_TIMEOUT_MS = 15_000;
/** Bounded history of live events kept for pull-style `?since=` catch-up. */
const EVENT_BUFFER_CAP = 500;

// ── pure, unit-tested cores ────────────────────────────────────────────────

/** Correlates outstanding `/__pvc/call` requests with the browser's results by
 * a monotonic id. No I/O — the plugin owns the timers and drives settle(). */
export class PendingRegistry {
  private seq = 0;
  private readonly map = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  /** Allocate the next request id. */
  next(): number {
    this.seq += 1;
    return this.seq;
  }

  add(id: number, resolve: (v: unknown) => void, reject: (e: Error) => void): void {
    this.map.set(id, { resolve, reject });
  }

  /** Resolve/reject the pending call for `id`. Returns false if unknown (already
   * settled or timed out) so the caller can ignore stray results. */
  settle(id: number, ok: boolean, payload: unknown): boolean {
    const p = this.map.get(id);
    if (!p) return false;
    this.map.delete(id);
    if (ok) p.resolve(payload);
    else p.reject(new Error(typeof payload === 'string' ? payload : 'browser error'));
    return true;
  }

  /** Reject everything still outstanding (e.g. the browser disconnected). */
  rejectAll(message: string): void {
    for (const p of this.map.values()) p.reject(new Error(message));
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export interface BufferedEvent {
  seq: number;
  event: unknown;
}

/** Bounded ring of live store-change events. Sequence numbers stay monotonic
 * even after the oldest entries are dropped, so `since()` never replays a gap. */
export class EventRing {
  private readonly buf: BufferedEvent[] = [];
  private seq = 0;

  constructor(private readonly cap = EVENT_BUFFER_CAP) {}

  push(event: unknown): BufferedEvent {
    this.seq += 1;
    const rec: BufferedEvent = { seq: this.seq, event };
    this.buf.push(rec);
    if (this.buf.length > this.cap) this.buf.shift();
    return rec;
  }

  /** Events with seq strictly greater than `after`. */
  since(after: number): BufferedEvent[] {
    return this.buf.filter((r) => r.seq > after);
  }

  get lastSeq(): number {
    return this.seq;
  }
}

// ── plugin ─────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  // flush headers + defeat proxy buffering
  res.write(': pvc-bridge connected\n\n');
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function pvcBridgePlugin(): Plugin {
  return {
    name: 'pvc-bridge',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const pending = new PendingRegistry();
      const ring = new EventRing();
      // The browser command channel (most-recent connection wins) + live watchers.
      let browser: ServerResponse | null = null;
      const watchers = new Set<ServerResponse>();

      // keep SSE connections alive through idle periods / proxies
      const heartbeat = setInterval(() => {
        if (browser) browser.write(': ping\n\n');
        for (const w of watchers) w.write(': ping\n\n');
      }, 25_000);
      server.httpServer?.on('close', () => clearInterval(heartbeat));

      const sendCommand = (id: number, method: string, args: unknown[]): boolean => {
        if (!browser) return false;
        writeSse(browser, { id, method, args });
        return true;
      };

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/__pvc/')) return next();
        const path = url.split('?')[0];

        // browser → hub: long-lived command stream (RPC commands to execute)
        if (path === '/__pvc/commands' && req.method === 'GET') {
          openSse(res);
          if (browser) browser.end(); // supersede a stale tab
          browser = res;
          req.on('close', () => {
            if (browser === res) {
              browser = null;
              pending.rejectAll('browser session disconnected');
            }
          });
          return;
        }

        // browser → hub: an RPC result
        if (path === '/__pvc/result' && req.method === 'POST') {
          void readBody(req).then((raw) => {
            try {
              const { id, ok, result, error } = JSON.parse(raw) as {
                id: number;
                ok: boolean;
                result?: unknown;
                error?: string;
              };
              pending.settle(id, ok, ok ? result : error);
            } catch {
              /* ignore malformed result */
            }
            sendJson(res, 200, { ok: true });
          });
          return;
        }

        // browser → hub: a live store-change event to fan out
        if (path === '/__pvc/event' && req.method === 'POST') {
          void readBody(req).then((raw) => {
            try {
              const event = JSON.parse(raw);
              const rec = ring.push(event);
              for (const w of watchers) writeSse(w, rec);
            } catch {
              /* ignore malformed event */
            }
            sendJson(res, 200, { ok: true });
          });
          return;
        }

        // requester → hub: invoke a `__pvc` seam in the browser, await the result
        if (path === '/__pvc/call' && req.method === 'POST') {
          void readBody(req).then((raw) => {
            let method: string;
            let args: unknown[];
            try {
              const parsed = JSON.parse(raw) as { method?: string; args?: unknown[] };
              if (typeof parsed.method !== 'string') throw new Error('missing "method"');
              method = parsed.method;
              args = Array.isArray(parsed.args) ? parsed.args : [];
            } catch (e) {
              sendJson(res, 400, { ok: false, error: (e as Error).message });
              return;
            }
            if (!browser) {
              sendJson(res, 503, {
                ok: false,
                error:
                  'no browser session connected — is `npm run dev` open in a tab with a design loaded?',
              });
              return;
            }
            const id = pending.next();
            const timer = setTimeout(() => {
              if (pending.settle(id, false, `timeout after ${CALL_TIMEOUT_MS}ms`)) {
                sendJson(res, 504, { ok: false, error: `timeout waiting for browser (${method})` });
              }
            }, CALL_TIMEOUT_MS);
            pending.add(
              id,
              (result) => {
                clearTimeout(timer);
                sendJson(res, 200, { ok: true, result });
              },
              (err) => {
                clearTimeout(timer);
                sendJson(res, 200, { ok: false, error: err.message });
              },
            );
            sendCommand(id, method, args);
          });
          return;
        }

        // requester → hub: live event SSE (for Monitor / curl -N tailing)
        if (path === '/__pvc/stream' && req.method === 'GET') {
          openSse(res);
          watchers.add(res);
          req.on('close', () => watchers.delete(res));
          return;
        }

        // requester → hub: pull buffered events since a sequence number
        if (path === '/__pvc/events' && req.method === 'GET') {
          const since = Number(new URL(url, 'http://localhost').searchParams.get('since') ?? 0);
          sendJson(res, 200, {
            lastSeq: ring.lastSeq,
            events: ring.since(Number.isFinite(since) ? since : 0),
          });
          return;
        }

        // requester → hub: connection health
        if (path === '/__pvc/health' && req.method === 'GET') {
          sendJson(res, 200, {
            browserConnected: browser !== null,
            watchers: watchers.size,
            pending: pending.size,
            lastSeq: ring.lastSeq,
          });
          return;
        }

        sendJson(res, 404, { ok: false, error: `unknown bridge route ${path}` });
      });

      server.config.logger.info('  \x1b[36m➜  PVC bridge:\x1b[0m  /__pvc/* (dev-only)');
    },
  };
}
