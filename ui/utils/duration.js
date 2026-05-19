export function formatDurationVerbose(totalSeconds) {
    const safeSeconds = Number(totalSeconds)
    if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) {
        return '-'
    }

    const rounded = Math.floor(safeSeconds)
    const hours = Math.floor(rounded / 3600)
    const minutes = Math.floor((rounded % 3600) / 60)
    const seconds = rounded % 60

    if (hours > 0) {
        return `${hours} hr ${minutes} min ${seconds} sec`
    }

    return `${minutes} min ${seconds} sec`
}

export function formatDurationClock(totalSeconds) {
    const safeSeconds = Number(totalSeconds)
    if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) {
        return '0:00'
    }

    const rounded = Math.floor(safeSeconds)
    const minutes = Math.floor(rounded / 60)
    const seconds = rounded % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const durationUtils = {
    formatDurationVerbose,
    formatDurationClock,
}

window.durationUtils = durationUtils
