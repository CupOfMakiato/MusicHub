import { playerState } from './state/player-state.js'
import { sessionService } from './services/session-service.js'
import { audioService } from './services/audio-service.js'
import { bindImageFallback } from './utils/dom-helpers.js'
import { initializeRecentMusic } from './components/recent-music/recent-music.js'
import { initializeLibraryPage } from './pages/library/library.js'
import { initializePlaylistPage } from './pages/playlist/playlist.js'
import { initializeQueuePage } from './pages/queue/queue.js'
import { initializePlayer } from './components/bottom-player/player.js'

const selectFileButton = document.getElementById('selectFile')
const openFolderButton = document.getElementById('selectFolder')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = audioService?.placeholderCover || './assets/music-placeholder.png'
let currentRoute = 'home'
const homeOnlyElements = [
    coverImage,
    trackTitle,
    trackArtist,
    selectFileButton,
    openFolderButton,
].filter(Boolean)
const routeCleanups = new Map()

const routeDefinitions = {
    home: {
        hostId: 'recent-music',
        filePath: './components/recent-music/recent-music.html',
        onLoad: () => {
            initializeRecentMusic()
        },
    },
    library: {
        hostId: 'recent-music',
        filePath: './pages/library/library-layout.html',
        onLoad: () => {
            initializeLibraryPage()
        },
    },
    playlist: {
        hostId: 'recent-music',
        filePath: './pages/playlist/playlist-layout.html',
        onLoad: () => {
            initializePlaylistPage()
        },
    },
    queue: {
        hostId: 'recent-music',
        filePath: './pages/queue/queue-layout.html',
        onLoad: () => {
            initializeQueuePage()
        },
    },
    about: {
        hostId: 'recent-music',
        filePath: './pages/about/about-layout.html',
        // onLoad: () => {
        //     initializeAboutPage()
        // },
    },
}

async function loadComponent(elementId, filePath, onLoadCallback = null) {
    const response = await fetch(filePath)
    const html = await response.text()
    const hostElement = document.getElementById(elementId)

    if (!hostElement) {
        console.error(`Component host not found: ${elementId}`)
        return
    }

    hostElement.innerHTML = html
    window.lucide?.createIcons()

    if (typeof onLoadCallback === 'function') {
        onLoadCallback()
    }
}

async function initUI() {
    await loadComponent('sidebar', './components/sidebar/sidebar.html', () => {
        initializeSidebarRouting()
    })

    await renderRoute('home')

    await loadComponent('bottom-player', './components/bottom-player/player.html', () => {
        initializePlayer()
    })
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

window.addEventListener(
    'beforeunload',
    () => {
        cleanupAllRouteResources()
    },
    { once: true },
)

async function renderRoute(routeName) {
    const route = normalizeRouteName(routeName || 'home')
    const routeDefinition = getRouteDefinition(route)

    currentRoute = route
    cleanupInactiveRouteResources(route)
    updateHomeVisibility(route)

    await loadComponent(routeDefinition.hostId, routeDefinition.filePath, routeDefinition.onLoad)
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
    const currentTrack = playerState.getState()?.currentTrack || {}
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
    bindImageFallback(coverImage)
}

function startStateSync() {
    updateTrackInfoFromState()
    let unsubscribe = null

    if (playerState?.subscribe) {
        unsubscribe = playerState.subscribe(() => {
            updateTrackInfoFromState()
        })
    }

    window.addEventListener(
        'beforeunload',
        () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe()
            }
        },
        { once: true },
    )
}

async function restoreSavedPlaylist() {
    try {
        const { playlist, currentTrackIndex, playbackPosition } =
            await sessionService.loadPlaylist()

        if (!playlist || playlist.length === 0) {
            return
        }

        playerState.setPlaylist(playlist)

        if (currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
            audioService.playTrackAtIndex(currentTrackIndex, {
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
    restoreSavedPlaylist()
})

selectFileButton?.addEventListener('click', async () => {
    try {
        const selectedFile = await window.electronAPI.selectAudioFile()

        if (!selectedFile) {
            return
        }

        audioService.startSingleTrack(selectedFile)
    } catch (error) {
        console.error('Failed to select or play audio file:', error)
    }
})

openFolderButton?.addEventListener('click', async () => {
    try {
        const selectedFolder = await window.electronAPI.openFolder()

        if (!selectedFolder) {
            return
        }

        const files = await window.electronAPI.getAudioFilesInFolder(selectedFolder)

        if (!Array.isArray(files) || files.length === 0) {
            playerState.setCurrentTrack({
                filePath: null,
                title: 'No audio files found',
                artist: 'Select another folder',
                image: placeholderCover,
            })
            playerState.setPlaylist([])
            playerState.setCurrentTrackIndex(-1)
            audioService.clearCurrentMusic()
            await sessionService.savePlaylist([], -1, 0)
            return
        }

        sessionService
            .prependRecentFolderPlaylist({
                folderPath: selectedFolder,
                tracks: files,
            })
            .catch((error) => {
                console.error('Failed to persist recent folder playlist:', error)
            })

        audioService.startPlaylist(files)
    } catch (error) {
        console.error('Failed to open folder or play playlist:', error)
    }
})

window.playerState = playerState
window.sessionService = sessionService
window.audioService = audioService
