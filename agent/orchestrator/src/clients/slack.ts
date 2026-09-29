import { log } from '../log.ts';

/**
 * Milestone notifications (D20). Slack failures never fail the run — they are only logged.
 */
export class SlackClient {
  private token: string | undefined;
  private channel: string | undefined;

  constructor(token = process.env.SLACK_BOT_TOKEN, channel = process.env.SLACK_TRIGGER_CHANNEL_ID) {
    this.token = token;
    this.channel = channel;
  }

  get enabled(): boolean {
    return Boolean(this.token && this.channel);
  }

  /** Post a message; returns its ts (use as thread ts for a new thread). */
  async post(text: string, threadTs?: string): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: this.channel, text, thread_ts: threadTs, unfurl_links: false }),
      });
      const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      if (!data.ok) {
        log.warn(`slack post failed: ${data.error}`);
        return undefined;
      }
      return data.ts;
    } catch (err) {
      log.warn(`slack post failed: ${String(err)}`);
      return undefined;
    }
  }
}
