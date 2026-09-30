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
};

const out = path.join(here, 'workflows');
mkdirSync(out, { recursive: true });
for (const [file, wf] of Object.entries(workflows)) {
  writeFileSync(path.join(out, `${file}.json`), JSON.stringify(wf, null, 2) + '\n');
  console.log(`wrote n8n/workflows/${file}.json`);
}
