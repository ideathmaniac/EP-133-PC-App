import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasPoint,cellStart,nearestTick,visibleGridStep,anchoredScroll} from '../src/grid.mjs';
test('placement uses the clicked cell, including its right half and final cell',()=>{
  for(const step of[1,60,120,240])for(const cell of[0,1,7,15]){const length=3840,start=cell*step;if(start>=length)continue;for(const fraction of[.01,.49,.51,.99])assert.equal(cellStart(start+step*fraction,step,length),start);}
  assert.equal(cellStart(1919,120,1920),1800);assert.equal(cellStart(-10,120,1920),0);assert.equal(nearestTick(241+135,120),360);
});
test('canvas coordinates account for display scaling and scrolled screen origin',()=>{
  const canvas={width:1000,height:400,getBoundingClientRect:()=>({left:-280,top:80,width:1500,height:600})};
  assert.deepEqual(canvasPoint(canvas,{clientX:470,clientY:380}),{x:500,y:200});
});
test('zoom keeps the musical tick under the cursor and visual grid lines remain snap boundaries',()=>{
  const tick=2400,label=54,oldScale=22/120,newScale=44/120,scroll=200,screen=label+tick*oldScale-scroll;
  const next=anchoredScroll(tick,newScale,label,screen);assert.ok(Math.abs(label+tick*newScale-next-screen)<1e-9);
  for(const step of[1,60,120,240])for(const pixels of[8,12,16,22,34,96]){const visible=visibleGridStep(step,pixels/120);assert.equal(visible%step,0);assert.ok(visible*pixels/120>=4);}
});
