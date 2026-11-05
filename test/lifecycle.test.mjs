import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createCloseController}=require('../close-controller.cjs'),{createSessionStore}=require('../session-store.cjs');
test('native close flow: clean, discard, cancel, cancelled Save As and successful save',async()=>{
 for(const scenario of[{dirty:false,choice:2,finish:1},{dirty:true,choice:1,finish:1},{dirty:true,choice:2,finish:0},{dirty:true,choice:0,saved:false,finish:0},{dirty:true,choice:0,saved:true,finish:1}]){let finished=0,saves=0;const close=createCloseController({getState:async()=>({dirty:scenario.dirty}),choose:async()=>scenario.choice,save:async()=>{saves++;return scenario.saved;},finish:()=>finished++,onError:async e=>{throw e;}});await close();assert.equal(finished,scenario.finish);assert.equal(saves,scenario.dirty&&scenario.choice===0?1:0);}
});
test('repeated cross clicks do not open duplicate dialogs and errors allow retry',async()=>{
 let release,finish=0,dialogs=0;const close=createCloseController({getState:()=>new Promise(r=>release=r),choose:async()=>{dialogs++;return 1;},save:async()=>true,finish:()=>finish++,onError:async()=>{}});const first=close();assert.equal(await close(),false);release({dirty:true});await first;assert.equal(dialogs,1);assert.equal(finish,1);
 let failed=true,errors=0;const retry=createCloseController({getState:async()=>{if(failed)throw new Error('disk');return{dirty:false};},choose:async()=>1,save:async()=>true,finish:()=>finish++,onError:async()=>errors++});assert.equal(await retry(),false);failed=false;assert.equal(await retry(),true);assert.equal(errors,1);
});
test('autosave persists latest complete session, rejects corruption and retains previous file',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ep133-store-test-'));const filename=path.join(directory,'autosave.epstudio'),store=createSessionStore(filename);
 try{assert.equal(await store.read(),null);await Promise.all([store.write('{"format":"ep133-studio","version":2,"name":"first"}'),store.write('{"format":"ep133-studio","version":2,"name":"last"}')]);assert.equal(JSON.parse(await store.read()).name,'last');await assert.rejects(store.write('not-json'));assert.equal(JSON.parse(await store.read()).name,'last');assert.equal(JSON.parse(await createSessionStore(filename).read()).name,'last');await assert.rejects(fs.stat(filename+'.tmp'));}finally{await fs.unlink(filename).catch(()=>{});await fs.rmdir(directory);}
});
