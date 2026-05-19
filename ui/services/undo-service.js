// Simple undo service: maintains a stack of undo functions and provides
// a keyboard shortcut attachment for Ctrl/Cmd+Z to trigger undo.
const MAX_STACK = 50
let stack = []

export function pushUndo(undoFn, meta = {}) {
    if (typeof undoFn !== 'function') return
    stack.push({ undoFn, meta })
    if (stack.length > MAX_STACK) stack.shift()
}

export async function undo() {
    if (!stack.length) return false
    const entry = stack.pop()
    try {
        await entry.undoFn()
        return true
    } catch (e) {
        console.error('undo failed', e)
        return false
    }
}

export function canUndo() {
    return stack.length > 0
}

export function clearUndo() {
    stack = []
}

let _keyHandler = null
let _boundTarget = null
export function attachUndoShortcut(target = window) {
    try {
        detachUndoShortcut()
        _keyHandler = (e) => {
            const key = e.key ? e.key.toLowerCase() : ''
            const isMac =
                typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform)
            if ((isMac && e.metaKey && key === 'z') || (!isMac && e.ctrlKey && key === 'z')) {
                e.preventDefault()
                // fire and forget
                undo().catch(() => {})
            }
        }
        target.addEventListener('keydown', _keyHandler)
        _boundTarget = target
    } catch (e) {
        console.error('attachUndoShortcut failed', e)
    }
}

export function detachUndoShortcut(target = window) {
    if (!_keyHandler) return
    try {
        const boundTarget = _boundTarget || target
        boundTarget.removeEventListener('keydown', _keyHandler)
    } catch (err) {
        console.error('detachUndoShortcut failed', err)
    }
    _keyHandler = null
    _boundTarget = null
}
