// Summarises a GitHub webhook delivery and routes it by branch convention (docs/03-event-bus-n8n.md).
// Phase 0 only logs the result in the control plane; Phase 1c turns these into /command calls.

function summarizeGithubEvent(headers, body) {
  const h = headers || {};
  const b = body || {};
  const event = h['x-github-event'] || 'unknown';
  const delivery = h['x-github-delivery'];
  const pr = b.pull_request || (b.issue && b.issue.pull_request ? b.issue : undefined);
  const branch =
    (b.pull_request && b.pull_request.head && b.pull_request.head.ref) ||
    (b.workflow_run && b.workflow_run.head_branch) ||
    (b.check_run && b.check_run.check_suite && b.check_run.check_suite.head_branch) ||
    undefined;

  const PREFIX = 'CODE-CRAFTER-';
  const jiraKey = branch && branch.startsWith(PREFIX) ? branch.slice(PREFIX.length) : undefined;

  return {
    event: event,
    action: b.action,
    delivery: delivery,
    repo: b.repository && b.repository.full_name,
    sender: b.sender && b.sender.login,
    prNumber: pr && pr.number,
    branch: branch,
    jiraKey: jiraKey,
    container: jiraKey ? 'code-crafter-' + jiraKey.toLowerCase() : undefined,
    routable: Boolean(jiraKey),
  };
}

// ── n8n build cut: everything below is dropped when inlined into a Code node ──
export { summarizeGithubEvent };
