// Bill Companion — app wiring.

import { pdfToText } from './parse/pdf.js';
import { parseBill, normalizeText } from './parse/bill.js';
import { extractCitations, extractAmendments, expandRelativeRefs, amendmentFor } from './parse/citations.js';
import { resolve, resolveCfrPart } from './resolve/index.js';
import { renderBill } from './ui/render-bill.js';
import { renderContext } from './ui/render-context.js';
import { flattenText } from './resolve/provision-tree.js';
import { locateInternal } from './resolve/internal.js';
import { buildShareUrl, readSharedBill, SAFE_URL_LENGTH } from './share.js';
import { buildExport } from './export.js';

const $ = (id) => document.getElementById(id);

const els = {
  file: $('file'), pasteBtn: $('paste-btn'), sampleBtn: $('sample-btn'),
  billBody: $('bill-body'), ctxBody: $('ctx-body'), ctxSrc: $('ctx-src'), ctxBack: $('ctx-back'),
  status: $('status'), meta: $('billmeta'), metaDesig: $('meta-desig'), metaShort: $('meta-short'),
  jump: $('jump'), onlyAmend: $('only-amend'), split: $('split'), gutter: $('gutter'),
  themeBtn: $('theme-btn'), shareBtn: $('share-btn'), exportBtn: $('export-btn'),
  modal: $('paste-modal'), pasteArea: $('paste-area'), pasteOk: $('paste-ok'), pasteCancel: $('paste-cancel'),
  fullBtn: $('full-btn'), aboutBtn: $('about-btn'), aboutModal: $('about-modal'),
  aboutOk: $('about-ok'), embedSnippet: $('embed-snippet'), embedCopy: $('embed-copy'),
};

/**
 * Is this page running inside someone else's frame?
 *
 * Reading `window.top` across origins throws, and that throw is itself the
 * answer — a cross-origin parent is still a parent.
 *
 * The truthiness guard is not redundant. A real browser always defines
 * `window.top` (it is the window itself when nothing frames it), so a missing
 * one means there is no frame hierarchy to speak of — which is what a headless
 * DOM looks like, where `self !== top` compares an object against `undefined`
 * and reports every page as embedded.
 */
