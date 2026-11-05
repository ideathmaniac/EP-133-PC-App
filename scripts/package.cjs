const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  if(process.platform!=='win32')throw new Error('Build this Windows preview on Windows');
  const version=require('../package.json').version;
  const target=path.resolve(`release/EP133-Studio-${version}-win32-x64`);
  await fs.mkdir(target,{recursive:true});
  await fs.cp(path.dirname(require('electron')),target,{recursive:true});
  const app=path.join(target,'resources/app');await fs.mkdir(path.join(app,'dist'),{recursive:true});await fs.mkdir(path.join(app,'src'),{recursive:true});
  for(const file of ['main.cjs','preload.cjs','close-controller.cjs','session-store.cjs','index.html','style.css','README.md','src/editor.css'])await fs.copyFile(file,path.join(app,file));
  await fs.copyFile('dist/app.js',path.join(app,'dist/app.js'));
  await fs.writeFile(path.join(app,'package.json'),JSON.stringify({name:'ep133-studio',version:require('../package.json').version,main:'main.cjs'}));
  await fs.copyFile(path.join(target,'electron.exe'),path.join(target,'EP133-Studio.exe'));
  console.log(path.join(target,'EP133-Studio.exe'));
})().catch(e=>{console.error(e);process.exitCode=1;});
