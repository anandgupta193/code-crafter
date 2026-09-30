import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { C, FONT, MONO } from '../theme';
import { Card, Chip, CodeLine, JiraCard, Msg, Node, Pop, SlackWindow, Typed, useIn, useT, Wire } from '../ui';

const Stage: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ top: 130, bottom: 190, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: C.text, ...style }}>
    {children}
  </AbsoluteFill>
);

const Logo: React.FC<{ size?: number }> = ({ size = 120 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.25, fontFamily: FONT }}>
    <div
      style={{
        width: size * 1.3,
        height: size * 1.3,
        borderRadius: size * 0.32,
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.8,
        background: `linear-gradient(135deg, ${C.purple}, ${C.orange})`,
        boxShadow: `0 0 ${size}px ${C.purple}66`,
      }}
    >
      🛠️
    </div>
    <div
      style={{
        fontSize: size,
        fontWeight: 900,
        letterSpacing: -2,
        background: `linear-gradient(90deg, #fff, ${C.orange})`,
        WebkitBackgroundClip: 'text',
        color: 'transparent',
      }}
    >
      Code-Crafter
    </div>
  </div>
);

// ── 1 · Hook ─────────────────────────────────────────────────────────────
export const S1: React.FC = () => {
  const logo = useIn(62, 9);
  return (
    <Stage style={{ flexDirection: 'column', gap: 70 }}>
      <div style={{ fontSize: 76, fontWeight: 800, textAlign: 'center', maxWidth: 1500, lineHeight: 1.2 }}>
        <Typed text="What if a Slack message could write code?" start={4} cps={26} />
      </div>
      <div style={{ opacity: logo, transform: `scale(${0.4 + 0.6 * logo}) rotate(${(1 - logo) * -8}deg)` }}>
        <Logo />
      </div>
    </Stage>
  );
};

// ── 2 · Idea → Jira ──────────────────────────────────────────────────────
export const S2: React.FC = () => {
  const fly = useIn(78, 13);
  return (
    <Stage style={{ gap: 90 }}>
      <SlackWindow channel="ops">
        <Msg who="you" delay={6}>
          <Typed text="Add a search box to the Expenses page" start={12} cps={34} />
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>– filter by description or notes</div>
        </Msg>
        <Msg who="bot" delay={120}>
          🎫 Created <b style={{ color: C.jira }}>SCRUM-8</b> — refine it, then post it in #code-crafter
        </Msg>
      </SlackWindow>
      <div style={{ opacity: fly, transform: `translateX(${(1 - fly) * -420}px) rotate(${(1 - fly) * -12}deg) scale(${0.5 + 0.5 * fly})` }}>
        <JiraCard status="To Do" />
      </div>
    </Stage>
  );
};

// ── 3 · Trigger ──────────────────────────────────────────────────────────
export const S3: React.FC = () => {
  const w1 = useT(40, 70);
  const w2 = useT(72, 102);
  return (
    <Stage style={{ flexDirection: 'column', gap: 60 }}>
      <SlackWindow channel="code-crafter" style={{ width: 900 }}>
        <Msg who="you" delay={4} reaction={{ emoji: '👀', delay: 30 }}>
          <span style={{ fontFamily: MONO, color: C.jira }}>SCRUM-8</span>
        </Msg>
      </SlackWindow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
        <Pop delay={20}>
          <Node icon="💬" label="Slack" sub="Socket Mode" lit={w1 > 0 ? 1 : 0} color={C.slack} style={{ width: 260 }} />
        </Pop>
        <Wire progress={w1} width={150} />
        <Pop delay={26}>
          <Node icon="🧩" label="n8n" sub="parse · route" lit={w1 >= 1 ? 1 : 0} color="#EA4B71" style={{ width: 260 }} />
        </Pop>
        <Wire progress={w2} width={150} color={C.orange} />
        <Pop delay={32}>
          <Node icon="🧭" label="Control plane" sub="lock · dedupe · cap" lit={w2 >= 1 ? 1 : 0} color={C.orange} style={{ width: 300 }} />
        </Pop>
      </div>
    </Stage>
  );
};

