export const playerState = (() => {
    const state = {
        playlist: [],
        currentTrackIndex: -1,
        isPlaying: false,
        progress: {
            currentTime: 0,
            duration: 0,
            percent: 0,
        },
        volume: 0.7,
        currentTrack: {
            filePath: null,
            title: 'No song selected',
            artist: 'Unknown artist',
            image: './assets/music-placeholder.png',
        },
    }
    const listeners = []

    function createStateSnapshot() {
        return {
            playlist: state.playlist,
            currentTrackIndex: state.currentTrackIndex,
            isPlaying: state.isPlaying,
            progress: { ...state.progress },
            volume: state.volume,
            currentTrack: { ...state.currentTrack },
        }
    }

    function notify() {
        const snapshot = createStateSnapshot()
        listeners.slice().forEach((fn) => fn(snapshot))
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') {
            return () => {}
        }

        listeners.push(fn)
        return () => {
            const index = listeners.indexOf(fn)
            if (index >= 0) {
                listeners.splice(index, 1)
            }
        }
    }

    function setIsPlaying(value) {
        const nextValue = Boolean(value)
        if (state.isPlaying === nextValue) {
            return
        }

        state.isPlaying = nextValue
        notify()
    }

    function setProgress(progress) {
        const nextProgress = { ...state.progress, ...(progress || {}) }
        if (
            state.progress.currentTime === nextProgress.currentTime &&
            state.progress.duration === nextProgress.duration &&
            state.progress.percent === nextProgress.percent
        ) {
            return
        }

        state.progress = nextProgress
        notify()
    }

    function setVolume(volume) {
        if (state.volume === volume) {
            return
        }

        state.volume = volume
        notify()
    }

    function setCurrentTrack(track) {
        const nextTrack = { ...state.currentTrack, ...(track || {}) }
        if (
            state.currentTrack.filePath === nextTrack.filePath &&
            state.currentTrack.title === nextTrack.title &&
            state.currentTrack.artist === nextTrack.artist &&
            state.currentTrack.image === nextTrack.image
        ) {
            return
        }

        state.currentTrack = nextTrack
        notify()
    }

    function arePlaylistsEqual(nextPlaylist) {
        if (state.playlist.length !== nextPlaylist.length) {
            return false
        }

        return state.playlist.every((filePath, index) => filePath === nextPlaylist[index])
    }

    function setPlaylist(filePaths) {
        const nextPlaylist = Array.isArray(filePaths) ? [...filePaths] : []
        if (arePlaylistsEqual(nextPlaylist)) {
            return
        }

        state.playlist = nextPlaylist
        notify()
    }

    function setCurrentTrackIndex(index) {
        const nextIndex = Number.isInteger(index) ? index : -1
        if (state.currentTrackIndex === nextIndex) {
            return
        }

        state.currentTrackIndex = nextIndex
        notify()
    }

    function reset() {
        state.playlist = []
        state.currentTrackIndex = -1
        state.isPlaying = false
        state.progress = { currentTime: 0, duration: 0, percent: 0 }
        state.currentTrack = {
            filePath: null,
            title: 'No song selected',
            artist: 'Unknown artist',
            image: './assets/music-placeholder.png',
        }
        notify()
    }

    return {
        getState: createStateSnapshot,
        setPlaylist,
        setCurrentTrackIndex,
        setIsPlaying,
        setProgress,
        setCurrentTrack,
        setVolume,
        reset,
        subscribe,
    }
})()

window.playerState = playerState
