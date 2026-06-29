import { playerState } from '../../state/player-state.js'
import { audioService } from '../../services/audio-service.js'
import { formatDurationClock as formatTime } from '../../utils/duration.js'
import { bindModalResolve, showModalPrompt } from '../../utils/dom-helpers.js'

const PLAYER_MODAL_HOST_CLASS = 'playerModalHost'
const METADATA_LABELS = {
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    year: 'Year',
    genre: 'Genre',
    track: 'Track',
    disc: 'Disc',
}
const HIDDEN_METADATA_TAGS = new Set(['image', 'pictureFormat', 'pictureBytes'])

export function initializePlayer() {
    const bottomPlayer = document.getElementById('bottom-player')

    if (!bottomPlayer) {
        console.error('Bottom player element not found')
        return
    }

    const trackTitleElement = bottomPlayer.querySelector('#trackTitle')
    const trackArtistElement = bottomPlayer.querySelector('#trackArtist')
    const albumArtElement = bottomPlayer.querySelector('#albumArt')
    const playPauseBtn = bottomPlayer.querySelector('#playPauseBtn')
    const prevBtn = bottomPlayer.querySelector('#prevBtn')
    const nextBtn = bottomPlayer.querySelector('#nextBtn')
    const repeatBtn = bottomPlayer.querySelector('#trackRepeatBtn')
    const progressSlider = bottomPlayer.querySelector('#progressSlider')
    const currentTimeElement = bottomPlayer.querySelector('#currentTime')
    const durationElement = bottomPlayer.querySelector('#duration')
    const volumeSlider = bottomPlayer.querySelector('#volumeSlider')
    const volumeBtn = bottomPlayer.querySelector('#volumeBtn')
    const trackMenuBtn = bottomPlayer.querySelector('#trackMenuBtn')
    const trackMenu = bottomPlayer.querySelector('#trackMenu')
    const trackPropertiesBtn = bottomPlayer.querySelector('#trackPropertiesBtn')
    const placeholderCover = audioService?.placeholderCover || './assets/music-placeholder.png'
    let progressRafId = null
    let latestSnapshot = playerState.getState()

    console.log('Player DOM elements found')

    function updatePlayerUI(snapshot = latestSnapshot) {
        // console.log('updatePlayerUI triggered');
        latestSnapshot = snapshot || latestSnapshot
        const { currentTrack, isPlaying, volume, loopEnabled } = latestSnapshot
        const title = currentTrack?.title || 'No song selected'
        const artist = currentTrack?.artist || 'Unknown artist'
        const image = currentTrack?.image || placeholderCover

        if (trackTitleElement) trackTitleElement.textContent = title
        if (trackArtistElement) trackArtistElement.textContent = artist
        if (albumArtElement) albumArtElement.src = image

        if (playPauseBtn) {
            const icon = isPlaying ? 'pause' : 'play'
            const existingIcon = playPauseBtn.querySelector('i')
            if (existingIcon) {
                existingIcon.setAttribute('data-lucide', icon)
            } else {
                playPauseBtn.innerHTML = `<i data-lucide="${icon}"></i>`
            }
            window.lucide.createIcons({ nodes: [playPauseBtn] })
        }

        if (volumeSlider) {
            volumeSlider.value = Number.isFinite(Number(volume)) ? Number(volume) : 0.7
        }

        if (repeatBtn) {
            repeatBtn.classList.toggle('is-active', Boolean(loopEnabled))
            repeatBtn.setAttribute('aria-pressed', String(Boolean(loopEnabled)))
        }

        const sound = audioService.getCurrentSound()
        if (sound) {
            const seek = sound.seek() || 0
            const duration = sound.duration() || 0

            if (progressSlider) {
                progressSlider.value = (seek / duration) * 100 || 0
            }
            if (currentTimeElement) {
                currentTimeElement.textContent = formatTime(seek)
            }
            if (durationElement) {
                durationElement.textContent = formatTime(duration)
            }
        } else {
            if (progressSlider) progressSlider.value = 0
            if (currentTimeElement) currentTimeElement.textContent = '0:00'
            if (durationElement) durationElement.textContent = '0:00'
        }
    }

    function getActiveTrackFilePath(snapshot = playerState.getState()) {
        const playlist = Array.isArray(snapshot?.playlist) ? snapshot.playlist : []
        const currentTrackIndex = Number.isInteger(snapshot?.currentTrackIndex)
            ? snapshot.currentTrackIndex
            : -1

        if (currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
            return playlist[currentTrackIndex]
        }

        return typeof snapshot?.currentTrack?.filePath === 'string'
            ? snapshot.currentTrack.filePath
            : ''
    }

    function getFileName(filePath) {
        return String(filePath || '')
            .split(/[\\/]/)
            .filter(Boolean)
            .pop()
    }

    function formatPropertyValue(value) {
        if (value === null || value === undefined || value === '') {
            return ''
        }

        if (Array.isArray(value)) {
            return value.filter(Boolean).join(', ')
        }

        if (typeof value === 'object') {
            return JSON.stringify(value)
        }

        return String(value)
    }

    function createMetadataRow(label, value) {
        const row = document.createElement('div')
        row.className = 'playerPropertyRow'

        const term = document.createElement('dt')
        term.textContent = label

        const description = document.createElement('dd')
        description.textContent = value || 'Not available'

        row.appendChild(term)
        row.appendChild(description)
        return row
    }

    function appendMetadataSection(container, title, rows) {
        const section = document.createElement('section')
        section.className = 'playerPropertySection'

        const heading = document.createElement('h4')
        heading.textContent = title
        section.appendChild(heading)

        if (!rows.length) {
            const empty = document.createElement('p')
            empty.className = 'playerPropertiesEmpty'
            empty.textContent = 'No metadata found.'
            section.appendChild(empty)
            container.appendChild(section)
            return
        }

        const list = document.createElement('dl')
        rows.forEach(([label, value]) => {
            list.appendChild(createMetadataRow(label, value))
        })
        section.appendChild(list)
        container.appendChild(section)
    }

    function buildRawMetadataRows(rawMetadata) {
        if (!rawMetadata || typeof rawMetadata !== 'object') {
            return []
        }

        return Object.entries(rawMetadata)
            .filter(([key]) => !HIDDEN_METADATA_TAGS.has(key))
            .map(([key, value]) => [METADATA_LABELS[key] || key, formatPropertyValue(value)])
    }

    function buildPropertiesDialog({ filePath, snapshot, rawMetadata, metadataError }) {
        const fragment = document.createDocumentFragment()

        const backdrop = document.createElement('div')
        backdrop.className = 'playerModalBackdrop'
        backdrop.setAttribute('data-close', 'true')

        const dialog = document.createElement('div')
        dialog.className = 'playerPropertiesDialog'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.setAttribute('aria-labelledby', 'playerPropertiesTitle')

        const currentTrack = snapshot?.currentTrack || {}
        const displayData = filePath ? audioService.getTrackDisplayData(filePath) : {}
        const title =
            currentTrack.title || rawMetadata?.title || displayData.title || 'No track selected'
        const artist =
            currentTrack.artist || rawMetadata?.artist || displayData.artist || 'Unknown artist'
        const album = currentTrack.album || rawMetadata?.album || displayData.album || ''
        const artwork =
            currentTrack.image || rawMetadata?.image || displayData.image || placeholderCover

        const header = document.createElement('div')
        header.className = 'playerPropertiesHeader'

        const artworkImage = document.createElement('img')
        artworkImage.src = artwork
        artworkImage.alt = title
        artworkImage.className = 'playerPropertiesArtwork'
        artworkImage.addEventListener('error', () => {
            artworkImage.src = placeholderCover
        })

        const headingWrap = document.createElement('div')
        const heading = document.createElement('h3')
        heading.id = 'playerPropertiesTitle'
        heading.textContent = 'Track Properties'

        const subtitle = document.createElement('p')
        subtitle.textContent = filePath ? getFileName(filePath) || filePath : 'No track selected'

        headingWrap.appendChild(heading)
        headingWrap.appendChild(subtitle)
        header.appendChild(artworkImage)
        header.appendChild(headingWrap)

        const content = document.createElement('div')
        content.className = 'playerPropertiesContent'

        const playlist = Array.isArray(snapshot?.playlist) ? snapshot.playlist : []
        const currentTrackIndex = Number.isInteger(snapshot?.currentTrackIndex)
            ? snapshot.currentTrackIndex
            : -1
        const sound = audioService.getCurrentSound()
        const duration = Number(sound?.duration?.() || snapshot?.progress?.duration || 0)

        appendMetadataSection(content, 'File', [
            ['File name', filePath ? getFileName(filePath) || filePath : ''],
            ['File path', filePath],
            [
                'Queue position',
                currentTrackIndex >= 0 && playlist.length
                    ? `${currentTrackIndex + 1} of ${playlist.length}`
                    : '',
            ],
            ['Duration', duration > 0 ? formatTime(duration) : ''],
        ])

        appendMetadataSection(content, 'Current Display', [
            ['Title', title],
            ['Artist', artist],
            ['Album', album],
        ])

        appendMetadataSection(content, 'Metadata Tags', buildRawMetadataRows(rawMetadata))

        if (metadataError) {
            const error = document.createElement('p')
            error.className = 'playerPropertiesError'
            error.textContent = `Could not read embedded metadata: ${metadataError}`
            content.appendChild(error)
        }

        const actions = document.createElement('div')
        actions.className = 'playerPropertiesActions'

        const closeButton = document.createElement('button')
        closeButton.type = 'button'
        closeButton.className = 'playerPropertiesCloseBtn'
        closeButton.textContent = 'Close'
        actions.appendChild(closeButton)

        dialog.appendChild(header)
        dialog.appendChild(content)
        dialog.appendChild(actions)

        fragment.appendChild(backdrop)
        fragment.appendChild(dialog)
        return fragment
    }

    function showPropertiesDialog(props) {
        return showModalPrompt({
            scope: document.body,
            contentNode: buildPropertiesDialog(props),
            hostClass: PLAYER_MODAL_HOST_CLASS,
            fallbackValue: undefined,
            onBind: ({ modalHost, resolve }) => {
                bindModalResolve({
                    modalHost,
                    selector: '.playerPropertiesCloseBtn',
                    resolve,
                    value: undefined,
                })
                bindModalResolve({
                    modalHost,
                    selector: '.playerModalBackdrop',
                    resolve,
                    value: undefined,
                })
            },
        })
    }

    function closeTrackMenu() {
        if (trackMenu) {
            trackMenu.hidden = true
            trackMenu.classList.remove('is-open')
        }

        if (trackMenuBtn) {
            trackMenuBtn.setAttribute('aria-expanded', 'false')
        }
    }

    function toggleTrackMenu() {
        if (!trackMenu || !trackMenuBtn) {
            return
        }

        const shouldOpen = trackMenu.hidden
        trackMenu.hidden = !shouldOpen
        trackMenu.classList.toggle('is-open', shouldOpen)
        trackMenuBtn.setAttribute('aria-expanded', String(shouldOpen))
    }

    async function showCurrentTrackProperties() {
        closeTrackMenu()

        const snapshot = playerState.getState()
        const filePath = getActiveTrackFilePath(snapshot)
        let rawMetadata = null
        let metadataError = ''

        if (filePath && typeof window.electronAPI?.readAudioMetadata === 'function') {
            try {
                rawMetadata = await window.electronAPI.readAudioMetadata(filePath, {
                    includeImage: false,
                })
            } catch (error) {
                metadataError = error?.message || String(error)
            }
        }

        await showPropertiesDialog({
            filePath,
            snapshot,
            rawMetadata,
            metadataError,
        })
    }

    function setupEventListeners() {
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                console.log('Play/Pause button clicked')
                // const { isPlaying } = playerState.getState()
                // playerState.setIsPlaying(!isPlaying);
                audioService.togglePlayPause()
            })
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                audioService.playPrevious()
            })
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                audioService.playNext()
            })
        }

        if (repeatBtn) {
            repeatBtn.addEventListener('click', () => {
                playerState.toggleLoopEnabled()
            })
        }

        if (progressSlider) {
            progressSlider.addEventListener('input', (e) => {
                const sound = audioService.getCurrentSound()
                if (sound) {
                    const duration = sound.duration()
                    const newSeek = (e.target.value / 100) * duration
                    sound.seek(newSeek)
                }
            })
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const newVolume = Number(e.target.value)
                console.log('Volume changed:', newVolume)
                audioService.setVolume(newVolume)
            })
        }

        if (volumeBtn) {
            volumeBtn.addEventListener('click', () => {
                // volume mute/unmute
            })
        }

        if (trackMenuBtn) {
            trackMenuBtn.addEventListener('click', (event) => {
                event.stopPropagation()
                toggleTrackMenu()
            })
        }

        if (trackMenu) {
            trackMenu.addEventListener('click', (event) => {
                event.stopPropagation()
            })
        }

        if (trackPropertiesBtn) {
            trackPropertiesBtn.addEventListener('click', () => {
                showCurrentTrackProperties().catch((error) => {
                    console.error('Failed to show track properties:', error)
                })
            })
        }

        document.addEventListener('click', closeTrackMenu)
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeTrackMenu()
            }
        })

        if (albumArtElement) {
            albumArtElement.addEventListener('error', () => {
                albumArtElement.src = placeholderCover
            })
        }
    }

    function startStateSync() {
        updatePlayerUI() // Initial UI update

        function stopProgressLoop() {
            if (progressRafId !== null) {
                cancelAnimationFrame(progressRafId)
                progressRafId = null
            }
        }

        function updateProgress() {
            const sound = audioService.getCurrentSound()
            const isPlaying = Boolean(latestSnapshot?.isPlaying)

            if (!sound || !isPlaying) {
                stopProgressLoop()
                return
            }

            const seek = sound.seek() || 0
            const duration = sound.duration() || 0
            if (progressSlider) progressSlider.value = (seek / duration) * 100 || 0
            if (currentTimeElement) currentTimeElement.textContent = formatTime(seek)
            if (durationElement) durationElement.textContent = formatTime(duration)

            progressRafId = requestAnimationFrame(updateProgress)
        }

        function startProgressLoop() {
            if (progressRafId !== null) {
                return
            }

            const sound = audioService.getCurrentSound()
            const isPlaying = Boolean(latestSnapshot?.isPlaying)
            if (!sound || !isPlaying) {
                return
            }

            progressRafId = requestAnimationFrame(updateProgress)
        }

        const unsubscribe = playerState.subscribe((snapshot) => {
            latestSnapshot = snapshot
            updatePlayerUI(snapshot)

            const sound = audioService.getCurrentSound()
            const isPlaying = Boolean(snapshot?.isPlaying)
            if (sound && isPlaying) {
                startProgressLoop()
            } else {
                stopProgressLoop()
            }
        })

        window.addEventListener(
            'beforeunload',
            () => {
                stopProgressLoop()
                if (typeof unsubscribe === 'function') {
                    unsubscribe()
                }
            },
            { once: true },
        )

        startProgressLoop()
    }

    setupEventListeners()
    startStateSync()
    console.log('Player setup complete')
}
window.initializePlayer = initializePlayer
