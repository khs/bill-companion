// Left pane: the bill, with citations spliced in as clickable chips.
//
// PDFs give us hard-wrapped lines, which read badly as one <p> each. We regroup
// them into paragraphs, but only ever replace a '\n' with a single ' ' — same
// character count — so every citation offset computed against the raw text stays
// valid and no offset remapping table is needed.

import { isWrappedMarkerLine } from '../parse/outline.js';
import { isHeadingContinuationLine } from '../parse/bill.js';

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
const RE_DIV = /^\s*(DIVISION\s+[A-Z0-9]+|TITLE\s+[IVXLC]+|Subtitle\s+[A-Z]|CHAPTER\s+[IVXLC0-9]+)\s*(?:--|[—–-])\s*(.+?)\s*$/;

// A line opening with an outline marker and nothing before it — no quote. A
// quoted marker opens a block of inserted statute and always starts a
// paragraph; a bare one only does when it is a real marker rather than the
// tail of a reference that wrapped across the measure.
const RE_BARE_MARKER = /^\s*\([A-Za-z0-9]{1,8}\)/;

/**
 * Group the raw text into paragraph ranges over the original offsets.
 *
 * Paragraph boundaries are decided purely by the text's own shape. A citation
 * that happens to straddle one is the renderer's problem, not this function's —
 * bending boundaries to keep chips whole cost section headings their `#sec-N`
 * anchors, which is a worse bug than a chip ending a line early.
 */
