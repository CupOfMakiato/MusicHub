import { getDataAttributeIndex, bindImageFallbacks } from '../../utils/dom-helpers.js'
import { hydrateImageWithTrackArtwork } from '../../utils/artwork.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'
import { getPlaylistTrackFilePath } from './playlist-duration-cache.js'
import {
    clearTrackArtworkResolvePromise,
    getCachedTrackArtwork,
    getTrackArtworkResolvePromise,
    normalizeArtworkValue,
    rememberTrackArtwork,
    schedulePlaylistArtworkPersist,
    setTrackArtworkResolvePromise,
} from './playlist-artwork-cache.js'

export function createPlaylistArtworkController({ getActivePlaylist, audioService } = {}) {
    const pendingArtworkRows = new Set()
    let artworkHydrationHandle = null
    let artworkHydrationUsesIdleCallback = false

    function rememberActivePlaylistTrackArtwork(trackIndex, artwork) {
        const activePlaylist = getActivePlaylist?.()
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
            const activePlaylist = getActivePlaylist?.()
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

    function cancelArtworkHydration() {
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

    function scheduleArtworkHydration(rows) {
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
        scheduleArtworkHydration(rows)
    }

    return {
        buildTrackRecordForRender,
        applyRowDecorations,
        scheduleArtworkHydration,
        cancelArtworkHydration,
    }
}
