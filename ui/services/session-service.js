import { getBaseName } from '../utils/file-path.js'
import { normalizePlaylistImageValue, resolveTrackImage } from '../utils/playlist-media.js'
import { normalizeTrackRecord } from '../utils/track-record.js'

export const sessionService = (() => {
    const DEFAULT_VOLUME = 0.7
    const MAX_RECENT_TRACKS = 10
    const MAX_RECENT_FOLDER_PLAYLISTS = 8
    const MAX_RECENT_FOLDER_TRACKS = 300
    const USER_PLAYLISTS_KEY = 'musichub:user-playlists'
    //storing data under C:\Users\<user>\AppData\Roaming\Blueberry Music Player\
    const RECENT_FOLDER_PLAYLISTS_KEY = 'musichub:recent-folder-playlists'
    const EMBEDDED_IMAGE_PREFIX = 'data:image/'

    function compactStorageValue(key, normalized) {
        window.setTimeout(() => {
            try {
                window.localStorage.setItem(key, JSON.stringify(normalized))
            } catch (error) {
                console.error('Failed to compact stored playlist data:', error)
            }
        }, 0)
    }

    function normalizeRecentFolderPlaylistTracks(tracks) {
        if (!Array.isArray(tracks)) {
            return []
        }

        const uniqueTrackPaths = new Set()
        return tracks
            .map((track) => normalizeTrackRecord(track))
            .filter((track) => {
                if (!track?.filePath || uniqueTrackPaths.has(track.filePath)) {
                    return false
                }

                uniqueTrackPaths.add(track.filePath)
                return true
            })
            .slice(0, MAX_RECENT_FOLDER_TRACKS)
    }

    function resolveStoredPlaylistCover(playlist) {
        return (
            normalizePlaylistImageValue(playlist?.cover) ||
            normalizePlaylistImageValue(playlist?.fallbackCover) ||
            normalizePlaylistImageValue(playlist?.image) ||
            normalizePlaylistImageValue(playlist?.artwork)
        )
    }

    function resolveFirstTrackCover(tracks) {
        if (!Array.isArray(tracks)) {
            return ''
        }

        return (
            tracks
                .map((track) => normalizePlaylistImageValue(resolveTrackImage(track)))
                .find(Boolean) || ''
        )
    }

    function parseIsoDateToNumber(value) {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    function normalizeRecentFolderPlaylists(playlists) {
        if (!Array.isArray(playlists)) {
            return []
        }

        return playlists
            .map((playlist) => {
                const folderPath =
                    typeof playlist?.folderPath === 'string' ? playlist.folderPath.trim() : ''
                if (!folderPath) {
                    return null
                }

                const tracks = normalizeRecentFolderPlaylistTracks(playlist?.tracks)
                if (!tracks.length) {
                    return null
                }

                const cover = resolveStoredPlaylistCover(playlist) || resolveFirstTrackCover(tracks)
                const now = new Date().toISOString()
                return {
                    id:
                        typeof playlist?.id === 'string' && playlist.id.trim()
                            ? playlist.id.trim()
                            : `recent-folder-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                    folderPath,
                    name:
                        typeof playlist?.name === 'string' && playlist.name.trim()
                            ? playlist.name.trim()
                            : getBaseName(folderPath, 'Folder Playlist'),
                    cover,
                    tracks,
                    createdAt: typeof playlist?.createdAt === 'string' ? playlist.createdAt : now,
                    updatedAt: typeof playlist?.updatedAt === 'string' ? playlist.updatedAt : now,
                }
            })
            .filter(Boolean)
            .sort((a, b) => parseIsoDateToNumber(b.updatedAt) - parseIsoDateToNumber(a.updatedAt))
            .slice(0, MAX_RECENT_FOLDER_PLAYLISTS)
    }

    function normalizeVolume(value) {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return DEFAULT_VOLUME
        return Math.max(0, Math.min(1, parsed))
    }

    function hasAPI(methodName) {
        return typeof window.electronAPI?.[methodName] === 'function'
    }

    async function loadSavedVolume() {
        if (!hasAPI('getSavedVolume')) {
            return DEFAULT_VOLUME
        }

        try {
            const value = await window.electronAPI.getSavedVolume()
            return normalizeVolume(value)
        } catch (error) {
            console.error('Failed to load saved volume:', error)
            return DEFAULT_VOLUME
        }
    }

    async function saveVolume(volume) {
        if (!hasAPI('saveVolume')) {
            return false
        }

        try {
            await window.electronAPI.saveVolume(normalizeVolume(volume))
            return true
        } catch (error) {
            console.error('Failed to persist volume:', error)
            return false
        }
    }

    async function loadPlaylist() {
        if (!hasAPI('loadPlaylist')) {
            return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
        }

        try {
            const result = await window.electronAPI.loadPlaylist()
            const playbackPosition = Number(result?.playbackPosition)
            return {
                playlist: Array.isArray(result?.playlist) ? result.playlist : [],
                currentTrackIndex: Number.isInteger(result?.currentTrackIndex)
                    ? result.currentTrackIndex
                    : -1,
                playbackPosition:
                    Number.isFinite(playbackPosition) && playbackPosition >= 0
                        ? playbackPosition
                        : 0,
            }
        } catch (error) {
            console.error('Failed to load playlist:', error)
            return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
        }
    }

    async function savePlaylist(playlist, currentTrackIndex, playbackPosition = 0) {
        if (!hasAPI('savePlaylist')) {
            return false
        }

        try {
            const safePlaylist = Array.isArray(playlist) ? playlist : []
            const safeIndex = Number.isInteger(currentTrackIndex) ? currentTrackIndex : -1
            const parsedPosition = Number(playbackPosition)
            const safePlaybackPosition =
                Number.isFinite(parsedPosition) && parsedPosition >= 0 ? parsedPosition : 0
            const saved = await window.electronAPI.savePlaylist(
                safePlaylist,
                safeIndex,
                safePlaybackPosition,
            )
            return Boolean(saved)
        } catch (error) {
            console.error('Failed to persist playlist:', error)
            return false
        }
    }

    async function savePlaybackPosition(currentTrackIndex, playbackPosition = 0) {
        if (!hasAPI('savePlaybackPosition')) {
            return false
        }

        try {
            return Boolean(
                await window.electronAPI.savePlaybackPosition(
                    Number.isInteger(currentTrackIndex) ? currentTrackIndex : -1,
                    Math.max(0, Number(playbackPosition) || 0),
                ),
            )
        } catch (error) {
            console.error('Failed to persist playback position:', error)
            return false
        }
    }

    async function loadRecentTracks() {
        if (!hasAPI('loadRecentTracks')) {
            return []
        }

        try {
            const tracks = await window.electronAPI.loadRecentTracks()
            return Array.isArray(tracks)
                ? tracks.map((track) => normalizeTrackRecord(track)).filter(Boolean)
                : []
        } catch (error) {
            console.error('Failed to load recent tracks:', error)
            return []
        }
    }

    async function saveRecentTracks(tracks) {
        if (!hasAPI('saveRecentTracks')) {
            return false
        }

        try {
            const safeTracks = Array.isArray(tracks)
                ? tracks
                      .map((track) => normalizeTrackRecord(track))
                      .filter(Boolean)
                      .slice(0, MAX_RECENT_TRACKS)
                : []
            const saved = await window.electronAPI.saveRecentTracks(safeTracks)
            if (saved) {
                window.dispatchEvent(new CustomEvent('recent-tracks:updated'))
            }
            return Boolean(saved)
        } catch (error) {
            console.error('Failed to save recent tracks:', error)
            return false
        }
    }

    async function prependRecentTrack(track) {
        if (!track?.filePath) {
            return false
        }

        const recent = await loadRecentTracks()
        const updated = [track, ...recent].filter(
            (item, index, self) =>
                index === self.findIndex((entry) => entry.filePath === item.filePath),
        )

        return saveRecentTracks(updated)
    }

    async function approveRecentAudioPath(filePath) {
        if (!hasAPI('approveRecentAudioPath')) {
            return false
        }

        try {
            return Boolean(await window.electronAPI.approveRecentAudioPath(filePath))
        } catch (error) {
            console.error('Failed to approve recent audio path:', error)
            return false
        }
    }

    function normalizeUserPlaylists(playlists, { initializeMissingCovers = false } = {}) {
        if (!Array.isArray(playlists)) {
            return []
        }

        return playlists
            .map((playlist) => {
                const tracks = Array.isArray(playlist?.tracks)
                    ? playlist.tracks.map((track) => normalizeTrackRecord(track)).filter(Boolean)
                    : []
                const cover =
                    resolveStoredPlaylistCover(playlist) ||
                    (initializeMissingCovers ? resolveFirstTrackCover(tracks) : '')

                return {
                    id:
                        typeof playlist?.id === 'string'
                            ? playlist.id
                            : `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                    name:
                        typeof playlist?.name === 'string' && playlist.name.trim()
                            ? playlist.name.trim()
                            : 'Untitled Playlist',
                    banner: normalizePlaylistImageValue(playlist?.banner),
                    cover,
                    tracks,
                    createdAt:
                        typeof playlist?.createdAt === 'string'
                            ? playlist.createdAt
                            : new Date().toISOString(),
                    updatedAt:
                        typeof playlist?.updatedAt === 'string'
                            ? playlist.updatedAt
                            : new Date().toISOString(),
                }
            })
            .filter((playlist) => Boolean(playlist.id))
    }

    async function loadUserPlaylists() {
        try {
            const raw = window.localStorage.getItem(USER_PLAYLISTS_KEY)
            if (!raw) {
                return []
            }

            const parsed = JSON.parse(raw)
            const normalized = normalizeUserPlaylists(parsed, { initializeMissingCovers: true })
            const initializedCovers = normalized.some(
                (playlist, index) => playlist.cover && !resolveStoredPlaylistCover(parsed[index]),
            )
            if (raw.includes(EMBEDDED_IMAGE_PREFIX) || initializedCovers) {
                compactStorageValue(USER_PLAYLISTS_KEY, normalized)
            }
            return normalized
        } catch (error) {
            console.error('Failed to load user playlists:', error)
            return []
        }
    }

    async function saveUserPlaylists(playlists) {
        try {
            const normalized = normalizeUserPlaylists(playlists)
            window.localStorage.setItem(USER_PLAYLISTS_KEY, JSON.stringify(normalized))
            window.dispatchEvent(new CustomEvent('user-playlists:updated'))
            return true
        } catch (error) {
            console.error('Failed to save user playlists:', error)
            return false
        }
    }

    async function addTrackToUserPlaylist(playlistId, track) {
        if (!playlistId) {
            return false
        }

        return addTracksToUserPlaylist(playlistId, [track])
    }

    async function addTracksToUserPlaylist(playlistId, tracks) {
        if (!playlistId || !Array.isArray(tracks)) {
            return false
        }

        const normalizedTracks = tracks.map((track) => normalizeTrackRecord(track)).filter(Boolean)
        if (!normalizedTracks.length) {
            return false
        }

        const playlists = await loadUserPlaylists()
        const target = playlists.find((playlist) => playlist.id === playlistId)
        if (!target) {
            return false
        }

        if (!Array.isArray(target.tracks)) {
            target.tracks = []
        }

        const existingTrackPaths = new Set(
            target.tracks.map((item) => item?.filePath).filter(Boolean),
        )
        let appended = false
        normalizedTracks.forEach((track) => {
            if (existingTrackPaths.has(track.filePath)) {
                return
            }

            target.tracks.push(track)
            existingTrackPaths.add(track.filePath)
            appended = true
        })

        if (appended) {
            if (!target.banner && !target.cover) {
                target.cover = resolveFirstTrackCover(target.tracks)
            }
            target.updatedAt = new Date().toISOString()
        }

        return saveUserPlaylists(playlists)
    }

    async function createUserPlaylist({ name, banner = '' }) {
        const playlists = await loadUserPlaylists()
        const now = new Date().toISOString()
        const safeBanner = normalizePlaylistImageValue(banner)
        const newPlaylist = {
            id: `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            name:
                typeof name === 'string' && name.trim()
                    ? name.trim()
                    : `New Playlist ${playlists.length + 1}`,
            banner: safeBanner,
            cover: '',
            tracks: [],
            createdAt: now,
            updatedAt: now,
        }

        const saved = await saveUserPlaylists([newPlaylist, ...playlists])
        return saved ? newPlaylist : null
    }

    async function createPlaylistAndAddTrack({ name, banner = '', track }) {
        return createUserPlaylistWithTracks({
            name,
            banner,
            tracks: [track],
        })
    }

    async function createUserPlaylistWithTracks({ name, banner = '', tracks = [] }) {
        const normalizedTracks = tracks.map((track) => normalizeTrackRecord(track)).filter(Boolean)

        const uniqueTrackPaths = new Set()
        const uniqueTracks = normalizedTracks.filter((track) => {
            if (uniqueTrackPaths.has(track.filePath)) {
                return false
            }

            uniqueTrackPaths.add(track.filePath)
            return true
        })

        if (!uniqueTracks.length) {
            return null
        }

        const playlists = await loadUserPlaylists()
        const now = new Date().toISOString()
        const safeBanner = normalizePlaylistImageValue(banner)
        const newPlaylist = {
            id: `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            name:
                typeof name === 'string' && name.trim()
                    ? name.trim()
                    : `New Playlist ${playlists.length + 1}`,
            banner: safeBanner,
            cover: safeBanner ? '' : resolveFirstTrackCover(uniqueTracks),
            tracks: uniqueTracks,
            createdAt: now,
            updatedAt: now,
        }

        const saved = await saveUserPlaylists([newPlaylist, ...playlists])
        return saved ? newPlaylist : null
    }

    async function loadRecentFolderPlaylists() {
        try {
            const raw = window.localStorage.getItem(RECENT_FOLDER_PLAYLISTS_KEY)
            if (!raw) {
                return []
            }

            const parsed = JSON.parse(raw)
            const normalized = normalizeRecentFolderPlaylists(parsed)
            if (raw.includes(EMBEDDED_IMAGE_PREFIX)) {
                compactStorageValue(RECENT_FOLDER_PLAYLISTS_KEY, normalized)
            }
            return normalized
        } catch (error) {
            console.error('Failed to load recent folder playlists:', error)
            return []
        }
    }

    async function saveRecentFolderPlaylists(playlists) {
        try {
            const normalized = normalizeRecentFolderPlaylists(playlists)
            window.localStorage.setItem(RECENT_FOLDER_PLAYLISTS_KEY, JSON.stringify(normalized))
            window.dispatchEvent(new CustomEvent('recent-folder-playlists:updated'))
            return true
        } catch (error) {
            console.error('Failed to save recent folder playlists:', error)
            return false
        }
    }

    async function prependRecentFolderPlaylist({ folderPath, name, tracks }) {
        const safeFolderPath = typeof folderPath === 'string' ? folderPath.trim() : ''
        if (!safeFolderPath) {
            return null
        }

        const normalizedTracks = normalizeRecentFolderPlaylistTracks(tracks)
        if (!normalizedTracks.length) {
            return null
        }

        const recentFolderPlaylists = await loadRecentFolderPlaylists()
        const now = new Date().toISOString()
        const fallbackName = getBaseName(safeFolderPath, 'Folder Playlist')
        const safeName = typeof name === 'string' && name.trim() ? name.trim() : fallbackName
        const existing = recentFolderPlaylists.find(
            (playlist) => playlist.folderPath === safeFolderPath,
        )

        const nextEntry = existing
            ? {
                  ...existing,
                  name: safeName,
                  cover: existing.cover || resolveFirstTrackCover(normalizedTracks),
                  tracks: normalizedTracks,
                  updatedAt: now,
              }
            : {
                  id: `recent-folder-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                  folderPath: safeFolderPath,
                  name: safeName,
                  cover: resolveFirstTrackCover(normalizedTracks),
                  tracks: normalizedTracks,
                  createdAt: now,
                  updatedAt: now,
              }

        const nextRecentFolderPlaylists = [
            nextEntry,
            ...recentFolderPlaylists.filter((playlist) => playlist.folderPath !== safeFolderPath),
        ].slice(0, MAX_RECENT_FOLDER_PLAYLISTS)

        const saved = await saveRecentFolderPlaylists(nextRecentFolderPlaylists)
        return saved ? nextEntry : null
    }

    return {
        loadSavedVolume,
        saveVolume,
        loadPlaylist,
        savePlaylist,
        savePlaybackPosition,
        loadRecentTracks,
        saveRecentTracks,
        prependRecentTrack,
        approveRecentAudioPath,
        loadUserPlaylists,
        saveUserPlaylists,
        addTrackToUserPlaylist,
        addTracksToUserPlaylist,
        createUserPlaylist,
        createUserPlaylistWithTracks,
        createPlaylistAndAddTrack,
        loadRecentFolderPlaylists,
        saveRecentFolderPlaylists,
        prependRecentFolderPlaylist,
    }
})()

window.sessionService = sessionService
