const selectFileButton = document.getElementById('selectFile')
const openFolderButton = document.getElementById('selectFolder')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = window.audioService?.placeholderCover || './assets/music-placeholder.png'
let currentRoute = 'home'
const homeOnlyElements = [coverImage, trackTitle, trackArtist, selectFileButton, openFolderButton].filter(Boolean)
const routeCleanups = new Map()

const routeDefinitions = {
    home: {
        hostId: 'recent-music',
        filePath: './components/recent-music/recent-music.html',
        onLoad: () => {
            window.InitializeRecentMusic?.()
        },
    },
    library: {
        hostId: 'recent-music',
        filePath: './pages/library/library-layout.html',
        onLoad: () => {
            window.initializeLibraryPage?.()
        },
    },
    playlist: {
        hostId: 'recent-music',
        filePath: './pages/playlist/playlist-layout.html',
        onLoad: () => {
            window.initializePlaylistPage?.()
        },
    },
    queue: {
        hostId: 'recent-music',
        filePath: './pages/playlist/playlist-layout.html',
        onLoad: () => {
            window.initializePlaylistPage?.()
        },
    },
}

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
        "./components/sidebar/sidebar.html",
        () => {
            initializeSidebarRouting()
        }
    )

    await renderRoute('home')

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

function getRouteDefinition(routeName) {
    return routeDefinitions[routeName] || routeDefinitions.home
}

function registerRouteCleanup(routeName, cleanupFn) {
    if (!routeName || typeof cleanupFn !== 'function') {
        return
    }

    const previousCleanup = routeCleanups.get(routeName)
    if (typeof previousCleanup === 'function') {
        try {
            previousCleanup()
        } catch (error) {
            console.error('Failed to cleanup route resources:', error)
        }
    }

    routeCleanups.set(routeName, cleanupFn)
}

function cleanupInactiveRouteResources(activeRoute = null) {
    routeCleanups.forEach((cleanupFn, routeName) => {
        if (activeRoute && routeName === activeRoute) {
            return
        }

        if (typeof cleanupFn === 'function') {
            try {
                cleanupFn()
            } catch (error) {
                console.error('Failed to cleanup route resources:', error)
            }
        }

        routeCleanups.delete(routeName)
    })
}

function normalizeRouteName(routeName) {
    return routeDefinitions[routeName] ? routeName : 'home'
}

function cleanupAllRouteResources() {
    cleanupInactiveRouteResources(null)
}

window.addEventListener('beforeunload', () => {
    cleanupAllRouteResources()
}, { once: true })

async function renderRoute(routeName) {
    const route = normalizeRouteName(routeName || 'home')
    const routeDefinition = getRouteDefinition(route)

    currentRoute = route
    cleanupInactiveRouteResources(route)
    updateHomeVisibility(route)

    await loadComponent(
        routeDefinition.hostId,
        routeDefinition.filePath,
        routeDefinition.onLoad
    )
}

function updateHomeVisibility(route) {
    const isHome = route === 'home'

    homeOnlyElements.forEach((element) => {
        if (!element) {
            return
        }

        const hasPreviousDisplay = element.dataset.previousDisplay !== undefined

        if (isHome) {
            if (!hasPreviousDisplay) {
                element.style.removeProperty('display')
                return
            }

            const previousDisplay = element.dataset.previousDisplay
            if (previousDisplay) {
                element.style.display = previousDisplay
            } else {
                element.style.removeProperty('display')
            }

            delete element.dataset.previousDisplay
            return
        }

        if (!hasPreviousDisplay) {
            element.dataset.previousDisplay = element.style.display || ''
        }
        element.style.display = 'none'
    })
}

window.appRouter = {
    goTo: async (routeName) => {
        await renderRoute(routeName)
    },
    getCurrentRoute: () => currentRoute,
    registerCleanup: (routeName, cleanupFn) => {
        registerRouteCleanup(routeName, cleanupFn)
    },
    registerCurrentRouteCleanup: (cleanupFn) => {
        registerRouteCleanup(currentRoute, cleanupFn)
    },
}

function initializeSidebarRouting() {
    const sidebar = document.getElementById('sidebar')
    if (!sidebar) {
        return
    }

    const routeLinks = sidebar.querySelectorAll('[data-route]')
    routeLinks.forEach((link) => {
        link.addEventListener('click', async (event) => {
            event.preventDefault()
            const route = link.getAttribute('data-route') || 'home'
            await renderRoute(route)
        })
    })
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
    updateHomeVisibility('home')

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
            if (window.sessionService?.savePlaylist) {
                await window.sessionService.savePlaylist([], -1, 0)
            }
            return
        }

        audioService?.startPlaylist(files)
    } catch (error) {
        console.error('Failed to open folder or play playlist:', error)
    }
})

