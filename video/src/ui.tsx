import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, MONO, STAGES } from './theme';

/** 0→1 spring starting at `delay` frames. */
export const useIn = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.6 } });
};

/** Linear 0→1 between two frames, clamped. */
export const useT = (from: number, to: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
};

export const Pop: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }> = ({
  delay = 0,
  children,
  style,
  from = 0.6,
}) => {
  const p = useIn(delay);
  return <div style={{ opacity: p, transform: `scale(${from + (1 - from) * p}) translateY(${(1 - p) * 30}px)`, ...style }}>{children}</div>;
};

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; glow?: string }> = ({ children, style, glow }) => (
  <div
    style={{
      background: C.panel,
      border: `2px solid ${C.border}`,
      borderRadius: 24,
      boxShadow: glow ? `0 0 60px ${glow}55, 0 20px 60px #0008` : '0 20px 60px #0008',
      fontFamily: FONT,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Typed: React.FC<{ text: string; start: number; cps?: number; style?: React.CSSProperties; cursor?: boolean }> = ({
  text,
  start,
  cps = 28,
  style,
  cursor = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(0, Math.floor(((frame - start) / fps) * cps));
  const done = n >= text.length;
  return (
    <span style={style}>
      {text.slice(0, n)}
      {cursor && !done && frame >= start ? <span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0.2 }}>▍</span> : null}
    </span>
  );
};

/** Slack-like window with a channel header. */
export const SlackWindow: React.FC<{ channel: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ channel, children, style }) => (
  <Card style={{ width: 760, overflow: 'hidden', ...style }}>
    <div style={{ background: C.slack, padding: '18px 28px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
        ))}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginLeft: 12 }}># {channel}</div>
    </div>
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>{children}</div>
  </Card>
);

export const Msg: React.FC<{ who: 'you' | 'bot'; children: React.ReactNode; delay?: number; reaction?: { emoji: string; delay: number } }> = ({
  who,
  children,
  delay = 0,
  reaction,
}) => {
  const p = useIn(delay);
  const r = useIn(reaction?.delay ?? 9999, 9);
  return (
    <div style={{ display: 'flex', gap: 18, opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 14,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: 32,
          background: who === 'you' ? '#E0E7FF' : `linear-gradient(135deg, ${C.purple}, ${C.orange})`,
        }}
      >
        {who === 'you' ? '🧑' : '🛠️'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
          {who === 'you' ? 'You' : 'code-crafter'} <span style={{ color: C.muted, fontWeight: 400, fontSize: 18 }}>{who === 'bot' ? 'APP' : ''}</span>
        </div>
        <div style={{ fontSize: 26, color: '#E3E3F0', marginTop: 6, lineHeight: 1.35 }}>{children}</div>
        {reaction ? (
          <div
            style={{
              display: 'inline-flex',
              marginTop: 10,
              padding: '4px 14px',
              borderRadius: 20,
              border: `2px solid ${C.blue}`,
              background: '#1D2B55',
              fontSize: 24,
              transform: `scale(${r})`,
              opacity: r,
            }}
          >
            {reaction.emoji} 1
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const JiraCard: React.FC<{ status: string; style?: React.CSSProperties }> = ({ status, style }) => (
  <Card style={{ width: 360, padding: 26, borderColor: C.jira, ...style }} glow={C.jira}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, color: C.jira, fontWeight: 800 }}>🎫 SCRUM-8</div>
    <div style={{ fontSize: 26, marginTop: 12, fontWeight: 600, lineHeight: 1.3 }}>Add a search box to the Expenses page</div>
    <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
      <Chip color={C.purple}>Story</Chip>
      <Chip color={status === 'Done' ? C.green : status === 'In Progress' ? C.orange : C.muted}>{status}</Chip>
    </div>
  </Card>
);

export const Chip: React.FC<{ color: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ color, children, style }) => (
  <span
    style={{
      fontSize: 20,
      fontWeight: 700,
      padding: '6px 14px',
      borderRadius: 999,
      color,
      border: `2px solid ${color}`,
      background: `${color}22`,
      fontFamily: FONT,
      ...style,
    }}
  >
    {children}
  </span>
);

export const Node: React.FC<{ icon: string; label: string; sub?: string; lit?: number; color?: string; style?: React.CSSProperties }> = ({
  icon,
  label,
  sub,
  lit = 0,
  color = C.purple,
  style,
}) => (
  <Card
    style={{
      width: 300,
      padding: '26px 20px',
      textAlign: 'center',
      borderColor: lit > 0.5 ? color : C.border,
      boxShadow: `0 0 ${80 * lit}px ${color}${lit > 0 ? '88' : '00'}, 0 20px 60px #0008`,
      transform: `scale(${1 + 0.06 * lit})`,
      ...style,
    }}
  >
    <div style={{ fontSize: 64 }}>{icon}</div>
    <div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{label}</div>
    {sub ? <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{sub}</div> : null}
  </Card>
);

/** Animated dashed connector, progress 0→1 draws it left to right. */
export const Wire: React.FC<{ progress: number; width: number; color?: string }> = ({ progress, width, color = C.purple }) => {
  const frame = useCurrentFrame();
  return (
    <svg width={width} height={40} style={{ overflow: 'visible' }}>
      <line x1={0} y1={20} x2={width * progress} y2={20} stroke={color} strokeWidth={6} strokeDasharray="14 12" strokeDashoffset={-frame * 2} strokeLinecap="round" />
      {progress > 0.02 && progress < 1 ? <circle cx={width * progress} cy={20} r={11} fill={color} /> : null}
      {progress >= 1 ? <polygon points={`${width - 4},6 ${width + 16},20 ${width - 4},34`} fill={color} /> : null}
    </svg>
  );
};

export const ProgressStrip: React.FC<{ active: number }> = ({ active }) => (
  <div style={{ position: 'absolute', top: 40, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 14, fontFamily: FONT }}>
    {STAGES.map((s, i) => {
      const on = i === active;
      const done = i < active;
      return (
        <div
          key={s}
          style={{
            padding: '10px 20px',
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 700,
            color: on ? '#fff' : done ? C.text : C.muted,
            background: on ? `linear-gradient(90deg, ${C.purple}, ${C.orange})` : done ? '#26264A' : '#15152A',
            border: `2px solid ${on ? 'transparent' : C.border}`,
            opacity: active < 0 ? 0.35 : 1,
            transform: `scale(${on ? 1.08 : 1})`,
          }}
        >
          {s}
        </div>
      );
    })}
  </div>
);

export const Caption: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const p = useIn(delay, 20);
  return (
    <div style={{ position: 'absolute', bottom: 56, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: p }}>
      <div
        style={{
          maxWidth: 1500,
          padding: '16px 34px',
          borderRadius: 18,
          background: '#000000AA',
          border: `1px solid ${C.border}`,
          color: C.text,
          fontFamily: FONT,
          fontSize: 34,
          fontWeight: 500,
          textAlign: 'center',
          lineHeight: 1.35,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const CodeLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: MONO, fontSize: 24, lineHeight: 1.6, whiteSpace: 'pre', color: '#D4D4E8' }}>{children}</div>
);
