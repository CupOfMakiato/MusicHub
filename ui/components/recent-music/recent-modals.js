import { showModalPrompt, bindModalResolve } from '../../utils/dom-helpers.js'
import {
    normalizeTrackRecord,
    DEFAULT_TRACK_TITLE,
    DEFAULT_TRACK_ARTIST,
} from '../../utils/track-record.js'
import { hydrateViewSongsMetadata } from './recent-metadata.js'

function bindModalDismiss({ modalHost, resolve, value = null }) {
    bindModalResolve({
        modalHost,
        selector: '.recentModalBackdrop',
        resolve,
        value,
    })
}

export function askCreatePlaylistValues(
    scope,
    { title = 'Create New Playlist', defaultName = '' } = {},
) {
    // Build DOM nodes instead of HTML string
    const fragment = document.createDocumentFragment()
    const backdrop = document.createElement('div')
    backdrop.className = 'recentModalBackdrop'
    backdrop.setAttribute('data-close', 'true')

    const dialog = document.createElement('div')
    dialog.className = 'recentModalDialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const h3 = document.createElement('h3')
    h3.textContent = title

    const label = document.createElement('label')
    label.className = 'recentModalFieldLabel'
    label.setAttribute('for', 'playlistNameInput')
    label.textContent = 'Playlist Name'

    const input = document.createElement('input')
    input.id = 'playlistNameInput'
    input.className = 'recentModalInput'
    input.type = 'text'
    input.maxLength = 100
    input.placeholder = 'My Playlist'
    input.value = defaultName || ''

    const actions = document.createElement('div')
    actions.className = 'recentModalActions'

    const confirmBtn = document.createElement('button')
    confirmBtn.type = 'button'
    confirmBtn.className = 'recentModalConfirmBtn'
    confirmBtn.textContent = 'Create'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'recentModalCancelBtn'
    cancelBtn.textContent = 'Cancel'

    actions.appendChild(confirmBtn)
    actions.appendChild(cancelBtn)

    dialog.appendChild(h3)
    dialog.appendChild(label)
    dialog.appendChild(input)
    dialog.appendChild(actions)

    fragment.appendChild(backdrop)
    fragment.appendChild(dialog)

    return showModalPrompt({
        scope,
        contentNode: fragment,
        fallbackValue: null,
        onBind: ({ modalHost, resolve }) => {
            if (!modalHost) {
                resolve(null)
                return
            }

            const nameInput = modalHost.querySelector('#playlistNameInput')
            nameInput?.focus()

            bindModalResolve({
                modalHost,
                selector: '.recentModalCancelBtn',
                resolve,
                value: null,
            })

            bindModalDismiss({ modalHost, resolve, value: null })

            bindModalResolve({
                modalHost,
                selector: '.recentModalConfirmBtn',
                resolve,
                getValue: () => ({
                    name: nameInput?.value?.trim() || '',
                }),
            })
        },
    })
}

