import { getBaseName } from '../../utils/file-path.js'
import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
    DEFAULT_TRACK_ALBUM,
} from '../../utils/track-record.js'
import { audioService } from '../../services/audio-service.js'

const VIEW_SONGS_METADATA_DEBUG_ENABLED = false
const VIEW_SONGS_METADATA_WORKERS = 4
const VIEW_SONGS_METADATA_CACHE_LIMIT = 240

// Simple in-memory cache for resolved metadata promises keyed by file path.
const metadataCache = new Map()

export function clearMetadataCache() {
    metadataCache.clear()
}

function logViewSongsMetadataDebug(phase, payload = {}) {
    if (!VIEW_SONGS_METADATA_DEBUG_ENABLED) {
        return
    }

    console.debug('[recent-playlist:view-songs:metadata]', {
        phase,
        ...payload,
    })
}

function getCachedMetadataPromise(filePath) {
    if (!metadataCache.has(filePath)) {
        return null
    }

    const cached = metadataCache.get(filePath)
    metadataCache.delete(filePath)
    metadataCache.set(filePath, cached)
    return cached
}

function setCachedMetadataPromise(filePath, fetchPromise) {
    if (metadataCache.has(filePath)) {
        metadataCache.delete(filePath)
    }

    metadataCache.set(filePath, fetchPromise)

    if (metadataCache.size <= VIEW_SONGS_METADATA_CACHE_LIMIT) {
        return
    }

    const oldestKey = metadataCache.keys().next().value
    if (oldestKey) {
        metadataCache.delete(oldestKey)
    }
}

function updateViewSongsTrackRow(modalHost, trackIndex, { title, artist }) {
    if (!modalHost?.isConnected || !Number.isInteger(trackIndex)) {
        return
    }

    const row = modalHost.querySelector(`.recentModalTrackRow[data-track-index="${trackIndex}"]`)
    if (!row) {
        return
    }

    const titleElement = row.querySelector('.recentModalTrackTitle')
    if (titleElement) {
        titleElement.textContent = title || DEFAULT_TRACK_TITLE
    }

    const metaElement = row.querySelector('.recentModalTrackMeta')
    if (metaElement) {
        metaElement.textContent = artist || DEFAULT_TRACK_ARTIST
    }
}