const EMBEDDED = (() => {
  try {
    if (!window.top) return false;
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
if (EMBEDDED) document.documentElement.dataset.embed = '';

const state = {
  bill: null, citations: [], amendments: [],
  activeEl: null, current: null, scopePath: null, showAllSections: false,
  history: [], jumpEl: null,
};

// ------------------------------------------------------------------ status
let busyCount = 0;
function status(msg, busy) {
  busyCount = Math.max(0, busyCount + (busy ? 1 : busy === false ? -1 : 0));
  els.status.textContent = msg || '';
  els.status.classList.toggle('busy', busyCount > 0);
}

// -------------------------------------------------------------- loading in
async function loadFile(file) {
  try {
    status(`Reading ${file.name}…`, true);
    let text;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const buf = await file.arrayBuffer();
      const res = await pdfToText(buf, (d, t) => status(`Extracting page ${d} of ${t}…`));
      text = res.text;
    } else {
      text = await file.text();
      if (/\.html?$/i.test(file.name) || /^\s*</.test(text)) text = htmlToText(text);
    }
    ingest(text);
  } catch (err) {
    status('');
    showFatal(`Could not read ${file.name}: ${err.message}`);
  } finally {
    status('', false);
  }
}

// govinfo serves bill text as HTML wrapped in <pre>; strip tags for that case.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pre = doc.querySelector('pre');
  return (pre ? pre.textContent : doc.body ? doc.body.textContent : html) || '';
}

function ingest(raw) {
  if (!raw || !raw.trim()) { showFatal('That file had no extractable text. If it is a scanned PDF, it needs OCR first.'); return; }

  const text = normalizeText(raw);

  status('Parsing…', true);
  const bill = parseBill(text);
  const rawCitations = extractCitations(text);
  const amendments = extractAmendments(text, rawCitations, bill.divisions);
  // Must run after amendments: a step like "in clause (iv)" only has an address
  // once we know which provision the enclosing instruction is amending.
  const citations = expandRelativeRefs(rawCitations, amendments);
  Object.assign(state, { bill, citations, amendments, activeEl: null, current: null, history: [] });

  els.billBody.replaceChildren(renderBill(bill, citations, amendments, onCite, onAmend));

  els.meta.hidden = false;
  els.shareBtn.hidden = false;
  els.exportBtn.hidden = false;
  els.metaDesig.textContent = bill.meta.designation || '—';
  els.metaShort.textContent = bill.meta.shortTitle || '';

  // Grouped by the chain of divisions and titles each section sits under. A
  // flat list is actively misleading in a bill with divisions, because the
  // numbering restarts inside each one — the Fiscal Responsibility Act has
  // three "TITLE I"s, and its jump menu ran "Sec. 124" straight into "Sec. 251"
  // with nothing to say a division boundary had been crossed. Sections above
  // the first division (short title, definitions) sit ungrouped at the top,
  // which is where they are.
  els.jump.replaceChildren(new Option('Jump to…', ''));
  let group = null;
  let groupLabel = null;
  for (const s of bill.sections) {
    const label = (s.ancestors || []).map((a) => `${a.label} — ${a.heading}`).join('  ›  ');
    if (label !== groupLabel) {
      groupLabel = label;
      group = null;
      if (label) {
        group = document.createElement('optgroup');
        // A property assignment does not reflect to the attribute in every DOM
        // implementation; the headless one in rendertest.mjs is one of them.
        group.setAttribute('label', label.slice(0, 90));
        els.jump.appendChild(group);
      }
    }
    (group || els.jump).appendChild(new Option(`Sec. ${s.num}. ${s.heading}`.slice(0, 70), s.id));
  }

  const n = citations.length;
  const a = amendments.length;
  status(`${n} citation${n === 1 ? '' : 's'} · ${a} amendment${a === 1 ? '' : 's'}`, false);
}

function showFatal(msg) {
  const d = document.createElement('div');
  d.className = 'card err';
  const h = document.createElement('h4'); h.textContent = 'Problem';
  const p = document.createElement('p'); p.textContent = msg;
  d.append(h, p);
  els.billBody.replaceChildren(d);
}

// ------------------------------------------------------------- interaction
async function onCite(cite, el, opts = {}) {
  if (state.activeEl) state.activeEl.classList.remove('active');
  if (el) { el.classList.add('active'); state.activeEl = el; }

  if (state.current && !opts.noHistory) state.history.push(state.current);
  els.ctxBack.hidden = state.history.length === 0;

  state.current = { cite, amend: opts.amend || null };
  state.scopePath = null;
  // Per-citation, like the scope: opening a new CFR part starts capped again.
  state.showAllSections = false;

  els.ctxSrc.textContent = 'loading…';
  els.ctxBody.replaceChildren(placeholder('Looking up ' + cite.text + '…'));

  const resolved = await resolve(cite);
  if (state.current?.cite !== cite) return; // superseded by a later click

  // Shallow-copy before annotating. resolve() memoises by citation, and the same
  // provision is often reached from several places in a bill — mutating the
  // cached object would carry one instruction's amendment preview, or one
  // relative address, onto an unrelated later click.
  const res = { ...resolved };
  if (cite.relative) {
    res.relative = {
      unit: cite.relUnit,
      markers: cite.relMarkers,
      via: cite.viaTarget,
      path: cite.subsection,
    };
  }
  const amend = opts.amend || amendmentFor(cite, state.amendments);
  if (amend) attachEffect(res, amend);
  // Where an internal reference points, in the bill itself. Attached to the copy
  // and never to the cached object: resolve() memoises internal refs by their
  // marker, so every "paragraph (3)" in the bill shares one cache entry while
  // each points somewhere different.
  if (cite.kind === 'internal' && state.bill) {
    res.target = locateInternal(state.bill, cite);
    if (res.target) highlightInBill(res.target.start);
  }
  state.current.res = res;
  paint(res);
}

/**
 * Scroll the bill pane to the paragraph holding `offset` and mark it.
 *
 * The mark persists rather than flashing: the reader clicked a reference to read
 * the thing it names, and a highlight that fades before the eye arrives is worse
 * than none. It clears on the next click.
 */
function highlightInBill(offset) {
  if (state.jumpEl) state.jumpEl.classList.remove('jump-target');
  state.jumpEl = null;
  const paras = els.billBody.querySelectorAll('.billtext p[data-start]');
  for (const p of paras) {
    if (offset >= +p.dataset.start && offset < +p.dataset.end) {
      p.classList.add('jump-target');
      p.scrollIntoView({ block: 'center', behavior: 'smooth' });
      state.jumpEl = p;
      return;
    }
  }
}

function paint(res) {
  els.ctxSrc.textContent = res.source || '';
  els.ctxBody.replaceChildren(
    renderContext(res, {
      scopePath: state.scopePath,
      onScope: (p) => { state.scopePath = p; paint(res); },
      showAllSections: state.showAllSections,
      onShowAll: () => { state.showAllSections = true; paint(res); },
      // Swap in one of the other sections carrying this number, keeping the one
      // being replaced in the list so the reader can go back. The focus is
      // cleared rather than carried across: the cited subsection belongs to the
      // provision that was on screen, and the other section is a different
      // provision that may have no such subsection at all.
      onAlternate: (i) => {
        const alt = res.also[i];
        const wasPrimary = {
          heading: res.heading, lead: res.lead, tree: res.tree,
          notes: res.notes, sourceCredit: res.sourceCredit, crumbs: res.crumbs,
        };
        state.scopePath = null;
        paint({
          ...res,
          ...alt,
          also: [wasPrimary, ...res.also.filter((_, k) => k !== i)],
          focusPath: '', citedPath: '', focusNode: null, focusChain: [],
          focusMissing: false, runIn: null, effect: null,
        });
      },
      onCrumb: async (c) => {
        if (c.type !== 'part') return;
        status('Loading part…', true);
        try {
          const part = await resolveCfrPart(state.current.cite);
          state.current.res = part;
          paint(part);
        } catch (err) {
          paint({ ...res, error: err.message });
        } finally { status('', false); }
      },
    })
  );
  // Top of the pane by default; the cited provision when there is one and it
  // is not already the first thing on screen.
  //
  // Deliberately not scrollIntoView(): inside a scrollable pane it is
  // implemented as "bring this into the viewport", which in Firefox and Chrome
  // also scrolls the page behind it, moving the bill in the other pane. Adding
  // the delta between the two rectangles moves this container and nothing else,
  // and behaves the same in all three browsers.
  els.ctxBody.scrollTop = 0;
  const focus = els.ctxBody.querySelector('#ctx-focus');
  if (focus && focus.getBoundingClientRect) {
    const pane = els.ctxBody.getBoundingClientRect();
    const box = focus.getBoundingClientRect();
    const delta = box.top - pane.top - 12;
    if (delta > 4) els.ctxBody.scrollTop += delta;
  }
}

/** Match the amendment's struck language against the text we resolved. */
function attachEffect(res, amend) {
  if (!amend.ops.length) return;
  // Nothing to compare against. A Public Law or Statutes at Large target
  // resolves to outbound links, not text, and running the check anyway marked
  // every struck phrase "⚠ not found verbatim" — which reads as "this amendment
  // no longer matches the law" when the truth is that we never had the law.
  if (!res.tree && !res.sections) return;
  let haystack = '';
  if (res.tree) {
    const node = res.focusNode;
    // Unscoped, the section's lead-in counts as current text too — an
    // undivided section keeps all of its language there, so leaving it out
    // reported live amendments as not matching the law they actually amend.
    haystack = node
      ? flattenText(node)
      : [res.lead || '', ...res.tree.map(flattenText)].join('\n');
  } else if (res.sections) {
    haystack = res.sections.map((s) => s.paragraphs.join('\n')).join('\n');
  }
  // Fold every quote convention together before comparing. The bill and the
  // U.S. Code shard rarely spell quotes the same way — a PDF bill carries ‘‘ ’’
  // and the shard curly doubles — and an unfolded mismatch reports a live
  // amendment as not matching the law it amends.
  const norm = (s) =>
    s.replace(/``|''|‘‘|’’|[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = norm(haystack);

  let unmatched = false;
  const ops = amend.ops.map((op) => {
    if (op.type !== 'strike') return op;
    const found = hay.includes(norm(op.text));
    if (!found) unmatched = true;
    return { ...op, found };
  });
  res.effect = { ops, unmatched };
}

function onAmend(amend) {
  if (!amend.target) {
    els.ctxBody.replaceChildren(
      renderContext(
        {
          source: 'Amendment',
          citation: `${amend.unit} ${amend.section}${amend.subsection}`,
          internal: true,
          note:
            amend.actName
              ? `This amends ${amend.actName}, but the bill gives no U.S. Code cite here, ` +
                `so the target can't be resolved automatically. Act section numbers often ` +
                `differ from their codified numbers.`
              : 'No resolvable target citation was found in this instruction.',
          links: [],
        },
        { onScope: () => {} }
      )
    );
    els.ctxSrc.textContent = 'Amendment';
    return;
  }
  const el = document.querySelector(`.cite[data-cid="${amend.target.id}"]`);
  onCite(amend.target, el, { amend });
}

function placeholder(msg) {
  const d = document.createElement('div');
  d.className = 'empty';
  const i = document.createElement('div');
  i.className = 'empty-inner';
  const p = document.createElement('p');
  p.className = 'dim';
  p.textContent = msg;
  i.appendChild(p);
  d.appendChild(i);
  return d;
}

// ------------------------------------------------------------------ events
els.file.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });

els.ctxBack.addEventListener('click', () => {
  const prev = state.history.pop();
  els.ctxBack.hidden = state.history.length === 0;
  if (!prev) return;
  const el = document.querySelector(`.cite[data-cid="${prev.cite.id}"]`);
  onCite(prev.cite, el, { amend: prev.amend, noHistory: true });
});

els.exportBtn.addEventListener('click', async () => {
  if (!state.bill) return;
  els.exportBtn.disabled = true;
  try {
    status('Resolving every citation for the export…', true);
    const html = await buildExport({
      bill: state.bill,
      citations: state.citations,
      billEl: els.billBody.querySelector('.billtext'),
      resolve,
      renderContext,
      onProgress: (done, total) => status(`Export: resolved ${done} of ${total} provisions…`),
    });
    // A Blob and an object URL, not a data: URL — a data: URL of several MB is
    // refused outright by Chrome and truncated by others, and this file is
    // several MB by design.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (state.bill.meta.shortTitle || state.bill.meta.designation || 'bill')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    a.download = `${name || 'bill'}-companion.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a later turn of the event loop: revoking synchronously races
    // the download in Firefox, which has not necessarily read the blob yet.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const mb = (blob.size / 1048576).toFixed(1);
    status(`Exported ${mb} MB — opens offline, and shows the law as it stands today.`, false);
  } catch (err) {
    status('', false);
    showFatal(`Could not build the export: ${err.message}`);
  } finally {
    els.exportBtn.disabled = false;
  }
});

els.jump.addEventListener('change', (e) => {
  const key = e.target.value;
  if (!key) return;
  // Keyed on the section's own unique id, not its number. Every division of an
  // appropriations act restarts at "Sec. 101", so `#sec-101` names several
  // paragraphs and getElementById answers with the first — picking division A
  // no matter which one was chosen. `data-sec` is unique by construction.
  const el = els.billBody.querySelector(`[data-sec="${key}"]`);
  el?.scrollIntoView({ block: 'start' });
});

els.onlyAmend.addEventListener('change', (e) => {
  els.billBody.querySelector('.billtext')?.classList.toggle('filtered', e.target.checked);
});

// drag & drop
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); els.split.classList.add('dragover'); });
}
for (const ev of ['dragleave', 'drop']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && e.relatedTarget) return;
    els.split.classList.remove('dragover');
  });
}
document.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });

