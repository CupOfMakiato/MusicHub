const DEFAULT_IMAGE_FALLBACK_SRC = './assets/music-placeholder.png'

export function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = String(text ?? '')
    return div.innerHTML
}

export class CreateElementBuilder {
    constructor(tagName) {
        this.element = document.createElement(tagName)
    }

    static create(tagName) {
        return new CreateElementBuilder(tagName)
    }

    className(value) {
        this.element.className = String(value ?? '')
        return this
    }

    addClass(...values) {
        values.filter(Boolean).forEach((value) => {
            this.element.classList.add(String(value))
        })
        return this
    }

    attr(name, value) {
        if (value !== undefined && value !== null) {
            this.element.setAttribute(name, String(value))
        }
        return this
    }

    property(name, value) {
        this.element[name] = value
        return this
    }

    text(value) {
        this.element.textContent = String(value ?? '')
        return this
    }

    child(childNode) {
        if (childNode instanceof CreateElementBuilder) {
            this.element.appendChild(childNode.build())
            return this
        }

        if (childNode instanceof Node) {
            this.element.appendChild(childNode)
        }
        return this
    }

    children(...childNodes) {
        childNodes.forEach((childNode) => {
            this.child(childNode)
        })
        return this
    }

    on(eventName, handler, options) {
        if (eventName && typeof handler === 'function') {
            this.element.addEventListener(eventName, handler, options)
        }
        return this
    }

    build() {
        return this.element
    }
}

export function getOrCreateModalHost({ scope, hostClass = 'recentMusicModalHost' }) {
    if (!scope || !hostClass) {
        return null
    }

    let modalHost = scope.querySelector(`.${hostClass}`)
    if (modalHost) {
        return modalHost
    }

    modalHost = document.createElement('div')
    modalHost.className = hostClass
    scope.appendChild(modalHost)
    return modalHost
}

export function closeModalHost({ scope, hostClass = 'recentMusicModalHost' }) {
    if (!scope || !hostClass) {
        return
    }

    const modalHost = scope.querySelector(`.${hostClass}`)
    if (!modalHost) {
        return
    }

    modalHost.innerHTML = ''
    modalHost.classList.remove('is-open')
}

export function openModal({ scope, contentHtml, contentNode, hostClass = 'recentMusicModalHost' }) {
    const modalHost = getOrCreateModalHost({ scope, hostClass })
    if (!modalHost) {
        return {
            modalHost: null,
            close: () => {},
        }
    }

    modalHost.classList.add('is-open')
    // clear any previous content to ensure a single modal host child tree
    modalHost.innerHTML = ''
    if (contentNode && contentNode instanceof Node) {
        // append node(s) instead of using innerHTML for safer DOM construction
        modalHost.appendChild(contentNode)
    } else {
        modalHost.innerHTML = String(contentHtml ?? '')
    }

    const close = () => {
        closeModalHost({ scope, hostClass })
    }

    return {
        modalHost,
        close,
    }
}

export function showModalPrompt({
    scope,
    contentHtml,
    contentNode,
    hostClass = 'recentMusicModalHost',
    fallbackValue = null,
    onBind,
}) {
    return new Promise((resolve) => {
        const { modalHost, close } = openModal({ scope, contentHtml, contentNode, hostClass })
        if (!modalHost) {
            resolve(fallbackValue)
            return
        }

        const resolveAndClose = (value = fallbackValue) => {
            close()
            resolve(value)
        }

        if (typeof onBind === 'function') {
            onBind({ modalHost, close, resolve: resolveAndClose })
        }
    })
}

export function showNotice({
    scope,
    title = 'Notice',
    message = '',
    okText = 'OK',
    hostClass = 'recentMusicModalHost',
}) {
    if (!scope) {
        return Promise.resolve()
    }

    const contentHtml = `
        <div class="recentModalBackdrop" data-close="true"></div>
        <div class="recentModalDialog" role="dialog" aria-modal="true">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(String(message || ''))}</p>
            <div class="recentModalActions">
                <button type="button" class="recentModalConfirmBtn">${escapeHtml(okText)}</button>
            </div>
        </div>
    `

    return showModalPrompt({
        scope,
        contentHtml,
        hostClass,
        fallbackValue: undefined,
        onBind: ({ modalHost, resolve }) => {
            if (!modalHost) {
                resolve(undefined)
                return
            }

            bindModalResolve({
                modalHost,
                selector: '.recentModalConfirmBtn',
                resolve,
                value: undefined,
            })

            bindModalResolve({
                modalHost,
                selector: '.recentModalBackdrop',
                resolve,
                value: undefined,
            })
        },
    })
}

export function bindModalResolve({ modalHost, selector, resolve, value = null, getValue }) {
    if (!modalHost || !selector || typeof resolve !== 'function') {
        return
    }

    const targets = modalHost.querySelectorAll(selector)
    targets.forEach((target, index) => {
        target.addEventListener('click', () => {
            if (typeof getValue === 'function') {
                resolve(getValue({ element: target, index }))
                return
            }

            resolve(value)
        })
    })
}

