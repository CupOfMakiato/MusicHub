import { sessionService } from '../../services/session-service.js'
import { normalizePlaylistImageValue, resolveTrackImage } from '../../utils/playlist-media.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'
import { getPlaylistTrackFilePath } from './playlist-duration-cache.js'

const PLAYLIST_ARTWORK_CACHE_LIMIT = 1000
const PLAYLIST_ARTWORK_SAVE_DEBOUNCE_MS = 1000

const playlistArtworkCache = new Map()
const playlistArtworkResolvePromises = new Map()

let playlistArtworkPersistTimer = null
let playlistArtworkPersistQueued = false
let playlistArtworkPersistInFlight = false
let playlistArtworkPersisting = false

export function normalizeArtworkValue(value) {
    return normalizePlaylistImageValue(value)
}

export function rememberTrackArtwork(filePath, artwork) {
    const normalizedFilePath = typeof filePath === 'string' ? filePath.trim() : ''
    const image = normalizeArtworkValue(artwork)
    if (!normalizedFilePath || !image) {
        return ''
    }

    playlistArtworkCache.delete(normalizedFilePath)
    playlistArtworkCache.set(normalizedFilePath, image)

    while (playlistArtworkCache.size > PLAYLIST_ARTWORK_CACHE_LIMIT) {
        const oldestKey = playlistArtworkCache.keys().next().value
        playlistArtworkCache.delete(oldestKey)
    }

    return image
}

export function getCachedTrackArtwork(track) {
    const existingImage = normalizeArtworkValue(resolveTrackImage(track))
    if (existingImage) {
        return existingImage
    }

    const filePath = getPlaylistTrackFilePath(track)
    if (!filePath || !playlistArtworkCache.has(filePath)) {
        return ''
    }

    const image = playlistArtworkCache.get(filePath)
    playlistArtworkCache.delete(filePath)
    playlistArtworkCache.set(filePath, image)

    return image
}

export function primePlaylistArtworkCache(playlists) {
    if (!Array.isArray(playlists)) {
        return
    }

    playlists.forEach((playlist) => {
        if (!Array.isArray(playlist?.tracks)) {
            return
        }

        playlist.tracks.forEach((track) => {
            const filePath = getPlaylistTrackFilePath(track)
            const artwork = normalizeArtworkValue(resolveTrackImage(track))
            if (filePath && artwork) {
                rememberTrackArtwork(filePath, artwork)
            }
        })
    })
}

export function getTrackArtworkResolvePromise(filePath) {
    return playlistArtworkResolvePromises.get(filePath) || null
}

export function setTrackArtworkResolvePromise(filePath, resolvePromise) {
    playlistArtworkResolvePromises.set(filePath, resolvePromise)
}

export function clearTrackArtworkResolvePromise(filePath) {
    playlistArtworkResolvePromises.delete(filePath)
}

export function isPlaylistArtworkPersisting() {
    return playlistArtworkPersisting
}

export function schedulePlaylistArtworkPersist() {
    playlistArtworkPersistQueued = true

    if (playlistArtworkPersistTimer || playlistArtworkPersistInFlight) {
        return
    }

    playlistArtworkPersistTimer = window.setTimeout(() => {
        flushCachedPlaylistArtwork().catch((error) => {
            console.error('Failed to flush playlist artwork:', error)
        })
    }, PLAYLIST_ARTWORK_SAVE_DEBOUNCE_MS)
}

function getCachedArtworkByFilePath(filePath) {
    if (!filePath || !playlistArtworkCache.has(filePath)) {
        return ''
    }

    const image = playlistArtworkCache.get(filePath)
    playlistArtworkCache.delete(filePath)
    playlistArtworkCache.set(filePath, image)

    return image
}

function applyCachedArtworkToPlaylists(playlists) {
    let changed = false
    const updatedPlaylists = Array.isArray(playlists)
        ? playlists.map((playlist) => {
              if (!Array.isArray(playlist?.tracks)) {
                  return playlist
              }

              let tracksChanged = false
              const tracks = playlist.tracks.map((track) => {
                  const filePath = getPlaylistTrackFilePath(track)
                  const artwork = getCachedArtworkByFilePath(filePath)

                  if (
                      !filePath ||
                      !artwork ||
                      normalizeArtworkValue(resolveTrackImage(track)) === artwork
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
                      image: artwork,
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

async function flushCachedPlaylistArtwork() {
    if (playlistArtworkPersistTimer) {
        window.clearTimeout(playlistArtworkPersistTimer)
        playlistArtworkPersistTimer = null
    }

    if (playlistArtworkPersistInFlight || !playlistArtworkPersistQueued) {
        return
    }

    playlistArtworkPersistQueued = false
    playlistArtworkPersistInFlight = true
    playlistArtworkPersisting = true

    try {
        const latestPlaylists = await sessionService.loadUserPlaylists()
        const { playlists: updatedPlaylists, changed } =
            applyCachedArtworkToPlaylists(latestPlaylists)

        if (changed) {
            await sessionService.saveUserPlaylists(updatedPlaylists)
        }
    } catch (error) {
        console.error('Failed to persist playlist artwork:', error)
    } finally {
        playlistArtworkPersisting = false
        playlistArtworkPersistInFlight = false

        if (playlistArtworkPersistQueued) {
            schedulePlaylistArtworkPersist()
        }
    }
}
