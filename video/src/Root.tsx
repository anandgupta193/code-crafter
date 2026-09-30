import React from 'react';
import { Composition } from 'remotion';
import { Explainer, OUTRO_HOLD } from './Explainer';
import timing from './timing.json';

export const Root: React.FC = () => (
  <Composition
    id="Explainer"
    component={Explainer}
    durationInFrames={timing.totalFrames + OUTRO_HOLD}
    fps={timing.fps}
    width={1920}
    height={1080}
  />
);
