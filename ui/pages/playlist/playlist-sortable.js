// using sortablejs for drag-and-drop reordering of playlist tracks

import Sortable from '../../../node_modules/sortablejs/modular/sortable.esm.js'
import { getDataAttributeIndex } from '../../utils/dom-helpers.js'

export function createPlaylistSortable({ body, getActivePlaylist, getPlaylists, onReorder } = {}) {
    if (!body) return { destroy: () => {} }
    if (typeof Sortable !== 'function') return { destroy: () => {} }

    let sortable = null

    try {
        sortable = Sortable.create(body, {
            animation: 150,
            draggable: 'tr.playlistTrackRow',
            filter: 'button, a, input, textarea, select, .playlistTrackMenu, .playlistTrackActions',
            preventOnFilter: true,
            ghostClass: 'playlistTrackRow--dragging',
            onStart: () => {
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

                    if (visibleIndices.length === activePlaylist.tracks.length) {
                        newTracks = visibleIndices.map((idx) => activePlaylist.tracks[idx])
                    } else {
                        // Virtualized list: compute new order by moving the dragged item in the full array
                        const sourceAttr = evt.item?.getAttribute
                            ? evt.item.getAttribute('data-track-index')
                            : null
                        const sourceIndex = Number.isInteger(Number(sourceAttr))
                            ? Number(sourceAttr)
                            : null

                        if (sourceIndex === null) {
                            console.warn('Could not determine source index after drag')
                            return
                        }

                        const newIndexInRows = rows.indexOf(evt.item)

                        // Determine global insertion index
                        let insertionGlobal = null

                        const nextRow = rows[newIndexInRows + 1]
                        if (nextRow) {
                            const nextGlobal = getDataAttributeIndex(nextRow, 'data-track-index')
                            if (nextGlobal !== null) insertionGlobal = nextGlobal
                        } else {
                            const prevRow = rows[newIndexInRows - 1]
                            if (prevRow) {
                                const prevGlobal = getDataAttributeIndex(
                                    prevRow,
                                    'data-track-index',
                                )
                                if (prevGlobal !== null) insertionGlobal = prevGlobal + 1
                            }
                        }

                        // Fallback: if still null, append to end
                        if (insertionGlobal === null) insertionGlobal = activePlaylist.tracks.length

                        // Build new tracks by moving sourceIndex -> insertionGlobal
                        const copy = activePlaylist.tracks.slice()
                        const [moved] = copy.splice(sourceIndex, 1)
                        let destIndex = insertionGlobal
                        if (sourceIndex < destIndex) destIndex--
                        if (destIndex < 0) destIndex = 0
                        if (destIndex > copy.length) destIndex = copy.length
                        copy.splice(destIndex, 0, moved)
                        newTracks = copy
                    }

                    if (
                        !Array.isArray(newTracks) ||
                        newTracks.length !== activePlaylist.tracks.length
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
