const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav'])

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
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
  createWindow()
});

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

    return files
  } catch (error) {
    console.error('Failed to read folder audio files:', error)
    return []
  }
})


ipcMain.handle('file:readAudioFile', async (event, filePath) => {
  try {
    const data = await fs.promises.readFile(filePath)
    return Array.from(data)
  } catch (error) {
    console.error('Failed to read file:', error)
    return null
  }
})