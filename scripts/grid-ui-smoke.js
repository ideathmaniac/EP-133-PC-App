(async()=>{
  const $=id=>document.getElementById(id),api=window.editorTest,original=JSON.parse(JSON.stringify(api.get())),checks={};
  const fixture=JSON.parse(JSON.stringify(original));fixture.clips=[];fixture.patterns[0].bars=8;fixture.patterns[0].notes=[];fixture.tonality={root:0,scale:'chromatic',snap:false,spelling:'sharps'};
  await api.load(fixture);api.selectPad(3);
  const roll=$('rollCanvas'),arr=$('arrCanvas'),scroller=roll.parentElement;
  const fire=(canvas,type,x,y)=>{const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:1,clientX:r.left+x*r.width/canvas.width,clientY:r.top+y*r.height/canvas.height}));};
  const wheel=(canvas,dy,options={})=>{const r=canvas.parentElement.getBoundingClientRect(),e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:dy,clientX:r.left+canvas.parentElement.clientLeft+400,clientY:canvas.getBoundingClientRect().top+100,...options});canvas.dispatchEvent(e);return e;};
  const change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change'));};
  const notes=()=>api.get().patterns[0].notes;
  fire(roll,'dblclick',54+2.85*22,174);checks.cellRightHalf=notes()[0]?.start===240;
  change('snap',60);fire(roll,'dblclick',54+8.75*11,174);checks.grid32=notes()[1]?.start===480&&notes()[1]?.duration===60;
  const pixel=x=>[...roll.getContext('2d').getImageData(x,70,1,1).data].join(',');checks.grid32Visible=pixel(65)!==pixel(68);
  change('snap',240);checks.grid8Visible=pixel(65)===pixel(68);fire(roll,'dblclick',54+3.8*44,174);checks.grid8=notes()[2]?.start===720&&notes()[2]?.duration===240;change('snap',120);
  api.commit(p=>{p.patterns[0].notes[0].start=241;});fire(roll,'pointerdown',103,174);fire(roll,'pointerup',128,174);checks.dragToGrid=notes()[0]?.start===360;
  api.commit(p=>{p.patterns[0].notes[0].duration=121;});fire(roll,'pointerdown',140,174);fire(roll,'pointerup',164,174);checks.resizeToGrid=notes()[0]?.duration===240;
  roll.style.width=roll.width*1.25+'px';fire(roll,'dblclick',54+20.8*22,198);checks.cssScaledPlacement=notes().at(-1).start===2400;roll.style.removeProperty('width');
  scroller.scrollLeft=300;fire(roll,'dblclick',54+35.85*22,198);checks.scrolledPlacement=notes().at(-1).start===4200;
  scroller.scrollLeft=400;
  const tickUnder=(canvas,px)=>{const r=canvas.getBoundingClientRect(),parent=canvas.parentElement.getBoundingClientRect();return((parent.left+canvas.parentElement.clientLeft+400-r.left)*canvas.width/r.width-54)/px*120;};
  const before=tickUnder(roll,22),event=wheel(roll,-120,{ctrlKey:true}),after=tickUnder(roll,28);
  checks.wheelZoom=$('rollZoom').value==='28'&&event.defaultPrevented;checks.zoomAnchor=Math.abs(after-before)*28/120<1.1;
  wheel(roll,120,{ctrlKey:true});checks.wheelZoomOut=$('rollZoom').value==='22';
  const oldLeft=scroller.scrollLeft;wheel(roll,120,{shiftKey:true});checks.horizontalWheel=Math.abs(scroller.scrollLeft-oldLeft-120)<1;
  wheel(roll,-120);fire(roll,'dblclick',54+55.8*22,174);checks.pitchWheel=notes().at(-1).pitch===62;wheel(roll,120);
  const snapshot=JSON.stringify(api.get());for(let i=0;i<20;i++)wheel(roll,-120,{ctrlKey:true});checks.zoomMax=$('rollZoom').value==='96';for(let i=0;i<20;i++)wheel(roll,120,{ctrlKey:true});checks.zoomMin=$('rollZoom').value==='8';checks.zoomNonDestructive=JSON.stringify(api.get())===snapshot;
  change('arrZoom',160);$('arrScroll').scrollLeft=80;wheel(arr,-120,{ctrlKey:true});checks.arrangementZoom=$('arrZoom').value==='192'&&$('arrCanvas').width===$('autoCanvas').width&&Math.abs($('arrScroll').scrollLeft-$('autoScroll').scrollLeft)<1;
  change('rollZoom',22);change('arrZoom',64);scroller.scrollLeft=0;change('snap',120);await api.load(original);api.selectPad(3);window.scrollTo(0,0);
  return{passed:Object.values(checks).every(Boolean),...checks};
})()
