// Generates the narration (macOS `say`) and an original ambient music bed, then writes src/timing.json
// so each scene lasts as long as its line of narration (+ breathing room).
//   node scripts/make-audio.mjs [voice]
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioDir = path.join(root, 'public', 'audio');
const VOICE = process.argv[2] ?? 'Samantha';
const RATE = 172; // words per minute
const FPS = 30;
const LEAD_IN = 0.35; // seconds of silence before each line
const TAIL = 0.75; // seconds after each line before the next scene

export const LINES = [
  'What if one Slack message could turn into a finished pull request?',
  'You post an idea in Slack. Code-Crafter instantly turns it into a Jira ticket.',
  'Post the ticket in the code-crafter channel, and the system picks it up.',
  'It spins up a brand-new container just for this ticket, clones the code, and creates its own branch.',
  'Claude Code reads the ticket, writes the change, commits as it goes, and opens a draft pull request.',
  'Then it double-checks its own work. Lint, types, build. Only green code reaches you.',
  'Leave a review comment, and the agent wakes up, fixes it, and replies. Just like a teammate.',
  "Merge it, and Jira moves to Done automatically. That's Code-Crafter. Post a ticket, get a pull request.",
];

const probe = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

const scenes = [];
LINES.forEach((line, i) => {
  const aiff = path.join(audioDir, `line-${i + 1}.aiff`);
  const wav = path.join(audioDir, `line-${i + 1}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, line]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '2', wav]);
  rmSync(aiff);
  const seconds = probe(wav);
  const frames = Math.ceil((LEAD_IN + seconds + TAIL) * FPS);
  scenes.push({ line, audio: `audio/line-${i + 1}.wav`, speechSeconds: +seconds.toFixed(2), leadInFrames: Math.round(LEAD_IN * FPS), frames });
});
const totalFrames = scenes.reduce((a, s) => a + s.frames, 0);

// ── Original ambient pad (copyright-free): slow chords + soft arpeggio, synthesised sample by sample ──
const SR = 48000;
const OUTRO_HOLD_SECONDS = 3; // keep in sync with OUTRO_HOLD in src/Explainer.tsx
const total = totalFrames / FPS + OUTRO_HOLD_SECONDS + 0.5;
const n = Math.floor(total * SR);
const left = new Float32Array(n);
const right = new Float32Array(n);
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Cmaj9 – Am9 – Fmaj7 – G6 (warm, optimistic), 4 bars of 4s each, looped
const chords = [
  [48, 55, 64, 67, 74],
  [45, 52, 60, 64, 71],
  [41, 48, 57, 64, 69],
  [43, 50, 59, 64, 69],
];
const BAR = 4;
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const bar = Math.floor(t / BAR);
  const chord = chords[bar % chords.length];
  const inBar = t - bar * BAR;
  // Pad: detuned sines with a slow swell per bar, crossfaded at bar edges
  const env = Math.min(1, inBar / 1.2) * Math.min(1, (BAR - inBar) / 0.8);
  let l = 0;
  let r = 0;
  for (const m of chord) {
    const f = midi(m);
    l += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * t);
    r += Math.sin(2 * Math.PI * f * 0.998 * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.005 * t);
  }
  l *= 0.05 * env;
  r *= 0.05 * env;
  // Arpeggio: one soft pluck every 0.5s, up the chord an octave higher
  const step = Math.floor(inBar / 0.5);
  const since = inBar - step * 0.5;
  const note = midi(chord[(step % (chord.length - 1)) + 1] + 12);
  const pluck = Math.sin(2 * Math.PI * note * t) * Math.exp(-since * 5) * 0.06;
  l += pluck * (step % 2 ? 0.6 : 1);
  r += pluck * (step % 2 ? 1 : 0.6);
  // Global fade in / out
  const g = Math.min(1, t / 2) * Math.min(1, (total - t) / 2.5);
  left[i] = l * g;
  right[i] = r * g;
}
// 16-bit stereo WAV
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.max(-1, Math.min(1, left[i])) * 32767 * 0.9, i * 4);
  data.writeInt16LE(Math.max(-1, Math.min(1, right[i])) * 32767 * 0.9, i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(path.join(audioDir, 'music.wav'), Buffer.concat([header, data]));

writeFileSync(path.join(root, 'src', 'timing.json'), JSON.stringify({ fps: FPS, voice: VOICE, totalFrames, scenes }, null, 2) + '\n');
console.log(`voice ${VOICE} · ${scenes.length} lines · ${(totalFrames / FPS).toFixed(1)}s total`);
scenes.forEach((s, i) => console.log(`  scene ${i + 1}: ${(s.frames / FPS).toFixed(1)}s  (speech ${s.speechSeconds}s)`));
