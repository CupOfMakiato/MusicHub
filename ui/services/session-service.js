window.sessionService = (() => {
	const DEFAULT_VOLUME = 0.7
	const MAX_RECENT_TRACKS = 20

	function normalizeVolume(value) {
		const parsed = Number(value)
		if (!Number.isFinite(parsed)) return DEFAULT_VOLUME
		return Math.max(0, Math.min(1, parsed))
	}

	function hasAPI(methodName) {
		return typeof window.electronAPI?.[methodName] === 'function'
	}

	async function loadSavedVolume() {
		if (!hasAPI('getSavedVolume')) {
			return DEFAULT_VOLUME
		}

		try {
			const value = await window.electronAPI.getSavedVolume()
			return normalizeVolume(value)
		} catch (error) {
			console.error('Failed to load saved volume:', error)
			return DEFAULT_VOLUME
		}
	}

	async function saveVolume(volume) {
		if (!hasAPI('saveVolume')) {
			return false
		}

		try {
			await window.electronAPI.saveVolume(normalizeVolume(volume))
			return true
		} catch (error) {
			console.error('Failed to persist volume:', error)
			return false
		}
	}

	async function loadPlaylist() {
		if (!hasAPI('loadPlaylist')) {
			return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
		}

		try {
			const result = await window.electronAPI.loadPlaylist()
			const playbackPosition = Number(result?.playbackPosition)
			return {
				playlist: Array.isArray(result?.playlist) ? result.playlist : [],
				currentTrackIndex: Number.isInteger(result?.currentTrackIndex) ? result.currentTrackIndex : -1,
				playbackPosition: Number.isFinite(playbackPosition) && playbackPosition >= 0 ? playbackPosition : 0,
			}
		} catch (error) {
			console.error('Failed to load playlist:', error)
			return { playlist: [], currentTrackIndex: -1, playbackPosition: 0 }
		}
	}

	async function savePlaylist(playlist, currentTrackIndex, playbackPosition = 0) {
		if (!hasAPI('savePlaylist')) {
			return false
		}

		try {
			const safePlaylist = Array.isArray(playlist) ? playlist : []
			const safeIndex = Number.isInteger(currentTrackIndex) ? currentTrackIndex : -1
			const parsedPosition = Number(playbackPosition)
			const safePlaybackPosition = Number.isFinite(parsedPosition) && parsedPosition >= 0 ? parsedPosition : 0
			const saved = await window.electronAPI.savePlaylist(safePlaylist, safeIndex, safePlaybackPosition)
			return Boolean(saved)
		} catch (error) {
			console.error('Failed to persist playlist:', error)
			return false
		}
	}

	async function loadRecentTracks() {
		if (!hasAPI('loadRecentTracks')) {
			return []
		}

		try {
			const tracks = await window.electronAPI.loadRecentTracks()
			return Array.isArray(tracks) ? tracks : []
		} catch (error) {
			console.error('Failed to load recent tracks:', error)
			return []
		}
	}

	async function saveRecentTracks(tracks) {
		if (!hasAPI('saveRecentTracks')) {
			return false
		}

		try {
			const safeTracks = Array.isArray(tracks) ? tracks.slice(0, MAX_RECENT_TRACKS) : []
			const saved = await window.electronAPI.saveRecentTracks(safeTracks)
			if (saved) {
				window.dispatchEvent(new CustomEvent('recent-tracks:updated'))
			}
			return Boolean(saved)
		} catch (error) {
			console.error('Failed to save recent tracks:', error)
			return false
		}
	}

	async function prependRecentTrack(track) {
		if (!track?.filePath) {
			return false
		}

		const recent = await loadRecentTracks()
		const updated = [track, ...recent].filter((item, index, self) =>
			index === self.findIndex((entry) => entry.filePath === item.filePath)
		)

		return saveRecentTracks(updated)
	}

	return {
		loadSavedVolume,
		saveVolume,
		loadPlaylist,
		savePlaylist,
		loadRecentTracks,
		saveRecentTracks,
		prependRecentTrack,
	}
})()
