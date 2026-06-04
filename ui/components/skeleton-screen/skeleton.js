function getOverlay() {
    return document.getElementById('loadingOverlay')
}

function ensureOverlayElements() {
    let overlay = getOverlay()

    if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = 'loadingOverlay'
        overlay.style.display = 'none'
        document.body.appendChild(overlay)
    }

    let container = overlay.querySelector('.skeleton-container')
    if (!container) {
        container = document.createElement('div')
        container.className = 'skeleton-container'
        overlay.appendChild(container)
    }

    let status = overlay.querySelector('.loadingStatus')
    if (!status) {
        status = document.createElement('div')
        status.className = 'loadingStatus visually-hidden'
        status.setAttribute('aria-live', 'polite')
        overlay.appendChild(status)
    }

    return {
        overlay,
        container,
        status,
    }
}

function renderSkeletonItems(container, count = 6, variant = 'row') {
    container.innerHTML = ''
    container.classList.remove('skeleton-grid', 'skeleton-player', 'skeleton-rows')

    if (variant === 'grid') {
        container.classList.add('skeleton-grid')
        for (let i = 0; i < count; i++) {
            const tile = document.createElement('div')
            tile.className = 'skeleton-item skeleton-tile'

            const box = document.createElement('div')
            box.className = 'skeleton-box skeleton-block'

            const line = document.createElement('div')
            line.className = 'skeleton-line skeleton-line-long skeleton-block'

            tile.appendChild(box)
            tile.appendChild(line)
            container.appendChild(tile)
        }

        return
    }

    if (variant === 'playlist') {
        container.classList.add('skeleton-table')

        // header card with optional banner and body (image + meta)
        const headerCard = document.createElement('div')
        headerCard.className = 'skeleton-header-card'

        const banner = document.createElement('div')
        banner.className = 'skeleton-banner skeleton-block'
        headerCard.appendChild(banner)

        const headerBody = document.createElement('div')
        headerBody.className = 'skeleton-header-body'

        const image = document.createElement('div')
        image.className = 'skeleton-header-image skeleton-block'

        const meta = document.createElement('div')
        meta.className = 'skeleton-meta'
        const metaLabel = document.createElement('div')
        metaLabel.className = 'skeleton-line skeleton-block'
        const metaTitle = document.createElement('div')
        metaTitle.className = 'skeleton-line skeleton-block'
        const metaSub = document.createElement('div')
        metaSub.className = 'skeleton-line skeleton-block'

        meta.appendChild(metaLabel)
        meta.appendChild(metaTitle)
        meta.appendChild(metaSub)

        headerBody.appendChild(image)
        headerBody.appendChild(meta)
        headerCard.appendChild(headerBody)

        container.appendChild(headerCard)

        // controls
        const controls = document.createElement('div')
        controls.className = 'skeleton-controls'
        const play = document.createElement('div')
        play.className = 'skeleton-control-play skeleton-block'
        const shuffle = document.createElement('div')
        shuffle.className = 'skeleton-control-small skeleton-block'
        const advance = document.createElement('div')
        advance.className = 'skeleton-control-small skeleton-block'
        controls.appendChild(play)
        controls.appendChild(shuffle)
        controls.appendChild(advance)
        container.appendChild(controls)

        // track section wrapper
        const trackSection = document.createElement('div')
        trackSection.className = 'skeleton-track-section'

        for (let i = 0; i < Math.max(1, count); i++) {
            const row = document.createElement('div')
            row.className = 'skeleton-table-row'

            // index
            const colIndex = document.createElement('div')
            colIndex.className = 'skeleton-cell skeleton-col-index'
            const idxLine = document.createElement('div')
            idxLine.className = 'skeleton-line skeleton-block'
            colIndex.appendChild(idxLine)

            // title (cover + lines)
            const colTitle = document.createElement('div')
            colTitle.className = 'skeleton-col-title'
            const cover = document.createElement('div')
            cover.className = 'skeleton-track-cover skeleton-block'
            const trackLines = document.createElement('div')
            trackLines.className = 'skeleton-track-lines'
            const t1 = document.createElement('div')
            t1.className = 'skeleton-line skeleton-block'
            const t2 = document.createElement('div')
            t2.className = 'skeleton-line skeleton-block'
            trackLines.appendChild(t1)
            trackLines.appendChild(t2)
            colTitle.appendChild(cover)
            colTitle.appendChild(trackLines)

            // artist
            const colArtist = document.createElement('div')
            colArtist.className = 'skeleton-cell skeleton-col-artist'
            const artistLine = document.createElement('div')
            artistLine.className = 'skeleton-line skeleton-block'
            colArtist.appendChild(artistLine)

            // album
            const colAlbum = document.createElement('div')
            colAlbum.className = 'skeleton-cell skeleton-col-album'
            const albumLine = document.createElement('div')
            albumLine.className = 'skeleton-line skeleton-block'
            colAlbum.appendChild(albumLine)

            // date
            const colDate = document.createElement('div')
            colDate.className = 'skeleton-cell skeleton-col-date'
            const dateLine = document.createElement('div')
            dateLine.className = 'skeleton-line skeleton-block'
            colDate.appendChild(dateLine)

            // duration
            const colDuration = document.createElement('div')
            colDuration.className = 'skeleton-cell skeleton-col-duration'
            const durLine = document.createElement('div')
            durLine.className = 'skeleton-line skeleton-block'
            colDuration.appendChild(durLine)

            // actions
            const colActions = document.createElement('div')
            colActions.className = 'skeleton-cell skeleton-col-actions'
            const actLine = document.createElement('div')
            actLine.className = 'skeleton-line skeleton-block'
            colActions.appendChild(actLine)

            row.appendChild(colIndex)
            row.appendChild(colTitle)
            row.appendChild(colArtist)
            row.appendChild(colAlbum)
            row.appendChild(colDate)
            row.appendChild(colDuration)
            row.appendChild(colActions)

            trackSection.appendChild(row)
        }

        container.appendChild(trackSection)

        return
    }

    if (variant === 'player') {
        container.classList.add('skeleton-player')
        for (let i = 0; i < Math.max(1, count); i++) {
            const item = document.createElement('div')
            item.className = 'skeleton-item skeleton-player-row'

            const art = document.createElement('div')
            art.className = 'skeleton-player-art skeleton-block'

            const lines = document.createElement('div')
            lines.className = 'skeleton-lines'

            const title = document.createElement('div')
            title.className = 'skeleton-line skeleton-line-long skeleton-block'
            title.style.height = '18px'

            const subtitle = document.createElement('div')
            subtitle.className = 'skeleton-line skeleton-line-short skeleton-block'
            subtitle.style.height = '14px'

            lines.appendChild(title)
            lines.appendChild(subtitle)

            item.appendChild(art)
            item.appendChild(lines)
            container.appendChild(item)
        }

        return
    }

    // default: row
    container.classList.add('skeleton-rows')
    for (let i = 0; i < count; i++) {
        const item = document.createElement('div')
        item.className = 'skeleton-item skeleton-row'

        const thumb = document.createElement('div')
        thumb.className = 'skeleton-thumb skeleton-block'

        const lines = document.createElement('div')
        lines.className = 'skeleton-lines'

        const line1 = document.createElement('div')
        line1.className = 'skeleton-line skeleton-line-long skeleton-block'

        const line2 = document.createElement('div')
        line2.className = 'skeleton-line skeleton-line-short skeleton-block'

        lines.appendChild(line1)
        lines.appendChild(line2)

        const dur = document.createElement('div')
        dur.className = 'skeleton-duration skeleton-block'

        item.appendChild(thumb)
        item.appendChild(lines)
        item.appendChild(dur)

        container.appendChild(item)
    }
}

