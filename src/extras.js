import { zipSync } from 'fflate';
import { PakArchive, inspectWav, pcm16ToWav } from './backup.mjs';
import { SysexTransport, ReadOnlyDevice } from './sysex.mjs';

export function initExtras({ message, download, importSample, target }) {
  const $ = id => document.getElementById(id);
  const guard = fn => async (...args) => { try { await fn(...args); } catch (error) { message('Ошибка: ' + error.message); } };
  const sizeLabel = n => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const baseName = name => name.split('/').at(-1).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'file';
  let archive = null, entry = null, archiveName = '', previewContext, previewSource, previewRevision = 0;
  const bankNames = ['KICK', 'SNARE', 'CYMB', 'PERC', 'BASS', 'MELOD', 'LOOP', 'USER 1', 'USER 2', 'SFX'];
  bankNames.forEach((name, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `${i} / ${name}`; $('backupBank').append(option); });
  try { $('theme').value = localStorage.getItem('ep133-theme') || 'orange'; } catch {}
  function theme() { document.body.dataset.theme = $('theme').value; try { localStorage.setItem('ep133-theme', $('theme').value); } catch {} }
  $('theme').onchange = theme; theme();
  function stopPreview() { previewRevision++; try { previewSource?.stop(); } catch {} previewSource = null; }
  $('entryStop').onclick = stopPreview;
  function rows() {
    const search = $('backupSearch').value.toLocaleLowerCase(), kind = $('backupKind').value, bank = $('backupBank').value;
    return archive?.entries.filter(e => !e.directory && (kind === 'all' || e.kind === kind) && e.path.toLocaleLowerCase().includes(search) && (bank === 'all' || e.kind === 'sound' && Math.floor(Number(e.path.match(/(?:^|\/)(\d{3})\s/)?.[1]) / 100) === Number(bank))) || [];
  }
  function renderFiles() {
    const list = $('backupFiles'); list.replaceChildren();
    for (const file of rows()) {
      const tr = document.createElement('tr'); tr.className = file === entry ? 'selected' : '';
      const td = document.createElement('td'), button = document.createElement('button'); button.className = 'file-button'; button.textContent = (file.kind === 'sound' ? '♪ ' : file.kind === 'project' ? '▣ ' : '') + file.path; button.onclick = guard(() => selectEntry(file)); td.append(button); tr.append(td);
      const size = document.createElement('td'); size.textContent = sizeLabel(file.size); tr.append(size); list.append(tr);
    }
  }
  function selectEntry(file) {
    stopPreview(); entry = file; $('entryTitle').textContent = file.path; $('entryDownload').disabled = false;
    $('entryPreview').disabled = $('entryImport').disabled = file.kind !== 'sound'; $('entryTarget').textContent = 'Цель импорта: ' + target();
    if (file.kind === 'project') {
      const members = archive.project(file);
      $('entryDetails').textContent = `${members.filter(e => !e.directory).length} файлов внутри TAR\n\n` + members.map(e => `${e.directory ? '[DIR]' : sizeLabel(e.size).padStart(9)}  ${e.name}`).join('\n') + '\n\nБинарные данные пэдов и паттернов не интерпретируются. Экспорт MIDI из TAR пока недоступен.';
    } else if (file.kind === 'sound') {
      const info = inspectWav(archive.extract(file));
      $('entryDetails').textContent = `${info.sampleRate} Гц / ${info.channels} канал(а) / ${info.bits} бит\n${info.duration?.toFixed(3)} с\n\nМетаданные Teenage Engineering:\n${JSON.stringify(info.metadata, null, 2)}${info.metadataError ? '\n' + info.metadataError : ''}`;
    } else if (/\.json$/i.test(file.path) && file.size <= 65536) $('entryDetails').textContent = new TextDecoder().decode(archive.extract(file));
    else $('entryDetails').textContent = `${file.path}\n${sizeLabel(file.size)}\nФайл доступен для извлечения.`;
    renderFiles();
  }
  function openArchive(bytes, name) {
    const next = new PakArchive(bytes); stopPreview(); archive = next; archiveName = name; entry = null;
    $('entryTitle').textContent = 'Выберите файл'; $('entryDetails').textContent = 'Архив открыт. Выберите WAV для прослушивания или TAR для просмотра проекта.';
    $('entryPreview').disabled = $('entryImport').disabled = $('entryDownload').disabled = true;
    $('backupSearch').value = ''; $('backupKind').value = $('backupBank').value = 'all';
    const sounds = archive.entries.filter(x => x.kind === 'sound'), projects = archive.entries.filter(x => x.kind === 'project');
    const meta = archive.metadata;
    $('backupInfo').textContent = `${name} · ${archive.entries.length} записей` + (meta ? ` · ${meta.device_name || 'устройство неизвестно'} · OS ${meta.device_version || '?'} · тип ${meta.pak_type || '?'}` : ' · метаданные .pak отсутствуют');
    $('backupSummary').replaceChildren();
    for (const label of [`${sounds.length} сэмплов`, `${projects.length} проектов`, sizeLabel(sounds.reduce((n, x) => n + x.size, 0)) + ' WAV']) { const el = document.createElement('span'); el.textContent = label; $('backupSummary').append(el); }
    renderFiles(); message('Бэкап открыт. Оригинал не изменён.');
  }
  $('openBackup').onclick = () => $('fileBackup').click();
  $('fileBackup').onchange = guard(async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; if (file.size > 256 * 1024 * 1024) throw new Error('Лимит архива: 256 МБ'); openArchive(new Uint8Array(await file.arrayBuffer()), file.name); });
  for (const id of ['backupSearch', 'backupKind', 'backupBank']) $(id).addEventListener(id === 'backupSearch' ? 'input' : 'change', renderFiles);
  $('entryPreview').onclick = guard(async () => { if (!entry || !archive) return; stopPreview(); const rev = previewRevision; const bytes = archive.extract(entry); previewContext ||= new AudioContext(); await previewContext.resume(); const buffer = await previewContext.decodeAudioData(bytes.slice().buffer); if (rev !== previewRevision) return; previewSource = previewContext.createBufferSource(); previewSource.buffer = buffer; previewSource.connect(previewContext.destination); previewSource.start(); message('Прослушивание WAV из бэкапа.'); });
  $('entryDownload').onclick = guard(() => { if (entry) download(archive.extract(entry, 128 * 1024 * 1024), baseName(entry.path), 'application/octet-stream'); });
  $('entryImport').onclick = guard(async () => { if (!entry || entry.kind !== 'sound') return; stopPreview(); const bytes = archive.extract(entry), info = inspectWav(bytes); await importSample(bytes, baseName(entry.path), info.metadata); message(`Сэмпл загружен в локальный проект: ${target()}. Метаданные TE сохранены; эффекты не эмулируются.`); });
  $('exportSounds').onclick = guard(async () => {
    if (!archive) throw new Error('Сначала откройте бэкап');
    const sounds = archive.entries.filter(e => e.kind === 'sound'); if (!sounds.length) throw new Error('В архиве нет WAV-сэмплов');
    const source = archive; $('exportSounds').disabled = true;
    try { const files = Object.create(null); let total = 0; for (let i = 0; i < sounds.length; i++) { const e = sounds[i]; total += e.size; if (total > 256 * 1024 * 1024) throw new Error('Лимит экспорта: 256 МБ'); files[e.path] = source.extract(e); if (i % 20 === 0) { message(`Извлечение WAV: ${i + 1}/${sounds.length}`); await new Promise(r => setTimeout(r, 0)); } } download(zipSync(files, { level: 0 }), baseName(archiveName).replace(/\.(pak|zip)$/i, '') + '-samples.zip', 'application/zip'); message('Все WAV подготовлены в ZIP с исходными метаданными.'); } finally { $('exportSounds').disabled = false; }
  });

  let access, transport, device, connecting = false, active = false, selectedNode = null, nodeMetadata = null, deviceEpoch = 0, currentFolder = { id: 0, path: '/' }, parents = [];
  const log = [];
  function addLog(direction, data) { const hex = Array.from(data.subarray(0, 80), x => x.toString(16).padStart(2, '0')).join(' '); log.push(`${new Date().toISOString()} ${direction} [${data.length}] ${hex}${data.length > 80 ? ' …' : ''}`); if (log.length > 300) log.shift(); $('midiLog').textContent = log.join('\n'); }
  function setBusy(value) { active = value; $('connectDevice').disabled = connecting || !!device; $('scanMidi').disabled = connecting || !!device; $('midiInput').disabled = $('midiOutput').disabled = connecting || !!device; $('deviceUp').disabled = value || !device || !parents.length; $('deviceRefresh').disabled = value || !device; $('deviceProject').disabled = value || !device || !/^\/projects\/[^/]+$/.test(currentFolder.path) || !(currentFolder.flags & 4); $('nodeMetadata').disabled = value || !device || !selectedNode; $('nodeDownload').disabled = value || !device || !selectedNode || !(selectedNode.flags & 4); $('nodeImport').disabled = value || !device || !selectedNode || !isSound(selectedNode); }
  const isSound = node => node && currentFolder.path.replace(/\/$/, '') === '/sounds' && !node.directory;
  async function operation(fn) { if (active) throw new Error('Дождитесь завершения чтения'); const epoch = deviceEpoch; setBusy(true); try { return await fn(epoch); } finally { if (epoch === deviceEpoch) setBusy(false); } }
  function disconnect(reason = 'Соединение закрыто.') { deviceEpoch++; device?.close(); transport?.close(); device = transport = null; connecting = false; selectedNode = null; nodeMetadata = null; currentFolder = { id: 0, path: '/' }; parents = []; $('deviceFiles').replaceChildren(); $('deviceInfo').textContent = reason; $('nodeDetails').textContent = 'Выберите устройство и подключитесь заново.'; $('devicePath').textContent = '/'; $('deviceStatus').textContent = '● OFFLINE · устройство не подключено'; setBusy(false); }
  function renderPorts() {
    for (const [id, ports] of [['midiInput', access.inputs], ['midiOutput', access.outputs]]) {
      const select = $(id), previous = select.value; select.replaceChildren();
      for (const port of ports.values()) if (port.state === 'connected') { const option = document.createElement('option'); option.value = port.id; option.textContent = `${port.name || port.id} · ${port.manufacturer || 'MIDI'}`; select.append(option); }
      if ([...select.options].some(x => x.value === previous)) select.value = previous;
      else { const candidate = [...select.options].find(x => /EP[- ]?133|KO II/i.test(x.textContent)); if (candidate) select.value = candidate.value; }
    }
  }
  $('scanMidi').onclick = guard(async () => {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI недоступен');
    access = await navigator.requestMIDIAccess({ sysex: true });
    if (!access.sysexEnabled) throw new Error('Нет разрешения на MIDI SysEx'); renderPorts();
    access.onstatechange = () => { if (transport && (transport.input.state === 'disconnected' || transport.output.state === 'disconnected')) disconnect('USB/MIDI отключён. Незавершённые запросы отменены.'); renderPorts(); };
    message(access.inputs.size && access.outputs.size ? 'Выберите вход и выход одного EP-133.' : 'MIDI-порты не найдены. Редактор и бэкапы доступны автономно.');
  });
  async function readFolder(folder, epoch) {
    const entries = await device.list(folder.id); if (epoch !== deviceEpoch) throw new Error('Соединение изменилось');
    currentFolder = folder; selectedNode = null; nodeMetadata = null; $('devicePath').textContent = folder.path; $('nodeTitle').textContent = 'Файлы устройства'; $('nodeDetails').textContent = 'Выберите файл для чтения метаданных или скачивания.';
    const list = $('deviceFiles'); list.replaceChildren();
    for (const node of entries) { const tr = document.createElement('tr'), td = document.createElement('td'), button = document.createElement('button'); button.className = 'file-button'; button.textContent = (node.directory ? '▣ ' : '· ') + node.name; button.onclick = guard(async () => {
      if (active) return;
      if (node.directory) await operation(async epoch => { const parent = currentFolder; const path = parent.path.replace(/\/$/, '') + '/' + node.name; await readFolder({ ...node, path }, epoch); parents.push(parent); });
      else { selectedNode = node; nodeMetadata = null; $('nodeTitle').textContent = node.name; $('nodeDetails').textContent = `ID ${node.id}\n${sizeLabel(node.size)}\nFlags 0x${node.flags.toString(16)}\n\nНажмите «Метаданные», чтобы прочитать параметры.`; setBusy(false); }
    }); td.append(button); tr.append(td); const size = document.createElement('td'); size.textContent = node.directory ? 'папка' : sizeLabel(node.size); tr.append(size); list.append(tr); }
  }
  $('connectDevice').onclick = guard(async () => {
    if (!access) throw new Error('Сначала обновите MIDI-порты'); const input = access.inputs.get($('midiInput').value), output = access.outputs.get($('midiOutput').value); if (!input || !output) throw new Error('Выберите вход и выход EP-133');
    const epoch = ++deviceEpoch; connecting = true; setBusy(true); $('deviceInfo').textContent = 'MIDI Identity Request → GREET → File INIT…';
    try { await input.open(); await output.open(); if (epoch !== deviceEpoch) return; transport = new SysexTransport(input, output, { log: addLog }); const next = new ReadOnlyDevice(transport); await next.connect(); if (epoch !== deviceEpoch) { next.close(); return; } device = next; connecting = false; $('deviceInfo').textContent = `EP-133 / ${next.identity.sku}\nOS: ${next.metadata.os_version || '?'}\nСерийный номер скрыт в интерфейсе.\nРежим: чтение. Совместимость OS 2.5 на устройстве ещё не проверена.`; $('deviceStatus').textContent = `● MIDI · EP-133 / OS ${next.metadata.os_version || '?'}`; parents = []; await readFolder({ id: 0, path: '/' }, epoch); message('EP-133 ответил. Доступно чтение файлов и метаданных.'); }
    catch (error) { if (epoch === deviceEpoch) disconnect(error.message); throw error; }
    finally { if (epoch === deviceEpoch) { connecting = false; setBusy(false); } }
  });
  $('disconnectDevice').onclick = () => { disconnect(); message('MIDI-соединение закрыто; запросы отменены.'); };
  $('deviceRefresh').onclick = guard(() => operation(epoch => readFolder(currentFolder, epoch)));
  $('deviceUp').onclick = guard(() => operation(async epoch => { const parent = parents.at(-1); if (!parent) return; await readFolder(parent, epoch); parents.pop(); }));
  $('deviceProject').onclick = guard(() => operation(async epoch => { const folder = currentFolder; const file = await device.getFile(folder.id, (n, total) => { if (epoch === deviceEpoch) message(`Чтение проекта: ${Math.floor(n / total * 100)}%`); }); if (epoch !== deviceEpoch) return; download(file.bytes, baseName(folder.name) + '.tar', 'application/x-tar'); message('Архив проекта подготовлен для сохранения.'); }));
  $('nodeMetadata').onclick = guard(() => operation(async epoch => { const metadata = await device.getMetadata(selectedNode.id); if (epoch !== deviceEpoch) return; nodeMetadata = metadata; $('nodeDetails').textContent = JSON.stringify(metadata, null, 2); }));
  async function readNode(epoch) {
    const node = selectedNode, sound = isSound(node), session = device;
    const metadata = sound ? (nodeMetadata || await session.getMetadata(node.id)) : null;
    const file = await session.getFile(node.id, (n, total) => { if (epoch === deviceEpoch) message(`Чтение ${node.name}: ${Math.floor(n / total * 100)}%`); });
    if (epoch !== deviceEpoch) throw new Error('Соединение изменилось');
    let bytes = file.bytes, name = baseName(file.name || node.name);
    if (sound) {
      const riff = bytes.length > 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF';
      if (!riff) bytes = pcm16ToWav(bytes, metadata); if (!/\.wav$/i.test(name)) name += '.wav';
    } else if (node.directory && !/\.tar$/i.test(name)) name += '.tar';
    return { bytes, name, metadata };
  }
  $('nodeDownload').onclick = guard(() => operation(async epoch => { const file = await readNode(epoch); download(file.bytes, file.name, 'application/octet-stream'); if (file.metadata) $('nodeDetails').textContent = JSON.stringify(file.metadata, null, 2) + '\n\nWAV скачивается как PCM; метаданные показаны здесь.'; message('Файл подготовлен для сохранения на ПК.'); }));
  $('nodeImport').onclick = guard(() => operation(async epoch => { const file = await readNode(epoch); await importSample(file.bytes, file.name, file.metadata); message('Сэмпл устройства загружен на локальный пэд ' + target()); }));
  $('exportLog').onclick = () => download(log.join('\n'), 'ep133-midi-log.txt', 'text/plain');
  setBusy(false);
  window.addEventListener('unload', () => { stopPreview(); device?.close(); transport?.close(); });
  return { openArchive, selectEntry, rows, stopPreview, getArchive: () => archive, getLog: () => log, refresh: () => { setBusy(active); $('entryTarget').textContent = 'Цель импорта: ' + target(); } };
}
