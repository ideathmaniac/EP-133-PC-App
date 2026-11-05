import test from 'node:test';
import assert from 'node:assert/strict';
import {BAR,createSession,upgradeSession,validateV2,expandArrangement,History,insertScene,automationAt,midiV2} from '../src/model.mjs';
import {createProject} from '../src/core.mjs';
const note=(id,start=241)=>({id,pad:0,pitch:67,start,duration:235,velocity:83});
test('legacy session migration preserves pad sounds, velocity and timing in four patterns',()=>{
 const old=createProject();old.bars=4;old.notes=[{pad:25,step:13,velocity:72}];const next=upgradeSession(old);assert.equal(next.version,2);assert.equal(next.patterns[2].notes[0].start,1560);assert.equal(next.patterns[2].notes[0].duration,120);assert.equal(next.patterns[2].notes[0].velocity,72);assert.equal(next.patterns[2].notes[0].pitch,60);assert.equal(next.clips.length,4);assert.equal(expandArrangement(next).length,1);
});
test('repeat expansion and scene insertion preserve tick offsets and gaps',()=>{
 const p=createSession();p.patterns[0].notes=[note('n')];p.clips=[{id:'clip',pattern:'A01',start:BAR*2,repeats:2}];const notes=expandArrangement(p);assert.deepEqual(notes.map(n=>n.start),[BAR*2+241,BAR*4+241]);assert.equal(notes[1].duration,235);
 p.scenes=[{id:'scene',name:'Main',patterns:['A01',null,null,null]}];insertScene(p,'scene',0);validateV2(p);assert.equal(expandArrangement(p).length,3);
});
test('edits are transactional; undo/redo includes samples and invalid overlapping clips do not enter history',()=>{
 const p=createSession(),h=new History(p);h.commit(s=>{s.patterns[0].notes=[note('n')];});h.commit(s=>{s.name='Edited';});assert.equal(h.undo().name,p.name);assert.equal(h.undo().patterns[0].notes.length,0);assert.equal(h.redo().patterns[0].notes.length,1);assert.equal(p.patterns[0].notes.length,0);
 const current=h.value;assert.throws(()=>h.commit(s=>s.clips.push({id:'overlap',pattern:'A01',start:0,repeats:1})),/перекрываться/);assert.equal(h.value,current);h.commit(s=>s.name='Branch');assert.equal(h.future.length,0);
});
test('reject out-of-range notes, clip extensions, duplicate automation ticks and missing group',()=>{
 for(const mutate of[p=>p.patterns[0].notes=[{...note('bad'),duration:5000}],p=>p.clips[0].repeats=10,p=>p.patterns=p.patterns.filter(x=>x.group!==3),p=>p.automation=[{group:0,param:'gain',points:[{tick:0,value:1},{tick:0,value:.2}]}]]){const p=createSession();mutate(p);assert.throws(()=>validateV2(p));}
 assert.equal(automationAt([{tick:0,value:0},{tick:960,value:1}],480,1),.5);
});
function parseMidi(data){const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let i=14;const tracks=[];const variable=()=>{let n=0,b;do{b=data[i++];n=n*128+(b&127);}while(b&128);return n;};while(i<data.length){const end=i+8+view.getUint32(i+4);i+=8;let tick=0;const events=[];while(i<end){tick+=variable();const status=data[i++];if(status===255){const type=data[i++],length=variable();i+=length;events.push({tick,status,type});}else events.push({tick,status,a:data[i++],b:data[i++]});}assert.equal(i,end);tracks.push(events);}return tracks;}
test('MIDI V2 encodes chromatic pitches, real gates, microtiming, repeats, pad mapping and automation',()=>{
 const p=createSession();p.patterns[0].notes=[note('n')];p.clips=[{id:'c',pattern:'A01',start:BAR,repeats:2}];p.automation=[{group:0,param:'pan',points:[{tick:0,value:-1},{tick:BAR,value:1}]}];const tracks=parseMidi(midiV2(p));const events=tracks[1].filter(e=>e.status<255);assert.deepEqual(events.slice(0,2),[{tick:BAR+241,status:144,a:67,b:83},{tick:BAR+476,status:128,a:67,b:0}]);assert.equal(events[2].tick,BAR*3+241);assert.equal(tracks[1].at(-1).tick,p.bars*BAR);assert.equal(tracks[2][0].a,10);assert.equal(tracks[2][0].b,0);assert.ok(tracks[2].some(e=>e.tick===BAR&&e.b===127));assert.equal(parseMidi(midiV2(p,{padTriggers:true}))[1].find(e=>e.status===144).a,36);
});
