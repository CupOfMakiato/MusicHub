const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav'])
const MAX_AUDIO_FILE_BYTES = Number(process.env.MAX_AUDIO_FILE_BYTES || 50 * 1024 * 1024)
const DEFAULT_VOLUME = 0.7
let settingsStore = null
const allowedAudioPaths = new Set()

function getAppIconPath() {
  const iconCandidates = [
    // path.join(__dirname, 'ui', 'assets', 'paw-print-svgrepo-com.png'),
    path.join(__dirname, 'ui', 'assets', 'IMG_4980.PNG'),
    // path.join(__dirname, 'build-assets', 'IMG_4980.PNG'),
  ]

  for (const iconPath of iconCandidates) {
    if (fs.existsSync(iconPath)) {
      return iconPath
    }
  }

  return undefined
}

function normalizeFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null
  const resolvedPath = path.resolve(filePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function markPathAsAllowed(filePath) {
  const normalized = normalizeFilePath(filePath)
  if (normalized) {
    allowedAudioPaths.add(normalized)
  }
}

function isAllowedAudioPath(filePath) {
  const normalized = normalizeFilePath(filePath)
  if (!normalized) return false
  return allowedAudioPaths.has(normalized)
}

function normalizeVolume(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME
  return Math.max(0, Math.min(1, parsed))
}

const createWindow = () => {
  const appIcon = getAppIconPath()
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  })

  win.loadFile('ui/index.html')
  win.webContents.openDevTools();
  win.on('ready-to-show', () => {
    win.show()
  })
}

app.on('ready', () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.makiato.musichub')
  }

  createWindow()
});

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store')
  settingsStore = new Store({
    name: 'settings',
    defaults: {
      playerVolume: DEFAULT_VOLUME,
      recentPlaylist: [],
      recentPlaylistIndex: -1,
      recentTracks: [],
    },
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('dialog:openAudioFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav'] }],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  markPathAsAllowed(result.filePaths[0])

  return result.filePaths[0]
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('folder:getAudioFiles', async (event, folderPath) => {
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    const audioPaths = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(folderPath, entry.name))
      .filter((filePath) => AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    const filesWithDates = await Promise.all(
      audioPaths.map(async (filePath) => {
        const stats = await fs.promises.stat(filePath)
        return {
          filePath,
          createdAt: stats.birthtimeMs,
        }
      })
    )

    const files = filesWithDates
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((item) => item.filePath)

    files.forEach((filePath) => markPathAsAllowed(filePath))

    return files
  } catch (error) {
    console.error('Failed to read folder audio files:', error)
    return []
  }
})

ipcMain.handle('settings:getVolume', async () => {
  if (!settingsStore) {
    return DEFAULT_VOLUME
  }

  const storedVolume = settingsStore.get('playerVolume', DEFAULT_VOLUME)
  return normalizeVolume(storedVolume)
})

ipcMain.handle('settings:setVolume', async (event, volume) => {
  const normalizedVolume = normalizeVolume(volume)

  if (settingsStore) {
    settingsStore.set('playerVolume', normalizedVolume)
  }

  return normalizedVolume
})

ipcMain.handle('playlist:save', async (event, { playlist, currentTrackIndex }) => {
  if (!settingsStore) {
    return false
  }

  try {
    settingsStore.set('recentPlaylist', playlist || [])
    settingsStore.set('recentPlaylistIndex', currentTrackIndex || -1)
    return true
  } catch (error) {
    console.error('Failed to save playlist:', error)
    return false
  }
})

ipcMain.handle('playlist:load', async () => {
  if (!settingsStore) {
    return { playlist: [], currentTrackIndex: -1 }
  }

  try {
    const playlist = settingsStore.get('recentPlaylist', [])
    const currentTrackIndex = settingsStore.get('recentPlaylistIndex', -1)
    
    // Mark all restored playlist paths as allowed for reading
    if (Array.isArray(playlist)) {
      playlist.forEach((filePath) => markPathAsAllowed(filePath))
    }
    
    return { playlist, currentTrackIndex }
  } catch (error) {
    console.error('Failed to load playlist:', error)
    return { playlist: [], currentTrackIndex: -1 }
  }
})

ipcMain.handle('recent-tracks:save', async (event, tracks) => {
  if (!settingsStore) {
    return false
  }

  try {
    const maxRecent = 20
    const recentTracks = Array.isArray(tracks) ? tracks.slice(0, maxRecent) : []
    settingsStore.set('recentTracks', recentTracks)
    return true
  } catch (error) {
    console.error('Failed to save recent tracks:', error)
    return false
  }
})

ipcMain.handle('recent-tracks:load', async () => {
  if (!settingsStore) {
    return []
  }

  try {
    const recentTracks = settingsStore.get('recentTracks', [])
    
    // Mark all recent track paths as allowed for reading
    if (Array.isArray(recentTracks)) {
      recentTracks.forEach((track) => {
        if (track.filePath) {
          markPathAsAllowed(track.filePath)
        }
      })
    }
    
    return recentTracks
  } catch (error) {
    console.error('Failed to load recent tracks:', error)
    return []
  }
})


ipcMain.handle('file:readAudioFile', async (event, filePath) => {
  try {
    if (!isAllowedAudioPath(filePath)) {
      console.warn('Blocked readAudioFile for non-approved path:', filePath)
      return null
    }

    const extension = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(extension)) {
      console.warn('Blocked readAudioFile for unsupported extension:', extension)
      return null
    }

    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile()) {
      console.warn('Blocked readAudioFile for non-file path:', filePath)
      return null
    }

    if (stats.size > MAX_AUDIO_FILE_BYTES) {
      console.warn('Blocked readAudioFile due to file size limit:', {
        filePath,
        fileSize: stats.size,
        maxSize: MAX_AUDIO_FILE_BYTES,
      })
      return null
    }

    const data = await fs.promises.readFile(filePath)
    return Array.from(data)
  } catch (error) {
    console.error('Failed to read file:', error)
    return null
  }
})