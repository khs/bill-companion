// Where the ingested U.S. Code lives, and whether this is somebody's checkout.
//
// Two questions that look unrelated and are not: both are about the difference
// between a developer running tools/serve.py and a stranger opening a deployed
// page. One decides where to fetch shards from, the other decides what to say
// when they aren't there.

/**
 * Base URL for the ingested Code, without a trailing slash.
 *
 * A *relative* default is load-bearing. GitHub Pages serves a project site from
 * https://user.github.io/<repo>/, so an absolute "/data/usc" would look for the
 * data at the account root and 404 every shard. Everything here resolves against
 * the document, which works at a repo subpath, at a domain root, and from a
 * local server alike.
 *
 * Override by setting `window.BILL_COMPANION_DATA` before the module loads, or
 * with <meta name="bill-companion-data" content="https://…">. That is what
 * splits the 322 MB of shards onto their own host without touching code — the
 * host has to send `access-control-allow-origin`, since it is then cross-origin.
 */
export const DATA = (() => {
  const strip = (s) => String(s).replace(/\/+$/, '');
  if (typeof globalThis !== 'undefined' && globalThis.BILL_COMPANION_DATA) {
    return strip(globalThis.BILL_COMPANION_DATA);
  }
  if (typeof document !== 'undefined' && document.querySelector) {
    const meta = document.querySelector('meta[name="bill-companion-data"]');
    if (meta && meta.content) return strip(meta.content);
  }
  return 'data/usc';
})();

/**
 * Is this a working checkout, rather than a deployed copy?
 *
 * Only ever used to decide whether telling someone to run a Python command is
 * helpful or absurd. On a published site the visitor has no checkout, no
 * terminal and no ability to ingest anything, so "python tools/ingest_usc.py"
 * is noise dressed up as a fix.
 *
 * Absence of `location` means "not a browser" — a headless DOM in the render
 * tests — and that is treated as local, because the tests are a checkout. Same
 * shape as the window.top guard in main.js: the missing global is the answer,
 * not a case to crash on.
 */
export function isLocalCheckout() {
  const loc = typeof globalThis !== 'undefined' ? globalThis.location : null;
  if (!loc || !loc.hostname) return true;
  return (
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1' ||
    loc.hostname === '[::1]' ||
    loc.hostname === '' ||
    loc.protocol === 'file:'
  );
}
