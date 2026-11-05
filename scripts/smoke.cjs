const {spawnSync}=require('node:child_process');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const packaged=process.argv[2];
const result=spawnSync(packaged||require('electron'),packaged?['--smoke']:['.','--smoke'],{env,stdio:'inherit',timeout:120000});
if(result.error)console.error(result.error);
process.exit(result.status??1);
