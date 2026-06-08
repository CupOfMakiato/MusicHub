export const cursorClasses = Object.freeze({
    auto: 'cursor-auto',
    pointerClicked: 'cursor-pointer-clicked',
    grab: 'cursor-grab',
    grabbing: 'cursor-grabbing',
    text: 'cursor-text',
})

export const cursorInteractions = Object.freeze({
    normal: cursorClasses.auto,
    button: cursorClasses.pointerClicked,
    clickable: cursorClasses.pointerClicked,
    grab: cursorClasses.grab,
    grabbing: cursorClasses.grabbing,
    text: cursorClasses.text,
})

export const getCursorClass = (interaction = 'normal') =>
    cursorInteractions[interaction] ?? cursorClasses[interaction] ?? cursorClasses.auto

export const withCursorClass = (interaction, className = '') =>
    [getCursorClass(interaction), className].filter(Boolean).join(' ')
