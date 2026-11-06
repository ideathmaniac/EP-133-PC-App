import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTransients, snapSlicesToZeroCrossings, findAudibleRange } from '../src/sample-slice.mjs';

test('transient detection splits separated attacks and covers the full sample', () => {
  const rate = 8000, audio = new Float32Array(rate);
  for (const at of [2000, 4800]) for (let i = 0; i < 80; i++) audio[at + i] = Math.exp(-i / 15);
  const slices = detectTransients([audio], rate, { sensitivity: .5, minGap: .1, maxSlices: 12 });
  assert.equal(slices[0].start, 0); assert.equal(slices.at(-1).end, 1);
  assert.ok(slices.length >= 3); assert.ok(slices.some(slice => Math.abs(slice.start - .25) < .04)); assert.ok(slices.some(slice => Math.abs(slice.start - .6) < .04));
});

test('transient detection obeys the slice limit and handles empty input', () => {
  assert.deepEqual(detectTransients([], 48000), []);
  const audio = new Float32Array(48000); for (let i = 1000; i < audio.length; i += 2500) audio[i] = 1;
  assert.ok(detectTransients([audio], 48000, { sensitivity: .1, minGap: .01, maxSlices: 4 }).length <= 4);
});

test('slice boundaries snap near zero crossings and silence trim keeps padding', () => {
  const rate = 1000, audio = new Float32Array(rate); for (let i = 200; i < 800; i++) audio[i] = Math.sin((i - 200) * Math.PI / 10) * .5;
  const snapped = snapSlicesToZeroCrossings([{ start: 0, end: .503 }, { start: .503, end: 1 }], [audio], rate, { radius: .02 });
  assert.ok(Math.abs(audio[Math.round(snapped[1].start * rate)]) < .001); assert.ok(Math.abs(snapped[1].start - .5) <= .02);
  assert.deepEqual(findAudibleRange([audio], rate, { threshold: .01, padding: .01 }), { start: .191, end: .81 });
});
