import { getDataAttributeIndex } from '../../utils/dom-helpers.js'
import { pushUndo } from '../../services/undo-service.js'
import { createPlaylistSortable } from './playlist-sortable.js'

const REORDER_RENDER_OPTIONS = {
    skipPlaylistArtworkHydration: true,
    skipTotalDuration: true,
}

export function createPlaylistActionsController({
    body,
    getActivePlaylist,
    getPlaylists,
    onSave,
    onRender,
    audioService,
} = {}) {
    let cleanupTrackActions = null
    let sortableInstance = null
    let trackActionsDelegated = false
    let isSavingPlaylistOrder = false

    function closeAllTrackMenus() {
        body.querySelectorAll('.playlistTrackMenu.is-open').forEach((menu) => {
            menu.classList.remove('is-open')
            menu.closest('.playlistTrackActions')?.classList.remove('is-menu-open')
            menu.closest('.playlistTrackActionsCell')?.classList.remove('is-menu-open')
            menu.closest('.playlistTrackRow')?.classList.remove('is-menu-open')
        })
    }

    function attachTrackActionHandlers() {
        if (trackActionsDelegated) return

        const onBodyClick = async (event) => {
            const menuButton = event.target.closest('.playlistTrackMoreBtn')
            if (menuButton && body.contains(menuButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(menuButton, 'data-track-index')
                if (trackIndex === null) {
                    return
                }

                const menu = body.querySelector(
                    `.playlistTrackMenu[data-track-index="${trackIndex}"]`,
                )
                if (!menu) {
                    return
                }

                const isOpen = menu.classList.contains('is-open')
                closeAllTrackMenus()
                if (!isOpen) {
                    menu.classList.add('is-open')
                    menu.closest('.playlistTrackActions')?.classList.add('is-menu-open')
                    menu.closest('.playlistTrackActionsCell')?.classList.add('is-menu-open')
                    menu.closest('.playlistTrackRow')?.classList.add('is-menu-open')
                }
                return
            }

            const removeButton = event.target.closest('.removeTrackBtn')
            if (removeButton && body.contains(removeButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(removeButton, 'data-track-index')
                const activePlaylist = getActivePlaylist?.()
                if (!activePlaylist || trackIndex === null) {
                    return
                }

                const nextTracks = Array.isArray(activePlaylist.tracks)
                    ? activePlaylist.tracks.filter((_, index) => index !== trackIndex)
                    : []

                const updatedPlaylists = (getPlaylists?.() || []).map((playlist) => {
                    if (playlist.id !== activePlaylist.id) {
                        return playlist
                    }

                    return {
                        ...playlist,
                        tracks: nextTracks,
                        updatedAt: new Date().toISOString(),
                    }
                })

                await onSave?.(updatedPlaylists, {
                    activeId: activePlaylist.id,
                    errorMessage: 'Failed to save updated playlists when removing track',
                })
                return
            }

            const playButton = event.target.closest('.playlistTrackIndexPlayBtn')
            if (playButton && body.contains(playButton)) {
                event.stopPropagation()
                event.preventDefault()

                const trackIndex = getDataAttributeIndex(playButton, 'data-track-index')
                const activePlaylist = getActivePlaylist?.()
                if (!activePlaylist || trackIndex === null) {
                    return
                }

                const queueFilePaths = Array.isArray(activePlaylist.tracks)
                    ? activePlaylist.tracks
                          .slice(trackIndex)
                          .map((track) => track?.filePath)
                          .filter(Boolean)
                    : []

                if (queueFilePaths.length) {
                    audioService.startPlaylist(queueFilePaths)
                }
            }
        }

        const onDocumentClick = () => {
            closeAllTrackMenus()
        }

        body.addEventListener('click', onBodyClick)
        document.addEventListener('click', onDocumentClick)
        cleanupTrackActions = () => {
            body.removeEventListener('click', onBodyClick)
            document.removeEventListener('click', onDocumentClick)
            trackActionsDelegated = false
        }
        trackActionsDelegated = true
    }

    function initializeSortableIfNeeded() {
        if (!body) return

        if (sortableInstance) return

        if (typeof createPlaylistSortable !== 'function') return

        try {
            sortableInstance = createPlaylistSortable({
                body,
                getActivePlaylist,
                getPlaylists,
                onReorder: async (updatedPlaylists) => {
                    const previousPlaylists = (getPlaylists?.() || []).map((p) => ({
                        ...p,
                        tracks: Array.isArray(p.tracks) ? p.tracks.slice() : p.tracks,
                    }))
                    const activePlaylist = getActivePlaylist?.()

                    isSavingPlaylistOrder = true
                    try {
                        const saved = await onSave?.(updatedPlaylists, {
                            activeId: activePlaylist?.id,
                            errorMessage: 'Failed to save reordered playlist',
                            renderOptions: REORDER_RENDER_OPTIONS,
                        })
                        if (!saved) {
                            onRender?.(REORDER_RENDER_OPTIONS)
                            return
                        }

                        pushUndo(
                            async () => {
                                isSavingPlaylistOrder = true
                                try {
                                    const undone = await onSave?.(previousPlaylists, {
                                        activeId: activePlaylist?.id,
                                        errorMessage: 'Failed to undo playlist reorder',
                                        renderOptions: REORDER_RENDER_OPTIONS,
                                    })
                                    if (!undone) {
                                        return
                                    }
                                } catch (err) {
                                    console.error('Error while undoing playlist reorder', err)
                                } finally {
                                    isSavingPlaylistOrder = false
                                }
                            },
                            { label: 'Undo playlist reorder' },
                        )
                    } catch (e) {
                        console.error('Failed to save reordered playlist', e)
                        onRender?.(REORDER_RENDER_OPTIONS)
                        return
                    } finally {
                        isSavingPlaylistOrder = false
                    }
                },
            })
        } catch (err) {
            console.error('Failed to initialize Sortable', err)
        }
    }

    function attach() {
        attachTrackActionHandlers()
        initializeSortableIfNeeded()
    }

    function detach() {
        if (typeof cleanupTrackActions === 'function') {
            cleanupTrackActions()
            cleanupTrackActions = null
        }

        if (sortableInstance && typeof sortableInstance.destroy === 'function') {
            try {
                sortableInstance.destroy()
            } catch (e) {
                console.error('Failed to destroy Sortable instance during cleanup', e)
            }
            sortableInstance = null
        }
    }

    return {
        attach,
        detach,
        closeAllTrackMenus,
        isSavingPlaylistOrder: () => isSavingPlaylistOrder,
    }
}
