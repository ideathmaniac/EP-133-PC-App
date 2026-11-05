import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { PakArchive, readTar, inspectWav, pcm16ToWav, safePath } from '../src/backup.mjs';
import { encodeWav } from '../src/core.mjs';

function tar(name, data) {
  const result = new Uint8Array(512 + Math.ceil(data.length / 512) * 512 + 1024);
  result.set(strToU8(name)); result.set(strToU8(data.length.toString(8).padStart(11, '0') + '\0'), 124); result.fill(32, 148, 156); result[156] = 48;
  const sum = result.subarray(0, 512).reduce((a, b) => a + b, 0); result.set(strToU8(sum.toString(8).padStart(6, '0') + '\0 '), 148); result.set(data, 512); return result;
}
test('PAK metadata, exact byte extraction, nested TAR, original unchanged', () => {
  const wav = encodeWav([new Float32Array([0, .5, -.5])], 46875), project = tar('pads/a/p01', new Uint8Array(26));
  const bytes = zipSync({ '/meta.json': strToU8('{"pak_type":"user","device_version":"2.5"}'), '/sounds/001 kick.wav': wav, '/projects/P01.tar': project });
  const before = bytes.slice(), pak = new PakArchive(bytes);
  assert.equal(pak.entries.length, 3); assert.equal(pak.metadata.device_version, '2.5');
  assert.deepEqual(pak.extract(pak.entries.find(x => x.kind === 'sound')), wav);
  assert.equal(pak.project(pak.entries.find(x => x.kind === 'project'))[0].name, 'pads/a/p01'); assert.deepEqual(bytes, before);
});
test('reject unsafe paths, duplicate aliases, decompression budget and damaged TAR', () => {
  for (const path of ['../a', '/sounds/../a', 'C:/file', 'a\\b', 'a/./b']) assert.throws(() => safePath(path));
  assert.throws(() => new PakArchive(zipSync({ '/a': strToU8('a'), 'a': strToU8('b') })), /Повторяющийся/);
  const damaged = tar('pads/a/p01', strToU8('x')); damaged[20] = 120; assert.throws(() => readTar(damaged), /заголовок/);
  const truncated = tar('pads/a/p01', new Uint8Array(1024)).subarray(0, 512); assert.throws(() => readTar(truncated), /Обрезанный/);
  const pak = new PakArchive(zipSync({ 'large': new Uint8Array(20) })); assert.throws(() => pak.extract(pak.entries[0], 10), /лимит/);
});
test('PCM s16 conversion preserves source bits and WAV metadata inspection', () => {
  const pcm = new Uint8Array([0, 128, 255, 127]); const wav = pcm16ToWav(pcm, { format: 's16', channels: 1, samplerate: 46875 });
  assert.deepEqual(wav.subarray(44), pcm); assert.equal(inspectWav(wav).bits, 16); assert.equal(inspectWav(wav).sampleRate, 46875);
  assert.throws(() => pcm16ToWav(pcm, { format: 'f32', channels: 1, samplerate: 48000 }));
  assert.throws(() => inspectWav(wav.subarray(0, 46)), /Обрезанный/);
});
const reference = 'artifacts/reference/factory.pak';
test('supplied factory PAK: 309 WAVs, nine TARs, TE metadata and 26-byte pads', { skip: !fs.existsSync(reference) }, () => {
  const pak = new PakArchive(new Uint8Array(fs.readFileSync(reference))), sounds = pak.entries.filter(e => e.kind === 'sound'), projects = pak.entries.filter(e => e.kind === 'project');
  assert.equal(sounds.length, 309); assert.equal(projects.length, 9); assert.equal(pak.metadata.device_name, 'EP-133');
  for (const sound of sounds) { const info = inspectWav(pak.extract(sound)); assert.equal(info.format, 1); assert.equal(info.bits, 16); assert.ok(info.sampleRate > 0); }
  assert.equal(inspectWav(pak.extract(sounds[0])).metadata['sound.playmode'], 'oneshot');
  for (const project of projects) for (const entry of pak.project(project)) if (/^pads\/[a-d]\/p\d+$/.test(entry.name)) assert.equal(entry.size, 26);
});
