import { sessionService } from '../../services/session-service.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'

const PLAYLIST_DURATION_CACHE_LIMIT = 2000
const PLAYLIST_DURATION_SAVE_DEBOUNCE_MS = 800

const playlistDurationCache = new Map()
const playlistDurationProbePromises = new Map()

let playlistDurationPersistTimer = null
let playlistDurationPersistQueued = false
let playlistDurationPersistInFlight = false
let playlistDurationPersisting = false

export function getPlaylistTrackFilePath(track) {
    if (typeof track === 'string') {
        return track.trim()
    }

    return typeof track?.filePath === 'string' ? track.filePath.trim() : ''
}

export function normalizeDurationValue(value) {
    const duration = Number(value)
    return Number.isFinite(duration) && duration > 0 ? duration : null
}

export function rememberPlaylistDuration(filePath, duration) {
    const normalizedFilePath = typeof filePath === 'string' ? filePath.trim() : ''
    if (!normalizedFilePath) {
        return
    }

    playlistDurationCache.delete(normalizedFilePath)
    playlistDurationCache.set(normalizedFilePath, normalizeDurationValue(duration))

    while (playlistDurationCache.size > PLAYLIST_DURATION_CACHE_LIMIT) {
        const oldestKey = playlistDurationCache.keys().next().value
        playlistDurationCache.delete(oldestKey)
    }
}

export function getPlaylistDurationProbePromise(filePath) {
    return playlistDurationProbePromises.get(filePath) || null
}

export function setPlaylistDurationProbePromise(filePath, probePromise) {
    playlistDurationProbePromises.set(filePath, probePromise)
}

export function clearPlaylistDurationProbePromise(filePath) {
    playlistDurationProbePromises.delete(filePath)
}

export function getTrackDurationState(track) {
    const storedDuration = normalizeDurationValue(track?.duration)
    if (storedDuration !== null) {
        return { known: true, duration: storedDuration }
    }

    const filePath = getPlaylistTrackFilePath(track)
    if (!filePath) {
        return { known: true, duration: null }
    }

    if (!playlistDurationCache.has(filePath)) {
        return { known: false, duration: null }
    }

    const duration = playlistDurationCache.get(filePath)
    playlistDurationCache.delete(filePath)
    playlistDurationCache.set(filePath, duration)

    return { known: true, duration }
}

export function primePlaylistDurationCache(playlists) {
    if (!Array.isArray(playlists)) {
        return
    }

    playlists.forEach((playlist) => {
        if (!Array.isArray(playlist?.tracks)) {
            return
        }

        playlist.tracks.forEach((track) => {
            const duration = normalizeDurationValue(track?.duration)
            const filePath = getPlaylistTrackFilePath(track)
            if (filePath && duration !== null) {
                rememberPlaylistDuration(filePath, duration)
            }
        })
    })
}

export function isPlaylistDurationPersisting() {
    return playlistDurationPersisting
}

export function schedulePlaylistDurationPersist() {
    playlistDurationPersistQueued = true

    if (playlistDurationPersistTimer || playlistDurationPersistInFlight) {
        return
    }

    playlistDurationPersistTimer = window.setTimeout(() => {
        flushCachedPlaylistDurations().catch((error) => {
            console.error('Failed to flush playlist durations:', error)
        })
    }, PLAYLIST_DURATION_SAVE_DEBOUNCE_MS)
}

function getCachedDuration(filePath) {
    if (!filePath || !playlistDurationCache.has(filePath)) {
        return { found: false, duration: null }
    }

    const duration = playlistDurationCache.get(filePath)
    playlistDurationCache.delete(filePath)
    playlistDurationCache.set(filePath, duration)

    return { found: true, duration }
}

function applyCachedDurationsToPlaylists(playlists) {
    let changed = false
    const updatedPlaylists = Array.isArray(playlists)
        ? playlists.map((playlist) => {
              if (!Array.isArray(playlist?.tracks)) {
                  return playlist
              }

              let tracksChanged = false
              const tracks = playlist.tracks.map((track) => {
                  const filePath = getPlaylistTrackFilePath(track)
                  const cached = getCachedDuration(filePath)
                  const duration = cached.found ? normalizeDurationValue(cached.duration) : null

                  if (
                      !filePath ||
                      duration === null ||
                      normalizeDurationValue(track?.duration) === duration
                  ) {
                      return track
                  }

                  const normalizedTrack = normalizeTrackRecord(track)
                  if (!normalizedTrack) {
                      return track
                  }

                  tracksChanged = true
                  return {
                      ...normalizedTrack,
                      duration,
                  }
              })

              if (!tracksChanged) {
                  return playlist
              }

              changed = true
              return {
                  ...playlist,
                  tracks,
              }
          })
        : []

    return { playlists: updatedPlaylists, changed }
}

async function flushCachedPlaylistDurations() {
    if (playlistDurationPersistTimer) {
        window.clearTimeout(playlistDurationPersistTimer)
        playlistDurationPersistTimer = null
    }

    if (playlistDurationPersistInFlight || !playlistDurationPersistQueued) {
        return
    }

    playlistDurationPersistQueued = false
    playlistDurationPersistInFlight = true
    playlistDurationPersisting = true

    try {
        const latestPlaylists = await sessionService.loadUserPlaylists()
        const { playlists: updatedPlaylists, changed } =
            applyCachedDurationsToPlaylists(latestPlaylists)

        if (changed) {
            await sessionService.saveUserPlaylists(updatedPlaylists)
        }
    } catch (error) {
        console.error('Failed to persist playlist durations:', error)
    } finally {
        playlistDurationPersisting = false
        playlistDurationPersistInFlight = false

        if (playlistDurationPersistQueued) {
            schedulePlaylistDurationPersist()
        }
    }
}
