import { getBaseName } from './file-path.js'

export const DEFAULT_TRACK_TITLE = 'Unknown Title'
export const DEFAULT_TRACK_ARTIST = 'Unknown Artist'
export const DEFAULT_TRACK_ALBUM = 'Unknown Album'
export const DEFAULT_TRACK_IMAGE = ''

export function normalizeTrackRecord(track) {
    if (!track) {
        return null
    }

    const filePath =
        typeof track === 'string'
            ? track.trim()
            : typeof track?.filePath === 'string'
              ? track.filePath.trim()
              : ''

    if (!filePath) {
        return null
    }

    const sourceTrack = typeof track === 'object' ? track : {}
    const normalizedTrack = {
        ...sourceTrack,
        filePath,
        title:
            typeof sourceTrack?.title === 'string' && sourceTrack.title.trim()
                ? sourceTrack.title.trim()
                : getBaseName(filePath, DEFAULT_TRACK_TITLE),
        artist:
            typeof sourceTrack?.artist === 'string' && sourceTrack.artist.trim()
                ? sourceTrack.artist.trim()
                : DEFAULT_TRACK_ARTIST,
        album:
            typeof sourceTrack?.album === 'string' && sourceTrack.album.trim()
                ? sourceTrack.album.trim()
                : DEFAULT_TRACK_ALBUM,
        image: typeof sourceTrack?.image === 'string' ? sourceTrack.image : DEFAULT_TRACK_IMAGE,
    }

    if (typeof normalizedTrack.playedAt !== 'string') {
        delete normalizedTrack.playedAt
    }

    if (typeof normalizedTrack.addedAt !== 'string') {
        delete normalizedTrack.addedAt
    }

    return normalizedTrack
}

export const trackRecordUtils = {
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
    DEFAULT_TRACK_ALBUM,
    DEFAULT_TRACK_IMAGE,
    normalizeTrackRecord,
}

window.trackRecordUtils = trackRecordUtils