// ── 4 · Container ────────────────────────────────────────────────────────
export const S4: React.FC = () => {
  const box = useIn(8, 10);
  const clone = useT(40, 100);
  const branch = useT(100, 140);
  const moved = useIn(150, 14);
  return (
    <Stage style={{ gap: 80 }}>
      <Node icon="🧭" label="Control plane" lit={1} color={C.orange} style={{ width: 280 }} />
      <Wire progress={useT(0, 16)} width={90} color={C.orange} />
      <div style={{ opacity: box, transform: `translateY(${(1 - box) * -200}px) scale(${0.7 + 0.3 * box})` }}>
        <Card style={{ width: 620, padding: 34 }} glow={C.purple}>
          <div style={{ fontSize: 30, fontWeight: 800 }}>📦 code-crafter-scrum-8</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>fresh container · just for this ticket</div>
          <div style={{ marginTop: 30, fontSize: 24 }}>⬇️ cloning expense-manager</div>
          <div style={{ height: 16, borderRadius: 8, background: C.panel2, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ width: `${clone * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.purple}, ${C.orange})` }} />
          </div>
          <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 14, fontSize: 24, opacity: branch }}>
            🌿
            <span
              style={{
                fontFamily: MONO,
                color: C.green,
                clipPath: `inset(0 ${(1 - branch) * 100}% 0 0)`,
                border: `2px solid ${C.green}`,
                borderRadius: 10,
                padding: '4px 12px',
              }}
            >
              CODE-CRAFTER-SCRUM-8
            </span>
          </div>
        </Card>
      </div>
      <div style={{ position: 'relative', width: 380, height: 280 }}>
        <div style={{ position: 'absolute', top: -46, left: 0, display: 'flex', gap: 14, fontSize: 20, color: C.muted, fontWeight: 700 }}>
          <span style={{ opacity: 1 - moved * 0.6 }}>TO DO</span>→<span style={{ color: moved > 0.5 ? C.orange : C.muted }}>IN PROGRESS</span>
        </div>
        <div style={{ transform: `translateY(${moved * 20}px)` }}>
          <JiraCard status={moved > 0.5 ? 'In Progress' : 'To Do'} />
        </div>
      </div>
    </Stage>
  );
};

// ── 5 · Claude writes code ───────────────────────────────────────────────
const CODE = [
  ["const [query, setQuery] = ", "useState('')"],
  ['const filtered = expenses.filter((e) =>', ''],
  ['  e.description.toLowerCase()', '.includes(q) ||'],
  ['  e.notes?.toLowerCase()', '.includes(q))'],
  ['<Input placeholder=', '"Search expenses" />'],
];

export const S5: React.FC = () => {
  const frame = useCurrentFrame();
  const shown = Math.floor(interpolate(frame, [20, 150], [0, CODE.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const chips = [70, 115, 160];
  const pr = useIn(175, 11);
  return (
    <Stage style={{ gap: 60 }}>
      <Card style={{ width: 900, overflow: 'hidden' }} glow={C.orange}>
        <div style={{ padding: '16px 26px', background: C.panel2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>🧠 Claude Code · hooks/useExpenseTable.ts</div>
          <Chip color={C.orange}>writing…</Chip>
        </div>
        <div style={{ padding: 30, background: C.code, minHeight: 290 }}>
          {CODE.slice(0, shown + 1).map(([a, b], i) => (
            <CodeLine key={i}>
              <span style={{ color: '#C4B5FD' }}>{a}</span>
              <span style={{ color: '#FDBA74' }}>{i < shown ? b : ''}</span>
              {i === shown && shown < CODE.length ? <span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0.2 }}>▍</span> : null}
            </CodeLine>
          ))}
        </div>
      </Card>
      <div style={{ position: 'relative', width: 440, height: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {chips.map((start, i) => {
          const t = interpolate(frame, [start, start + 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          if (t <= 0 || t >= 1) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: -260 + 360 * t,
                top: 250 - 170 * t,
                opacity: 1 - t * 0.3,
                fontSize: 22,
                fontFamily: MONO,
                padding: '6px 14px',
                borderRadius: 999,
                background: '#22C55E33',
                border: `2px solid ${C.green}`,
                color: C.green,
              }}
            >
              💾 commit
            </div>
          );
        })}
        <div style={{ fontSize: 110, marginBottom: 20 }}>🐙</div>
        <div style={{ opacity: pr, transform: `scale(${0.6 + 0.4 * pr})` }}>
          <Card style={{ padding: 26, width: 400 }} glow={C.purple}>
            <div style={{ fontSize: 22, color: C.muted }}>Pull request</div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>PR #8 · search box</div>
            <div style={{ marginTop: 14 }}>
              <Chip color={C.muted}>Draft</Chip>
            </div>
          </Card>
        </div>
      </div>
    </Stage>
  );
};

// ── 6 · Verify ───────────────────────────────────────────────────────────
export const S6: React.FC = () => {
  const checks = ['lint', 'format', 'typecheck', 'build'];
  const toast = useIn(150, 12);
  return (
    <Stage style={{ gap: 80 }}>
      <Card style={{ width: 640, padding: 40 }}>
        <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 26 }}>🔍 Verifying its own work</div>
        {checks.map((c, i) => {
          const p = useIn(25 + i * 28, 12);
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 34, padding: '14px 0', borderBottom: i < 3 ? `1px solid ${C.border}` : 'none' }}>
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 25,
                  display: 'grid',
                  placeItems: 'center',
                  background: p > 0.5 ? C.green : C.panel2,
                  transform: `scale(${0.7 + 0.3 * p})`,
                  fontSize: 30,
                  fontWeight: 900,
                }}
              >
                {p > 0.5 ? '✓' : ''}
              </div>
              <span style={{ fontFamily: MONO, color: p > 0.5 ? C.text : C.muted }}>npm run {c}</span>
            </div>
          );
        })}
      </Card>
      <div style={{ opacity: toast, transform: `translateX(${(1 - toast) * 300}px)` }}>
        <SlackWindow channel="code-crafter" style={{ width: 620 }}>
          <Msg who="bot" delay={150}>
            ✅ <b>Done</b> — PR #8 is ready for your review
          </Msg>
        </SlackWindow>
      </div>
    </Stage>
  );
};

