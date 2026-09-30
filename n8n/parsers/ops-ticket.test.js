import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsToJiraIssue } from './ops-ticket.js';

test('first line becomes the title, the rest becomes paragraphs and bullets', () => {
  const r = opsToJiraIssue('*Add CSV export* for expenses\n\nUsers want to download a month.\n- include category\n- include spender', {
    author: 'Anand',
    permalink: 'https://slack/p1',
  });
  assert.equal(r.fields.summary, 'Add CSV export for expenses');
  assert.equal(r.fields.issuetype.name, 'Story');
  assert.equal(r.fields.project.key, 'SCRUM');
  assert.deepEqual(r.fields.labels, ['from-slack']);
  const [p1, p2, list, rule, footer] = r.fields.description.content;
  assert.equal(p1.type, 'paragraph');
  assert.equal(p2.content[0].text, 'Users want to download a month.');
  assert.deepEqual(list.content.map((li) => li.content[0].content[0].text), ['include category', 'include spender']);
  assert.equal(rule.type, 'rule');
  assert.equal(footer.content[0].text, 'Created from Slack #ops by Anand');
  assert.equal(footer.content[2].marks[0].attrs.href, 'https://slack/p1');
});

test('unwraps Slack links, channels and entities', () => {
  const r = opsToJiraIssue('See <https://x.io/a|the doc> in <#C1|eng> &amp; ping <@U123>');
  assert.equal(r.fields.summary, 'See the doc (https://x.io/a) in #eng & ping @U123');
});

test('long titles are cut on a word boundary', () => {
  const r = opsToJiraIssue('word '.repeat(60));
  assert.ok(r.fields.summary.length <= 120);
  assert.ok(r.fields.summary.endsWith('…'));
});

test('empty messages are skipped', () => {
  assert.deepEqual(opsToJiraIssue('   '), { skip: 'empty message' });
});
