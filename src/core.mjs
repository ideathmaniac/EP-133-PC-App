export const GROUPS = ['A', 'B', 'C', 'D'];
export const PAD_LABELS = ['.', '0', 'ENTER', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export function createProject() {
  return { format: 'ep133-studio', version: 1, name: 'Новая сессия', bpm: 96, bars: 4,
    pads: Array.from({length:48}, (_, i) => ({ name: `${GROUPS[Math.floor(i / 12)]} / ${PAD_LABELS[i % 12]}`, gain: .8, pan: 0, trimStart: 0, trimEnd: 0, sample: null })), notes: [] };
}
function check(condition, message) { if (!condition) throw new Error(message); }
export function validateProject(p) {
  if(p?.version===2)return validateV2(p);
  check(p && p.format === 'ep133-studio' && p.version === 1, 'Это не проект EP133 Studio версии 1');
  check(typeof p.name === 'string' && p.name.length <= 100, 'Некорректное название');
  check(Number.isFinite(p.bpm) && p.bpm >= 40 && p.bpm <= 240, 'BPM должен быть от 40 до 240');
  check(Number.isInteger(p.bars) && p.bars >= 1 && p.bars <= 16, 'Число тактов должно быть от 1 до 16');
  check(Array.isArray(p.pads) && p.pads.length === 48, 'В проекте должно быть 48 пэдов');
  let total = 0;
  for (const pad of p.pads) {
    check(pad && typeof pad.name === 'string' && pad.name.length <= 80, 'Некорректный пэд');
    check(Number.isFinite(pad.gain) && pad.gain >= 0 && pad.gain <= 1, 'Некорректный уровень');
    check(Number.isFinite(pad.pan) && pad.pan >= -1 && pad.pan <= 1, 'Некорректная панорама');
    check(Number.isFinite(pad.trimStart) && Number.isFinite(pad.trimEnd) && pad.trimStart >= 0 && pad.trimEnd >= pad.trimStart, 'Некорректный trim');
    check(pad.sample === null || (typeof pad.sample === 'string' && /^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(pad.sample)), 'Некорректный сэмпл');
    total += pad.sample?.length || 0;
  }
  check(total <= 180 * 1024 * 1024, 'Сэмплы проекта превышают лимит 128 МБ');
  check(Array.isArray(p.notes) && p.notes.length <= 12288, 'Слишком много нот');
  const seen = new Set();
  for (const n of p.notes) {
    check(n && Number.isInteger(n.pad) && n.pad >= 0 && n.pad < 48 && Number.isInteger(n.step) && n.step >= 0 && n.step < p.bars * 16 && Number.isInteger(n.velocity) && n.velocity >= 1 && n.velocity <= 127, 'Некорректная MIDI-нота');
    const key = `${n.pad}:${n.step}`; check(!seen.has(key), 'Повторяющаяся нота'); seen.add(key);
  }
  return p;
}
function textBytes(s) { return [...new TextEncoder().encode(s)]; }
function u32(n) { return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]; }
function vlq(n) { const a=[n&127]; while ((n=Math.floor(n/128))) a.unshift((n&127)|128); return a; }
function chunk(type, data) { return [...textBytes(type), ...u32(data.length), ...data]; }
export function exportMidi(project, options) {
  if(project?.version===2)return midiV2(project, options);
  validateProject(project);
  const end = project.bars * 4 * 480;
  const tempo = Math.round(60000000 / project.bpm);
  const conductor = [...[0,255,81,3,(tempo>>>16)&255,(tempo>>>8)&255,tempo&255],0,255,88,4,4,2,24,8,...vlq(end),255,47,0];
  const tracks=[chunk('MTrk', conductor)];
  for (let pad=0; pad<48; pad++) {
    const notes=project.notes.filter(n=>n.pad===pad); if (!notes.length) continue;
    const name=textBytes(project.pads[pad].name);
    const data=[0,255,3,...vlq(name.length),...name];
    const events=[]; const channel=Math.floor(pad/12);
    for (const note of notes) {
      events.push({ tick:note.step*120, priority:1, data:[144|channel,36+pad,note.velocity] });
      events.push({ tick:(note.step+1)*120, priority:0, data:[128|channel,36+pad,0] });
    }
    events.sort((a,b)=>a.tick-b.tick || a.priority-b.priority);
    let last=0;
    for (const e of events) { data.push(...vlq(e.tick-last),...e.data); last=e.tick; }
    data.push(...vlq(end-last),255,47,0); tracks.push(chunk('MTrk',data));
  }
  return Uint8Array.from([...chunk('MThd',[0,1,0,tracks.length,1,224]),...tracks.flat()]);
}
export function encodeWav(channels, sampleRate) {
  const length=channels[0].length; const count=channels.length;
  const out=new ArrayBuffer(44+length*count*2); const v=new DataView(out);
  const word=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
  word(0,'RIFF');v.setUint32(4,out.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,count,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*count*2,true);v.setUint16(32,count*2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,length*count*2,true);
  let offset=44;
  for(let i=0;i<length;i++)for(let c=0;c<count;c++) { const x=Math.max(-1,Math.min(1,channels[c][i]));v.setInt16(offset,Math.round(x*(x<0?32768:32767)),true);offset+=2; }
  return new Uint8Array(out);
}
import { validateV2, midiV2 } from './model.mjs';
