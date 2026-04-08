const selectFileButton = document.getElementById('selectFile')
const openFolderButton = document.getElementById('selectFolder')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = window.audioService?.placeholderCover || './assets/music-placeholder.png'

async function loadComponent(
  elementId,
  filePath,
  onLoadCallback = null
) {
    const response = await fetch(filePath)
    const html = await response.text()
    const hostElement = document.getElementById(elementId)

    if (!hostElement) {
        console.error(`Component host not found: ${elementId}`)
        return
    }

    hostElement.innerHTML = html
  
    window.lucide?.createIcons()
  
  if (onLoadCallback && typeof onLoadCallback === 'function') {
        onLoadCallback()
  }
}

async function initUI() {
        await loadComponent(
    "sidebar",
        "./components/sidebar/sidebar.html"
    )

        await loadComponent(
    "recent-music",
        "./components/recent-music/recent-music.html",
        () => {
            if (window.InitializeRecentMusic) {
                        window.InitializeRecentMusic()
            }
        }
    )

        await loadComponent(
    "bottom-player",
        "./components/bottom-player/player.html",
        () => {
            if (window.initializePlayer) {
                window.initializePlayer()
            }
        }
    )
}

function updateTrackInfoFromState() {
    const currentTrack = playerState?.getState()?.currentTrack || {}
    const title = currentTrack.title
    const artist = currentTrack.artist
    const image = currentTrack.image

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

function startStateSync() {
    updateTrackInfoFromState()
    let unsubscribe = null

    if (window.playerState?.subscribe) {
        unsubscribe = window.playerState.subscribe(() => {
            updateTrackInfoFromState()
        })
    }

    window.addEventListener('beforeunload', () => {
        if (typeof unsubscribe === 'function') {
            unsubscribe()
        }
    }, { once: true })
}

async function restoreSavedPlaylist() {
    try {
        if (!window.sessionService?.loadPlaylist) {
            console.log('loadPlaylist not available from sessionService')
            return
        }

        const { playlist, currentTrackIndex, playbackPosition } = await window.sessionService.loadPlaylist()

        if (!playlist || playlist.length === 0) {
            console.log('No saved playlist to restore')
            return
        }

        console.log('Restoring saved playlist with', playlist.length, 'tracks')
        playerState?.setPlaylist(playlist)

        if (currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
            console.log('Restoring track at index', currentTrackIndex, 'paused at', playbackPosition, 'seconds')
            audioService?.playTrackAtIndex(currentTrackIndex, {
                autoplay: false,
                startAtSeconds: playbackPosition,
                addToRecentTracks: false,
            })
        }
    } catch (error) {
        console.error('Failed to restore saved playlist:', error)
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initUI()
    startStateSync()

    // Restore playlist from previous session
    restoreSavedPlaylist()
})

selectFileButton?.addEventListener('click', async () => {
    try {
        const selectedFile = await window.electronAPI.selectAudioFile()

        if (!selectedFile) {
            console.log('No file selected')
            return
        }

        audioService?.startPlaylist([selectedFile])
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
            playerState?.setCurrentTrack({
                filePath: null,
                title: 'No audio files found',
                artist: 'Select another folder',
                image: placeholderCover,
            })
            playerState?.setPlaylist([])
            playerState?.setCurrentTrackIndex(-1)
            audioService?.clearCurrentMusic()
            return
        }

        audioService?.startPlaylist(files)
    } catch (error) {
        console.error('Failed to open folder or play playlist:', error)
    }
})

