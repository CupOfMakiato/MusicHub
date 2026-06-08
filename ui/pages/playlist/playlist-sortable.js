// using sortablejs for drag-and-drop reordering of playlist tracks

import Sortable from '../../../node_modules/sortablejs/modular/sortable.esm.js'
import { getDataAttributeIndex } from '../../utils/dom-helpers.js'
import { cursorClasses } from '../../utils/cursor-interaction.js'

function isValidTrackIndex(index, tracks) {
    return Number.isInteger(index) && index >= 0 && index < tracks.length
}

function hasUniqueValidTrackIndices(indices, tracks) {
    if (!Array.isArray(indices) || indices.length !== tracks.length) return false

    const uniqueIndices = new Set(indices)
    return (
        uniqueIndices.size === indices.length &&
        indices.every((index) => isValidTrackIndex(index, tracks))
    )
}

export function createPlaylistSortable({ body, getActivePlaylist, getPlaylists, onReorder } = {}) {
    if (!body) return { destroy: () => {} }
    if (typeof Sortable !== 'function') return { destroy: () => {} }

    let sortable = null
    const setDraggingCursor = (isDragging) => {
        document.documentElement?.classList.toggle(cursorClasses.grabbing, Boolean(isDragging))
        document.body?.classList.toggle(cursorClasses.grabbing, Boolean(isDragging))
    }

    try {
        sortable = Sortable.create(body, {
            animation: 150,
            draggable: 'tr.playlistTrackRow',
            filter: 'button, a, input, textarea, select, .playlistTrackMenu, .playlistTrackActions',
            forceFallback: true,
            fallbackClass: 'playlistTrackRow--fallbackDragging',
            fallbackOnBody: true,
            preventOnFilter: true,
            ghostClass: 'playlistTrackRow--dragging',
            onStart: () => {
                setDraggingCursor(true)
                try {
                    const interactive = body.querySelectorAll(
                        '.playlistTrackIndexPlayBtn, .playlistTrackMoreBtn',
                    )
                    interactive.forEach((el) => {
                        try {
                            el.disabled = true
                        } catch (e) {
                            void e
                        }
                    })
                } catch (e) {
                    console.error('Error disabling interactive elements for drag', e)
                }
            },
            onEnd: (evt) => {
                setDraggingCursor(false)
                try {
                    try {
                        const interactive = body.querySelectorAll(
                            '.playlistTrackIndexPlayBtn, .playlistTrackMoreBtn',
                        )
                        interactive.forEach((el) => {
                            try {
                                el.disabled = false
                            } catch (e) {
                                void e
                            }
                        })
                    } catch (e) {
                        console.error('Error re-enabling interactive elements after drag', e)
                    }

                    const activePlaylist = getActivePlaylist()
                    if (!activePlaylist || !Array.isArray(activePlaylist.tracks)) return

                    const rows = Array.from(body.querySelectorAll('tr.playlistTrackRow'))

                    // Try fast path: if DOM contains all rows, rebuild order directly
                    const visibleIndices = rows
                        .map((row) => getDataAttributeIndex(row, 'data-track-index'))
                        .filter((v) => v !== null)

                    let newTracks = null

                    const buildMovedTracks = () => {
                        // Virtualized list: compute new order by moving the dragged item in the full array
                        const sourceIndex = getDataAttributeIndex(evt.item, 'data-track-index')

                        if (!isValidTrackIndex(sourceIndex, activePlaylist.tracks)) {
                            console.warn('Could not determine source index after drag')
                            return null
                        }

                        const newIndexInRows = rows.indexOf(evt.item)
                        if (newIndexInRows === -1) {
                            console.warn('Could not determine dragged row position after drag')
                            return null
                        }

                        // Determine global insertion index
                        let insertionGlobal = null

                        const nextRow = rows[newIndexInRows + 1]
                        if (nextRow) {
                            const nextGlobal = getDataAttributeIndex(nextRow, 'data-track-index')
                            if (!isValidTrackIndex(nextGlobal, activePlaylist.tracks)) {
                                console.warn('Could not determine valid next row index after drag')
                                return null
                            }
                            insertionGlobal = nextGlobal
                        } else {
                            const prevRow = rows[newIndexInRows - 1]
                            if (prevRow) {
                                const prevGlobal = getDataAttributeIndex(
                                    prevRow,
                                    'data-track-index',
                                )
                                if (!isValidTrackIndex(prevGlobal, activePlaylist.tracks)) {
                                    console.warn(
                                        'Could not determine valid previous row index after drag',
                                    )
                                    return null
                                }
                                insertionGlobal = prevGlobal + 1
                            }
                        }

                        // Fallback: if still null, append to end
                        if (insertionGlobal === null) insertionGlobal = activePlaylist.tracks.length
                        if (
                            !Number.isInteger(insertionGlobal) ||
                            insertionGlobal < 0 ||
                            insertionGlobal > activePlaylist.tracks.length
                        ) {
                            console.warn('Reorder produced invalid insertion index - aborting save')
                            return null
                        }

                        // Build new tracks by moving sourceIndex -> insertionGlobal
                        const copy = activePlaylist.tracks.slice()
                        const [moved] = copy.splice(sourceIndex, 1)
                        if (moved === undefined) {
                            console.warn('Reorder produced an empty moved track - aborting save')
                            return null
                        }
                        let destIndex = insertionGlobal
                        if (sourceIndex < destIndex) destIndex--
                        if (destIndex < 0) destIndex = 0
                        if (destIndex > copy.length) destIndex = copy.length
                        copy.splice(destIndex, 0, moved)
                        return copy
                    }

                    if (visibleIndices.length === activePlaylist.tracks.length) {
                        if (hasUniqueValidTrackIndices(visibleIndices, activePlaylist.tracks)) {
                            newTracks = visibleIndices.map((idx) => activePlaylist.tracks[idx])
                        } else {
                            console.warn(
                                'Invalid visible track indices after drag - falling back to move reorder',
                            )
                            newTracks = buildMovedTracks()
                        }
                    } else {
                        newTracks = buildMovedTracks()
                    }

                    if (
                        !Array.isArray(newTracks) ||
                        newTracks.length !== activePlaylist.tracks.length ||
                        newTracks.some((track) => track === undefined)
                    ) {
                        console.warn('Reorder produced mismatched track count - aborting save')
                        return
                    }

                    const updatedPlaylists = getPlaylists().map((playlist) => {
                        if (playlist.id !== activePlaylist.id) return playlist
                        return {
                            ...playlist,
                            tracks: newTracks,
                            updatedAt: new Date().toISOString(),
                        }
                    })

                    if (typeof onReorder === 'function') {
                        try {
                            onReorder(updatedPlaylists)
                        } catch (e) {
                            console.error('Error in onReorder callback', e)
                        }
                    }
                } catch (err) {
                    console.error('Error while handling playlist reorder', err)
                }
            },
        })
    } catch (err) {
        console.error('Failed to initialize Sortable', err)
    }

    return {
        destroy() {
            setDraggingCursor(false)
            if (sortable && typeof sortable.destroy === 'function') {
                try {
                    sortable.destroy()
                } catch (e) {
                    console.error('Failed to destroy Sortable instance', e)
                }
            }
            sortable = null
        },
    }
}
