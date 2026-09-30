import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import timing from './timing.json';
import { C } from './theme';
import { Caption, ProgressStrip } from './ui';
import { S1, S2, S3, S4, S5, S6, S7, S8 } from './scenes/Scenes';

export const OUTRO_HOLD = 90; // extra frames on the final card
const STAGE_FOR_SCENE = [-1, 0, 1, 2, 3, 4, 5, 6];

const Background: React.FC = () => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 90) * 60;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 600px at ${300 + drift}px 200px, ${C.purple}33, transparent 70%),
                     radial-gradient(800px 600px at ${1650 - drift}px 950px, ${C.orange}26, transparent 70%),
                     ${C.bg}`,
      }}
    />
  );
};

export const Explainer: React.FC = () => {
  const frame = useCurrentFrame();
  let start = 0;
  const scenes = timing.scenes.map((s, i) => {
    const from = start;
    const dur = s.frames + (i === timing.scenes.length - 1 ? OUTRO_HOLD : 0);
    start += dur;
    return { ...s, from, dur, i };
  });
  const current = scenes.find((s) => frame >= s.from && frame < s.from + s.dur) ?? scenes[scenes.length - 1];
  const Scene = [S1, S2, S3, S4, S5, S6, S7, S8];

  return (
    <AbsoluteFill>
      <Background />
      {/* Original ambient bed, very low under the voice */}
      <Audio src={staticFile('audio/music.wav')} volume={(f) => interpolate(f, [0, 30], [0, 0.1], { extrapolateRight: 'clamp' })} />
      {scenes.map((s) => {
        const Comp = Scene[s.i];
        return (
          <Sequence key={s.i} from={s.from} durationInFrames={s.dur}>
            <SceneFade dur={s.dur}>{s.i === 7 ? <S8 dur={s.dur} /> : <Comp dur={s.dur} />}</SceneFade>
            <Sequence from={s.leadInFrames}>
              <Audio src={staticFile(s.audio)} />
            </Sequence>
            {s.i !== 7 || frame < s.from + s.dur - 110 ? <Caption text={s.line} delay={s.leadInFrames} /> : null}
          </Sequence>
        );
      })}
      <ProgressStrip active={STAGE_FOR_SCENE[current.i]} />
    </AbsoluteFill>
  );
};

const SceneFade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};
