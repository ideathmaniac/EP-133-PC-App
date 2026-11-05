const scale=(id,label,name,intervals)=>Object.freeze({id,label,name,intervals:Object.freeze(intervals)});
export const SCALES=Object.freeze([
  scale('chromatic','Хроматика / все ноты','Chromatic',[0,1,2,3,4,5,6,7,8,9,10,11]),
  scale('major','Мажор / ионийский','Major',[0,2,4,5,7,9,11]),
  scale('minor','Натуральный минор / эолийский','Natural minor',[0,2,3,5,7,8,10]),
  scale('dorian','Дорийский','Dorian',[0,2,3,5,7,9,10]),
  scale('phrygian','Фригийский','Phrygian',[0,1,3,5,7,8,10]),
  scale('lydian','Лидийский','Lydian',[0,2,4,6,7,9,11]),
  scale('mixolydian','Миксолидийский','Mixolydian',[0,2,4,5,7,9,10]),
  scale('locrian','Локрийский','Locrian',[0,1,3,5,6,8,10]),
  scale('harmonic-minor','Гармонический минор','Harmonic minor',[0,2,3,5,7,8,11]),
  scale('melodic-minor','Мелодический минор ↑','Melodic minor ascending',[0,2,3,5,7,9,11]),
  scale('major-pentatonic','Мажорная пентатоника','Major pentatonic',[0,2,4,7,9]),
  scale('minor-pentatonic','Минорная пентатоника','Minor pentatonic',[0,3,5,7,10]),
  scale('blues','Минорный блюзовый','Minor blues',[0,3,5,6,7,10]),
  scale('whole-tone','Целотонный','Whole tone',[0,2,4,6,8,10])
]);
export const DEFAULT_TONALITY=Object.freeze({root:0,scale:'chromatic',snap:false,spelling:'sharps'});
export const tonalityOf=p=>p.tonality??DEFAULT_TONALITY;
export function validateTonality(t){
  if(!t||!Number.isInteger(t.root)||t.root<0||t.root>11||!SCALES.some(s=>s.id===t.scale)||typeof t.snap!=='boolean'||!['sharps','flats'].includes(t.spelling))throw new Error('Некорректная тональность или лад');
  return t;
}
export function pitchClassName(pitch,spelling='sharps'){
  return(spelling==='flats'?['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B']:['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'])[((pitch%12)+12)%12];
}
export function noteName(pitch,spelling='sharps'){return pitchClassName(pitch,spelling)+(Math.floor(pitch/12)-1);}
export function scalePitchClasses(t){return SCALES.find(s=>s.id===t.scale).intervals.map(n=>(n+t.root)%12);}
export function inScale(pitch,t){return SCALES.find(s=>s.id===t.scale).intervals.includes(((pitch-t.root)%12+12)%12);}
// Equal-distance ties move down. All results stay within the MIDI note range.
export function nearestInScale(pitch,t){
  if(!Number.isFinite(pitch))throw new Error('Некорректная высота ноты');
  const center=Math.max(0,Math.min(127,Math.round(pitch)));
  for(let distance=0;distance<=127;distance++){const lower=center-distance,upper=center+distance;if(lower>=0&&inScale(lower,t))return lower;if(upper<=127&&inScale(upper,t))return upper;}
}
export function stepInScale(pitch,steps,t){
  let result=Math.max(0,Math.min(127,pitch));const direction=Math.sign(steps);
  for(let i=0;i<Math.abs(steps);i++){let next=result+direction;while(next>=0&&next<=127&&!inScale(next,t))next+=direction;if(next<0||next>127)return nearestInScale(result,t);result=next;}return result;
}
export function keySignature(t){
  if(!['major','minor'].includes(t.scale))return null;
  let fifths=(t.scale==='major'?[0,7,2,-3,4,-1,6,1,-4,3,-2,5]:[-3,4,-1,6,1,-4,3,-2,5,0,7,2])[t.root];
  if(t.spelling==='flats'){if(t.scale==='major'&&t.root===1)fifths=-5;if(t.scale==='major'&&t.root===6)fifths=-6;if(t.scale==='minor'&&t.root===10)fifths=-5;}
  return{fifths,minor:t.scale==='minor'};
}