export function attachIndexedMenuToggle({
    scope,
    triggerSelector,
    menuSelector,
    indexAttribute = 'data-track-index',
    openClass = 'is-open',
}) {
    if (!scope) {
        return () => {}
    }

    const menuButtons = Array.from(scope.querySelectorAll(triggerSelector))
    const menus = Array.from(scope.querySelectorAll(menuSelector))
    if (!menuButtons.length || !menus.length) {
        return () => {}
    }

    const closeAllMenus = () => {
        menus.forEach((menu) => {
            menu.classList.remove(openClass)
        })
    }

    const buttonBindings = menuButtons.map((button) => {
        const onClick = (event) => {
            event.stopPropagation()

            const menuIndex = button.getAttribute(indexAttribute)
            const targetMenu = scope.querySelector(
                `${menuSelector}[${indexAttribute}="${menuIndex}"]`,
            )
            if (!targetMenu) {
                return
            }

            const isOpen = targetMenu.classList.contains(openClass)
            closeAllMenus()
            if (!isOpen) {
                targetMenu.classList.add(openClass)
            }
        }

        button.addEventListener('click', onClick)
        return { button, onClick }
    })

    const onDocumentClick = () => {
        closeAllMenus()
    }

    document.addEventListener('click', onDocumentClick)

    return () => {
        buttonBindings.forEach(({ button, onClick }) => {
            button.removeEventListener('click', onClick)
        })
        document.removeEventListener('click', onDocumentClick)
    }
}

export function placeFloatingElement({
    element,
    left = 0,
    top = 0,
    widthFallback = 0,
    heightFallback = 0,
    padding = 8,
    position = 'fixed',
}) {
    if (!element) {
        return null
    }

    const elementWidth = Number(element.offsetWidth) || Number(widthFallback) || 0
    const elementHeight = Number(element.offsetHeight) || Number(heightFallback) || 0
    const viewportWidth = Number(window.innerWidth) || 0
    const viewportHeight = Number(window.innerHeight) || 0
    const safePadding = Number.isFinite(Number(padding)) ? Number(padding) : 8

    const maxLeft = viewportWidth - elementWidth - safePadding
    const maxTop = viewportHeight - elementHeight - safePadding
    const safeLeft = Math.max(safePadding, Math.min(Number(left) || 0, maxLeft))
    const safeTop = Math.max(safePadding, Math.min(Number(top) || 0, maxTop))

    element.style.position = position
    element.style.left = `${safeLeft}px`
    element.style.top = `${safeTop}px`

    return {
        left: safeLeft,
        top: safeTop,
        width: elementWidth,
        height: elementHeight,
    }
}

export function bindGlobalDismissEvents({
    onDismiss,
    closeOnClick = true,
    closeOnScroll = true,
    closeOnResize = true,
    scrollCapture = true,
}) {
    if (typeof onDismiss !== 'function') {
        return () => {}
    }

    const onGlobalDismiss = () => {
        onDismiss()
    }

    const useScrollCapture = Boolean(scrollCapture)

    if (closeOnClick) {
        document.addEventListener('click', onGlobalDismiss)
    }

    if (closeOnScroll) {
        document.addEventListener('scroll', onGlobalDismiss, useScrollCapture)
    }

    if (closeOnResize) {
        window.addEventListener('resize', onGlobalDismiss)
    }

    return () => {
        if (closeOnClick) {
            document.removeEventListener('click', onGlobalDismiss)
        }

        if (closeOnScroll) {
            document.removeEventListener('scroll', onGlobalDismiss, useScrollCapture)
        }

        if (closeOnResize) {
            window.removeEventListener('resize', onGlobalDismiss)
        }
    }
}

export function getDataAttributeIndex(element, attributeName) {
    if (!element || typeof attributeName !== 'string' || !attributeName.trim()) {
        return null
    }

    const value = Number(element.getAttribute(attributeName))
    if (!Number.isInteger(value) || value < 0) {
        return null
    }

    return value
}

function resolveFallbackSrc(fallbackSrc) {
    if (typeof fallbackSrc === 'string' && fallbackSrc.trim()) {
        return fallbackSrc.trim()
    }

    return DEFAULT_IMAGE_FALLBACK_SRC
}

export function bindImageFallback(imageElement, fallbackSrc = DEFAULT_IMAGE_FALLBACK_SRC) {
    if (!imageElement) {
        return
    }

    const resolvedFallbackSrc = resolveFallbackSrc(fallbackSrc)

    delete imageElement.dataset.fallbackApplied
    imageElement.onerror = () => {
        if (imageElement.dataset.fallbackApplied === 'true') {
            imageElement.onerror = null
            return
        }

        imageElement.dataset.fallbackApplied = 'true'
        imageElement.src = resolvedFallbackSrc
    }
}

export function bindImageFallbacks({
    scope,
    selector = 'img',
    fallbackSrc = DEFAULT_IMAGE_FALLBACK_SRC,
}) {
    if (!scope || !selector) {
        return
    }

    const resolvedFallbackSrc = resolveFallbackSrc(fallbackSrc)

    const images = scope.querySelectorAll(selector)
    images.forEach((image) => {
        bindImageFallback(image, resolvedFallbackSrc)
    })
}

export const domHelpers = {
    CreateElementBuilder,
    escapeHtml,
    getOrCreateModalHost,
    closeModalHost,
    openModal,
    showModalPrompt,
    bindModalResolve,
    attachIndexedMenuToggle,
    placeFloatingElement,
    bindGlobalDismissEvents,
    getDataAttributeIndex,
    bindImageFallback,
    bindImageFallbacks,
}

window.domHelpers = domHelpers
