import { describe, expect, it } from 'vitest';
import { adfToMarkdown } from '../src/clients/adf.ts';

const text = (t: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text: t, marks });

describe('adfToMarkdown', () => {
  it('keeps inline code inside a sentence (SCRUM-2 regression)', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [text('Split '), text('expenseAgent.ts', [{ type: 'code' }]), text(' into '), text('tools.ts', [{ type: 'code' }])] },
        { type: 'paragraph', content: [text('No behaviour change.')] },
      ],
    };
    expect(adfToMarkdown(doc)).toBe('Split `expenseAgent.ts` into `tools.ts`\n\nNo behaviour change.');
  });

  it('renders lists, headings, links and code blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [text('AC')] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [text('one')] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [text('docs', [{ type: 'link', attrs: { href: 'https://x.y' } }])] }] },
          ],
        },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('first')] }] }] },
        { type: 'codeBlock', attrs: { language: 'bash' }, content: [text('npm run build')] },
      ],
    };
    expect(adfToMarkdown(doc)).toBe('### AC\n\n- one\n- [docs](https://x.y)\n\n1. first\n\n```bash\nnpm run build\n```');
  });

  it('handles empty descriptions', () => {
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown({ type: 'doc', content: [] })).toBe('');
  });
});
