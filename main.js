// Node.js process entry point - responsible for creating the application window, handling IPC events, managing settings persistence, and enforcing security around file system access

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron')
const jsmediatags = require('jsmediatags')
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav'])
const MAX_AUDIO_FILE_BYTES = Number(process.env.MAX_AUDIO_FILE_BYTES || 100 * 1024 * 1024)
const MAX_METADATA_IMAGE_BYTES = Number(process.env.MAX_METADATA_IMAGE_BYTES || 5 * 1024 * 1024)
const MAX_FOLDER_STAT_WORKERS = Number(process.env.MAX_FOLDER_STAT_WORKERS || 32)
const ARTWORK_THUMBNAIL_SIZE = Number(process.env.ARTWORK_THUMBNAIL_SIZE || 1024)
const ARTWORK_CACHE_VERSION = 'v2'
const DEFAULT_VOLUME = 0.7
let settingsStore = null
const allowedAudioPaths = new Set()
const approvedAudioDirectories = new Set()
let memoryLogInterval = null

// if (process.env.ELECTRON_DISABLE_HARDWARE_ACCELERATION === '1') {
app.disableHardwareAcceleration()
// }

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

function persistApprovedPaths() {
    if (!settingsStore) {
        return
    }

    settingsStore.set('approvedAudioPaths', Array.from(allowedAudioPaths))
    settingsStore.set('approvedAudioDirectories', Array.from(approvedAudioDirectories))
}

function markDirectoryAsApproved(directoryPath) {
    const normalized = normalizeFilePath(directoryPath)
    if (normalized) {
        approvedAudioDirectories.add(normalized)
        persistApprovedPaths()
    }
}

function isPathUnderApprovedDirectory(filePath) {
    const normalizedFilePath = normalizeFilePath(filePath)
    if (!normalizedFilePath) return false

    for (const approvedDirectory of approvedAudioDirectories) {
        if (normalizedFilePath === approvedDirectory) {
            return true
        }

        if (normalizedFilePath.startsWith(`${approvedDirectory}${path.sep}`)) {
            return true
        }
    }

    return false
}
//open link in browser insteda
function postConfigure(window) {
    window.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
        const isExternal = !url.startsWith(window.webContents.getURL())
        if (isExternal) {
            event.preventDefault()
            shell.openExternal(url)
        }
    })
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

function normalizePlaybackPosition(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, parsed)
}

async function getApprovedAudioFileStats(filePath, actionName) {
    if (!isAllowedAudioPath(filePath) && !isPathUnderApprovedDirectory(filePath)) {
        console.warn(`Blocked ${actionName} for non-approved path:`, filePath)
        return null
    }

    const extension = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(extension)) {
        console.warn(`Blocked ${actionName} for unsupported extension:`, extension)
        return null
    }

    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile()) {
        console.warn(`Blocked ${actionName} for non-file path:`, filePath)
        return null
    }

    if (stats.size > MAX_AUDIO_FILE_BYTES) {
        console.warn(`Blocked ${actionName} due to file size limit:`, {
            filePath,
            fileSize: stats.size,
            maxSize: MAX_AUDIO_FILE_BYTES,
        })
        return null
    }

    return stats
}

function normalizeMetadataTagValue(value) {
    if (value === undefined || value === null) {
        return null
    }

    if (Array.isArray(value)) {
        return value.map((item) => String(item)).join(', ')
    }

    return String(value)
}

function normalizeImageMime(format) {
    const normalized = (format || 'image/jpeg').toLowerCase()

    if (normalized.includes('/')) {
        return normalized
    }

    if (normalized === 'jpg') {
        return 'image/jpeg'
    }

    return `image/${normalized}`
}

async function ensureArtworkCacheDirectory() {
    const directory = path.join(app.getPath('userData'), 'artwork-cache')
    await fs.promises.mkdir(directory, { recursive: true })
    return directory
}

function getArtworkCacheKey({ filePath, stats, pictureFormat }) {
    return crypto
        .createHash('sha1')
        .update(
            [
                filePath,
                Number(stats?.mtimeMs || 0),
                Number(stats?.size || 0),
                pictureFormat || '',
                ARTWORK_THUMBNAIL_SIZE,
                ARTWORK_CACHE_VERSION,
            ].join('|'),
        )
        .digest('hex')
}

