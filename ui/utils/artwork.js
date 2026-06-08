import {
    DEFAULT_PLAYLIST_IMAGE,
    resolvePlaylistImage,
    resolveTrackImage,
} from './playlist-media.js'
import { normalizeTrackRecord } from './track-record.js'

export async function resolveTrackArtwork(track, { audioService = window.audioService } = {}) {
    const normalizedTrack = normalizeTrackRecord(track)
    if (!normalizedTrack?.filePath) {
        return ''
    }

    const existingImage = resolveTrackImage(normalizedTrack)
    if (existingImage) {
        return existingImage
    }

    if (typeof audioService?.resolveTrackMetadata !== 'function') {
        return ''
    }

    const metadata = await audioService.resolveTrackMetadata(normalizedTrack.filePath, {
        includeImage: true,
    })
    return metadata?.image || ''
}

export async function resolvePlaylistArtwork(
    playlist,
    { audioService = window.audioService } = {},
) {
    if (!playlist || typeof playlist !== 'object') {
        return DEFAULT_PLAYLIST_IMAGE
    }

    const existingImage = resolvePlaylistImage(playlist)
    if (existingImage && existingImage !== DEFAULT_PLAYLIST_IMAGE) {
        return existingImage
    }

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
    const firstTrack = tracks.find((track) => normalizeTrackRecord(track)?.filePath)
    const trackArtwork = firstTrack
        ? await resolveTrackArtwork(firstTrack, { audioService })
        : DEFAULT_PLAYLIST_IMAGE

    return trackArtwork || DEFAULT_PLAYLIST_IMAGE
}

export async function hydrateImageWithTrackArtwork({
    imageElement,
    track,
    audioService = window.audioService,
} = {}) {
    if (!imageElement?.isConnected) {
        return ''
    }

    const artwork = await resolveTrackArtwork(track, { audioService })
    if (artwork && imageElement.isConnected) {
        imageElement.src = artwork
    }

    return artwork
}

export async function hydrateImageWithPlaylistArtwork({
    imageElement,
    playlist,
    audioService = window.audioService,
} = {}) {
    if (!imageElement?.isConnected) {
        return ''
    }

    const artwork = await resolvePlaylistArtwork(playlist, { audioService })
    if (artwork && imageElement.isConnected) {
        imageElement.src = artwork
    }

    return artwork
}

export const artworkUtils = {
    resolveTrackArtwork,
    resolvePlaylistArtwork,
    hydrateImageWithTrackArtwork,
    hydrateImageWithPlaylistArtwork,
}

window.artworkUtils = artworkUtils
