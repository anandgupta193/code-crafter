// Spawn exactly one disposable agent container per ticket (docs/04-spawner.md).
//   per-ticket lock → dedupe healthy container → concurrency cap → docker run

import { containerName, volumeName, type Config, type Service } from './config.ts';
import type { DockerApi } from './docker.ts';
import { log } from './log.ts';
import { keys, type Store } from './store.ts';

export interface SpawnRequest {
  jiraKey: string;
  service?: string;
  baseBranch?: string;
  slackThreadTs?: string;
  resume?: boolean;
}

export type SpawnStatus = 'started' | 'already-running' | 'busy' | 'queue-full' | 'rejected' | 'error';

export interface SpawnResult {
  status: SpawnStatus;
  message: string;
  container?: string;
  service?: string;
  baseBranch?: string;
}

export type HealthCheck = (container: string) => Promise<boolean>;

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const STARTING_GRACE_MS = 3 * 60_000;

export async function defaultHealthCheck(container: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${container}:8080/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export class Spawner {
  private cfg: Pick<Config, 'agentImage' | 'network' | 'maxConcurrent' | 'services' | 'agentEnvNames'>;
  private docker: DockerApi;
  private store: Store;
  private health: HealthCheck;
  private env: NodeJS.ProcessEnv;

  constructor(
    cfg: Pick<Config, 'agentImage' | 'network' | 'maxConcurrent' | 'services' | 'agentEnvNames'>,
    docker: DockerApi,
    store: Store,
    health: HealthCheck = defaultHealthCheck,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.cfg = cfg;
    this.docker = docker;
    this.store = store;
    this.health = health;
    this.env = env;
  }

  resolveService(name?: string): Service | undefined {
    if (name) return this.cfg.services.find((s) => s.name === name);
    return this.cfg.services.length === 1 ? this.cfg.services[0] : undefined;
  }

  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    if (!JIRA_KEY.test(req.jiraKey)) return { status: 'rejected', message: `invalid Jira key "${req.jiraKey}"` };
    const service = this.resolveService(req.service);
    if (!service) {
      const known = this.cfg.services.map((s) => s.name).join(', ');
      return {
        status: 'rejected',
        message: req.service ? `service "${req.service}" is not registered (known: ${known})` : `please name a service (known: ${known})`,
      };
    }
    const baseBranch = req.baseBranch ?? service.defaultBaseBranch;
    const name = containerName(req.jiraKey);
    const ctx = { container: name, service: service.name, baseBranch };

    const lock = keys.spawnLock(req.jiraKey);
    if (!(await this.store.acquire(lock, 60))) return { status: 'busy', message: `a spawn for ${req.jiraKey} is already in progress`, ...ctx };

    try {
      const all = await this.docker.listTicketContainers();
      const mine = all.find((c) => c.name === name);
      if (mine?.state === 'running') {
        const young = Date.now() - mine.startedAt < STARTING_GRACE_MS;
        if (young || (await this.health(name))) {
          return { status: 'already-running', message: `${name} is already ${young ? 'starting' : 'running'}`, ...ctx };
        }
        log.warn(`${name} is running but unhealthy — replacing it`);
      }
      if (mine) await this.docker.remove(name);

      const running = all.filter((c) => c.state === 'running' && c.name !== name);
      if (running.length >= this.cfg.maxConcurrent) {
        return {
          status: 'queue-full',
          message: `${running.length} tickets already running (max ${this.cfg.maxConcurrent}): ${running.map((c) => c.key).join(', ')}`,
          ...ctx,
        };
      }

      if (!(await this.docker.imageExists(this.cfg.agentImage))) {
        return { status: 'error', message: `agent image "${this.cfg.agentImage}" not found — run \`docker compose build agent\``, ...ctx };
      }

      const env: Record<string, string> = {};
      for (const k of this.cfg.agentEnvNames) if (this.env[k]) env[k] = this.env[k]!;
      Object.assign(env, {
        WORKSPACE_REPO: service.repo,
        WORKSPACE_BASE_BRANCH: baseBranch,
        JIRA_TASK_KEY: req.jiraKey,
        ...(req.slackThreadTs ? { SLACK_THREAD_TS: req.slackThreadTs } : {}),
      });

      await this.docker.createAndStart({
        name,
        image: this.cfg.agentImage,
        env,
        labels: { 'codecrafter.key': req.jiraKey, 'codecrafter.started': String(Math.floor(Date.now() / 1000)), 'codecrafter.service': service.name },
        volume: { name: volumeName(req.jiraKey), mountPath: '/home/node' },
        network: this.cfg.network,
        memoryBytes: 6 * 1024 ** 3,
        cpus: 4,
      });
      await this.store.set(keys.lastActive(req.jiraKey), String(Date.now()));
      if (req.slackThreadTs) await this.store.set(keys.thread(req.jiraKey), req.slackThreadTs);
      log.ok(`started ${name} (${service.name} @ ${baseBranch})`);
      return { status: 'started', message: `started ${name}`, ...ctx };
    } catch (err) {
      log.error(`spawn ${req.jiraKey} failed: ${String(err)}`);
      return { status: 'error', message: String(err instanceof Error ? err.message : err), ...ctx };
    } finally {
      await this.store.release(lock);
    }
  }

  async stop(jiraKey: string): Promise<boolean> {
    const name = containerName(jiraKey);
    const mine = (await this.docker.listTicketContainers()).find((c) => c.name === name);
    if (!mine) return false;
    // Grace > the orchestrator's 2-min checkpoint window (D16).
    await this.docker.stop(name, 150);
    return true;
  }
}
