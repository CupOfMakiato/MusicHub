window.sessionService = (() => {
	const DEFAULT_VOLUME = 0.7
	const MAX_RECENT_TRACKS = 10
	const USER_PLAYLISTS_KEY = 'musichub:user-playlists'

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

	async function approveRecentAudioPath(filePath) {
		if (!hasAPI('approveRecentAudioPath')) {
			return false
		}

		try {
			return Boolean(await window.electronAPI.approveRecentAudioPath(filePath))
		} catch (error) {
			console.error('Failed to approve recent audio path:', error)
			return false
		}
	}

	function normalizeUserPlaylists(playlists) {
		if (!Array.isArray(playlists)) {
			return []
		}

		return playlists
			.map((playlist) => ({
				id: typeof playlist?.id === 'string' ? playlist.id : `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
				name: typeof playlist?.name === 'string' && playlist.name.trim() ? playlist.name.trim() : 'Untitled Playlist',
				banner: typeof playlist?.banner === 'string' ? playlist.banner : '',
				tracks: Array.isArray(playlist?.tracks)
					? playlist.tracks.filter((track) => Boolean(track?.filePath)).map((track) => ({
						...track,
						album: typeof track?.album === 'string' ? track.album : 'Unknown Album',
					}))
					: [],
				createdAt: typeof playlist?.createdAt === 'string' ? playlist.createdAt : new Date().toISOString(),
				updatedAt: typeof playlist?.updatedAt === 'string' ? playlist.updatedAt : new Date().toISOString(),
			}))
			.filter((playlist) => Boolean(playlist.id))
	}

	async function loadUserPlaylists() {
		try {
			const raw = window.localStorage.getItem(USER_PLAYLISTS_KEY)
			if (!raw) {
				return []
			}

			const parsed = JSON.parse(raw)
			return normalizeUserPlaylists(parsed)
		} catch (error) {
			console.error('Failed to load user playlists:', error)
			return []
		}
	}

	async function saveUserPlaylists(playlists) {
		try {
			const normalized = normalizeUserPlaylists(playlists)
			window.localStorage.setItem(USER_PLAYLISTS_KEY, JSON.stringify(normalized))
			window.dispatchEvent(new CustomEvent('user-playlists:updated'))
			return true
		} catch (error) {
			console.error('Failed to save user playlists:', error)
			return false
		}
	}

	async function addTrackToUserPlaylist(playlistId, track) {
		if (!playlistId || !track?.filePath) {
			return false
		}

		const playlists = await loadUserPlaylists()
		const target = playlists.find((playlist) => playlist.id === playlistId)
		if (!target) {
			return false
		}

		const exists = target.tracks.some((item) => item.filePath === track.filePath)
		if (!exists) {
			target.tracks.push(track)
			target.updatedAt = new Date().toISOString()
		}

		return saveUserPlaylists(playlists)
	}

	async function createUserPlaylist({ name, banner = '' }) {
		const playlists = await loadUserPlaylists()
		const now = new Date().toISOString()
		const newPlaylist = {
			id: `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
			name: typeof name === 'string' && name.trim() ? name.trim() : `New Playlist ${playlists.length + 1}`,
			banner: typeof banner === 'string' ? banner.trim() : '',
			tracks: [],
			createdAt: now,
			updatedAt: now,
		}

		const saved = await saveUserPlaylists([newPlaylist, ...playlists])
		return saved ? newPlaylist : null
	}

	async function createPlaylistAndAddTrack({ name, banner = '', track }) {
		if (!track?.filePath) {
			return null
		}

		const playlists = await loadUserPlaylists()
		const now = new Date().toISOString()
		const newPlaylist = {
			id: `playlist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
			name: typeof name === 'string' && name.trim() ? name.trim() : `New Playlist ${playlists.length + 1}`,
			banner: typeof banner === 'string' ? banner.trim() : '',
			tracks: [track],
			createdAt: now,
			updatedAt: now,
		}

		const saved = await saveUserPlaylists([newPlaylist, ...playlists])
		return saved ? newPlaylist : null
	}

	return {
		loadSavedVolume,
		saveVolume,
		loadPlaylist,
		savePlaylist,
		loadRecentTracks,
		saveRecentTracks,
		prependRecentTrack,
		approveRecentAudioPath,
		loadUserPlaylists,
		saveUserPlaylists,
		addTrackToUserPlaylist,
		createUserPlaylist,
		createPlaylistAndAddTrack,
	}
})()
