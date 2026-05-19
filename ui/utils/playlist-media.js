export const DEFAULT_PLAYLIST_IMAGE = './assets/music-placeholder.png'

export function resolveTrackImage(track) {
    if (!track || typeof track !== 'object') {
        return ''
    }

    const candidates = [track.image, track.artwork, track.cover, track.picture]
    const match = candidates.find((value) => typeof value === 'string' && value.trim())
    return match ? match.trim() : ''
}

export function resolvePlaylistImage(playlist) {
    if (!playlist || typeof playlist !== 'object') {
        return DEFAULT_PLAYLIST_IMAGE
    }

    if (typeof playlist.banner === 'string' && playlist.banner.trim()) {
        return playlist.banner.trim()
    }

    const firstTrackWithImage = Array.isArray(playlist.tracks)
        ? playlist.tracks.find((track) => Boolean(resolveTrackImage(track)))
        : null

    return resolveTrackImage(firstTrackWithImage) || DEFAULT_PLAYLIST_IMAGE
}

export function extractPlaylistFilePaths(playlist) {
    if (!playlist || !Array.isArray(playlist.tracks)) {
        return []
    }

    return playlist.tracks.map((track) => track?.filePath).filter(Boolean)
}

export const playlistMediaUtils = {
    DEFAULT_PLAYLIST_IMAGE,
    resolveTrackImage,
    resolvePlaylistImage,
    extractPlaylistFilePaths,
}

window.playlistMediaUtils = playlistMediaUtils
