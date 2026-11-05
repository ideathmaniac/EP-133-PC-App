export function canvasPoint(canvas,event){
  const rect=canvas.getBoundingClientRect();
  return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};
}
export function cellStart(tick,step,length){
  const last=Math.floor((length-1)/step)*step;
  return Math.max(0,Math.min(last,Math.floor((tick+1e-7)/step)*step));
}
export const nearestTick=(tick,step)=>Math.round(tick/step)*step;
export function visibleGridStep(step,pixelsPerTick){
  // Never draw subpixel lines. Every visible line is still a snap boundary.
  return [1,2,3,4,5,6,8,10,12,15,16,20,24,30,40,48,60,80,96,120,160,240,480,960,1920].find(tick=>tick>=step&&tick%step===0&&tick*pixelsPerTick>=4)||step*Math.max(1,Math.ceil(4/(step*pixelsPerTick)));
}
export function anchoredScroll(tick,pixelsPerTick,labelWidth,screenX,cssScale=1){
  return(labelWidth+tick*pixelsPerTick)*cssScale-screenX;
}
