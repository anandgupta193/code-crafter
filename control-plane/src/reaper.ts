// Housekeeping loop (docs/04-spawner.md). The container's own idle/hard-cap timers are primary;
// this is the backstop plus cleanup of what they leave behind.
import type { DockerApi } from './docker.ts';
import { log } from './log.ts';
import { keys, type Store } from './store.ts';

const VOLUME_PREFIX = 'codecrafter-home-';
const KEEP_EXITED_MS = 2 * 3600_000; // keep exited containers around for `docker logs`
const VOLUME_IDLE_MS = 7 * 24 * 3600_000; // D18

export interface ReaperOptions {
  hardCapMs: number;
  now?: () => number;
  /** Tell the ticket's Slack thread that its container crashed (once per container run). */
  reportCrash?: (key: string, name: string, exitCode: number) => Promise<void>;
}

export async function reapOnce(docker: DockerApi, store: Store, opts: ReaperOptions): Promise<string[]> {
  const now = opts.now?.() ?? Date.now();
  const actions: string[] = [];
  const containers = await docker.listTicketContainers();

  for (const c of containers) {
    const age = now - c.startedAt;
    if (c.state === 'running') {
      await store.set(keys.lastActive(c.key), String(now));
      if (age > opts.hardCapMs + 10 * 60_000) {
        await docker.stop(c.name, 150);
        actions.push(`stopped ${c.name} (past hard cap)`);
      }
    } else if (c.exitCode && opts.reportCrash && (await store.acquire(keys.crashReported(c.name, c.startedAt), 7 * 24 * 3600))) {
      await opts.reportCrash(c.key, c.name, c.exitCode);
      actions.push(`reported crash of ${c.name} (exit ${c.exitCode})`);
    } else if (age > KEEP_EXITED_MS) {
      await docker.remove(c.name);
      actions.push(`removed exited ${c.name}`);
    }
  }

  const withContainer = new Set(containers.map((c) => c.key.toLowerCase()));
  for (const vol of await docker.listVolumes(VOLUME_PREFIX)) {
    const lower = vol.slice(VOLUME_PREFIX.length);
    if (withContainer.has(lower)) continue;
    const key = lower.toUpperCase();
    const last = Number((await store.get(keys.lastActive(key))) ?? 0);
    if (!last) {
      await store.set(keys.lastActive(key), String(now)); // start tracking volumes we haven't seen
    } else if (now - last > VOLUME_IDLE_MS) {
      await docker.removeVolume(vol);
      await store.del(keys.lastActive(key));
      actions.push(`removed idle volume ${vol}`);
    }
  }

  for (const a of actions) log.info(`reaper: ${a}`);
  return actions;
}
