// Left pane: the bill, with citations spliced in as clickable chips.
//
// PDFs give us hard-wrapped lines, which read badly as one <p> each. We regroup
// them into paragraphs, but only ever replace a '\n' with a single ' ' — same
// character count — so every citation offset computed against the raw text stays
// valid and no offset remapping table is needed.

// A line opening a quotation starts a new paragraph: that is a block of statute
// the bill is inserting, and running it on into the instruction above it is
// exactly the thing a reader needs kept apart. The quote styles must all be
// here — ``  ‘‘  "  “ — because the source decides which one appears and only
// the doubles were listed. That left every govinfo plain-text and every GPO PDF
// bill with its inserted blocks glued to the preceding paragraph: 209 such
// lines in the sample bill, 509 in the CLARITY Act substitute.
const RE_PARA_START =
  /^\s*(?:\([A-Za-z0-9]{1,8}\)|SECTION\s+\d|SEC\.\s|TITLE\s+[IVXLC]|Subtitle\s+[A-Z]|DIVISION\s+|CHAPTER\s+|``|‘‘|["“]|\d+\.\s)/;
const RE_HEAD = /^\s*(SECTION|SEC\.)\s+(\d+[A-Za-z]*)\.\s*(.*)$/;
const RE_DIV = /^\s*(DIVISION\s+[A-Z0-9]+|TITLE\s+[IVXLC]+|Subtitle\s+[A-Z]|CHAPTER\s+[IVXLC0-9]+)\s*[—–-]\s*(.+?)\s*$/;

/**
 * Group the raw text into paragraph ranges over the original offsets.
 *
 * Paragraph boundaries are decided purely by the text's own shape. A citation
 * that happens to straddle one is the renderer's problem, not this function's —
 * bending boundaries to keep chips whole cost section headings their `#sec-N`
 * anchors, which is a worse bug than a chip ending a line early.
 */
function paragraphs(text) {
  const out = [];
  let cur = null;
  let off = 0;

  for (const line of text.split('\n')) {
    const start = off;
    const end = off + line.length;
    off = end + 1;

    if (!line.trim()) { cur = null; continue; }

    const isHead = RE_HEAD.test(line) || RE_DIV.test(line);
    // Start a fresh paragraph on a heading, on an enumerator, or when the
    // previous line ended in a way that closes a sentence block.
    if (!cur || isHead || RE_PARA_START.test(line) || cur.head) {
      cur = { start, end, head: isHead, line };
      out.push(cur);
    } else {
      cur.end = end;
    }
  }
  return out;
}

/**
 * @param {object} bill      from parseBill()
 * @param {Array}  citations from extractCitations()
 * @param {Array}  amendments from extractAmendments()
 * @param {(c:object)=>void} onCite
 * @param {(a:object)=>void} onAmend
 */
export function renderBill(bill, citations, amendments, onCite, onAmend) {
  const root = document.createElement('div');
  root.className = 'billtext';
  const text = bill.text;

  const byStart = citations.slice().sort((a, b) => a.start - b.start);
  let ci = 0;

  // How far the previous paragraph actually drew to. A chip whose citation
  // overruns a paragraph boundary is rendered whole by that paragraph, so the
  // next one must resume past it rather than redraw the overlap.
  let consumed = 0;

  for (const para of paragraphs(text)) {
    if (consumed >= para.end) continue; // wholly absorbed by an overrunning chip
    const raw = text.slice(para.start, para.end);
    const headMatch = raw.match(RE_HEAD);
    const divMatch = raw.match(RE_DIV);

    const p = document.createElement('p');
    // The paragraph's span in the source text. Internal cross-references resolve
    // to an offset rather than to an element, so this is what lets a click on
    // "subparagraph (C)" find the paragraph holding it. Offsets are already the
    // currency everywhere else here; publishing them costs two attributes.
    p.dataset.start = String(para.start);
    p.dataset.end = String(para.end);
    if (headMatch) {
      p.className = 'sec-head';
      p.id = `sec-${headMatch[2]}`;
    } else if (divMatch) {
      p.className = 'div-head';
    }

    // The bill's own quoted operands are NOT marked green and red here. Painting
    // them in this pane says only "the bill quotes this phrase", which the quote
    // marks already say — it does not show what the law becomes, and reading it
    // as a diff of the law is actively misleading, since the struck phrase is
    // shown in the colour of a thing being added to the page in front of you.
    // The diff belongs on the provision in the right-hand pane, drawn into the
    // current text of the law, where red is language leaving the statute book
    // and green is language entering it. See app/ui/redline.js.
    let cursor = Math.max(para.start, consumed);
    if (cursor < para.end) cursor = renderRange(p, text, cursor, para.end, byStart, onCite);
    consumed = cursor;
    void ci;

    // Two distinct questions, and conflating them loses most of the blocks:
    //   "opening" — does an amendment BEGIN in this paragraph? (gets the header)
    //   "covering" — does this paragraph sit inside one? (gets the styling)
    // Amendment ranges are contiguous, so a paragraph routinely straddles the
    // boundary between two. Asking only for the first overlap then returns the
    // *previous* amendment, whose start isn't in this paragraph, and the header
    // is never emitted.
    const opening = amendments.find((am) => am.start >= para.start && am.start < para.end);
    const covering = opening || amendments.find((am) => para.start < am.end && para.end > am.start);
    if (covering) {
      p.classList.add('has-amend');
      if (opening) {
        const amend = opening;
        const wrap = document.createElement('div');
        wrap.className = 'amend';
        const tag = document.createElement('div');
        tag.className = 'amend-tag';
        tag.textContent = `▸ amends ${amend.target ? amend.target.text : `${amend.unit} ${amend.section}${amend.subsection}`}`;
        tag.setAttribute('role', 'button');
        tag.tabIndex = 0;
        const fire = () => onAmend(amend);
        tag.addEventListener('click', fire);
        tag.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
        });
        wrap.appendChild(tag);
        wrap.appendChild(p);
        if (amend.ops.length) wrap.appendChild(opChips(amend.ops));
        root.appendChild(wrap);
        continue;
      }
    }
    root.appendChild(p);
  }

  return root;
}

