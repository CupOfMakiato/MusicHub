window.audioService = (() => {
	const placeholderCover = './assets/music-placeholder.png'
	const state = window.playerState
	let music = null
	let progressTimer = null
	let currentSound = null

	function toFileUrl(filePath) {
		if (!filePath) return null
		const normalizedPath = filePath.replace(/\\/g, '/')
		return encodeURI(`file://${normalizedPath}`)
	}

	function arrayBufferToBase64(data) {
		let binary = ''
		for (let i = 0; i < data.length; i += 1) {
			binary += String.fromCharCode(data[i])
		}
		return window.btoa(binary)
	}

	function normalizeImageMime(format) {
		const normalized = (format || 'image/jpeg').toLowerCase()

		if (normalized.includes('/')) {
			return normalized
		}

		if (normalized === 'jpg') {
			return 'image/jpeg'
		}

		return `image/${normalized}`
	}

	function getPictureDataUrl(picture) {
		if (!picture || !picture.data) return null

		const mimeType = normalizeImageMime(picture.format)
		const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data)
		return `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`
	}

	function getFileName(filePath) {
		if (!filePath) return 'Unknown Title'
		const segments = filePath.split(/\\|\//)
		return segments[segments.length - 1] || 'Unknown Title'
	}

	function stopProgressTracking() {
		if (progressTimer) {
			window.clearInterval(progressTimer)
			progressTimer = null
		}
	}

	function updateProgressSnapshot() {
		if (!music || !state) return
		const currentTime = music.seek() || 0
		const duration = music.duration() || 0
		const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
		state.setProgress({ currentTime, duration, percent })
	}

	function startProgressTracking() {
		stopProgressTracking()
		// progressTimer = window.setInterval(updateProgressSnapshot, 250)
	}

	async function readMetadata(filePath, fallbackTitle) {
		if (!window.jsmediatags) {
			return {
				title: fallbackTitle,
				artist: 'No metadata available',
				image: null,
			}
		}

		try {
			const fileData = await window.electronAPI.readAudioFile(filePath)

			if (!fileData) {
				return {
					title: fallbackTitle,
					artist: 'No metadata available',
					image: null,
				}
			}

			const uint8Array = new Uint8Array(fileData)
			const blob = new Blob([uint8Array], { type: 'audio/mpeg' })

			return await new Promise((resolve) => {
				window.jsmediatags.read(blob, {
					onSuccess: (tag) => {
						resolve({
							title: tag.tags.title || fallbackTitle || 'Unknown Title',
							artist: tag.tags.artist || 'Unknown Artist',
							image: getPictureDataUrl(tag.tags.picture),
						})
					},
					onError: () => {
						resolve({
							title: fallbackTitle,
							artist: 'No metadata available',
							image: null,
						})
					},
				})
			})
		} catch (error) {
			return {
				title: fallbackTitle,
				artist: 'No metadata available',
				image: null,
			}
		}
	}

	function clearCurrentMusic() {
		if (!music) return
		music.stop()
		music.unload()
		music = null
		stopProgressTracking()
		if (state) {
			state.setIsPlaying(false)
			state.setProgress({ currentTime: 0, duration: 0, percent: 0 })
		}
	}

	function playNextInQueue() {
		if (!state) return
		const { currentTrackIndex, playlist } = state.getState()
		const nextIndex = currentTrackIndex + 1
		if (nextIndex >= playlist.length) {
			state.setIsPlaying(false)
			state.setProgress({ currentTime: 0, duration: 0, percent: 0 })
			return
		}
		playTrackAtIndex(nextIndex)
	}

	async function playTrackAtIndex(index) {
		if (!state) return
		const { playlist } = state.getState()
		if (index < 0 || index >= playlist.length) return

		const filePath = playlist[index]
		const trackData = await readMetadata(filePath)

		state.setCurrentTrackIndex(index)
		state.setCurrentTrack(trackData)

		if (currentSound) {
			currentSound.stop()
		}

		const { volume } = state.getState()
		console.log('Playing track with volume:', volume)

		currentSound = new Howl({
			src: [filePath],
			html5: true,
			volume,
			onplay: () => state.setIsPlaying(true),
			onpause: () => state.setIsPlaying(false),
			onend: () => playNextInQueue(),
			onseek: () => {
			},
		})

		currentSound.play()
	}

	function togglePlayPause() {
		if (!currentSound) return
		if (currentSound.playing()) {
			currentSound.pause()
		} else {
			currentSound.play()
		}
	}

	// let isToggling = false;

	// function togglePlayPause() {
	// 	if (!music || isToggling) return;
	// 	isToggling = true;
		
	// 	if (music.playing()) {
	// 		music.pause();
	// 	} else {
	// 		music.play();
	// 	}
		
	// 	setTimeout(() => { isToggling = false; }, 300);
	// }

	function startPlaylist(filePaths) {
		if (!state) return
		if (!Array.isArray(filePaths) || filePaths.length === 0) return
		state.setPlaylist(filePaths)
		playTrackAtIndex(0)
	}

	async function playNext() {
		playNextInQueue()
	}

	function playPrevious() {
		if (!state) return
		const { currentTrackIndex } = state.getState()
		const prevIndex = currentTrackIndex - 1
		if (prevIndex >= 0) {
			playTrackAtIndex(prevIndex)
		}
	}

	function setVolume(volume) {
		if (Howler) {
			Howler.volume(volume)
			state.setVolume(volume)
		}
	}

	function getCurrentSound() {
		return currentSound
	}

	return {
		placeholderCover,
		playTrackAtIndex,
		startPlaylist,
		togglePlayPause,
		playNext: playNextInQueue,
		playPrevious: () => {
			playPrevious()
		},
		setVolume,
		getCurrentSound,
	}
})()