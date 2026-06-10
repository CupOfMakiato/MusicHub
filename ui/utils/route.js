// routing through pages
export function getCurrentRoute(fallbackRoute = 'home') {
    const route = window.appRouter?.getCurrentRoute?.()
    if (typeof route === 'string' && route) {
        return route
    }

    return fallbackRoute
}

export function isRouteActive(routeNames, fallbackRoute = 'home') {
    const names = Array.isArray(routeNames) ? routeNames : [routeNames]
    const currentRoute = getCurrentRoute(fallbackRoute)
    return names.includes(currentRoute)
}

export const routeUtils = {
    getCurrentRoute,
    isRouteActive,
}

window.routeUtils = routeUtils
