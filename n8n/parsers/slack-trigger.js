// Parses a Slack trigger message into a spawn request (docs/02-trigger-intake.md).
// Plain JS on purpose: unit-tested with node:test, and inlined into the n8n Code node by n8n/build.mjs.
//
// Accepted forms (Slack wraps links as <url> or <url|label> and bold as *text*):
//   *Jira ticket url* https://code-crafter.atlassian.net/browse/SCRUM-2
//   *Service* expense-manager
//   *Base branch* main
//   *Environment* qa            (accepted, ignored for now)
// or the shorthand: "SCRUM-2", "work on SCRUM-2", or just the Jira URL.

function parseSlackTrigger(rawText) {
  const text = String(rawText || '')
    .replace(/<([^>|]+)\|[^>]*>/g, '$1') // <url|label> → url
    .replace(/<([^>]+)>/g, '$1') // <url> → url
    .replace(/\*/g, '') // *bold*
    .trim();

  if (!text) return { ok: false, reason: 'empty message' };

  const field = (label) => {
    const re = new RegExp('^\\s*' + label + '\\s*[:\\-]?\\s*(\\S.*)$', 'im');
    const m = text.match(re);
    return m ? m[1].trim() : undefined;
  };

  const urlField = field('jira(?:\\s+ticket)?(?:\\s+url)?');
  const keySource = urlField || text;
  const keyMatch =
    keySource.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/) || keySource.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
  if (!keyMatch) {
    return {
      ok: false,
      reason:
        'no Jira ticket found. Post e.g. `SCRUM-2`, or:\n*Jira ticket url* https://…/browse/SCRUM-2\n*Service* expense-manager\n*Base branch* main',
    };
  }

  const jiraUrlMatch = keySource.match(/https?:\/\/[^\s]+\/browse\/[A-Z][A-Z0-9_]+-\d+/);
  const service = field('service');
  const baseBranch = field('base\\s+branch');
  const environment = field('env(?:ironment)?');

  const badName = (v) => v !== undefined && !/^[A-Za-z0-9._\/-]+$/.test(v);
  if (badName(service)) return { ok: false, reason: 'service name looks invalid: ' + service };
  if (badName(baseBranch)) return { ok: false, reason: 'base branch looks invalid: ' + baseBranch };

  return {
    ok: true,
    jiraKey: keyMatch[1],
    jiraUrl: jiraUrlMatch ? jiraUrlMatch[0] : undefined,
    service: service,
    baseBranch: baseBranch,
    environment: environment,
  };
}

// ── n8n build cut: everything below is dropped when inlined into a Code node ──
export { parseSlackTrigger };
