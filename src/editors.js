import { BAR, GROUPS, uid, insertScene, arrangeSong } from './model.mjs';
import { SCALES, tonalityOf, pitchClassName, noteName, scalePitchClasses, inScale, nearestInScale, stepInScale } from './theory.mjs';
import {canvasPoint,cellStart,nearestTick,visibleGridStep,anchoredScroll} from './grid.mjs';
const $=id=>document.getElementById(id);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function initEditors({get,commit,message,selectGroup,setPattern,setCursor}){
  let clips=new Set(),notes=new Set(),clipboard=null,focus='notes',drag=null,topPitch=72,barPixels=64,stepPixels=22,cursor=0,rollCursor=0,songDrag=-1;
  const arr=$('arrCanvas'),roll=$('rollCanvas'),auto=$('autoCanvas');
  const position=canvasPoint;
  const tonality=()=>tonalityOf(get().project);
  const pitchForEdit=pitch=>tonality().snap?nearestInScale(pitch,tonality()):pitch;
  const transpose=(note,semitones)=>{const t=tonality();note.pitch=t.snap&&Math.abs(semitones)===1?stepInScale(note.pitch,semitones,t):pitchForEdit(note.pitch+semitones);};
  for(const [i,label]of ['C / До','C♯ / D♭','D / Ре','D♯ / E♭','E / Ми','F / Фа','F♯ / G♭','G / Соль','G♯ / A♭','A / Ля','A♯ / B♭','B / Си'].entries()){const option=document.createElement('option');option.value=i;option.textContent=label;$('scaleRoot').append(option);}
  for(const scale of SCALES){const option=document.createElement('option');option.value=scale.id;option.textContent=scale.label;$('scaleMode').append(option);}
  try{$('ghostNotes').checked=localStorage.getItem('ep133-ghost-notes')==='true';}catch{}
  const pattern=()=>get().project.patterns.find(x=>x.id===get().pattern);
  const snap=()=>Number($('snap').value);
  const quantize=n=>nearestTick(n,snap());
  const attempt=fn=>{try{fn();}catch(e){message(e.message);render();}};
  function setup(canvas,width,height){canvas.width=Math.max(300,width);canvas.height=height;return canvas.getContext('2d');}
  const accent=()=>getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#fa633a';
  function drawArrangement(){
    const {project}=get(),g=setup(arr,80+project.bars*barPixels,216);g.fillStyle='#191c21';g.fillRect(0,0,arr.width,arr.height);g.font='11px Segoe UI';
    const start=Number($('loopStart').value)-1,end=Number($('loopEnd').value)-1;
    g.fillStyle='#b89a6a26';g.fillRect(80+start*barPixels,0,(end-start)*barPixels,216);
    for(let b=0;b<=project.bars;b++){const x=80+b*barPixels;g.strokeStyle='#343a43';g.beginPath();g.moveTo(x,25);g.lineTo(x,216);g.stroke();g.fillStyle='#a5adb7';g.fillText(String(b+1),x+4,16);}
    for(let group=0;group<4;group++){g.fillStyle=group===get().group?'#303238':'#22262c';g.fillRect(0,25+group*47,79,46);g.fillStyle='#d4d8dc';g.fillText('GROUP '+GROUPS[group],9,53+group*47);}
    for(const clip of project.clips){const p=project.patterns.find(x=>x.id===clip.pattern),x=80+clip.start/BAR*barPixels,y=30+p.group*47,w=p.bars*clip.repeats*barPixels;g.fillStyle=clips.has(clip.id)?accent():['#92553f','#456e69','#5c577b','#7b7050'][p.group];g.fillRect(x+1,y,w-3,36);g.strokeStyle='#c1c4c170';for(let r=1;r<clip.repeats;r++){g.beginPath();g.moveTo(x+r*p.bars*barPixels,y);g.lineTo(x+r*p.bars*barPixels,y+36);g.stroke();}g.save();g.beginPath();g.rect(x+4,y,w-10,36);g.clip();g.fillStyle='#f4eee5';g.fillText(`${p.name} ×${clip.repeats}`,x+7,y+22);g.restore();g.fillStyle='#ffffff70';g.fillRect(x+w-7,y+10,2,16);}
    g.fillStyle='#f5dfaa';g.fillRect(80+cursor/BAR*barPixels,0,2,216);
    $('arrInfo').textContent=`${project.clips.length} клипов · ${project.bars} тактов`;
  }
  function drawRoll(updateFields=true){const {project,selected}=get(),p=pattern();if(!p)return;
    const g=setup(roll,54+p.bars*16*stepPixels,388),width=roll.width;g.fillStyle='#161a1f';g.fillRect(0,0,width,388);g.font='10px Consolas';
    const tonal=tonality(),chromatic=tonal.scale==='chromatic';
    for(let row=0;row<25;row++){const pitch=topPitch-row,y=24+row*12,allowed=inScale(pitch,tonal),root=pitch%12===tonal.root;g.fillStyle=chromatic?([1,3,6,8,10].includes(pitch%12)?'#191c22':'#23272e'):root?'#354536':allowed?'#25322f':'#151a20';g.fillRect(54,y,width-54,12);g.fillStyle=root?accent():allowed?'#b6cfc5':'#69727e';g.fillText(noteName(pitch,tonal.spelling),4,y+10);if(!chromatic&&allowed){g.fillStyle=root?accent():'#688d7a';g.fillRect(46,y+4,3,3);}g.strokeStyle='#30343a';g.beginPath();g.moveTo(54,y+12);g.lineTo(width,y+12);g.stroke();}
    const pixelsPerTick=stepPixels/120,gridStep=visibleGridStep(snap(),pixelsPerTick);
    const gridTicks=new Set();for(let tick=0;tick<=p.bars*BAR;tick+=gridStep)gridTicks.add(tick);for(let tick=0;tick<=p.bars*BAR;tick+=480)gridTicks.add(tick);
    for(const tick of [...gridTicks].sort((a,b)=>a-b)){const x=54+tick*pixelsPerTick;g.strokeStyle=tick%BAR===0?'#747b85':tick%480===0?'#444b56':'#2c323b';g.beginPath();g.moveTo(x,24);g.lineTo(x,388);g.stroke();}
    for(let tick=0;tick<=p.bars*BAR;tick+=480){const x=54+tick*pixelsPerTick;g.fillStyle='#a1a8b1';g.fillText(`${Math.floor(tick/BAR)+1}.${tick%BAR/480+1}`,x+3,15);}
    g.fillStyle='#11151a';g.fillRect(0,324,width,64);g.fillStyle='#8d98a5';g.fillText('VEL',6,341);
    if($('ghostNotes').checked)for(const n of p.notes.filter(n=>n.pad!==selected&&n.pitch<=topPitch&&n.pitch>=topPitch-24)){const x=54+n.start/120*stepPixels,w=Math.max(3,n.duration/120*stepPixels),y=24+(topPitch-n.pitch)*12;g.fillStyle='#a5b1bd35';g.fillRect(x,y+2,w-1,8);}
    for(const n of p.notes.filter(n=>n.pad===selected)){const x=54+n.start/120*stepPixels,w=Math.max(3,n.duration/120*stepPixels),y=24+(topPitch-n.pitch)*12;if(n.pitch<=topPitch&&n.pitch>=topPitch-24){g.fillStyle=notes.has(n.id)?accent():inScale(n.pitch,tonal)?'#658995':'#b16a7a';g.fillRect(x,y+1,w-1,10);if(w>28){g.fillStyle='#101519';g.fillText(noteName(n.pitch,tonal.spelling),x+3,y+10);}}g.fillStyle=notes.has(n.id)?accent():'#5b747d';const h=n.velocity/127*54;g.fillRect(x,386-h,Math.max(3,Math.min(8,w)),h);}
    if(drag?.kind==='marquee'){g.strokeStyle=accent();g.strokeRect(drag.origin.x,drag.origin.y,drag.current.x-drag.origin.x,drag.current.y-drag.origin.y);}
    g.fillStyle='#f5dfaa';g.fillRect(54+rollCursor/120*stepPixels,24,1,300);
    $('rollInfo').textContent=`${p.name} / ${project.pads[selected].name} · ${p.notes.filter(n=>n.pad===selected).length} нот · ${notes.size} выбрано`+(chromatic?'':` · ${p.notes.filter(n=>n.pad===selected&&!inScale(n.pitch,tonal)).length} вне лада`);
    if(updateFields){const note=p.notes.find(n=>notes.has(n.id));for(const [id,key]of[['notePitch','pitch'],['noteStart','start'],['noteDuration','duration'],['noteVelocity','velocity']]){$(id).disabled=!note;$(id).value=note?.[key]??'';}}
  }
  function drawAutomation(){const {project,group}=get(),param=$('autoParam').value,track=project.automation.find(x=>x.group===group&&x.param===param);const g=setup(auto,80+project.bars*barPixels,100);g.fillStyle='#181d23';g.fillRect(0,0,auto.width,100);g.font='10px Consolas';g.fillStyle='#9da6b0';g.fillText(`${GROUPS[group]} / ${param}`,6,16);for(let b=0;b<=project.bars;b++){const x=80+b*barPixels;g.strokeStyle='#303944';g.beginPath();g.moveTo(x,0);g.lineTo(x,100);g.stroke();}const y=value=>param==='gain'?92-value*84:50-value*42;g.strokeStyle=accent();g.beginPath();(track?.points||[]).forEach((point,i)=>{const x=80+point.tick/BAR*barPixels;if(i)g.lineTo(x,y(point.value));else g.moveTo(x,y(point.value));});g.stroke();g.fillStyle=accent();for(const point of track?.points||[])g.fillRect(77+point.tick/BAR*barPixels,y(point.value)-3,6,6);}
  function renderSong(){const project=get().project,container=$('songSequence');container.replaceChildren();if(!project.song.length){const empty=document.createElement('span');empty.className='muted';empty.textContent='Добавьте сохранённые сцены.';container.append(empty);return;}project.song.forEach((sceneId,index)=>{const scene=project.scenes.find(item=>item.id===sceneId),item=document.createElement('div');item.className='song-item';item.draggable=true;item.ondragstart=()=>{songDrag=index;};item.ondragend=()=>{songDrag=-1;document.querySelectorAll('.song-item').forEach(node=>node.classList.remove('drag-over'));};item.ondragover=event=>{event.preventDefault();item.classList.add('drag-over');};item.ondragleave=()=>item.classList.remove('drag-over');item.ondrop=event=>{event.preventDefault();item.classList.remove('drag-over');if(songDrag<0||songDrag===index)return;attempt(()=>commit(p=>{const [moved]=p.song.splice(songDrag,1);p.song.splice(index,0,moved);}));};const number=document.createElement('span');number.className='song-index';number.textContent=String(index+1).padStart(2,'0');const name=document.createElement('strong');name.textContent=scene?.name||'Сцена удалена';const actions=document.createElement('div');actions.className='song-item-actions';const duplicate=document.createElement('button');duplicate.textContent='×2';duplicate.title='Повторить сцену';duplicate.onclick=()=>attempt(()=>commit(p=>p.song.splice(index+1,0,sceneId)));const remove=document.createElement('button');remove.textContent='×';remove.title='Удалить из песни';remove.onclick=()=>attempt(()=>commit(p=>p.song.splice(index,1)));actions.append(duplicate,remove);item.append(number,name,actions);container.append(item);});}
  function render(){const {project,group}=get(),p=pattern();if(!p)return;
    const tonal=tonality();$('scaleRoot').value=tonal.root;$('scaleMode').value=tonal.scale;$('keySpelling').value=tonal.spelling;$('scaleSnap').checked=tonal.snap;$('scaleNotes').textContent=scalePitchClasses(tonal).map(pc=>pitchClassName(pc,tonal.spelling)).join(' · ');
    $('patternSelect').replaceChildren();for(const item of project.patterns.filter(x=>x.group===group)){const o=document.createElement('option');o.value=item.id;o.textContent=item.name;$('patternSelect').append(o);}$('patternSelect').value=p.id;$('patternName').value=p.name;$('patternBars').value=p.bars;
    const selectedScene=$('sceneSelect').value;$('sceneSelect').replaceChildren();for(const scene of project.scenes){const o=document.createElement('option');o.value=scene.id;o.textContent=scene.name;$('sceneSelect').append(o);}if(project.scenes.some(s=>s.id===selectedScene))$('sceneSelect').value=selectedScene;
    $('sceneInsert').disabled=!project.scenes.length;
    const validNotes=new Set(p.notes.filter(n=>n.pad===get().selected).map(n=>n.id));notes=new Set([...notes].filter(x=>validNotes.has(x)));clips=new Set([...clips].filter(x=>project.clips.some(c=>c.id===x)));
    const clip=project.clips.find(x=>clips.has(x.id));$('clipStart').value=clip?clip.start/BAR+1:'';$('clipRepeats').value=clip?.repeats??'';$('clipStart').disabled=$('clipRepeats').disabled=!clip;
    const selectedNote=p.notes.find(n=>notes.has(n.id)),showClip=focus==='clips'&&!!clip,showNote=focus==='notes'&&!!selectedNote;
    $('clipInspector').hidden=!showClip;$('noteInspector').hidden=!showNote;$('bottomInspector').hidden=!showClip&&!showNote;$('inspectorSummary').textContent=showClip?`${clips.size} клип(а) · ${p.name}`:showNote?`${notes.size} нот(а) · ${project.pads[get().selected].name}`:'Ничего не выбрано';
    const songNames=(project.song||[]).map(id=>project.scenes.find(scene=>scene.id===id)?.name).filter(Boolean);$('songInfo').textContent=songNames.length?`Song: ${songNames.join(' → ')}`:'Song mode пуст';$('songInfo').title=songNames.join(' → ');
    renderSong();drawArrangement();drawRoll();drawAutomation();
  }
  function hitClip(pos){const {project}=get();return project.clips.find(c=>{const p=project.patterns.find(p=>p.id===c.pattern);return pos.x>=80+c.start/BAR*barPixels&&pos.x<80+(c.start/BAR+p.bars*c.repeats)*barPixels&&pos.y>=25+p.group*47&&pos.y<25+(p.group+1)*47;});}
  function hitNote(pos){return [...pattern().notes].reverse().find(n=>n.pad===get().selected&&pos.x>=54+n.start/120*stepPixels&&pos.x<54+(n.start+n.duration)/120*stepPixels&&pos.y>=24+(topPitch-n.pitch)*12&&pos.y<36+(topPitch-n.pitch)*12);}
  function capture(canvas,e){try{canvas.setPointerCapture(e.pointerId);}catch{}}
  arr.onpointerdown=e=>{if(e.button!==0)return;focus='clips';const pos=position(arr,e);if(pos.x<80){selectGroup(clamp(Math.floor((pos.y-25)/47),0,3));return;}const c=hitClip(pos);
    if(pos.y<25){const bar=clamp(Math.floor((pos.x-80)/barPixels),0,get().project.bars-1);if(e.shiftKey){drag={kind:'range',start:bar};}else{setCursor(bar*BAR);cursor=bar*BAR;drawArrangement();}capture(arr,e);return;}
    if(c){if(!e.shiftKey&&!clips.has(c.id))clips=new Set([c.id]);else if(e.shiftKey){if(clips.has(c.id))clips.delete(c.id);else clips.add(c.id);}const p=get().project.patterns.find(p=>p.id===c.pattern);setPattern(c.pattern);selectGroup(p.group,false);const right=80+(c.start/BAR+p.bars*c.repeats)*barPixels;drag={kind:right-pos.x<10?'clipResize':'clipMove',origin:pos,clip:c,selected:[...clips],copy:e.ctrlKey||e.altKey};}else{clips.clear();setCursor(clamp(Math.floor((pos.x-80)/barPixels),0,get().project.bars-1)*BAR);}capture(arr,e);render();};
  arr.onpointermove=e=>{if(drag?.kind==='range'){const pos=position(arr,e),bar=clamp(Math.floor((pos.x-80)/barPixels),0,get().project.bars-1);$('loopStart').value=Math.min(bar,drag.start)+1;$('loopEnd').value=Math.max(bar,drag.start)+2;drawArrangement();}};
  arr.onpointerup=e=>{if(!drag)return;const action=drag;drag=null;const pos=position(arr,e);attempt(()=>{if(action.kind==='clipMove'){const delta=Math.round((pos.x-action.origin.x)/barPixels)*BAR;if(!delta)return;commit(p=>{if(action.copy){const added=p.clips.filter(c=>action.selected.includes(c.id)).map(c=>({...c,id:uid(),start:c.start+delta}));p.clips.push(...added);clips=new Set(added.map(x=>x.id));}else for(const c of p.clips)if(action.selected.includes(c.id))c.start+=delta;});}else if(action.kind==='clipResize'){const p=pattern(),repeats=Math.max(1,Math.round((pos.x-(80+action.clip.start/BAR*barPixels))/(p.bars*barPixels)));commit(s=>{s.clips.find(c=>c.id===action.clip.id).repeats=repeats;});}});render();};
  arr.ondblclick=e=>attempt(()=>{const pos=position(arr,e);if(hitClip(pos)||pos.x<80||pos.y<25)return;const g=clamp(Math.floor((pos.y-25)/47),0,3),start=Math.floor((pos.x-80)/barPixels)*BAR;const p=get().project.patterns.find(p=>p.group===g&&p.id===get().pattern)||get().project.patterns.find(p=>p.group===g);commit(s=>s.clips.push({id:uid(),pattern:p.id,start,repeats:1}));});
  arr.oncontextmenu=e=>{e.preventDefault();const c=hitClip(position(arr,e));if(c)attempt(()=>commit(s=>{s.clips=s.clips.filter(x=>x.id!==c.id);}));};
  roll.onpointerdown=e=>{if(e.button!==0)return;focus='notes';const pos=position(roll,e),p=pattern();if(pos.x<54)return;rollCursor=cellStart((pos.x-54)/stepPixels*120,snap(),p.bars*BAR);
    if(pos.y>=324){const near=p.notes.filter(n=>n.pad===get().selected&&Math.abs(n.start-rollCursor)<snap());if(!near.length)return;const selected=near.find(n=>notes.has(n.id))||near[0];notes=new Set([selected.id]);attempt(()=>commit(s=>{s.patterns.find(x=>x.id===p.id).notes.find(n=>n.id===selected.id).velocity=clamp(Math.round((386-pos.y)/54*127),1,127);}));return;}
    if(pos.y<24){const clip=get().project.clips.find(c=>c.pattern===p.id);if(clip)setCursor(clip.start+rollCursor);drawRoll();return;}
    const n=hitNote(pos);if(n){if(e.shiftKey){if(notes.has(n.id))notes.delete(n.id);else notes.add(n.id);}else if(!notes.has(n.id))notes=new Set([n.id]);const right=54+(n.start+n.duration)/120*stepPixels;drag={kind:right-pos.x<6?'noteResize':'noteMove',origin:pos,note:n,selected:[...notes],copy:e.ctrlKey||e.altKey};}else{if(!e.shiftKey)notes.clear();drag={kind:'marquee',origin:pos,current:pos,keep:new Set(notes)};}capture(roll,e);drawRoll();};
  roll.onpointermove=e=>{if(drag?.kind==='marquee'){drag.current=position(roll,e);const a=drag.origin,b=drag.current;notes=new Set(drag.keep);for(const n of pattern().notes){const x=54+n.start/120*stepPixels,y=24+(topPitch-n.pitch)*12;if(n.pad===get().selected&&x>=Math.min(a.x,b.x)&&x<=Math.max(a.x,b.x)&&y+6>=Math.min(a.y,b.y)&&y+6<=Math.max(a.y,b.y))notes.add(n.id);}drawRoll();}};
  roll.onpointerup=e=>{if(!drag)return;const action=drag;drag=null;const pos=position(roll,e),p=pattern();attempt(()=>{if(['noteMove','noteResize'].includes(action.kind)){
    const rawDelta=(pos.x-action.origin.x)/stepPixels*120,movedX=Math.abs(pos.x-action.origin.x)>=3,pitchDelta=-Math.round((pos.y-action.origin.y)/12);
    if(!movedX&&(!pitchDelta||action.kind==='noteResize'))return;
    const anchor=action.note,delta=movedX?nearestTick(anchor.start+rawDelta,snap())-anchor.start:0;
    commit(s=>{const target=s.patterns.find(x=>x.id===p.id),chosen=target.notes.filter(n=>action.selected.includes(n.id));if(!chosen.length)return;
      if(action.kind==='noteResize'){const oldEnd=anchor.start+anchor.duration,change=nearestTick(oldEnd+rawDelta,snap())-oldEnd;const minChange=Math.max(...chosen.map(n=>1-n.duration)),maxChange=Math.min(...chosen.map(n=>p.bars*BAR-n.start-n.duration));for(const n of chosen)n.duration+=clamp(change,minChange,maxChange);}
      else{const shift=clamp(delta,-Math.min(...chosen.map(n=>n.start)),Math.min(...chosen.map(n=>p.bars*BAR-n.start-n.duration)));const changed=chosen.map(n=>({...n,id:action.copy?uid():n.id,start:n.start+shift,pitch:pitchForEdit(n.pitch+pitchDelta)}));if(action.copy){target.notes.push(...changed);notes=new Set(changed.map(n=>n.id));}else for(const n of changed)Object.assign(target.notes.find(x=>x.id===n.id),n);}
    });}});render();};
  roll.ondblclick=e=>attempt(()=>{const pos=position(roll,e),p=pattern(),existing=hitNote(pos);if(existing){notes.delete(existing.id);commit(s=>{const target=s.patterns.find(x=>x.id===p.id);target.notes=target.notes.filter(n=>n.id!==existing.id);});return;}if(pos.x<54||pos.x>=54+p.bars*16*stepPixels||pos.y<24||pos.y>=324)return;
    const start=cellStart((pos.x-54)/stepPixels*120,snap(),p.bars*BAR),n={id:uid(),pad:get().selected,pitch:pitchForEdit(topPitch-Math.floor((pos.y-24)/12)),start,duration:Math.min(snap()===1?120:snap(),p.bars*BAR-start),velocity:100};notes=new Set([n.id]);commit(s=>s.patterns.find(x=>x.id===p.id).notes.push(n));});
  roll.oncontextmenu=e=>{e.preventDefault();const n=hitNote(position(roll,e));if(n)attempt(()=>commit(s=>{const p=s.patterns.find(x=>x.id===pattern().id);p.notes=p.notes.filter(x=>x.id!==n.id);}));};
  for(const canvas of[arr,roll])canvas.onpointercancel=()=>{drag=null;render();};
  auto.onpointerdown=e=>attempt(()=>{if(e.button!==0)return;const pos=position(auto,e);if(pos.x<80)return;const param=$('autoParam').value,tick=clamp(Math.round((pos.x-80)/barPixels*BAR/120)*120,0,get().project.bars*BAR),value=param==='gain'?clamp((92-pos.y)/84,0,1):clamp((50-pos.y)/42,-1,1);commit(p=>{let t=p.automation.find(x=>x.group===get().group&&x.param===param);if(!t){t={group:get().group,param,points:[]};p.automation.push(t);}t.points=t.points.filter(x=>x.tick!==tick);t.points.push({tick,value});t.points.sort((a,b)=>a.tick-b.tick);});});
  auto.oncontextmenu=e=>{e.preventDefault();attempt(()=>{const pos=position(auto,e),tick=(pos.x-80)/barPixels*BAR;commit(p=>{const t=p.automation.find(x=>x.group===get().group&&x.param===$('autoParam').value);if(t){const near=t.points.reduce((a,b)=>!a||Math.abs(b.tick-tick)<Math.abs(a.tick-tick)?b:a,null);if(near&&Math.abs(near.tick-tick)<BAR/2)t.points=t.points.filter(x=>x!==near);}});});};
  $('patternSelect').onchange=()=>{notes.clear();setPattern($('patternSelect').value);render();};
  $('patternName').onchange=()=>attempt(()=>commit(p=>{p.patterns.find(x=>x.id===pattern().id).name=$('patternName').value.slice(0,80)||'Pattern';}));
  $('patternBars').onchange=()=>attempt(()=>commit(p=>{p.patterns.find(x=>x.id===pattern().id).bars=Number($('patternBars').value);}));
  $('patternNew').onclick=()=>attempt(()=>{const id=uid();commit(p=>p.patterns.push({id,group:get().group,name:GROUPS[get().group]+String(p.patterns.filter(x=>x.group===get().group).length+1).padStart(2,'0'),bars:2,notes:[]}));setPattern(id);render();});
  $('patternCopy').onclick=()=>attempt(()=>{const id=uid(),source=pattern();commit(p=>p.patterns.push({...source,id,name:(source.name+' copy').slice(0,80),notes:source.notes.map(n=>({...n,id:uid()}))}));setPattern(id);render();});
  $('sceneSave').onclick=()=>attempt(()=>{const {project}=get(),start=Number($('sceneAt').value)-1;const patterns=GROUPS.map((_,g)=>project.clips.find(c=>{const p=project.patterns.find(x=>x.id===c.pattern);return p.group===g&&c.start<=start*BAR&&c.start+p.bars*BAR*c.repeats>start*BAR;})?.pattern||null);const name=$('sceneName').value.trim()||`Scene ${project.scenes.length+1}`;commit(p=>p.scenes.push({id:uid(),name:name.slice(0,80),patterns}));});
  $('sceneInsert').onclick=()=>attempt(()=>commit(p=>insertScene(p,$('sceneSelect').value,(Number($('sceneAt').value)-1)*BAR)));
  $('sceneSelect').onchange=()=>{$('sceneName').value=get().project.scenes.find(scene=>scene.id===$('sceneSelect').value)?.name||'';};
  $('sceneRename').onclick=()=>attempt(()=>{const name=$('sceneName').value.trim();if(!name)throw new Error('Введите новое название сцены');commit(p=>{p.scenes.find(scene=>scene.id===$('sceneSelect').value).name=name.slice(0,80);});});
  $('sceneDelete').onclick=()=>{const id=$('sceneSelect').value;if(!id||!confirm('Удалить выбранную сцену и её позиции из Song Mode?'))return;attempt(()=>commit(p=>{p.scenes=p.scenes.filter(scene=>scene.id!==id);p.song=p.song.filter(sceneId=>sceneId!==id);}));};
  $('songAdd').onclick=()=>attempt(()=>{const id=$('sceneSelect').value;if(!id)throw new Error('Сначала сохраните и выберите сцену');commit(p=>p.song.push(id));});
  $('songClear').onclick=()=>{if(get().project.song.length&&confirm('Очистить последовательность Song Mode?'))attempt(()=>commit(p=>{p.song=[];}));};
  $('songBuild').onclick=()=>{if(!confirm('Заменить текущие клипы аранжировкой из Song Mode?'))return;attempt(()=>commit(arrangeSong));};
  for(const [id,key]of[['clipStart','start'],['clipRepeats','repeats']])$(id).onchange=()=>attempt(()=>commit(p=>{const value=Number($(id).value),first=p.clips.find(c=>clips.has(c.id)),delta=(value-1)*BAR-(first?.start||0);for(const c of p.clips)if(clips.has(c.id)){if(key==='start')c.start+=delta;else c.repeats=value;}}));
  for(const [id,key]of[['notePitch','pitch'],['noteStart','start'],['noteDuration','duration'],['noteVelocity','velocity']])$(id).onchange=()=>attempt(()=>commit(p=>{for(const n of p.patterns.find(x=>x.id===pattern().id).notes)if(notes.has(n.id))n[key]=key==='pitch'?pitchForEdit(Number($(id).value)):Number($(id).value);}));
  const editNotes=fn=>attempt(()=>commit(p=>{for(const n of p.patterns.find(x=>x.id===pattern().id).notes)if(notes.size?notes.has(n.id):n.pad===get().selected)fn(n);}));
  for(const id of ['scaleRoot','scaleMode','keySpelling','scaleSnap'])$(id).onchange=()=>attempt(()=>commit(p=>{p.tonality={root:Number($('scaleRoot').value),scale:$('scaleMode').value,spelling:$('keySpelling').value,snap:$('scaleSnap').checked};}));
  $('ghostNotes').onchange=()=>{try{localStorage.setItem('ep133-ghost-notes',String($('ghostNotes').checked));}catch{}drawRoll();};
  $('fitScale').onclick=()=>editNotes(n=>{n.pitch=nearestInScale(n.pitch,tonality());});
  $('quantize').onclick=()=>editNotes(n=>{n.start=clamp(quantize(n.start),0,pattern().bars*BAR-n.duration);});
  for(const button of document.querySelectorAll('[data-transpose]'))button.onclick=()=>editNotes(n=>{transpose(n,Number(button.dataset.transpose));});
  function remove(){attempt(()=>commit(p=>{if(focus==='clips')p.clips=p.clips.filter(c=>!clips.has(c.id));else{const target=p.patterns.find(x=>x.id===pattern().id);target.notes=target.notes.filter(n=>!notes.has(n.id));}}));}
  $('deleteSelection').onclick=remove;
  function copy(){clipboard=focus==='clips'?{kind:'clips',values:get().project.clips.filter(x=>clips.has(x.id)).map(x=>({...x}))}:{kind:'notes',values:pattern().notes.filter(x=>notes.has(x.id)).map(x=>({...x}))};message(`Скопировано: ${clipboard.values.length}`);}
  function paste(){if(!clipboard?.values.length)return;attempt(()=>commit(p=>{const min=Math.min(...clipboard.values.map(x=>x.start));if(clipboard.kind==='clips'){const added=clipboard.values.map(x=>({...x,id:uid(),start:x.start-min+Math.floor(cursor/BAR)*BAR}));p.clips.push(...added);clips=new Set(added.map(x=>x.id));}else{const target=p.patterns.find(x=>x.id===pattern().id),added=clipboard.values.map(x=>({...x,id:uid(),pad:get().selected,pitch:pitchForEdit(x.pitch),start:x.start-min+rollCursor}));target.notes.push(...added);notes=new Set(added.map(x=>x.id));}}));}
  $('copySelection').onclick=copy;$('pasteSelection').onclick=paste;
  document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('studio').hidden)return;const ctrl=e.ctrlKey||e.metaKey;if(ctrl&&['c','v','a'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='c')copy();else if(e.key.toLowerCase()==='v')paste();else{if(focus==='clips')clips=new Set(get().project.clips.map(x=>x.id));else notes=new Set(pattern().notes.filter(x=>x.pad===get().selected).map(x=>x.id));render();}}else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();remove();}else if(['ArrowUp','ArrowDown'].includes(e.key)&&focus==='notes'){e.preventDefault();editNotes(n=>{transpose(n,(e.key==='ArrowUp'?1:-1)*(e.shiftKey?12:1));});}});
  const arrLevels=[16,24,32,48,64,80,96,128,160,192],rollLevels=[8,12,16,22,28,34,44,56,72,96];
  for(const [id,levels,base]of[['arrZoom',arrLevels,64],['rollZoom',rollLevels,22]]){const select=$(id);select.replaceChildren();for(const level of levels){const option=document.createElement('option');option.value=level;option.textContent=Math.round(level/base*100)+'%';select.append(option);}select.value=base;}
  function zoomAt(canvas,value,clientX){
    if(drag)return;const isRoll=canvas===roll,scroller=canvas.parentElement,label=isRoll?54:80,oldScale=isRoll?stepPixels/120:barPixels/BAR;
    const rect=scroller.getBoundingClientRect(),screenX=clientX-rect.left-scroller.clientLeft,point=position(canvas,{clientX,clientY:canvas.getBoundingClientRect().top});
    const tick=Math.max(0,(point.x-label)/oldScale);
    if(isRoll)stepPixels=value;else barPixels=value;
    $(isRoll?'rollZoom':'arrZoom').value=value;render();
    const scale=isRoll?stepPixels/120:barPixels/BAR,cssScale=canvas.getBoundingClientRect().width/canvas.width;
    scroller.scrollLeft=anchoredScroll(tick,scale,label,screenX,cssScale);
    if(!isRoll){$('arrScroll').scrollLeft=scroller.scrollLeft;$('autoScroll').scrollLeft=scroller.scrollLeft;}
  }
  for(const [id,canvas]of[['arrZoom',arr],['rollZoom',roll]])$(id).onchange=()=>{const scroller=canvas.parentElement,r=scroller.getBoundingClientRect();zoomAt(canvas,Number($(id).value),r.left+scroller.clientWidth/2);};
  let pitchWheel=0;
  function wheel(canvas,event){
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.parentElement.clientHeight:1);
    if(event.ctrlKey||event.metaKey){event.preventDefault();if(drag||!delta)return;const levels=canvas===roll?rollLevels:arrLevels,current=canvas===roll?stepPixels:barPixels,index=levels.indexOf(current),next=levels[clamp(index+(delta<0?1:-1),0,levels.length-1)];if(next!==current)zoomAt(canvas,next,event.clientX);return;}
    if(event.shiftKey){event.preventDefault();if(drag)return;canvas.parentElement.scrollLeft+=delta||event.deltaX;if(canvas!==roll){$('arrScroll').scrollLeft=canvas.parentElement.scrollLeft;$('autoScroll').scrollLeft=canvas.parentElement.scrollLeft;}return;}
    if(canvas===roll&&!event.deltaX){event.preventDefault();if(drag)return;pitchWheel+=delta;const steps=Math.trunc(pitchWheel/60);if(steps){pitchWheel-=steps*60;topPitch=clamp(topPitch-steps,24,127);drawRoll();}}
  }
  for(const canvas of[arr,auto,roll])canvas.addEventListener('wheel',e=>wheel(canvas,e),{passive:false});
  $('snap').onchange=drawRoll;$('autoParam').onchange=drawAutomation;
  $('octaveUp').onclick=()=>{topPitch=clamp(topPitch+12,24,127);drawRoll();};$('octaveDown').onclick=()=>{topPitch=clamp(topPitch-12,24,127);drawRoll();};
  return {render,setCursor(tick){cursor=tick;const p=pattern();const clip=get().project.clips.find(c=>c.pattern===p?.id&&c.start<=tick&&tick<c.start+p.bars*BAR*c.repeats);rollCursor=p?(clip?(tick-clip.start)%(p.bars*BAR):Math.min(tick,p.bars*BAR)):0;drawArrangement();drawRoll(false);},reset(){notes.clear();clips.clear();drag=null;cursor=rollCursor=0;},selectedNotes:()=>[...notes]};
}
