// Export: the reading session as one self-contained HTML file.
//
// The point is a snapshot that keeps working — in a ticket, in an email
// attachment, on a laptop with no network, in five years when the Code has
// moved on. So the file it writes has three properties, and each of them is a
// constraint on how it is built:
//
//   · it makes no requests. No <link>, no <script src>, no fonts, no images.
//     The app's stylesheet is inlined and its fonts are system stacks already;
//     the favicon is a data URI. Everything the page needs is in the file.
//   · it does not change. Every citation is resolved *now* and its provision
//     baked in. The live app reads the Code as it stands today, which is the
//     right behaviour there and the wrong one for a record of what a bill said
//     against the law it was written to change.
//   · it is the same view. The exported page is the app's own markup and the
//     app's own stylesheet, so the bill reads the way it read on screen, with
//     its chips and its amendment blocks intact.
//
// What it cannot keep is anything that needed a server: the eCFR is live, so a
// CFR citation exports the text it had at the moment of export and says so.

/** Serialise every stylesheet the page is using. */
function inlineCss() {
  const out = [];
  for (const sheet of document.styleSheets || []) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet cannot be read. There are none in this app, and if
      // one ever appears the export should lose its styling rather than
      // silently reach out to the network when opened.
      continue;
    }
    for (const rule of rules || []) out.push(rule.cssText);
  }
  return out.join('\n');
}

/**
 * The distinct provisions a bill's citations point at.
 *
 * Keyed the way resolve() keys its own cache, because the same provision is
 * cited many times over in a bill and rendering it once per citation would
 * multiply the file size by the repetition rate — 326 citations in the Fiscal
 * Responsibility Act reach far fewer distinct provisions.
 */
function contextKey(c) {
  return [c.kind, c.title, c.part, c.section, c.subsection, c.congress, c.law,
          c.volume, c.page, c.act && c.act.name, c.actSection, c.division]
    .filter(Boolean)
    .join('|');
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/**
 * Build the export.
 *
 * @param {object}   o.bill        from parseBill()
 * @param {Array}    o.citations   the citations drawn in the bill pane
 * @param {Element}  o.billEl      the rendered bill pane, as the reader sees it
 * @param {Function} o.resolve     (cite) => Promise<resolved>
 * @param {Function} o.renderContext (res, handlers) => Element
 * @param {Function} [o.onProgress] (done, total) => void
 */
export async function buildExport({ bill, citations, billEl, resolve, renderContext, onProgress }) {
  const wanted = new Map();
  for (const c of citations || []) {
    const key = contextKey(c);
    if (key && !wanted.has(key)) wanted.set(key, c);
  }

  const panels = [];
  const keyed = new Map();
  let done = 0;
  for (const [key, cite] of wanted) {
    let html = '';
    try {
      const res = await resolve(cite);
      // No handlers: every control in the exported page would need code behind
      // it, and a button that does nothing is worse than no button.
      const el = renderContext({ ...res }, {});
      html = el.innerHTML;
    } catch (err) {
      html = `<div class="card err"><h4>Could not resolve</h4><p>${escapeHtml(err.message || String(err))}</p></div>`;
    }
    const id = `ctx${panels.length}`;
    keyed.set(key, id);
    panels.push(`<div class="ctxpanel" id="${id}" hidden>${html}</div>`);
    onProgress?.(++done, wanted.size);
  }

  // A copy of the bill pane, with each chip pointed at the panel it opens.
  const clone = billEl.cloneNode(true);
  const byId = new Map((citations || []).map((c) => [c.id, c]));
  for (const chip of clone.querySelectorAll('.cite')) {
    const c = byId.get(chip.dataset.cid);
    const id = c && keyed.get(contextKey(c));
    if (id) chip.setAttribute('data-ctx', id);
    else chip.classList.add('cite-dead');
  }

  const title = bill.meta.shortTitle || bill.meta.designation || 'Bill';
  const stamp = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Bill Companion export</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='14'>&#167;</text></svg>">
<style>
${inlineCss()}
/* Export-only: the app's chrome is interactive and this page is not. */
.exporthead {
  padding: 10px 14px; border-bottom: 1px solid var(--rule); background: var(--panel);
  display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap;
}
.exporthead .t { font-weight: 650; }
.exporthead .s { font-size: 12px; color: var(--ink-faint); }
.cite-dead { cursor: default; }
.ctxempty { color: var(--ink-faint); font-size: 13px; }
</style>
<div class="exporthead">
  <span class="t">${escapeHtml(title)}</span>
  <span class="s">Snapshot taken ${stamp} · the law as it stood that day · nothing here loads from the network</span>
</div>
<div class="split" style="--split:1fr">
  <section class="pane pane-bill">
    <div class="pane-head"><h2>Bill</h2></div>
    <div class="pane-body" id="billbody">${clone.outerHTML}</div>
  </section>
  <div class="gutter"></div>
  <section class="pane pane-ctx">
    <div class="pane-head"><h2>Law</h2></div>
    <div class="pane-body" id="ctxbody">
      <p class="ctxempty">Select a citation in the bill to see the provision it points at.</p>
      ${panels.join('\n')}
    </div>
  </section>
</div>
<script>
(function () {
  var body = document.getElementById('ctxbody');
  var empty = body.querySelector('.ctxempty');
  var open = null;
  document.getElementById('billbody').addEventListener('click', function (ev) {
    var chip = ev.target.closest ? ev.target.closest('.cite') : null;
    if (!chip) return;
    ev.preventDefault();
    var id = chip.getAttribute('data-ctx');
    if (!id) return;
    if (open) { open.hidden = true; open.classList.remove('active'); }
    var panel = document.getElementById(id);
    if (!panel) return;
    panel.hidden = false;
    open = panel;
    if (empty) empty.hidden = true;
    var prev = document.querySelector('.cite.active');
    if (prev) prev.classList.remove('active');
    chip.classList.add('active');
    body.scrollTop = 0;
  });
})();
</script>
`;
}
