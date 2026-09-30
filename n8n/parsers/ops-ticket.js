// #ops message → Jira issue fields (docs/02-trigger-intake.md, "ops intake").
// Title = first line; description = the whole message + who posted it + a link back to Slack.

function opsToJiraIssue(rawText, opts) {
  const o = opts || {};
  const text = String(rawText || '')
    .replace(/<(https?:[^>|]+)\|([^>]+)>/g, '$2 ($1)') // <url|label> → label (url)
    .replace(/<(https?:[^>]+)>/g, '$1') // <url> → url
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // <#C123|channel> → #channel
    .replace(/<@([A-Z0-9]+)>/g, '@$1') // <@U123> → @U123
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

  if (!text) return { skip: 'empty message' };

  const lines = text.split('\n');
  const first = lines.find((l) => l.trim()) || '';
  let summary = first.replace(/[*_~`>]/g, '').replace(/\s+/g, ' ').trim();
  if (summary.length > 120) summary = summary.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  if (!summary) return { skip: 'no text for a title' };

  // Paragraphs split on blank lines; "- " / "• " / "* " lines become bullet lists.
  const blocks = [];
  let para = [];
  let bullets = [];
  const flushPara = () => {
    if (para.length) {
      const content = [];
      para.forEach((l, i) => {
        if (i) content.push({ type: 'hardBreak' });
        content.push({ type: 'text', text: l });
      });
      blocks.push({ type: 'paragraph', content });
    }
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({
        type: 'bulletList',
        content: bullets.map((b) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: b }] }] })),
      });
    }
    bullets = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]);
    } else if (!line.trim()) {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();

  const footer = [{ type: 'text', text: 'Created from Slack #ops' + (o.author ? ' by ' + o.author : '') }];
  if (o.permalink) {
    footer.push({ type: 'text', text: ' · ' });
    footer.push({ type: 'text', text: 'original message', marks: [{ type: 'link', attrs: { href: o.permalink } }] });
  }
  blocks.push({ type: 'rule' });
  blocks.push({ type: 'paragraph', content: footer });

  return {
    fields: {
      project: { key: o.projectKey || 'SCRUM' },
      issuetype: { name: o.issueType || 'Story' },
      summary: summary,
      description: { type: 'doc', version: 1, content: blocks },
      labels: ['from-slack'],
    },
  };
}

// ── n8n build cut: everything below is dropped when inlined into a Code node ──
export { opsToJiraIssue };
