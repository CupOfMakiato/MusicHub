function InitializeRecentMusic() {
    const recentMusic = document.getElementById('recent-music')
    if (!recentMusic) {
        console.error('Recent music element not found');
        return;
    }

    async function loadAndRenderRecentTracks() {
        try {
            if (!window.electronAPI?.loadRecentTracks) {
                console.warn('loadRecentTracks not available from electronAPI')
                return
            }

            const tracks = await window.electronAPI.loadRecentTracks()
            const container = recentMusic.querySelector('.recentMusicList') || recentMusic

            if (!tracks || tracks.length === 0) {
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
                    </li>
                `
            })
            html += '</ul>'
            container.innerHTML = html

            // Add click handlers
            const trackElements = recentMusic.querySelectorAll('.recentTrack')
            trackElements.forEach((element) => {
                element.addEventListener('click', () => {
                    const filePath = element.getAttribute('data-file-path')
                    if (filePath && window.audioService) {
                        window.audioService.startPlaylist([filePath])
                    }
                })
            })
        } catch (error) {
            console.error('Failed to load recent tracks:', error)
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML
    }

    // Load and render on initialization
    loadAndRenderRecentTracks()

    // Reload when player state changes (when a new track is played)
    if (window.playerState) {
        window.playerState.subscribe(() => {
            loadAndRenderRecentTracks()
        })
    }
}

window.InitializeRecentMusic = InitializeRecentMusic;