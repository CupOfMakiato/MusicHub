import { escapeHtml, bindImageFallbacks } from '../../utils/dom-helpers.js'
import { resolvePlaylistImage, extractPlaylistFilePaths } from '../../utils/playlist-media.js'
import { sessionService } from '../../services/session-service.js'
import { audioService } from '../../services/audio-service.js'
import { isRouteActive } from '../../utils/route.js'

export function initializeLibraryPage() {
    const container = document.getElementById('libraryPlaylists')
    if (!container) {
        return
    }

    async function render() {
        const playlists = await sessionService.loadUserPlaylists()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            container.innerHTML =
                '<p class="libraryEmpty">No playlists yet. Use Recent Music -> Create New Playlist.</p>'
            return
        }

        container.innerHTML = playlists
            .map((playlist) => {
                const banner = resolvePlaylistImage(playlist)
                const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
                const canPlay = trackCount > 0
                return `
                <article class="libraryPlaylistCard" data-playlist-id="${escapeHtml(playlist.id)}" role="button" tabindex="0" aria-label="Open playlist ${escapeHtml(playlist.name)}">
                    <img src="${escapeHtml(banner)}" alt="${escapeHtml(playlist.name)}">
                    <div class="libraryPlaylistContent">
                        <h3>${escapeHtml(playlist.name)}</h3>
                        <p>${trackCount} songs</p>
                        <div class="libraryPlaylistActions">
                            <button type="button" class="playPlaylistBtn" ${canPlay ? '' : 'disabled'} aria-label="Play playlist">
                                <i data-lucide="play"></i>
                            </button>
                        </div>
                    </div>
                </article>
            `
            })
            .join('')

        bindImageFallbacks({
            scope: container,
            selector: '.libraryPlaylistCard img',
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
    }

    window.appRouter?.registerCurrentRouteCleanup?.(cleanup)
}

window.initializeLibraryPage = initializeLibraryPage
