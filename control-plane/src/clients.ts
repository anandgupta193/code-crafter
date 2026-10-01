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

  /** Workspace base URL (e.g. https://code-crafter.slack.com/) for building message permalinks. */
  async workspaceUrl(): Promise<string | undefined> {
    return (await this.api('auth.test', {}))?.url;
  }

  async react(channel: string, ts: string, emoji: string) {
    await this.api('reactions.add', { channel, timestamp: ts, name: emoji });
  }
}

export interface Tickets {
  /** Summary, status + URL if the issue exists and is readable, else undefined. */
  lookup(key: string): Promise<{ summary: string; url: string; status?: string } | undefined>;
  /** Move forward on the board only (D11). True if a transition happened. */
  transitionForward?(key: string, target: string): Promise<boolean>;
  comment?(key: string, text: string, link?: { text: string; href: string }): Promise<void>;
}

const STATUS_ORDER = ['to do', 'in progress', 'in review', 'done'];

export class JiraTickets implements Tickets {
  private base: string;
  private auth: string;

  constructor(cfg: { baseUrl: string; email: string; token: string }) {
    this.base = cfg.baseUrl;
    this.auth = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  }

  async lookup(key: string) {
    const res = await fetch(`${this.base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`, {
      headers: { Authorization: this.auth, Accept: 'application/json' },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Jira lookup ${key} → ${res.status}`);
    const data = (await res.json()) as any;
    return { summary: data.fields?.summary ?? '', url: `${this.base}/browse/${key}`, status: data.fields?.status?.name };
  }

  private async api(method: string, route: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.base}/rest/api/3${route}`, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jira ${method} ${route} → ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  }

  async transitionForward(key: string, target: string): Promise<boolean> {
    const issue = await this.lookup(key);
    const from = STATUS_ORDER.indexOf((issue?.status ?? '').toLowerCase());
    const to = STATUS_ORDER.indexOf(target.toLowerCase());
    if (from === -1 || to === -1 || to <= from) return false;
    const { transitions } = await this.api('GET', `/issue/${key}/transitions`);
    const t = (transitions as any[]).find((x) => String(x.to?.name).toLowerCase() === target.toLowerCase());
    if (!t) return false;
    await this.api('POST', `/issue/${key}/transitions`, { transition: { id: t.id } });
    return true;
  }

  async comment(key: string, text: string, link?: { text: string; href: string }): Promise<void> {
    const content: unknown[] = [{ type: 'text', text }];
    if (link) content.push({ type: 'text', text: link.text, marks: [{ type: 'link', attrs: { href: link.href } }] });
    await this.api('POST', `/issue/${key}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] } });
  }
}
