// Container process: HTTP surface + timers + graceful shutdown around one TicketAgent.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { loadRepoConfig, loadTicketContext, loadTimers } from './config.ts';
import { GitHub } from './clients/github.ts';
import { JiraClient } from './clients/jira.ts';
import { SlackClient } from './clients/slack.ts';
import { Git } from './git.ts';
import { log } from './log.ts';
import { createRunner } from './runners/index.ts';
import { StateStore } from './state.ts';
import { TicketAgent, type FinalStatus } from './ticket-agent.ts';
import type { AgentCommand } from './prompt.ts';

const PORT = Number(process.env.PORT ?? 8080);
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
const RULES_FILE = process.env.CC_RULES_FILE ?? '/opt/codecrafter/rules/code-crafter.md';

const ctx = loadTicketContext();
const timers = loadTimers();
const repoConfig = await loadRepoConfig(ctx.repoDir);
const store = new StateStore(ctx.stateDir);
const git = new Git(ctx.repoDir, ctx.branch, ctx.baseBranch);
const slack = new SlackClient();

let idleTimer: NodeJS.Timeout | undefined;
let phase: 'starting' | 'working' | 'idle' | 'stopping' = 'starting';
let finalStatus: FinalStatus | undefined;
let workflow: Promise<FinalStatus> | undefined;
const abort = new AbortController();

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void shutdown(`idle for ${timers.idleTtlMs / 60_000} min`), timers.idleTtlMs);
  idleTimer.unref();
}

const agent = new TicketAgent({
  ctx,
  timers,
  repoConfig,
  store,
  git,
  gh: new GitHub(ctx.repoDir),
  jira: new JiraClient(),
  slack,
  runner: createRunner(repoConfig.agent.provider),
  rules: await readFile(RULES_FILE, 'utf8'),
  onActivity: touch,
});

// ── HTTP: /healthz (503 until the agent has actually spawned), /state, /command ──
const server = createServer((req, res) => {
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/healthz') return json(agent.spawned || finalStatus ? 200 : 503, { ok: agent.spawned || !!finalStatus, phase });
  if (req.url === '/state') return json(200, { key: ctx.jiraKey, branch: ctx.branch, phase, finalStatus, state: store.get() });
  if (req.url === '/command' && req.method === 'POST') {
    if (INTERNAL_TOKEN && req.headers['x-codecrafter-token'] !== INTERNAL_TOKEN) return json(401, { error: 'bad token' });
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let cmd: AgentCommand;
      try {
        cmd = JSON.parse(raw);
      } catch {
        return json(400, { error: 'invalid JSON' });
      }
      if (cmd.jiraKey !== ctx.jiraKey) return json(409, { error: `this container serves ${ctx.jiraKey}` });
      if (cmd.type === 'stop') {
        json(202, { accepted: 'stop' });
        void shutdown(`stopped by ${cmd.payload?.by ?? 'command'}`);
        return;
      }
      agent.enqueue(cmd);
      json(202, { accepted: cmd.type, busy: agent.busy });
      void drainQueue();
    });
    return;
  }
  json(404, { error: 'not found' });
});

// ── shutdown: stop the agent, checkpoint, exit (D16 grace period) ──
let stopping: Promise<void> | undefined;
function shutdown(reason: string): Promise<void> {
  stopping ??= (async () => {
    const wasWorking = phase === 'working';
    phase = 'stopping';
    log.warn(`shutting down: ${reason}`);
    abort.abort();
    const force = setTimeout(() => {
      log.error('grace period exceeded — exiting');
      process.exit(1);
    }, timers.graceMs);
    await workflow?.catch(() => {});
    if (wasWorking) {
      await agent.emergencyCheckpoint();
      await slack.post(`⏹ Container stopped (${reason}). Work is checkpointed; the next event resumes it.`, store.get().slackThreadTs);
    }
    clearTimeout(force);
    server.close();
    log.info('bye');
    process.exit(0);
  })();
  return stopping;
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
setTimeout(() => void shutdown(`hard cap ${timers.hardCapMs / 60_000} min`), timers.hardCapMs).unref();

server.listen(PORT, () => {
  log.info(`orchestrator listening on :${PORT} · ${ctx.jiraKey} · branch ${ctx.branch} (${ctx.branchIsNew ? 'new' : 'existing'}) · state ${path.relative('/', ctx.stateDir)}`);
  // Auto-fire the workflow shortly after listening (as in the original).
  setTimeout(() => {
    phase = 'working';
    touch();
    workflow = fetchPendingCommands().then((pending) => agent.run(abort.signal, pending));
    workflow
      .then((status) => {
        finalStatus = status;
        if (phase === 'stopping') return;
        phase = 'idle';
        log.ok(`workflow finished: ${status}. Idle — exits after ${timers.idleTtlMs / 60_000} min without events.`);
        if (status === 'paused') void shutdown('paused (usage limit)');
        else void drainQueue();
      })
      .catch(async (err) => {
        log.error(`workflow crashed: ${err instanceof Error ? err.stack : String(err)}`);
        await agent.emergencyCheckpoint();
        await slack.post(`❌ code-crafter crashed on ${ctx.jiraKey}: ${String(err).slice(0, 300)}`, store.get().slackThreadTs);
        finalStatus = 'needs-human';
        phase = 'idle';
      });
  }, 2_000);
});

/** Commands queued by the control plane while this container was stopped. */
async function fetchPendingCommands(): Promise<AgentCommand[]> {
  if (!CONTROL_PLANE_URL || !INTERNAL_TOKEN) return [];
  try {
    const res = await fetch(`${CONTROL_PLANE_URL}/api/tickets/${ctx.jiraKey}/commands`, {
      headers: { 'x-codecrafter-token': INTERNAL_TOKEN },
      signal: AbortSignal.timeout(5000),
    });
    const cmds = res.ok ? ((await res.json()) as AgentCommand[]) : [];
    if (cmds.length) log.info(`picked up ${cmds.length} queued command(s) from the control plane`);
    return cmds;
  } catch (err) {
    log.warn(`could not fetch queued commands: ${String(err)}`);
    return [];
  }
}

/** When idle, process queued commands (one at a time; failures never pre-empt running work). */
let draining = false;
async function drainQueue(): Promise<void> {
  if (draining || phase !== 'idle' || agent.busy) return;
  draining = true;
  try {
    phase = 'working';
    finalStatus = await agent.processQueue(abort.signal);
    if (phase === 'working') phase = 'idle';
    touch();
    if (finalStatus === 'paused') void shutdown('paused (usage limit)');
  } catch (err) {
    log.error(`command processing crashed: ${err instanceof Error ? err.stack : String(err)}`);
    await agent.emergencyCheckpoint();
    phase = 'idle';
  } finally {
    draining = false;
  }
}
