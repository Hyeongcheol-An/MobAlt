// The browser-URL rules as an ES module: src/main/browserurl.js is loaded by index.html as a classic script (the
// same file the main process requires), so both processes normalise and refuse addresses the same way.
const api = window.BrowserUrl || {};
export const normalizeBrowserUrl = api.normalizeBrowserUrl;
export const isBrowserUrl = api.isBrowserUrl;
export const browserUrlWithoutUser = api.browserUrlWithoutUser;
export const browserHost = api.browserHost;