// paste modal
els.pasteBtn.addEventListener('click', () => { els.modal.hidden = false; els.pasteArea.focus(); });
els.pasteCancel.addEventListener('click', () => { els.modal.hidden = true; });
els.pasteOk.addEventListener('click', () => { els.modal.hidden = true; ingest(els.pasteArea.value); });
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) els.modal.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modal.hidden) els.modal.hidden = true;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !els.modal.hidden) els.pasteOk.click();
});

els.sampleBtn.addEventListener('click', async () => {
  status('Loading sample…', true);
  try {
    const r = await fetch('samples/sample-bill.txt');
    if (!r.ok) throw new Error(`sample not found (${r.status})`);
    ingest(await r.text());
  } catch (err) {
    showFatal(`Could not load the sample: ${err.message}`);
  } finally { status('', false); }
});

// share link
els.shareBtn.addEventListener('click', async () => {
  if (!state.bill) return;
  status('Building link…', true);
  try {
    const url = await buildShareUrl(state.bill.text);
    // Put it in the address bar too, so copying from there works and a reload
    // keeps the bill. replaceState avoids adding a history entry per click.
    // Skipped when framed: there is no address bar to put it in, and rewriting
    // the frame's URL would only disturb the host page's history.
    if (!EMBEDDED) history.replaceState(null, '', url);

    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // Clipboard needs a secure context; over plain http it's unavailable.
    }
    const kb = Math.round(url.length / 1024);
    const tooLong = url.length > SAFE_URL_LENGTH;
    status(
      (copied
        ? `Link copied (${kb} KB)`
        : EMBEDDED
        ? `Couldn't reach the clipboard — open this in its own tab (⛶) to copy the link`
        : `Link is in the address bar (${kb} KB)`) +
        (tooLong ? ' — long; some chat and mail clients will wrap it' : ''),
      false
    );
  } catch (err) {
    status('');
    showFatal(`Could not build a share link: ${err.message}`);
  }
});

