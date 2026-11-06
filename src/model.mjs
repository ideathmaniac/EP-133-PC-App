import { DEFAULT_TONALITY, validateTonality, tonalityOf, keySignature, SCALES, pitchClassName } from './theory.mjs';
export const PPQ = 480;
export const BAR = PPQ * 4;
export const GROUPS = ['A', 'B', 'C', 'D'];
export const DEFAULT_GROUP_MIX = () => GROUPS.map(() => ({ gain: 1, pan: 0, mute: false, solo: false }));
let counter = 0;
export const uid = () => `e${Date.now().toString(36)}${(++counter).toString(36)}`;
export function createSession() {
  return { format:'ep133-studio',version:2,name:'Новая сессия',bpm:96,bars:8,tonality:{...DEFAULT_TONALITY},
    pads:Array.from({length:48},(_,i)=>({name:`${GROUPS[Math.floor(i/12)]} / ${['.','0','ENTER','1','2','3','4','5','6','7','8','9'][i%12]}`,gain:.8,pan:0,trimStart:0,trimEnd:0,fadeIn:.003,fadeOut:.005,sample:null,rootNote:60,playMode:'oneshot'})),
    patterns:GROUPS.map((g,i)=>({id:g+'01',group:i,name:g+'01',bars:2,notes:[]})),
    clips:GROUPS.map((g,i)=>({id:'clip'+i,pattern:g+'01',start:0,repeats:1})),scenes:[],song:[],groupMix:DEFAULT_GROUP_MIX(),automation:[] };
}
export function cloneSession(p) {
  return {...p,tonality:{...tonalityOf(p)},pads:p.pads.map(x=>({...x,teMetadata:x.teMetadata?{...x.teMetadata}:x.teMetadata})),patterns:p.patterns.map(x=>({...x,notes:x.notes.map(n=>({...n}))})),clips:p.clips.map(x=>({...x})),scenes:p.scenes.map(x=>({...x,patterns:[...x.patterns],timeSignature:x.timeSignature?[...x.timeSignature]:undefined})),song:[...(p.song||[])],groupMix:(p.groupMix||DEFAULT_GROUP_MIX()).map(x=>({...x})),automation:p.automation.map(x=>({...x,points:x.points.map(p=>({...p}))}))};
}
const integer = (x,min,max) => Number.isInteger(x)&&x>=min&&x<=max;
const finite = (x,min,max) => Number.isFinite(x)&&x>=min&&x<=max;
const check = (ok,text) => {if(!ok)throw new Error(text);};
export function validateV2(p) {
  check(p?.format==='ep133-studio'&&p.version===2,'Неподдерживаемый формат проекта');
  if(p.tonality!==undefined)validateTonality(p.tonality);
  check(typeof p.name==='string'&&p.name.length<=100,'Некорректное название');
  check(finite(p.bpm,40,240)&&integer(p.bars,1,128),'BPM: 40–240; аранжировка: 1–128 тактов');
  check(Array.isArray(p.pads)&&p.pads.length===48,'Ожидается 48 пэдов');let total=0;
  for(const pad of p.pads){check(typeof pad.name==='string'&&pad.name.length<=80&&finite(pad.gain,0,1)&&finite(pad.pan,-1,1),'Некорректные параметры пэда');check(finite(pad.trimStart,0,86400)&&finite(pad.trimEnd,pad.trimStart,86400)&&integer(pad.rootNote,0,127)&&['oneshot','gate'].includes(pad.playMode),'Некорректные trim/root/mode');check((pad.fadeIn===undefined||finite(pad.fadeIn,0,10))&&(pad.fadeOut===undefined||finite(pad.fadeOut,0,10)),'Некорректный fade пэда');check(pad.sample===null||typeof pad.sample==='string'&&/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(pad.sample),'Некорректный сэмпл');total+=pad.sample?.length||0;}
  check(total<=180*1024*1024,'Сэмплы превышают лимит 128 МБ');
  check(Array.isArray(p.patterns)&&p.patterns.length>0&&p.patterns.length<=128,'Допустимо 1–128 паттернов');
  const patterns=new Map();let noteCount=0;
  for(const pattern of p.patterns){check(typeof pattern.id==='string'&&!patterns.has(pattern.id)&&integer(pattern.group,0,3)&&integer(pattern.bars,1,16)&&typeof pattern.name==='string'&&pattern.name.length<=80,'Некорректный паттерн');patterns.set(pattern.id,pattern);check(Array.isArray(pattern.notes)&&pattern.notes.length<=8192,'Слишком много нот в паттерне');const ids=new Set();for(const n of pattern.notes){check(typeof n.id==='string'&&!ids.has(n.id)&&integer(n.pad,pattern.group*12,pattern.group*12+11)&&integer(n.pitch,0,127)&&integer(n.start,0,pattern.bars*BAR-1)&&integer(n.duration,1,pattern.bars*BAR-n.start)&&integer(n.velocity,1,127),'Нота выходит за границы паттерна или группы');ids.add(n.id);}noteCount+=pattern.notes.length;}
  check(GROUPS.every((_,g)=>p.patterns.some(x=>x.group===g)),'Для каждой группы нужен хотя бы один паттерн');
  check(noteCount<=65536,'Слишком много нот в проекте');check(Array.isArray(p.clips)&&p.clips.length<=1024,'Слишком много клипов');const ids=new Set(),lanes=[[],[],[],[]];let expanded=0;
  for(const c of p.clips){const pattern=patterns.get(c.pattern);check(pattern&&typeof c.id==='string'&&!ids.has(c.id)&&integer(c.start,0,p.bars*BAR-1)&&c.start%BAR===0&&integer(c.repeats,1,128)&&c.start+pattern.bars*BAR*c.repeats<=p.bars*BAR,'Клип выходит за границы аранжировки');ids.add(c.id);lanes[pattern.group].push([c.start,c.start+pattern.bars*BAR*c.repeats]);expanded+=pattern.notes.length*c.repeats;}
  for(const lane of lanes){lane.sort((a,b)=>a[0]-b[0]);for(let i=1;i<lane.length;i++)check(lane[i][0]>=lane[i-1][1],'Клипы одной группы не могут перекрываться');}
  check(expanded<=50000,'Аранжировка превышает 50 000 нот');
  check(Array.isArray(p.scenes)&&p.scenes.length<=99,'Допустимо до 99 сцен');const sceneIds=new Set();for(const s of p.scenes){check(typeof s.id==='string'&&!sceneIds.has(s.id)&&typeof s.name==='string'&&s.name.length<=80&&Array.isArray(s.patterns)&&s.patterns.length===4,'Некорректная сцена');sceneIds.add(s.id);s.patterns.forEach((id,g)=>check(id===null||patterns.get(id)?.group===g,'Паттерн сцены не соответствует группе'));check(s.timeSignature===undefined||Array.isArray(s.timeSignature)&&s.timeSignature.length===2&&integer(s.timeSignature[0],1,32)&&integer(s.timeSignature[1],1,32),'Некорректный размер сцены');}
  check(p.song===undefined||Array.isArray(p.song)&&p.song.length<=99&&p.song.every(id=>sceneIds.has(id)),'Некорректный порядок song mode');
  check(p.groupMix===undefined||Array.isArray(p.groupMix)&&p.groupMix.length===4&&p.groupMix.every(m=>m&&finite(m.gain,0,1)&&finite(m.pan,-1,1)&&typeof m.mute==='boolean'&&typeof m.solo==='boolean'),'Некорректные параметры микшера групп');
  check(Array.isArray(p.automation)&&p.automation.length<=8,'Некорректная автоматизация');const tracks=new Set();for(const a of p.automation){const key=`${a.group}:${a.param}`;check(integer(a.group,0,3)&&['gain','pan'].includes(a.param)&&!tracks.has(key)&&Array.isArray(a.points)&&a.points.length<=2048,'Некорректная дорожка автоматизации');tracks.add(key);let last=-1;for(const point of a.points){check(integer(point.tick,0,p.bars*BAR)&&point.tick>last&&finite(point.value,a.param==='gain'?0:-1,1),'Некорректная точка автоматизации');last=point.tick;}}
  return p;
}
export function upgradeSession(p) {
  if(p.version===2){validateV2(p);return{...p,tonality:{...tonalityOf(p)},pads:p.pads.map(pad=>({...pad,fadeIn:pad.fadeIn??.003,fadeOut:pad.fadeOut??.005})),song:[...(p.song||[])],groupMix:(p.groupMix||DEFAULT_GROUP_MIX()).map(x=>({...x}))};}
  if(p.version!==1)throw new Error('Неизвестная версия проекта');
  const next=createSession();next.name=p.name;next.bpm=p.bpm;next.bars=p.bars;next.pads=p.pads.map(x=>({...x,fadeIn:.003,fadeOut:.005,rootNote:60,playMode:'oneshot'}));
  for(const pattern of next.patterns){pattern.bars=p.bars;pattern.notes=p.notes.filter(n=>Math.floor(n.pad/12)===pattern.group).map(n=>({id:uid(),pad:n.pad,pitch:60,start:n.step*120,duration:120,velocity:n.velocity}));}return validateV2(next);
}
export function expandArrangement(p) {
  validateV2(p);const patterns=new Map(p.patterns.map(x=>[x.id,x]));const notes=[];
  for(const c of p.clips){const pattern=patterns.get(c.pattern);for(let r=0;r<c.repeats;r++)for(const n of pattern.notes)notes.push({...n,start:c.start+r*pattern.bars*BAR+n.start,clip:c.id});}
  return notes.sort((a,b)=>a.start-b.start||a.pad-b.pad||a.pitch-b.pitch);
}
export function automationAt(points,tick,fallback) {
  if(!points.length)return fallback;if(tick<=points[0].tick)return points[0].value;
  for(let i=1;i<points.length;i++)if(tick<=points[i].tick){const a=points[i-1],b=points[i];return a.value+(b.value-a.value)*(tick-a.tick)/(b.tick-a.tick);}return points.at(-1).value;
}
export function insertScene(p,sceneId,start,repeats=1) {
  const scene=p.scenes.find(s=>s.id===sceneId);if(!scene)throw new Error('Сцена не найдена');
  const patterns=scene.patterns.map(id=>p.patterns.find(x=>x.id===id));const length=Math.max(...patterns.filter(Boolean).map(x=>x.bars*BAR));
  if(!length)throw new Error('Сцена пуста');
  for(let r=0;r<repeats;r++)for(const pattern of patterns)if(pattern){const count=length/(pattern.bars*BAR);if(!Number.isInteger(count))throw new Error('Длины паттернов сцены должны делить её длину без остатка');p.clips.push({id:uid(),pattern:pattern.id,start:start+r*length,repeats:count});}
}
export function arrangeSong(p) {
  if(!p.song?.length)throw new Error('Song Mode пуст');const clips=[];let cursorBars=0;
  for(const sceneId of p.song){const scene=p.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('Song Mode содержит отсутствующую сцену');const patterns=scene.patterns.map(id=>p.patterns.find(pattern=>pattern.id===id)).filter(Boolean);if(!patterns.length)throw new Error(`Сцена «${scene.name}» пуста`);const sceneBars=Math.max(...patterns.map(pattern=>pattern.bars));if(cursorBars+sceneBars>128)throw new Error('Song Mode превышает 128 тактов');for(const pattern of patterns)clips.push({id:uid(),pattern:pattern.id,start:cursorBars*BAR,repeats:sceneBars%pattern.bars===0?sceneBars/pattern.bars:1});cursorBars+=sceneBars;}
  p.clips=clips;p.bars=Math.max(1,cursorBars);return p;
}
export class History {
  constructor(initial,limit=50){this.value=initial;this.limit=limit;this.past=[];this.future=[];}
  commit(edit){const next=cloneSession(this.value);edit(next);validateV2(next);this.past.push(this.value);if(this.past.length>this.limit)this.past.shift();this.value=next;this.future=[];return next;}
  undo(){if(!this.past.length)return this.value;this.future.push(this.value);return this.value=this.past.pop();}
  redo(){if(!this.future.length)return this.value;this.past.push(this.value);return this.value=this.future.pop();}
}
const vlen=n=>{const a=[n&127];while((n=Math.floor(n/128)))a.unshift((n&127)|128);return a;};
const bytes=s=>[...new TextEncoder().encode(s)];
const chunk=(name,data)=>Uint8Array.from([...bytes(name),(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255,...data]);
export function midiV2(p,{padTriggers=false}={}) {
  const notes=expandArrangement(p),end=p.bars*BAR,tempo=Math.round(60000000/p.bpm);
  const tonality=tonalityOf(p),tonalEvents=[];
  if(tonality.scale!=='chromatic'){
    const text=bytes(`Tonality: ${pitchClassName(tonality.root,tonality.spelling).replace('♯','#').replace('♭','b')} ${SCALES.find(s=>s.id===tonality.scale).name}`);
    tonalEvents.push(0,255,1,...vlen(text.length),...text);
    const signature=keySignature(tonality);if(signature)tonalEvents.push(0,255,89,2,signature.fifths&255,signature.minor?1:0);
  }
  const tracks=[chunk('MTrk',[0,255,81,3,(tempo>>>16)&255,(tempo>>>8)&255,tempo&255,0,255,88,4,4,2,24,8,...tonalEvents,...vlen(end),255,47,0])];
  for(let pad=0;pad<48;pad++){
    const own=notes.filter(x=>x.pad===pad);if(!own.length)continue;
    const name=bytes(p.pads[pad].name),events=[],channel=Math.floor(pad/12);
    for(const n of own){const pitch=padTriggers?36+pad:n.pitch;events.push({tick:n.start,order:1,data:[144|channel,pitch,n.velocity]},{tick:n.start+n.duration,order:0,data:[128|channel,pitch,0]});}
    events.sort((a,b)=>a.tick-b.tick||a.order-b.order);const data=[0,255,3,...vlen(name.length),...name];let last=0;
    for(const e of events){data.push(...vlen(e.tick-last),...e.data);last=e.tick;}data.push(...vlen(end-last),255,47,0);tracks.push(chunk('MTrk',data));
  }
  for(const track of p.automation){if(!track.points.length)continue;const events=new Map();for(const point of track.points)events.set(point.tick,point.value);for(let t=0;t<=end;t+=120)events.set(t,automationAt(track.points,t,track.param==='gain'?1:0));const data=[];let last=0;for(const [tick,value]of[...events].sort((a,b)=>a[0]-b[0])){data.push(...vlen(tick-last),176|track.group,track.param==='gain'?7:10,Math.round(track.param==='gain'?value*127:(value+1)*63.5));last=tick;}data.push(...vlen(end-last),255,47,0);tracks.push(chunk('MTrk',data));}
  const header=chunk('MThd',[0,1,(tracks.length>>>8)&255,tracks.length&255,1,224]),out=new Uint8Array(header.length+tracks.reduce((s,t)=>s+t.length,0));out.set(header);let offset=header.length;for(const t of tracks){out.set(t,offset);offset+=t.length;}return out;
}