async function writeArtworkThumbnail({ buffer, filePath, stats, pictureFormat }) {
    if (!buffer?.length || buffer.length > MAX_METADATA_IMAGE_BYTES) {
        return null
    }

    const cacheDirectory = await ensureArtworkCacheDirectory()
    const cachePath = path.join(
        cacheDirectory,
        `${getArtworkCacheKey({ filePath, stats, pictureFormat })}.png`,
    )

    try {
        await fs.promises.access(cachePath, fs.constants.R_OK)
        return pathToFileURL(cachePath).href
    } catch {
        // Cache miss; generate below.
    }

    const sourceImage = nativeImage.createFromBuffer(buffer)
    if (!sourceImage || sourceImage.isEmpty()) {
        return null
    }

    const sourceSize = sourceImage.getSize()
    const largestSide = Math.max(sourceSize.width || 0, sourceSize.height || 0)
    if (!largestSide) {
        return null
    }

    const scale = Math.min(1, ARTWORK_THUMBNAIL_SIZE / largestSide)
    const thumbnail = sourceImage.resize({
        width: Math.max(1, Math.round(sourceSize.width * scale)),
        height: Math.max(1, Math.round(sourceSize.height * scale)),
        quality: 'best',
    })

    await fs.promises.writeFile(cachePath, thumbnail.toPNG())
    return pathToFileURL(cachePath).href
}

async function normalizeMetadataPicture(picture, { filePath, stats } = {}) {
    if (!picture?.data) {
        return {
            image: null,
            pictureFormat: null,
            pictureBytes: 0,
        }
    }

    let buffer = null
    if (Array.isArray(picture.data)) {
        buffer = Buffer.from(picture.data)
    } else if (picture.data instanceof Uint8Array) {
        buffer = Buffer.from(picture.data)
    } else if (picture.data instanceof ArrayBuffer) {
        buffer = Buffer.from(new Uint8Array(picture.data))
    }

    if (!buffer?.length) {
        return {
            image: null,
            pictureFormat: null,
            pictureBytes: 0,
        }
    }

    const pictureFormat = normalizeImageMime(picture.format)
    return {
        image: await writeArtworkThumbnail({
            buffer,
            filePath,
            stats,
            pictureFormat,
        }),
        pictureFormat,
        pictureBytes: buffer.length,
    }
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length)
    let nextIndex = 0
    const safeConcurrency = Number.isFinite(Number(concurrency))
        ? Math.floor(Number(concurrency))
        : 1
    const workerCount = Math.min(Math.max(1, safeConcurrency), items.length)

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex
            nextIndex += 1
            results[index] = await mapper(items[index], index)
        }
    })

    await Promise.all(workers)
    return results
}

async function normalizeAudioMetadataTags(
    tags = {},
    { includeImage = true, filePath = '', stats = null } = {},
) {
    const picture = includeImage
        ? await normalizeMetadataPicture(tags.picture, { filePath, stats })
        : {
              image: null,
              pictureFormat: null,
              pictureBytes: 0,
          }
    const metadata = {
        title: normalizeMetadataTagValue(tags.title),
        artist: normalizeMetadataTagValue(tags.artist),
        album: normalizeMetadataTagValue(tags.album),
        year: normalizeMetadataTagValue(tags.year),
        genre: normalizeMetadataTagValue(tags.genre),
        track: normalizeMetadataTagValue(tags.track),
        disc: normalizeMetadataTagValue(tags.disc),
        image: picture.image,
        pictureFormat: picture.pictureFormat,
        pictureBytes: picture.pictureBytes,
    }

    const hasMetadata = Boolean(
        metadata.title ||
        metadata.artist ||
        metadata.album ||
        metadata.year ||
        metadata.genre ||
        metadata.track ||
        metadata.disc ||
        metadata.image,
    )

    return hasMetadata ? metadata : null
}

function readAudioMetadata(filePath, options = {}) {
    return new Promise((resolve) => {
        jsmediatags.read(filePath, {
            onSuccess: async (tag) => {
                try {
                    resolve(
                        await normalizeAudioMetadataTags(tag?.tags || {}, {
                            ...options,
                            filePath,
                        }),
                    )
                } catch (error) {
                    console.warn('Failed to normalize audio metadata:', {
                        filePath,
                        error: String(error?.message || error || 'unknown error'),
                    })
                    resolve(null)
                }
            },
            onError: (error) => {
                console.warn('Failed to read audio metadata:', {
                    filePath,
                    error: error?.info || error?.type || String(error || 'unknown error'),
                })
                resolve(null)
            },
        })
    })
}

