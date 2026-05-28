// bridge main.js and script.js - securely expose APIs for file system access, settings management, and playlist handling

const { contextBridge, ipcRenderer, shell } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    selectAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
    selectImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    getAudioFilesInFolder: (folderPath) => ipcRenderer.invoke('folder:getAudioFiles', folderPath),
    readAudioMetadata: (filePath) => ipcRenderer.invoke('file:readAudioMetadata', filePath),
    getSavedVolume: () => ipcRenderer.invoke('settings:getVolume'),
    saveVolume: (volume) => ipcRenderer.invoke('settings:setVolume', volume),
    savePlaylist: (playlist, currentTrackIndex, playbackPosition = 0) =>
        ipcRenderer.invoke('playlist:save', { playlist, currentTrackIndex, playbackPosition }),
    loadPlaylist: () => ipcRenderer.invoke('playlist:load'),
    saveRecentTracks: (tracks) => ipcRenderer.invoke('recent-tracks:save', tracks),
    loadRecentTracks: () => ipcRenderer.invoke('recent-tracks:load'),
    approveRecentAudioPath: (filePath) =>
        ipcRenderer.invoke('file:approveRecentAudioPath', filePath),
    openExternal: (url) => shell.openExternal(url),
})
