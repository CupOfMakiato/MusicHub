import {
    clearPlaylistDurationProbePromise,
    getPlaylistDurationProbePromise,
    getPlaylistTrackFilePath,
    getTrackDurationState,
    normalizeDurationValue,
    rememberPlaylistDuration,
    schedulePlaylistDurationPersist,
    setPlaylistDurationProbePromise,
} from './playlist-duration-cache.js'
import { formatDurationClock, formatDurationVerbose } from '../../utils/duration.js'
import { toFileUrl } from '../../utils/file-path.js'
import { normalizeTrackRecord } from '../../utils/track-record.js'

const PLAYLIST_DURATION_WORKERS = 4

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
    const knownDuration = getTrackDurationState(track)
    if (knownDuration.known) {
        return knownDuration.duration
    }

    const filePath = getPlaylistTrackFilePath(track)
    if (!filePath) {
        return null
    }

    const existingProbePromise = getPlaylistDurationProbePromise(filePath)
    if (existingProbePromise) {
        return existingProbePromise
    }

    const probePromise = probeAudioDuration(filePath)
        .then((duration) => {
            rememberPlaylistDuration(filePath, duration)
            clearPlaylistDurationProbePromise(filePath)

            if (normalizeDurationValue(duration) !== null) {
                schedulePlaylistDurationPersist()
            }

            return duration
        })
        .catch((error) => {
            clearPlaylistDurationProbePromise(filePath)
            throw error
        })

    setPlaylistDurationProbePromise(filePath, probePromise)

    return probePromise
}

async function resolveTrackDurationsLimited(tracks, { concurrency = 8, onResolved } = {}) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
        return []
    }

    const results = tracks.map((track) => getTrackDurationState(track).duration)
    const unresolvedIndexes = []
    tracks.forEach((track, index) => {
        if (!getTrackDurationState(track).known) {
            unresolvedIndexes.push(index)
        }
    })

    if (!unresolvedIndexes.length) {
        return results
    }

    let nextIndex = 0

    const workers = Array.from(
        { length: Math.min(concurrency, unresolvedIndexes.length) },
        async () => {
            while (nextIndex < unresolvedIndexes.length) {
                const index = unresolvedIndexes[nextIndex]
                nextIndex += 1

                const duration = await resolveTrackDuration(tracks[index])
                results[index] = duration
                onResolved?.({ index, duration })

                await new Promise((resolve) => setTimeout(resolve, 0))
            }
        },
    )

    await Promise.all(workers)
    return results
}

export function createPlaylistDurationController({
    body,
    durationElement,
    getPlaylists,
    getActivePlaylist,
    isTrackRendered,
    onDurationCellUpdate,
} = {}) {
    let totalDurationRunId = 0
    let durationCellsRaf = null
    let pendingDurationCellsRunId = null
    const pendingDurationCellIndexes = new Set()

    function rememberActivePlaylistTrackDuration(playlistId, trackIndex, duration) {
        const safeDuration = normalizeDurationValue(duration)
        if (!playlistId || !Number.isInteger(trackIndex) || safeDuration === null) {
            return
        }

        const activePlaylist = (getPlaylists?.() || []).find(
            (playlist) => playlist.id === playlistId,
        )
        const track = activePlaylist?.tracks?.[trackIndex]
        const filePath = getPlaylistTrackFilePath(track)
        if (!activePlaylist || !Array.isArray(activePlaylist.tracks) || !filePath) {
            return
        }

        if (normalizeDurationValue(track?.duration) === safeDuration) {
            return
        }

        const normalizedTrack = normalizeTrackRecord(track)
        if (!normalizedTrack || normalizedTrack.filePath !== filePath) {
            return
        }

        activePlaylist.tracks[trackIndex] = {
            ...normalizedTrack,
            duration: safeDuration,
        }
    }

    function getTrackDurationFromRecord(track) {
        return getTrackDurationState(track).duration
    }

    function updateDurationCell(index, duration) {
        const durationCell = body.querySelector(`td[data-duration-index="${index}"]`)
        if (durationCell) {
            durationCell.textContent = formatDurationClock(duration)
        }

        onDurationCellUpdate?.(index, duration)
    }

    function cancelPendingDurationCellUpdates() {
        if (durationCellsRaf) {
            cancelAnimationFrame(durationCellsRaf)
            durationCellsRaf = null
        }
        pendingDurationCellsRunId = null
        pendingDurationCellIndexes.clear()
    }

    function scheduleDurationCellUpdate(trackIndex, runId = totalDurationRunId) {
        if (runId !== totalDurationRunId) {
            return
        }

        if (pendingDurationCellsRunId !== runId) {
            cancelPendingDurationCellUpdates()
            pendingDurationCellsRunId = runId
        }

        if (Number.isInteger(trackIndex)) {
            pendingDurationCellIndexes.add(trackIndex)
        }

        if (durationCellsRaf) {
            return
        }

        durationCellsRaf = requestAnimationFrame(() => {
            durationCellsRaf = null
            if (runId !== totalDurationRunId) {
                pendingDurationCellsRunId = null
                pendingDurationCellIndexes.clear()
                return
            }
            renderDurationCellUpdates(Array.from(pendingDurationCellIndexes))
            pendingDurationCellsRunId = null
            pendingDurationCellIndexes.clear()
        })
    }

    function renderDurationCellUpdates(trackIndexes) {
        const activePlaylist = getActivePlaylist?.()
        trackIndexes.forEach((trackIndex) => {
            updateDurationCell(
                trackIndex,
                getTrackDurationFromRecord(activePlaylist?.tracks?.[trackIndex]),
            )
        })
    }

    async function renderTotalDuration(activePlaylist) {
        if (
            !activePlaylist ||
            !Array.isArray(activePlaylist.tracks) ||
            activePlaylist.tracks.length === 0
        ) {
            totalDurationRunId += 1
            durationElement.textContent = ''
            return
        }

        const knownDurations = activePlaylist.tracks.map((track) => getTrackDurationState(track))
        if (knownDurations.every((duration) => duration.known)) {
            totalDurationRunId += 1
            cancelPendingDurationCellUpdates()
            const totalSeconds = knownDurations.reduce(
                (sum, value) => sum + (Number(value.duration) || 0),
                0,
            )
            durationElement.textContent = `, ${formatDurationVerbose(totalSeconds)}`
            return
        }

        durationElement.textContent = ', ...'
        const runId = ++totalDurationRunId
        const durations = await resolveTrackDurationsLimited(activePlaylist.tracks, {
            concurrency: PLAYLIST_DURATION_WORKERS,
            onResolved: (resolvedTrack) => {
                if (runId !== totalDurationRunId) {
                    return
                }

                rememberActivePlaylistTrackDuration(
                    activePlaylist.id,
                    resolvedTrack.index,
                    resolvedTrack.duration,
                )

                if (isTrackRendered?.(resolvedTrack.index) ?? true) {
                    scheduleDurationCellUpdate(resolvedTrack.index, runId)
                }
            },
        })

        if (runId !== totalDurationRunId) {
            return
        }

        const totalSeconds = durations.reduce((sum, value) => sum + (Number(value) || 0), 0)
        durationElement.textContent = `, ${formatDurationVerbose(totalSeconds)}`
    }

    function cancelTotalDuration() {
        totalDurationRunId += 1
        cancelPendingDurationCellUpdates()
    }

    return {
        renderTotalDuration,
        getTrackDurationFromRecord,
        scheduleDurationCellUpdate,
        cancelPendingDurationCellUpdates,
        cancelTotalDuration,
    }
}
