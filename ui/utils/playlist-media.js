export const DEFAULT_PLAYLIST_IMAGE = './assets/music-placeholder.png'

export function normalizePlaylistImageValue(value) {
    if (typeof value !== 'string') {
        return ''
    }

    const image = value.trim()
    if (!image || image.startsWith('data:image/')) {
        return ''
    }

    return image
}

export function resolveTrackImage(track) {
    if (!track || typeof track !== 'object') {
        return ''
    }

    const candidates = [track.image, track.artwork, track.cover, track.picture]
    return candidates.map(normalizePlaylistImageValue).find(Boolean) || ''
}

export function resolvePlaylistCover(playlist) {
    if (!playlist || typeof playlist !== 'object') {
        return ''
    }

    const candidates = [playlist.cover, playlist.fallbackCover, playlist.image, playlist.artwork]
    return candidates.map(normalizePlaylistImageValue).find(Boolean) || ''
}

export function resolvePlaylistImage(playlist) {
    if (!playlist || typeof playlist !== 'object') {
        return DEFAULT_PLAYLIST_IMAGE
    }

    const banner = normalizePlaylistImageValue(playlist.banner)
    if (banner) {
        return banner
    }

    const cover = resolvePlaylistCover(playlist)
    if (cover) {
        return cover
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
    normalizePlaylistImageValue,
    resolveTrackImage,
    resolvePlaylistCover,
    resolvePlaylistImage,
    extractPlaylistFilePaths,
}

window.playlistMediaUtils = playlistMediaUtils
