import {
    getDataAttributeIndex,
    bindImageFallback,
    bindImageFallbacks,
} from '../../utils/dom-helpers.js'
import { createPlaylistSortable } from './playlist-sortable.js'
import { renderTrackRow } from './playlist-row-renderer.js'
import {
    canUsePlaylistVirtualizer,
    createPlaylistVirtualizer,
    loadPlaylistVirtualCore,
} from './playlist-virtualizer.js'
import {
    clearPlaylistDurationProbePromise,
    getPlaylistDurationProbePromise,
    getPlaylistTrackFilePath,
    getTrackDurationState,
    isPlaylistDurationPersisting,
    normalizeDurationValue,
    primePlaylistDurationCache,
    rememberPlaylistDuration,
    schedulePlaylistDurationPersist,
    setPlaylistDurationProbePromise,
} from './playlist-duration-cache.js'
import {
    clearTrackArtworkResolvePromise,
    getCachedTrackArtwork,
    getTrackArtworkResolvePromise,
    isPlaylistArtworkPersisting,
    normalizeArtworkValue,
    primePlaylistArtworkCache,
    rememberTrackArtwork,
    schedulePlaylistArtworkPersist,
    setTrackArtworkResolvePromise,
} from './playlist-artwork-cache.js'
import { pushUndo, attachUndoShortcut, detachUndoShortcut } from '../../services/undo-service.js'
import { formatDurationClock, formatDurationVerbose } from '../../utils/duration.js'
import { toFileUrl } from '../../utils/file-path.js'
import {
    DEFAULT_PLAYLIST_IMAGE,
    normalizePlaylistImageValue,
    resolvePlaylistImage,
    extractPlaylistFilePaths,
} from '../../utils/playlist-media.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'
import {
    hydrateImageWithPlaylistArtwork,
    hydrateImageWithTrackArtwork,
} from '../../utils/artwork.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'
import { playerState } from '../../state/player-state.js'

const PLAYLIST_TRACK_ROW_HEIGHT = 60
const PLAYLIST_TRACK_OVERSCAN = 12
const PLAYLIST_VIRTUAL_ROW_CACHE_LIMIT = 240
const PLAYLIST_DURATION_WORKERS = 4

function waitForPlaylistSkeletonPaint() {
    if (typeof window.requestAnimationFrame !== 'function') {
        return new Promise((resolve) => window.setTimeout(resolve, 0))
    }

    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.setTimeout(resolve, 0)
        })
    })
}

