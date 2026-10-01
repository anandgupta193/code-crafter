// Markdown doc → chunks for embedding (docs/10-context-graph.md, "Ingestion" step 6).
// One chunk per `#`/`##` section; long sections split on blank lines, then hard-split.
import { createHash } from 'node:crypto';

export interface DocChunk {
  path: string;
  heading: string;
  index: number; // position in the file; with path it is the chunk's identity
  text: string;
  hash: string; // changes only when path, heading or text change → re-embed only what changed
}

function split(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > max) {
      if (cur) out.push(cur);
      cur = '';
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + 2 + para.length > max) {
      out.push(cur);
      cur = para;
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkMarkdown(path: string, markdown: string, maxChars = 1500): DocChunk[] {
  const sections: { heading: string; lines: string[] }[] = [];
  let current = { heading: '', lines: [] as string[] };
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^#{1,2}\s+(.+?)\s*#*\s*$/);
    if (h) {
      sections.push(current);
      current = { heading: h[1], lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);

  const chunks: DocChunk[] = [];
  for (const s of sections) {
    const body = s.lines.join('\n').trim();
    if (!body) continue;
    for (const text of split(body, maxChars)) {
      const hash = createHash('sha256').update(`${path}\n${s.heading}\n${text}`).digest('hex').slice(0, 16);
      chunks.push({ path, heading: s.heading, index: chunks.length, text, hash });
    }
  }
  return chunks;
}
