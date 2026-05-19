import { resolvePlaylistImage } from '../../utils/playlist-media.js'
import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
} from '../../utils/track-record.js'

// Build a node (DocumentFragment or element) for recent tracks list
export function buildRecentTracksListNode({ tracks, showActions = true, userPlaylists = [] } = {}) {
    const fragment = document.createDocumentFragment()
    if (!Array.isArray(tracks) || tracks.length === 0) {
        const p = document.createElement('p')
        p.className = 'noRecentMusic'
        p.textContent = 'No recently played tracks'
        fragment.appendChild(p)
        return fragment
    }

    const canAddToExistingPlaylist = Array.isArray(userPlaylists) && userPlaylists.length > 0
    const ul = document.createElement('ul')
    ul.className = 'recentMusicList'

    tracks.forEach((track, index) => {
        const normalizedTrack = normalizeTrackRecord(track)
        if (!normalizedTrack?.filePath) {
            return
        }

        const title = normalizedTrack.title || DEFAULT_TRACK_TITLE
        const artist = normalizedTrack.artist || DEFAULT_TRACK_ARTIST
        const image = normalizedTrack.image || './assets/music-placeholder.png'

        const li = document.createElement('li')
        li.className = 'recentTrack'
        li.setAttribute('data-track-index', String(index))

        const cover = document.createElement('div')
        cover.className = 'trackCover'
        const img = document.createElement('img')
        img.src = String(image)
        img.alt = title
        cover.appendChild(img)

        const details = document.createElement('div')
        details.className = 'trackDetails'
        const titleDiv = document.createElement('div')
        titleDiv.className = 'trackTitle'
        titleDiv.textContent = title
        const artistDiv = document.createElement('div')
        artistDiv.className = 'trackArtist'
        artistDiv.textContent = artist
        details.appendChild(titleDiv)
        details.appendChild(artistDiv)

        li.appendChild(cover)
        li.appendChild(details)

        if (showActions) {
            const actions = document.createElement('div')
            actions.className = 'trackMoreActions'

            const moreBtn = document.createElement('button')
            moreBtn.type = 'button'
            moreBtn.className = 'trackMoreBtn'
            moreBtn.setAttribute('data-track-index', String(index))
            moreBtn.setAttribute('aria-label', 'Playlist actions')
            const icon = document.createElement('i')
            icon.setAttribute('data-lucide', 'ellipsis')
            moreBtn.appendChild(icon)

            const menu = document.createElement('div')
            menu.className = 'trackActionsMenu'
            menu.setAttribute('data-track-index', String(index))

            if (canAddToExistingPlaylist) {
                const addBtn = document.createElement('button')
                addBtn.type = 'button'
                addBtn.className = 'addToPlaylistBtn'
                addBtn.setAttribute('data-track-index', String(index))
                addBtn.textContent = 'Add to Playlist'
                menu.appendChild(addBtn)
            }

            const createBtn = document.createElement('button')
            createBtn.type = 'button'
            createBtn.className = 'createPlaylistBtn'
            createBtn.setAttribute('data-track-index', String(index))
            createBtn.textContent = 'Create New Playlist'
            menu.appendChild(createBtn)

            actions.appendChild(moreBtn)
            actions.appendChild(menu)
            li.appendChild(actions)
        }

        ul.appendChild(li)
    })

    fragment.appendChild(ul)
    return fragment
}

