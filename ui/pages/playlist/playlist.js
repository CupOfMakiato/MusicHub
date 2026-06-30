import { getDataAttributeIndex } from '../../utils/dom-helpers.js'
import { renderTrackRow } from './playlist-row-renderer.js'
import {
    canUsePlaylistVirtualizer,
    createPlaylistVirtualizer,
    loadPlaylistVirtualCore,
} from './playlist-virtualizer.js'
import {
    getPlaylistTrackFilePath,
    isPlaylistDurationPersisting,
    primePlaylistDurationCache,
} from './playlist-duration-cache.js'
import { isPlaylistArtworkPersisting, primePlaylistArtworkCache } from './playlist-artwork-cache.js'
import { attachUndoShortcut, detachUndoShortcut } from '../../services/undo-service.js'
import { extractPlaylistFilePaths } from '../../utils/playlist-media.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'
import { playerState } from '../../state/player-state.js'
import { createPlaylistScrollController } from './playlist-scroll.js'
import { createPlaylistDurationController } from './playlist-duration.js'
import { createPlaylistArtworkController } from './playlist-artwork.js'
import { createPlaylistActionsController } from './playlist-actions.js'
import { createPlaylistHeaderController } from './playlist-header.js'

const PLAYLIST_TRACK_ROW_HEIGHT = 60
const PLAYLIST_TRACK_OVERSCAN = 12
const PLAYLIST_VIRTUAL_ROW_CACHE_LIMIT = 240

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
    let virtualizer = null
    let activeRenderedMode = null
    let paddingTopRow = null
    let paddingBottomRow = null
    const virtualRowCache = new Map()
    let renderedTrackIndexes = new Set()
    let playbackSnapshot = playerState.getState()

    const playlistScroll = createPlaylistScrollController({
        trackContainer,
        image,
        getVirtualizer: () => virtualizer,
        onRender: () => {
            const activePlaylist = getActivePlaylist()
            if (activePlaylist) {
                renderTracks(activePlaylist, 'virtual-change')
            }
        },
    })
    const playlistDuration = createPlaylistDurationController({
        body,
        durationElement,
        getPlaylists: () => playlists,
        getActivePlaylist,
        isTrackRendered: (index) => renderedTrackIndexes.has(index),
        onDurationCellUpdate: (index, duration) => {
            const cached = virtualRowCache.get(index)
            if (cached) {
                cached.duration = duration
            }
        },
    })
    const playlistArtwork = createPlaylistArtworkController({
        getActivePlaylist,
        audioService,
    })
    const playlistActions = createPlaylistActionsController({
        body,
        getActivePlaylist,
        getPlaylists: () => playlists,
        onSave: savePlaylistsAndRender,
        onRender: render,
        audioService,
    })
    const playlistHeader = createPlaylistHeaderController({
        title,
        trackCountElement,
        durationElement,
        image,
        imageEditButton,
        getActivePlaylist,
        getPlaylists: () => playlists,
        onSave: savePlaylistsAndRender,
        audioService,
    })

    function renderPlayButtonIcon() {
        const existingIcon = playButton.querySelector('i')
        if (existingIcon) {
            existingIcon.setAttribute('data-lucide', 'play')
        }

        window.lucide?.createIcons({ nodes: [playButton] })
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
        {
            activeId = activePlaylistId,
            errorMessage = 'Failed to save playlists',
            renderOptions,
            renderAfterSave = true,
        } = {},
    ) {
        const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
        if (!saved) {
            console.error(errorMessage)
            return false
        }

        playlists = updatedPlaylists
        setActivePlaylistState(activeId)
        if (renderAfterSave) {
            render(renderOptions)
        }
        return true
    }

    function resetVirtualRows() {
        playlistDuration.cancelPendingDurationCellUpdates()
        playlistArtwork.cancelArtworkHydration()
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

        const normalizedTrack = playlistArtwork.buildTrackRecordForRender(track)
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

            const scrollMargin = playlistScroll.getScrollMargin({
                force: reason !== 'virtual-change',
            })
            if (!virtualizer) {
                virtualizer = createPlaylistVirtualizer({
                    count: tracks.length,
                    getScrollElement: playlistScroll.getScrollElement,
                    estimateSize: () => PLAYLIST_TRACK_ROW_HEIGHT,
                    overscan: PLAYLIST_TRACK_OVERSCAN,
                    scrollMargin,
                    initialOffset: playlistScroll.getScrollTop,
                    initialRect: {
                        width: trackContainer.clientWidth || window.innerWidth || 0,
                        height: playlistScroll.getViewportHeight(),
                    },
                    onChange: playlistScroll.scheduleRender,
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
                const duration = playlistDuration.getTrackDurationFromRecord(track)

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

            playlistArtwork.applyRowDecorations(createdRows)
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
                const normalizedTrack = playlistArtwork.buildTrackRecordForRender(track)
                const duration = playlistDuration.getTrackDurationFromRecord(normalizedTrack)
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
            playlistArtwork.applyRowDecorations(renderedRows)
        }

        applyNowPlayingHighlight()

        if (reason !== 'virtual-change') {
            playlistActions.attach()
        }
    }

    function render({ skipPlaylistArtworkHydration = false, skipTotalDuration = false } = {}) {
        const activePlaylist = getActivePlaylist()
        playlistHeader.render(activePlaylist, { hydrateArtwork: !skipPlaylistArtworkHydration })
        renderTracks(activePlaylist, 'route-render')
        if (skipTotalDuration) {
            playlistDuration.cancelTotalDuration()
        } else {
            playlistDuration.renderTotalDuration(activePlaylist)
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

    const onPlaylistsUpdated = () => {
        if (
            playlistActions.isSavingPlaylistOrder() ||
            playlistHeader.isSavingPlaylistImage() ||
            playlistHeader.isSavingPlaylistCover() ||
            playlistHeader.isSavingPlaylistName() ||
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
    playlistHeader.attachImageEditHandler()
    playlistHeader.attachTitleEditHandler()
    playlistScroll.observe()

    const cleanup = () => {
        playlistDuration.cancelTotalDuration()
        playlistArtwork.cancelArtworkHydration()
        if (typeof unsubscribePlayerState === 'function') {
            unsubscribePlayerState()
        }
        window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
        playlistScroll.cleanup()
        playlistHeader.cleanup()
        detachUndoShortcut()
        playlistActions.detach()
        if (virtualizer) {
            virtualizer.destroy?.()
            virtualizer = null
        }
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    hydrate()
}

window.initializePlaylistPage = initializePlaylistPage
