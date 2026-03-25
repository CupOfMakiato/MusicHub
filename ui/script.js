const selectFileButton = document.getElementById('selectFile')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = './assets/music-placeholder.png'
let music = null

function toFileUrl(filePath) {
    if (!filePath) return null
    const normalizedPath = filePath.replace(/\\/g, '/')
    return encodeURI(`file://${normalizedPath}`)
}

function arrayBufferToBase64(data) {
    let binary = ''
    for (let i = 0; i < data.length; i += 1) {
        binary += String.fromCharCode(data[i])
    }
    return window.btoa(binary)
}

function normalizeImageMime(format) {
    const normalized = (format || 'image/jpeg').toLowerCase()

    if (normalized.includes('/')) {
        return normalized
    }

    if (normalized === 'jpg') {
        return 'image/jpeg'
    }

    return `image/${normalized}`
}

function getPictureDataUrl(picture) {
    if (!picture || !picture.data) return null

    const mimeType = normalizeImageMime(picture.format)
    const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data)
    return `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`
}

function getFileName(filePath) {
    if (!filePath) return 'Unknown Title'
    const segments = filePath.split(/\\|\//)
    return segments[segments.length - 1] || 'Unknown Title'
}

function updateTrackInfo({ title, artist, image }) {
    if (trackTitle) trackTitle.textContent = title || 'Unknown Title'
    if (trackArtist) trackArtist.textContent = artist || 'Unknown Artist'
    if (coverImage) {
        coverImage.src = image || placeholderCover
    }
}

if (coverImage) {
    coverImage.addEventListener('error', () => {
        coverImage.src = placeholderCover
    })
}

function readMetadata(filePath, fallbackTitle) {
    if (!window.jsmediatags) {
        console.warn('jsmediatags is not loaded')
        return
    }

    (async () => {
        try {
            const fileData = await window.electronAPI.readAudioFile(filePath)

            if (!fileData) {
                console.warn('Could not read file data')
                updateTrackInfo({
                    title: fallbackTitle,
                    artist: 'No metadata available',
                    image: null,
                })
                return
            }

            const uint8Array = new Uint8Array(fileData)
            const blob = new Blob([uint8Array], { type: 'audio/mpeg' })

            window.jsmediatags.read(blob, {
                onSuccess: (tag) => {
                    const title = tag.tags.title || fallbackTitle || 'Unknown Title'
                    const artist = tag.tags.artist || 'Unknown Artist'
                    const musicImage = getPictureDataUrl(tag.tags.picture)

                    updateTrackInfo({
                        title,
                        artist,
                        image: musicImage,
                    })

                    console.log('Title:', title)
                    console.log('Artist:', artist)
                    console.log('Music Image:', musicImage)
                },
                onError: (error) => {
                    console.warn('Metadata not available for this file:', error)
                    updateTrackInfo({
                        title: fallbackTitle,
                        artist: 'No metadata available',
                        image: null,
                    })
                },
            })
        } catch (error) {
            console.warn('Metadata reader error:', error)
            updateTrackInfo({
                title: fallbackTitle,
                artist: 'No metadata available',
                image: null,
            })
        }
    })()
}

selectFileButton?.addEventListener('click', async () => {
    try {
        const selectedFile = await window.electronAPI.selectAudioFile()

        if (!selectedFile) {
            console.log('No file selected')
            return
        }

        const sourceFile = toFileUrl(selectedFile)
        const fallbackTitle = getFileName(selectedFile)
        console.log('Selected file:', sourceFile)
        updateTrackInfo({
            title: fallbackTitle,
            artist: 'Loading metadata...',
            image: null,
        })
        readMetadata(selectedFile, fallbackTitle)

        if (music) {
            music.stop()
            music.unload()
        }

        music = new window.Howl({
            src: [sourceFile],
            html5: true,
            volume: 0.5,
        })

        music.play()
    } catch (error) {
        console.error('Failed to select or play audio file:', error)
    }
})

window.lucide?.createIcons()