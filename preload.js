const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getAudioFilesInFolder: (folderPath) => ipcRenderer.invoke('folder:getAudioFiles', folderPath),
  readAudioFile: (filePath) => ipcRenderer.invoke('file:readAudioFile', filePath),
})
