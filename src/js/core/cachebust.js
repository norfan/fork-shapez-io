/**
 * Generates a cachebuster string. This only modifies the path in the browser version
 * @param {string} path
 */
export function cachebust(path) {
    // Capacitor serves the assets from a local webview, which does not support the
    // "/v/<hash>/" version prefix - serve the plain path there.
    const isCapacitor = typeof window !== "undefined" && !!window.Capacitor;
    if (G_IS_BROWSER && !G_IS_STANDALONE && !G_IS_DEV && !isCapacitor) {
        return "/v/" + G_BUILD_COMMIT_HASH + "/" + path;
    }
    return path;
}
