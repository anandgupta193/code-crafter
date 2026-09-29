import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

/**
 * Per-ticket state kept on the ticket's Docker volume, so it survives container restarts.
 * (Phase 1b moves the control-plane-visible parts of this into Redis.)
 */
export interface TicketState {
  sessionId?: string;
  slackThreadTs?: string;
  status?: 'running' | 'paused' | 'done' | 'needs-human';
  pausedUntil?: number; // epoch seconds
  jiraPrCommented?: boolean;
  planAnnounced?: boolean;
  lastDoneSha?: string;
}

export class StateStore {
  private file: string;
  private cache: TicketState = {};

  constructor(dir: string) {
    this.file = path.join(dir, 'state.json');
  }

  async load(): Promise<TicketState> {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  get(): TicketState {
    return this.cache;
  }

  async update(patch: Partial<TicketState>): Promise<TicketState> {
    this.cache = { ...this.cache, ...patch };
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.cache, null, 2));
    await rename(tmp, this.file);
    return this.cache;
  }
}
