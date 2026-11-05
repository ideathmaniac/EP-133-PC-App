import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject,exportMidi,encodeWav} from '../src/core.mjs';
function readMidi(bytes){
  const v=new DataView(bytes.buffer),string=(o,n)=>String.fromCharCode(...bytes.slice(o,o+n));
  assert.equal(string(0,4),'MThd');assert.equal(v.getUint32(4),6);assert.equal(v.getUint16(8),1);assert.equal(v.getUint16(12),480);
  const tracks=[];let offset=14;
  const variable=()=>{let n=0,b;do{b=bytes[offset++];n=(n<<7)|(b&127);}while(b&128);return n;};
  for(let i=0;i<v.getUint16(10);i++){
    assert.equal(string(offset,4),'MTrk');const end=offset+8+v.getUint32(offset+4);offset+=8;let tick=0;const events=[];
    while(offset<end){tick+=variable();const status=bytes[offset++];if(status===255){const type=bytes[offset++],len=variable(),data=bytes.slice(offset,offset+len);offset+=len;events.push({tick,type,data});}else{assert.ok(status>=128&&status<160);events.push({tick,status,note:bytes[offset++],velocity:bytes[offset++]});}}
    assert.equal(offset,end);tracks.push(events);
  }assert.equal(offset,bytes.length);return tracks;
}
test('MIDI timing, separate pad tracks, group channels, tempo, end marker',()=>{
  const p=createProject();p.bpm=120;p.bars=2;p.notes=[{pad:47,step:31,velocity:123},{pad:0,step:0,velocity:80},{pad:0,step:1,velocity:90}];
  const tracks=readMidi(exportMidi(p));assert.equal(tracks.length,3);assert.deepEqual([...tracks[0][0].data],[7,161,32]);
  const a=tracks[1].filter(e=>e.status);assert.deepEqual(a.map(e=>[e.tick,e.status,e.note,e.velocity]),[[0,144,36,80],[120,128,36,0],[120,144,36,90],[240,128,36,0]]);
  const d=tracks[2].filter(e=>e.status);assert.deepEqual(d.map(e=>[e.tick,e.status,e.note,e.velocity]),[[3720,147,83,123],[3840,131,83,0]]);
  for(const t of tracks){assert.equal(t.at(-1).type,47);assert.equal(t.at(-1).tick,3840);}
});
test('WAV header, interleaving, signed PCM and clipping',()=>{
  const wav=encodeWav([new Float32Array([-1,0,2]),new Float32Array([1,.5,-2])],44100),v=new DataView(wav.buffer);
  assert.equal(wav.length,56);assert.equal(v.getUint32(4,true),48);assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),44100);assert.equal(v.getUint32(40,true),12);
  assert.deepEqual(Array.from({length:6},(_,i)=>v.getInt16(44+i*2,true)),[-32768,32767,0,16384,32767,-32768]);
});
test('reject malformed projects before scheduling or exporting',()=>{
  for(const mutate of [p=>p.bpm=NaN,p=>p.pads.pop(),p=>p.pads[0].sample='https://external/audio.wav',p=>p.pads[0].gain=2,p=>p.notes=[{pad:48,step:0,velocity:100}],p=>p.notes=[{pad:0,step:64,velocity:100}],p=>p.notes=[{pad:0,step:0,velocity:1},{pad:0,step:0,velocity:2}]]){const p=createProject();mutate(p);assert.throws(()=>validateProject(p));}
  assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(createProject()))));
});
