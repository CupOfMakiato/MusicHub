window.playerState = (() => {
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

    function notify() {
        listeners.forEach(fn => fn(state))
    }

    function subscribe(fn) {
        listeners.push(fn)
        return () => {
            const index = listeners.indexOf(fn)
            if (index >= 0) {
            	listeners.splice(index, 1) // returns unsubscribe
			}
		} 
    }


    function setIsPlaying(value) {
        state.isPlaying = Boolean(value)
        notify() //trigger at pause/play
    }

    function setProgress(progress) {
        state.progress = { ...state.progress, ...progress }
        notify()
    }

	function setVolume(volume) {
		state.volume = volume
		notify()
	}

	function setCurrentTrack(track) {
		state.currentTrack = { ...state.currentTrack, ...track }
		notify()
	}

	function setPlaylist(filePaths) {
		state.playlist = Array.isArray(filePaths) ? [...filePaths] : []
        notify();
	}

	function setCurrentTrackIndex(index) {
		state.currentTrackIndex = Number.isInteger(index) ? index : -1
        notify();
	}

	function reset() {
		setPlaylist([])
		setCurrentTrackIndex(-1)
		setIsPlaying(false)
		setProgress({ currentTime: 0, duration: 0, percent: 0 })
		setCurrentTrack({
			filePath: null,
			title: 'No song selected',
			artist: 'Unknown artist',
			image: './assets/music-placeholder.png',
		})
        notify();
	}

	return {
		getState: () => ({ ...state }),
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
