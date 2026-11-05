(async () => {
  const $ = id => document.getElementById(id);
  const saved = navigator.requestMIDIAccess;
  const listeners = new Set();
  const input = { id:'test-in',name:'EP-133 test',state:'connected',open:async()=>{},addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn) };
  const emit = bytes => { for (const fn of listeners) fn({data:Uint8Array.from(bytes)}); };
  const u16 = n => [n>>8,n&255], u32 = n => [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255], str = s => [...new TextEncoder().encode(s)];
  const pack = data => {const out=[];for(let i=0;i<data.length;i+=7){let header=0;const group=data.slice(i,i+7);group.forEach((n,j)=>header|=(n>>>7)<<j);out.push(header,...group.map(n=>n&127));}return out;};
  const unpack = data => {const out=[];for(let i=0;i<data.length;i+=8)for(let j=1;j<8&&i+j<data.length;j++)out.push(data[i+j]|((data[i]>>>(j-1)&1)<<7));return out;};
  let sent = 0;
  const output = {id:'test-out',name:'EP-133 test',state:'connected',open:async()=>{},send:request=>{
    sent++;if(request[1]===126){emit([240,126,1,6,2,0,32,118,32,0,1,0,2,5,0,0,247]);return;}
    const p=unpack(request.slice(9,-1));let data;
    if(request[8]===1)data=str('os_version:2.5;sku:TE032AS001;');
    else if(p[0]===1)data=[1,...u32(1024)];
    else if(p[0]===4){const page=p[1]*256+p[2],node=p[3]*256+p[4];data=page?[...u16(page)]:node===0?[0,0,...u16(10),6,...u32(0),...str('sounds'),0]:[0,0,...u16(11),5,...u32(8),...str('001 test'),0];}
    else if(p[0]===7)data=[0,0,...str('{"format":"s16","channels":1,"samplerate":22050}'),0];
    else if(p[0]===3)data=p[1]===0?[...u16(11),5,...u32(8),...str('001 test'),0]:[0,0,0,0,255,127,0,0,0,128];
    else throw new Error('UI test issued unexpected command');
    emit([240,0,32,118,request[4],64,request[6]&63,request[7],request[8],0,...pack(data),247]);
  }};
  const access={sysexEnabled:true,inputs:new Map([[input.id,input]]),outputs:new Map([[output.id,output]])};
  Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>access});
  try {
    document.querySelector('[data-view=device]').click();await $('scanMidi').onclick();await $('connectDevice').onclick();
    const connected=$('deviceStatus').textContent.includes('MIDI')&&$('deviceFiles').children.length===1;
    await $('deviceFiles').querySelector('button').onclick();
    const browsed=$('devicePath').textContent==='/sounds';
    await $('deviceFiles').querySelector('button').onclick();await $('nodeMetadata').onclick();
    const metadata=$('nodeDetails').textContent.includes('samplerate');await $('nodeImport').onclick();
    const imported=$('padName').value==='001 test.wav';
    $('disconnectDevice').click();const disconnected=$('deviceStatus').textContent.includes('OFFLINE')&&listeners.size===0&&$('nodeImport').disabled;
    return {passed:connected&&browsed&&metadata&&imported&&disconnected,connected,browsed,metadata,imported,disconnected,sent};
  } finally { $('disconnectDevice').click();Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:saved});document.querySelector('[data-view=studio]').click(); }
})()
