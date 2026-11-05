import test from 'node:test';
import assert from 'node:assert/strict';
import {SCALES,DEFAULT_TONALITY,scalePitchClasses,inScale,nearestInScale,stepInScale,noteName,keySignature} from '../src/theory.mjs';
import {createSession,upgradeSession,cloneSession,validateV2,History,midiV2} from '../src/model.mjs';
const tonality=(root,scale,spelling='sharps')=>({root,scale,snap:true,spelling});
test('known scales: C major, A minor, D dorian, A melodic minor ascending and C blues',()=>{
  assert.deepEqual(scalePitchClasses(tonality(0,'major')),[0,2,4,5,7,9,11]);
  assert.deepEqual(scalePitchClasses(tonality(9,'minor')),[9,11,0,2,4,5,7]);
  assert.deepEqual(scalePitchClasses(tonality(2,'dorian')),[2,4,5,7,9,11,0]);
  assert.deepEqual(scalePitchClasses(tonality(9,'melodic-minor')),[9,11,0,2,4,6,8]);
  assert.deepEqual(scalePitchClasses(tonality(0,'blues')),[0,3,5,6,7,10]);
  assert.equal(noteName(61,'flats'),'D♭4');assert.equal(noteName(61),'C♯4');
});
test('snap remains in scale and MIDI bounds for every note, tonic and scale; ties go down',()=>{
  assert.equal(nearestInScale(61,tonality(0,'major')),60);
  assert.equal(nearestInScale(127,tonality(0,'whole-tone')),126);
  assert.equal(nearestInScale(0,tonality(1,'whole-tone')),1);
  for(const scale of SCALES)for(let root=0;root<12;root++)for(let pitch=0;pitch<128;pitch++){
    const t=tonality(root,scale.id),next=nearestInScale(pitch,t);assert.ok(inScale(next,t));assert.ok(next>=0&&next<=127);if(inScale(pitch,t))assert.equal(next,pitch);
    for(let candidate=Math.max(0,pitch-Math.abs(next-pitch)+1);candidate<Math.min(128,pitch+Math.abs(next-pitch));candidate++)assert.equal(inScale(candidate,t),false);
  }
});
test('diatonic stepping moves to next degree and handles boundaries',()=>{
  const t=tonality(0,'major');assert.equal(stepInScale(60,1,t),62);assert.equal(stepInScale(62,-1,t),60);assert.equal(stepInScale(61,1,t),62);assert.equal(stepInScale(60,7,t),72);assert.equal(stepInScale(0,-1,t),0);assert.equal(stepInScale(127,1,t),127);
});
test('tonality round-trip, old V2 defaults and undo do not mutate notes or previous states',()=>{
  const p=createSession();delete p.tonality;const next=upgradeSession(p);assert.deepEqual(next.tonality,DEFAULT_TONALITY);assert.equal(p.tonality,undefined);
  const h=new History(next);h.commit(p=>{p.tonality=tonality(2,'dorian','flats');});h.commit(p=>{p.tonality.root=5;});assert.equal(h.undo().tonality.root,2);assert.equal(h.undo().tonality.scale,'chromatic');assert.equal(h.redo().tonality.scale,'dorian');
  const clone=cloneSession(h.value);clone.tonality.root=7;assert.equal(h.value.tonality.root,2);assert.deepEqual(upgradeSession(JSON.parse(JSON.stringify(h.value))).tonality,tonality(2,'dorian','flats'));
  for(const value of[null,{...DEFAULT_TONALITY,root:12},{...DEFAULT_TONALITY,scale:'wrong'},{...DEFAULT_TONALITY,snap:'yes'}]){const bad=createSession();bad.tonality=value;assert.throws(()=>validateV2(bad),/тональность/);}
});
function conductorMeta(bytes){let i=22;const end=22+new DataView(bytes.buffer).getUint32(18);const readVar=()=>{let n=0,b;do{b=bytes[i++];n=n*128+(b&127);}while(b&128);return n;};const meta=[];while(i<end){readVar();assert.equal(bytes[i++],255);const type=bytes[i++],length=readVar();meta.push({type,data:bytes.slice(i,i+length)});i+=length;}return meta;}
test('MIDI exports key signatures for major/minor and descriptive text for other modes',()=>{
  for(const [root,scale,fifths,minor]of[[0,'major',0,0],[9,'minor',0,1],[3,'major',-3,0],[6,'major',6,0]]){const p=createSession();p.tonality=tonality(root,scale);const signature=conductorMeta(midiV2(p)).find(e=>e.type===89);assert.deepEqual([...signature.data],[fifths&255,minor]);}
  const p=createSession();p.tonality=tonality(2,'dorian');const meta=conductorMeta(midiV2(p));assert.equal(meta.some(e=>e.type===89),false);assert.ok(meta.some(e=>e.type===1&&new TextDecoder().decode(e.data)==='Tonality: D Dorian'));
  assert.deepEqual(keySignature(tonality(1,'major','flats')),{fifths:-5,minor:false});
});
