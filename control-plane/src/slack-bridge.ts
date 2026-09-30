// Slack Socket Mode → n8n (docs/02-trigger-intake.md). Outbound websocket, so no public URL is needed.
// The bridge only filters and forwards; parsing and decisions happen in n8n and the intake.

import { log } from './log.ts';
import { keys, type Store } from './store.ts';

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

export type ForwardDecision = { forward: true } | { forward: false; reason: string; notify?: boolean };

/** Pure filter: which Slack events become triggers. */
export function decide(e: SlackMessageEvent, channel: string | undefined, allowedUsers: string[]): ForwardDecision {
  if (e.type !== 'message') return { forward: false, reason: `event ${e.type}` };
  if (e.subtype) return { forward: false, reason: `subtype ${e.subtype}` };
  if (e.bot_id) return { forward: false, reason: 'bot message' };
  if (channel && e.channel !== channel) return { forward: false, reason: 'other channel' };
  if (e.thread_ts && e.thread_ts !== e.ts) return { forward: false, reason: 'thread reply' };
  if (!e.user || !e.ts) return { forward: false, reason: 'missing user/ts' };
  if (allowedUsers.length && !allowedUsers.includes(e.user)) return { forward: false, reason: 'user not allow-listed', notify: true };
  return { forward: true };
}

/** One Slack channel → one n8n webhook. An empty allow-list means anyone in the channel. */
export interface BridgeRoute {
  name: string;
  channel: string;
  allowedUsers: string[];
  forwardUrl: string;
}

export interface BridgeOptions {
  appToken: string;
  routes: BridgeRoute[];
  store: Store;
  onRejectedUser?: (e: SlackMessageEvent) => Promise<void>;
}

export class SlackBridge {
  private opts: BridgeOptions;
  private ws?: WebSocket;
  private stopped = false;
  private backoffMs = 1000;
  connected = false;

  constructor(opts: BridgeOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private async connect(): Promise<void> {
    try {
      const res = await fetch('https://slack.com/api/apps.connections.open', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.appToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) throw new Error(data.error ?? 'no url');
      const ws = new WebSocket(data.url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.backoffMs = 1000;
        log.ok('slack bridge connected (Socket Mode)');
      };
      ws.onmessage = (m) => void this.onMessage(String(m.data));
      ws.onclose = () => {
        this.connected = false;
        if (!this.stopped) this.reconnect('socket closed');
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    } catch (err) {
      this.reconnect(`connect failed: ${String(err)}`);
    }
  }

  private reconnect(why: string): void {
    log.warn(`slack bridge: ${why} — reconnecting in ${this.backoffMs / 1000}s`);
    setTimeout(() => void this.connect(), this.backoffMs).unref();
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
  }

  private async onMessage(raw: string): Promise<void> {
    let env: any;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    // Ack first: Slack redelivers anything not acknowledged within 3 seconds.
    if (env.envelope_id) this.ws?.send(JSON.stringify({ envelope_id: env.envelope_id }));
    if (env.type === 'disconnect') {
      log.info('slack asked us to reconnect');
      this.ws?.close();
      return;
    }
    if (env.type !== 'events_api') return;

    const e = env.payload?.event as SlackMessageEvent;
    const route = this.opts.routes.find((r) => r.channel === e.channel);
    if (!route) return;
    const d = decide(e, route.channel, route.allowedUsers);
    if (!d.forward) {
      if (d.notify) await this.opts.onRejectedUser?.(e);
      return;
    }
    // Dedupe Slack retries.
    if (!(await this.opts.store.acquire(keys.slackSeen(e.ts!), 24 * 3600))) return;

    log.step(`slack ${route.name} from ${e.user}: ${String(e.text ?? '').slice(0, 80).replace(/\s+/g, ' ')}`);
    try {
      const res = await fetch(route.forwardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: e.text ?? '', channel: e.channel, ts: e.ts, user: e.user }),
      });
      if (!res.ok) log.warn(`n8n webhook ${route.name} → ${res.status} (is the workflow published?)`);
    } catch (err) {
      log.error(`could not reach n8n: ${String(err)}`);
    }
  }
}