/**
 * Render text[from,to) into `parent`, splicing in the citation chips it covers.
 *
 * Returns the offset actually consumed, which can exceed `to`: a citation whose
 * start falls inside this range is rendered *whole*, even if it runs past the
 * end. Clipping it instead would emit the same citation once on each side of the
 * boundary — two half-chips, both clickable, for one citation. Callers thread the
 * returned cursor forward so the overrun is not drawn twice.
 */
function renderRange(parent, text, from, to, cites, onCite) {
  let cursor = from;
  for (const c of cites) {
    if (c.end <= cursor) continue;
    if (c.start >= to) break;
    if (c.start < cursor) continue; // already drawn as part of an earlier chip
    const s = c.start;
    const e = c.end;
    if (s > cursor) parent.appendChild(txt(text.slice(cursor, s)));
    const a = document.createElement('a');
    // Composed addresses ("in clause (iv)") get a dashed underline: they resolve
    // like any other cite, but the address was inferred from the enclosing
    // instruction rather than written out in the bill.
    a.className = `cite cite-${c.kind}${c.relative ? ' rel' : ''}`;
    a.textContent = text.slice(s, e).replace(/\n/g, ' ');
    a.dataset.cid = c.id;
    a.tabIndex = 0;
    a.setAttribute('role', 'button');
    a.title = describe(c);
    a.addEventListener('click', (ev) => { ev.preventDefault(); onCite(c, a); });
    a.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onCite(c, a); }
    });
    parent.appendChild(a);
    cursor = e;
  }
  if (cursor < to) {
    parent.appendChild(txt(text.slice(cursor, to)));
    cursor = to;
  }
  return cursor;
}

function opChips(ops) {
  const row = document.createElement('div');
  row.className = 'amend-ops';
  const counts = new Map();
  for (const o of ops) counts.set(o.type, (counts.get(o.type) || 0) + 1);
  for (const [type, n] of counts) {
    const s = document.createElement('span');
    s.className = `op op-${type}`;
    s.textContent = n > 1 ? `${type} ×${n}` : type;
    row.appendChild(s);
  }
  return row;
}

function txt(s) {
  return document.createTextNode(s.replace(/\n/g, ' '));
}

function describe(c) {
  switch (c.kind) {
    case 'usc': return `U.S. Code — title ${c.title}, section ${c.section}${c.subsection}`;
    case 'cfr': return `Code of Federal Regulations — title ${c.title}, ${c.section ? `section ${c.section}` : `part ${c.part}`}`;
    case 'publaw': return `Public Law ${c.congress}-${c.law}`;
    case 'stat': return `${c.volume} Stat. ${c.page}`;
    case 'act': return c.act.name;
    case 'internal': return 'Cross-reference within this bill';
    default: return c.text;
  }
}
