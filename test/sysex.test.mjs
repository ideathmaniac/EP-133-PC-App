import test from 'node:test';
import assert from 'node:assert/strict';
import { pack7, unpack7, buildRequest, parseResponse, parseIdentity, parseList, SysexTransport, ReadOnlyDevice, u16, u32 } from '../src/sysex.mjs';
const text = s => [...new TextEncoder().encode(s)];
class Input {
  listeners = new Set();
  addEventListener(_name, fn) { this.listeners.add(fn); }
  removeEventListener(_name, fn) { this.listeners.delete(fn); }
  emit(data) { for (const fn of this.listeners) fn({ data: Uint8Array.from(data) }); }
}
function response(request, data, status = 0) { return Uint8Array.from([240,0,32,118,request[4],64,request[6]&63,request[7],request[8],status,...pack7(data),247]); }
const identity = [240,126,1,6,2,0,32,118,32,0,1,0,2,5,0,0,247];
function fakeDevice({ wrongPage = false } = {}) {
  const input = new Input(), calls = [], raw = Uint8Array.from([0,128,255,127,42]);
  const metadata = text('{"name":"Удар","format":"s16","channels":1,"samplerate":46875}');
  let currentFile;
  const output = { send(request) {
    calls.push(Uint8Array.from(request));
    if (request[1] === 126) { input.emit(identity); return; }
    const payload = unpack7(request.subarray(9, request.length - 1)); let data;
    if (request[8] === 1) data = text('os_version:2.5;sku:TE032AS001;product:EP-133;');
    else switch (payload[0]) {
      case 1: data = [1, ...u32(1024)]; break;
      case 4: data = payload[2] === 0 ? [0, 0, ...u16(10), 6, ...u32(0), ...text('sounds'), 0, ...u16(11), 5, ...u32(5), ...text('raw'), 0] : [0, payload[2]]; break;
      case 7: { const page = payload[5], start = page * 17, chunk = metadata.slice(start, start + 17); data = [...u16(page), ...chunk]; if (start + 17 >= metadata.length) data.push(0); break; }
      case 3:
        if (payload[1] === 0) { currentFile = payload[3]; data = [...u16(currentFile), 5, ...u32(raw.length), ...text('raw'), 0]; }
        else { const page = payload[3]; data = [...u16(wrongPage ? page + 1 : page), ...raw.slice(page * 3, page * 3 + 3)]; }
        break;
      default: throw new Error('unexpected command');
    }
    input.emit(response(request, data));
  }};
  const transport = new SysexTransport(input, output, { timeout: 100 }); return { device: new ReadOnlyDevice(transport), transport, input, output, calls, raw };
}
test('7-bit codec known vector and complete byte range at every boundary', () => {
  assert.deepEqual([...pack7([128,1,255,127,129,0,254,255])], [85,0,1,127,127,1,0,126,1,127]);
  for (let length = 0; length <= 512; length++) { const data = Uint8Array.from({ length }, (_, i) => i & 255); assert.deepEqual(unpack7(pack7(data)), data); }
  assert.throws(() => unpack7(new Uint8Array([0])));
  assert.throws(() => unpack7(new Uint8Array([0,128])));
});
test('identity and response headers, malformed list rejection', () => {
  assert.deepEqual(parseIdentity(Uint8Array.from(identity)), { deviceId: 1, sku: 'TE032AS001' });
  const request = buildRequest(1, 4095, 5, [4,0,0,0,0]); assert.equal(request[6], 127); assert.equal(request[7], 127);
  assert.equal(parseResponse(response(request, [128,255])).requestId, 4095);
  assert.equal(parseResponse(request), null);
  assert.throws(() => parseList(Uint8Array.from([0,0,0]),0), /Обрезанный/);
});
test('end-to-end identity, greet, list, UTF-8 paged metadata, binary file and queued requests', async () => {
  const {device, raw, calls} = fakeDevice(); const meta = await device.connect(); assert.equal(meta.os_version, '2.5');
  assert.deepEqual([...calls[2]].slice(0,9),[240,0,32,118,1,64,96,2,5]);
  const list = await device.list(0); assert.equal(list.length,2); assert.equal(list[0].directory,true); assert.equal(list[1].size,5);
  const [a,b] = await Promise.all([device.getMetadata(11),device.getMetadata(11)]); assert.equal(a.name,'Удар'); assert.deepEqual(a,b);
  const progress = []; const file = await device.getFile(11,(n,total)=>progress.push([n,total])); assert.deepEqual(file.bytes,raw); assert.deepEqual(progress,[[3,5],[5,5]]);
  device.close();
});
test('read-only command allowlist, timeout, cancellation and stale replies', async () => {
  const input = new Input(), sent = []; const transport = new SysexTransport(input,{send:bytes=>sent.push(bytes)}, { timeout:20 });
  await assert.rejects(transport.request(1,3,[]),/режим чтения/); await assert.rejects(transport.request(1,5,[6,0,1]),/отключена/); await assert.rejects(transport.request(1,5,[7,1,0,1]),/отключена/); assert.equal(sent.length,0);
  const pending = transport.request(1,1,[]); const wrong = response(sent[0],[]); wrong[4] = 2; input.emit(wrong); await assert.rejects(pending,/Тайм-аут/);
  const cancelled = transport.request(1,1,[]); transport.close(); await assert.rejects(cancelled,/закрыто/); assert.equal(input.listeners.size,0); assert.equal(transport.pending.size,0);
});
test('incorrect device file pages are rejected without exporting partial data', async () => {
  const {device} = fakeDevice({wrongPage:true}); await device.connect(); await assert.rejects(device.getFile(11),/страница файла/); device.close();
});