export function buildRecentPlaylistsListNode({ playlists, showActions = true } = {}) {
    const fragment = document.createDocumentFragment()
    if (!Array.isArray(playlists) || playlists.length === 0) {
        const p = document.createElement('p')
        p.className = 'noRecentPlaylists'
        p.textContent = 'No recent playlists yet. Use Select Folder to create one.'
        fragment.appendChild(p)
        return fragment
    }

    const ul = document.createElement('ul')
    ul.className = 'recentPlaylistList'

    playlists.forEach((playlist, index) => {
        const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
        const playlistImage = resolvePlaylistImage(playlist)

        const li = document.createElement('li')
        li.className = 'recentPlaylistCard'
        li.setAttribute('data-playlist-index', String(index))

        const img = document.createElement('img')
        img.className = 'recentPlaylistCover'
        img.src = String(playlistImage)
        img.alt = playlist.name || 'Folder Playlist'

        const info = document.createElement('div')
        info.className = 'recentPlaylistInfo'
        const nameP = document.createElement('p')
        nameP.className = 'recentPlaylistName'
        nameP.textContent = playlist.name || 'Folder Playlist'
        const metaP = document.createElement('p')
        metaP.className = 'recentPlaylistMeta'
        metaP.textContent = `${trackCount} songs`
        info.appendChild(nameP)
        info.appendChild(metaP)

        li.appendChild(img)
        li.appendChild(info)

        if (showActions) {
            const actions = document.createElement('div')
            actions.className = 'recentPlaylistActions'

            const viewBtn = document.createElement('button')
            viewBtn.type = 'button'
            viewBtn.className = 'recentPlaylistViewBtn'
            viewBtn.setAttribute('data-playlist-index', String(index))
            viewBtn.textContent = 'View Songs'

            const moreBtn = document.createElement('button')
            moreBtn.type = 'button'
            moreBtn.className = 'recentFolderMoreBtn'
            moreBtn.setAttribute('data-playlist-index', String(index))
            moreBtn.setAttribute('aria-label', 'Folder playlist actions')
            const icon = document.createElement('i')
            icon.setAttribute('data-lucide', 'ellipsis')
            moreBtn.appendChild(icon)

            const menu = document.createElement('div')
            menu.className = 'recentFolderActionsMenu'
            menu.setAttribute('data-playlist-index', String(index))

            const addAllBtn = document.createElement('button')
            addAllBtn.type = 'button'
            addAllBtn.className = 'addAllToPlaylistBtn'
            addAllBtn.setAttribute('data-playlist-index', String(index))
            addAllBtn.textContent = 'Add All to Playlist'

            const createFromFolderBtn = document.createElement('button')
            createFromFolderBtn.type = 'button'
            createFromFolderBtn.className = 'createPlaylistFromFolderBtn'
            createFromFolderBtn.setAttribute('data-playlist-index', String(index))
            createFromFolderBtn.textContent = 'Create New Playlist'

            menu.appendChild(addAllBtn)
            menu.appendChild(createFromFolderBtn)

            actions.appendChild(viewBtn)
            actions.appendChild(moreBtn)
            actions.appendChild(menu)
            li.appendChild(actions)
        }

        ul.appendChild(li)
    })

    fragment.appendChild(ul)
    return fragment
}

export function buildTabContentNode(
    activeTab,
    { recentFolderPlaylists = [], recentTracks = [], userPlaylists = [] } = {},
) {
    const fragment = document.createDocumentFragment()

    if (activeTab === 'playlist') {
        const section = document.createElement('section')
        section.className = 'recentSection'
        section.appendChild(buildRecentPlaylistsListNode({ playlists: recentFolderPlaylists }))
        fragment.appendChild(section)
        return fragment
    }

    if (activeTab === 'music') {
        const section = document.createElement('section')
        section.className = 'recentSection'
        section.appendChild(buildRecentTracksListNode({ tracks: recentTracks, userPlaylists }))
        fragment.appendChild(section)
        return fragment
    }

    const sectionPlaylists = document.createElement('section')
    sectionPlaylists.className = 'recentSection'
    const h3p = document.createElement('h3')
    h3p.className = 'recentSectionTitle'
    h3p.textContent = 'Recent Playlists'
    sectionPlaylists.appendChild(h3p)
    sectionPlaylists.appendChild(buildRecentPlaylistsListNode({ playlists: recentFolderPlaylists }))

    const sectionMusic = document.createElement('section')
    sectionMusic.className = 'recentSection'
    const h3m = document.createElement('h3')
    h3m.className = 'recentSectionTitle'
    h3m.textContent = 'Recent Music'
    sectionMusic.appendChild(h3m)
    sectionMusic.appendChild(buildRecentTracksListNode({ tracks: recentTracks, userPlaylists }))

    fragment.appendChild(sectionPlaylists)
    fragment.appendChild(sectionMusic)
    return fragment
}
