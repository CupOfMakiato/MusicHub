function initializePlaylistPage() {
	const picker = document.getElementById('playlistPicker')
	const title = document.getElementById('playlistTitle')
	const trackCountElement = document.getElementById('playlistTrackCount')
	const durationElement = document.getElementById('playlistDuration')
	const image = document.getElementById('playlistImage')
	// const banner = document.getElementById('playlistHeaderBanner')
	const body = document.getElementById('playlistTrackBody')
	const playButton = document.getElementById('playlistPlayBtn')

	if (!picker || !title || !image 
        // || !banner 
         || !body || !playButton) {
		return
	}

	const domHelpers = window.domHelpers
	if (!domHelpers?.escapeHtml || !domHelpers?.attachIndexedMenuToggle) {
		console.error('domHelpers is not available in playlist page')
		return
	}

	const { escapeHtml, attachIndexedMenuToggle } = domHelpers

	let playlists = []
	let activePlaylistId = window.playlistViewState?.activePlaylistId || null
	const durationCache = new Map()
	let durationProbeRunId = 0
	let totalDurationRunId = 0
	let cleanupTrackMenuToggles = null

	function renderPlayButtonIcon() {
		if (!playButton) {
			return
		}

		const existingIcon = playButton.querySelector('i')
		if (existingIcon) {
			existingIcon.setAttribute('data-lucide', 'play')
		}

		window.lucide?.createIcons({ nodes: [playButton] })
	}

	function isPlaylistRouteActive() {
		const route = window.appRouter?.getCurrentRoute?.()
		return route === 'playlist' || route === 'queue'
	}

	function formatDate(value) {
		if (!value) return '-'
		const date = new Date(value)
		if (Number.isNaN(date.getTime())) return '-'
		return date.toLocaleDateString()
	}

	function getFallbackTitle(filePath) {
		if (!filePath) return 'Unknown Title'
		const parts = String(filePath).split(/\\|\//)
		return parts[parts.length - 1] || 'Unknown Title'
	}

	function formatDuration(totalSeconds) {
		const safeSeconds = Number(totalSeconds)
		if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) {
			return '-'
		}

		const rounded = Math.floor(safeSeconds)
		const hours = Math.floor(rounded / 3600)
		const minutes = Math.floor((rounded % 3600) / 60)
		const seconds = rounded % 60

		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
		}

		return `${minutes}:${String(seconds).padStart(2, '0')}`
	}

	function toFileUrl(filePath) {
		if (!filePath) return null
		const normalizedPath = String(filePath).replace(/\\/g, '/')
		const needsLeadingSlash = /^[A-Za-z]:\//.test(normalizedPath)
		return encodeURI(`file://${needsLeadingSlash ? '/' : ''}${normalizedPath}`)
	}

	function probeAudioDuration(filePath) {
		return new Promise((resolve) => {
			const url = toFileUrl(filePath)
			if (!url) {
				resolve(null)
				return
			}

			const audio = new Audio()
			audio.preload = 'metadata'

			const cleanup = () => {
				audio.removeEventListener('loadedmetadata', onLoadedMetadata)
				audio.removeEventListener('error', onError)
				audio.src = ''
			}

			const onLoadedMetadata = () => {
				const duration = Number(audio.duration)
				cleanup()
				resolve(Number.isFinite(duration) && duration > 0 ? duration : null)
			}

			const onError = () => {
				cleanup()
				resolve(null)
			}

			audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
			audio.addEventListener('error', onError, { once: true })
			audio.src = url
		})
	}

	async function resolveTrackDuration(track) {
		if (typeof track?.duration === 'number' && track.duration > 0) {
			return track.duration
		}

		const filePath = track?.filePath
		if (!filePath) {
			return null
		}

		if (durationCache.has(filePath)) {
			return durationCache.get(filePath)
		}

		const duration = await probeAudioDuration(filePath)
		durationCache.set(filePath, duration)
		return duration
	}

	async function hydrateTrackDurations(activePlaylist) {
		const runId = ++durationProbeRunId
		if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || activePlaylist.tracks.length === 0) {
			return
		}

		const results = await Promise.all(activePlaylist.tracks.map(async (track, index) => {
			const duration = await resolveTrackDuration(track)
			return { index, duration }
		}))

		if (runId !== durationProbeRunId) {
			return
		}

		results.forEach(({ index, duration }) => {
			const durationCell = body.querySelector(`td[data-duration-index="${index}"]`)
			if (durationCell) {
				durationCell.textContent = formatDuration(duration)
			}
		})
	}

	async function renderTotalDuration(activePlaylist) {
		if (!durationElement) {
			return
		}

		if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || activePlaylist.tracks.length === 0) {
			durationElement.textContent = ''
			return
		}

		durationElement.textContent = ', ...'
		const runId = ++totalDurationRunId
		const durations = await Promise.all(activePlaylist.tracks.map((track) => resolveTrackDuration(track)))

		if (runId !== totalDurationRunId) {
			return
		}

		const totalSeconds = durations.reduce((sum, value) => sum + (Number(value) || 0), 0)
		durationElement.textContent = `, ${formatDuration(totalSeconds)}`
	}

	function getActivePlaylist() {
		return playlists.find((playlist) => playlist.id === activePlaylistId) || null
	}

	function renderPicker() {
		if (!playlists.length) {
			picker.innerHTML = '<option value="">No playlists</option>'
			picker.disabled = true
			return
		}

		picker.disabled = false
		picker.innerHTML = playlists.map((playlist) => {
			const selected = playlist.id === activePlaylistId ? 'selected' : ''
			return `<option value="${escapeHtml(playlist.id)}" ${selected}>${escapeHtml(playlist.name)}</option>`
		}).join('')
	}

	function renderTracks(activePlaylist) {
		if (typeof cleanupTrackMenuToggles === 'function') {
			cleanupTrackMenuToggles()
			cleanupTrackMenuToggles = null
		}

		if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || activePlaylist.tracks.length === 0) {
			body.innerHTML = '<tr><td colspan="7" class="playlistEmptyRow">No tracks in this playlist yet.</td></tr>'
			return
		}

		body.innerHTML = activePlaylist.tracks.map((track, index) => {
			const trackTitle = track?.title || getFallbackTitle(track?.filePath)
			const artist = track?.artist || 'Unknown Artist'
			const album = track?.album || 'Unknown Album'
			const dateAdded = formatDate(track?.playedAt || track?.addedAt)
			const duration = typeof track?.duration === 'number' && track.duration > 0
				? track.duration
				: durationCache.get(track?.filePath)
			return `
				<tr class="playlistTrackRow" data-track-index="${index}">
					<td>${index + 1}</td>
					<td>${escapeHtml(trackTitle)}</td>
					<td>${escapeHtml(artist)}</td>
					<td>${escapeHtml(album)}</td>
					<td>${dateAdded}</td>
					<td data-duration-index="${index}">${formatDuration(duration)}</td>
					<td>
						<div class="playlistTrackActions">
							<button type="button" class="playlistTrackMoreBtn" data-track-index="${index}" aria-label="Track actions">
								<i data-lucide="ellipsis"></i>
							</button>
							<div class="playlistTrackMenu" data-track-index="${index}">
								<button type="button" class="removeTrackBtn" data-track-index="${index}">Remove from Playlist</button>
							</div>
						</div>
					</td>
				</tr>
			`
		}).join('')

		hydrateTrackDurations(activePlaylist)

		window.lucide?.createIcons()

		cleanupTrackMenuToggles = attachIndexedMenuToggle({
			scope: body,
			triggerSelector: '.playlistTrackMoreBtn',
			menuSelector: '.playlistTrackMenu',
			indexAttribute: 'data-track-index',
		})

		const removeButtons = body.querySelectorAll('.removeTrackBtn')
		removeButtons.forEach((button) => {
			button.addEventListener('click', async (event) => {
				event.stopPropagation()
				event.preventDefault()

				const trackIndex = Number(button.getAttribute('data-track-index'))
				const activePlaylist = getActivePlaylist()
				if (!activePlaylist || !Number.isInteger(trackIndex)) {
					return
				}

				const nextTracks = Array.isArray(activePlaylist.tracks)
					? activePlaylist.tracks.filter((_, index) => index !== trackIndex)
					: []

				const updatedPlaylists = playlists.map((playlist) => {
					if (playlist.id !== activePlaylist.id) {
						return playlist
					}

					return {
						...playlist,
						tracks: nextTracks,
						updatedAt: new Date().toISOString(),
					}
				})

				playlists = updatedPlaylists
				await window.sessionService?.saveUserPlaylists?.(updatedPlaylists)
				activePlaylistId = activePlaylist.id
				window.playlistViewState = { activePlaylistId }
				render()
			})
		})
	}

	function renderHeader(activePlaylist) {
		if (!activePlaylist) {
			title.textContent = 'No playlist selected'
			if (trackCountElement) {
				trackCountElement.textContent = 'Choose a playlist from your library.'
			}
			if (durationElement) {
				durationElement.textContent = ''
			}
			image.src = './assets/music-placeholder.png'
			// banner.style.backgroundImage = 'none'
			return
		}

        // header body
		const firstTrackImage = activePlaylist.tracks?.[0]?.image
		// const bannerImage = activePlaylist.banner || firstTrackImage || './assets/music-placeholder.png'
		title.textContent = activePlaylist.name || 'Untitled Playlist'
		if (trackCountElement) {
			const trackCount = activePlaylist.tracks?.length || 0
			trackCountElement.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`
		}
        
		image.src = firstTrackImage || './assets/music-placeholder.png'
		image.onerror = () => {
			image.src = './assets/music-placeholder.png'
		}
		// banner.style.backgroundImage = `url('${bannerImage}')`
	}

	function render() {
		const activePlaylist = getActivePlaylist()
		renderPicker()
		renderHeader(activePlaylist)
		renderTracks(activePlaylist)
		renderTotalDuration(activePlaylist)
		renderPlayButtonIcon()
	}

	async function hydrate() {
		playlists = await window.sessionService?.loadUserPlaylists?.() || []
		if (!activePlaylistId && playlists.length > 0) {
			activePlaylistId = playlists[0].id
		}

		if (activePlaylistId && !playlists.some((playlist) => playlist.id === activePlaylistId)) {
			activePlaylistId = playlists[0]?.id || null
		}

		window.playlistViewState = { activePlaylistId }
		render()
	}

	picker.addEventListener('change', () => {
		activePlaylistId = picker.value || null
		window.playlistViewState = { activePlaylistId }
		render()
	})

	playButton.addEventListener('click', () => {
		const activePlaylist = getActivePlaylist()
		const filePaths = Array.isArray(activePlaylist?.tracks)
			? activePlaylist.tracks.map((track) => track?.filePath).filter(Boolean)
			: []
		if (!filePaths.length) {
			return
		}

		window.audioService?.startPlaylist(filePaths)
	})

	const onPlaylistsUpdated = () => {
		if (isPlaylistRouteActive()) {
			hydrate()
		}
	}
	window.addEventListener('user-playlists:updated', onPlaylistsUpdated)

	const cleanup = () => {
		window.removeEventListener('user-playlists:updated', onPlaylistsUpdated)
		if (typeof cleanupTrackMenuToggles === 'function') {
			cleanupTrackMenuToggles()
			cleanupTrackMenuToggles = null
		}
	}

	window.appRouter?.registerCurrentRouteCleanup?.(cleanup)

	hydrate()
}

window.initializePlaylistPage = initializePlaylistPage
