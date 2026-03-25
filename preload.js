const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
  readAudioFile: (filePath) => ipcRenderer.invoke('file:readAudioFile', filePath),
})

