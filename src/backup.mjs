import { unzipSync } from 'fflate';

const decoder = new TextDecoder();
const fail = text => { throw new Error(text); };
export function safePath(name) {
  const path = name.replace(/^\/+/, '');
  if (!path || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(x => x === '..' || x === '.')) fail('Некорректный путь в архиве');
  return path;
}
export function readTar(bytes) {
  const entries = []; let offset = 0;
  const field = (start, length) => decoder.decode(bytes.subarray(start, start + length)).split('\0')[0].trim();
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(x => x === 0)) break;
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== parseInt(field(offset + 148, 8), 8)) fail('Повреждён заголовок TAR');
    const rawSize = field(offset + 124, 12) || '0';
    if (!/^[0-7]+$/.test(rawSize)) fail('Неподдерживаемый размер TAR');
    const size = parseInt(rawSize, 8), prefix = field(offset + 345, 155);
    const name = safePath((prefix ? prefix + '/' : '') + field(offset, 100));
    const type = header[156];
    if (![0, 48, 53].includes(type)) fail('Неподдерживаемый тип записи TAR');
    const end = offset + 512 + size;
    if (!Number.isSafeInteger(end) || end > bytes.length) fail('Обрезанный TAR');
    if (entries.length >= 20000) fail('Слишком много записей TAR');
    entries.push({ name, size, directory: type === 53, data: bytes.subarray(offset + 512, end) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!entries.length && bytes.some(x => x !== 0)) fail('Это не поддерживаемый TAR');
  return entries;
}
export class PakArchive {
  constructor(bytes) {
    if (bytes.byteLength > 256 * 1024 * 1024) fail('Лимит архива: 256 МБ');
    this.bytes = bytes; this.entries = []; const paths = new Set(); let total = 0;
    unzipSync(bytes, { filter: entry => {
      const path = safePath(entry.name);
      if (paths.has(path)) fail('Повторяющийся путь в архиве');
      paths.add(path); total += entry.originalSize;
      if (this.entries.length >= 20000 || total > 512 * 1024 * 1024) fail('Архив превышает лимит распаковки 512 МБ');
      this.entries.push({ name: entry.name, path, size: entry.originalSize, directory: path.endsWith('/'),
        kind: /^sounds\/.*\.wav$/i.test(path) ? 'sound' : /^projects\/.*\.tar$/i.test(path) ? 'project' : 'file' });
      return false;
    }});
    const meta = this.entries.find(e => e.path === 'meta.json');
    this.metadata = meta ? JSON.parse(decoder.decode(this.extract(meta, 65536))) : null;
  }
  extract(entry, limit = 64 * 1024 * 1024) {
    if (!this.entries.includes(entry) || entry.size > limit) fail('Файл отсутствует или превышает лимит');
    const files = unzipSync(this.bytes, { filter: e => e.name === entry.name });
    const data = files[entry.name];
    if (!data || data.byteLength !== entry.size) fail('Повреждённая запись ZIP');
    return data;
  }
  project(entry) { return readTar(this.extract(entry, 128 * 1024 * 1024)); }
}
export function inspectWav(bytes) {
  const text = (o, n) => decoder.decode(bytes.subarray(o, o + n));
  if (bytes.length < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') fail('Это не RIFF WAV');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = { metadata: {} };
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end > bytes.length) fail('Обрезанный WAV');
    const id = text(offset, 4);
    if (id === 'fmt ' && size >= 16) Object.assign(result, { format: view.getUint16(start, true), channels: view.getUint16(start + 2, true), sampleRate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) });
    if (id === 'data') result.dataBytes = size;
    if (id === 'LIST' && text(start, 4) === 'INFO') {
      for (let pos = start + 4; pos + 8 <= end;) {
        const n = view.getUint32(pos + 4, true);
        if (pos + 8 + n > end) fail('Повреждён LIST INFO');
        if (text(pos, 4) === 'TNGE') {
          const json = text(pos + 8, n).replace(/\0+$/, '');
          try { result.metadata = JSON.parse(json); } catch { result.metadataError = 'Метаданные TNGE не распознаны'; }
        }
        pos += 8 + n + (n % 2);
      }
    }
    offset = end + (size % 2);
  }
  if (result.channels && result.bits && result.sampleRate) result.duration = (result.dataBytes || 0) / (result.channels * result.bits / 8 * result.sampleRate);
  return result;
}
export function pcm16ToWav(bytes, metadata) {
  if (metadata.format !== 's16' || ![1, 2].includes(metadata.channels) || !Number.isInteger(metadata.samplerate) || metadata.samplerate < 3000 || metadata.samplerate > 192000 || bytes.length % (2 * metadata.channels)) fail('Неподдерживаемый формат PCM; доступны s16 mono/stereo');
  const out = new Uint8Array(44 + bytes.length), view = new DataView(out.buffer);
  const put = (offset, s) => out.set(new TextEncoder().encode(s), offset);
  put(0, 'RIFF'); view.setUint32(4, out.length - 8, true); put(8, 'WAVE'); put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, metadata.channels, true); view.setUint32(24, metadata.samplerate, true); view.setUint32(28, metadata.samplerate * metadata.channels * 2, true); view.setUint16(32, metadata.channels * 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, bytes.length, true); out.set(bytes, 44);
  return out;
}