export function askPlaylistSelection(scope, playlists, options = {}) {
    const title =
        typeof options?.title === 'string' && options.title.trim()
            ? options.title.trim()
            : 'Add To Playlist'
    const description =
        typeof options?.description === 'string' && options.description.trim()
            ? options.description.trim()
            : 'Select a playlist.'

    // Build DOM nodes instead of HTML string
    const fragment = document.createDocumentFragment()
    const backdrop = document.createElement('div')
    backdrop.className = 'recentModalBackdrop'
    backdrop.setAttribute('data-close', 'true')

    const dialog = document.createElement('div')
    dialog.className = 'recentModalDialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const h3 = document.createElement('h3')
    h3.textContent = title

    const p = document.createElement('p')
    p.textContent = description

    const list = document.createElement('div')
    list.className = 'recentPlaylistSelectList'

    playlists.forEach((playlist) => {
        const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'recentPlaylistSelectBtn'
        btn.setAttribute('data-playlist-id', String(playlist.id))
        btn.textContent = `${playlist.name} `
        const span = document.createElement('span')
        span.textContent = `${trackCount} songs`
        btn.appendChild(span)
        list.appendChild(btn)
    })

    const actions = document.createElement('div')
    actions.className = 'recentModalActions'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'recentModalCancelBtn'
    cancelBtn.textContent = 'Cancel'
    actions.appendChild(cancelBtn)

    dialog.appendChild(h3)
    dialog.appendChild(p)
    dialog.appendChild(list)
    dialog.appendChild(actions)

    fragment.appendChild(backdrop)
    fragment.appendChild(dialog)

    return showModalPrompt({
        scope,
        contentNode: fragment,
        fallbackValue: null,
        onBind: ({ modalHost, resolve }) => {
            if (!modalHost) {
                resolve(null)
                return
            }

            bindModalResolve({
                modalHost,
                selector: '.recentModalCancelBtn',
                resolve,
                value: null,
            })

            bindModalDismiss({ modalHost, resolve, value: null })

            bindModalResolve({
                modalHost,
                selector: '.recentPlaylistSelectBtn',
                resolve,
                getValue: ({ element }) => element.getAttribute('data-playlist-id'),
            })
        },
    })
}

export function showRecentPlaylistContents(scope, playlist) {
    if (!playlist) {
        return Promise.resolve(null)
    }

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
    // Build DOM nodes instead of HTML string
    const fragment = document.createDocumentFragment()
    const backdrop = document.createElement('div')
    backdrop.className = 'recentModalBackdrop'
    backdrop.setAttribute('data-close', 'true')

    const dialog = document.createElement('div')
    dialog.className = 'recentModalDialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const h3 = document.createElement('h3')
    h3.textContent = playlist.name || 'Folder Playlist'

    const p = document.createElement('p')
    p.textContent = `${tracks.length} songs from your selected folder.`

    const ul = document.createElement('ul')
    ul.className = 'recentModalTrackList'

    tracks.forEach((track, index) => {
        const normalizedTrack = normalizeTrackRecord(track)
        const trackTitle = normalizedTrack?.title || DEFAULT_TRACK_TITLE
        const trackArtist = normalizedTrack?.artist || DEFAULT_TRACK_ARTIST

        const li = document.createElement('li')
        li.className = 'recentModalTrackRow'
        li.setAttribute('data-track-index', String(index))

        const titleDiv = document.createElement('div')
        titleDiv.className = 'recentModalTrackTitle'
        titleDiv.textContent = trackTitle

        const metaDiv = document.createElement('div')
        metaDiv.className = 'recentModalTrackMeta'
        metaDiv.textContent = trackArtist

        li.appendChild(titleDiv)
        li.appendChild(metaDiv)
        ul.appendChild(li)
    })

    const actions = document.createElement('div')
    actions.className = 'recentModalActions'
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'recentModalConfirmBtn'
    closeBtn.textContent = 'Close'
    actions.appendChild(closeBtn)

    dialog.appendChild(h3)
    dialog.appendChild(p)
    dialog.appendChild(ul)
    dialog.appendChild(actions)

    fragment.appendChild(backdrop)
    fragment.appendChild(dialog)

    return showModalPrompt({
        scope,
        contentNode: fragment,
        fallbackValue: null,
        onBind: ({ modalHost, resolve, close }) => {
            if (!modalHost) {
                resolve(null)
                return
            }

            const controller = new AbortController()
            const safeResolve = (value) => {
                try {
                    controller.abort()
                } finally {
                    resolve(value)
                }
            }

            bindModalResolve({
                modalHost,
                selector: '.recentModalConfirmBtn',
                resolve: safeResolve,
                value: null,
            })

            bindModalDismiss({ modalHost, resolve: safeResolve, value: null })

            hydrateViewSongsMetadata({
                playlist,
                tracks,
                modalHost,
                signal: controller.signal,
            }).catch(() => {
                // swallow - debug logged in metadata module
            })
        },
    })
}
