//converting track data to HTML for rendering in playlist table rows

import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
    DEFAULT_TRACK_ALBUM,
} from '../../utils/track-record.js'
import { resolveTrackImage } from '../../utils/playlist-media.js'
import { formatDate } from '../../utils/date.js'
import { formatDurationClock } from '../../utils/duration.js'

export function renderTrackRow({ index, track, duration, rowHeight } = {}) {
    const normalizedTrack = normalizeTrackRecord(track)
    const trackTitle = normalizedTrack?.title || DEFAULT_TRACK_TITLE
    const artist = normalizedTrack?.artist || DEFAULT_TRACK_ARTIST
    const album = normalizedTrack?.album || DEFAULT_TRACK_ALBUM
    const trackImage = resolveTrackImage(normalizedTrack) || './assets/music-placeholder.png'
    const dateAdded = formatDate(normalizedTrack?.playedAt || normalizedTrack?.addedAt)

    const dur = typeof duration === 'number' && duration > 0 ? duration : null

    const tr = document.createElement('tr')
    tr.className = 'playlistTrackRow'
    tr.setAttribute('data-track-index', String(index))
    if (typeof rowHeight === 'number') {
        tr.style.height = `${rowHeight}px`
    }

    const tdIndex = document.createElement('td')
    tdIndex.className = 'playlistTrackIndexCell'
    const playBtn = document.createElement('button')
    playBtn.type = 'button'
    playBtn.className = 'playlistTrackIndexPlayBtn'
    playBtn.setAttribute('data-track-index', String(index))
    playBtn.setAttribute('aria-label', `Play from track ${index + 1}`)
    const spanIndex = document.createElement('span')
    spanIndex.className = 'playlistTrackIndexValue'
    spanIndex.textContent = String(index + 1)
    const playIcon = document.createElement('i')
    playIcon.setAttribute('data-lucide', 'play')
    playIcon.className = 'playlistTrackIndexPlayIcon'
    playIcon.setAttribute('aria-hidden', 'true')
    playBtn.appendChild(spanIndex)
    playBtn.appendChild(playIcon)
    tdIndex.appendChild(playBtn)
    tr.appendChild(tdIndex)

    const tdTitle = document.createElement('td')
    tdTitle.className = 'playlistTrackTitleCell'
    const wrap = document.createElement('div')
    wrap.className = 'playlistTrackTitleWrap'
    const img = document.createElement('img')
    img.className = 'playlistTrackCover'
    img.src = String(trackImage)
    img.alt = 'Track cover'
    img.setAttribute('draggable', 'false')
    const spanTitle = document.createElement('span')
    spanTitle.className = 'playlistTrackTitleText'
    spanTitle.textContent = trackTitle
    wrap.appendChild(img)
    wrap.appendChild(spanTitle)
    tdTitle.appendChild(wrap)
    tr.appendChild(tdTitle)

    const tdArtist = document.createElement('td')
    tdArtist.textContent = artist
    tr.appendChild(tdArtist)

    const tdAlbum = document.createElement('td')
    tdAlbum.textContent = album
    tr.appendChild(tdAlbum)

    const tdDate = document.createElement('td')
    tdDate.textContent = dateAdded
    tr.appendChild(tdDate)

    const tdDuration = document.createElement('td')
    tdDuration.setAttribute('data-duration-index', String(index))
    tdDuration.textContent = formatDurationClock(dur)
    tr.appendChild(tdDuration)

    const tdActions = document.createElement('td')
    const actionsDiv = document.createElement('div')
    actionsDiv.className = 'playlistTrackActions'
    const moreBtn = document.createElement('button')
    moreBtn.type = 'button'
    moreBtn.className = 'playlistTrackMoreBtn'
    moreBtn.setAttribute('data-track-index', String(index))
    moreBtn.setAttribute('aria-label', 'Track actions')
    const moreIcon = document.createElement('i')
    // option icon
    moreIcon.setAttribute('data-lucide', 'ellipsis')
    moreBtn.appendChild(moreIcon)
    const menuDiv = document.createElement('div')
    menuDiv.className = 'playlistTrackMenu'
    menuDiv.setAttribute('data-track-index', String(index))
    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'removeTrackBtn'
    removeBtn.setAttribute('data-track-index', String(index))
    removeBtn.textContent = 'Remove from Playlist'
    menuDiv.appendChild(removeBtn)
    actionsDiv.appendChild(moreBtn)
    actionsDiv.appendChild(menuDiv)
    tdActions.appendChild(actionsDiv)
    tr.appendChild(tdActions)

    return tr
}
