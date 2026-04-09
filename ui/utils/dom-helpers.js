window.domHelpers = (() => {
    function escapeHtml(text) {
        const div = document.createElement('div')
        div.textContent = String(text ?? '')
        return div.innerHTML
    }

    function getOrCreateModalHost({
        scope,
        hostClass = 'recentMusicModalHost',
    }) {
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

    function closeModalHost({
        scope,
        hostClass = 'recentMusicModalHost',
    }) {
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

    function openModal({
        scope,
        contentHtml,
        hostClass = 'recentMusicModalHost',
    }) {
        const modalHost = getOrCreateModalHost({ scope, hostClass })
        if (!modalHost) {
            return {
                modalHost: null,
                close: () => {},
            }
        }

        modalHost.classList.add('is-open')
        modalHost.innerHTML = String(contentHtml ?? '')

        const close = () => {
            closeModalHost({ scope, hostClass })
        }

        return {
            modalHost,
            close,
        }
    }

    function showModalPrompt({
        scope,
        contentHtml,
        hostClass = 'recentMusicModalHost',
        fallbackValue = null,
        onBind,
    }) {
        return new Promise((resolve) => {
            const { modalHost, close } = openModal({ scope, contentHtml, hostClass })
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

    function bindModalResolve({
        modalHost,
        selector,
        resolve,
        value = null,
        getValue,
    }) {
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

    function attachIndexedMenuToggle({
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
                const targetMenu = scope.querySelector(`${menuSelector}[${indexAttribute}="${menuIndex}"]`)
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

    return {
        escapeHtml,
        getOrCreateModalHost,
        closeModalHost,
        openModal,
        showModalPrompt,
        bindModalResolve,
        attachIndexedMenuToggle,
    }
})()
