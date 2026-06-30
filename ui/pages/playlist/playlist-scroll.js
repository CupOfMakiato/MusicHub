export function createPlaylistScrollController({
    trackContainer,
    image,
    getVirtualizer,
    onRender,
} = {}) {
    let cachedScrollMargin = null
    let playlistLayoutResizeObserver = null
    let scrollRaf = null

    function getScrollElement() {
        return window.appScrollElement || document.getElementById('app-scroll') || window
    }

    function getScrollTop() {
        const scrollElement = getScrollElement()
        if (scrollElement === window) {
            return (document.scrollingElement || document.documentElement).scrollTop
        }

        return scrollElement.scrollTop
    }

    function getViewportHeight() {
        const scrollElement = getScrollElement()
        if (scrollElement === window) {
            return window.innerHeight || document.documentElement.clientHeight
        }

        return scrollElement.clientHeight
    }

    function getElementTopWithinAppScroll(element) {
        const scrollElement = getScrollElement()
        const scrollTop = getScrollTop()
        const elementRect = element.getBoundingClientRect()

        if (scrollElement === window) {
            return elementRect.top + scrollTop
        }

        const scrollRect = scrollElement.getBoundingClientRect()
        return elementRect.top - scrollRect.top + scrollTop
    }

    function getScrollMargin({ force = false } = {}) {
        if (!force && cachedScrollMargin !== null) {
            return cachedScrollMargin
        }

        const table = trackContainer.querySelector('.playlistTrackTable')
        const thead = table?.querySelector('thead')
        const headerHeight = thead ? thead.getBoundingClientRect().height : 0

        cachedScrollMargin = getElementTopWithinAppScroll(trackContainer) + headerHeight
        return cachedScrollMargin
    }

    function scheduleRender() {
        if (scrollRaf) {
            return
        }

        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = null
            onRender?.()
        })
    }

    function invalidate() {
        cachedScrollMargin = null
        if (getVirtualizer?.()) {
            scheduleRender()
        }
    }

    function observe() {
        if (typeof ResizeObserver === 'function') {
            playlistLayoutResizeObserver = new ResizeObserver(invalidate)
            ;[
                document.querySelector('.playlistHeader'),
                document.querySelector('.playlistControls'),
                trackContainer.querySelector('thead'),
            ].forEach((element) => {
                if (element) {
                    playlistLayoutResizeObserver.observe(element)
                }
            })
        }

        window.addEventListener('resize', invalidate, { passive: true })
        image.addEventListener('load', invalidate)
        image.addEventListener('error', invalidate)
    }

    function cleanup() {
        if (scrollRaf) {
            cancelAnimationFrame(scrollRaf)
            scrollRaf = null
        }

        window.removeEventListener('resize', invalidate)
        image.removeEventListener('load', invalidate)
        image.removeEventListener('error', invalidate)
        playlistLayoutResizeObserver?.disconnect()
        playlistLayoutResizeObserver = null
        cachedScrollMargin = null
    }

    return {
        getScrollElement,
        getScrollTop,
        getViewportHeight,
        getScrollMargin,
        scheduleRender,
        observe,
        invalidate,
        cleanup,
    }
}
