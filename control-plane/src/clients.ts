// Small Slack Web API + Jira clients for the control plane. Failures are logged, never thrown into the caller's flow.
import { log } from './log.ts';

export interface Chat {
  post(channel: string, text: string, threadTs?: string): Promise<string | undefined>;
  react(channel: string, ts: string, emoji: string): Promise<void>;
}

export class SlackWeb implements Chat {
  private token: string | undefined;

  constructor(token: string | undefined) {
    this.token = token;
  }

  private async api(method: string, body: Record<string, unknown>): Promise<any> {
    if (!this.token) return undefined;
    try {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; ts?: string };
      if (!data.ok && data.error !== 'already_reacted') log.warn(`slack ${method}: ${data.error}`);
      return data;
    } catch (err) {
      log.warn(`slack ${method}: ${String(err)}`);
      return undefined;
    }
  }

  async post(channel: string, text: string, threadTs?: string) {
    const data = await this.api('chat.postMessage', { channel, text, thread_ts: threadTs, unfurl_links: false });
    return data?.ts as string | undefined;
  }

  async react(channel: string, ts: string, emoji: string) {
    await this.api('reactions.add', { channel, timestamp: ts, name: emoji });
  }
}

export interface Tickets {
  /** Summary + URL if the issue exists and is readable, else undefined. */
  lookup(key: string): Promise<{ summary: string; url: string } | undefined>;
}

export class JiraTickets implements Tickets {
  private base: string;
  private auth: string;

  constructor(cfg: { baseUrl: string; email: string; token: string }) {
    this.base = cfg.baseUrl;
    this.auth = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  }

  async lookup(key: string) {
    const res = await fetch(`${this.base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`, {
      headers: { Authorization: this.auth, Accept: 'application/json' },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Jira lookup ${key} → ${res.status}`);
    const data = (await res.json()) as any;
    return { summary: data.fields?.summary ?? '', url: `${this.base}/browse/${key}` };
  }
}