// ── 7 · Review loop ──────────────────────────────────────────────────────
export const S7: React.FC = () => {
  const frame = useCurrentFrame();
  const zip = useT(55, 85);
  const awake = frame > 85;
  const out = useT(120, 150);
  const reply = useIn(155, 12);
  return (
    <Stage style={{ gap: 70 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, width: 720 }}>
        <Pop delay={6}>
          <Card style={{ padding: 28 }}>
            <div style={{ fontSize: 22, color: C.muted }}>🧑 You · components/ExpenseTable.tsx</div>
            <div style={{ fontSize: 30, marginTop: 10 }}>“Search expenses” would be a better placeholder</div>
          </Card>
        </Pop>
        <div style={{ opacity: reply, transform: `translateY(${(1 - reply) * 30}px)`, marginLeft: 60 }}>
          <Card style={{ padding: 28, borderColor: C.green }}>
            <div style={{ fontSize: 22, color: C.muted }}>🛠️ code-crafter · reply</div>
            <div style={{ fontSize: 30, marginTop: 10 }}>Updated! ✅ checks green</div>
          </Card>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        {zip > 0 && zip < 1 ? (
          <div style={{ position: 'absolute', left: -380 + 380 * zip, top: 80, fontSize: 48, opacity: 1 - zip * 0.5 }}>💬</div>
        ) : null}
        {out > 0 && out < 1 ? (
          <div style={{ position: 'absolute', left: -60 - 300 * out, top: 180 + 60 * out, fontSize: 22, fontFamily: MONO, color: C.green, padding: '6px 14px', borderRadius: 999, border: `2px solid ${C.green}` }}>
            💾 fix
          </div>
        ) : null}
        <Card style={{ width: 360, padding: 34, textAlign: 'center' }} glow={awake ? C.orange : undefined}>
          <div style={{ fontSize: 110 }}>{awake ? '⚡' : '😴'}</div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>📦 scrum-8</div>
          <div style={{ fontSize: 22, color: awake ? C.orange : C.muted, marginTop: 6 }}>{awake ? 'awake · same session' : 'sleeping'}</div>
        </Card>
      </div>
    </Stage>
  );
};

// ── 8 · Merge + outro ────────────────────────────────────────────────────
export const S8: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const press = interpolate(frame, [18, 24, 30], [1, 0.9, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const done = useIn(40, 12);
  const fade = useT(70, 100);
  const outroAt = dur - 110;
  const outro = useIn(outroAt, 12);
  const confettiT = frame - 26;
  return (
    <>
      <Stage style={{ gap: 70, opacity: 1 - outro }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34, alignItems: 'center' }}>
          <div
            style={{
              padding: '26px 60px',
              borderRadius: 18,
              fontSize: 40,
              fontWeight: 800,
              background: C.green,
              color: '#04210F',
              transform: `scale(${press})`,
              boxShadow: `0 0 70px ${C.green}88`,
            }}
          >
            🟢 Merge pull request
          </div>
          <div style={{ fontSize: 26, color: C.muted, opacity: 1 - fade }}>📦 container cleaning up… 🫧</div>
        </div>
        <JiraCard status={done > 0.5 ? 'Done' : 'In Progress'} style={{ transform: `scale(${1 + 0.05 * done})` }} />
        <SlackWindow channel="code-crafter" style={{ width: 560 }}>
          <Msg who="you" delay={0} reaction={{ emoji: '✅', delay: 48 }}>
            <span style={{ fontFamily: MONO, color: C.jira }}>SCRUM-8</span>
          </Msg>
        </SlackWindow>
        {confettiT > 0 && confettiT < 70
          ? Array.from({ length: 70 }).map((_, i) => {
              const x = 960 + (random(`x${i}`) - 0.5) * 1400 * (confettiT / 70);
              const y = 400 - 300 * random(`y${i}`) * Math.sin((confettiT / 70) * Math.PI) + confettiT * 6;
              const colors = [C.purple, C.orange, C.green, C.jira, '#FDE047'];
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    width: 14,
                    height: 22,
                    borderRadius: 4,
                    background: colors[i % colors.length],
                    transform: `rotate(${confettiT * 12 + i * 40}deg)`,
                    opacity: 1 - confettiT / 70,
                  }}
                />
              );
            })
          : null}
      </Stage>
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, opacity: outro, fontFamily: FONT }}>
        <div style={{ transform: `scale(${0.7 + 0.3 * outro})` }}>
          <Logo size={110} />
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: C.text }}>Post a ticket. Get a pull request. 🚀</div>
        <div style={{ fontSize: 34, fontFamily: MONO, color: C.orange, padding: '12px 28px', border: `2px solid ${C.border}`, borderRadius: 16 }}>
          github.com/anandgupta193/code-crafter
        </div>
      </AbsoluteFill>
    </>
  );
};
