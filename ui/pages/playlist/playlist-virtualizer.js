let virtualCorePromise = null
let virtualCore = null

export async function loadPlaylistVirtualCore() {
    if (virtualCore) {
        return virtualCore
    }

    if (!globalThis.process) {
        globalThis.process = { env: { NODE_ENV: 'production' } }
    }

    virtualCorePromise ||= import('../../../node_modules/@tanstack/virtual-core/dist/esm/index.js')
    virtualCore = await virtualCorePromise

    return virtualCore
}

export function canUsePlaylistVirtualizer() {
    return typeof virtualCore?.Virtualizer === 'function'
}

export function createPlaylistVirtualizer(options) {
    if (!canUsePlaylistVirtualizer()) {
        return null
    }

    const virtualizer = new virtualCore.Virtualizer({
        scrollToFn: virtualCore.elementScroll,
        observeElementRect: virtualCore.observeElementRect,
        observeElementOffset: virtualCore.observeElementOffset,
        useScrollendEvent: true,
        useAnimationFrameWithResizeObserver: true,
        ...options,
    })

    virtualizer._willUpdate()
    const cleanup = virtualizer._didMount()
    virtualizer.destroy = cleanup

    return virtualizer
}
