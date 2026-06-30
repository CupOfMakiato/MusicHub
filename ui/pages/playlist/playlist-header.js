import { bindImageFallback } from '../../utils/dom-helpers.js'
import { hydrateImageWithPlaylistArtwork } from '../../utils/artwork.js'
import { toFileUrl } from '../../utils/file-path.js'
import {
    DEFAULT_PLAYLIST_IMAGE,
    normalizePlaylistImageValue,
    resolvePlaylistImage,
} from '../../utils/playlist-media.js'

export function createPlaylistHeaderController({
    title,
    trackCountElement,
    durationElement,
    image,
    imageEditButton,
    getActivePlaylist,
    getPlaylists,
    onSave,
    audioService,
} = {}) {
    const playlistCoverSaveInFlight = new Set()
    let isSavingPlaylistImage = false
    let isSavingPlaylistCover = false
    let isSavingPlaylistName = false
    let cleanupImageEditHandler = null
    let cleanupTitleEditHandler = null
    let titleBeforeEdit = ''

    async function persistPlaylistCoverIfMissing(playlistId, artwork) {
        const cover = normalizePlaylistImageValue(artwork)
        if (
            !playlistId ||
            !cover ||
            cover === DEFAULT_PLAYLIST_IMAGE ||
            playlistCoverSaveInFlight.has(playlistId)
        ) {
            return
        }

        const playlists = getPlaylists?.() || []
        const targetPlaylist = playlists.find((playlist) => playlist.id === playlistId)
        if (
            !targetPlaylist ||
            normalizePlaylistImageValue(targetPlaylist.banner) ||
            normalizePlaylistImageValue(targetPlaylist.cover)
        ) {
            return
        }

        const updatedPlaylists = playlists.map((playlist) =>
            playlist.id === playlistId
                ? {
                      ...playlist,
                      cover,
                  }
                : playlist,
        )

        playlistCoverSaveInFlight.add(playlistId)
        isSavingPlaylistCover = true
        try {
            await onSave?.(updatedPlaylists, {
                errorMessage: 'Failed to save generated playlist cover',
                renderAfterSave: false,
            })
        } catch (error) {
            console.error('Failed to save generated playlist cover', error)
        } finally {
            isSavingPlaylistCover = false
            playlistCoverSaveInFlight.delete(playlistId)
        }
    }

    function render(activePlaylist, { hydrateArtwork = true } = {}) {
        const renderHeaderIcon = () => {
            window.lucide?.createIcons({ nodes: [imageEditButton] })
        }

        if (!activePlaylist) {
            stopTitleEditing({ resetText: false })
            title.textContent = 'No playlist selected'
            title.classList.remove('is-editable')
            title.removeAttribute('tabindex')
            title.removeAttribute('role')
            title.removeAttribute('aria-label')
            trackCountElement.textContent = 'Choose a playlist from your library.'
            durationElement.textContent = ''
            imageEditButton.disabled = true
            bindImageFallback(image)
            image.src = './assets/music-placeholder.png'
            renderHeaderIcon()
            return
        }

        const playlistImage = resolvePlaylistImage(activePlaylist)
        stopTitleEditing({ resetText: false })
        title.textContent = activePlaylist.name || 'Untitled Playlist'
        title.classList.add('is-editable')
        title.setAttribute('tabindex', '0')
        title.setAttribute('role', 'textbox')
        title.setAttribute('aria-label', 'Edit playlist title')
        const trackCount = activePlaylist.tracks?.length || 0
        trackCountElement.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`
        imageEditButton.disabled = false

        bindImageFallback(image)
        image.src = playlistImage
        if (hydrateArtwork) {
            hydrateImageWithPlaylistArtwork({
                imageElement: image,
                playlist: activePlaylist,
                audioService,
            })
                .then((artwork) => {
                    persistPlaylistCoverIfMissing(activePlaylist.id, artwork).catch(() => {})
                })
                .catch(() => {})
        }
        renderHeaderIcon()
    }

    function stopTitleEditing({ resetText = true } = {}) {
        if (title.isContentEditable) {
            title.contentEditable = 'false'
        }
        title.classList.remove('is-editing')
        if (resetText) {
            title.textContent = titleBeforeEdit
        }
    }

    function startTitleEditing() {
        const activePlaylist = getActivePlaylist?.()
        if (!activePlaylist || title.isContentEditable) {
            return
        }

        titleBeforeEdit = activePlaylist.name || 'Untitled Playlist'
        title.contentEditable = 'true'
        title.classList.add('is-editing')
        title.focus()

        const selection = window.getSelection?.()
        const range = document.createRange()
        range.selectNodeContents(title)
        selection?.removeAllRanges()
        selection?.addRange(range)
    }

    async function saveTitleEdit() {
        if (!title.isContentEditable) {
            return
        }

        const activePlaylist = getActivePlaylist?.()
        const nextName = title.textContent.trim() || 'Untitled Playlist'
        stopTitleEditing({ resetText: false })

        if (!activePlaylist) {
            return
        }

        if (nextName === (activePlaylist.name || 'Untitled Playlist')) {
            title.textContent = nextName
            return
        }

        const now = new Date().toISOString()
        const updatedPlaylists = (getPlaylists?.() || []).map((playlist) => {
            if (playlist.id !== activePlaylist.id) {
                return playlist
            }

            return {
                ...playlist,
                name: nextName,
                updatedAt: now,
            }
        })

        isSavingPlaylistName = true
        try {
            const saved = await onSave?.(updatedPlaylists, {
                activeId: activePlaylist.id,
                errorMessage: 'Failed to save playlist title',
            })
            if (!saved) {
                title.textContent = titleBeforeEdit
            }
        } catch (error) {
            title.textContent = titleBeforeEdit
            console.error('Failed to update playlist title', error)
        } finally {
            isSavingPlaylistName = false
        }
    }

    function attachTitleEditHandler() {
        if (cleanupTitleEditHandler) {
            return
        }

        const onTitleClick = () => {
            startTitleEditing()
        }
        const onTitleKeyDown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                saveTitleEdit()
                return
            }

            if (event.key === 'Escape') {
                event.preventDefault()
                stopTitleEditing()
                title.blur()
            }
        }
        const onTitleBlur = () => {
            saveTitleEdit()
        }
        const onTitlePaste = (event) => {
            if (!title.isContentEditable) {
                return
            }

            event.preventDefault()
            const text = event.clipboardData?.getData('text/plain') || ''
            document.execCommand?.('insertText', false, text)
        }

        title.addEventListener('click', onTitleClick)
        title.addEventListener('keydown', onTitleKeyDown)
        title.addEventListener('blur', onTitleBlur)
        title.addEventListener('paste', onTitlePaste)
        cleanupTitleEditHandler = () => {
            title.removeEventListener('click', onTitleClick)
            title.removeEventListener('keydown', onTitleKeyDown)
            title.removeEventListener('blur', onTitleBlur)
            title.removeEventListener('paste', onTitlePaste)
            cleanupTitleEditHandler = null
        }
    }

    function attachImageEditHandler() {
        if (cleanupImageEditHandler) {
            return
        }

        const onImageEditClick = async () => {
            const activePlaylist = getActivePlaylist?.()
            if (!activePlaylist || typeof window.electronAPI?.selectImageFile !== 'function') {
                return
            }

            try {
                const selectedImagePath = await window.electronAPI.selectImageFile()
                const banner = toFileUrl(selectedImagePath)
                if (!banner) {
                    return
                }

                const now = new Date().toISOString()
                const updatedPlaylists = (getPlaylists?.() || []).map((playlist) => {
                    if (playlist.id !== activePlaylist.id) {
                        return playlist
                    }

                    return {
                        ...playlist,
                        banner,
                        updatedAt: now,
                    }
                })

                isSavingPlaylistImage = true
                await onSave?.(updatedPlaylists, {
                    activeId: activePlaylist.id,
                    errorMessage: 'Failed to save playlist image',
                })
            } catch (error) {
                console.error('Failed to update playlist image', error)
            } finally {
                isSavingPlaylistImage = false
            }
        }

        imageEditButton.addEventListener('click', onImageEditClick)
        cleanupImageEditHandler = () => {
            imageEditButton.removeEventListener('click', onImageEditClick)
            cleanupImageEditHandler = null
        }
    }

    function cleanup() {
        cleanupImageEditHandler?.()
        cleanupTitleEditHandler?.()
    }

    return {
        render,
        attachTitleEditHandler,
        attachImageEditHandler,
        cleanup,
        isSavingPlaylistImage: () => isSavingPlaylistImage,
        isSavingPlaylistCover: () => isSavingPlaylistCover,
        isSavingPlaylistName: () => isSavingPlaylistName,
    }
}