export async function hydrateViewSongsMetadata({ playlist, tracks, modalHost, signal } = {}) {
    if (signal?.aborted) {
        return
    }

    if (!modalHost?.isConnected || !Array.isArray(tracks) || tracks.length === 0) {
        return
    }

    if (typeof audioService?.resolveTrackMetadata !== 'function') {
        logViewSongsMetadataDebug('resolver-missing', {
            playlistName: playlist?.name || 'Folder Playlist',
        })
        return
    }

    const playlistName = playlist?.name || 'Folder Playlist'
    const workerCount = Math.max(1, Math.min(VIEW_SONGS_METADATA_WORKERS, tracks.length))
    let cursor = 0
    let fallbackDetectedCount = 0
    let improvedCount = 0
    let errorCount = 0

    logViewSongsMetadataDebug('probe-start', {
        playlistName,
        trackCount: tracks.length,
        workerCount,
    })

    const worker = async () => {
        while (cursor < tracks.length) {
            if (signal?.aborted) {
                return
            }

            const trackIndex = cursor
            cursor += 1

            const track = tracks[trackIndex]
            const filePath = track?.filePath
            if (!filePath) {
                continue
            }

            const storedTitle = track?.title || getBaseName(filePath, DEFAULT_TRACK_TITLE)
            const storedArtist = track?.artist || DEFAULT_TRACK_ARTIST
            const hadFallbackMetadata =
                !storedTitle ||
                storedTitle === getBaseName(filePath, DEFAULT_TRACK_TITLE) ||
                !storedArtist ||
                storedArtist.trim().toLowerCase() === '' ||
                storedArtist.toLowerCase() === 'unknown artist'

            if (hadFallbackMetadata) {
                fallbackDetectedCount += 1
                logViewSongsMetadataDebug('stored-fallback-detected', {
                    playlistName,
                    trackIndex,
                    filePath,
                    storedTitle,
                    storedArtist,
                })
            }

            try {
                // Reuse cached promise when available so concurrent requests share work
                let fetchPromise = getCachedMetadataPromise(filePath)
                if (!fetchPromise) {
                    fetchPromise = (async () => {
                        try {
                            return await audioService.resolveTrackMetadata(filePath)
                        } catch {
                            return null
                        }
                    })()
                    setCachedMetadataPromise(filePath, fetchPromise)
                }

                const resolvedMetadata = await fetchPromise
                if (signal?.aborted) {
                    return
                }
                const resolvedTitle = resolvedMetadata?.title || storedTitle
                const resolvedArtist = resolvedMetadata?.artist || storedArtist
                const metadataImproved =
                    resolvedTitle !== storedTitle || resolvedArtist !== storedArtist

                if (metadataImproved) {
                    improvedCount += 1
                }

                updateViewSongsTrackRow(modalHost, trackIndex, {
                    title: resolvedTitle,
                    artist: resolvedArtist,
                })

                if (hadFallbackMetadata || metadataImproved) {
                    logViewSongsMetadataDebug('resolved', {
                        playlistName,
                        trackIndex,
                        filePath,
                        storedTitle,
                        storedArtist,
                        resolvedTitle,
                        resolvedArtist,
                        metadataImproved,
                    })
                }
            } catch (error) {
                errorCount += 1
                logViewSongsMetadataDebug('resolve-error', {
                    playlistName,
                    trackIndex,
                    filePath,
                    error: String(error?.message || error || 'unknown error'),
                })
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    logViewSongsMetadataDebug('probe-complete', {
        playlistName,
        trackCount: tracks.length,
        fallbackDetectedCount,
        improvedCount,
        errorCount,
    })
}

export async function resolvePlaylistTracksMetadata(tracks, { signal } = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
        return []
    }

    if (typeof audioService?.resolveTrackMetadata !== 'function') {
        return tracks.map((track) => normalizeTrackRecord(track)).filter(Boolean)
    }

    const workers = Math.max(1, Math.min(VIEW_SONGS_METADATA_WORKERS, tracks.length))
    const resolvedTracks = new Array(tracks.length)
    let cursor = 0

    const worker = async () => {
        while (cursor < tracks.length) {
            if (signal?.aborted) {
                return
            }

            const index = cursor
            cursor += 1

            const track = tracks[index]
            const normalizedTrack = normalizeTrackRecord(track)
            const filePath = normalizedTrack?.filePath
            if (!normalizedTrack || !filePath) {
                resolvedTracks[index] = null
                continue
            }

            const fallbackTitle = normalizedTrack.title || DEFAULT_TRACK_TITLE
            const fallbackArtist = normalizedTrack.artist || DEFAULT_TRACK_ARTIST
            const fallbackAlbum = normalizedTrack.album || DEFAULT_TRACK_ALBUM
            const fallbackImage = normalizedTrack.image || ''

            try {
                // Reuse cached promise when available so concurrent requests share work
                let fetchPromise = getCachedMetadataPromise(filePath)
                if (!fetchPromise) {
                    fetchPromise = (async () => {
                        try {
                            return await audioService.resolveTrackMetadata(filePath, {
                                includeImage: true,
                            })
                        } catch {
                            return null
                        }
                    })()
                    setCachedMetadataPromise(filePath, fetchPromise)
                }

                const resolvedMetadata = await fetchPromise
                if (signal?.aborted) {
                    return
                }

                resolvedTracks[index] = {
                    ...normalizedTrack,
                    filePath,
                    title: resolvedMetadata?.title || fallbackTitle,
                    artist: resolvedMetadata?.artist || fallbackArtist,
                    album: resolvedMetadata?.album || fallbackAlbum,
                    image: resolvedMetadata?.image || fallbackImage,
                }
            } catch (error) {
                logViewSongsMetadataDebug('resolve-tracks-metadata-error', {
                    filePath,
                    error: String(error?.message || error || 'unknown error'),
                })
                resolvedTracks[index] = {
                    ...normalizedTrack,
                    filePath,
                    title: fallbackTitle,
                    artist: fallbackArtist,
                    album: fallbackAlbum,
                    image: fallbackImage,
                }
            }
        }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()))

    return resolvedTracks.filter(Boolean)
}
