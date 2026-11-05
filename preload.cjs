const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  saveProject: (name, text) => ipcRenderer.invoke('save-project', { name, text }),
  autosave: text => ipcRenderer.invoke('autosave', text),
  loadAutosave: () => ipcRenderer.invoke('load-autosave')
});
