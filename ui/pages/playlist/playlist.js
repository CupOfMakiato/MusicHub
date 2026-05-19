import {
    escapeHtml,
    attachIndexedMenuToggle,
    getDataAttributeIndex,
    bindImageFallback,
    bindImageFallbacks,
} from '../../utils/dom-helpers.js'
import { formatDate } from '../../utils/date.js'
import { formatDurationClock, formatDurationVerbose } from '../../utils/duration.js'
import { toFileUrl } from '../../utils/file-path.js'
import {
    resolvePlaylistImage,
    extractPlaylistFilePaths,
    resolveTrackImage,
} from '../../utils/playlist-media.js'
import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
    DEFAULT_TRACK_ALBUM,
} from '../../utils/track-record.js'
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

    function renderTracks(activePlaylist) {
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }

        const tracks = activePlaylist?.tracks || []

        if (!tracks.length) {
            body.innerHTML =
                '<tr><td colspan="7" class="playlistEmptyRow">No tracks in this playlist yet.</td></tr>'
            if (virtualizer && typeof virtualizer.setOptions === 'function') {
                virtualizer.setOptions({
                    ...virtualizer.options,
                    count: 0,
                })
            }
            return
        }

        const canVirtualize = typeof createVirtualizer === 'function'

        let html = ''

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

            html +=
                paddingTop > 0
                    ? `<tr class="virtual-padding-top"><td colspan="7" style="height: ${paddingTop}px"></td></tr>`
                    : ''

            html += virtualItems
                .map((virtualItem) => {
                    const index = virtualItem.index
                    const track = tracks[index]
                    const normalizedTrack = normalizeTrackRecord(track)
                    const trackTitle = normalizedTrack?.title || DEFAULT_TRACK_TITLE
                    const artist = normalizedTrack?.artist || DEFAULT_TRACK_ARTIST
                    const album = normalizedTrack?.album || DEFAULT_TRACK_ALBUM
                    const trackImage =
                        resolveTrackImage(normalizedTrack) || './assets/music-placeholder.png'
                    const dateAdded = formatDate(
                        normalizedTrack?.playedAt || normalizedTrack?.addedAt,
                    )
                    const duration =
                        typeof normalizedTrack?.duration === 'number' &&
                        normalizedTrack.duration > 0
                            ? normalizedTrack.duration
                            : durationCache.get(normalizedTrack?.filePath)

                    return `
                        <tr class="playlistTrackRow" data-track-index="${index}" style="height: ${
                            virtualItem.size
                        }px">
                            <td class="playlistTrackIndexCell">
                                <button
                                    type="button"
                                    class="playlistTrackIndexPlayBtn"
                                    data-track-index="${index}"
                                    aria-label="Play from track ${index + 1}"
                                >
                                    <span class="playlistTrackIndexValue">${index + 1}</span>
                                    <i data-lucide="play" class="playlistTrackIndexPlayIcon" aria-hidden="true"></i>
                                </button>
                            </td>
                            <td class="playlistTrackTitleCell">
                                <div class="playlistTrackTitleWrap">
                                    <img class="playlistTrackCover" src="${escapeHtml(
                                        trackImage,
                                    )}" alt="Track cover" draggable="false" />
                                    <span class="playlistTrackTitleText">${escapeHtml(
                                        trackTitle,
                                    )}</span>
                                </div>
                            </td>
                            <td>${escapeHtml(artist)}</td>
                            <td>${escapeHtml(album)}</td>
                            <td>${dateAdded}</td>
                            <td data-duration-index="${index}">${formatDurationClock(duration)}</td>
                            <td>
                                <div class="playlistTrackActions">
                                    <button type="button" class="playlistTrackMoreBtn" data-track-index="${index}" aria-label="Track actions">
                                        <i data-lucide="ellipsis"></i>
                                    </button>
                                    <div class="playlistTrackMenu" data-track-index="${index}">
                                        <button type="button" class="removeTrackBtn" data-track-index="${index}">Remove from Playlist</button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    `
                })
                .join('')

            html +=
                paddingBottom > 0
                    ? `<tr class="virtual-padding-bottom"><td colspan="7" style="height: ${paddingBottom}px"></td></tr>`
                    : ''
        } else {
            // Local virtualization fallback: compute visible window based on page scroll
            const ROW_ESTIMATE = 56
            const OVERSCAN = 8

            const table = trackContainer.querySelector('.playlistTrackTable')
            const thead = table?.querySelector('thead')
            let lastStart = -1
            let lastEnd = -1

            function computeVirtualHtml() {
                const scrollTop = (document.scrollingElement || document.documentElement).scrollTop
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight
                const containerRect = trackContainer.getBoundingClientRect()
                const containerTop = containerRect.top + scrollTop
                const headerHeight = thead ? thead.getBoundingClientRect().height : 0
                const contentStart = containerTop + headerHeight

                let start = Math.floor((scrollTop - contentStart) / ROW_ESTIMATE) - OVERSCAN
                let end =
                    Math.ceil((scrollTop - contentStart + viewportHeight) / ROW_ESTIMATE) + OVERSCAN

                if (start < 0) start = 0
                if (end < 0) end = 0
                if (start > tracks.length - 1) start = tracks.length - 1
                if (end > tracks.length - 1) end = tracks.length - 1

                if (start === lastStart && end === lastEnd) return null
                lastStart = start
                lastEnd = end

                const paddingTop = start * ROW_ESTIMATE
                const paddingBottom = Math.max(0, (tracks.length - end - 1) * ROW_ESTIMATE)

                let out = ''
                out +=
                    paddingTop > 0
                        ? `<tr class="virtual-padding-top"><td colspan="7" style="height: ${paddingTop}px"></td></tr>`
                        : ''

                for (let i = start; i <= end; i++) {
                    const track = tracks[i]
                    const normalizedTrack = normalizeTrackRecord(track)
                    const trackTitle = normalizedTrack?.title || DEFAULT_TRACK_TITLE
                    const artist = normalizedTrack?.artist || DEFAULT_TRACK_ARTIST
                    const album = normalizedTrack?.album || DEFAULT_TRACK_ALBUM
                    const trackImage =
                        resolveTrackImage(normalizedTrack) || './assets/music-placeholder.png'
                    const dateAdded = formatDate(
                        normalizedTrack?.playedAt || normalizedTrack?.addedAt,
                    )
                    const duration =
                        typeof normalizedTrack?.duration === 'number' &&
                        normalizedTrack.duration > 0
                            ? normalizedTrack.duration
                            : durationCache.get(normalizedTrack?.filePath)

                    out += `
                        <tr class="playlistTrackRow" data-track-index="${i}">
                            <td class="playlistTrackIndexCell">
                                <button
                                    type="button"
                                    class="playlistTrackIndexPlayBtn"
                                    data-track-index="${i}"
                                    aria-label="Play from track ${i + 1}"
                                >
                                    <span class="playlistTrackIndexValue">${i + 1}</span>
                                    <i data-lucide="play" class="playlistTrackIndexPlayIcon" aria-hidden="true"></i>
                                </button>
                            </td>
                            <td class="playlistTrackTitleCell">
                                <div class="playlistTrackTitleWrap">
                                    <img class="playlistTrackCover" src="${escapeHtml(trackImage)}" alt="Track cover" draggable="false" />
                                    <span class="playlistTrackTitleText">${escapeHtml(trackTitle)}</span>
                                </div>
                            </td>
                            <td>${escapeHtml(artist)}</td>
                            <td>${escapeHtml(album)}</td>
                            <td>${dateAdded}</td>
                            <td data-duration-index="${i}">${formatDurationClock(duration)}</td>
                            <td>
                                <div class="playlistTrackActions">
                                    <button type="button" class="playlistTrackMoreBtn" data-track-index="${i}" aria-label="Track actions">
                                        <i data-lucide="ellipsis"></i>
                                    </button>
                                    <div class="playlistTrackMenu" data-track-index="${i}">
                                        <button type="button" class="removeTrackBtn" data-track-index="${i}">Remove from Playlist</button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    `
                }

                out +=
                    paddingBottom > 0
                        ? `<tr class="virtual-padding-bottom"><td colspan="7" style="height: ${paddingBottom}px"></td></tr>`
                        : ''
                return out
            }

            // initial render
            const initialHtml = computeVirtualHtml() || ''
            html = initialHtml

            // attach scroll/resize handler to update visible range
            if (!virtualizer) {
                virtualizer = { local: true }

                virtualizerScrollHandler = () => {
                    if (scrollRaf) cancelAnimationFrame(scrollRaf)
                    scrollRaf = requestAnimationFrame(() => {
                        const updated = computeVirtualHtml()
                        if (updated !== null) {
                            body.innerHTML = updated
                            // run same post-render steps
                            hydrateTrackDurations(activePlaylist)
                            window.lucide?.createIcons()
                            bindImageFallbacks({ scope: body, selector: '.playlistTrackCover' })
                            cleanupTrackMenuToggles = attachIndexedMenuToggle({
                                scope: body,
                                triggerSelector: '.playlistTrackMoreBtn',
                                menuSelector: '.playlistTrackMenu',
                                indexAttribute: 'data-track-index',
                            })

                            // reattach interactive handlers
                            attachTrackActionHandlers(body)
                        }
                    })
                }

                window.addEventListener('scroll', virtualizerScrollHandler, { passive: true })
                window.addEventListener('resize', virtualizerScrollHandler, { passive: true })
            }
        }

        body.innerHTML = html

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
        if (isRouteActive(['playlist', 'queue'])) {
            hydrate()
        }
    }
    window.addEventListener('user-playlists:updated', onPlaylistsUpdated)

    const cleanup = () => {
        window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
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
