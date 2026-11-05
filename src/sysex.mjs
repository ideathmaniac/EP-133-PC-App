// Independently implemented from the observed EP Sample Tool wire format.
// No PUT, DELETE, metadata SET or firmware commands are exposed here.
const utf8 = new TextDecoder();
function requireBytes(data, size) { if (data.length < size) throw new Error('Обрезанный ответ устройства'); }
export const u16 = n => [(n >>> 8) & 255, n & 255];
export const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const get16 = (data, offset) => (data[offset] << 8) | data[offset + 1];
const get32 = (data, offset) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset);
export function pack7(bytes) {
  const out = new Uint8Array(bytes.length + Math.ceil(bytes.length / 7));
  for (let i = 0; i < bytes.length; i++) { const base = Math.floor(i / 7) * 8; out[base] |= (bytes[i] >>> 7) << (i % 7); out[base + 1 + i % 7] = bytes[i] & 127; }
  return out;
}
export function unpack7(bytes) {
  if (bytes.length % 8 === 1 || bytes.some(x => x > 127)) throw new Error('Некорректная 7-битная упаковка SysEx');
  const out = [];
  for (let base = 0; base < bytes.length; base += 8) for (let j = 1; j < 8 && base + j < bytes.length; j++) out.push(bytes[base + j] | (((bytes[base] >>> (j - 1)) & 1) << 7));
  return Uint8Array.from(out);
}
export function buildRequest(deviceId, requestId, command, payload = []) {
  if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId > 127 || !Number.isInteger(requestId) || requestId < 0 || requestId > 4095) throw new Error('Некорректный адрес SysEx');
  const packed = pack7(payload), out = new Uint8Array(10 + packed.length);
  out.set([240, 0, 32, 118, deviceId, 64, 96 | (requestId >>> 7), requestId & 127, command]); out.set(packed, 9); out[out.length - 1] = 247; return out;
}
export function parseResponse(bytes) {
  if (bytes.length < 11 || bytes[0] !== 240 || bytes[1] !== 0 || bytes[2] !== 32 || bytes[3] !== 118 || bytes[5] !== 64 || bytes.at(-1) !== 247 || bytes[6] & 64) return null;
  return { deviceId: bytes[4], requestId: (bytes[6] & 31) * 128 + bytes[7], hasRequestId: !!(bytes[6] & 32), command: bytes[8], status: bytes[9], data: unpack7(bytes.subarray(10, bytes.length - 1)) };
}
export function parseIdentity(bytes) {
  if (bytes.length !== 17 || bytes[0] !== 240 || bytes[1] !== 126 || bytes[3] !== 6 || bytes[4] !== 2 || bytes[5] !== 0 || bytes[6] !== 32 || bytes[7] !== 118 || bytes[16] !== 247) return null;
  const family = bytes[8] + bytes[9] * 128, model = bytes[10] + bytes[11] * 128;
  return { deviceId: bytes[2], sku: `TE${String(family).padStart(3, '0')}AS${String(model).padStart(3, '0')}` };
}
function nullString(bytes, start) {
  const end = bytes.indexOf(0, start); if (end < 0) throw new Error('Нет терминатора строки');
  return { value: utf8.decode(bytes.subarray(start, end)), end: end + 1 };
}
export function parseList(data, expectedPage) {
  requireBytes(data, 2); if (get16(data, 0) !== expectedPage) throw new Error('Неверная страница списка');
  const rows = [];
  for (let offset = 2; offset < data.length;) {
    requireBytes(data.subarray(offset), 8); const name = nullString(data, offset + 7);
    rows.push({ id: get16(data, offset), flags: data[offset + 2], size: get32(data, offset + 3), name: name.value, directory: !(data[offset + 2] & 1) }); offset = name.end;
  }
  return rows;
}
export class SysexTransport {
  constructor(input, output, { timeout = 5000, log = () => {} } = {}) {
    this.input = input; this.output = output; this.timeout = timeout; this.log = log; this.sequence = 0; this.pending = new Map(); this.closed = false;
    this.listener = event => this.receive(event.data); input.addEventListener('midimessage', this.listener);
  }
  receive(bytes) {
    this.log('RX', bytes);
    try {
      const identity = parseIdentity(bytes);
      if (identity && this.identification) { this.identification.resolve(identity); return; }
      const msg = parseResponse(bytes); if (!msg || !msg.hasRequestId) return;
      const p = this.pending.get(msg.requestId); if (!p || p.deviceId !== msg.deviceId || p.command !== msg.command) return;
      if (msg.status >= 64) { clearTimeout(p.timer); p.timer = setTimeout(() => this.reject(msg.requestId, new Error('Тайм-аут SysEx')), this.timeout); return; }
      clearTimeout(p.timer); this.pending.delete(msg.requestId);
      if (msg.status !== 0) p.reject(new Error(`Устройство вернуло ошибку ${msg.status}: ${utf8.decode(msg.data).slice(0, 160)}`)); else p.resolve(msg.data);
    } catch (error) { this.log('PARSE', new TextEncoder().encode(error.message)); }
  }
  reject(id, error) { const p = this.pending.get(id); if (p) { clearTimeout(p.timer); this.pending.delete(id); p.reject(error); } }
  identify() {
    if (this.closed) return Promise.reject(new Error('Соединение закрыто'));
    if (this.identification) return Promise.reject(new Error('Идентификация уже идёт'));
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => { clearTimeout(timer); this.identification = null; fn(value); };
      const timer = setTimeout(() => finish(reject, new Error('KO II не ответил на MIDI Identity Request. Проверьте выбранные порты.')), this.timeout);
      this.identification = { resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      const bytes = Uint8Array.from([240, 126, 127, 6, 1, 247]); this.log('TX', bytes);
      try { this.output.send(bytes); } catch (e) { finish(reject, e); }
    });
  }
  request(deviceId, command, payload) {
    if (this.closed) return Promise.reject(new Error('Соединение закрыто'));
    if (command !== 1 && command !== 5) return Promise.reject(new Error('Команда не входит в режим чтения'));
    if (command === 5 && !([1, 3, 4].includes(payload[0]) || payload[0] === 7 && payload[1] === 2)) return Promise.reject(new Error('Запись на устройство отключена'));
    const id = this.sequence = (this.sequence + 1) % 4096;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reject(id, new Error('Тайм-аут SysEx. Проверьте USB и закройте другие MIDI-приложения.')), this.timeout);
      this.pending.set(id, { deviceId, command, resolve, reject, timer });
      try { const bytes = buildRequest(deviceId, id, command, payload); this.log('TX', bytes); this.output.send(bytes); } catch (e) { this.reject(id, e); }
    });
  }
  close() { this.closed = true; this.input.removeEventListener('midimessage', this.listener); this.identification?.reject(new Error('Соединение закрыто')); for (const id of this.pending.keys()) this.reject(id, new Error('Соединение закрыто')); }
}
export class ReadOnlyDevice {
  constructor(transport) { this.transport = transport; this.queue = Promise.resolve(); this.connected = false; }
  serial(operation) { const next = this.queue.then(() => { if (!this.connected) throw new Error('Устройство не подключено'); return operation(); }); this.queue = next.catch(() => {}); return next; }
  file(payload) { return this.transport.request(this.identity.deviceId, 5, payload); }
  async connect() {
    this.identity = await this.transport.identify();
    if (this.identity.sku !== 'TE032AS001') throw new Error(`Выбрано ${this.identity.sku}; эта версия поддерживает EP-133`);
    const response = await this.transport.request(this.identity.deviceId, 1, []);
    this.metadata = Object.fromEntries(utf8.decode(response).replace(/\0+$/, '').split(';').filter(x => x.includes(':')).map(x => { const at = x.indexOf(':'); return [x.slice(0, at), x.slice(at + 1)]; }));
    const init = await this.file([1, 0, ...u32(4 * 1024 * 1024)]); requireBytes(init, 5);
    this.chunkSize = get32(init, 1); if (!this.chunkSize || this.chunkSize > 4 * 1024 * 1024) throw new Error('Неподдерживаемый размер ответа');
    this.connected = true; return this.metadata;
  }
  list(id = 0) { return this.serial(async () => { const entries = []; for (let page = 0; page < 4096; page++) { const response = await this.file([4, ...u16(page), ...u16(id)]); const rows = parseList(response, page); if (!rows.length) return entries; entries.push(...rows); if (entries.length > 20000) throw new Error('Слишком много файлов'); } throw new Error('Список превысил лимит страниц'); }); }
  getMetadata(id) { return this.serial(async () => {
    const chunks = []; let size = 0;
    for (let page = 0; page < 4096; page++) {
      const data = await this.file([7, 2, ...u16(id), ...u16(page)]); requireBytes(data, 2);
      if (get16(data, 0) !== page) throw new Error('Неверная страница метаданных');
      const body = data.subarray(2), end = body.indexOf(0); size += body.length;
      if (size > 1024 * 1024) throw new Error('Слишком большие метаданные');
      chunks.push(body.subarray(0, end < 0 ? body.length : end));
      if (end >= 0 || !body.length) { const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let pos = 0; for (const c of chunks) { all.set(c, pos); pos += c.length; } return JSON.parse(utf8.decode(all) || '{}'); }
    } throw new Error('Слишком много страниц метаданных');
  }); }
  getFile(id, progress = () => {}) { return this.serial(async () => {
    const init = await this.file([3, 0, ...u16(id), ...u32(0)]); requireBytes(init, 8);
    if (get16(init, 0) !== id) throw new Error('Ответ для другого файла');
    const size = get32(init, 3), name = nullString(init, 7).value;
    if (size > 128 * 1024 * 1024) throw new Error('Лимит чтения файла: 128 МБ');
    const bytes = new Uint8Array(size); let offset = 0, page = 0, count = 0;
    while (offset < size) {
      if (++count > 131072) throw new Error('Превышен лимит страниц файла');
      const response = await this.file([3, 1, ...u16(page)]); requireBytes(response, 2);
      if (get16(response, 0) !== page) throw new Error('Неверная страница файла');
      const chunk = response.subarray(2);
      if (!chunk.length || offset + chunk.length > size) throw new Error('Размер файла не совпадает с ответом');
      bytes.set(chunk, offset); offset += chunk.length; page = (page + 1) % 65536; progress(offset, size);
    }
    return { bytes, name, size };
  }); }
  close() { this.connected = false; this.transport.close(); }
}
