import {
    attachIndexedMenuToggle,
    getDataAttributeIndex,
    bindImageFallback,
    bindImageFallbacks,
} from '../../utils/dom-helpers.js'
import { createPlaylistSortable } from './playlist-sortable.js'
import { renderTrackRow } from './playlist-row-renderer.js'
import { pushUndo, attachUndoShortcut, detachUndoShortcut } from '../../services/undo-service.js'
//formatDate in rowrederer
import { formatDurationClock, formatDurationVerbose } from '../../utils/duration.js'
import { toFileUrl } from '../../utils/file-path.js'
import { resolvePlaylistImage, extractPlaylistFilePaths } from '../../utils/playlist-media.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'

const { createVirtualizer } =
    (typeof window !== 'undefined' &&
        (window.TanStackVirtualCore || window.tanstackVirtualCore || window.TanStackVirtual)) ||
    {}

export function initializePlaylistPage() {
    const title = document.getElementById('playlistTitle')
    const trackCountElement = document.getElementById('playlistTrackCount')
    const durationElement = document.getElementById('playlistDuration')
    const image = document.getElementById('playlistImage')
    const body = document.getElementById('playlistTrackBody')
    const playButton = document.getElementById('playlistPlayBtn')
    const trackContainer = document.getElementById('playlistTrackContainer')

    if (
        !title ||
        !trackCountElement ||
        !durationElement ||
        !image ||
        !body ||
        !playButton ||
        !trackContainer
    ) {
        return
    }

    let playlists = []
    let activePlaylistId = window.playlistViewState?.activePlaylistId || null
    const durationCache = new Map()
    const durationProbePromises = new Map()
    let durationProbeRunId = 0
    let totalDurationRunId = 0
    let cleanupTrackMenuToggles = null
    let virtualizer = null
    let virtualizerScrollHandler = null
    let scrollRaf = null
    let sortableInstance = null
    let isSavingPlaylistOrder = false

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
        if (typeof track?.duration === 'number' && track.duration > 0) {
            return track.duration
        }

        const filePath = track?.filePath
        if (!filePath) {
            return null
        }

        if (durationCache.has(filePath)) {
            return durationCache.get(filePath)
        }

        if (durationProbePromises.has(filePath)) {
            return durationProbePromises.get(filePath)
        }

        const probePromise = probeAudioDuration(filePath)
            .then((duration) => {
                durationCache.set(filePath, duration)
                durationProbePromises.delete(filePath)
                return duration
            })
            .catch((error) => {
                durationProbePromises.delete(filePath)
                throw error
            })

        durationProbePromises.set(filePath, probePromise)

        return probePromise
    }

    async function hydrateTrackDurations(activePlaylist) {
        const runId = ++durationProbeRunId
        if (
            !activePlaylist ||
            !Array.isArray(activePlaylist.tracks) ||
            activePlaylist.tracks.length === 0
        ) {
            return
        }

        const results = await Promise.all(
            activePlaylist.tracks.map(async (track, index) => {
                const duration = await resolveTrackDuration(track)
                return { index, duration }
            }),
        )

        if (runId !== durationProbeRunId) {
            return
        }

        results.forEach(({ index, duration }) => {
            const durationCell = body.querySelector(`td[data-duration-index="${index}"]`)
            if (durationCell) {
                durationCell.textContent = formatDurationClock(duration)
            }
        })
    }

    async function renderTotalDuration(activePlaylist) {
        if (
            !activePlaylist ||
            !Array.isArray(activePlaylist.tracks) ||
            activePlaylist.tracks.length === 0
        ) {
            durationElement.textContent = ''
            return
        }

        durationElement.textContent = ', ...'
        const runId = ++totalDurationRunId
        const durations = await Promise.all(
            activePlaylist.tracks.map((track) => resolveTrackDuration(track)),
        )

        if (runId !== totalDurationRunId) {
            return
        }

        const totalSeconds = durations.reduce((sum, value) => sum + (Number(value) || 0), 0)
        durationElement.textContent = `, ${formatDurationVerbose(totalSeconds)}`
    }

    function getActivePlaylist() {
        return playlists.find((playlist) => playlist.id === activePlaylistId) || null
    }

    function attachTrackActionHandlers(scopeElement) {
        if (!scopeElement) return

        const removeButtons = scopeElement.querySelectorAll('.removeTrackBtn')
        removeButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(button, 'data-track-index')
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

                const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
                if (!saved) {
                    console.error('Failed to save updated playlists when removing track')
                    return
                }

                playlists = updatedPlaylists
                activePlaylistId = activePlaylist.id
                window.playlistViewState = { activePlaylistId }
                render()
            })
        })

        const indexPlayButtons = scopeElement.querySelectorAll('.playlistTrackIndexPlayBtn')
        indexPlayButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(button, 'data-track-index')
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

                if (!queueFilePaths.length) {
                    return
                }

                audioService.startPlaylist(queueFilePaths)
            })
        })
    }

    function initializeSortableIfNeeded() {
        if (!body) return

        if (sortableInstance && typeof sortableInstance.destroy === 'function') {
            try {
                sortableInstance.destroy()
            } catch (e) {
                console.error('Failed to destroy existing Sortable instance', e)
            }
            sortableInstance = null
        }

        if (typeof createPlaylistSortable !== 'function') return

        const usingNonLocalVirtualizer = !!virtualizer && !virtualizer.local
        if (usingNonLocalVirtualizer) return

        try {
            sortableInstance = createPlaylistSortable({
                body,
                getActivePlaylist,
                getPlaylists: () => playlists,
                onReorder: async (updatedPlaylists) => {
                    // capture previous state for undo
                    const previousPlaylists = playlists.map((p) => ({
                        ...p,
                        tracks: Array.isArray(p.tracks) ? p.tracks.slice() : p.tracks,
                    }))

                    isSavingPlaylistOrder = true
                    try {
                        const saved = await sessionService.saveUserPlaylists(updatedPlaylists)
                        if (!saved) {
                            console.error('Failed to save reordered playlist')
                            render()
                            return
                        }

                        // push undo action (closure uses previousPlaylists)
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
                                    activePlaylistId = getActivePlaylist()?.id || activePlaylistId
                                    window.playlistViewState = { activePlaylistId }
                                    render()
                                } catch (err) {
                                    console.error('Error while undoing playlist reorder', err)
                                } finally {
                                    isSavingPlaylistOrder = false
                                }
                            },
                            { label: 'Undo playlist reorder' },
                        )

                        playlists = updatedPlaylists
                        activePlaylistId = getActivePlaylist()?.id || activePlaylistId
                        window.playlistViewState = { activePlaylistId }
                        render()
                    } catch (e) {
                        console.error('Failed to save reordered playlist', e)
                        render()
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

    function renderTracks(activePlaylist) {
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }

        const tracks = activePlaylist?.tracks || []

        if (!tracks.length) {
            // Render a single empty-row node instead of string HTML
            body.innerHTML = ''
            const tr = document.createElement('tr')
            const td = document.createElement('td')
            td.colSpan = 7
            td.className = 'playlistEmptyRow'
            td.textContent = 'No tracks in this playlist yet.'
            tr.appendChild(td)
            body.appendChild(tr)
            if (virtualizer && typeof virtualizer.setOptions === 'function') {
                virtualizer.setOptions({
                    ...virtualizer.options,
                    count: 0,
                })
            }
            return
        }

        const canVirtualize = typeof createVirtualizer === 'function'

        // Build rows as DOM nodes into a DocumentFragment
        const fragment = document.createDocumentFragment()

        if (canVirtualize) {
            if (!virtualizer) {
                virtualizer = createVirtualizer({
                    count: tracks.length,
                    // use the page scrollbar as the scroll element so the app scrollbar controls the list
                    getScrollElement: () => document.scrollingElement || document.documentElement,
                    estimateSize: () => 56,
                    overscan: 10,
                })

                virtualizerScrollHandler = () => {
                    virtualizer.measure()
                    if (scrollRaf) cancelAnimationFrame(scrollRaf)
                    scrollRaf = requestAnimationFrame(() => {
                        const ap = getActivePlaylist()
                        if (ap) renderTracks(ap)
                    })
                }
                window.addEventListener('scroll', virtualizerScrollHandler, { passive: true })
                window.addEventListener('resize', virtualizerScrollHandler, { passive: true })
            } else if (typeof virtualizer.setOptions === 'function') {
                virtualizer.setOptions({
                    ...virtualizer.options,
                    count: tracks.length,
                })
            }

            const virtualItems = virtualizer.getVirtualItems()

            const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
            const paddingBottom =
                virtualItems.length > 0
                    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
                    : 0

            if (paddingTop > 0) {
                const trTop = document.createElement('tr')
                trTop.className = 'virtual-padding-top'
                const tdTop = document.createElement('td')
                tdTop.colSpan = 7
                tdTop.style.height = `${paddingTop}px`
                trTop.appendChild(tdTop)
                fragment.appendChild(trTop)
            }

            virtualItems.forEach((virtualItem) => {
                const index = virtualItem.index
                const track = tracks[index]
                const normalizedTrack = normalizeTrackRecord(track)
                const duration =
                    typeof normalizedTrack?.duration === 'number' &&
                    normalizedTrack.duration > 0
                        ? normalizedTrack.duration
                        : durationCache.get(normalizedTrack?.filePath)

                const rowNode = renderTrackRow({ index, track, duration, rowHeight: virtualItem.size })
                fragment.appendChild(rowNode)
            })

            if (paddingBottom > 0) {
                const trBottom = document.createElement('tr')
                trBottom.className = 'virtual-padding-bottom'
                const tdBottom = document.createElement('td')
                tdBottom.colSpan = 7
                tdBottom.style.height = `${paddingBottom}px`
                trBottom.appendChild(tdBottom)
                fragment.appendChild(trBottom)
            }
        } else {
            // Local virtualization fallback: compute visible window based on page scroll
            const ROW_ESTIMATE = 56
            const OVERSCAN = 8

            const table = trackContainer.querySelector('.playlistTrackTable')
            const thead = table?.querySelector('thead')
            let lastStart = -1
            let lastEnd = -1

            function computeVirtualRange() {
                const scrollTop = (document.scrollingElement || document.documentElement).scrollTop
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight
                const containerRect = trackContainer.getBoundingClientRect()
                const containerTop = containerRect.top + scrollTop
                const headerHeight = thead ? thead.getBoundingClientRect().height : 0
                const contentStart = containerTop + headerHeight

                let start = Math.floor((scrollTop - contentStart) / ROW_ESTIMATE) - OVERSCAN
                let end = Math.ceil((scrollTop - contentStart + viewportHeight) / ROW_ESTIMATE) + OVERSCAN

                if (start < 0) start = 0
                if (end < 0) end = 0
                if (start > tracks.length - 1) start = tracks.length - 1
                if (end > tracks.length - 1) end = tracks.length - 1

                if (start === lastStart && end === lastEnd) return null
                lastStart = start
                lastEnd = end

                const paddingTop = start * ROW_ESTIMATE
                const paddingBottom = Math.max(0, (tracks.length - end - 1) * ROW_ESTIMATE)

                return { start, end, paddingTop, paddingBottom }
            }

            // initial render range
            const range = computeVirtualRange()
            if (range) {
                const { start, end, paddingTop, paddingBottom } = range

                if (paddingTop > 0) {
                    const trTop = document.createElement('tr')
                    trTop.className = 'virtual-padding-top'
                    const tdTop = document.createElement('td')
                    tdTop.colSpan = 7
                    tdTop.style.height = `${paddingTop}px`
                    trTop.appendChild(tdTop)
                    fragment.appendChild(trTop)
                }

                for (let i = start; i <= end; i++) {
                    const track = tracks[i]
                    const normalizedTrack = normalizeTrackRecord(track)
                    const duration =
                        typeof normalizedTrack?.duration === 'number' &&
                        normalizedTrack.duration > 0
                            ? normalizedTrack.duration
                            : durationCache.get(normalizedTrack?.filePath)

                    const rowNode = renderTrackRow({ index: i, track, duration })
                    fragment.appendChild(rowNode)
                }

                if (paddingBottom > 0) {
                    const trBottom = document.createElement('tr')
                    trBottom.className = 'virtual-padding-bottom'
                    const tdBottom = document.createElement('td')
                    tdBottom.colSpan = 7
                    tdBottom.style.height = `${paddingBottom}px`
                    trBottom.appendChild(tdBottom)
                    fragment.appendChild(trBottom)
                }
            }

            // attach scroll/resize handler to update visible range
            if (!virtualizer) {
                virtualizer = { local: true }

                virtualizerScrollHandler = () => {
                    if (scrollRaf) cancelAnimationFrame(scrollRaf)
                    scrollRaf = requestAnimationFrame(() => {
                        const freshActivePlaylist = getActivePlaylist()
                        if (freshActivePlaylist) {
                            renderTracks(freshActivePlaylist)
                        }
                    })
                }

                window.addEventListener('scroll', virtualizerScrollHandler, { passive: true })
                window.addEventListener('resize', virtualizerScrollHandler, { passive: true })
            }
        }

        // replace tbody content with constructed fragment
        body.innerHTML = ''
        body.appendChild(fragment)

        hydrateTrackDurations(activePlaylist)
        window.lucide?.createIcons()
        bindImageFallbacks({
            scope: body,
            selector: '.playlistTrackCover',
        })

        cleanupTrackMenuToggles = attachIndexedMenuToggle({
            scope: body,
            triggerSelector: '.playlistTrackMoreBtn',
            menuSelector: '.playlistTrackMenu',
            indexAttribute: 'data-track-index',
        })

        attachTrackActionHandlers(body)
        initializeSortableIfNeeded()
    }

    function renderHeader(activePlaylist) {
        if (!activePlaylist) {
            title.textContent = 'No playlist selected'
            trackCountElement.textContent = 'Choose a playlist from your library.'
            durationElement.textContent = ''
            bindImageFallback(image)
            image.src = './assets/music-placeholder.png'
            return
        }

        const playlistImage = resolvePlaylistImage(activePlaylist)
        title.textContent = activePlaylist.name || 'Untitled Playlist'
        const trackCount = activePlaylist.tracks?.length || 0
        trackCountElement.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`

        bindImageFallback(image)
        image.src = playlistImage
    }

    function render() {
        const activePlaylist = getActivePlaylist()
        renderHeader(activePlaylist)
        renderTracks(activePlaylist)
        renderTotalDuration(activePlaylist)
        renderPlayButtonIcon()
    }

    async function waitForDurations() {
        const activePlaylist = getActivePlaylist()

        if (!activePlaylist?.tracks) return

        const concurrency = 10
        const queue = [...activePlaylist.tracks]

        const workers = Array.from({ length: concurrency }, async () => {
            while (queue.length) {
                const track = queue.shift()

                await resolveTrackDuration(track)

                await new Promise((r) => setTimeout(r, 0))
            }
        })

        await Promise.all(workers)
    }

    async function hydrate() {
        try {
            window.loader?.show('Loading playlists...')

            const loadedPlaylists = await sessionService.loadUserPlaylists()

            playlists = Array.isArray(loadedPlaylists) ? loadedPlaylists : []

            // window.loader?.setMessage('Preparing playlist...')

            if (!activePlaylistId && playlists.length > 0) {
                activePlaylistId = playlists[0].id
            }

            if (
                activePlaylistId &&
                !playlists.some((playlist) => playlist.id === activePlaylistId)
            ) {
                activePlaylistId = playlists[0]?.id || null
            }

            window.playlistViewState = {
                activePlaylistId,
            }

            render()

            // window.loader?.setMessage('Finalizing...')

            waitForDurations()

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
        if (isSavingPlaylistOrder) return
        if (isRouteActive(['playlist', 'queue'])) {
            hydrate()
        }
    }
    window.addEventListener('user-playlists:updated', onPlaylistsUpdated)
    // Attach global undo shortcut for this page (Ctrl/Cmd+Z)
    attachUndoShortcut()

    const cleanup = () => {
        window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
        detachUndoShortcut()
        if (sortableInstance && typeof sortableInstance.destroy === 'function') {
            try {
                sortableInstance.destroy()
            } catch (e) {
                console.error('Failed to destroy Sortable instance during cleanup', e)
            }
            sortableInstance = null
        }
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }
        if (virtualizer) {
            if (virtualizerScrollHandler) {
                window.removeEventListener('scroll', virtualizerScrollHandler)
                window.removeEventListener('resize', virtualizerScrollHandler)
                virtualizerScrollHandler = null
            }
            if (scrollRaf) {
                cancelAnimationFrame(scrollRaf)
                scrollRaf = null
            }
            virtualizer = null
        }
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    hydrate()
}

window.initializePlaylistPage = initializePlaylistPage
