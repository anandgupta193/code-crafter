// Control plane: HTTP API + Slack bridge + reaper (docs/04-spawner.md, 02-trigger-intake.md).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { JiraTickets, SlackWeb } from './clients.ts';
import { loadConfig } from './config.ts';
import { DockerEngine } from './docker.ts';
import { Intake, type ParsedTrigger } from './intake.ts';
import { log } from './log.ts';
import { reapOnce } from './reaper.ts';
import { SlackBridge } from './slack-bridge.ts';
import { Spawner, type SpawnRequest } from './spawner.ts';
import { connectRedis } from './store.ts';

const cfg = loadConfig();
const store = await connectRedis(cfg.redisUrl);
const docker = new DockerEngine();
const chat = new SlackWeb(cfg.slack.botToken);
const spawner = new Spawner(cfg, docker, store);
const intake = new Intake(spawner, chat, new JiraTickets(cfg.jira), cfg.slack.allowedUsers);

const bridge = cfg.slack.appToken
  ? new SlackBridge({
      appToken: cfg.slack.appToken,
      channel: cfg.slack.channel,
      allowedUsers: cfg.slack.allowedUsers,
      forwardUrl: `${cfg.n8nWebhookBase}/slack-trigger`,
      store,
      onRejectedUser: async (e) => {
        if (e.channel && e.ts) await chat.post(e.channel, '🙅 Only allow-listed users can start code-crafter tickets.', e.ts);
      },
    })
  : undefined;

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
      // Phase 0: prove GitHub → smee → n8n → control plane. Phase 1c routes these to /command.
      const e = await readJson(req);
      log.info(`github ${e.event}${e.action ? `.${e.action}` : ''} ${e.repo ?? ''} ${e.branch ? `branch=${e.branch}` : ''}${e.routable ? ` → ${e.container}` : ' (not routable)'} by ${e.sender ?? '?'}`);
      return send(res, 202, { received: true, routable: e.routable });
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

const reaper = setInterval(() => void reapOnce(docker, store, { hardCapMs: cfg.hardCapMs }).catch((e) => log.warn(`reaper: ${e}`)), 60_000);

const shutdown = () => {
  log.info('shutting down');
  clearInterval(reaper);
  bridge?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
