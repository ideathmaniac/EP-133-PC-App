const fs=require('node:fs/promises');
const path=require('node:path');
function createSessionStore(file){
  let queue=Promise.resolve();
  function write(text){
    if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>190*1024*1024)return Promise.reject(new Error('Проект слишком большой'));
    const task=queue.catch(()=>{}).then(async()=>{const parsed=JSON.parse(text);if(parsed?.format!=='ep133-studio'||![1,2].includes(parsed.version))throw new Error('Некорректный проект автосохранения');await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.tmp';await fs.writeFile(temporary,text,'utf8');await fs.rename(temporary,file);return true;});queue=task;return task;
  }
  async function read(){await queue.catch(()=>{});try{return await fs.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  return{write,read};
}
module.exports={createSessionStore};
