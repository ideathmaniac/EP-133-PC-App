const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createCloseController } = require('./close-controller.cjs');
const { createSessionStore } = require('./session-store.cjs');
app.setName('EP133 Studio');
app.whenReady().then(async () => {
  const smoke = process.argv.includes('--smoke');
  const store = createSessionStore(smoke ? path.resolve('artifacts/smoke-autosave.epstudio') : path.join(app.getPath('userData'), 'autosave.epstudio'));
  let smokeInitialRead = smoke;
  const window = new BrowserWindow({
    width: 1440, height: 980, minWidth: 1100, minHeight: 780,
    show: !smoke, backgroundColor: '#141619', title: 'EP133 Studio — Offline',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !smoke, offscreen: smoke }
  });
  const appURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
  const allowMidi = (wc, permission) => wc === window.webContents && wc.getURL() === appURL && ['midi', 'midiSysex'].includes(permission);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(allowMidi(wc, permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowMidi(wc, permission));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const assertSender = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid sender');
  };
  async function saveProject({name,text}) {
    if (typeof text !== 'string' || text.length > 190 * 1024 * 1024 || typeof name !== 'string') throw new Error('Invalid project');
    const result = await dialog.showSaveDialog(window, { defaultPath: name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')+'.epstudio', filters: [{ name:'EP133 Studio', extensions:['epstudio'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, text, 'utf8');
    return true;
  }
  ipcMain.handle('save-project', (event, state) => { assertSender(event); return saveProject(state); });
  ipcMain.handle('autosave', (event, text) => { assertSender(event); return store.write(text); });
  ipcMain.handle('load-autosave', event => { assertSender(event); if(smokeInitialRead){smokeInitialRead=false;return null;}return store.read(); });
  const close = createCloseController({
    getState: async () => {const state=await window.webContents.executeJavaScript('window.ready.then(() => window.prepareClose())');await store.write(state.text);return state;},
    choose: async () => smoke ? 1 : (await dialog.showMessageBox(window,{type:'question',title:'Закрыть EP133 Studio',message:'Сохранить файл проекта перед выходом?',detail:'Последняя сессия сохраняется автоматически. Отдельный файл проекта можно сохранить для архива.',buttons:['Сохранить файл','Закрыть','Отмена'],defaultId:0,cancelId:2,noLink:true})).response,
    save: saveProject,
    finish: () => window.destroy(),
    onError: async error => {if(smoke){console.error(error);app.exit(1);return;}const choice=await dialog.showMessageBox(window,{type:'warning',title:'Не удалось сохранить сессию',message:error.message,detail:'Закрыть приложение без сохранения последних изменений?',buttons:['Остаться','Закрыть'],defaultId:0,cancelId:0});if(choice.response===1)window.destroy();}
  });
  window.on('close', event => {event.preventDefault();void close();});
  await window.loadFile('index.html');
  await window.webContents.executeJavaScript('window.ready');
  if (smoke) {
    try {
      const deviceUi = fs.existsSync('scripts/device-ui-smoke.js') ? await window.webContents.executeJavaScript(fs.readFileSync('scripts/device-ui-smoke.js', 'utf8')) : null;
      const result = await window.webContents.executeJavaScript('window.runSmoke()');
      if(fs.existsSync('scripts/editor-ui-smoke.js')){result.editors=await window.webContents.executeJavaScript(fs.readFileSync('scripts/editor-ui-smoke.js','utf8'));result.passed&&=result.editors.passed;}
      if(fs.existsSync('scripts/grid-ui-smoke.js')){result.navigation=await window.webContents.executeJavaScript(fs.readFileSync('scripts/grid-ui-smoke.js','utf8'));result.passed&&=result.navigation.passed;}
      if (deviceUi) { result.deviceUi = deviceUi; result.passed &&= deviceUi.passed; }
      await new Promise(resolve => setTimeout(resolve, 200));
      fs.mkdirSync('artifacts', { recursive: true });
      fs.writeFileSync('artifacts/smoke.json', JSON.stringify(result, null, 2));
      const capture = await window.webContents.capturePage();
      fs.writeFileSync('artifacts/preview.png', capture.toPNG());
      await window.webContents.executeJavaScript('document.getElementById("rollCanvas").scrollIntoView({block:"center"})');
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync('artifacts/piano-roll.png',(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript('document.querySelector("[data-zone=pads]").scrollIntoView({block:"center"})');
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync('artifacts/pads-and-samples.png',(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript('document.getElementById("projectName").value="Close regression test"; document.getElementById("projectName").dispatchEvent(new Event("change"))');
      const closeTimeout=setTimeout(()=>{console.error('Window did not close');app.exit(1);},10000);
      window.once('closed',()=>{clearTimeout(closeTimeout);result.closePassed=true;fs.writeFileSync('artifacts/smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.passed?0:1);});
      window.close();
    } catch (error) { console.error(error); app.exit(1); }
  }
});
app.on('window-all-closed', () => app.quit());
