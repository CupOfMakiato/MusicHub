import {
    CreateElementBuilder,
    bindImageFallbacks,
    placeFloatingElement,
    bindGlobalDismissEvents,
} from '../../utils/dom-helpers.js'
import { resolvePlaylistImage, extractPlaylistFilePaths } from '../../utils/playlist-media.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'
import { hydrateImageWithPlaylistArtwork } from '../../utils/artwork.js'

export function initializeLibraryPage() {
    const container = document.getElementById('libraryPlaylists')
    if (!container) {
        return
    }

    let contextMenu = null
    let contextMenuPlaylistId = null

    function closeContextMenu() {
        contextMenuPlaylistId = null
        if (!contextMenu) {
            return
        }

        contextMenu.classList.remove('is-open')
    }

    function ensureContextMenu() {
        if (contextMenu?.isConnected) {
            return contextMenu
        }

        contextMenu = document.createElement('div')
        contextMenu.className = 'libraryContextMenu'
        contextMenu.replaceChildren(
            CreateElementBuilder.create('button')
                .property('type', 'button')
                .className('deletePlaylistMenuBtn')
                .attr('role', 'menuitem')
                .text('Delete Playlist')
                .build(),
        )

        contextMenu.addEventListener('click', async (event) => {
            event.stopPropagation()

            const deleteButton = event.target.closest('.deletePlaylistMenuBtn')
            if (!deleteButton || !contextMenuPlaylistId) {
                return
            }

            const playlistIdToDelete = contextMenuPlaylistId
            closeContextMenu()

            const playlists = await sessionService.loadUserPlaylists()
            if (!Array.isArray(playlists) || playlists.length === 0) {
                return
            }

            const nextPlaylists = playlists.filter((playlist) => playlist.id !== playlistIdToDelete)
            if (nextPlaylists.length === playlists.length) {
                return
            }

            const saved = await sessionService.saveUserPlaylists(nextPlaylists)
            if (!saved) {
                console.error('Failed to delete playlist from library context menu')
                return
            }

            if (window.playlistViewState?.activePlaylistId === playlistIdToDelete) {
                window.playlistViewState = {
                    activePlaylistId: nextPlaylists[0]?.id || null,
                }
            }
        })

        container.appendChild(contextMenu)
        return contextMenu
    }

    function showContextMenu({ playlistId, clientX, clientY }) {
        if (!playlistId) {
            return
        }

        const menu = ensureContextMenu()
        if (!menu) {
            return
        }

        contextMenuPlaylistId = playlistId
        menu.classList.add('is-open')

        const viewportPadding = 8
        const menuWidth = menu.offsetWidth || 180
        const menuHeight = menu.offsetHeight || 42

        placeFloatingElement({
            element: menu,
            left: clientX,
            top: clientY,
            widthFallback: menuWidth,
            heightFallback: menuHeight,
            padding: viewportPadding,
            position: 'fixed',
        })
    }

    const cleanupContextMenuDismiss = bindGlobalDismissEvents({
        onDismiss: closeContextMenu,
        closeOnClick: true,
        closeOnScroll: true,
        closeOnResize: true,
        scrollCapture: true,
    })

    function createEmptyState() {
        return CreateElementBuilder.create('p')
            .className('libraryEmpty')
            .text('No playlists yet. Use Recent Music -> Create New Playlist.')
            .build()
    }

    function createPlaylistCard(playlist) {
        const banner = resolvePlaylistImage(playlist)
        const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
        const canPlay = trackCount > 0

        return CreateElementBuilder.create('article')
            .className('libraryPlaylistCard')
            .attr('data-playlist-id', playlist.id)
            .attr('role', 'button')
            .attr('tabindex', '0')
            .attr('aria-label', `Open playlist ${playlist.name}`)
            .child(
                CreateElementBuilder.create('img')
                    .property('src', banner)
                    .property('alt', playlist.name),
            )
            .child(
                CreateElementBuilder.create('div')
                    .className('libraryPlaylistContent')
                    .child(CreateElementBuilder.create('h3').text(playlist.name))
                    .child(CreateElementBuilder.create('p').text(`${trackCount} songs`))
                    .child(
                        CreateElementBuilder.create('div')
                            .className('libraryPlaylistActions')
                            .child(
                                CreateElementBuilder.create('button')
                                    .property('type', 'button')
                                    .property('disabled', !canPlay)
                                    .className('playPlaylistBtn')
                                    .attr('aria-label', 'Play playlist')
                                    .child(
                                        CreateElementBuilder.create('i').attr(
                                            'data-lucide',
                                            'play',
                                        ),
                                    ),
                            ),
                    ),
            )
            .build()
    }

    async function render() {
        const playlists = await sessionService.loadUserPlaylists()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            container.replaceChildren(createEmptyState())
            return
        }

        const fragment = document.createDocumentFragment()
        playlists.forEach((playlist) => {
            fragment.appendChild(createPlaylistCard(playlist))
        })
        container.replaceChildren(fragment)

        bindImageFallbacks({
            scope: container,
            selector: '.libraryPlaylistCard img',
        })

        container.querySelectorAll('.libraryPlaylistCard').forEach((card) => {
            const playlistId = card.getAttribute('data-playlist-id')
            const playlist = playlists.find((item) => item.id === playlistId)
            const imageElement = card.querySelector('img')
            if (!playlist || !imageElement) {
                return
            }

            hydrateImageWithPlaylistArtwork({
                imageElement,
                playlist,
                audioService,
            }).catch(() => {})
        })

        window.lucide?.createIcons()

        const cards = container.querySelectorAll('.libraryPlaylistCard')
        const openPlaylistFromCard = async (card) => {
            const playlistId = card?.getAttribute('data-playlist-id')
            if (!playlistId) {
                return
            }

            window.playlistViewState = { activePlaylistId: playlistId }
            await window.appRouter?.goTo?.('playlist')
        }

        cards.forEach((card) => {
            card.addEventListener('click', async (event) => {
                if (event.target.closest('.playPlaylistBtn')) {
                    return
                }

                await openPlaylistFromCard(card)
            })

            card.addEventListener('keydown', async (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return
                }

                event.preventDefault()
                await openPlaylistFromCard(card)
            })

            card.addEventListener('contextmenu', (event) => {
                event.preventDefault()
                event.stopPropagation()

                const playlistId = card.getAttribute('data-playlist-id')
                showContextMenu({
                    playlistId,
                    clientX: event.clientX,
                    clientY: event.clientY,
                })
            })
        })

        const playButtons = container.querySelectorAll('.playPlaylistBtn')
        playButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation()
                const card = event.currentTarget.closest('.libraryPlaylistCard')
                const playlistId = card?.getAttribute('data-playlist-id')
                if (!playlistId) {
                    return
                }

                const selectedPlaylist = playlists.find((playlist) => playlist.id === playlistId)
                const filePaths = extractPlaylistFilePaths(selectedPlaylist)

                if (!filePaths.length) {
                    return
                }

                window.playlistViewState = { activePlaylistId: playlistId }
                audioService.startPlaylist(filePaths)
            })
        })
    }

    render()

    const onPlaylistsUpdated = () => {
        // Only re-render if we're currently viewing the library page
        if (isRouteActive('library')) {
            render()
        }
    }

    window.addEventListener('user-playlists:updated', onPlaylistsUpdated)

    const cleanup = () => {
        window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
        cleanupContextMenuDismiss()
        closeContextMenu()
        contextMenu?.remove()
        contextMenu = null
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
}

window.initializeLibraryPage = initializeLibraryPage
