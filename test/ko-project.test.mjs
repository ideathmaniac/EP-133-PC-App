import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { encodeWav } from '../src/core.mjs';
import { PakArchive } from '../src/backup.mjs';
import { importKoProject, inspectPatternLayout, inspectScenes, prepareRenderProject } from '../src/ko-project.mjs';
import { createSession, validateV2 } from '../src/model.mjs';

function tar(entries) {
  const parts = [];
  for (const [name, data] of Object.entries(entries)) {
    const header = new Uint8Array(512); header.set(strToU8(name)); header.set(strToU8(data.length.toString(8) + '\0'), 124); header.fill(32, 148, 156); header[156] = 48;
    const sum = header.reduce((a, b) => a + b, 0); header.fill(0, 148, 156); header.set(strToU8(sum.toString(8) + '\0 '), 148);
    parts.push(header, data, new Uint8Array((512 - data.length % 512) % 512));
  }
  parts.push(new Uint8Array(1024)); const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out;
}
const base64 = bytes => Buffer.from(bytes).toString('base64');

test('KO project import maps archive pads, timing, velocity and BPM into a valid Studio session', () => {
  const pad = new Uint8Array(26); pad[1] = 1; pad[8] = 3; pad[23] = 1; pad[24] = 60;
  const settings = new Uint8Array(224); new DataView(settings.buffer).setFloat32(4, 123, true);
  const pattern = Uint8Array.from([0, 1, 2, 0, 10, 0, 0, 62, 100, 24, 0, 0, 12, 0, 1, 0, 0, 255, 127, 0]);
  const wav = encodeWav([new Float32Array([0, .5, 0])], 46875), project = tar({ 'pads/a/p01': pad, 'patterns/a01': pattern, settings });
  const pak = new PakArchive(zipSync({ 'sounds/001 kick.wav': wav, 'projects/P01.tar': project })), entry = pak.entries.find(item => item.kind === 'project');
  const result = importKoProject(pak, entry, { toBase64: base64 }); validateV2(result.session);
  assert.equal(result.session.bpm, 123); assert.equal(result.session.pads[9].name, '001 kick'); assert.equal(result.session.pads[9].playMode, 'gate');
  assert.deepEqual(result.session.patterns.find(item => item.id === 'A01').notes[0], { id: 'A01-4', pad: 9, pitch: 62, velocity: 100, start: 50, duration: 120 });
  assert.match(result.warnings.join(' '), /автоматизации/); assert.deepEqual(inspectPatternLayout(pattern), { bars: 1, count: 2, records: [pattern.slice(4, 12), pattern.slice(12, 20)] });
});

test('WAV preparation reads each missing device slot once and leaves the source project unchanged', async () => {
  const project = createSession(); project.bars = 2; project.patterns[0].notes = [{ id: 'n', pad: 0, pitch: 60, velocity: 100, start: 0, duration: 120 }];
  project.pads[0].teMetadata = { koSampleSlot: 7 }; const wav = encodeWav([new Float32Array([0, .25, 0])], 46875); let reads = 0;
  const prepared = await prepareRenderProject(project, { toBase64: base64, readSlot: async slot => { reads++; assert.equal(slot, 7); return { bytes: wav, riff: true, metadata: {} }; } });
  assert.equal(reads, 1); assert.equal(project.pads[0].sample, null); assert.match(prepared.pads[0].sample, /^data:audio\/wav;base64,/); assert.ok(prepared.pads[0].trimEnd > 0);
});

test('scene and song-mode data becomes ordered Studio scenes and arrangement clips', () => {
  const scenes = new Uint8Array(712); scenes.set([0, 0, 0, 0, 0, 4, 4]);
  for (let i = 0; i < 99; i++) { scenes[7 + i * 6 + 4] = 4; scenes[7 + i * 6 + 5] = 4; }
  scenes.set([1, 0, 0, 0], 7); scenes.set([1, 1, 0, 0], 13); const trailer = 7 + 99 * 6;
  scenes[trailer + 3] = 2; scenes[trailer + 11] = 3; scenes.set([1, 2, 1], trailer + 12);
  const emptyPattern = Uint8Array.from([0, 1, 0, 0]);
  const project = tar({ 'patterns/a01': emptyPattern, 'patterns/b01': emptyPattern, scenes });
  const pak = new PakArchive(zipSync({ 'projects/song.tar': project })), entry = pak.entries.find(item => item.kind === 'project');
  const decoded = inspectScenes(scenes); assert.deepEqual(decoded.song, [1, 2, 1]); assert.equal(decoded.scenes.length, 2);
  const result = importKoProject(pak, entry, { toBase64: base64 }); validateV2(result.session);
  assert.equal(result.session.scenes.length, 2); assert.deepEqual(result.session.song, ['ko-scene-1', 'ko-scene-2', 'ko-scene-1']);
  assert.deepEqual(result.session.scenes[1].patterns.slice(0, 2), ['A01', 'B01']); assert.equal(result.session.clips.length, 4); assert.equal(result.session.bars, 3);
});
