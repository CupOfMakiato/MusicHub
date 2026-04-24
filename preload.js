const { contextBridge, ipcRenderer, shell } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    selectAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    getAudioFilesInFolder: (folderPath) => ipcRenderer.invoke('folder:getAudioFiles', folderPath),
    readAudioFile: (filePath, maxBytes) =>
        ipcRenderer.invoke('file:readAudioFile', filePath, maxBytes),
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
