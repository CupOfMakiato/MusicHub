window.audioService = (() => {
	const placeholderCover = './assets/music-placeholder.png'
	const DEFAULT_VOLUME = 0.7
	const METADATA_DEBUG_ENABLED = true
	const state = window.playerState
	const sessionService = window.sessionService
	let music = null
	let progressTimer = null
	let currentSound = null
	let playbackPersistTimer = null

	function normalizeVolume(value) {
		const parsed = Number(value)
		if (!Number.isFinite(parsed)) return DEFAULT_VOLUME
		return Math.max(0, Math.min(1, parsed))
	}

	function toFileUrl(filePath) {
		if (!filePath) return null
		const normalizedPath = filePath.replace(/\\/g, '/')
		const needsLeadingSlash = /^[A-Za-z]:\//.test(normalizedPath)
		return encodeURI(`file://${needsLeadingSlash ? '/' : ''}${normalizedPath}`)
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

	function logMetadataDebug(filePath, phase, payload = {}) {
		if (!METADATA_DEBUG_ENABLED) return
		const fileName = getFileName(filePath)
		// console.log('[metadata-debug]', {
		// 	phase,
		// 	filePath,
		// 	fileName,
		// 	...payload,
		// })
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

	function stopPlaybackPersistTracking() {
		if (playbackPersistTimer) {
			window.clearInterval(playbackPersistTimer)
			playbackPersistTimer = null
		}
	}

	function savePlaybackSnapshot(positionOverride) {
		if (!state || !sessionService?.savePlaylist) return
		const { playlist, currentTrackIndex } = state.getState()
		if (!Array.isArray(playlist) || playlist.length === 0 || currentTrackIndex < 0) return

		const position = Number.isFinite(Number(positionOverride))
			? Number(positionOverride)
			: Number(currentSound?.seek?.() || 0)

		sessionService.savePlaylist(playlist, currentTrackIndex, Math.max(0, position))
	}

	function startPlaybackPersistTracking() {
		stopPlaybackPersistTracking()
		playbackPersistTimer = window.setInterval(() => {
			savePlaybackSnapshot()
		}, 1000)
	}

	async function readMetadata(filePath, fallbackTitle) {
		if (!window.jsmediatags) {
			logMetadataDebug(filePath, 'jsmediatags-missing', {
				fallbackTitle,
			})
			return {
				title: fallbackTitle,
				artist: 'No metadata available',
				album: 'No metadata available',
				image: null,
			}
		}

		try {
			const fileData = await window.electronAPI.readAudioFile(filePath)

			if (!fileData) {
				logMetadataDebug(filePath, 'file-data-missing', {
					fallbackTitle,
				})
				return {
					title: fallbackTitle,
					artist: 'No metadata available',
					album: 'No metadata available',
					image: null,
				}
			}

			const uint8Array = new Uint8Array(fileData)
			const blob = new Blob([uint8Array], { type: 'audio/mpeg' })

			return await new Promise((resolve) => {
				window.jsmediatags.read(blob, {
					onSuccess: (tag) => {
						const rawTags = tag?.tags || {}
						const pictureBytes = rawTags?.picture?.data?.length || 0
						logMetadataDebug(filePath, 'metadata-loaded', {
							fallbackTitle,
							title: rawTags.title || null,
							artist: rawTags.artist || null,
							album: rawTags.album || null,
							year: rawTags.year || null,
							genre: rawTags.genre || null,
							track: rawTags.track || null,
							disc: rawTags.disc || null,
							hasPicture: Boolean(rawTags.picture),
							pictureFormat: rawTags?.picture?.format || null,
							pictureBytes,
						})
						resolve({
							title: rawTags.title || fallbackTitle || 'Unknown Title',
							artist: rawTags.artist || 'Unknown Artist',
							album: rawTags.album || 'Unknown Album',
							image: getPictureDataUrl(rawTags.picture),
						})
					},
					onError: (error) => {
						logMetadataDebug(filePath, 'metadata-read-error', {
							fallbackTitle,
							error: error?.info || error?.type || String(error || 'unknown error'),
						})
						resolve({
							title: fallbackTitle,
							artist: 'No metadata available',
							album: 'No metadata available',
							image: null,
						})
					},
				})
			})
		} catch (error) {
			logMetadataDebug(filePath, 'metadata-exception', {
				fallbackTitle,
				error: String(error?.message || error || 'unknown error'),
			})
			return {
				title: fallbackTitle,
				artist: 'No metadata available',
				album: 'No metadata available',
				image: null,
			}
		}
	}

	function clearCurrentMusic() {
		if (!currentSound) return
		currentSound.stop()
		currentSound.unload()
		currentSound = null
		stopProgressTracking()
		stopPlaybackPersistTracking()
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
			if (currentSound) {
				currentSound.stop()
				currentSound.unload()
				currentSound = null
			}
			stopPlaybackPersistTracking()
			state.setIsPlaying(false)
			state.setProgress({ currentTime: 0, duration: 0, percent: 0 })
			return
		}
		playTrackAtIndex(nextIndex)
	}

	async function playTrackAtIndex(index, options = {}) {
		if (!state) return
		const { playlist } = state.getState()
		if (index < 0 || index >= playlist.length) return
		const autoplay = options.autoplay !== false
		const addToRecentTracks = options.addToRecentTracks !== false
		const startAtSeconds = Math.max(0, Number(options.startAtSeconds) || 0)

		const filePath = playlist[index]
		const trackData = await readMetadata(filePath, getFileName(filePath))
		logMetadataDebug(filePath, 'metadata-resolved-for-playback', {
			resolvedTitle: trackData?.title || null,
			resolvedArtist: trackData?.artist || null,
			resolvedAlbum: trackData?.album || null,
			hasImage: Boolean(trackData?.image),
		})

		state.setCurrentTrackIndex(index)
		state.setCurrentTrack(trackData)

		// Save current track index and playlist
		sessionService?.savePlaylist(playlist, index, startAtSeconds)

		// Add to recent tracks
		if (addToRecentTracks && sessionService?.prependRecentTrack) {
			const recentTrack = {
				filePath,
				title: trackData.title,
				artist: trackData.artist,
				album: trackData.album,
				image: trackData.image,
				playedAt: new Date().toISOString(),
			}
			sessionService.prependRecentTrack(recentTrack)
				.catch((error) => {
					console.error('Failed to update recent tracks:', error)
				})
		}

		if (currentSound) {
			savePlaybackSnapshot()
			stopPlaybackPersistTracking()
			currentSound.stop()
		}

		const { volume } = state.getState()
		console.log('Playing track with volume:', volume)

		currentSound = new Howl({
			src: [toFileUrl(filePath)],
			html5: true,
			volume,
			onload: () => {
				if (startAtSeconds > 0 && currentSound) {
					currentSound.seek(startAtSeconds)
					const duration = currentSound.duration() || 0
					const percent = duration > 0 ? Math.min(100, (startAtSeconds / duration) * 100) : 0
					state.setProgress({ currentTime: startAtSeconds, duration, percent })
				}
			},
			onplay: () => {
				state.setIsPlaying(true)
				startPlaybackPersistTracking()
			},
			onpause: () => {
				state.setIsPlaying(false)
				savePlaybackSnapshot()
				stopPlaybackPersistTracking()
			},
			onend: () => playNextInQueue(),
			onseek: () => {
				savePlaybackSnapshot()
			},
		})

		if (autoplay) {
			currentSound.play()
		} else {
			state.setIsPlaying(false)
			state.setProgress({ currentTime: startAtSeconds, percent: 0 })
		}
	}

	function togglePlayPause() {
		if (!currentSound) {
			const { playlist, currentTrackIndex } = state?.getState?.() || {}
			if (Array.isArray(playlist) && currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
				playTrackAtIndex(currentTrackIndex, {
					autoplay: true,
					startAtSeconds: 0,
					addToRecentTracks: false,
				})
			}
			return
		}
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
		
		// Save playlist for next session
		sessionService?.savePlaylist(filePaths, 0)
		
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
		const normalizedVolume = normalizeVolume(volume)
		if (Howler) {
			Howler.volume(normalizedVolume)
		}
		state.setVolume(normalizedVolume)

		sessionService?.saveVolume(normalizedVolume)
	}

	async function initializeVolumeFromStore() {
		if (!sessionService?.loadSavedVolume) {
			setVolume(DEFAULT_VOLUME)
			return
		}

		try {
			const savedVolume = await sessionService.loadSavedVolume()
			setVolume(savedVolume)
		} catch (error) {
			console.error('Failed to load saved volume:', error)
			setVolume(DEFAULT_VOLUME)
		}
	}

	initializeVolumeFromStore()

	window.addEventListener('beforeunload', () => {
		savePlaybackSnapshot()
		stopPlaybackPersistTracking()
		if (currentSound) {
			currentSound.unload()
			currentSound = null
		}
	})

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
		clearCurrentMusic,
	}
})()