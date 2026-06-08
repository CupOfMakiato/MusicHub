import {
    attachIndexedMenuToggle,
    placeFloatingElement,
    bindGlobalDismissEvents,
    getDataAttributeIndex,
    closeModalHost,
    bindImageFallbacks,
    showNotice,
} from '../../utils/dom-helpers.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'
import {
    hydrateImageWithPlaylistArtwork,
    hydrateImageWithTrackArtwork,
} from '../../utils/artwork.js'
import * as RecentRenderer from './recent-renderer.js'
import * as RecentModals from './recent-modals.js'
import * as RecentMetadata from './recent-metadata.js'
import * as RecentActions from './recent-actions.js'

const RECENT_TABS = new Set(['all', 'playlist', 'music'])

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
    let cleanupTrackPlayDelegate = null
    let activeTab = 'all'

    let recentTracks = []
    let recentFolderPlaylists = []
    let userPlaylists = []
    let tabButtonHandlers = []

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
        // Delegate to shared helper
        showNotice({ scope: recentMusic, message })
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

                try {
                    const shouldCloseMenu = await action(target)
                    if (shouldCloseMenu) {
                        const openMenu = button?.closest(
                            '.trackActionsMenu, .recentFolderActionsMenu',
                        )
                        if (openMenu) {
                            openMenu.classList.remove('is-open')
                            resetActionsMenuPosition(openMenu)
                        }
                    }
                } catch (err) {
                    console.error('recent-music action failed', err)
                    return
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

        const selectedPlaylistId = await RecentModals.askPlaylistSelection(recentMusic, playlists, {
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
        const formValues = await RecentModals.askCreatePlaylistValues(recentMusic, {
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

    async function handleAddAllToPlaylistAction(recentPlaylist) {
        const playlists = await sessionService.loadUserPlaylists()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            showMessage('No playlists found. Please create a new playlist first.')
            return false
        }

        const selectedPlaylistId = await RecentModals.askPlaylistSelection(recentMusic, playlists, {
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

        const resolvedTracks = await RecentMetadata.resolvePlaylistTracksMetadata(
            recentPlaylist.tracks,
        )
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
        const formValues = await RecentModals.askCreatePlaylistValues(recentMusic, {
            title: 'Create Playlist From Folder',
            defaultName: recentPlaylist.name,
        })

        if (!formValues) {
            return false
        }

        const resolvedTracks = await RecentMetadata.resolvePlaylistTracksMetadata(
            recentPlaylist.tracks,
        )
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

    function applyTabUiState() {
        const tabButtons = recentMusic.querySelectorAll('.recentTabBtn')
        tabButtons.forEach((button) => {
            const tab = normalizeTab(button.getAttribute('data-recent-tab') || 'all')
            const isActive = tab === activeTab
            button.classList.toggle('is-active', isActive)
            button.setAttribute('aria-selected', String(isActive))
        })

        // Update the tabpanel's aria-labelledby to point at the active tab button
        const tabPanel = recentMusic.querySelector('#recentTabPanel')
        if (tabPanel) {
            const activeButton = recentMusic.querySelector('.recentTabBtn.is-active')
            if (activeButton && activeButton.id) {
                tabPanel.setAttribute('aria-labelledby', activeButton.id)
            } else {
                tabPanel.removeAttribute('aria-labelledby')
            }
        }
    }

    function bindTrackPlayActions() {
        // Ensure we only have one delegated listener attached to the container
        if (typeof cleanupTrackPlayDelegate === 'function') {
            cleanupTrackPlayDelegate()
            cleanupTrackPlayDelegate = null
        }

        const handler = (event) => {
            if (event.defaultPrevented) {
                return
            }

            const trackElement = event.target.closest('.recentTrack')
            if (!trackElement || !recentMusic.contains(trackElement)) {
                return
            }

            const trackIndex = getDataAttributeIndex(trackElement, 'data-track-index')
            if (trackIndex === null) {
                return
            }

            const track = recentTracks[trackIndex]
            const filePath = track?.filePath
            if (!filePath) {
                return
            }

            sessionService.approveRecentAudioPath(filePath).then((approved) => {
                if (approved) {
                    audioService.startSingleTrack(filePath)
                }
            })
        }

        recentMusic.addEventListener('click', handler)
        cleanupTrackPlayDelegate = () => recentMusic.removeEventListener('click', handler)
    }

    function bindPlaylistViewActions() {
        const viewButtons = recentMusic.querySelectorAll('.recentPlaylistViewBtn')
        viewButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()

                const playlist = RecentActions.resolveRecentPlaylistFromActionButton(
                    button,
                    recentFolderPlaylists,
                )
                if (!playlist) {
                    return
                }

                await RecentModals.showRecentPlaylistContents(recentMusic, playlist)
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

    function hydrateRecentArtwork(scope) {
        scope.querySelectorAll('.recentTrack').forEach((trackElement) => {
            const index = getDataAttributeIndex(trackElement, 'data-track-index')
            const imageElement = trackElement.querySelector('.trackCover img')
            const track = index === null ? null : recentTracks[index]
            if (!track || !imageElement) {
                return
            }

            hydrateImageWithTrackArtwork({
                imageElement,
                track,
                audioService,
            })
                .then((artwork) => {
                    if (artwork && recentTracks[index]) {
                        recentTracks[index] = {
                            ...recentTracks[index],
                            image: artwork,
                        }
                    }
                })
                .catch(() => {})
        })

        scope.querySelectorAll('.recentPlaylistCard').forEach((playlistElement) => {
            const index = getDataAttributeIndex(playlistElement, 'data-playlist-index')
            const imageElement = playlistElement.querySelector('.recentPlaylistCover')
            const playlist = index === null ? null : recentFolderPlaylists[index]
            if (!playlist || !imageElement) {
                return
            }

            hydrateImageWithPlaylistArtwork({
                imageElement,
                playlist,
                audioService,
            }).catch(() => {})
        })
    }

    function renderRecentContent() {
        const contentContainer = recentMusic.querySelector('.recentTabContent')
        if (!contentContainer) {
            return
        }

        clearMenuToggleBindings()
        // Render DOM nodes instead of string HTML
        contentContainer.innerHTML = ''
        const contentNode = RecentRenderer.buildTabContentNode(activeTab, {
            recentFolderPlaylists,
            recentTracks,
            userPlaylists,
        })
        contentContainer.appendChild(contentNode)

        bindImageFallbacks({
            scope: contentContainer,
            selector: '.trackCover img',
        })

        bindImageFallbacks({
            scope: contentContainer,
            selector: '.recentPlaylistCover',
        })

        hydrateRecentArtwork(contentContainer)

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
            resolver: (button) => RecentActions.resolveTrackFromActionButton(button, recentTracks),
            action: handleAddToPlaylistAction,
        })

        bindActionButtons({
            selector: '.createPlaylistBtn',
            resolver: (button) => RecentActions.resolveTrackFromActionButton(button, recentTracks),
            action: handleCreatePlaylistAction,
        })

        bindPlaylistViewActions()

        bindActionButtons({
            selector: '.addAllToPlaylistBtn',
            resolver: (button) =>
                RecentActions.resolveRecentPlaylistFromActionButton(button, recentFolderPlaylists),
            action: handleAddAllToPlaylistAction,
        })

        bindActionButtons({
            selector: '.createPlaylistFromFolderBtn',
            resolver: (button) =>
                RecentActions.resolveRecentPlaylistFromActionButton(button, recentFolderPlaylists),
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

    const tabButtons = Array.from(recentMusic.querySelectorAll('.recentTabBtn'))
    tabButtons.forEach((button) => {
        const clickHandler = (event) => {
            event.stopPropagation()
            const selectedTab = normalizeTab(button.getAttribute('data-recent-tab') || 'all')
            if (selectedTab === activeTab) {
                return
            }

            activeTab = selectedTab
            applyTabUiState()
            closeAllActionMenus()
            renderRecentContent()
        }

        button.addEventListener('click', clickHandler)
        tabButtonHandlers.push({ button, clickHandler })
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

        if (Array.isArray(tabButtonHandlers) && tabButtonHandlers.length) {
            tabButtonHandlers.forEach(({ button, clickHandler }) => {
                try {
                    button.removeEventListener('click', clickHandler)
                } catch (e) {
                    void e
                }
            })
            tabButtonHandlers = []
        }

        clearMenuToggleBindings()
        closeAllActionMenus()
        if (typeof cleanupTrackPlayDelegate === 'function') {
            cleanupTrackPlayDelegate()
            cleanupTrackPlayDelegate = null
        }
        closeModalHost({ scope: recentMusic })
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
}

window.InitializeRecentMusic = initializeRecentMusic
