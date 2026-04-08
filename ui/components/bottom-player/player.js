const playerState = window.playerState;
const audioService = window.audioService;

function initializePlayer() {
    const bottomPlayer = document.getElementById('bottom-player');

    if (!bottomPlayer) {
        console.error('Bottom player element not found');
        return;
    }

    const trackTitleElement = bottomPlayer.querySelector('#trackTitle');
    const trackArtistElement = bottomPlayer.querySelector('#trackArtist');
    const albumArtElement = bottomPlayer.querySelector('#albumArt');
    const playPauseBtn = bottomPlayer.querySelector('#playPauseBtn');
    const prevBtn = bottomPlayer.querySelector('#prevBtn');
    const nextBtn = bottomPlayer.querySelector('#nextBtn');
    const progressSlider = bottomPlayer.querySelector('#progressSlider');
    const currentTimeElement = bottomPlayer.querySelector('#currentTime');
    const durationElement = bottomPlayer.querySelector('#duration');
    const volumeSlider = bottomPlayer.querySelector('#volumeSlider');
    const volumeBtn = bottomPlayer.querySelector('#volumeBtn');
    const placeholderCover = audioService?.placeholderCover || './assets/music-placeholder.png';
    let progressRafId = null;

    console.log('Player DOM elements found');

    function updatePlayerUI() {
        // console.log('updatePlayerUI triggered');
        const { currentTrack, isPlaying, volume } = playerState.getState();
        const title = currentTrack?.title || 'No song selected';
        const artist = currentTrack?.artist || 'Unknown artist';
        const image = currentTrack?.image || placeholderCover;

        if (trackTitleElement) trackTitleElement.textContent = title;
        if (trackArtistElement) trackArtistElement.textContent = artist;
        if (albumArtElement) albumArtElement.src = image;

        if (playPauseBtn) {
            const icon = isPlaying ? 'pause' : 'play';
            const existingIcon = playPauseBtn.querySelector('i');
            if (existingIcon) {
                existingIcon.setAttribute('data-lucide', icon);
            } else {
                playPauseBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
            }
            window.lucide.createIcons({ nodes: [playPauseBtn] });
        }

        if (volumeSlider) {
            volumeSlider.value = Number.isFinite(Number(volume)) ? Number(volume) : 0.7;
        }

        const sound = audioService.getCurrentSound();
        if (sound) {
            const seek = sound.seek() || 0;
            const duration = sound.duration() || 0;

            if (progressSlider) {
                progressSlider.value = (seek / duration) * 100 || 0;
            }
            if (currentTimeElement) {
                currentTimeElement.textContent = formatTime(seek);
            }
            if (durationElement) {
                durationElement.textContent = formatTime(duration);
            }
        } else {
            if (progressSlider) progressSlider.value = 0;
            if (currentTimeElement) currentTimeElement.textContent = '0:00';
            if (durationElement) durationElement.textContent = '0:00';
        }
    }

    function formatTime(secs) {
        const minutes = Math.floor(secs / 60) || 0;
        const seconds = Math.floor(secs % 60) || 0;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    function setupEventListeners() {
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                console.log('Play/Pause button clicked');
                const { isPlaying } = playerState.getState();
                // playerState.setIsPlaying(!isPlaying);
                audioService.togglePlayPause();
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                audioService.playPrevious();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                audioService.playNext();
            });
        }

        if (progressSlider) {
            progressSlider.addEventListener('input', (e) => {
                const sound = audioService.getCurrentSound();
                if (sound) {
                    const duration = sound.duration();
                    const newSeek = (e.target.value / 100) * duration;
                    sound.seek(newSeek);
                }
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const newVolume = Number(e.target.value);
                console.log('Volume changed:', newVolume);
                audioService.setVolume(newVolume);
            });
        }

        if (volumeBtn) {
            volumeBtn.addEventListener('click', () => {
                // volume mute/unmute

            });
        }

        if (albumArtElement) {
            albumArtElement.addEventListener('error', () => {
                albumArtElement.src = placeholderCover;
            });
        }
    }

    function startStateSync() {
        updatePlayerUI(); // Initial UI update

        function stopProgressLoop() {
            if (progressRafId !== null) {
                cancelAnimationFrame(progressRafId);
                progressRafId = null;
            }
        }

        function updateProgress() {
            const sound = audioService.getCurrentSound();
            const { isPlaying } = playerState.getState();

            if (!sound || !isPlaying) {
                stopProgressLoop();
                return;
            }

            const seek = sound.seek() || 0;
            const duration = sound.duration() || 0;
            if (progressSlider) progressSlider.value = (seek / duration) * 100 || 0;
            if (currentTimeElement) currentTimeElement.textContent = formatTime(seek);
            if (durationElement) durationElement.textContent = formatTime(duration);

            progressRafId = requestAnimationFrame(updateProgress);
        }

        function startProgressLoop() {
            if (progressRafId !== null) {
                return;
            }

            const sound = audioService.getCurrentSound();
            const { isPlaying } = playerState.getState();
            if (!sound || !isPlaying) {
                return;
            }

            progressRafId = requestAnimationFrame(updateProgress);
        }

        const unsubscribe = playerState.subscribe(() => {
            updatePlayerUI();

            const sound = audioService.getCurrentSound();
            const { isPlaying } = playerState.getState();
            if (sound && isPlaying) {
                startProgressLoop();
            } else {
                stopProgressLoop();
            }
        });

        window.addEventListener('beforeunload', () => {
            stopProgressLoop();
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }, { once: true });

        startProgressLoop();
    }

    setupEventListeners();
    startStateSync();
    console.log('Player setup complete');
}
window.initializePlayer = initializePlayer;
