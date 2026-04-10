import {
    escapeHtml,
    attachIndexedMenuToggle,
    openModal,
    closeModalHost,
    showModalPrompt,
    bindModalResolve,
} from '../../utils/dom-helpers.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'

export function initializeRecentMusic() {
    const recentMusic = document.getElementById('recent-music')
    if (!recentMusic) {
        console.error('Recent music element not found')
        return
    }

    let latestRefreshId = 0
    let cleanupTrackMenuToggles = null

    function resetTrackActionsMenuPosition(menu) {
        if (!menu) {
            return
        }

        menu.style.position = ''
        menu.style.top = ''
        menu.style.left = ''
        menu.style.right = ''
        menu.style.zIndex = ''
    }

    function positionTrackActionsMenu(button) {
        if (!button) {
            return
        }

        const menuIndex = button.getAttribute('data-track-index')
        if (!menuIndex) {
            return
        }

        const menu = recentMusic.querySelector(`.trackActionsMenu[data-track-index="${menuIndex}"]`)
        if (!menu || !menu.classList.contains('is-open')) {
            return
        }

        menu.style.position = 'fixed'
        menu.style.right = 'auto'
        menu.style.zIndex = '2200'

        const buttonRect = button.getBoundingClientRect()
        const menuWidth = menu.offsetWidth || 190
        const menuHeight = menu.offsetHeight || 80
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

        menu.style.left = `${left}px`
        menu.style.top = `${top}px`
    }

    function closeAllTrackActionMenus() {
        const openMenus = recentMusic.querySelectorAll('.trackActionsMenu.is-open')
        openMenus.forEach((menu) => {
            menu.classList.remove('is-open')
            resetTrackActionsMenuPosition(menu)
        })
    }

    function isHomeRouteActive() {
        return (window.appRouter?.getCurrentRoute?.() || 'home') === 'home'
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

        bindModalResolve({
            modalHost,
            selector: '.recentModalBackdrop',
            resolve: close,
            value: undefined,
        })
    }

    function askCreatePlaylistValues() {
        return showModalPrompt({
            scope: recentMusic,
            contentHtml: `
                <div class="recentModalBackdrop" data-close="true"></div>
                <div class="recentModalDialog" role="dialog" aria-modal="true">
                    <h3>Create New Playlist</h3>
                    <label class="recentModalFieldLabel" for="playlistNameInput">Playlist Name</label>
                    <input id="playlistNameInput" class="recentModalInput" type="text" maxlength="120" placeholder="My Playlist" />
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

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalBackdrop',
                    resolve,
                    value: null,
                })

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

    function askPlaylistSelection(playlists) {
        return showModalPrompt({
            scope: recentMusic,
            contentHtml: `
                <div class="recentModalBackdrop" data-close="true"></div>
                <div class="recentModalDialog" role="dialog" aria-modal="true">
                    <h3>Add To Playlist</h3>
                    <p>Select a playlist for this track.</p>
                    <div class="recentPlaylistSelectList">
                        ${playlists
                            .map((playlist) => {
                                const trackCount = Array.isArray(playlist.tracks)
                                    ? playlist.tracks.length
                                    : 0
                                return `
                                <button type="button" class="recentPlaylistSelectBtn" data-playlist-id="${escapeHtml(playlist.id)}">
                                    ${escapeHtml(playlist.name)} <span>${trackCount} tracks</span>
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

                bindModalResolve({
                    modalHost,
                    selector: '.recentModalBackdrop',
                    resolve,
                    value: null,
                })

                bindModalResolve({
                    modalHost,
                    selector: '.recentPlaylistSelectBtn',
                    resolve,
                    getValue: ({ element }) => element.getAttribute('data-playlist-id'),
                })
            },
        })
    }

    function resolveTrackFromActionButton(button, tracks) {
        if (!button || !Array.isArray(tracks)) {
            return null
        }

        const trackIndex = Number(button.getAttribute('data-track-index'))
        if (!Number.isInteger(trackIndex)) {
            return null
        }

        const track = tracks[trackIndex]
        if (!track?.filePath) {
            return null
        }

        return track
    }

    function closeActionMenu(button) {
        const openMenu = button?.closest('.trackActionsMenu')
        if (!openMenu) {
            return
        }

        openMenu.classList.remove('is-open')
        resetTrackActionsMenuPosition(openMenu)
    }

    function bindTrackActionButtons({ selector, tracks, action }) {
        if (!selector || typeof action !== 'function') {
            return
        }

        const buttons = recentMusic.querySelectorAll(selector)
        buttons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()

                const track = resolveTrackFromActionButton(button, tracks)
                if (!track) {
                    return
                }

                const shouldCloseMenu = await action(track)
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

        const selectedPlaylistId = await askPlaylistSelection(playlists)
        if (!selectedPlaylistId) {
            return false
        }

        const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId)
        if (!selectedPlaylist) {
            return false
        }

        const success = await sessionService.addTrackToUserPlaylist(selectedPlaylist.id, track)
        if (success) {
            showMessage(`Added to playlist: ${selectedPlaylist.name}`)
        }

        return true
    }

    async function handleCreatePlaylistAction(track) {
        const formValues = await askCreatePlaylistValues()
        if (!formValues) {
            return false
        }

        const created = await sessionService.createUserPlaylist({
            name: formValues.name,
        })

        if (!created) {
            return false
        }

        const added = await sessionService.addTrackToUserPlaylist(created.id, track)
        if (added) {
            showMessage(`Created playlist: ${created.name} and added this track.`)
        }
        // else {
        //     showMessage(`Created playlist: ${created.name}, but failed to add this track.`)
        // }

        return true
    }

    async function loadAndRenderRecentTracks() {
        const refreshId = ++latestRefreshId
        const isStaleRefresh = () => refreshId !== latestRefreshId

        try {
            if (isStaleRefresh()) {
                return
            }

            if (typeof cleanupTrackMenuToggles === 'function') {
                cleanupTrackMenuToggles()
                cleanupTrackMenuToggles = null
            }

            const tracks = await sessionService.loadRecentTracks()
            if (isStaleRefresh()) {
                return
            }

            const playlists = (await sessionService.loadUserPlaylists()) || []
            if (isStaleRefresh()) {
                return
            }

            const hasExistingPlaylist = Array.isArray(playlists) && playlists.length > 0
            const container = recentMusic.querySelector('.recentMusicList') || recentMusic

            if (!tracks || tracks.length === 0) {
                if (isStaleRefresh()) {
                    return
                }
                container.innerHTML = '<p class="noRecentMusic">No recently played tracks</p>'
                return
            }

            let html = '<ul class="recentMusicList">'
            tracks.forEach((track, index) => {
                const title = track.title || 'Unknown Title'
                const artist = track.artist || 'Unknown Artist'

                html += `
                    <li class="recentTrack" data-file-path="${escapeHtml(track.filePath)}" data-index="${index}">
                        <div class="trackCover">
                            <img src="${escapeHtml(track.image || './assets/music-placeholder.png')}" 
                                 alt="${escapeHtml(title)}"
                                 onerror="this.src='./assets/music-placeholder.png'">
                        </div>
                        <div class="trackDetails">
                            <div class="trackTitle">${escapeHtml(title)}</div>
                            <div class="trackArtist">${escapeHtml(artist)}</div>
                        </div>
                        <div class="trackMoreActions">
                            <button type="button" class="trackMoreBtn" data-track-index="${index}" aria-label="Playlist actions">
                                <i data-lucide="ellipsis"></i>
                            </button>
                            <div class="trackActionsMenu" data-track-index="${index}">
                                ${hasExistingPlaylist ? `<button type="button" class="addToPlaylistBtn" data-track-index="${index}">Add to Playlist</button>` : ''}
                                <button type="button" class="createPlaylistBtn" data-track-index="${index}">Create New Playlist</button>
                            </div>
                        </div>
                    </li>
                `
            })
            html += '</ul>'

            if (isStaleRefresh()) {
                return
            }

            container.innerHTML = html
            window.lucide?.createIcons()

            if (isStaleRefresh()) {
                return
            }

            cleanupTrackMenuToggles = attachIndexedMenuToggle({
                scope: recentMusic,
                triggerSelector: '.trackMoreBtn',
                menuSelector: '.trackActionsMenu',
                indexAttribute: 'data-track-index',
            })

            const moreButtons = recentMusic.querySelectorAll('.trackMoreBtn')
            moreButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    requestAnimationFrame(() => {
                        positionTrackActionsMenu(button)
                    })
                })
            })

            // Add click handlers
            const trackElements = recentMusic.querySelectorAll('.recentTrack')
            trackElements.forEach((element) => {
                element.addEventListener('click', () => {
                    const filePath = element.getAttribute('data-file-path')
                    if (filePath) {
                        sessionService.approveRecentAudioPath(filePath).then((approved) => {
                            if (approved) {
                                audioService.startPlaylist([filePath])
                            }
                        })
                    }
                })
            })

            bindTrackActionButtons({
                selector: '.addToPlaylistBtn',
                tracks,
                action: handleAddToPlaylistAction,
            })

            bindTrackActionButtons({
                selector: '.createPlaylistBtn',
                tracks,
                action: handleCreatePlaylistAction,
            })
        } catch (error) {
            if (isStaleRefresh()) {
                return
            }
            console.error('Failed to load recent tracks:', error)
        }
    }

    // Load and render on initialization
    loadAndRenderRecentTracks()

    // Reload only when recent tracks are updated.
    const onRecentTracksUpdated = () => {
        if (!isHomeRouteActive()) {
            return
        }
        loadAndRenderRecentTracks()
    }

    const onUserPlaylistsUpdated = () => {
        if (!isHomeRouteActive()) {
            return
        }
        loadAndRenderRecentTracks()
    }

    window.addEventListener('recent-tracks:updated', onRecentTracksUpdated)
    window.addEventListener('user-playlists:updated', onUserPlaylistsUpdated)
    document.addEventListener('scroll', closeAllTrackActionMenus, true)
    window.addEventListener('resize', closeAllTrackActionMenus)

    const cleanup = () => {
        window.removeEventListener('recent-tracks:updated', onRecentTracksUpdated)
        window.removeEventListener('user-playlists:updated', onUserPlaylistsUpdated)
        document.removeEventListener('scroll', closeAllTrackActionMenus, true)
        window.removeEventListener('resize', closeAllTrackActionMenus)
        if (typeof cleanupTrackMenuToggles === 'function') {
            cleanupTrackMenuToggles()
            cleanupTrackMenuToggles = null
        }
        closeAllTrackActionMenus()
        closeModalHost({ scope: recentMusic })
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
}

window.InitializeRecentMusic = initializeRecentMusic
