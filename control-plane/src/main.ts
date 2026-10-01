// Control plane: HTTP API + Slack bridge + reaper (docs/04-spawner.md, 02-trigger-intake.md).

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { JiraTickets, SlackWeb } from './clients.ts';
import { loadConfig } from './config.ts';
import { DockerEngine } from './docker.ts';
import { GitHubRest } from './github.ts';
import { Intake, type ParsedTrigger } from './intake.ts';
import { log } from './log.ts';
import { cached, computePrStats, githubLogin, githubSearchCount } from './pr-stats.ts';
import { reapOnce } from './reaper.ts';
import { gatherStatus, readLogs } from './status.ts';
import { EventRouter, httpDeliver, type GithubEvent } from './router.ts';
import { SlackBridge } from './slack-bridge.ts';
import { Spawner, type SpawnRequest } from './spawner.ts';
import { connectRedis, keys } from './store.ts';

const cfg = loadConfig();
const store = await connectRedis(cfg.redisUrl);
const docker = new DockerEngine();
const chat = new SlackWeb(cfg.slack.botToken);
const spawner = new Spawner(cfg, docker, store);
const tickets = new JiraTickets(cfg.jira);
const intake = new Intake(spawner, chat, tickets, cfg.slack.allowedUsers, store);
const router = new EventRouter({
  services: cfg.services,
  allowedUsers: cfg.githubAllowedUsers,
  slackChannel: cfg.slack.channel,
  github: new GitHubRest(cfg.githubToken),
  tickets,
  chat,
  store,
  docker,
  spawner,
  deliver: (container, cmd) => httpDeliver(container, cmd, cfg.internalToken),
});

const bridge = cfg.slack.appToken
  ? new SlackBridge({
      appToken: cfg.slack.appToken,
      routes: [
        ...(cfg.slack.channel
          ? [{ name: 'code-crafter', channel: cfg.slack.channel, allowedUsers: cfg.slack.allowedUsers, forwardUrl: `${cfg.n8nWebhookBase}/slack-trigger` }]
          : []),
        // #ops: anyone may post; the n8n workflow turns the message into a Jira Story.
        ...(cfg.slack.opsChannel ? [{ name: 'ops', channel: cfg.slack.opsChannel, allowedUsers: [], forwardUrl: `${cfg.n8nWebhookBase}/ops-intake` }] : []),
      ],
      store,
      onRejectedUser: async (e) => {
        if (e.channel && e.ts) await chat.post(e.channel, '🙅 Only allow-listed users can start code-crafter tickets.', e.ts);
      },
    })
  : undefined;

// ── status page (docs/17-status-page.md) ──
const STATUS_HTML = readFileSync(new URL('./status.html', import.meta.url), 'utf8');
const workspaceUrl = await chat.workspaceUrl().catch(() => undefined);
const searchCount = githubSearchCount(cfg.githubToken);
let botLogin: string | undefined;
const prStats = cached(async () => {
  botLogin ??= await githubLogin(cfg.githubToken);
  return computePrStats(cfg.services, botLogin, searchCount);
}, 10 * 60_000);
const statusDeps = () => ({
  docker,
  store,
  services: cfg.services,
  jiraBaseUrl: cfg.jira.baseUrl,
  slack: { channel: cfg.slack.channel, workspaceUrl },
  bridge,
  n8nHealthy: async () => (await fetch(cfg.n8nWebhookBase.replace(/\/webhook\/?$/, '') + '/healthz', { signal: AbortSignal.timeout(2000) })).ok,
  agentPhase: async (container: string) => {
    const res = await fetch(`http://${container}:8080/state`, { signal: AbortSignal.timeout(1500) });
    return ((await res.json()) as { phase?: string }).phase;
  },
  prStats,
});

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const authorized = (req: IncomingMessage) => req.headers['x-codecrafter-token'] === cfg.internalToken;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return send(res, 200, { ok: true, slackBridge: bridge ? bridge.connected : 'disabled' });
    }
    // Read-only status page: no token (the control plane is only published on 127.0.0.1).
    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(STATUS_HTML);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await gatherStatus(statusDeps()));
    const logMatch = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (req.method === 'GET' && logMatch) {
      try {
        const text = await readLogs(docker, decodeURIComponent(logMatch[1]));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(text);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(String(err instanceof Error ? err.message : err));
      }
    }
    if (!authorized(req)) return send(res, 401, { error: 'missing or wrong x-codecrafter-token' });

    if (req.method === 'POST' && url.pathname === '/spawn') {
      const body = (await readJson(req)) as SpawnRequest;
      const r = await spawner.spawn(body);
      return send(res, r.status === 'started' ? 201 : r.status === 'error' ? 500 : r.status === 'rejected' ? 400 : 409, r);
    }
    if (req.method === 'POST' && url.pathname === '/api/intake/slack') {
      const body = (await readJson(req)) as ParsedTrigger;
      return send(res, 200, await intake.handle(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/github-event') {
      const e = (await readJson(req)) as GithubEvent;
      return send(res, 202, { result: await router.handle(e) });
    }
    const cmdMatch = url.pathname.match(/^\/api\/tickets\/([A-Z][A-Z0-9_]+-\d+)\/commands$/);
    if (req.method === 'GET' && cmdMatch) {
      // The agent container drains commands that were queued while it was stopped.
      const items = await store.drain(keys.commands(cmdMatch[1]));
      return send(res, 200, items.map((s) => JSON.parse(s)));
    }
    if (req.method === 'GET' && url.pathname === '/tickets') {
      return send(res, 200, await docker.listTicketContainers());
    }
    const stopMatch = url.pathname.match(/^\/tickets\/([A-Z][A-Z0-9_]+-\d+)$/);
    if (req.method === 'DELETE' && stopMatch) {
      return send(res, (await spawner.stop(stopMatch[1])) ? 202 : 404, { key: stopMatch[1] });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    log.error(`${req.method} ${url.pathname}: ${String(err)}`);
    send(res, 500, { error: String(err) });
  }
});

server.listen(cfg.port, () => {
  log.ok(`control plane on :${cfg.port} · services: ${cfg.services.map((s) => s.name).join(', ')} · max ${cfg.maxConcurrent} tickets`);
});
await bridge?.start();

const reportCrash = async (key: string, name: string, exitCode: number) => {
  const thread = await store.get(keys.thread(key));
  if (thread && cfg.slack.channel) {
    await chat.post(cfg.slack.channel, `❌ \`${name}\` stopped with an error (exit ${exitCode}). Logs: \`docker logs ${name}\`. Post ${key} again to resume from the branch.`, thread);
  }
};
const reaper = setInterval(
  () => void reapOnce(docker, store, { hardCapMs: cfg.hardCapMs, reportCrash }).catch((e) => log.warn(`reaper: ${e}`)),
  60_000,
);

const shutdown = () => {
  log.info('shutting down');
  clearInterval(reaper);
  bridge?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
