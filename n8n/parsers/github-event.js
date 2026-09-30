// Summarises a GitHub webhook delivery (docs/03-event-bus-n8n.md, 09-feedback-and-merge.md).
// n8n parses; the control plane routes (it knows which containers are alive and can respawn them).

function summarizeGithubEvent(headers, body) {
  const h = headers || {};
  const b = body || {};
  const event = h['x-github-event'] || 'unknown';
  const pr = b.pull_request;
  const issuePr = b.issue && b.issue.pull_request ? b.issue : undefined;

  const branch =
    (pr && pr.head && pr.head.ref) ||
    (b.workflow_run && b.workflow_run.head_branch) ||
    (b.check_run && b.check_run.check_suite && b.check_run.check_suite.head_branch) ||
    undefined;

  const PREFIX = 'CODE-CRAFTER-';
  const jiraKey = branch && branch.startsWith(PREFIX) ? branch.slice(PREFIX.length) : undefined;

  const summary = {
    event: event,
    action: b.action,
    delivery: h['x-github-delivery'],
    repo: b.repository && b.repository.full_name,
    sender: b.sender && b.sender.login,
    senderType: b.sender && b.sender.type, // User | Bot
    prNumber: (pr && pr.number) || (issuePr && issuePr.number) || undefined,
    prUrl: (pr && pr.html_url) || (issuePr && issuePr.html_url) || undefined,
    branch: branch,
    jiraKey: jiraKey,
    container: jiraKey ? 'code-crafter-' + jiraKey.toLowerCase() : undefined,
    routable: Boolean(jiraKey),
    // issue_comment payloads carry no branch: the control plane looks the PR up.
    needsBranchLookup: Boolean(issuePr && !branch),
  };

  if (pr && event === 'pull_request') summary.merged = Boolean(pr.merged);

  if (b.comment) {
    summary.comment = {
      id: b.comment.id,
      body: b.comment.body,
      url: b.comment.html_url,
      path: b.comment.path,
      line: b.comment.line || b.comment.original_line,
      diffHunk: b.comment.diff_hunk,
      inReplyTo: b.comment.in_reply_to_id,
      kind: event === 'pull_request_review_comment' ? 'review_comment' : 'issue_comment',
    };
  }

  if (b.review) {
    summary.review = { id: b.review.id, state: b.review.state, body: b.review.body, url: b.review.html_url };
  }

  if (b.workflow_run) {
    summary.run = {
      id: b.workflow_run.id,
      name: b.workflow_run.name,
      status: b.workflow_run.status,
      conclusion: b.workflow_run.conclusion,
      headSha: b.workflow_run.head_sha,
      url: b.workflow_run.html_url,
    };
  }

  return summary;
}

// ── n8n build cut: everything below is dropped when inlined into a Code node ──
export { summarizeGithubEvent };
