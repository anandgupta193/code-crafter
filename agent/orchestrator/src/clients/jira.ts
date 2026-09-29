import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adfToMarkdown } from './adf.ts';
import { log } from '../log.ts';

export interface JiraIssue {
  key: string;
  url: string;
  summary: string;
  description: string;
  labels: string[];
  status: string;
  attachments: { filename: string; mimeType: string; size: number; content: string }[];
}

// Board order for forward-only transitions (D11).
const STATUS_ORDER = ['to do', 'in progress', 'in review', 'done'];

export class JiraClient {
  private base: string;
  private auth: string;

  constructor(baseUrl = process.env.JIRA_BASE_URL, email = process.env.JIRA_EMAIL, token = process.env.JIRA_API_TOKEN) {
    if (!baseUrl || !email || !token) throw new Error('JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN must be set');
    this.base = baseUrl.replace(/\/$/, '');
    this.auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  private async api<T>(method: string, route: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/rest/api/3${route}`, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jira ${method} ${route} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const data = await this.api<any>('GET', `/issue/${key}?fields=summary,description,labels,status,attachment`);
    return {
      key,
      url: `${this.base}/browse/${key}`,
      summary: data.fields.summary ?? '',
      description: adfToMarkdown(data.fields.description),
      labels: data.fields.labels ?? [],
      status: data.fields.status?.name ?? '',
      attachments: (data.fields.attachment ?? []).map((a: any) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        content: a.content,
      })),
    };
  }

  /** Download attachments to `dir`; returns local paths. */
  async downloadAttachments(issue: JiraIssue, dir: string): Promise<string[]> {
    if (issue.attachments.length === 0) return [];
    await mkdir(dir, { recursive: true });
    const paths: string[] = [];
    for (const a of issue.attachments) {
      const res = await fetch(a.content, { headers: { Authorization: this.auth } });
      if (!res.ok) {
        log.warn(`attachment ${a.filename}: HTTP ${res.status}`);
        continue;
      }
      const file = path.join(dir, path.basename(a.filename));
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      paths.push(file);
    }
    return paths;
  }

  /** Move the issue to `target` only if that is forward on the board (D11). */
  async transitionForward(key: string, currentStatus: string, target: string): Promise<boolean> {
    const from = STATUS_ORDER.indexOf(currentStatus.toLowerCase());
    const to = STATUS_ORDER.indexOf(target.toLowerCase());
    if (to === -1 || from === -1 || to <= from) return false;
    const { transitions } = await this.api<{ transitions: { id: string; to: { name: string } }[] }>(
      'GET',
      `/issue/${key}/transitions`,
    );
    const t = transitions.find((x) => x.to.name.toLowerCase() === target.toLowerCase());
    if (!t) return false;
    await this.api('POST', `/issue/${key}/transitions`, { transition: { id: t.id } });
    return true;
  }

  async comment(key: string, text: string, link?: { text: string; href: string }): Promise<void> {
    const content: unknown[] = [{ type: 'text', text }];
    if (link) content.push({ type: 'text', text: link.text, marks: [{ type: 'link', attrs: { href: link.href } }] });
    await this.api('POST', `/issue/${key}/comment`, {
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] },
    });
  }
}
