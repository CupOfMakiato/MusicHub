import { escapeHtml, attachIndexedMenuToggle } from '../../utils/dom-helpers.js'
import { formatDate } from '../../utils/date.js'
import { formatDurationClock, formatDurationVerbose } from '../../utils/duration.js'
import { toFileUrl, getBaseName } from '../../utils/file-path.js'
import { resolvePlaylistImage } from '../../utils/playlist-media.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'

export function initializePlaylistPage() {
    const picker = document.getElementById('playlistPicker')
    const title = document.getElementById('playlistTitle')
    const trackCountElement = document.getElementById('playlistTrackCount')
    const durationElement = document.getElementById('playlistDuration')
    const image = document.getElementById('playlistImage')
    const body = document.getElementById('playlistTrackBody')
    const playButton = document.getElementById('playlistPlayBtn')

    if (!picker || !title || !image || !body || !playButton) {
        return
    }

    let playlists = []
    let activePlaylistId = window.playlistViewState?.activePlaylistId || null
    const durationCache = new Map()
    let durationProbeRunId = 0
    let totalDurationRunId = 0
    let cleanupTrackMenuToggles = null

    function renderPlayButtonIcon() {
        const existingIcon = playButton.querySelector('i')
        if (existingIcon) {
            existingIcon.setAttribute('data-lucide', 'play')
        }

        window.lucide?.createIcons({ nodes: [playButton] })
    }

    function isPlaylistRouteActive() {
        const route = window.appRouter?.getCurrentRoute?.()
        return route === 'playlist' || route === 'queue'
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

        const duration = await probeAudioDuration(filePath)
        durationCache.set(filePath, duration)
        return duration
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

    function renderPicker() {
        if (!playlists.length) {
            picker.innerHTML = '<option value="">No playlists</option>'
            picker.disabled = true
            return
        }

        picker.disabled = false
        picker.innerHTML = playlists
            .map((playlist) => {
                const selected = playlist.id === activePlaylistId ? 'selected' : ''
                return `<option value="${escapeHtml(playlist.id)}" ${selected}>${escapeHtml(playlist.name)}</option>`
            })
            .join('')
    }

    function renderTracks(activePlaylist) {
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }

        if (
            !activePlaylist ||
            !Array.isArray(activePlaylist.tracks) ||
            activePlaylist.tracks.length === 0
        ) {
            body.innerHTML =
                '<tr><td colspan="7" class="playlistEmptyRow">No tracks in this playlist yet.</td></tr>'
            return
        }

        body.innerHTML = activePlaylist.tracks
            .map((track, index) => {
                const trackTitle = track?.title || getBaseName(track?.filePath)
                const artist = track?.artist || 'Unknown Artist'
                const album = track?.album || 'Unknown Album'
                const dateAdded = formatDate(track?.playedAt || track?.addedAt)
                const duration =
                    typeof track?.duration === 'number' && track.duration > 0
                        ? track.duration
                        : durationCache.get(track?.filePath)
                return `
<tr class="playlistTrackRow" data-track-index="${index}">
<td>${index + 1}</td>
<td>${escapeHtml(trackTitle)}</td>
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

        hydrateTrackDurations(activePlaylist)
        window.lucide?.createIcons()

        cleanupTrackMenuToggles = attachIndexedMenuToggle({
            scope: body,
            triggerSelector: '.playlistTrackMoreBtn',
            menuSelector: '.playlistTrackMenu',
            indexAttribute: 'data-track-index',
        })

        const removeButtons = body.querySelectorAll('.removeTrackBtn')
        removeButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = Number(button.getAttribute('data-track-index'))
                const activePlaylist = getActivePlaylist()
                if (!activePlaylist || !Number.isInteger(trackIndex)) {
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

                playlists = updatedPlaylists
                await sessionService.saveUserPlaylists(updatedPlaylists)
                activePlaylistId = activePlaylist.id
                window.playlistViewState = { activePlaylistId }
                render()
            })
        })
    }

    function renderHeader(activePlaylist) {
        if (!activePlaylist) {
            title.textContent = 'No playlist selected'
            trackCountElement.textContent = 'Choose a playlist from your library.'
            durationElement.textContent = ''
            image.src = './assets/music-placeholder.png'
            return
        }

        const playlistImage = resolvePlaylistImage(activePlaylist)
        title.textContent = activePlaylist.name || 'Untitled Playlist'
        const trackCount = activePlaylist.tracks?.length || 0
        trackCountElement.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`

        image.src = playlistImage
        image.onerror = () => {
            image.src = './assets/music-placeholder.png'
        }
    }

    function render() {
        const activePlaylist = getActivePlaylist()
        renderPicker()
        renderHeader(activePlaylist)
        renderTracks(activePlaylist)
        renderTotalDuration(activePlaylist)
        renderPlayButtonIcon()
    }

    async function hydrate() {
        playlists = await sessionService.loadUserPlaylists()
        if (!activePlaylistId && playlists.length > 0) {
            activePlaylistId = playlists[0].id
        }

        if (activePlaylistId && !playlists.some((playlist) => playlist.id === activePlaylistId)) {
            activePlaylistId = playlists[0]?.id || null
        }

        window.playlistViewState = { activePlaylistId }
        render()
    }

    picker.addEventListener('change', () => {
        activePlaylistId = picker.value || null
        window.playlistViewState = { activePlaylistId }
        render()
    })

    playButton.addEventListener('click', () => {
        const activePlaylist = getActivePlaylist()
        const filePaths = Array.isArray(activePlaylist?.tracks)
            ? activePlaylist.tracks.map((track) => track?.filePath).filter(Boolean)
            : []
        if (!filePaths.length) {
            return
        }

        audioService.startPlaylist(filePaths)
    })

    const onPlaylistsUpdated = () => {
        if (isPlaylistRouteActive()) {
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
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    hydrate()
}

window.initializePlaylistPage = initializePlaylistPage
