import { getDataAttributeIndex } from '../../utils/dom-helpers.js'

export function resolveTrackFromActionButton(button, tracks) {
    if (!button || !Array.isArray(tracks)) {
        return null
    }

    const trackIndex = getDataAttributeIndex(button, 'data-track-index')
    if (trackIndex === null) {
        return null
    }

    const track = tracks[trackIndex]
    if (!track?.filePath) {
        return null
    }

    return track
}

export function resolveRecentPlaylistFromActionButton(button, playlists) {
    if (!button || !Array.isArray(playlists)) {
        return null
    }

    const playlistIndex = getDataAttributeIndex(button, 'data-playlist-index')
    if (playlistIndex === null) {
        return null
    }

    const playlist = playlists[playlistIndex]
    if (!playlist || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        return null
    }

    return playlist
}
