import { playerState } from '../../state/player-state.js'
import { audioService } from '../../services/audio-service.js'
import { escapeHtml, bindImageFallbacks } from '../../utils/dom-helpers.js'

export function initializeQueuePage() {
    const nowPlayingList = document.getElementById('queueNowPlaying')
    const upcomingList = document.getElementById('queueUpcoming')
    const emptyState = document.getElementById('queueEmptyState')
    const nextTitle = document.getElementById('queueNextTitle')

    if (!nowPlayingList || !upcomingList || !emptyState || !nextTitle) {
        return
    }

    const placeholderCover = audioService?.placeholderCover || './assets/music-placeholder.png'
    let lastRenderKey = ''
    let renderToken = 0

    function getRenderKey(snapshot) {
        const playlist = Array.isArray(snapshot?.playlist) ? snapshot.playlist : []
        const current = snapshot?.currentTrack || {}
        return JSON.stringify({
            playlist,
            currentTrackIndex: snapshot?.currentTrackIndex,
            currentFilePath: current.filePath || '',
            currentTitle: current.title || '',
            currentArtist: current.artist || '',
            currentImage: current.image || '',
        })
    }

    function renderQueueItem({ trackIndex, title, artist, image, isActive }) {
        return `
			<li class="queueItem ${isActive ? 'isActive' : ''}" data-track-index="${trackIndex}">
				<button type="button" class="queueItemButton" data-track-index="${trackIndex}" aria-label="Play ${escapeHtml(title)}">
					<img
						class="queueCover"
						src="${escapeHtml(image || placeholderCover)}"
						alt="${escapeHtml(title)}"
						loading="lazy"
						draggable="false"
					/>
					<span class="queueInfo">
						<span class="queueTitle">${escapeHtml(title || 'Unknown Title')}</span>
						<span class="queueArtist">${escapeHtml(artist || 'Unknown Artist')}</span>
					</span>
				</button>
			</li>
		`
    }

    function attachPlayHandlers(scopeElement) {
        const buttons = scopeElement.querySelectorAll('.queueItemButton')
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number(button.getAttribute('data-track-index'))
                if (Number.isInteger(index) && index >= 0) {
                    audioService.playTrackAtIndex(index)
                }
            })
        })
    }

    function updateQueueItemAtIndex(trackIndex, metadata) {
        const titleEl = document.querySelector(
            `.queueItem[data-track-index="${trackIndex}"] .queueTitle`,
        )
        const artistEl = document.querySelector(
            `.queueItem[data-track-index="${trackIndex}"] .queueArtist`,
        )
        const coverEl = document.querySelector(
            `.queueItem[data-track-index="${trackIndex}"] .queueCover`,
        )

        if (titleEl) {
            titleEl.textContent = metadata?.title || 'Unknown Title'
        }

        if (artistEl) {
            artistEl.textContent = metadata?.artist || 'Unknown Artist'
        }

        if (coverEl && metadata?.image) {
            coverEl.src = metadata.image
        }
    }

    async function hydrateMetadata(playlist, token) {
        const tasks = playlist.map(async (filePath, index) => {
            if (!filePath) {
                return
            }

            const metadata = await audioService.resolveTrackMetadata(filePath)
            if (token !== renderToken) {
                return
            }

            updateQueueItemAtIndex(index, metadata)
        })

        await Promise.all(tasks)
    }

    function render(snapshot = playerState.getState()) {
        const renderKey = getRenderKey(snapshot)
        if (renderKey === lastRenderKey) {
            return
        }
        lastRenderKey = renderKey

        const token = ++renderToken
        const playlist = Array.isArray(snapshot?.playlist) ? snapshot.playlist : []
        const currentTrackIndex = Number.isInteger(snapshot?.currentTrackIndex)
            ? snapshot.currentTrackIndex
            : -1

        const hasQueue = playlist.length > 0
        emptyState.hidden = hasQueue

        if (!hasQueue) {
            nowPlayingList.innerHTML = ''
            upcomingList.innerHTML = ''
            nextTitle.textContent = 'Next up'
            return
        }

        const nowPlayingPath = currentTrackIndex >= 0 ? playlist[currentTrackIndex] : null
        const upcomingStart = currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0
        const upcoming = playlist
            .map((filePath, index) => ({ filePath, index }))
            .filter((entry) => entry.index >= upcomingStart)

        if (nowPlayingPath) {
            const metadata = audioService.getTrackDisplayData(nowPlayingPath)
            const currentTrack = snapshot?.currentTrack || {}
            const nowPlayingTitle =
                currentTrack.filePath === nowPlayingPath
                    ? currentTrack.title || metadata.title
                    : metadata.title
            const nowPlayingArtist =
                currentTrack.filePath === nowPlayingPath
                    ? currentTrack.artist || metadata.artist
                    : metadata.artist
            const nowPlayingImage =
                currentTrack.filePath === nowPlayingPath
                    ? currentTrack.image || metadata.image
                    : metadata.image

            nowPlayingList.innerHTML = renderQueueItem({
                trackIndex: currentTrackIndex,
                title: nowPlayingTitle,
                artist: nowPlayingArtist,
                image: nowPlayingImage,
                isActive: true,
            })
        } else {
            nowPlayingList.innerHTML = '<li class="queueHint">No track is currently selected.</li>'
        }

        if (upcoming.length === 0) {
            upcomingList.innerHTML = '<li class="queueHint">No upcoming tracks.</li>'
            nextTitle.textContent = 'Next up'
        } else {
            nextTitle.textContent = `Next from: ${upcoming.length} track${upcoming.length > 1 ? 's' : ''}`
            upcomingList.innerHTML = upcoming
                .map(({ filePath, index }) => {
                    const metadata = audioService.getTrackDisplayData(filePath)
                    return renderQueueItem({
                        trackIndex: index,
                        title: metadata.title,
                        artist: metadata.artist,
                        image: metadata.image,
                        isActive: false,
                    })
                })
                .join('')
        }

        attachPlayHandlers(nowPlayingList)
        attachPlayHandlers(upcomingList)
        bindImageFallbacks({
            scope: nowPlayingList,
            selector: '.queueCover',
        })
        bindImageFallbacks({
            scope: upcomingList,
            selector: '.queueCover',
        })

        hydrateMetadata(playlist, token).catch((error) => {
            console.error('Failed to hydrate queue metadata:', error)
        })
    }

    const unsubscribe = playerState.subscribe((snapshot) => {
        render(snapshot)
    })

    const cleanup = () => {
        if (typeof unsubscribe === 'function') {
            unsubscribe()
        }
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    render(playerState.getState())
}

window.initializeQueuePage = initializeQueuePage
