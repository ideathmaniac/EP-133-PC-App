import { createSession, expandArrangement } from './model.mjs';
import { inspectWav, pcm16ToWav, readTar } from './backup.mjs';

const PAD_ORDER = [9, 10, 11, 6, 7, 8, 3, 4, 5, 0, 1, 2];

export function inspectScenes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 712) throw new Error('Неподдерживаемый размер scenes');
  if (bytes[5] !== 4 || bytes[6] !== 4) throw new Error('Неподдерживаемый заголовок scenes');
  const trailer = 7 + 99 * 6, declared = Math.min(99, bytes[trailer + 3]); let last = 0;
  const raw = Array.from({ length: 99 }, (_, index) => {
    const at = 7 + index * 6, patterns = Array.from(bytes.subarray(at, at + 4)), timeSignature = [bytes[at + 4], bytes[at + 5]];
    if (patterns.some(Boolean)) last = index + 1;
    if (!timeSignature[0] || !timeSignature[1]) throw new Error(`Некорректный размер сцены ${index + 1}`);
    return { patterns, timeSignature };
  });
  const count = Math.max(declared, last), songLength = Math.min(99, bytes[trailer + 11]);
  const song = Array.from(bytes.subarray(trailer + 12, trailer + 12 + songLength));
  if (song.some(index => index < 1 || index > count)) throw new Error('Song mode ссылается на отсутствующую сцену');
  return { scenes: raw.slice(0, count), song };
}

export function inspectPatternLayout(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) throw new Error('Обрезанный заголовок паттерна');
  if (bytes[0] !== 0 || bytes[1] < 1 || bytes[1] > 16 || bytes[3] !== 0) throw new Error('Неподдерживаемый заголовок паттерна');
  const count = bytes[2];
  if (bytes.length !== 4 + count * 8) throw new Error('Размер паттерна не совпадает с числом записей');
  return { bars: bytes[1], count, records: Array.from({ length: count }, (_, i) => bytes.slice(4 + i * 8, 12 + i * 8)) };
}

