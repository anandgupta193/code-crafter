// Slack intake: n8n has parsed the trigger message; decide, spawn, and answer in the thread.
import type { Chat, Tickets } from './clients.ts';
import { log } from './log.ts';
import type { SpawnResult, Spawner } from './spawner.ts';
import { keys, type Store } from './store.ts';

export interface ParsedTrigger {
  ok: boolean;
  reason?: string;
  jiraKey?: string;
  service?: string;
  baseBranch?: string;
  slack: { channel: string; ts: string; user: string };
}

const REACTION: Record<SpawnResult['status'], string> = {
  started: 'eyes',
  'already-running': 'repeat',
  busy: 'hourglass_flowing_sand',
  'queue-full': 'no_entry',
  rejected: 'x',
  error: 'x',
};

export class Intake {
  private spawner: Spawner;
  private chat: Chat;
  private tickets: Tickets;
  private allowedUsers: string[];
  private store?: Store;

  constructor(spawner: Spawner, chat: Chat, tickets: Tickets, allowedUsers: string[], store?: Store) {
    this.store = store;
    this.spawner = spawner;
    this.chat = chat;
    this.tickets = tickets;
    this.allowedUsers = allowedUsers;
  }

  async handle(t: ParsedTrigger): Promise<SpawnResult> {
    const result = await this.decide(t);
    log.info(`intake from ${t.slack.user}: ${t.jiraKey ?? '(no ticket)'} → ${result.status} (${result.message})`);
    return result;
  }

  private async decide(t: ParsedTrigger): Promise<SpawnResult> {
    const { channel, ts, user } = t.slack;
    const reply = (text: string) => this.chat.post(channel, text, ts);

    // Defence in depth: the bridge already filters, but n8n's webhook is reachable on the host too.
    if (this.allowedUsers.length && !this.allowedUsers.includes(user)) {
      return { status: 'rejected', message: 'user not allowed' };
    }

    if (!t.ok || !t.jiraKey) {
      await this.chat.react(channel, ts, 'x');
      await reply(`❌ ${t.reason ?? 'could not read that trigger'}`);
      return { status: 'rejected', message: t.reason ?? 'unparseable trigger' };
    }

    const issue = await this.tickets.lookup(t.jiraKey).catch((err) => {
      log.warn(`jira lookup failed: ${err}`);
      return null;
    });
    if (issue === undefined) {
      await this.chat.react(channel, ts, 'x');
      await reply(`❌ ${t.jiraKey} was not found in Jira (or the bot can't see it).`);
      return { status: 'rejected', message: `${t.jiraKey} not found` };
    }

    const result = await this.spawner.spawn({ jiraKey: t.jiraKey, service: t.service, baseBranch: t.baseBranch, slackThreadTs: ts });
    if (issue && (result.status === 'started' || result.status === 'already-running')) {
      await this.store?.set(keys.title(t.jiraKey), issue.summary, 90 * 24 * 3600);
    }
    await this.chat.react(channel, ts, REACTION[result.status]);

    const title = issue ? `<${issue.url}|${t.jiraKey}>: ${issue.summary}` : t.jiraKey;
    switch (result.status) {
      case 'started':
        await reply(`👀 Picked up ${title}\nservice \`${result.service}\` · base \`${result.baseBranch}\` · container \`${result.container}\``);
        break;
      case 'already-running':
        await reply(`🔁 ${t.jiraKey} is already being worked on (\`${result.container}\`). Updates go to its original thread.`);
        break;
      case 'queue-full':
        await reply(`⛔ Not started — ${result.message}. Try again when one finishes.`);
        break;
      default:
        await reply(`❌ Not started — ${result.message}`);
    }
    return result;
  }
}