function paragraphs(text, secByStart) {
  const out = [];
  const lines = text.split('\n');
  let cur = null;
  let off = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = off;
    const end = off + line.length;
    off = end + 1;

    if (!line.trim()) { cur = null; continue; }

    // A heading that ran past the measure keeps its tail in the same paragraph,
    // so it is styled as the one heading it is rather than breaking into a
    // caps-locked orphan line of body text underneath. A section heading closes
    // with a period and a division heading closes at the blank line, which is
    // why only the first stops on its own.
    if (cur && cur.head && !cur.runIn && !cur.headDone && isHeadingContinuationLine(line, cur.text)) {
      cur.end = end;
      cur.text += /-$/.test(cur.text) ? line.trim() : ` ${line.trim()}`;
      if (cur.terminated && /\.\s*$/.test(cur.text)) cur.headDone = true;
      continue;
    }

    // parseBill is the authority on what a section is. Re-deriving it from a
    // regex here meant the two could disagree, and they did the moment
    // appropriations headings were recognised: parseBill found 648 sections in
    // H.J. Res. 31 that this pattern, being caps-only, rendered as body text —
    // no heading style, no #sec-N anchor, and a jump menu pointing at nothing.
    const sec = secByStart.get(start);
    const isHead = !!sec || RE_DIV.test(line);
    // "…A point of order under paragraph" / "(1) may be raised by a Senator…":
    // the marker is the tail of a wrapped cross-reference, not a new item.
    // Breaking there cut a sentence in half and dressed the back half up as an
    // enumerated provision. See app/parse/outline.js.
    const wrapped =
      RE_BARE_MARKER.test(line) && isWrappedMarkerLine(i > 0 ? lines[i - 1] : null, line);
    // Start a fresh paragraph on a heading, on an enumerator, or when the
    // previous line ended in a way that closes a sentence block.
    // `cur.head` closes a heading paragraph after one line — right for a real
    // heading, wrong for a run-in one, whose next line is the same sentence
    // carrying on.
    if (!cur || isHead || (RE_PARA_START.test(line) && !wrapped) || (cur.head && !cur.runIn)) {
      const hm = line.match(RE_HEAD);
      cur = {
        start, end, head: isHead, line, sec,
        // A run-in heading carries the provision's own first sentence, so the
        // lines after it are that sentence continuing and must not be split off.
        runIn: !!(sec && sec.runIn),
        // Accumulated heading text and whether it has already closed, so the
        // continuation test above knows when to stop. Only a SEC. heading
        // carries its own terminator.
        text: hm ? hm[3] : line,
        terminated: !!hm,
        headDone: hm ? /\.\s*$/.test(hm[3]) : false,
      };
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

  // A heading paragraph begins at exactly the offset parseBill recorded for the
  // section, which is what lets the breadcrumb find its own section.
  const secByStart = new Map(bill.sections.map((s) => [s.start, s]));

  // How far the previous paragraph actually drew to. A chip whose citation
  // overruns a paragraph boundary is rendered whole by that paragraph, so the
  // next one must resume past it rather than redraw the overlap.
  let consumed = 0;

  // Section numbers a `sec-N` id has already been spent on.
  const seenNums = new Set();

  for (const para of paragraphs(text, secByStart)) {
    if (consumed >= para.end) continue; // wholly absorbed by an overrunning chip
    const sec = para.sec;
    // RE_DIV is matched against the paragraph's FIRST line, never the whole of
    // it: it is `$`-anchored with no `m` flag, so a heading that absorbed its
    // wrapped tail stops matching as a whole string. The symptom is not an
    // error but a heading silently rendered as body text.
    const divMatch = sec ? null : para.line.match(RE_DIV);

    const p = document.createElement('p');
    // The paragraph's span in the source text. Internal cross-references resolve
    // to an offset rather than to an element, so this is what lets a click on
    // "subparagraph (C)" find the paragraph holding it. Offsets are already the
    // currency everywhere else here; publishing them costs two attributes.
    p.dataset.start = String(para.start);
    p.dataset.end = String(para.end);
    if (sec) {
      p.className = sec.runIn ? 'sec-head run-in' : 'sec-head';
      // A bill can number two sections alike — every division of an
      // appropriations act restarts at 101 — so `sec-N` is not unique and
      // getElementById returns whichever came first. The unique id parseBill
      // already assigns goes on a data attribute, and the jump menu uses that;
      // `sec-N` stays for the first of each number so existing anchors still
      // resolve.
      p.dataset.sec = sec.id;
      if (!seenNums.has(sec.num)) { p.id = `sec-${sec.num}`; seenNums.add(sec.num); }
      // Where this section sits. A bill restarts its title numbering inside
      // every division, so the heading alone does not say: "SEC. 123" under
      // "TITLE III" is one of three title IIIs in the Fiscal Responsibility
      // Act. Rendered inside the heading paragraph rather than before it, so
      // the #sec-N anchor still scrolls to something that includes it and the
      // amendments-only filter keeps it with its heading.
      if (sec.ancestors && sec.ancestors.length) p.appendChild(whereEl(sec.ancestors));
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
    // More than one may open here, and taking only the first silently drops the
    // rest. An appropriations proviso chains instructions after a colon — the
    // shape AMEND_BOUNDARY learned to see in TODO 2 — so two, three or four
    // amendments routinely begin inside one rendered paragraph, and each of the
    // later ones contributed no "▸ amends …" tag and no op chips. 6 across the
    // corpus, on 3 of 30 bills. The block is per PARAGRAPH (there is one
    // paragraph to wrap) and the tag is per AMENDMENT, which is what the reader
    // counts and what the render test now asserts against.
    const openingAll = amendments.filter((am) => am.start >= para.start && am.start < para.end);
    const covering =
      openingAll[0] || amendments.find((am) => para.start < am.end && para.end > am.start);
    if (covering) {
      p.classList.add('has-amend');
      if (openingAll.length) {
        const wrap = document.createElement('div');
        wrap.className = 'amend';
        for (const amend of openingAll) {
          const tag = document.createElement('div');
          tag.className = 'amend-tag';
          tag.textContent = `▸ amends ${
            amend.target ? inline(amend.target.text) : `${amend.unit} ${amend.section}${amend.subsection}`
          }`;
          // A synthesised target reads exactly like one the bill wrote out, and
          // this tag is where the reader meets the claim. The parser knows the
          // instruction named nothing and where the Act came from instead; saying
          // so here costs one word and stops the inference being read as a quote.
          if (amend.target && amend.target.implied) {
            const from = document.createElement('span');
            from.className = 'amend-implied';
            from.textContent = 'from context';
            from.title = `Not named in this instruction. Supplied by context: ${amend.target.implied}.`;
            tag.appendChild(from);
          }
          tag.setAttribute('role', 'button');
          tag.tabIndex = 0;
          const fire = () => onAmend(amend);
          tag.addEventListener('click', fire);
          tag.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
          });
          wrap.appendChild(tag);
        }
        wrap.appendChild(p);
        for (const amend of openingAll) {
          if (amend.ops.length) wrap.appendChild(opChips(amend.ops));
        }
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
    a.textContent = inline(text.slice(s, e));
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

/**
 * The chain of divisions and titles enclosing a section, outermost first.
 *
 * Deliberately not clickable. The right-hand pane's crumbs navigate the
 * provision tree of the Code; this one states a fact about the bill already on
 * screen, and a control that only ever scrolls a few lines up is not worth
 * teaching the reader to expect.
 */
function whereEl(ancestors) {
  const el = document.createElement('span');
  el.className = 'sec-where';
  ancestors.forEach((a, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      el.appendChild(sep);
    }
    el.appendChild(document.createTextNode(`${a.label} — ${a.heading}`));
  });
  return el;
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

/**
 * Bill text, ready to be read as prose.
 *
 * A bill is hard-wrapped at about 72 columns AND indents its continuation
 * lines, so a phrase broken across the measure carries both the break and the
 * next line's indentation:
 *
 *     the Balanced Budget and \n      Emergency Deficit Control Act
 *     the Small \n              Business Administration
 *
 * Replacing only the newline left "and       Emergency" and "Small
 * Business Administration" with six stray spaces through the middle of a
 * phrase — which `white-space: pre-wrap` then faithfully renders, because the
 * spaces really are in the source.
 *
 * The whole run collapses to one space. Runs NOT touching a line break are
 * left alone: govinfo double-spaces after a colon ("available:  Provided"),
 * and that is the drafter's typography rather than an artifact of the measure.
 *
 * Leading indentation at the start of a slice survives, because nothing
 * precedes it — that is the paragraph's own indent, which carries the outline
 * level and is worth keeping.
 *
 * This changes the rendered length, which the offset invariant used to forbid.
 * It is safe here and only here: the transform is applied to each slice AFTER
 * it has been cut, so every offset used to cut it was computed against the
 * untouched source. Nothing maps a rendered position back to an offset —
 * paragraph spans travel as `data-start`/`data-end` attributes, not as
 * character counts. Applying a transform BEFORE slicing is the thing that
 * would desynchronise everything, and is still forbidden.
 */
function inline(s) {
  return s.replace(/[ \t]*\n[ \t]*/g, ' ');
}

function txt(s) {
  return document.createTextNode(inline(s));
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
