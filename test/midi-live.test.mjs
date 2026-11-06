import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, expandArrangement } from '../src/model.mjs';
import { createMidiLiveEngine } from '../src/midi-live.mjs';

test('live MIDI playback maps all four groups to pad notes on the selected channel and stops cleanly', async () => {
  const project = createSession(); project.bpm = 120; project.patterns[1].notes = [{ id: 'b', pad: 13, pitch: 72, velocity: 99, start: 0, duration: 120 }];
  let clock = 0, update, stopped = 0; const sent = [];
  const output = { state: 'connected', open: async () => {}, clear: () => sent.push(['clear']), send: (bytes, at) => sent.push([bytes, at]) };
  const engine = createMidiLiveEngine({ expand: expandArrangement, getOutput: () => output, getChannel: () => 2, now: () => clock, every: fn => { update = fn; return 1; }, cancel: () => {}, onStop: () => stopped++ });
  await engine.play(project, new Map(), { startTick: 0, endTick: 240 });
  assert.deepEqual(sent.find(row => Array.isArray(row[0]) && row[0][0] === 0x92)[0], [0x92, 49, 99]);
  clock = 400; update(); assert.equal(engine.playing, false); assert.equal(stopped, 1); assert.ok(sent.some(row => Array.isArray(row[0]) && row[0][0] === 0x82));
});
