export function toFileUrl(filePath) {
    if (!filePath) return null

    const normalizedPath = String(filePath).replace(/\\/g, '/')
    const needsLeadingSlash = /^[A-Za-z]:\//.test(normalizedPath)
    return encodeURI(`file://${needsLeadingSlash ? '/' : ''}${normalizedPath}`)
}

export function getBaseName(filePath, fallback = 'Unknown Title') {
    if (!filePath) return fallback

    const segments = String(filePath).split(/\\|\//)
    return segments[segments.length - 1] || fallback
}

export const filePathUtils = {
    toFileUrl,
    getBaseName,
}

window.filePathUtils = filePathUtils
