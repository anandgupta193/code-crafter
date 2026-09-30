import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../src/prompt.ts';
import { commentIds, handledMarker, parseHandledMarkers, triage, type TriageContext } from '../src/triage.ts';

const cmd = (type: AgentCommand['type'], at: string, payload: Record<string, unknown>): AgentCommand => ({
  type,
  jiraKey: 'SCRUM-8',
  receivedAt: at,
  payload,
});
const ctx = (over: Partial<TriageContext> = {}): TriageContext => ({ botLogin: 'codecrafterbot', threads: [], handledIds: new Set(), ...over });

describe('triage', () => {
  it('orders: control → CI → change requests → comments, newest first inside a group', () => {
    const plainOld = cmd('handle_comment', '2026-10-01T10:00:00Z', { id: 1, kind: 'issue_comment' });
    const plainNew = cmd('handle_comment', '2026-10-01T10:05:00Z', { id: 2, kind: 'issue_comment' });
    const inline = cmd('handle_comment', '2026-10-01T10:01:00Z', { id: 3, kind: 'review_comment' });
    const changes = cmd('handle_comment', '2026-10-01T10:02:00Z', { id: 4, kind: 'review', reviewState: 'changes_requested' });
    const ci = cmd('fix_pipeline', '2026-10-01T09:00:00Z', { runId: 9 });
    const resume = cmd('handle_comment', '2026-10-01T08:00:00Z', { kind: 'control', body: 'resume' });
    const { keep } = triage([plainOld, plainNew, inline, changes, ci, resume], ctx());
    expect(keep).toEqual([resume, ci, changes, inline, plainNew, plainOld]);
  });

  it('keeps only the newest CI failure', () => {
    const a = cmd('fix_pipeline', '2026-10-01T09:00:00Z', { runId: 1 });
    const b = cmd('fix_pipeline', '2026-10-01T09:10:00Z', { runId: 2 });
    const { keep, skipped } = triage([b, a], ctx());
    expect(keep).toEqual([b]);
    expect(skipped[0]).toMatchObject({ cmd: a, reason: 'superseded by a newer CI failure' });
  });

  it('skips comments recorded as handled, in resolved threads, or already answered by the bot', () => {
    const recorded = cmd('handle_comment', 't', { id: 10, kind: 'issue_comment' });
    const resolved = cmd('handle_comment', 't', { id: 20, kind: 'review_comment' });
    const answered = cmd('handle_comment', 't', { id: 30, kind: 'review_comment' });
    const followUp = cmd('handle_comment', 't', { id: 31, kind: 'review_comment' });
    const threads = [
      { resolved: true, comments: [{ id: 20, author: 'anandgupta193', createdAt: '2026-10-01T10:00:00Z' }] },
      {
        resolved: false,
        comments: [
          { id: 30, author: 'anandgupta193', createdAt: '2026-10-01T10:00:00Z' },
          { id: 99, author: 'codecrafterbot', createdAt: '2026-10-01T10:01:00Z' },
          { id: 31, author: 'anandgupta193', createdAt: '2026-10-01T10:02:00Z' }, // reply after the bot → still new
        ],
      },
    ];
    const { keep, skipped } = triage([recorded, resolved, answered, followUp], ctx({ threads, handledIds: new Set([10]) }));
    expect(keep).toEqual([followUp]);
    expect(skipped.map((s) => s.reason)).toEqual([
      'already handled in an earlier round',
      'thread resolved',
      'code-crafter already replied in the thread',
    ]);
  });

  it('drops duplicate deliveries of the same comment', () => {
    const a = cmd('handle_comment', 't', { id: 5, kind: 'issue_comment' });
    const { keep, skipped } = triage([a, { ...a }], ctx());
    expect(keep).toHaveLength(1);
    expect(skipped[0].reason).toBe('duplicate');
  });
});

describe('handled markers', () => {
  it('round-trips through bot comments', () => {
    const body = `✅ done\n${handledMarker([4, 5])}\n\nlater ${handledMarker([9])}`;
    expect(parseHandledMarkers([body, 'no marker'])).toEqual([4, 5, 9]);
    expect(handledMarker([])).toBe('');
  });

  it('collects comment ids from commands', () => {
    expect(commentIds([cmd('handle_comment', 't', { id: 1 }), cmd('fix_pipeline', 't', { runId: 2 })])).toEqual([1]);
  });
});