function findNthOccurrenceIndex(items, targetValue, targetOccurrence) {
    if (!Array.isArray(items) || targetOccurrence < 1) {
        return -1
    }

    let occurrenceCount = 0
    for (let index = 0; index < items.length; index += 1) {
        if (items[index] !== targetValue) {
            continue
        }

        occurrenceCount += 1
        if (occurrenceCount === targetOccurrence) {
            return index
        }
    }

    return -1
}

const createWindow = () => {
    const appIcon = getAppIconPath()
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        minWidth: 890, // changing this abit
        minHeight: 670, // true size is 567 for some reason lel
        useContentSize: true,
        icon: appIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: true,
        },
        autoHideMenuBar: true,
    })

    // debug in dev
    win.loadFile('ui/index.html')
    if (app.isPackaged === false && process.env.ELECTRON_OPEN_DEVTOOLS !== '0') {
        win.webContents.openDevTools()
    }
    win.on('ready-to-show', () => {
        win.show()
    })
    postConfigure(win)
}
// Watch for changes to index.html and trigger re-render in renderer process
app.on('re-render', () => {
    app.loadFile('ui/index.html')
})

app.whenReady()
    .then(async () => {
        if (process.platform === 'win32') {
            app.setAppUserModelId('com.makiato.musichub')
        }

        const { default: Store } = await import('electron-store')
        settingsStore = new Store({
            name: 'settings',
            defaults: {
                playerVolume: DEFAULT_VOLUME,
                recentPlaylist: [],
                recentPlaylistIndex: -1,
                recentPlaybackPosition: 0,
                recentTracks: [],
                approvedAudioPaths: [],
                approvedAudioDirectories: [],
            },
        })

        const storedApprovedPaths = settingsStore.get('approvedAudioPaths', [])
        if (Array.isArray(storedApprovedPaths)) {
            storedApprovedPaths.forEach((filePath) => markPathAsAllowed(filePath))
        }

        const storedApprovedDirectories = settingsStore.get('approvedAudioDirectories', [])
        if (Array.isArray(storedApprovedDirectories)) {
            storedApprovedDirectories.forEach((directoryPath) =>
                markDirectoryAsApproved(directoryPath),
            )
        }

        createWindow()

        if (process.env.ELECTRON_MEMORY_LOG === '1') {
            memoryLogInterval = setInterval(() => {
                const usage = process.memoryUsage()
                console.log('Memory usage (MB):', {
                    rss: Math.round(usage.rss / 1024 / 1024),
                    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
                    external: Math.round(usage.external / 1024 / 1024),
                })
            }, 15000)
        }
    })
    .catch((error) => {
        console.error('Failed during app startup:', error)
        app.quit()
    })

app.on('before-quit', () => {
    if (memoryLogInterval) {
        clearInterval(memoryLogInterval)
        memoryLogInterval = null
    }
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
    persistApprovedPaths()

    return result.filePaths[0]
})

ipcMain.handle('dialog:openImageFile', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            {
                name: 'Image Files',
                extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
            },
        ],
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

    markDirectoryAsApproved(result.filePaths[0])
    persistApprovedPaths()

    return result.filePaths[0]
})

