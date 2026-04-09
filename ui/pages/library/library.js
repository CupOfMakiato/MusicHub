function initializeLibraryPage() {
    const container = document.getElementById('libraryPlaylists')
    if (!container) {
        return
    }

    const escapeHtml = window.domHelpers?.escapeHtml
    if (typeof escapeHtml !== 'function') {
        console.error('domHelpers.escapeHtml is not available in library page')
        return
    }

    function isLibraryRouteActive() {
        return window.appRouter?.getCurrentRoute?.() === 'library'
    }

    async function render() {
        const playlists = await window.sessionService?.loadUserPlaylists?.()
        if (!Array.isArray(playlists) || playlists.length === 0) {
            container.innerHTML = '<p class="libraryEmpty">No playlists yet. Use Recent Music -> Create New Playlist.</p>'
            return
        }

        container.innerHTML = playlists.map((playlist) => {
            const banner = playlist.banner || './assets/music-placeholder.png'
            const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
            return `
                <article class="libraryPlaylistCard" data-playlist-id="${escapeHtml(playlist.id)}">
                    <img src="${escapeHtml(banner)}" alt="${escapeHtml(playlist.name)}" onerror="this.src='./assets/music-placeholder.png'">
                    <div class="libraryPlaylistContent">
                        <h3>${escapeHtml(playlist.name)}</h3>
                        <p>${trackCount} songs</p>
                        <button type="button" class="openPlaylistBtn">Open Playlist</button>
                    </div>
                </article>
            `
        }).join('')

        const openButtons = container.querySelectorAll('.openPlaylistBtn')
        openButtons.forEach((button) => {
            button.addEventListener('click', async (event) => {
                const card = event.currentTarget.closest('.libraryPlaylistCard')
                const playlistId = card?.getAttribute('data-playlist-id')
                if (!playlistId) {
                    return
                }

                window.playlistViewState = { activePlaylistId: playlistId }
                await window.appRouter?.goTo?.('playlist')
            })
        })
    }

    render()

    const onPlaylistsUpdated = () => {
        // Only re-render if we're currently viewing the library page
        if (isLibraryRouteActive()) {
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