export function importKoProject(archive, entry, { toBase64 }) {
  const members = archive.project(entry), byName = new Map(members.map(member => [member.name, member]));
  const session = createSession(), warnings = [];
  session.name = entry.path.split('/').at(-1).replace(/\.tar$/i, '') + ' — EP-133';
  session.patterns = []; session.clips = []; session.scenes = []; session.song = []; session.automation = [];
  const settings = byName.get('settings')?.data;
  if (settings?.length >= 8) {
    const bpm = new DataView(settings.buffer, settings.byteOffset, settings.byteLength).getFloat32(4, true);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Темп проекта вне диапазона Studio 40–240 BPM');
    session.bpm = bpm;
  }
  const sounds = new Map();
  for (const sound of archive.entries || []) {
    const match = /^sounds\/(\d+)\s.*\.wav$/i.exec(sound.path);
    if (match) sounds.set(Number(match[1]), sound);
  }
  const cache = new Map();
  for (let group = 0; group < 4; group++) for (let p = 1; p <= 12; p++) {
    const source = byName.get(`pads/${'abcd'[group]}/p${String(p).padStart(2, '0')}`);
    if (!source) continue;
    const bytes = source.data;
    if (![26, 27].includes(bytes.length) || bytes[0] !== 0) throw new Error('Неподдерживаемая запись пэда: ' + source.name);
    const pad = session.pads[group * 12 + PAD_ORDER[p - 1]], slot = bytes[1] | bytes[2] << 8;
    pad.teMetadata = { koPadBytes: Array.from(bytes), koSampleSlot: slot };
    pad.rootNote = bytes[24];
    if (pad.rootNote > 127) throw new Error('Некорректная основная нота пэда');
    pad.playMode = bytes[23] === 0 ? 'oneshot' : 'gate';
    if (!slot) continue;
    const sound = sounds.get(slot);
    if (!sound) { pad.name = 'Сэмпл ' + slot; warnings.push(`Нет сэмпла ${slot} для ${source.name}`); continue; }
    if (!cache.has(slot)) {
      const wav = archive.extract(sound), info = inspectWav(wav);
      if (!info.duration) throw new Error('Неверный WAV: ' + sound.path);
      cache.set(slot, { info, data: 'data:audio/wav;base64,' + toBase64(wav) });
    }
    const { info, data } = cache.get(slot), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    pad.sample = data;
    pad.name = (info.metadata?.name || sound.path.split('/').at(-1).replace(/\.wav$/i, '')).slice(0, 80);
    pad.trimStart = Math.min(info.duration, view.getUint32(4, true) / info.sampleRate);
    const length = view.getUint32(8, true) / info.sampleRate;
    pad.trimEnd = length > 0 ? Math.min(info.duration, pad.trimStart + length) : info.duration;
    pad.teMetadata = { ...info.metadata, ...pad.teMetadata };
  }
  let automationCount = 0;
  for (const member of members) {
    const match = /^patterns\/([a-d])(\d{2})$/i.exec(member.name);
    if (!match || member.directory) continue;
    const layout = inspectPatternLayout(member.data), group = 'abcd'.indexOf(match[1].toLowerCase());
    const pattern = { id: match[1].toUpperCase() + match[2], name: match[1].toUpperCase() + match[2], group, bars: layout.bars, notes: [] };
    for (let index = 0; index < layout.records.length; index++) {
      const raw = layout.records[index], kind = raw[2], offset = 4 + index * 8;
      if (kind === 1 || kind === 5) { automationCount++; continue; }
      if (kind % 8 || kind > 88) throw new Error(`Неизвестный тип события: ${member.name} @${offset}`);
      const start = (raw[0] | raw[1] << 8) * 5, duration = (raw[5] | raw[6] << 8) * 5;
      if (start >= pattern.bars * 1920 || duration < 5 || raw[3] > 127 || raw[4] < 1 || raw[4] > 127) throw new Error(`Неподдерживаемые параметры ноты: ${member.name} @${offset}`);
      pattern.notes.push({ id: `${pattern.id}-${offset}`, pad: group * 12 + PAD_ORDER[kind / 8], pitch: raw[3], velocity: raw[4], start, duration: Math.min(duration, pattern.bars * 1920 - start) });
    }
    session.patterns.push(pattern);
  }
  const ensurePattern = (group, index) => { const id = 'ABCD'[group] + String(index).padStart(2, '0'); let pattern = session.patterns.find(item => item.id === id); if (!pattern) { pattern = { id, name: id + ' (пустой)', group, bars: 1, notes: [] }; session.patterns.push(pattern); warnings.push(`Создан пустой ${id} для ссылки сцены`); } return pattern; };
  for (let group = 0; group < 4; group++) if (!session.patterns.some(pattern => pattern.group === group)) ensurePattern(group, 1);
  const scenesMember = byName.get('scenes');
  if (scenesMember) {
    const decoded = inspectScenes(scenesMember.data);
    session.scenes = decoded.scenes.map((scene, index) => ({ id: `ko-scene-${index + 1}`, name: `Scene ${String(index + 1).padStart(2, '0')}`, patterns: scene.patterns.map((number, group) => number ? ensurePattern(group, number).id : null), timeSignature: scene.timeSignature }));
    session.song = decoded.song.map(number => session.scenes[number - 1].id);
  }
  const order = session.song.length ? session.song.map(id => session.scenes.find(scene => scene.id === id)) : session.scenes;
  let cursorBars = 0;
  for (const scene of order) {
    if (!scene) continue;
    const patterns = scene.patterns.map(id => session.patterns.find(pattern => pattern.id === id)).filter(Boolean), sceneBars = Math.max(1, ...patterns.map(pattern => pattern.bars));
    if (cursorBars + sceneBars > 128) { warnings.push('Аранжировка song mode обрезана до 128 тактов Studio.'); break; }
    for (const pattern of patterns) session.clips.push({ id: `ko-clip-${session.clips.length}`, pattern: pattern.id, start: cursorBars * 1920, repeats: sceneBars % pattern.bars === 0 ? sceneBars / pattern.bars : 1 });
    cursorBars += sceneBars;
  }
  if (!session.clips.length) for (let group = 0; group < 4; group++) { const candidates = session.patterns.filter(pattern => pattern.group === group), selected = candidates.findLast(pattern => pattern.notes.length) || candidates[0]; session.clips.push({ id: 'ko-clip-' + group, pattern: selected.id, start: 0, repeats: 1 }); }
  session.patterns.sort((a, b) => a.group - b.group || Number(b.notes.length > 0) - Number(a.notes.length > 0));
  session.bars = Math.max(1, cursorBars, ...session.clips.map(clip => clip.start / 1920 + session.patterns.find(pattern => pattern.id === clip.pattern).bars * clip.repeats));
  if (automationCount) warnings.push(`События автоматизации пока не воспроизводятся: ${automationCount}`);
  warnings.push(session.scenes.length ? `Импортировано сцен: ${session.scenes.length}; позиций song mode: ${session.song.length}.` : 'Сцены отсутствуют; создано превью паттернов.');
  warnings.push('Эффекты и фейдеры устройства пока не перенесены.');
  session.koImport = { source: entry.path, warnings };
  return { session, warnings };
}

