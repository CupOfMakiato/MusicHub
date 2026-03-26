const selectFileButton = document.getElementById('selectFile')
const openFolderButton = document.getElementById('selectFolder')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = './assets/music-placeholder.png'
let music = null
let playlist = []
let currentTrackIndex = -1

async function loadComponent(
  elementId,
  filePath
) {
  const response = await fetch(filePath);

  const html = await response.text();

  document.getElementById(
    elementId
  ).innerHTML = html;
  
  window.lucide?.createIcons();
}

function initUI() {
    loadComponent(
    "sidebar",
    "./components/sidebar/sidebar.html"
  );

    loadComponent(
    "bottom-player",
    "./components/bottom-player/player.html"
  );
}

initUI();


function toFileUrl(filePath) {
    if (!filePath) return null
    const normalizedPath = filePath.replace(/\\/g, '/')
    return encodeURI(`file://${normalizedPath}`)
}

function arrayBufferToBase64(data) {
    let binary = ''
    for (let i = 0; i < data.length; i += 1) {
        binary += String.fromCharCode(data[i])
    }
    return window.btoa(binary)
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

function getPictureDataUrl(picture) {
    if (!picture || !picture.data) return null

    const mimeType = normalizeImageMime(picture.format)
    const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data)
    return `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`
}

function getFileName(filePath) {
    if (!filePath) return 'Unknown Title'
    const segments = filePath.split(/\\|\//)
    return segments[segments.length - 1] || 'Unknown Title'
}

function updateTrackInfo({ title, artist, image }) {
    if (trackTitle) trackTitle.textContent = title || 'Unknown Title'
    if (trackArtist) trackArtist.textContent = artist || 'Unknown Artist'
    if (coverImage) {
        coverImage.src = image || placeholderCover
    }
}

if (coverImage) {
    coverImage.addEventListener('error', () => {
        coverImage.src = placeholderCover
    })
}

function readMetadata(filePath, fallbackTitle) {
    if (!window.jsmediatags) {
        console.warn('jsmediatags is not loaded')
        return
    }

    (async () => {
        try {
            const fileData = await window.electronAPI.readAudioFile(filePath)

            if (!fileData) {
                console.warn('Could not read file data')
                updateTrackInfo({
                    title: fallbackTitle,
                    artist: 'No metadata available',
                    image: null,
                })
                return
            }

            const uint8Array = new Uint8Array(fileData)
            const blob = new Blob([uint8Array], { type: 'audio/mpeg' })

            window.jsmediatags.read(blob, {
                onSuccess: (tag) => {
                    const album = tag.tags.album || 'Unknown Album'
                    const title = tag.tags.title || fallbackTitle || 'Unknown Title'
                    const artist = tag.tags.artist || 'Unknown Artist'
                    const musicImage = getPictureDataUrl(tag.tags.picture)
                    

                    updateTrackInfo({
                        title,
                        artist,
                        image: musicImage,
                    })

                    // console.log('Title:', title)
                    // console.log('Artist:', artist)
                    // console.log('Music Image:', musicImage)
                },
                onError: (error) => {
                    console.warn('Metadata not available for this file:', error)
                    updateTrackInfo({
                        title: fallbackTitle,
                        artist: 'No metadata available',
                        image: null,
                    })
                },
            })
        } catch (error) {
            console.warn('Metadata reader error:', error)
            updateTrackInfo({
                title: fallbackTitle,
                artist: 'No metadata available',
                image: null,
            })
        }
    })()
}

function clearCurrentMusic() {
    if (!music) return
    music.stop()
    music.unload()
    music = null
}

function playNextInQueue() {
    const nextIndex = currentTrackIndex + 1
    if (nextIndex >= playlist.length) {
        return
    }

    playTrackAtIndex(nextIndex)
}

function playTrackAtIndex(index) {
    if (!Array.isArray(playlist) || playlist.length === 0) {
        return
    }

    if (index < 0 || index >= playlist.length) {
        return
    }

    const selectedFile = playlist[index]
    const sourceFile = toFileUrl(selectedFile)
    const fallbackTitle = getFileName(selectedFile)

    currentTrackIndex = index
    updateTrackInfo({
        title: fallbackTitle,
        artist: 'Loading metadata...',
        image: null,
    })
    readMetadata(selectedFile, fallbackTitle)

    clearCurrentMusic()

    music = new window.Howl({
        src: [sourceFile],
        html5: true,
        volume: 0.5,
        onend: playNextInQueue,
    })

    music.play()
}

function startPlaylist(filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return
    }

    playlist = filePaths
    playTrackAtIndex(0)
}

selectFileButton?.addEventListener('click', async () => {
    try {
        const selectedFile = await window.electronAPI.selectAudioFile()

        if (!selectedFile) {
            console.log('No file selected')
            return
        }

        startPlaylist([selectedFile])
    } catch (error) {
        console.error('Failed to select or play audio file:', error)
    }
})

openFolderButton?.addEventListener('click', async () => {
    try {
        const selectedFolder = await window.electronAPI.openFolder()

        if (!selectedFolder) {
            console.log('No folder selected')
            return
        }

        const files = await window.electronAPI.getAudioFilesInFolder(selectedFolder)

        if (!Array.isArray(files) || files.length === 0) {
            updateTrackInfo({
                title: 'No audio files found',
                artist: 'Select another folder',
                image: null,
            })
            clearCurrentMusic()
            playlist = []
            currentTrackIndex = -1
            return
        }

        startPlaylist(files)
    } catch (error) {
        console.error('Failed to open folder or play playlist:', error)
    }
})