// A shared bill arrives in the fragment, which the browser never sends to the
// server. Load it before anything else so the page opens on the bill.
(async () => {
  try {
    const shared = await readSharedBill();
    if (shared) ingest(shared);
  } catch (err) {
    showFatal(`That shared link could not be read: ${err.message}`);
  }
})();

// splitter
(() => {
  let dragging = false;
  const vertical = () => window.matchMedia('(max-width: 860px)').matches;
  const apply = (clientPos) => {
    const r = els.split.getBoundingClientRect();
    const frac = vertical() ? (clientPos - r.top) / r.height : (clientPos - r.left) / r.width;
    const pct = Math.min(0.82, Math.max(0.18, frac)) * 100;
    els.split.style.setProperty('--split', `${pct}%`);
    if (vertical()) els.split.style.gridTemplateRows = `${pct}% 7px minmax(0,1fr)`;
  };
  els.gutter.addEventListener('pointerdown', (e) => {
    dragging = true;
    els.gutter.classList.add('dragging');
    els.gutter.setPointerCapture(e.pointerId);
  });
  els.gutter.addEventListener('pointermove', (e) => { if (dragging) apply(vertical() ? e.clientY : e.clientX); });
  els.gutter.addEventListener('pointerup', (e) => {
    dragging = false;
    els.gutter.classList.remove('dragging');
    els.gutter.releasePointerCapture(e.pointerId);
  });
  els.gutter.addEventListener('keydown', (e) => {
    const cur = parseFloat(els.split.style.getPropertyValue('--split')) || 50;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { els.split.style.setProperty('--split', `${Math.max(18, cur - 3)}%`); e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { els.split.style.setProperty('--split', `${Math.min(82, cur + 3)}%`); e.preventDefault(); }
  });
})();

// ------------------------------------------------------- embedding & about
//
// The app is a static page, so embedding it is just an iframe — but two things
// only matter once it is in one. A framed page has no address bar, so "the link
// is in the address bar" is a lie; and it is a pane a few hundred pixels tall,
// so there has to be a way out of it.
(() => {
  const embedCode = () => {
    const src = new URL(location.href);
    src.hash = '';
    return `<iframe src="${src.toString()}" title="Bill Companion" ` +
           `width="100%" height="800" style="border:1px solid #ccc;border-radius:8px" ` +
           `allow="fullscreen" loading="lazy"></iframe>`;
  };
  if (els.embedSnippet) els.embedSnippet.textContent = embedCode();

  if (EMBEDDED && els.fullBtn) els.fullBtn.hidden = false;

  els.fullBtn?.addEventListener('click', async () => {
    // Fullscreen only works if the host wrote allow="fullscreen" on the iframe.
    // When it didn't, the promise rejects and the honest fallback is a new tab —
    // silently doing nothing would look like a broken button.
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen();
    } catch {
      const url = new URL(location.href);
      window.open(url.toString(), '_blank', 'noopener');
    }
  });

  const openAbout = () => { els.aboutModal.hidden = false; els.aboutOk.focus(); };
  const closeAbout = () => { els.aboutModal.hidden = true; };
  els.aboutBtn?.addEventListener('click', openAbout);
  els.aboutOk?.addEventListener('click', closeAbout);
  els.aboutModal?.addEventListener('click', (e) => { if (e.target === els.aboutModal) closeAbout(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.aboutModal && !els.aboutModal.hidden) closeAbout();
  });

  els.embedCopy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(embedCode());
      els.embedCopy.textContent = 'Copied';
      setTimeout(() => { els.embedCopy.textContent = 'Copy embed code'; }, 1600);
    } catch {
      // Clipboard needs a secure context; select the snippet so ⌘C works.
      const r = document.createRange();
      r.selectNodeContents(els.embedSnippet);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      els.embedCopy.textContent = 'Press Ctrl/⌘-C';
    }
  });
})();

// theme
(() => {
  const saved = localStorage.getItem('bc-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  els.themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('bc-theme', next);
  });
})();

// Must be the LAST statement in the module: it tells the boot diagnostic in
// index.html that the whole graph evaluated and every listener above is
// attached. Anything placed after this could throw and still report success.
window.__bcReady = true;