export async function prepareRenderProject(project, { readSlot, toBase64 }) {
  const notes = expandArrangement(project);
  if (!notes.length) throw new Error('В аранжировке нет нот.');
  const result = { ...project, pads: project.pads.map(pad => ({ ...pad })) };
  const missing = [...new Set(notes.map(note => note.pad))].filter(index => !result.pads[index].sample);
  const cache = new Map(); let total = 0;
  for (const index of missing) {
    const pad = result.pads[index], slot = pad.teMetadata?.koSampleSlot;
    if (!Number.isInteger(slot) || slot < 1 || slot > 999) throw new Error(`Для пэда ${pad.name} нет звука.`);
    if (!cache.has(slot)) {
      const sound = await readSlot(slot);
      if (!(sound.bytes instanceof Uint8Array) || !sound.bytes.length || sound.bytes.length > 32 * 1024 * 1024) throw new Error('Неверный размер сэмпла ' + slot);
      const wav = sound.riff ? sound.bytes : pcm16ToWav(sound.bytes, sound.metadata);
      const info = inspectWav(wav);
      total += wav.length;
      if (total > 128 * 1024 * 1024) throw new Error('Сэмплы для экспорта превышают 128 МБ');
      cache.set(slot, { data: 'data:audio/wav;base64,' + toBase64(wav), info });
    }
    const sound = cache.get(slot); pad.sample = sound.data;
    const raw = pad.teMetadata.koPadBytes;
    if (raw && [26, 27].includes(raw.length)) {
      const bytes = Uint8Array.from(raw), view = new DataView(bytes.buffer);
      pad.trimStart = Math.min(sound.info.duration, view.getUint32(4, true) / sound.info.sampleRate);
      const length = view.getUint32(8, true) / sound.info.sampleRate;
      pad.trimEnd = length > 0 ? Math.min(sound.info.duration, pad.trimStart + length) : sound.info.duration;
    } else { pad.trimStart = 0; pad.trimEnd = sound.info.duration; }
    if (pad.trimEnd <= pad.trimStart) throw new Error('Пустой диапазон сэмпла на пэде ' + pad.name);
  }
  return result;
}

export function projectFromTar(bytes, path = '/projects/01.tar') {
  return importKoProject({ entries: [], extract: () => bytes, project: () => readTar(bytes) }, { path }, { toBase64: () => '' });
}
