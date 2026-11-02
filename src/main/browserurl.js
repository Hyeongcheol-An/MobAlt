// What a browser session may open. One module for both processes: the main process requires it (the webview guard
// in main.js, the JSON importer), the renderer loads it as a classic script from index.html (window.BrowserUrl, re-
// exported by src/renderer/browserurl.js) — so the session editor, quick connect, the importer and the attach guard
// all agree on what is a browser URL, and the rule is tested once (test/unit/browserurl.test.js).
//
// Only http://, https:// and about:blank ever reach a <webview>: file:, javascript:, data:, blob: and every other
// scheme are refused here, at the form and the importer, and again in the main process when the webview attaches
// (defence in depth — the renderer is not trusted with the decision).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrowserUrl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Schemes a typed address may start with (lower case); everything else is refused with 'scheme'. */
  const ALLOWED = ['http:', 'https:'];
  const ABOUT_BLANK = 'about:blank';

  /**
   * Hosts that are the user's own machine or network: a bare address typed without a scheme gets http:// for them
   * (a tunnelled port, a router, a device's web UI: almost never TLS with a trusted certificate) and https:// for
   * everything else (the public web). An explicit scheme is always kept.
   */
  function isLocalHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return false;
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
    if (/\.(localhost|local|lan|home|internal|intranet|home\.arpa)$/.test(h)) return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
      const a = +m[1], b = +m[2];
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true; // IPv6 unique-local / link-local
    return !h.includes('.') && !h.includes(':'); // a single label ("router", "nas"): a name on the local network
  }

  /**
   * The address a user typed, as a URL the browser pane may load, or why not:
   *   { url }                — http(s) with a host, or about:blank; scheme and host lower-cased, a path added ("/")
   *   { error: 'empty' }     — nothing typed
   *   { error: 'scheme' }    — file:, javascript:, data:, blob:, ftp:, ssh:, mailto:… (never loaded, whatever the rest)
   *   { error: 'invalid' }   — not a URL (no host, bad characters, a bad port)
   * A bare host gets a scheme (isLocalHost: http:// for the local network, https:// otherwise); "localhost:3000" is a
   * host and a port, not a scheme (a scheme is followed by "//" or is one that is known).
   */
  function normalizeBrowserUrl(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return { error: 'empty' };
    if (s.toLowerCase() === ABOUT_BLANK) return { url: ABOUT_BLANK };
    if (/[\s\u0000-\u001f]/.test(s)) return { error: 'invalid' }; // a space or a control character is never part of an address
    let candidate = s;
    const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(s);
    if (m) {
      const scheme = m[1].toLowerCase() + ':';
      const rest = m[2];
      if (!ALLOWED.includes(scheme)) {
        // "localhost:3000", "nas:8080": a host and a port; "file:…", "data:…", "ssh://…", "x-foo://…": a scheme
        const hostPort = /^\d{1,5}([/?#].*)?$/.test(rest) && !/^(file|javascript|data|blob|ftp|ftps|ssh|mailto|tel|about|chrome|devtools|view-source|vbscript|ws|wss)$/i.test(m[1]);
        if (!hostPort) return { error: 'scheme' };
      } else if (!/^\/\//.test(rest)) candidate = scheme + '//' + rest.replace(/^\/+/, ''); // "http:example.com", "https:/example.com": the slashes the user left out
    }
    if (!/^https?:\/\//i.test(candidate)) candidate = (isLocalHost(hostOf(candidate)) ? 'http://' : 'https://') + candidate.replace(/^\/+/, '');
    let u;
    try { u = new URL(candidate); } catch { return { error: 'invalid' }; }
    if (!ALLOWED.includes(u.protocol)) return { error: 'scheme' }; // the parser may have read another scheme out of it
    if (!u.hostname) return { error: 'invalid' };
    return { url: u.href };
  }

  /** The host part of a scheme-less address ("nas:8080/x" → "nas", "user@[::1]:9/x" → "[::1]"), for the scheme choice. */
  function hostOf(s) {
    const noPath = String(s).replace(/^\/+/, '').split(/[/?#]/)[0];
    const noUser = noPath.includes('@') ? noPath.slice(noPath.lastIndexOf('@') + 1) : noPath;
    const bracket = /^(\[[^\]]*\])/.exec(noUser);
    if (bracket) return bracket[1];
    return noUser.split(':')[0];
  }

  /**
   * True for a URL that is already in the form normalizeBrowserUrl produces (http(s) with a host, or about:blank):
   * what the main process checks when a webview attaches or navigates, and what the importer accepts.
   */
  function isBrowserUrl(url) {
    if (typeof url !== 'string') return false;
    const s = url.trim();
    if (s.toLowerCase() === ABOUT_BLANK) return true;
    if (!/^https?:\/\//i.test(s)) return false;
    try {
      const u = new URL(s);
      return ALLOWED.includes(u.protocol) && !!u.hostname;
    } catch {
      return false;
    }
  }

  /** The name a browser session gets by default: the host, with the port when it is not the scheme's own ("nas:8080", "example.com"); "" for about:blank. */
  function browserHost(url) {
    try {
      const u = new URL(String(url));
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return '';
    }
  }

  return { normalizeBrowserUrl, isBrowserUrl, browserHost, isLocalHost };
});
