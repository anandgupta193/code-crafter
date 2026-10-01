// Minimal Docker Engine API client over the unix socket (no dockerode dependency).
import { request } from 'node:http';

export interface TicketContainer {
  name: string;
  key: string;
  state: string; // running | exited | created | ...
  startedAt: number; // epoch ms, from the codecrafter.started label
  exitCode?: number; // parsed from Status "Exited (1) 3 minutes ago"
  service?: string; // codecrafter.service label (set by the spawner)
}

export interface ServiceContainer {
  name: string;
  state: string;
}

/**
 * Docker's non-TTY log stream is multiplexed: 8-byte header [stream, 0, 0, 0, size(uint32 BE)] + payload.
 * Returns plain text; passes TTY (raw) output through unchanged.
 */
export function demuxLogs(buf: Buffer): string {
  const multiplexed = buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!multiplexed) return buf.toString('utf8');
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8');
}

export interface ContainerSpec {
  name: string;
  image: string;
  env: Record<string, string>;
  labels: Record<string, string>;
  volume: { name: string; mountPath: string };
  network: string;
  memoryBytes: number;
  cpus: number;
}

/** What the spawner/reaper need from Docker — faked in tests. */
export interface DockerApi {
  listTicketContainers(): Promise<TicketContainer[]>;
  imageExists(image: string): Promise<boolean>;
  createAndStart(spec: ContainerSpec): Promise<void>;
  stop(name: string, graceSeconds: number): Promise<void>;
  remove(name: string): Promise<void>;
  listVolumes(prefix: string): Promise<string[]>;
  removeVolume(name: string): Promise<void>;
  /** A docker-compose service container of this project (e.g. smee), if any. */
  composeService(service: string): Promise<ServiceContainer | undefined>;
  /** Last `tail` lines of a container's stdout+stderr as text. */
  logs(name: string, tail: number): Promise<string>;
}

export class DockerEngine implements DockerApi {
  private socketPath: string;

  constructor(socketPath = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock') {
    this.socketPath = socketPath;
  }

  private call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        },
        (res) => {
          let raw = '';
          res.on('data', (d) => (raw += d));
          res.on('end', () => {
            let data: any = raw;
            try {
              data = raw ? JSON.parse(raw) : undefined;
            } catch {
              /* plain text */
            }
            resolve({ status: res.statusCode ?? 0, data });
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async ok(method: string, path: string, body?: unknown, allow: number[] = []): Promise<any> {
    const r = await this.call(method, path, body);
    if (r.status >= 300 && !allow.includes(r.status)) {
      throw new Error(`docker ${method} ${path} → ${r.status}: ${typeof r.data === 'string' ? r.data : r.data?.message}`);
    }
    return r.data;
  }

  async listTicketContainers(): Promise<TicketContainer[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: ['codecrafter.key'] }));
    const list = (await this.ok('GET', `/containers/json?all=true&filters=${filters}`)) as any[];
    return list.map((c) => ({
      name: String(c.Names?.[0] ?? '').replace(/^\//, ''),
      key: c.Labels?.['codecrafter.key'] ?? '',
      state: c.State,
      startedAt: Number(c.Labels?.['codecrafter.started'] ?? 0) * 1000,
      service: c.Labels?.['codecrafter.service'],
      exitCode: /Exited \((\d+)\)/.test(c.Status ?? '') ? Number(/Exited \((\d+)\)/.exec(c.Status)![1]) : undefined,
    }));
  }

  async imageExists(image: string): Promise<boolean> {
    const r = await this.call('GET', `/images/${encodeURIComponent(image)}/json`);
    return r.status === 200;
  }

  async createAndStart(spec: ContainerSpec): Promise<void> {
    await this.ok('POST', `/containers/create?name=${encodeURIComponent(spec.name)}`, {
      Image: spec.image,
      Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
      Labels: spec.labels,
      HostConfig: {
        Binds: [`${spec.volume.name}:${spec.volume.mountPath}`],
        NetworkMode: spec.network,
        Memory: spec.memoryBytes,
        NanoCpus: Math.round(spec.cpus * 1e9),
      },
    });
    await this.ok('POST', `/containers/${encodeURIComponent(spec.name)}/start`, undefined, [304]);
  }

  async stop(name: string, graceSeconds: number): Promise<void> {
    await this.ok('POST', `/containers/${encodeURIComponent(name)}/stop?t=${graceSeconds}`, undefined, [304, 404]);
  }

  async remove(name: string): Promise<void> {
    await this.ok('DELETE', `/containers/${encodeURIComponent(name)}?force=true`, undefined, [404]);
  }

  async listVolumes(prefix: string): Promise<string[]> {
    const data = await this.ok('GET', `/volumes?filters=${encodeURIComponent(JSON.stringify({ name: [prefix] }))}`);
    return (data?.Volumes ?? []).map((v: any) => v.Name).filter((n: string) => n.startsWith(prefix));
  }

  async composeService(service: string): Promise<ServiceContainer | undefined> {
    const project = process.env.COMPOSE_PROJECT ?? 'code-crafter';
    const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`, `com.docker.compose.service=${service}`] }));
    const list = (await this.ok('GET', `/containers/json?all=true&filters=${filters}`)) as any[];
    const c = list[0];
    return c ? { name: String(c.Names?.[0] ?? '').replace(/^\//, ''), state: c.State } : undefined;
  }

  logs(name: string, tail: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request(
        { socketPath: this.socketPath, method: 'GET', path: `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tail}` },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if ((res.statusCode ?? 500) >= 300) reject(new Error(`docker logs ${name} → ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`));
            else resolve(demuxLogs(buf));
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  async removeVolume(name: string): Promise<void> {
    await this.ok('DELETE', `/volumes/${encodeURIComponent(name)}`, undefined, [404, 409]);
  }
}
