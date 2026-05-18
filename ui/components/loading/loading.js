function getOverlay() {
    return document.getElementById('loadingOverlay')
}

function getMessage() {
    return document.getElementById('loadingText')
}

function getApp() {
    return document.getElementById('app')
}

function ensureOverlayElements() {
    const overlay = getOverlay()

    if (!overlay) {
        return null
    }

    let spinner = overlay.querySelector('.spinner')
    if (!spinner) {
        spinner = document.createElement('div')
        spinner.className = 'spinner'
        overlay.appendChild(spinner)
    }

    let message = getMessage()
    if (!message) {
        message = document.createElement('div')
        message.className = 'loadingText'
        message.id = 'loadingText'
        message.textContent = 'Loading...'
        overlay.appendChild(message)
    }

    return {
        overlay,
        message,
    }
}

export function setMessage(message) {
    const ensured = ensureOverlayElements()
    const el = ensured?.message

    if (!el) {
        console.warn('Loading message element not found')
        return
    }

    el.textContent = message
}

export function initializeLoadingScreen() {
    ensureOverlayElements()

    window.loader = {
        setMessage(text) {
            const ensured = ensureOverlayElements()
            const message = ensured?.message

            if (!message) {
                console.warn('Loading message element not found')
                return
            }

            message.textContent = text
        },

        show(text = 'Loading...') {
            const ensured = ensureOverlayElements()
            const overlay = ensured?.overlay

            if (!overlay) return

            if (text) {
                this.setMessage(text)
            }

            overlay.style.display = 'flex'
            overlay.classList.remove('fade-out')
        },

        hide(minDuration = 1000) {
            const overlay = getOverlay()
            const app = getApp()

            if (!overlay) return

            overlay.classList.add('fade-out')

            setTimeout(() => {
                overlay.style.display = 'none'

                if (app) {
                    app.style.display = 'block'
                }
            }, minDuration)
        },
    }
}

window.initializeLoadingScreen = initializeLoadingScreen
