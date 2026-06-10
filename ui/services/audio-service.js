import { playerState as state } from '../state/player-state.js'
import { sessionService } from './session-service.js'
import { toFileUrl, getBaseName } from '../utils/file-path.js'

export const audioService = (() => {
    const DEFAULT_VOLUME = 0.7
    const METADATA_DEBUG_ENABLED = true
    const UNKNOWN_TITLE_LABEL = 'Unknown Title'
    const UNKNOWN_ARTIST_LABEL = 'Unknown Artist'
    const UNKNOWN_ALBUM_LABEL = 'Unknown Album'
    const Howl = window.Howl
    const Howler = window.Howler
    const METADATA_CACHE_LIMIT = 240
    const metadataCache = new Map()
    const artworkCache = new Map()
    const metadataInFlight = new Map()

    let currentSound = null
    let playbackPersistTimer = null

    function normalizeVolume(value) {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return DEFAULT_VOLUME
        return Math.max(0, Math.min(1, parsed))
    }

    function logMetadataDebug(filePath, phase, payload = {}) {
        if (!METADATA_DEBUG_ENABLED) return
        void filePath
        void phase
        void payload
        // console.log('[metadata-debug]', {
        //     phase,
        //     filePath,
        //     // fileName,
        //     ...payload,
        // })
    }

    function buildFallbackTrackData(filePath) {
        return {
            title: getBaseName(filePath),
            artist: UNKNOWN_ARTIST_LABEL,
            album: UNKNOWN_ALBUM_LABEL,
            image: null,
        }
    }

    function buildResolvedMetadataFromTags(rawTags, fallbackTitle) {
        return {
            title: rawTags?.title || fallbackTitle || UNKNOWN_TITLE_LABEL,
            artist: rawTags?.artist || UNKNOWN_ARTIST_LABEL,
            album: rawTags?.album || UNKNOWN_ALBUM_LABEL,
            image: rawTags?.image || null,
        }
    }

    function getMetadataErrorMessage(error) {
        return error?.info || error?.type || String(error || 'unknown error')
    }

    // function logResolvedMetadataDebug(filePath, fallbackTitle, rawTags, source) {
    //     logMetadataDebug(filePath, 'metadata-loaded', {
    //         fallbackTitle,
    //         source,
    //         title: rawTags?.title || null,
    //         artist: rawTags?.artist || null,
    //         album: rawTags?.album || null,
    //         year: rawTags?.year || null,
    //         genre: rawTags?.genre || null,
    //         track: rawTags?.track || null,
    //         disc: rawTags?.disc || null,
    //         hasPicture: Boolean(rawTags?.image),
    //         pictureFormat: rawTags?.pictureFormat || null,
    //         pictureBytes: rawTags?.pictureBytes || 0,
    //     })
    // }

    function rememberMetadata(filePath, metadata) {
        if (metadataCache.has(filePath)) {
            metadataCache.delete(filePath)
        }

        metadataCache.set(filePath, {
            ...metadata,
            image: null,
        })

        if (metadataCache.size <= METADATA_CACHE_LIMIT) {
            return
        }

        const oldestKey = metadataCache.keys().next().value
        if (oldestKey) {
            metadataCache.delete(oldestKey)
        }
    }

    function rememberArtwork(filePath, image) {
        if (artworkCache.has(filePath)) {
            artworkCache.delete(filePath)
        }

        artworkCache.set(filePath, image || '')

        if (artworkCache.size <= METADATA_CACHE_LIMIT) {
            return
        }

        const oldestKey = artworkCache.keys().next().value
        if (oldestKey) {
            artworkCache.delete(oldestKey)
        }
    }

    async function readMetadata(filePath, fallbackTitle, { includeImage = false } = {}) {
        if (!window.electronAPI?.readAudioMetadata) {
            logMetadataDebug(filePath, 'metadata-api-missing', {
                fallbackTitle,
            })
            return null
        }

        try {
            const rawTags = await window.electronAPI.readAudioMetadata(filePath, { includeImage })

            if (!rawTags) {
                logMetadataDebug(filePath, 'metadata-empty', {
                    fallbackTitle,
                    source: 'main-process',
                })
                return null
            }

            // logResolvedMetadataDebug(filePath, fallbackTitle, rawTags, 'main-process')
            return buildResolvedMetadataFromTags(rawTags, fallbackTitle)
        } catch (error) {
            logMetadataDebug(filePath, 'metadata-read-error', {
                fallbackTitle,
                source: 'main-process',
                error: getMetadataErrorMessage(error),
            })
            return null
        }
    }

    function stopPlaybackPersistTracking() {
        if (playbackPersistTimer) {
            window.clearInterval(playbackPersistTimer)
            playbackPersistTimer = null
        }
    }

    function savePlaybackSnapshot(positionOverride) {
        if (!state || !sessionService?.savePlaylist) return
        const { playlist, currentTrackIndex } = state.getState()
        if (!Array.isArray(playlist) || playlist.length === 0 || currentTrackIndex < 0) return

        const position = Number.isFinite(Number(positionOverride))
            ? Number(positionOverride)
            : Number(currentSound?.seek?.() || 0)

        const currentTrackPath = playlist[currentTrackIndex]
        let currentTrackOccurrence = 0
        if (currentTrackPath && Array.isArray(playlist)) {
            currentTrackOccurrence = playlist
                .slice(0, currentTrackIndex + 1)
                .reduce((count, filePath) => (filePath === currentTrackPath ? count + 1 : count), 0)
        }

        if (typeof sessionService.savePlaybackPosition === 'function') {
            sessionService.savePlaybackPosition(
                currentTrackIndex,
                Math.max(0, position),
                currentTrackPath,
                currentTrackOccurrence,
            )
            return
        }

        sessionService.savePlaylist(playlist, currentTrackIndex, Math.max(0, position))
    }

    function startPlaybackPersistTracking() {
        stopPlaybackPersistTracking()
        playbackPersistTimer = window.setInterval(() => {
            savePlaybackSnapshot()
        }, 1000)
    }

    async function resolveTrackMetadata(filePath, options = {}) {
        if (!filePath) {
            return buildFallbackTrackData(filePath)
        }

        const includeImage = options.includeImage === true
        if (!includeImage && metadataCache.has(filePath)) {
            return metadataCache.get(filePath)
        }

        if (includeImage && artworkCache.has(filePath)) {
            return {
                ...(metadataCache.get(filePath) || buildFallbackTrackData(filePath)),
                image: artworkCache.get(filePath) || null,
            }
        }

        const cacheKey = `${includeImage ? 'image' : 'text'}:${filePath}`
        if (metadataInFlight.has(cacheKey)) {
            return metadataInFlight.get(cacheKey)
        }

        const fallback = buildFallbackTrackData(filePath)
        const metadataPromise = readMetadata(filePath, fallback.title, { includeImage })
            .then((metadata) => {
                const safeMetadata = {
                    title: metadata?.title || fallback.title,
                    artist: metadata?.artist || fallback.artist,
                    album: metadata?.album || fallback.album,
                    image: includeImage ? metadata?.image || null : null,
                }
                rememberMetadata(filePath, safeMetadata)
                if (includeImage) {
                    rememberArtwork(filePath, safeMetadata.image)
                }
                metadataInFlight.delete(cacheKey)
                return safeMetadata
            })
            .catch((error) => {
                metadataInFlight.delete(cacheKey)
                logMetadataDebug(filePath, 'metadata-cache-error', { error: String(error) })
                return fallback
            })

        metadataInFlight.set(cacheKey, metadataPromise)
        return metadataPromise
    }

    function getTrackDisplayData(filePath) {
        if (!filePath) {
            return buildFallbackTrackData(filePath)
        }

        return metadataCache.get(filePath) || buildFallbackTrackData(filePath)
    }

    async function prewarmMetadataForNextTrack(currentIndex, playlist) {
        if (!Array.isArray(playlist)) {
            return
        }

        const nextFilePath = playlist[currentIndex + 1]
        if (!nextFilePath) {
            return
        }

        resolveTrackMetadata(nextFilePath, { includeImage: false }).catch(() => {
            // Ignore prewarm failures; playback should not be blocked by metadata.
        })
    }

    function clearCurrentMusic() {
        if (!currentSound) return
        currentSound.stop()
        currentSound.unload()
        currentSound = null
        stopPlaybackPersistTracking()
        if (state) {
            state.setIsPlaying(false)
            state.setProgress({ currentTime: 0, duration: 0, percent: 0 })
        }
    }

    function playNextInQueue() {
        if (!state) return
        const { currentTrackIndex, playlist } = state.getState()
        const nextIndex = currentTrackIndex + 1
        if (nextIndex >= playlist.length) {
            if (currentSound) {
                currentSound.stop()
                currentSound.unload()
                currentSound = null
            }
            stopPlaybackPersistTracking()
            state.setIsPlaying(false)
            state.setProgress({ currentTime: 0, duration: 0, percent: 0 })
            return
        }
        playTrackAtIndex(nextIndex)
    }

    async function playTrackAtIndex(index, options = {}) {
        if (!state) return
        const { playlist } = state.getState()
        if (index < 0 || index >= playlist.length) return
        const autoplay = options.autoplay !== false
        const addToRecentTracks = options.addToRecentTracks !== false
        const startAtSeconds = Math.max(0, Number(options.startAtSeconds) || 0)

        const filePath = playlist[index]
        const fallbackTrackData = metadataCache.get(filePath) || buildFallbackTrackData(filePath)

        state.setCurrentTrackIndex(index)
        state.setCurrentTrack(fallbackTrackData)

        // Save current track index and playlist
        sessionService?.savePlaylist(playlist, index, startAtSeconds)

        // Add to recent tracks
        if (addToRecentTracks && sessionService?.prependRecentTrack) {
            const recentTrack = {
                filePath,
                title: fallbackTrackData.title,
                artist: fallbackTrackData.artist,
                album: fallbackTrackData.album,
                image: fallbackTrackData.image,
                playedAt: new Date().toISOString(),
            }
            sessionService.prependRecentTrack(recentTrack).catch((error) => {
                console.error('Failed to update recent tracks:', error)
            })
        }

        if (currentSound) {
            savePlaybackSnapshot()
            stopPlaybackPersistTracking()
            try {
                currentSound.stop()
                if (typeof currentSound.unload === 'function') {
                    currentSound.unload()
                }
            } catch (err) {
                console.error('Error unloading previous Howl', err)
            }
            currentSound = null
        }

        const { volume } = state.getState()
        console.log('Playing track with volume:', volume)

        currentSound = new Howl({
            src: [toFileUrl(filePath)],
            html5: true,
            volume,
            onload: () => {
                if (startAtSeconds > 0 && currentSound) {
                    currentSound.seek(startAtSeconds)
                    const duration = currentSound.duration() || 0
                    const percent =
                        duration > 0 ? Math.min(100, (startAtSeconds / duration) * 100) : 0
                    state.setProgress({ currentTime: startAtSeconds, duration, percent })
                }
            },
            onplay: () => {
                state.setIsPlaying(true)
                startPlaybackPersistTracking()
            },
            onpause: () => {
                state.setIsPlaying(false)
                savePlaybackSnapshot()
                stopPlaybackPersistTracking()
            },
            onend: () => playNextInQueue(),
            onseek: () => {
                savePlaybackSnapshot()
            },
        })

        if (autoplay) {
            currentSound.play()
        } else {
            state.setIsPlaying(false)
            state.setProgress({ currentTime: startAtSeconds, percent: 0 })
        }

        // Resolve rich metadata in background so playback is not blocked by file reads/decoding.
        const expectedFilePath = filePath
        resolveTrackMetadata(filePath, { includeImage: true })
            .then((trackData) => {
                const { playlist: latestPlaylist, currentTrackIndex } = state.getState()
                const isSameTrack =
                    Array.isArray(latestPlaylist) &&
                    currentTrackIndex >= 0 &&
                    latestPlaylist[currentTrackIndex] === expectedFilePath

                if (isSameTrack) {
                    state.setCurrentTrack(trackData)
                }

                if (addToRecentTracks && sessionService?.prependRecentTrack && isSameTrack) {
                    sessionService.prependRecentTrack({
                        filePath: expectedFilePath,
                        title: trackData.title,
                        artist: trackData.artist,
                        album: trackData.album,
                        image: trackData.image,
                        playedAt: new Date().toISOString(),
                    })
                }
            })
            .catch(() => {
                // Metadata enrichment failure should not impact playback.
            })

        prewarmMetadataForNextTrack(index, playlist)
    }

    function togglePlayPause() {
        if (!currentSound) {
            const { playlist, currentTrackIndex } = state?.getState?.() || {}
            if (
                Array.isArray(playlist) &&
                currentTrackIndex >= 0 &&
                currentTrackIndex < playlist.length
            ) {
                playTrackAtIndex(currentTrackIndex, {
                    autoplay: true,
                    startAtSeconds: 0,
                    addToRecentTracks: false,
                })
            }
            return
        }
        if (currentSound.playing()) {
            currentSound.pause()
        } else {
            currentSound.play()
        }
    }

    // let isToggling = false;

    // function togglePlayPause() {
    // 	if (!music || isToggling) return;
    // 	isToggling = true;

    // 	if (music.playing()) {
    // 		music.pause();
    // 	} else {
    // 		music.play();
    // 	}

    // 	setTimeout(() => { isToggling = false; }, 300);
    // }

    function startPlaylist(filePaths) {
        if (!state) return
        if (!Array.isArray(filePaths) || filePaths.length === 0) return
        state.setPlaylist(filePaths)

        // Save playlist for next session
        sessionService?.savePlaylist(filePaths, 0)

        playTrackAtIndex(0)
    }

    function startSingleTrack(filePath) {
        if (!filePath) {
            return
        }

        startPlaylist([filePath])
    }

    function playPrevious() {
        if (!state) return
        const { currentTrackIndex } = state.getState()
        const prevIndex = currentTrackIndex - 1
        if (prevIndex >= 0) {
            playTrackAtIndex(prevIndex)
        }
    }

    function setVolume(volume) {
        const normalizedVolume = normalizeVolume(volume)
        if (Howler) {
            Howler.volume(normalizedVolume)
        }
        state.setVolume(normalizedVolume)

        sessionService?.saveVolume(normalizedVolume)
    }

    async function initializeVolumeFromStore() {
        if (!sessionService?.loadSavedVolume) {
            setVolume(DEFAULT_VOLUME)
            return
        }

        try {
            const savedVolume = await sessionService.loadSavedVolume()
            setVolume(savedVolume)
        } catch (error) {
            console.error('Failed to load saved volume:', error)
            setVolume(DEFAULT_VOLUME)
        }
    }

    initializeVolumeFromStore()

    window.addEventListener('beforeunload', () => {
        savePlaybackSnapshot()
        stopPlaybackPersistTracking()
        if (currentSound) {
            currentSound.unload()
            currentSound = null
        }
    })

    function getCurrentSound() {
        return currentSound
    }

    return {
        playTrackAtIndex,
        startPlaylist,
        startSingleTrack,
        togglePlayPause,
        playNext: playNextInQueue,
        playPrevious: () => {
            playPrevious()
        },
        setVolume,
        getCurrentSound,
        clearCurrentMusic,
        getTrackDisplayData,
        resolveTrackMetadata,
    }
})()

window.audioService = audioService
