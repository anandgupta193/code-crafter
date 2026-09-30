// Comment triage (docs/09-feedback-and-merge.md): before a feedback round, drop feedback that is already
// handled and order the rest so the most important work goes first.
//
//   handled  = thread resolved on GitHub
//            | the bot replied in the same thread after the comment
//            | the orchestrator recorded the comment as handled (state + <!-- cc-handled --> marker)
//   CI       = keep only the newest failure (stale-HEAD failures are dropped elsewhere)
//   order    = control → CI failure → change requests → plain comments; newest first inside a group

import type { AgentCommand } from './prompt.ts';

export interface ThreadComment {
  id: number;
  author: string;
  createdAt: string; // ISO
}

export interface ReviewThread {
  resolved: boolean;
  comments: ThreadComment[]; // oldest first
}

export interface TriageContext {
  botLogin: string;
  threads: ReviewThread[];
  handledIds: Set<number>;
}

export interface Skipped {
  cmd: AgentCommand;
  reason: string;
}

export const HANDLED_MARKER = /<!-- cc-handled: ([0-9,\s]+) -->/g;

/** Comment IDs recorded as handled in bot comments (durable across volume loss). */
export function parseHandledMarkers(bodies: string[]): number[] {
  const ids: number[] = [];
  for (const body of bodies) {
    for (const m of body.matchAll(HANDLED_MARKER)) {
      for (const s of m[1].split(',')) if (s.trim()) ids.push(Number(s.trim()));
    }
  }
  return ids;
}

export const handledMarker = (ids: number[]) => (ids.length ? `<!-- cc-handled: ${ids.join(',')} -->` : '');

/** Why a comment counts as already handled, or undefined if it still needs work. */
export function handledReason(id: number, ctx: TriageContext): string | undefined {
  if (ctx.handledIds.has(id)) return 'already handled in an earlier round';
  for (const t of ctx.threads) {
    const idx = t.comments.findIndex((c) => c.id === id);
    if (idx === -1) continue;
    if (t.resolved) return 'thread resolved';
    const at = Date.parse(t.comments[idx].createdAt);
    const botReplied = t.comments.some((c, i) => i !== idx && c.author === ctx.botLogin && Date.parse(c.createdAt) > at);
    if (botReplied) return 'code-crafter already replied in the thread';
  }
  return undefined;
}

function priority(c: AgentCommand): number {
  if (c.payload.kind === 'control') return 0;
  if (c.type === 'fix_pipeline') return 1;
  if (c.payload.kind === 'review_comment' || c.payload.reviewState === 'changes_requested') return 2;
  return 3;
}

export function triage(cmds: AgentCommand[], ctx: TriageContext): { keep: AgentCommand[]; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  let latestCi: AgentCommand | undefined;
  const keep: AgentCommand[] = [];

  for (const c of cmds) {
    if (c.type === 'fix_pipeline') {
      if (!latestCi || Date.parse(c.receivedAt) >= Date.parse(latestCi.receivedAt)) {
        if (latestCi) skipped.push({ cmd: latestCi, reason: 'superseded by a newer CI failure' });
        latestCi = c;
      } else {
        skipped.push({ cmd: c, reason: 'superseded by a newer CI failure' });
      }
      continue;
    }
    const id = typeof c.payload.id === 'number' ? c.payload.id : undefined;
    if (id !== undefined) {
      const key = `${c.payload.kind}:${id}`;
      if (seen.has(key)) {
        skipped.push({ cmd: c, reason: 'duplicate' });
        continue;
      }
      seen.add(key);
      const why = handledReason(id, ctx);
      if (why) {
        skipped.push({ cmd: c, reason: why });
        continue;
      }
    }
    keep.push(c);
  }
  if (latestCi) keep.push(latestCi);

  keep.sort((a, b) => priority(a) - priority(b) || Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return { keep, skipped };
}

/** Comment IDs a finished round has now handled (recorded so a restart never redoes them). */
export function commentIds(cmds: AgentCommand[]): number[] {
  return cmds.map((c) => c.payload.id).filter((id): id is number => typeof id === 'number');
}
