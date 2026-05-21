import { playerState } from '../../state/player-state.js'
import { audioService } from '../../services/audio-service.js'
import {
    CreateElementBuilder,
    bindImageFallbacks,
    getDataAttributeIndex,
} from '../../utils/dom-helpers.js'
import { DEFAULT_TRACK_TITLE, DEFAULT_TRACK_ARTIST } from '../../utils/track-record.js'

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
    let alive = true

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

    function createQueueHint(message) {
        return CreateElementBuilder.create('li').className('queueHint').text(message).build()
    }

    function renderQueueItem({ trackIndex, title, artist, image, isActive }) {
        const displayTitle = title || DEFAULT_TRACK_TITLE
        const displayArtist = artist || DEFAULT_TRACK_ARTIST

        return CreateElementBuilder.create('li')
            .addClass('queueItem', isActive ? 'isActive' : '')
            .attr('data-track-index', trackIndex)
            .child(
                CreateElementBuilder.create('button')
                    .className('queueItemButton')
                    .property('type', 'button')
                    .attr('data-track-index', trackIndex)
                    .attr('aria-label', `Play ${displayTitle}`)
                    .child(
                        CreateElementBuilder.create('img')
                            .className('queueCover')
                            .property('src', image || placeholderCover)
                            .property('alt', displayTitle)
                            .property('loading', 'lazy')
                            .property('draggable', false),
                    )
                    .child(
                        CreateElementBuilder.create('span')
                            .className('queueInfo')
                            .child(
                                CreateElementBuilder.create('span')
                                    .className('queueTitle')
                                    .text(displayTitle),
                            )
                            .child(
                                CreateElementBuilder.create('span')
                                    .className('queueArtist')
                                    .text(displayArtist),
                            ),
                    ),
            )
            .build()
    }

    function attachPlayHandlers(scopeElement) {
        const buttons = scopeElement.querySelectorAll('.queueItemButton')
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const index = getDataAttributeIndex(button, 'data-track-index')
                if (index !== null) {
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
            titleEl.textContent = metadata?.title || DEFAULT_TRACK_TITLE
        }

        if (artistEl) {
            artistEl.textContent = metadata?.artist || DEFAULT_TRACK_ARTIST
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
            if (!alive || token !== renderToken) {
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
            nowPlayingList.replaceChildren()
            upcomingList.replaceChildren()
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

            nowPlayingList.replaceChildren(
                renderQueueItem({
                    trackIndex: currentTrackIndex,
                    title: nowPlayingTitle,
                    artist: nowPlayingArtist,
                    image: nowPlayingImage,
                    isActive: true,
                }),
            )
        } else {
            nowPlayingList.replaceChildren(createQueueHint('No track is currently selected.'))
        }

        if (upcoming.length === 0) {
            upcomingList.replaceChildren(createQueueHint('No upcoming tracks.'))
            nextTitle.textContent = 'Next up'
        } else {
            nextTitle.textContent = `Next up`
            const upcomingFragment = document.createDocumentFragment()
            upcoming.forEach(({ filePath, index }) => {
                const metadata = audioService.getTrackDisplayData(filePath)
                upcomingFragment.appendChild(
                    renderQueueItem({
                        trackIndex: index,
                        title: metadata.title,
                        artist: metadata.artist,
                        image: metadata.image,
                        isActive: false,
                    }),
                )
            })
            upcomingList.replaceChildren(upcomingFragment)
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
        alive = false
        if (typeof unsubscribe === 'function') {
            unsubscribe()
        }
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
    render(playerState.getState())
}

window.initializeQueuePage = initializeQueuePage
