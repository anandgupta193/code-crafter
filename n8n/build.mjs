// Generates n8n/workflows/*.json from the tested parsers (D22: git is the source of truth).
// The parser source is inlined into each Code node; secrets are never inlined — nodes read $env at runtime.
//   node n8n/build.mjs        (then scripts/n8n-import.sh loads them into n8n)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CUT = '// ── n8n build cut';

function parserSource(file) {
  const src = readFileSync(path.join(here, 'parsers', file), 'utf8');
  const i = src.indexOf(CUT);
  if (i === -1) throw new Error(`${file}: missing build cut marker`);
  return src.slice(0, i).trim();
}

const webhook = (name, pathName, webhookId, position) => ({
  parameters: { httpMethod: 'POST', path: pathName, responseMode: 'onReceived', options: {} },
  id: `${webhookId}-node`,
  name,
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position,
  webhookId,
});

const code = (name, id, jsCode, position) => ({
  parameters: { mode: 'runOnceForEachItem', jsCode },
  id,
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
});

const postToControlPlane = (name, id, route, position) => ({
  parameters: {
    method: 'POST',
    url: `={{ $env.CONTROL_PLANE_URL }}${route}`,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'x-codecrafter-token', value: '={{ $env.INTERNAL_API_TOKEN }}' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json) }}',
    options: {},
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
});


const slackGet = (name, id, urlExpr, position) => ({
  parameters: {
    url: urlExpr,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: '={{ "Bearer " + $env.SLACK_BOT_TOKEN }}' }] },
    options: {},
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
});

const slackPost = (name, id, method, bodyExpr, position) => ({
  parameters: {
    method: 'POST',
    url: `https://slack.com/api/${method}`,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: '={{ "Bearer " + $env.SLACK_BOT_TOKEN }}' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: bodyExpr,
    options: {},
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
});

const jiraCreate = (name, id, position) => ({
  parameters: {
    method: 'POST',
    url: '={{ $env.JIRA_BASE_URL }}/rest/api/3/issue',
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: 'Authorization', value: '={{ "Basic " + ($env.JIRA_EMAIL + ":" + $env.JIRA_API_TOKEN).base64Encode() }}' }],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ fields: $json.fields }) }}',
    // Keep going on errors so the Slack thread always gets an answer.
    options: { response: { response: { neverError: true } } },
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
});

const chain = (...names) =>
  Object.fromEntries(names.slice(0, -1).map((n, i) => [n, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]));

const workflows = {
  'slack-trigger': {
    id: 'cc0slacktrigger1',
    name: 'code-crafter · slack trigger',
    active: true,
    settings: { executionOrder: 'v1' },
    nodes: [
      webhook('Slack message', 'slack-trigger', '7d1c3f2a-5b1e-4c8e-9a51-2f6a1c0de001', [0, 0]),
      code(
        'Parse trigger',
        'cc-parse-slack',
        `${parserSource('slack-trigger.js')}\n\nconst b = $json.body || {};\nreturn { json: { ...parseSlackTrigger(b.text), slack: { channel: b.channel, ts: b.ts, user: b.user } } };`,
        [240, 0],
      ),
      postToControlPlane('Intake → control plane', 'cc-intake-slack', '/api/intake/slack', [480, 0]),
    ],
    connections: chain('Slack message', 'Parse trigger', 'Intake → control plane'),
  },
  'github-events': {
    id: 'cc0githubevents1',
    name: 'code-crafter · github events',
    active: true,
    settings: { executionOrder: 'v1' },
    nodes: [
      webhook('GitHub webhook', 'github', '7d1c3f2a-5b1e-4c8e-9a51-2f6a1c0de002', [0, 0]),
      code(
        'Summarize event',
        'cc-summarize-github',
        `${parserSource('github-event.js')}\n\nreturn { json: summarizeGithubEvent($json.headers, $json.body) };`,
        [240, 0],
      ),
      postToControlPlane('Event → control plane', 'cc-github-event', '/api/github-event', [480, 0]),
    ],
    connections: chain('GitHub webhook', 'Summarize event', 'Event → control plane'),
  },
  'ops-to-jira': {
    id: 'cc0opstojira0001',
    name: 'code-crafter · #ops → Jira',
    active: true,
    settings: { executionOrder: 'v1' },
    nodes: [
      webhook('Slack ops message', 'ops-intake', '7d1c3f2a-5b1e-4c8e-9a51-2f6a1c0de003', [0, 0]),
      slackGet('Who posted', 'cc-ops-user', "=https://slack.com/api/users.info?user={{ $('Slack ops message').item.json.body.user }}", [220, 0]),
      slackGet(
        'Permalink',
        'cc-ops-permalink',
        "=https://slack.com/api/chat.getPermalink?channel={{ $('Slack ops message').item.json.body.channel }}&message_ts={{ $('Slack ops message').item.json.body.ts }}",
        [440, 0],
      ),
      code(
        'Build Jira issue',
        'cc-ops-build',
        `${parserSource('ops-ticket.js')}

const msg = $('Slack ops message').item.json.body;
const u = $('Who posted').item.json.user || {};
const author = (u.profile && (u.profile.real_name || u.profile.display_name)) || u.real_name || u.name || msg.user;
const permalink = $('Permalink').item.json.permalink;
return { json: opsToJiraIssue(msg.text, { author, permalink, projectKey: 'SCRUM', issueType: 'Story' }) };`,
        [660, 0],
      ),
      jiraCreate('Create Jira issue', 'cc-ops-create', [880, 0]),
      code(
        'Reply text',
        'cc-ops-reply-text',
        `const msg = $('Slack ops message').item.json.body;
const built = $('Build Jira issue').item.json;
const r = $json;
let text;
if (r.key) {
  const site = String(r.self || '').replace(/\\/rest\\/.*$/, '');
  text = '🎫 Created <' + site + '/browse/' + r.key + '|' + r.key + '>: ' + built.fields.summary +
    '\\nRefine it in Jira, then post \`' + r.key + '\` in the code-crafter channel to start work.';
} else {
  const why = built.skip || JSON.stringify(r.errors || r.errorMessages || r).slice(0, 300);
  text = '❌ Could not create a Jira ticket: ' + why;
}
return { json: { channel: msg.channel, thread_ts: msg.ts, text, key: r.key || null } };`,
        [1100, 0],
      ),
      slackPost('Reply in thread', 'cc-ops-reply', 'chat.postMessage', '={{ JSON.stringify({ channel: $json.channel, thread_ts: $json.thread_ts, text: $json.text, unfurl_links: false }) }}', [1320, 0]),
      slackPost(
        'React',
        'cc-ops-react',
        'reactions.add',
        "={{ JSON.stringify({ channel: $('Reply text').item.json.channel, timestamp: $('Reply text').item.json.thread_ts, name: $('Reply text').item.json.key ? 'ticket' : 'x' }) }}",
        [1540, 0],
      ),
    ],
    connections: chain('Slack ops message', 'Who posted', 'Permalink', 'Build Jira issue', 'Create Jira issue', 'Reply text', 'Reply in thread', 'React'),
  },
};

const out = path.join(here, 'workflows');
mkdirSync(out, { recursive: true });
for (const [file, wf] of Object.entries(workflows)) {
  writeFileSync(path.join(out, `${file}.json`), JSON.stringify(wf, null, 2) + '\n');
  console.log(`wrote n8n/workflows/${file}.json`);
}
