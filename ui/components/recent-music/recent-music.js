import {
    escapeHtml,
    attachIndexedMenuToggle,
    placeFloatingElement,
    bindGlobalDismissEvents,
    getDataAttributeIndex,
    openModal,
    closeModalHost,
    showModalPrompt,
    bindModalResolve,
    bindImageFallbacks,
} from '../../utils/dom-helpers.js'
import { resolvePlaylistImage } from '../../utils/playlist-media.js'
import { getBaseName } from '../../utils/file-path.js'
import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
    DEFAULT_TRACK_ALBUM,
} from '../../utils/track-record.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'

const RECENT_TABS = new Set(['all', 'playlist', 'music'])
const VIEW_SONGS_METADATA_DEBUG_ENABLED = false
const VIEW_SONGS_METADATA_WORKERS = 4

export function initializeRecentMusic() {
    const recentMusic = document.getElementById('recent-music')
    if (!recentMusic) {
        console.error('Recent music element not found')
        return
    }

    let latestRefreshId = 0
    let cleanupTrackMenuToggles = null
    let cleanupRecentPlaylistMenuToggles = null
    let cleanupGlobalMenuDismiss = null
    let activeTab = 'all'

    let recentTracks = []
    let recentFolderPlaylists = []
    let userPlaylists = []

    function normalizeTab(tab) {
        return RECENT_TABS.has(tab) ? tab : 'all'
    }

    function clearMenuToggleBindings() {
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }

        if (typeof cleanupRecentPlaylistMenuToggles === 'function') {
            cleanupRecentPlaylistMenuToggles()
            cleanupRecentPlaylistMenuToggles = null
        }
    }

    function resetActionsMenuPosition(menu) {
        if (!menu) {
            return
        }

        menu.style.position = ''
        menu.style.top = ''
        menu.style.left = ''
        menu.style.right = ''
        menu.style.zIndex = ''
    }

    function positionActionsMenu({ button, menuSelector, indexAttribute }) {
        if (!button || !menuSelector || !indexAttribute) {
            return
        }

        const menuIndex = button.getAttribute(indexAttribute)
        if (!menuIndex) {
            return
        }

        const safeMenuIndex =
            typeof window.CSS?.escape === 'function' ? window.CSS.escape(menuIndex) : menuIndex

        const menu = recentMusic.querySelector(
            `${menuSelector}[${indexAttribute}="${safeMenuIndex}"]`,
        )
        if (!menu || !menu.classList.contains('is-open')) {
            return
        }

        menu.style.position = 'fixed'
        menu.style.right = 'auto'
        menu.style.zIndex = '2200'

        const buttonRect = button.getBoundingClientRect()
        const menuWidth = menu.offsetWidth || 210
        const menuHeight = menu.offsetHeight || 100
        const viewportPadding = 8

        let left = buttonRect.right - menuWidth
        left = Math.max(
            viewportPadding,
            Math.min(left, window.innerWidth - menuWidth - viewportPadding),
        )

        let top = buttonRect.bottom + 6
        if (top + menuHeight > window.innerHeight - viewportPadding) {
            top = Math.max(viewportPadding, buttonRect.top - menuHeight - 6)
        }

        placeFloatingElement({
            element: menu,
            left,
            top,
            widthFallback: menuWidth,
            heightFallback: menuHeight,
            padding: viewportPadding,
            position: 'fixed',
        })
    }

    function closeAllActionMenus() {
        const openMenus = recentMusic.querySelectorAll(
            '.trackActionsMenu.is-open, .recentFolderActionsMenu.is-open',
        )

        openMenus.forEach((menu) => {
            menu.classList.remove('is-open')
            resetActionsMenuPosition(menu)
        })
    }

    function showMessage(message) {
        const { modalHost, close } = openModal({
            scope: recentMusic,
            contentHtml: `
            <div class="recentModalBackdrop" data-close="true"></div>
            <div class="recentModalDialog" role="dialog" aria-modal="true">
                <h3>Notice</h3>
                <p>${escapeHtml(message)}</p>
                <div class="recentModalActions">
                    <button type="button" class="recentModalConfirmBtn">OK</button>
                </div>
            </div>
            `,
        })

        if (!modalHost) {
            return
        }

        bindModalResolve({
            modalHost,
            selector: '.recentModalConfirmBtn',
            resolve: close,
            value: undefined,
        })

        bindModalDismiss({ modalHost, resolve: close })
    }

    function bindModalDismiss({ modalHost, resolve, value = null }) {
        bindModalResolve({
            modalHost,
            selector: '.recentModalBackdrop',
            resolve,
            value,
        })
    }

    function askCreatePlaylistValues({ title = 'Create New Playlist', defaultName = '' } = {}) {
        return showModalPrompt({
            scope: recentMusic,
            contentHtml: `
                <div class="recentModalBackdrop" data-close="true"></div>
                <div class="recentModalDialog" role="dialog" aria-modal="true">
                    <h3>${escapeHtml(title)}</h3>
                    <label class="recentModalFieldLabel" for="playlistNameInput">Playlist Name</label>
                    <input id="playlistNameInput" class="recentModalInput" type="text" maxlength="120" placeholder="My Playlist" value="${escapeHtml(defaultName)}" />
                    <div class="recentModalActions">
                        <button type="button" class="recentModalConfirmBtn">Create</button>
                        <button type="button" class="recentModalCancelBtn">Cancel</button>
                    </div>
                </div>
            `,
            fallbackValue: null,
            onBind: ({ modalHost, resolve }) => {
                if (!modalHost) {
                    resolve(null)
                    return
                }

                const nameInput = modalHost.querySelector('#playlistNameInput')
                nameInput?.focus()

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalCancelBtn',
                    resolve,
                    value: null,
                })

                bindModalDismiss({ modalHost, resolve, value: null })

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalConfirmBtn',
                    resolve,
                    getValue: () => ({
                        name: nameInput?.value?.trim() || '',
                    }),
                })
            },
        })
    }

    function askPlaylistSelection(playlists, options = {}) {
        const title =
            typeof options?.title === 'string' && options.title.trim()
                ? options.title.trim()
                : 'Add To Playlist'
        const description =
            typeof options?.description === 'string' && options.description.trim()
                ? options.description.trim()
                : 'Select a playlist.'

        return showModalPrompt({
            scope: recentMusic,
            contentHtml: `
                <div class="recentModalBackdrop" data-close="true"></div>
                <div class="recentModalDialog" role="dialog" aria-modal="true">
                    <h3>${escapeHtml(title)}</h3>
                    <p>${escapeHtml(description)}</p>
                    <div class="recentPlaylistSelectList">
                        ${playlists
                            .map((playlist) => {
                                const trackCount = Array.isArray(playlist.tracks)
                                    ? playlist.tracks.length
                                    : 0
                                return `
                                <button type="button" class="recentPlaylistSelectBtn" data-playlist-id="${escapeHtml(playlist.id)}">
                                    ${escapeHtml(playlist.name)} <span>${trackCount} songs</span>
                                </button>
                            `
                            })
                            .join('')}
                    </div>
                    <div class="recentModalActions">
                        <button type="button" class="recentModalCancelBtn">Cancel</button>
                    </div>
                </div>
            `,
            fallbackValue: null,
            onBind: ({ modalHost, resolve }) => {
                if (!modalHost) {
                    resolve(null)
                    return
                }

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalCancelBtn',
                    resolve,
                    value: null,
                })

                bindModalDismiss({ modalHost, resolve, value: null })

                bindModalResolve({
                    modalHost,
                    selector: '.recentPlaylistSelectBtn',
                    resolve,
                    getValue: ({ element }) => element.getAttribute('data-playlist-id'),
                })
            },
        })
    }

    function isUnknownArtistLabel(value) {
        if (typeof value !== 'string') {
            return true
        }

        const normalized = value.trim().toLowerCase()
        return (
            normalized === '' ||
            normalized === 'unknown artist' ||
            normalized === 'no metadata available'
        )
    }

    function isFallbackTrackTitle(title, filePath) {
        const fallbackTitle = getBaseName(filePath, DEFAULT_TRACK_TITLE)
        const normalizedTitle = typeof title === 'string' ? title.trim() : ''
        return !normalizedTitle || normalizedTitle === fallbackTitle
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

    function updateViewSongsTrackRow(modalHost, trackIndex, { title, artist }) {
        if (!modalHost?.isConnected || !Number.isInteger(trackIndex)) {
            return
        }

        const row = modalHost.querySelector(
            `.recentModalTrackRow[data-track-index="${trackIndex}"]`,
        )
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

    async function hydrateViewSongsMetadata({ playlist, tracks, modalHost }) {
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
                    isFallbackTrackTitle(storedTitle, filePath) ||
                    isUnknownArtistLabel(storedArtist)

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
                    const resolvedMetadata = await audioService.resolveTrackMetadata(filePath)
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

    function showRecentPlaylistContents(playlist) {
        if (!playlist) {
            return Promise.resolve(null)
        }

        const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
        return showModalPrompt({
            scope: recentMusic,
            contentHtml: `
                <div class="recentModalBackdrop" data-close="true"></div>
                <div class="recentModalDialog" role="dialog" aria-modal="true">
                    <h3>${escapeHtml(playlist.name || 'Folder Playlist')}</h3>
                    <p>${tracks.length} songs from your selected folder.</p>
                    <ul class="recentModalTrackList">
                        ${tracks
                            .map((track, index) => {
                                const normalizedTrack = normalizeTrackRecord(track)
                                const trackTitle = normalizedTrack?.title || DEFAULT_TRACK_TITLE
                                const trackArtist = normalizedTrack?.artist || DEFAULT_TRACK_ARTIST
                                return `
                                <li class="recentModalTrackRow" data-track-index="${index}">
                                    <div class="recentModalTrackTitle">${escapeHtml(trackTitle)}</div>
                                    <div class="recentModalTrackMeta">${escapeHtml(trackArtist)}</div>
                                </li>
                            `
                            })
                            .join('')}
                    </ul>
                    <div class="recentModalActions">
                        <button type="button" class="recentModalConfirmBtn">Close</button>
                    </div>
                </div>
            `,
            fallbackValue: null,
            onBind: ({ modalHost, resolve }) => {
                if (!modalHost) {
                    resolve(null)
                    return
                }

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalConfirmBtn',
                    resolve,
                    value: null,
                })

                bindModalDismiss({ modalHost, resolve, value: null })

                hydrateViewSongsMetadata({
                    playlist,
                    tracks,
                    modalHost,
                }).catch((error) => {
                    logViewSongsMetadataDebug('probe-unhandled-error', {
                        playlistName: playlist?.name || 'Folder Playlist',
                        error: String(error?.message || error || 'unknown error'),
                    })
                })
            },
        })
    }

    function resolveTrackFromActionButton(button, tracks) {
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

    function resolveRecentPlaylistFromActionButton(button, playlists) {
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

    function closeActionMenu(button) {
        const openMenu = button?.closest('.trackActionsMenu, .recentFolderActionsMenu')
        if (!openMenu) {
            return
        }

        openMenu.classList.remove('is-open')
        resetActionsMenuPosition(openMenu)
    }

    function bindActionButtons({ selector, resolver, action }) {
        if (!selector || typeof resolver !== 'function' || typeof action !== 'function') {
            return
        }

        const buttons = recentMusic.querySelectorAll(selector)
        buttons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()

                const target = resolver(button)
                if (!target) {
                    return
                }

                const shouldCloseMenu = await action(target)
                if (shouldCloseMenu) {
                    closeActionMenu(button)
                }
            })
        })
    }

    async function handleAddToPlaylistAction(track) {
        const playlists = await sessionService.loadUserPlaylists()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            showMessage('No playlists found. Please create a new playlist first.')
            return false
        }

        const selectedPlaylistId = await askPlaylistSelection(playlists, {
            title: 'Add To Playlist',
            description: 'Select a playlist for this track.',
        })

        if (!selectedPlaylistId) {
            return false
        }

        const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId)
        if (!selectedPlaylist) {
            return false
        }

        const success = await sessionService.addTrackToUserPlaylist(selectedPlaylist.id, track)
        const playlistName = selectedPlaylist?.name || 'playlist'
        if (success) {
            showMessage(`Added to playlist: ${playlistName}`)
        } else {
            showMessage(`Failed to add to playlist: ${playlistName}`)
        }

        return Boolean(success)
    }

    async function handleCreatePlaylistAction(track) {
        const formValues = await askCreatePlaylistValues({
            title: 'Create New Playlist',
        })

        if (!formValues) {
            return false
        }

        const created = await sessionService.createUserPlaylistWithTracks({
            name: formValues.name,
            tracks: [track],
        })

        if (created) {
            showMessage(`Created playlist: ${created.name} and added this track.`)
        }

        return Boolean(created)
    }

    async function resolvePlaylistTracksMetadata(tracks) {
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
                    const resolvedMetadata = await audioService.resolveTrackMetadata(filePath)
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

    async function handleAddAllToPlaylistAction(recentPlaylist) {
        const playlists = await sessionService.loadUserPlaylists()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            showMessage('No playlists found. Please create a new playlist first.')
            return false
        }

        const selectedPlaylistId = await askPlaylistSelection(playlists, {
            title: 'Add All To Playlist',
            description: `Add ${recentPlaylist.tracks.length} tracks from ${recentPlaylist.name}.`,
        })

        if (!selectedPlaylistId) {
            return false
        }

        const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId)
        if (!selectedPlaylist) {
            return false
        }

        const resolvedTracks = await resolvePlaylistTracksMetadata(recentPlaylist.tracks)
        if (!resolvedTracks.length) {
            return false
        }

        const success = await sessionService.addTracksToUserPlaylist(
            selectedPlaylist.id,
            resolvedTracks,
        )

        const playlistName = selectedPlaylist?.name || 'playlist'
        if (success) {
            showMessage(`Added ${resolvedTracks.length} songs to playlist: ${playlistName}`)
        } else {
            showMessage(`Failed to add ${resolvedTracks.length} songs to playlist: ${playlistName}`)
        }

        return Boolean(success)
    }

    async function handleCreatePlaylistFromFolderAction(recentPlaylist) {
        const formValues = await askCreatePlaylistValues({
            title: 'Create Playlist From Folder',
            defaultName: recentPlaylist.name,
        })

        if (!formValues) {
            return false
        }

        const resolvedTracks = await resolvePlaylistTracksMetadata(recentPlaylist.tracks)
        if (!resolvedTracks.length) {
            return false
        }

        const created = await sessionService.createUserPlaylistWithTracks({
            name: formValues.name || recentPlaylist.name,
            tracks: resolvedTracks,
        })

        if (created) {
            showMessage(`Created playlist: ${created.name} with ${resolvedTracks.length} songs.`)
        }

        return Boolean(created)
    }

    function buildRecentTracksListHtml({ tracks, showActions = true }) {
        if (!Array.isArray(tracks) || tracks.length === 0) {
            return '<p class="noRecentMusic">No recently played tracks</p>'
        }

        const canAddToExistingPlaylist = Array.isArray(userPlaylists) && userPlaylists.length > 0

        return `
            <ul class="recentMusicList">
                ${tracks
                    .map((track, index) => {
                        const normalizedTrack = normalizeTrackRecord(track)
                        if (!normalizedTrack?.filePath) {
                            return ''
                        }

                        const title = normalizedTrack.title || DEFAULT_TRACK_TITLE
                        const artist = normalizedTrack.artist || DEFAULT_TRACK_ARTIST
                        const image = normalizedTrack.image || './assets/music-placeholder.png'

                        return `
                            <li class="recentTrack" data-file-path="${escapeHtml(normalizedTrack.filePath)}" data-index="${index}">
                                <div class="trackCover">
                                    <img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">
                                </div>
                                <div class="trackDetails">
                                    <div class="trackTitle">${escapeHtml(title)}</div>
                                    <div class="trackArtist">${escapeHtml(artist)}</div>
                                </div>
                                ${
                                    showActions
                                        ? `
                                <div class="trackMoreActions">
                                    <button type="button" class="trackMoreBtn" data-track-index="${index}" aria-label="Playlist actions">
                                        <i data-lucide="ellipsis"></i>
                                    </button>
                                    <div class="trackActionsMenu" data-track-index="${index}">
                                        ${canAddToExistingPlaylist ? `<button type="button" class="addToPlaylistBtn" data-track-index="${index}">Add to Playlist</button>` : ''}
                                        <button type="button" class="createPlaylistBtn" data-track-index="${index}">Create New Playlist</button>
                                    </div>
                                </div>
                                `
                                        : ''
                                }
                            </li>
                        `
                    })
                    .join('')}
            </ul>
        `
    }

    function buildRecentPlaylistsListHtml({ playlists, showActions = true }) {
        if (!Array.isArray(playlists) || playlists.length === 0) {
            return '<p class="noRecentPlaylists">No recent playlists yet. Use Select Folder to create one.</p>'
        }

        return `
            <ul class="recentPlaylistList">
                ${playlists
                    .map((playlist, index) => {
                        const trackCount = Array.isArray(playlist.tracks)
                            ? playlist.tracks.length
                            : 0
                        const playlistImage = resolvePlaylistImage(playlist)
                        return `
                            <li class="recentPlaylistCard" data-playlist-index="${index}">
                                <img class="recentPlaylistCover" src="${escapeHtml(playlistImage)}" alt="${escapeHtml(playlist.name || 'Folder Playlist')}">
                                <div class="recentPlaylistInfo">
                                    <p class="recentPlaylistName">${escapeHtml(playlist.name || 'Folder Playlist')}</p>
                                    <p class="recentPlaylistMeta">${trackCount} songs</p>
                                </div>
                                ${
                                    showActions
                                        ? `
                                <div class="recentPlaylistActions">
                                    <button type="button" class="recentPlaylistViewBtn" data-playlist-index="${index}">View Songs</button>
                                    <button type="button" class="recentFolderMoreBtn" data-playlist-index="${index}" aria-label="Folder playlist actions">
                                        <i data-lucide="ellipsis"></i>
                                    </button>
                                    <div class="recentFolderActionsMenu" data-playlist-index="${index}">
                                        <button type="button" class="addAllToPlaylistBtn" data-playlist-index="${index}">Add All to Playlist</button>
                                        <button type="button" class="createPlaylistFromFolderBtn" data-playlist-index="${index}">Create New Playlist</button>
                                    </div>
                                </div>
                                `
                                        : ''
                                }
                            </li>
                        `
                    })
                    .join('')}
            </ul>
        `
    }

    function buildTabContentHtml() {
        if (activeTab === 'playlist') {
            return `
                <section class="recentSection">
                    ${buildRecentPlaylistsListHtml({ playlists: recentFolderPlaylists })}
                </section>
            `
        }

        if (activeTab === 'music') {
            return `
                <section class="recentSection">
                    ${buildRecentTracksListHtml({ tracks: recentTracks })}
                </section>
            `
        }

        return `
            <section class="recentSection">
                <h3 class="recentSectionTitle">Recent Playlists</h3>
                ${buildRecentPlaylistsListHtml({ playlists: recentFolderPlaylists })}
            </section>
            <section class="recentSection">
                <h3 class="recentSectionTitle">Recent Music</h3>
                ${buildRecentTracksListHtml({ tracks: recentTracks })}
            </section>
        `
    }

    function applyTabUiState() {
        const tabButtons = recentMusic.querySelectorAll('.recentTabBtn')
        tabButtons.forEach((button) => {
            const tab = normalizeTab(button.getAttribute('data-recent-tab') || 'all')
            const isActive = tab === activeTab
            button.classList.toggle('is-active', isActive)
            button.setAttribute('aria-selected', String(isActive))
        })
    }

    function bindTrackPlayActions() {
        const trackElements = recentMusic.querySelectorAll('.recentTrack')
        trackElements.forEach((element) => {
            element.addEventListener('click', () => {
                const filePath = element.getAttribute('data-file-path')
                if (!filePath) {
                    return
                }

                sessionService.approveRecentAudioPath(filePath).then((approved) => {
                    if (approved) {
                        audioService.startSingleTrack(filePath)
                    }
                })
            })
        })
    }

    function bindPlaylistViewActions() {
        const viewButtons = recentMusic.querySelectorAll('.recentPlaylistViewBtn')
        viewButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()

                const playlist = resolveRecentPlaylistFromActionButton(
                    button,
                    recentFolderPlaylists,
                )
                if (!playlist) {
                    return
                }

                await showRecentPlaylistContents(playlist)
            })
        })
    }

    function bindMenuPositioning({ triggerSelector, menuSelector, indexAttribute }) {
        const buttons = recentMusic.querySelectorAll(triggerSelector)
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                requestAnimationFrame(() => {
                    positionActionsMenu({
                        button,
                        menuSelector,
                        indexAttribute,
                    })
                })
            })
        })
    }

    function renderRecentContent() {
        const contentContainer = recentMusic.querySelector('.recentTabContent')
        if (!contentContainer) {
            return
        }

        clearMenuToggleBindings()
        contentContainer.innerHTML = buildTabContentHtml()

        bindImageFallbacks({
            scope: contentContainer,
            selector: '.trackCover img',
        })

        bindImageFallbacks({
            scope: contentContainer,
            selector: '.recentPlaylistCover',
        })

        window.lucide?.createIcons()

        cleanupTrackMenuToggles = attachIndexedMenuToggle({
            scope: recentMusic,
            triggerSelector: '.trackMoreBtn',
            menuSelector: '.trackActionsMenu',
            indexAttribute: 'data-track-index',
        })

        cleanupRecentPlaylistMenuToggles = attachIndexedMenuToggle({
            scope: recentMusic,
            triggerSelector: '.recentFolderMoreBtn',
            menuSelector: '.recentFolderActionsMenu',
            indexAttribute: 'data-playlist-index',
        })

        bindMenuPositioning({
            triggerSelector: '.trackMoreBtn',
            menuSelector: '.trackActionsMenu',
            indexAttribute: 'data-track-index',
        })

        bindMenuPositioning({
            triggerSelector: '.recentFolderMoreBtn',
            menuSelector: '.recentFolderActionsMenu',
            indexAttribute: 'data-playlist-index',
        })

        bindTrackPlayActions()

        bindActionButtons({
            selector: '.addToPlaylistBtn',
            resolver: (button) => resolveTrackFromActionButton(button, recentTracks),
            action: handleAddToPlaylistAction,
        })

        bindActionButtons({
            selector: '.createPlaylistBtn',
            resolver: (button) => resolveTrackFromActionButton(button, recentTracks),
            action: handleCreatePlaylistAction,
        })

        bindPlaylistViewActions()

        bindActionButtons({
            selector: '.addAllToPlaylistBtn',
            resolver: (button) =>
                resolveRecentPlaylistFromActionButton(button, recentFolderPlaylists),
            action: handleAddAllToPlaylistAction,
        })

        bindActionButtons({
            selector: '.createPlaylistFromFolderBtn',
            resolver: (button) =>
                resolveRecentPlaylistFromActionButton(button, recentFolderPlaylists),
            action: handleCreatePlaylistFromFolderAction,
        })
    }

    async function loadAndRenderRecentContent() {
        const refreshId = ++latestRefreshId
        const isStaleRefresh = () => refreshId !== latestRefreshId

        try {
            if (isStaleRefresh()) {
                return
            }

            clearMenuToggleBindings()

            const recentFolderPlaylistsPromise =
                typeof sessionService.loadRecentFolderPlaylists === 'function'
                    ? sessionService.loadRecentFolderPlaylists()
                    : Promise.resolve([])

            const [loadedTracks, loadedRecentFolderPlaylists, loadedUserPlaylists] =
                await Promise.all([
                    sessionService.loadRecentTracks(),
                    recentFolderPlaylistsPromise,
                    sessionService.loadUserPlaylists(),
                ])

            if (isStaleRefresh()) {
                return
            }

            recentTracks = Array.isArray(loadedTracks)
                ? loadedTracks.filter((track) => Boolean(track?.filePath))
                : []

            recentFolderPlaylists = Array.isArray(loadedRecentFolderPlaylists)
                ? loadedRecentFolderPlaylists.filter(
                      (playlist) =>
                          playlist && Array.isArray(playlist.tracks) && playlist.tracks.length > 0,
                  )
                : []

            userPlaylists = Array.isArray(loadedUserPlaylists) ? loadedUserPlaylists : []

            renderRecentContent()
        } catch (error) {
            if (isStaleRefresh()) {
                return
            }
            console.error('Failed to load recent content:', error)
        }
    }

    const tabButtons = recentMusic.querySelectorAll('.recentTabBtn')
    tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const selectedTab = normalizeTab(button.getAttribute('data-recent-tab') || 'all')
            if (selectedTab === activeTab) {
                return
            }

            activeTab = selectedTab
            applyTabUiState()
            closeAllActionMenus()
            renderRecentContent()
        })
    })

    applyTabUiState()

    // Load and render on initialization
    loadAndRenderRecentContent()

    const HOME_ROUTE = 'home'
    const shouldRefreshCurrentRoute = () => isRouteActive(HOME_ROUTE)

    const recentMusicRefreshEvents = [
        'recent-tracks:updated',
        'user-playlists:updated',
        'recent-folder-playlists:updated',
    ]

    const onRecentDataUpdated = () => {
        if (!shouldRefreshCurrentRoute()) {
            return
        }

        loadAndRenderRecentContent()
    }

    recentMusicRefreshEvents.forEach((eventName) => {
        window.addEventListener(eventName, onRecentDataUpdated)
    })
    cleanupGlobalMenuDismiss = bindGlobalDismissEvents({
        onDismiss: closeAllActionMenus,
        closeOnClick: false,
        closeOnScroll: true,
        closeOnResize: true,
        scrollCapture: true,
    })

    const cleanup = () => {
        recentMusicRefreshEvents.forEach((eventName) => {
            window.removeEventListener(eventName, onRecentDataUpdated)
        })
        if (typeof cleanupGlobalMenuDismiss === 'function') {
            cleanupGlobalMenuDismiss()
            cleanupGlobalMenuDismiss = null
        }
        clearMenuToggleBindings()
        closeAllActionMenus()
        closeModalHost({ scope: recentMusic })
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
}

window.InitializeRecentMusic = initializeRecentMusic