export function initializePlaylistPage() {
    const title = document.getElementById('playlistTitle')
    const trackCountElement = document.getElementById('playlistTrackCount')
    const durationElement = document.getElementById('playlistDuration')
    const image = document.getElementById('playlistImage')
    const imageEditButton = document.getElementById('playlistImageEditBtn')
    const body = document.getElementById('playlistTrackBody')
    const playButton = document.getElementById('playlistPlayBtn')
    const trackContainer = document.getElementById('playlistTrackContainer')

    if (
        !title ||
        !trackCountElement ||
        !durationElement ||
        !image ||
        !imageEditButton ||
        !body ||
        !playButton ||
        !trackContainer
    ) {
        return
    }

    let playlists = []
    let activePlaylistId = window.playlistViewState?.activePlaylistId || null
    let totalDurationRunId = 0
    let cleanupTrackActions = null
    let virtualizer = null
    let scrollRaf = null
    let sortableInstance = null
    let isSavingPlaylistOrder = false
    let isSavingPlaylistImage = false
    let isSavingPlaylistCover = false
    let cachedScrollMargin = null
    let playlistLayoutResizeObserver = null
    let trackActionsDelegated = false
    let activeRenderedMode = null
    let paddingTopRow = null
    let paddingBottomRow = null
    let durationCellsRaf = null
    let pendingDurationCellsRunId = null
    const pendingDurationCellIndexes = new Set()
    const pendingArtworkRows = new Set()
    const virtualRowCache = new Map()
    const playlistCoverSaveInFlight = new Set()
    let artworkHydrationHandle = null
    let artworkHydrationUsesIdleCallback = false
    let renderedTrackIndexes = new Set()
    let playbackSnapshot = playerState.getState()

    function getAppScrollElement() {
        return window.appScrollElement || document.getElementById('app-scroll') || window
    }

    function getAppScrollTop() {
        const scrollElement = getAppScrollElement()
        if (scrollElement === window) {
            return (document.scrollingElement || document.documentElement).scrollTop
        }

        return scrollElement.scrollTop
    }

    function getAppViewportHeight() {
        const scrollElement = getAppScrollElement()
        if (scrollElement === window) {
            return window.innerHeight || document.documentElement.clientHeight
        }

        return scrollElement.clientHeight
    }

    function getElementTopWithinAppScroll(element) {
        const scrollElement = getAppScrollElement()
        const scrollTop = getAppScrollTop()
        const elementRect = element.getBoundingClientRect()

        if (scrollElement === window) {
            return elementRect.top + scrollTop
        }

        const scrollRect = scrollElement.getBoundingClientRect()
        return elementRect.top - scrollRect.top + scrollTop
    }

    function getPlaylistContentScrollMargin({ force = false } = {}) {
        if (!force && cachedScrollMargin !== null) {
            return cachedScrollMargin
        }

        const table = trackContainer.querySelector('.playlistTrackTable')
        const thead = table?.querySelector('thead')
        const headerHeight = thead ? thead.getBoundingClientRect().height : 0

        cachedScrollMargin = getElementTopWithinAppScroll(trackContainer) + headerHeight
        return cachedScrollMargin
    }

    function invalidatePlaylistScrollMargin() {
        cachedScrollMargin = null
        if (virtualizer) {
            scheduleTrackRender()
        }
    }

    function observePlaylistLayoutForScrollMargin() {
        if (typeof ResizeObserver === 'function') {
            playlistLayoutResizeObserver = new ResizeObserver(invalidatePlaylistScrollMargin)
            ;[
                document.querySelector('.playlistHeader'),
                document.querySelector('.playlistControls'),
                trackContainer.querySelector('thead'),
            ].forEach((element) => {
                if (element) {
                    playlistLayoutResizeObserver.observe(element)
                }
            })
        }

        window.addEventListener('resize', invalidatePlaylistScrollMargin, { passive: true })
        image.addEventListener('load', invalidatePlaylistScrollMargin)
        image.addEventListener('error', invalidatePlaylistScrollMargin)
    }

    function scheduleTrackRender() {
        if (scrollRaf) {
            return
        }

        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = null
            const activePlaylist = getActivePlaylist()
            if (activePlaylist) {
                renderTracks(activePlaylist, 'virtual-change')
            }
        })
    }

    function renderPlayButtonIcon() {
        const existingIcon = playButton.querySelector('i')
        if (existingIcon) {
            existingIcon.setAttribute('data-lucide', 'play')
        }

        window.lucide?.createIcons({ nodes: [playButton] })
    }

    function probeAudioDuration(filePath) {
        return new Promise((resolve) => {
            const url = toFileUrl(filePath)
            if (!url) {
                resolve(null)
                return
            }

            const audio = new Audio()
            audio.preload = 'metadata'

            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', onLoadedMetadata)
                audio.removeEventListener('error', onError)
                audio.src = ''
            }

            const onLoadedMetadata = () => {
                const duration = Number(audio.duration)
                cleanup()
                resolve(Number.isFinite(duration) && duration > 0 ? duration : null)
            }

            const onError = () => {
                cleanup()
                resolve(null)
            }

            audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
            audio.addEventListener('error', onError, { once: true })
            audio.src = url
        })
    }

    async function resolveTrackDuration(track) {
        const knownDuration = getTrackDurationState(track)
        if (knownDuration.known) {
            return knownDuration.duration
        }

        const filePath = getPlaylistTrackFilePath(track)
        if (!filePath) {
            return null
        }

        const existingProbePromise = getPlaylistDurationProbePromise(filePath)
        if (existingProbePromise) {
            return existingProbePromise
        }

        const probePromise = probeAudioDuration(filePath)
            .then((duration) => {
                rememberPlaylistDuration(filePath, duration)
                clearPlaylistDurationProbePromise(filePath)

                if (normalizeDurationValue(duration) !== null) {
                    schedulePlaylistDurationPersist()
                }

                return duration
            })
            .catch((error) => {
                clearPlaylistDurationProbePromise(filePath)
                throw error
            })

        setPlaylistDurationProbePromise(filePath, probePromise)

        return probePromise
    }

    async function resolveTrackDurationsLimited(tracks, { concurrency = 8, onResolved } = {}) {
        if (!Array.isArray(tracks) || tracks.length === 0) {
            return []
        }

        const results = tracks.map((track) => getTrackDurationState(track).duration)
        const unresolvedIndexes = []
        tracks.forEach((track, index) => {
            if (!getTrackDurationState(track).known) {
                unresolvedIndexes.push(index)
            }
        })

        if (!unresolvedIndexes.length) {
            return results
        }

        let nextIndex = 0

        const workers = Array.from(
            { length: Math.min(concurrency, unresolvedIndexes.length) },
            async () => {
                while (nextIndex < unresolvedIndexes.length) {
                    const index = unresolvedIndexes[nextIndex]
                    nextIndex += 1

                    const duration = await resolveTrackDuration(tracks[index])
                    results[index] = duration
                    onResolved?.({ index, duration })

                    await new Promise((resolve) => setTimeout(resolve, 0))
                }
            },
        )

        await Promise.all(workers)
        return results
    }

    async function renderTotalDuration(activePlaylist) {
        if (
            !activePlaylist ||
            !Array.isArray(activePlaylist.tracks) ||
            activePlaylist.tracks.length === 0
        ) {
            totalDurationRunId += 1
            durationElement.textContent = ''
            return
        }

        const knownDurations = activePlaylist.tracks.map((track) => getTrackDurationState(track))
        if (knownDurations.every((duration) => duration.known)) {
            totalDurationRunId += 1
            cancelPendingDurationCellUpdates()
            const totalSeconds = knownDurations.reduce(
                (sum, value) => sum + (Number(value.duration) || 0),
                0,
            )
            durationElement.textContent = `, ${formatDurationVerbose(totalSeconds)}`
            return
        }

        durationElement.textContent = ', ...'
        const runId = ++totalDurationRunId
        const durations = await resolveTrackDurationsLimited(activePlaylist.tracks, {
            concurrency: PLAYLIST_DURATION_WORKERS,
            onResolved: (resolvedTrack) => {
                if (runId !== totalDurationRunId) {
                    return
                }

                rememberActivePlaylistTrackDuration(
                    activePlaylist.id,
                    resolvedTrack.index,
                    resolvedTrack.duration,
                )

                if (renderedTrackIndexes.has(resolvedTrack.index)) {
                    scheduleDurationCellUpdate(resolvedTrack.index, runId)
                }
            },
        })

        if (runId !== totalDurationRunId) {
            return
        }

        const totalSeconds = durations.reduce((sum, value) => sum + (Number(value) || 0), 0)
        durationElement.textContent = `, ${formatDurationVerbose(totalSeconds)}`
    }

    function getActivePlaylist() {
        return playlists.find((playlist) => playlist.id === activePlaylistId) || null
    }

    function findQueueStartIndex(playlistPaths, playbackQueue) {
        if (
            !playlistPaths.length ||
            !playbackQueue.length ||
            playbackQueue.length > playlistPaths.length
        ) {
            return -1
        }

        const normalizedQueue = playbackQueue.map(getPlaylistTrackFilePath)

        for (let start = 0; start <= playlistPaths.length - normalizedQueue.length; start++) {
            const isMatch = normalizedQueue.every((filePath, offset) => {
                return filePath && filePath === playlistPaths[start + offset]
            })

            if (isMatch) {
                return start
            }
        }

        return -1
    }

    function getNowPlayingTrackIndex(activePlaylist = getActivePlaylist()) {
        const tracks = Array.isArray(activePlaylist?.tracks) ? activePlaylist.tracks : []
        const playbackQueue = Array.isArray(playbackSnapshot?.playlist)
            ? playbackSnapshot.playlist
            : []
        const currentTrackIndex = Number.isInteger(playbackSnapshot?.currentTrackIndex)
            ? playbackSnapshot.currentTrackIndex
            : -1

        if (!tracks.length || !playbackQueue.length || currentTrackIndex < 0) {
            return -1
        }

        if (currentTrackIndex >= playbackQueue.length) {
            return -1
        }

        const playlistPaths = tracks.map(getPlaylistTrackFilePath)
        const queueStartIndex = findQueueStartIndex(playlistPaths, playbackQueue)

        if (queueStartIndex < 0) {
            return -1
        }

        return queueStartIndex + currentTrackIndex
    }

    function applyNowPlayingHighlight() {
        const nowPlayingTrackIndex = getNowPlayingTrackIndex()

        body.querySelectorAll('.playlistTrackRow').forEach((row) => {
            const rowTrackIndex = getDataAttributeIndex(row, 'data-track-index')
            const isNowPlaying = rowTrackIndex !== null && rowTrackIndex === nowPlayingTrackIndex

            row.classList.toggle('isNowPlaying', isNowPlaying)
            if (isNowPlaying) {
                row.setAttribute('aria-current', 'true')
            } else {
                row.removeAttribute('aria-current')
            }
        })
    }

    function setActivePlaylistState(nextActivePlaylistId) {
        activePlaylistId = nextActivePlaylistId || null
        window.playlistViewState = { activePlaylistId }
    }

    async function savePlaylistsAndRender(
        updatedPlaylists,
        { activeId = activePlaylistId, errorMessage = 'Failed to save playlists' } = {},
    ) {
        const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
        if (!saved) {
            console.error(errorMessage)
            return false
        }

        playlists = updatedPlaylists
        setActivePlaylistState(activeId)
        render()
        return true
    }

    function closeAllTrackMenus() {
        body.querySelectorAll('.playlistTrackMenu.is-open').forEach((menu) => {
            menu.classList.remove('is-open')
            menu.closest('.playlistTrackActions')?.classList.remove('is-menu-open')
            menu.closest('.playlistTrackActionsCell')?.classList.remove('is-menu-open')
            menu.closest('.playlistTrackRow')?.classList.remove('is-menu-open')
        })
    }

    function attachTrackActionHandlers() {
        if (trackActionsDelegated) return

        const onBodyClick = async (event) => {
            const menuButton = event.target.closest('.playlistTrackMoreBtn')
            if (menuButton && body.contains(menuButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(menuButton, 'data-track-index')
                if (trackIndex === null) {
                    return
                }

                const menu = body.querySelector(
                    `.playlistTrackMenu[data-track-index="${trackIndex}"]`,
                )
                if (!menu) {
                    return
                }

                const isOpen = menu.classList.contains('is-open')
                closeAllTrackMenus()
                if (!isOpen) {
                    menu.classList.add('is-open')
                    menu.closest('.playlistTrackActions')?.classList.add('is-menu-open')
                    menu.closest('.playlistTrackActionsCell')?.classList.add('is-menu-open')
                    menu.closest('.playlistTrackRow')?.classList.add('is-menu-open')
                }
                return
            }

            const removeButton = event.target.closest('.removeTrackBtn')
            if (removeButton && body.contains(removeButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(removeButton, 'data-track-index')
                const activePlaylist = getActivePlaylist()
                if (!activePlaylist || trackIndex === null) {
                    return
                }

                const nextTracks = Array.isArray(activePlaylist.tracks)
                    ? activePlaylist.tracks.filter((_, index) => index !== trackIndex)
                    : []

                const updatedPlaylists = playlists.map((playlist) => {
                    if (playlist.id !== activePlaylist.id) {
                        return playlist
                    }

                    return {
                        ...playlist,
                        tracks: nextTracks,
                        updatedAt: new Date().toISOString(),
                    }
                })

                await savePlaylistsAndRender(updatedPlaylists, {
                    activeId: activePlaylist.id,
                    errorMessage: 'Failed to save updated playlists when removing track',
                })
                return
            }

            const playButton = event.target.closest('.playlistTrackIndexPlayBtn')
            if (playButton && body.contains(playButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(playButton, 'data-track-index')
                const activePlaylist = getActivePlaylist()
                if (!activePlaylist || trackIndex === null) {
                    return
                }

                const queueFilePaths = Array.isArray(activePlaylist.tracks)
                    ? activePlaylist.tracks
                          .slice(trackIndex)
                          .map((track) => track?.filePath)
                          .filter(Boolean)
                    : []

                if (queueFilePaths.length) {
                    audioService.startPlaylist(queueFilePaths)
                }
            }
        }

        const onDocumentClick = () => {
            closeAllTrackMenus()
        }

        body.addEventListener('click', onBodyClick)
        document.addEventListener('click', onDocumentClick)
        cleanupTrackActions = () => {
            body.removeEventListener('click', onBodyClick)
            document.removeEventListener('click', onDocumentClick)
            trackActionsDelegated = false
        }
        trackActionsDelegated = true
    }

    function initializeSortableIfNeeded() {
        if (!body) return

        if (sortableInstance) return

        if (typeof createPlaylistSortable !== 'function') return

        try {
            sortableInstance = createPlaylistSortable({
                body,
                getActivePlaylist,
                getPlaylists: () => playlists,
                onReorder: async (updatedPlaylists) => {
                    const previousPlaylists = playlists.map((p) => ({
                        ...p,
                        tracks: Array.isArray(p.tracks) ? p.tracks.slice() : p.tracks,
                    }))

                    isSavingPlaylistOrder = true
                    try {
                        const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
                        if (!saved) {
                            console.error('Failed to save reordered playlist')
                            render({
                                skipPlaylistArtworkHydration: true,
                                skipTotalDuration: true,
                            })
                            return
                        }

                        pushUndo(
                            async () => {
                                isSavingPlaylistOrder = true
                                try {
                                    const undone =
                                        await sessionService.saveUserPlaylists(previousPlaylists)
                                    if (!undone) {
                                        console.error('Failed to undo playlist reorder')
                                        return
                                    }

                                    playlists = previousPlaylists
                                    setActivePlaylistState(
                                        getActivePlaylist()?.id || activePlaylistId,
                                    )
                                    render({
                                        skipPlaylistArtworkHydration: true,
                                        skipTotalDuration: true,
                                    })
                                } catch (err) {
                                    console.error('Error while undoing playlist reorder', err)
                                } finally {
                                    isSavingPlaylistOrder = false
                                }
                            },
                            { label: 'Undo playlist reorder' },
                        )

                        playlists = updatedPlaylists
                        setActivePlaylistState(getActivePlaylist()?.id || activePlaylistId)
                        render({
                            skipPlaylistArtworkHydration: true,
                            skipTotalDuration: true,
                        })
                    } catch (e) {
                        console.error('Failed to save reordered playlist', e)
                        render({
                            skipPlaylistArtworkHydration: true,
                            skipTotalDuration: true,
                        })
                        return
                    } finally {
                        isSavingPlaylistOrder = false
                    }
                },
            })
        } catch (err) {
            console.error('Failed to initialize Sortable', err)
        }
    }

    function rememberActivePlaylistTrackDuration(playlistId, trackIndex, duration) {
        const safeDuration = normalizeDurationValue(duration)
        if (!playlistId || !Number.isInteger(trackIndex) || safeDuration === null) {
            return
        }

        const activePlaylist = playlists.find((playlist) => playlist.id === playlistId)
        const track = activePlaylist?.tracks?.[trackIndex]
        const filePath = getPlaylistTrackFilePath(track)
        if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || !filePath) {
            return
        }

        if (normalizeDurationValue(track?.duration) === safeDuration) {
            return
        }

        const normalizedTrack = normalizeTrackRecord(track)
        if (!normalizedTrack || normalizedTrack.filePath !== filePath) {
            return
        }

        activePlaylist.tracks[trackIndex] = {
            ...normalizedTrack,
            duration: safeDuration,
        }
    }

    function getTrackDurationFromRecord(track) {
        return getTrackDurationState(track).duration
    }

    function updateDurationCell(index, duration) {
        const durationCell = body.querySelector(`td[data-duration-index="${index}"]`)
        if (durationCell) {
            durationCell.textContent = formatDurationClock(duration)
        }

        const cached = virtualRowCache.get(index)
        if (cached) {
            cached.duration = duration
        }
    }

    function cancelPendingDurationCellUpdates() {
        if (durationCellsRaf) {
            cancelAnimationFrame(durationCellsRaf)
            durationCellsRaf = null
        }
        pendingDurationCellsRunId = null
        pendingDurationCellIndexes.clear()
    }

    function scheduleDurationCellUpdate(trackIndex, runId) {
        if (runId !== totalDurationRunId) {
            return
        }

        if (pendingDurationCellsRunId !== runId) {
            cancelPendingDurationCellUpdates()
            pendingDurationCellsRunId = runId
        }

        if (Number.isInteger(trackIndex)) {
            pendingDurationCellIndexes.add(trackIndex)
        }

        if (durationCellsRaf) {
            return
        }

        durationCellsRaf = requestAnimationFrame(() => {
            durationCellsRaf = null
            if (runId !== totalDurationRunId) {
                pendingDurationCellsRunId = null
                pendingDurationCellIndexes.clear()
                return
            }
            renderDurationCellUpdates(Array.from(pendingDurationCellIndexes))
            pendingDurationCellsRunId = null
            pendingDurationCellIndexes.clear()
        })
    }

    function renderDurationCellUpdates(trackIndexes) {
        const activePlaylist = getActivePlaylist()
        trackIndexes.forEach((trackIndex) => {
            updateDurationCell(
                trackIndex,
                getTrackDurationFromRecord(activePlaylist?.tracks?.[trackIndex]),
            )
        })
    }

    function rememberActivePlaylistTrackArtwork(trackIndex, artwork) {
        const activePlaylist = getActivePlaylist()
        const image = normalizeArtworkValue(artwork)
        if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || !image) {
            return
        }

        const track = activePlaylist.tracks[trackIndex]
        const normalizedTrack = normalizeTrackRecord(track)
        if (!normalizedTrack?.filePath) {
            return
        }

        activePlaylist.tracks[trackIndex] = {
            ...normalizedTrack,
            image,
        }
    }

    function hydrateTrackArtworkRows(rows) {
        rows.forEach((row) => {
            const trackIndex = getDataAttributeIndex(row, 'data-track-index')
            const imageElement = row.querySelector('.playlistTrackCover')
            const activePlaylist = getActivePlaylist()
            const track = trackIndex === null ? null : activePlaylist?.tracks?.[trackIndex]
            if (!track || !imageElement) {
                return
            }

            const filePath = getPlaylistTrackFilePath(track)
            const cachedArtwork = getCachedTrackArtwork(track)
            if (cachedArtwork) {
                imageElement.src = cachedArtwork
                rememberActivePlaylistTrackArtwork(trackIndex, cachedArtwork)
                return
            }

            if (!filePath) {
                return
            }

            let artworkPromise = getTrackArtworkResolvePromise(filePath)
            if (!artworkPromise) {
                artworkPromise = hydrateImageWithTrackArtwork({
                    imageElement,
                    track,
                    audioService,
                })
                setTrackArtworkResolvePromise(filePath, artworkPromise)
            }

            artworkPromise
                .then((artwork) => {
                    clearTrackArtworkResolvePromise(filePath)
                    const image = rememberTrackArtwork(filePath, artwork)
                    if (!image) {
                        return
                    }

                    if (imageElement.isConnected) {
                        imageElement.src = image
                    }
                    rememberActivePlaylistTrackArtwork(trackIndex, image)
                    schedulePlaylistArtworkPersist()
                })
                .catch(() => {
                    clearTrackArtworkResolvePromise(filePath)
                })
        })
    }

    function buildTrackRecordForRender(track) {
        const normalizedTrack = normalizeTrackRecord(track)
        const cachedArtwork = getCachedTrackArtwork(normalizedTrack || track)

        if (!normalizedTrack || !cachedArtwork || normalizedTrack.image === cachedArtwork) {
            return normalizedTrack
        }

        return {
            ...normalizedTrack,
            image: cachedArtwork,
        }
    }

    function cancelPendingArtworkHydration() {
        if (artworkHydrationHandle !== null) {
            if (
                artworkHydrationUsesIdleCallback &&
                typeof window.cancelIdleCallback === 'function'
            ) {
                window.cancelIdleCallback(artworkHydrationHandle)
            } else {
                window.clearTimeout(artworkHydrationHandle)
            }
        }

        artworkHydrationHandle = null
        artworkHydrationUsesIdleCallback = false
        pendingArtworkRows.clear()
    }

    function flushPendingArtworkHydration() {
        artworkHydrationHandle = null
        artworkHydrationUsesIdleCallback = false

        const rows = Array.from(pendingArtworkRows).filter((row) => row.isConnected)
        pendingArtworkRows.clear()
        hydrateTrackArtworkRows(rows)
    }

    function scheduleTrackArtworkHydration(rows) {
        rows.forEach((row) => {
            if (row?.isConnected) {
                pendingArtworkRows.add(row)
            }
        })

        if (!pendingArtworkRows.size || artworkHydrationHandle !== null) {
            return
        }

        if (typeof window.requestIdleCallback === 'function') {
            artworkHydrationUsesIdleCallback = true
            artworkHydrationHandle = window.requestIdleCallback(flushPendingArtworkHydration, {
                timeout: 600,
            })
            return
        }

        artworkHydrationHandle = window.setTimeout(flushPendingArtworkHydration, 80)
    }

    function applyRowDecorations(rows) {
        if (!rows.length) {
            return
        }

        window.lucide?.createIcons({
            nodes: rows.flatMap((row) => Array.from(row.querySelectorAll('[data-lucide]'))),
        })
        rows.forEach((row) => {
            bindImageFallbacks({
                scope: row,
                selector: '.playlistTrackCover',
            })
        })
        scheduleTrackArtworkHydration(rows)
    }

    function resetVirtualRows() {
        cancelPendingDurationCellUpdates()
        cancelPendingArtworkHydration()
        virtualRowCache.clear()
        paddingTopRow = null
        paddingBottomRow = null
    }

    function syncBodyChildren(nodes) {
        let cursor = body.firstElementChild

        nodes.forEach((node) => {
            if (cursor === node) {
                cursor = cursor.nextElementSibling
                return
            }

            body.insertBefore(node, cursor)
        })

        while (body.children.length > nodes.length) {
            body.removeChild(body.lastElementChild)
        }
    }

    function renderPaddingRow(className, height) {
        const row = document.createElement('tr')
        row.className = className
        const cell = document.createElement('td')
        cell.colSpan = 7
        cell.style.height = `${height}px`
        row.appendChild(cell)
        return row
    }

    function ensurePaddingRow(row, className, height) {
        const paddingRow = row || renderPaddingRow(className, height)
        const cell = paddingRow.firstElementChild
        if (cell?.style.height !== `${height}px`) {
            cell.style.height = `${height}px`
        }
        return paddingRow
    }

    function getCachedVirtualRow({ index, track, duration, rowHeight }) {
        const cached = virtualRowCache.get(index)
        if (
            cached?.track === track &&
            cached.duration === duration &&
            cached.rowHeight === rowHeight
        ) {
            return { node: cached.node, created: false }
        }

        const normalizedTrack = buildTrackRecordForRender(track)
        const node = renderTrackRow({
            index,
            track,
            normalizedTrack,
            duration,
            rowHeight,
        })
        virtualRowCache.set(index, {
            track,
            duration,
            rowHeight,
            node,
        })

        return { node, created: true }
    }

    function trimVirtualRowCache(renderedIndexes) {
        if (virtualRowCache.size <= PLAYLIST_VIRTUAL_ROW_CACHE_LIMIT) {
            return
        }

        const rendered = Array.from(renderedIndexes)
        const anchor = rendered.length
            ? Math.round((Math.min(...rendered) + Math.max(...rendered)) / 2)
            : 0

        Array.from(virtualRowCache.keys())
            .filter((index) => !renderedIndexes.has(index))
            .sort((a, b) => Math.abs(b - anchor) - Math.abs(a - anchor))
            .slice(0, virtualRowCache.size - PLAYLIST_VIRTUAL_ROW_CACHE_LIMIT)
            .forEach((index) => virtualRowCache.delete(index))
    }

    function renderTracks(activePlaylist, reason = 'render') {
        const tracks = activePlaylist?.tracks || []

        if (!tracks.length) {
            resetVirtualRows()
            renderedTrackIndexes = new Set()
            activeRenderedMode = 'empty'
            body.innerHTML = ''
            const tr = document.createElement('tr')
            const td = document.createElement('td')
            td.colSpan = 7
            td.className = 'playlistEmptyRow'
            td.textContent = 'No tracks in this playlist yet.'
            tr.appendChild(td)
            body.appendChild(tr)
            applyNowPlayingHighlight()
            if (virtualizer && typeof virtualizer.setOptions === 'function') {
                virtualizer.setOptions({
                    ...virtualizer.options,
                    count: 0,
                })
            }
            return
        }

        if (tracks.length > 80 && canUsePlaylistVirtualizer()) {
            if (activeRenderedMode !== 'virtual') {
                resetVirtualRows()
                activeRenderedMode = 'virtual'
            }

            const scrollMargin = getPlaylistContentScrollMargin({
                force: reason !== 'virtual-change',
            })
            if (!virtualizer) {
                virtualizer = createPlaylistVirtualizer({
                    count: tracks.length,
                    getScrollElement: getAppScrollElement,
                    estimateSize: () => PLAYLIST_TRACK_ROW_HEIGHT,
                    overscan: PLAYLIST_TRACK_OVERSCAN,
                    scrollMargin,
                    initialOffset: getAppScrollTop,
                    initialRect: {
                        width: trackContainer.clientWidth || window.innerWidth || 0,
                        height: getAppViewportHeight(),
                    },
                    onChange: scheduleTrackRender,
                })
            } else if (typeof virtualizer.setOptions === 'function') {
                const options = virtualizer.options || {}
                if (options.count !== tracks.length || options.scrollMargin !== scrollMargin) {
                    virtualizer.setOptions({
                        ...options,
                        count: tracks.length,
                        scrollMargin,
                    })
                }
            }

            const virtualItems = virtualizer.getVirtualItems()
            const renderedNodes = []
            const createdRows = []
            const renderedIndexes = new Set()

            const firstVirtualItem = virtualItems[0]
            const lastVirtualItem = virtualItems[virtualItems.length - 1]
            const paddingTop = firstVirtualItem
                ? firstVirtualItem.index * PLAYLIST_TRACK_ROW_HEIGHT
                : 0
            const paddingBottom = lastVirtualItem
                ? (tracks.length - lastVirtualItem.index - 1) * PLAYLIST_TRACK_ROW_HEIGHT
                : 0

            if (paddingTop > 0) {
                paddingTopRow = ensurePaddingRow(paddingTopRow, 'virtual-padding-top', paddingTop)
                renderedNodes.push(paddingTopRow)
            } else {
                paddingTopRow = null
            }

            virtualItems.forEach((virtualItem) => {
                const index = virtualItem.index
                const track = tracks[index]
                const duration = getTrackDurationFromRecord(track)

                const rowResult = getCachedVirtualRow({
                    index,
                    track,
                    duration,
                    rowHeight: virtualItem.size,
                })
                renderedIndexes.add(index)
                renderedNodes.push(rowResult.node)
                if (rowResult.created) {
                    createdRows.push(rowResult.node)
                }
            })

            if (paddingBottom > 0) {
                paddingBottomRow = ensurePaddingRow(
                    paddingBottomRow,
                    'virtual-padding-bottom',
                    paddingBottom,
                )
                renderedNodes.push(paddingBottomRow)
            } else {
                paddingBottomRow = null
            }

            renderedTrackIndexes = renderedIndexes
            trimVirtualRowCache(renderedIndexes)

            syncBodyChildren(renderedNodes)

            applyRowDecorations(createdRows)
        } else {
            if (activeRenderedMode !== 'full') {
                resetVirtualRows()
                activeRenderedMode = 'full'
            }

            if (virtualizer?.destroy) {
                virtualizer.destroy()
            }
            virtualizer = null

            const fragment = document.createDocumentFragment()
            const renderedRows = []
            const nextRenderedTrackIndexes = new Set()
            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i]
                const normalizedTrack = buildTrackRecordForRender(track)
                const duration = getTrackDurationFromRecord(normalizedTrack)
                const row = renderTrackRow({
                    index: i,
                    track,
                    normalizedTrack,
                    duration,
                })

                renderedRows.push(row)
                nextRenderedTrackIndexes.add(i)
                fragment.appendChild(row)
            }

            renderedTrackIndexes = nextRenderedTrackIndexes
            body.replaceChildren(fragment)
            applyRowDecorations(renderedRows)
        }

        applyNowPlayingHighlight()

        if (reason !== 'virtual-change') {
            attachTrackActionHandlers()
            initializeSortableIfNeeded()
        }
    }

    async function persistPlaylistCoverIfMissing(playlistId, artwork) {
        const cover = normalizePlaylistImageValue(artwork)
        if (
            !playlistId ||
            !cover ||
            cover === DEFAULT_PLAYLIST_IMAGE ||
            playlistCoverSaveInFlight.has(playlistId)
        ) {
            return
        }

        const targetPlaylist = playlists.find((playlist) => playlist.id === playlistId)
        if (
            !targetPlaylist ||
            normalizePlaylistImageValue(targetPlaylist.banner) ||
            normalizePlaylistImageValue(targetPlaylist.cover)
        ) {
            return
        }

        const updatedPlaylists = playlists.map((playlist) =>
            playlist.id === playlistId
                ? {
                      ...playlist,
                      cover,
                  }
                : playlist,
        )

        playlistCoverSaveInFlight.add(playlistId)
        isSavingPlaylistCover = true
        try {
            const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
            if (saved) {
                playlists = updatedPlaylists
            }
        } catch (error) {
            console.error('Failed to save generated playlist cover', error)
        } finally {
            isSavingPlaylistCover = false
            playlistCoverSaveInFlight.delete(playlistId)
        }
    }

    function renderHeader(activePlaylist, { hydrateArtwork = true } = {}) {
        const renderHeaderIcon = () => {
            window.lucide?.createIcons({ nodes: [imageEditButton] })
        }

        if (!activePlaylist) {
            title.textContent = 'No playlist selected'
            trackCountElement.textContent = 'Choose a playlist from your library.'
            durationElement.textContent = ''
            imageEditButton.disabled = true
            bindImageFallback(image)
            image.src = './assets/music-placeholder.png'
            renderHeaderIcon()
            return
        }

        const playlistImage = resolvePlaylistImage(activePlaylist)
        title.textContent = activePlaylist.name || 'Untitled Playlist'
        const trackCount = activePlaylist.tracks?.length || 0
        trackCountElement.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`
        imageEditButton.disabled = false

        bindImageFallback(image)
        image.src = playlistImage
        if (hydrateArtwork) {
            hydrateImageWithPlaylistArtwork({
                imageElement: image,
                playlist: activePlaylist,
                audioService,
            })
                .then((artwork) => {
                    persistPlaylistCoverIfMissing(activePlaylist.id, artwork).catch(() => {})
                })
                .catch(() => {})
        }
        renderHeaderIcon()
    }

    function render({ skipPlaylistArtworkHydration = false, skipTotalDuration = false } = {}) {
        const activePlaylist = getActivePlaylist()
        renderHeader(activePlaylist, { hydrateArtwork: !skipPlaylistArtworkHydration })
        renderTracks(activePlaylist, 'route-render')
        if (skipTotalDuration) {
            totalDurationRunId += 1
            cancelPendingDurationCellUpdates()
        } else {
            renderTotalDuration(activePlaylist)
        }
        renderPlayButtonIcon()
    }

    async function hydrate() {
        try {
            window.loader?.show({ text: 'Loading playlists...', count: 8, variant: 'playlist' })
            await waitForPlaylistSkeletonPaint()
            try {
                await loadPlaylistVirtualCore()
            } catch (error) {
                console.error(
                    'Failed to load TanStack Virtual Core; using full playlist render',
                    error,
                )
            }

            const loadedPlaylists = await sessionService.loadUserPlaylists()

            playlists = Array.isArray(loadedPlaylists) ? loadedPlaylists : []
            primePlaylistDurationCache(playlists)
            primePlaylistArtworkCache(playlists)

            if (!activePlaylistId && playlists.length > 0) {
                activePlaylistId = playlists[0].id
            }

            if (
                activePlaylistId &&
                !playlists.some((playlist) => playlist.id === activePlaylistId)
            ) {
                activePlaylistId = playlists[0]?.id || null
            }

            setActivePlaylistState(activePlaylistId)

            render()

            window.loader?.hide()
        } catch (err) {
            console.error(err)

            window.loader?.setMessage('Failed to load playlist')
        }
    }

    playButton.addEventListener('click', () => {
        const activePlaylist = getActivePlaylist()
        const filePaths = extractPlaylistFilePaths(activePlaylist)
        if (!filePaths.length) {
            return
        }

        audioService.startPlaylist(filePaths)
    })

    imageEditButton.addEventListener('click', async () => {
        const activePlaylist = getActivePlaylist()
        if (!activePlaylist || typeof window.electronAPI?.selectImageFile !== 'function') {
            return
        }

        try {
            const selectedImagePath = await window.electronAPI.selectImageFile()
            const banner = toFileUrl(selectedImagePath)
            if (!banner) {
                return
            }

            const now = new Date().toISOString()
            const updatedPlaylists = playlists.map((playlist) => {
                if (playlist.id !== activePlaylist.id) {
                    return playlist
                }

                return {
                    ...playlist,
                    banner,
                    updatedAt: now,
                }
            })

            isSavingPlaylistImage = true
            await savePlaylistsAndRender(updatedPlaylists, {
                activeId: activePlaylist.id,
                errorMessage: 'Failed to save playlist image',
            })
        } catch (error) {
            console.error('Failed to update playlist image', error)
        } finally {
            isSavingPlaylistImage = false
        }
    })

    const onPlaylistsUpdated = () => {
        if (
            isSavingPlaylistOrder ||
            isSavingPlaylistImage ||
            isSavingPlaylistCover ||
            isPlaylistDurationPersisting() ||
            isPlaylistArtworkPersisting()
        ) {
            return
        }
        if (isRouteActive(['playlist', 'queue'])) {
            hydrate()
        }
    }
    const unsubscribePlayerState = playerState.subscribe((snapshot) => {
        playbackSnapshot = snapshot
        applyNowPlayingHighlight()
    })
    window.addEventListener('user-playlists:updated', onPlaylistsUpdated)
    attachUndoShortcut()
    observePlaylistLayoutForScrollMargin()

    const cleanup = () => {
        totalDurationRunId += 1
        cancelPendingDurationCellUpdates()
        cancelPendingArtworkHydration()
        if (typeof unsubscribePlayerState === 'function') {
            unsubscribePlayerState()
        }
        window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
        window.removeEventListener('resize', invalidatePlaylistScrollMargin)
        image.removeEventListener('load', invalidatePlaylistScrollMargin)
        image.removeEventListener('error', invalidatePlaylistScrollMargin)
        playlistLayoutResizeObserver?.disconnect()
        playlistLayoutResizeObserver = null
        detachUndoShortcut()
        if (sortableInstance && typeof sortableInstance.destroy === 'function') {
            try {
                sortableInstance.destroy()
            } catch (e) {
                console.error('Failed to destroy Sortable instance during cleanup', e)
            }
            sortableInstance = null
        }
        if (typeof cleanupTrackActions === 'function') {
            cleanupTrackActions()
            cleanupTrackActions = null
        }
        if (virtualizer) {
            if (scrollRaf) {
                cancelAnimationFrame(scrollRaf)
                scrollRaf = null
            }
            virtualizer.destroy?.()
            virtualizer = null
        }
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    hydrate()
}

window.initializePlaylistPage = initializePlaylistPage