export function initializeLoadingScreen() {
    ensureOverlayElements()

    let hideTimeout = null

    window.loader = {
        setMessage(text) {
            const ensured = ensureOverlayElements()
            if (ensured && ensured.status) {
                ensured.status.textContent = text
            }
        },

        show(opts = {}) {
            let text = 'Loading...'
            let count = 6
            let variant = 'row'

            if (typeof opts === 'string') {
                text = opts
            } else if (opts && typeof opts === 'object') {
                if (opts.text) text = opts.text
                if (Number.isFinite(opts.count)) count = opts.count
                if (opts.variant && typeof opts.variant === 'string') variant = opts.variant
            }

            if (hideTimeout) {
                clearTimeout(hideTimeout)
                hideTimeout = null
            }

            const ensured = ensureOverlayElements()
            const overlay = ensured?.overlay
            const container = ensured?.container
            const status = ensured?.status

            if (!overlay || !container) return

            if (status && text) status.textContent = text

            renderSkeletonItems(container, count, variant)

            overlay.style.display = 'flex'
            overlay.classList.remove('fade-out')
        },

        hide(minDuration = 1000) {
            const overlay = getOverlay()

            if (!overlay) return

            overlay.classList.add('fade-out')

            hideTimeout = setTimeout(() => {
                overlay.style.display = 'none'
                const container = overlay.querySelector('.skeleton-container')
                if (container) container.innerHTML = ''
                hideTimeout = null
            }, minDuration)
        },
    }
}

window.initializeLoadingScreen = initializeLoadingScreen
