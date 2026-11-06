import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,BAR} from '../src/model.mjs';
import {createAudioEngine} from '../src/audio.mjs';
function fakeAudio(){
 const sources=[],params=[];const param=()=>{const events=[];const p={value:0,events,setValueAtTime:(value,time)=>events.push(['set',value,time]),linearRampToValueAtTime:(value,time)=>events.push(['ramp',value,time])};params.push(p);return p;};
 const ctx={currentTime:0,destination:{},resume:async()=>{},createGain:()=>({gain:param(),connect(other){return other;},disconnect(){}}),createStereoPanner:()=>({pan:param(),connect(other){return other;},disconnect(){}}),createBufferSource:()=>{const s={playbackRate:{value:1},connect(other){return other;},start(...values){this.started=values;},stop(time){this.stopped=time;}};sources.push(s);return s;}};return{ctx,sources,params};
}
async function withTimer(fn){const oldSet=globalThis.setInterval,oldClear=globalThis.clearInterval;let update;globalThis.setInterval=fn=>{update=fn;return 1;};globalThis.clearInterval=()=>{};try{await fn(()=>update());}finally{globalThis.setInterval=oldSet;globalThis.clearInterval=oldClear;}}
test('playback applies chromatic rate, velocity gain, mixer level, real gate length and group automation',async()=>withTimer(async()=>{
 const p=createSession();p.bpm=120;p.groupMix[0].gain=.5;p.pads[0].playMode='gate';p.pads[0].trimEnd=1;p.patterns[0].notes=[{id:'n',pad:0,pitch:72,start:0,duration:120,velocity:100}];p.automation=[{group:0,param:'gain',points:[{tick:0,value:.25},{tick:BAR,value:1}]}];const{ctx,sources,params}=fakeAudio(),engine=createAudioEngine({getContext:()=>ctx});
 try{await engine.play(p,new Map([[0,{duration:1}]]));assert.equal(sources[0].playbackRate.value,2);assert.deepEqual(sources[0].started,[.08,0,1]);assert.equal(sources[0].stopped,.20500000000000002);assert.ok(params.some(p=>p.events.some(e=>e[0]==='set'&&e[1]===.125&&e[2]===.08)));assert.ok(params.some(p=>Math.abs(p.value-.8*100/127)<1e-10));}finally{engine.stop();}
}));
test('mixer mute and solo remove inaudible groups from playback',async()=>withTimer(async()=>{
 const p=createSession();p.pads[0].trimEnd=1;p.patterns[0].notes=[{id:'a',pad:0,pitch:60,start:0,duration:120,velocity:100}];p.groupMix[0].mute=true;const engine=createAudioEngine({getContext:()=>fakeAudio().ctx});
 await assert.rejects(()=>engine.play(p,new Map([[0,{duration:1}]])),/слышимых нот/);engine.stop();
}));
test('loop schedules next-cycle notes ahead of the boundary without interval jitter',async()=>withTimer(async update=>{
 const p=createSession();p.bpm=120;p.pads[0].trimEnd=1;p.patterns[0].notes=[{id:'n',pad:0,pitch:60,start:0,duration:120,velocity:100}];const{ctx,sources}=fakeAudio();let cursor;const engine=createAudioEngine({getContext:()=>ctx,onCursor:t=>cursor=t});
 try{await engine.play(p,new Map([[0,{duration:1}]]),{startTick:0,endTick:BAR,loop:true});assert.equal(sources.length,1);ctx.currentTime=1.98;update();assert.equal(sources.length,2);assert.equal(sources[1].started[0],2.08);assert.equal(sources[0].stopped,2.08);ctx.currentTime=2.12;update();assert.ok(cursor>=0&&cursor<BAR);}finally{engine.stop();}
}));
