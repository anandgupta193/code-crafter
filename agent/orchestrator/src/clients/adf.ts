// Jira Cloud stores rich text as Atlassian Document Format (ADF). Convert it to markdown for the prompt,
// keeping inline `code` intact (a naive text join splits "Split `expenseAgent.ts` into" across lines).

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

function inline(nodes: AdfNode[] = []): string {
  return nodes.map(inlineNode).join('');
}

function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text': {
      let t = node.text ?? '';
      for (const mark of node.marks ?? []) {
        if (mark.type === 'code') t = `\`${t}\``;
        else if (mark.type === 'strong') t = `**${t}**`;
        else if (mark.type === 'em') t = `_${t}_`;
        else if (mark.type === 'strike') t = `~~${t}~~`;
        else if (mark.type === 'link') t = `[${t}](${String(mark.attrs?.href ?? '')})`;
      }
      return t;
    }
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(node.attrs?.text ?? '@someone');
    case 'emoji':
      return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
    case 'inlineCard':
      return String(node.attrs?.url ?? '');
    case 'date':
      return new Date(Number(node.attrs?.timestamp ?? 0)).toISOString().slice(0, 10);
    default:
      return inline(node.content);
  }
}

function block(node: AdfNode, indent = ''): string {
  switch (node.type) {
    case 'doc':
      return blocks(node.content);
    case 'paragraph':
      return indent + inline(node.content);
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 2))} ${inline(node.content)}`;
    case 'bulletList':
      return (node.content ?? []).map((li) => listItem(li, `${indent}- `, indent)).join('\n');
    case 'orderedList':
      return (node.content ?? []).map((li, i) => listItem(li, `${indent}${i + 1}. `, indent)).join('\n');
    case 'taskList':
      return (node.content ?? [])
        .map((t) => `${indent}- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(t.content)}`)
        .join('\n');
    case 'codeBlock':
      return '```' + String(node.attrs?.language ?? '') + '\n' + inline(node.content) + '\n```';
    case 'blockquote':
      return blocks(node.content)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'rule':
      return '---';
    case 'panel':
      return blocks(node.content);
    case 'table':
      return (node.content ?? [])
        .map((row) => '| ' + (row.content ?? []).map((cell) => blocks(cell.content).replace(/\n/g, ' ')).join(' | ') + ' |')
        .join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
      return '[attachment]';
    default:
      return node.content ? blocks(node.content) : inlineNode(node);
  }
}

function listItem(li: AdfNode, bullet: string, indent: string): string {
  const [first, ...rest] = li.content ?? [];
  const head = first ? block(first).trimStart() : '';
  const tailParts = rest.map((child) => block(child, indent + '  '));
  return [bullet + head, ...tailParts].join('\n');
}

function blocks(nodes: AdfNode[] = []): string {
  return nodes
    .map((n) => block(n))
    .filter((s) => s.length > 0)
    .join('\n\n');
}

export function adfToMarkdown(doc: unknown): string {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  return block(doc as AdfNode).trim();
}