ipcMain.handle('folder:getAudioFiles', async (event, folderPath) => {
    try {
        if (!isPathUnderApprovedDirectory(folderPath)) {
            console.warn('Blocked folder:getAudioFiles for non-approved folder:', folderPath)
            return []
        }

        const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
        const audioPaths = entries
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(folderPath, entry.name))
            .filter((filePath) => AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
        const filesWithDates = (
            await mapWithConcurrency(audioPaths, MAX_FOLDER_STAT_WORKERS, async (filePath) => {
                const stats = await fs.promises.stat(filePath)
                return {
                    filePath,
                    createdAt: stats.birthtimeMs,
                }
            })
        ).filter(Boolean)

        // play files in order they were added to the folder
        const files = filesWithDates
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((item) => item.filePath)

        files.forEach((filePath) => {
            if (isPathUnderApprovedDirectory(filePath)) {
                markPathAsAllowed(filePath)
            }
        })

        persistApprovedPaths()

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

ipcMain.handle(
    'playlist:save',
    async (event, { playlist, currentTrackIndex, playbackPosition }) => {
        if (!settingsStore) {
            return false
        }

        try {
            const approvedPlaylist = Array.isArray(playlist)
                ? playlist.filter((filePath) => isAllowedAudioPath(filePath))
                : []
            const currentTrackPath =
                Array.isArray(playlist) && Number.isInteger(currentTrackIndex)
                    ? playlist[currentTrackIndex]
                    : null
            const currentTrackOccurrence =
                currentTrackPath && Array.isArray(playlist)
                    ? playlist
                          .slice(0, currentTrackIndex + 1)
                          .reduce(
                              (count, filePath) =>
                                  filePath === currentTrackPath ? count + 1 : count,
                              0,
                          )
                    : 0
            const approvedCurrentTrackIndex =
                currentTrackPath && isAllowedAudioPath(currentTrackPath)
                    ? findNthOccurrenceIndex(
                          approvedPlaylist,
                          currentTrackPath,
                          currentTrackOccurrence,
                      )
                    : -1

            settingsStore.set('recentPlaylist', approvedPlaylist)
            settingsStore.set('recentPlaylistIndex', approvedCurrentTrackIndex)
            settingsStore.set(
                'recentPlaybackPosition',
                approvedCurrentTrackIndex >= 0 ? normalizePlaybackPosition(playbackPosition) : 0,
            )
            return true
        } catch (error) {
            console.error('Failed to save playlist:', error)
            return false
        }
    },
)

ipcMain.handle(
    'playlist:savePlaybackPosition',
    async (event, { currentTrackIndex, playbackPosition }) => {
        if (!settingsStore) {
            return false
        }

        try {
            const playlist = settingsStore.get('recentPlaylist', [])
            const approvedCurrentTrackIndex =
                Number.isInteger(currentTrackIndex) &&
                Array.isArray(playlist) &&
                currentTrackIndex >= 0 &&
                currentTrackIndex < playlist.length
                    ? currentTrackIndex
                    : -1

            settingsStore.set('recentPlaylistIndex', approvedCurrentTrackIndex)
            settingsStore.set(
                'recentPlaybackPosition',
                approvedCurrentTrackIndex >= 0 ? normalizePlaybackPosition(playbackPosition) : 0,
            )
            return true
        } catch (error) {
            console.error('Failed to save playback position:', error)
            return false
        }
    },
)

ipcMain.handle('playlist:load', async () => {
    if (!settingsStore) {
        return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
    }

    try {
        const playlist = settingsStore.get('recentPlaylist', [])
        const currentTrackIndex = settingsStore.get('recentPlaylistIndex', -1)
        const playbackPosition = normalizePlaybackPosition(
            settingsStore.get('recentPlaybackPosition', 0),
        )

        return { playlist, currentTrackIndex, playbackPosition }
    } catch (error) {
        console.error('Failed to load playlist:', error)
        return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
    }
})

ipcMain.handle('recent-tracks:save', async (event, tracks) => {
    if (!settingsStore) {
        return false
    }

    try {
        const maxRecent = 10
        const recentTracks = Array.isArray(tracks)
            ? tracks
                  .filter((track) => track && isAllowedAudioPath(track.filePath))
                  .slice(0, maxRecent)
            : []
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

        return recentTracks
    } catch (error) {
        console.error('Failed to load recent tracks:', error)
        return []
    }
})

ipcMain.handle('file:approveRecentAudioPath', async (event, filePath) => {
    try {
        const normalizedPath = normalizeFilePath(filePath)
        if (!normalizedPath) {
            return false
        }

        const recentPlaylist = settingsStore?.get('recentPlaylist', [])
        const recentTracks = settingsStore?.get('recentTracks', [])
        const isKnownRecentPath = [recentPlaylist, recentTracks].some((collection) => {
            if (!Array.isArray(collection)) {
                return false
            }

            return collection.some((item) => {
                if (typeof item === 'string') {
                    return normalizeFilePath(item) === normalizedPath
                }

                return item?.filePath && normalizeFilePath(item.filePath) === normalizedPath
            })
        })

        if (!isKnownRecentPath && !isPathUnderApprovedDirectory(normalizedPath)) {
            console.warn('Blocked approval for unknown recent audio path:', filePath)
            return false
        }

        markPathAsAllowed(normalizedPath)
        persistApprovedPaths()
        return true
    } catch (error) {
        console.error('Failed to approve recent audio path:', error)
        return false
    }
})

ipcMain.handle('file:readAudioMetadata', async (event, payload) => {
    try {
        const filePath =
            typeof payload === 'string'
                ? payload
                : typeof payload?.filePath === 'string'
                  ? payload.filePath
                  : ''
        const options =
            payload && typeof payload === 'object' && typeof payload.options === 'object'
                ? payload.options
                : {}

        const stats = await getApprovedAudioFileStats(filePath, 'readAudioMetadata')
        if (!stats) {
            return null
        }

        return await readAudioMetadata(filePath, {
            includeImage: options.includeImage !== false,
            stats,
        })
    } catch (error) {
        console.error('Failed to read audio metadata:', error)
        return null
    }
})
