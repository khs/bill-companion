// Outline markers at the head of a line — and the one thing that counterfeits
// them.
//
// Bills hard-wrap at about 72 columns and the wrap lands wherever it lands. A
// cross-reference broken across one leaves its marker sitting at a line head,
// shaped exactly like a real outline marker:
//
//     (4) Form of point of order.--A point of order under paragraph
//     (1) may be raised by a Senator as provided in section 313(e) of the
//
// That "(1)" is not paragraph (1) of anything. It is the tail of the phrase
// "paragraph (1)", and reading it as an outline marker costs twice over:
//
//   · `app/resolve/internal.js` builds the bill's outline from line-head
//     markers, so the phantom becomes a sibling of the real (1). Every later
//     "paragraph (1)" in the section then resolves to the *nearest* one, which
//     is the phantom — in section 123 of the Fiscal Responsibility Act, two
//     references meaning "(a)(1) In general" landed in the middle of a sentence
//     in paragraph (4) instead.
//   · `app/ui/render-bill.js` starts a new paragraph at a line-head marker, so
//     the phantom splits a sentence in half in the left pane and dresses the
//     back half up as a new enumerated item.
//
// Measured across the 23 plain-text bills in the corpus: 1,093 phantoms out of
// 87,250 line-head markers (1.25%).
//
// The tell is the previous line's last word. A real outline marker follows a
// line that ends a thought — "." or "--" or ";" or "and" or "or". A wrapped one
// follows the unit word that introduces it, standing bare at the line end with
// no punctuation, because in an unwrapped world the punctuation would come
// after the marker, not before it.

// The unit words that introduce an outline marker. "subparagraph" and
// "subclause" fall out of the (?:sub)? prefix; the plural forms are needed for
// "paragraphs\n(1) and (2)", which is 108 of the 1,093 on its own.
//
// Deliberately limited to the units that are *written* as "(x)". "title",
// "division", "chapter" and "part" are cited as "title I", never as "(a)", so
// admitting them would buy nothing and risk a real marker.
const RE_TRAILING_UNIT = /(?:^|[^A-Za-z])(?:sub)?(?:section|paragraph|clause|item)s?$/i;

// A marker at the head of a line, optionally behind a quote opener — inserted
// statutory text is quoted, so the markers that matter sit behind one. All four
// conventions, as everywhere else here.
const LEAD = '[ \\t]*(?:``|‘‘|["“])?[ \\t]*';

/**
 * A run-in heading — "(1) Federal land.--The term ``Federal land'' means …".
 *
 * This is a real outline marker even where the line above it happens to end in
 * a unit word. Exactly one case in the 1,093 needs it, and it is a real one:
 *
 *     (a) Definitions.--In this section
 *         (1) Federal land.--The term ``Federal land'' means all right,
 *
 * (the enrolled text of H.R. 2617 drops the colon after "In this section"). The
 * guard is free in the other direction, because a wrapped reference continues a
 * sentence in lower case and never carries a heading.
 */
const RE_RUN_IN_HEAD = new RegExp(
  `^${LEAD}\\([A-Za-z0-9]{1,8}\\)\\s+[A-Z][A-Za-z0-9 ,'’-]{1,60}\\.\\s*(?:--|[—–])`
);

/** Is this line nothing but whitespace and an optional quote opener before `(`? */
const RE_LEAD_ONLY = new RegExp(`^${LEAD}$`);

/**
 * Does the marker at the head of `line` merely continue a reference that ran
 * off the end of `prevLine`?
 *
 * `prevLine` is the line immediately above — not the nearest non-blank one. A
 * wrap never crosses a blank line, and a blank line is a paragraph break in its
 * own right, so skipping over one could only ever manufacture a false positive.
 */
export function isWrappedMarkerLine(prevLine, line) {
  if (prevLine == null) return false;
  if (RE_RUN_IN_HEAD.test(line)) return false;
  return RE_TRAILING_UNIT.test(prevLine.trimEnd());
}

/**
 * Offset form of the same question: is the marker whose "(" sits at `at` a
 * wrapped continuation rather than a real outline marker?
 *
 * Returns false when `at` is not at a line head at all, so callers that already
 * matched a line-head pattern and callers that did not both get a safe answer.
 */
export function isWrappedMarker(text, at) {
  const nl = text.lastIndexOf('\n', at - 1);
  if (nl < 0) return false; // first line of the bill: nothing wrapped onto it
  if (!RE_LEAD_ONLY.test(text.slice(nl + 1, at))) return false;

  const eol = text.indexOf('\n', at);
  const line = text.slice(nl + 1, eol < 0 ? text.length : eol);
  const prevStart = text.lastIndexOf('\n', nl - 1) + 1;
  return isWrappedMarkerLine(text.slice(prevStart, nl), line);
}

// ---------------------------------------------------------------------------
// Quoted inserted law
// ---------------------------------------------------------------------------

// The four conventions, as everywhere else here, and as PAIRS rather than an
// alternation: a block opened with `` is closed by '' and not by a curly double
// that happens to appear inside it. Same rule readAddedBlock() reads an added
// block by, and deliberately the same spelling — a second one would put the
// parser and the resolver out of step about where new law begins and ends.
const QUOTE_PAIRS = [
  ['``', "''"],
  ['‘‘', '’’'],
  ['“', '”'],
  ['"', '"'],
];

/** A line whose first non-blank characters open a block of quoted law. */
const RE_BLOCK_OPEN = /^[ \t]*(``|‘‘|[“"])/;

// A runaway guard, not a judgement about length: added blocks legitimately run
// to tens of thousands of characters when a bill adds a whole chapter. The same
// number readAddedBlock() uses, for the same reason.
const MAX_QUOTED = 60000;

/** An outline marker at the head of a line INSIDE the quotation. */
const RE_BLOCK_OUTLINE = new RegExp(`(?:^|\\n)${LEAD}\\([A-Za-z0-9]{1,8}\\)[ \\t]`);

// Above this, call it a block whatever it opens with: a quotation this long is
// statutory text however it is punctuated, and a flush added sentence has no
// marker to show for itself. Measured on the corpus, phrase operands run to a
// few hundred characters and blocks to tens of thousands.
const PHRASE_MAX = 400;

let cachedText = null;
let cachedBlocks = null;

/**
 * Every span of quoted inserted law in the bill, in document order.
 *
 * A bill's own sentences and the law it is writing are the same characters in
 * the same file, and telling them apart is not decoration. A cross-reference
 * inside quoted new law — "the table contained in subsection (d)" — belongs to
 * the statute being amended, and answering it with a marker from the bill's own
 * outline names a provision the drafter was not talking about. That is what was
 * happening: 1,336 of these across the corpus were answered with a bill marker
 * outside their own block and reported with no hedge at all, the pane saying
 * "the only (d) inside the enclosing provision" about section 11001(d) of the
 * bill when the citation meant 26 U.S.C. 1(d).
 *
 * A block opens on a line whose first non-blank characters are a quote opener —
 * GPO opens every quoted PARAGRAPH that way and closes only once, at the end of
 * the whole block — and ends at the first matching closer. Where no closer
 * follows, or none within MAX_QUOTED, nothing is claimed: a block that swallowed
 * the rest of the bill would suppress every later reference in it.
 *
 * Memoised on the text itself. One bill is loaded at a time and this is asked
 * once per click.
 */
export function quotedBlocks(text) {
  if (cachedText === text) return cachedBlocks;
  const out = [];
  let off = 0;
  let openTo = 0; // first offset not already inside a block
  for (const line of String(text || '').split('\n')) {
    const lineStart = off;
    off += line.length + 1;
    if (lineStart < openTo) continue;
    const m = line.match(RE_BLOCK_OPEN);
    if (!m) continue;
    const pair = QUOTE_PAIRS.find(([open]) => open === m[1]);
    const openAt = lineStart + m[0].length - m[1].length;
    const close = text.indexOf(pair[1], openAt + m[1].length);
    // No closer anywhere: a stray opener, and claiming from here to the end of
    // the bill would suppress every later reference in it. Nothing is claimed
    // and the scan carries on, so a real block below still opens.
    if (close < 0) continue;
    // A closer past the runaway guard. The block is almost certainly real — a
    // bill that rewrites a whole section of the Code quotes tens of thousands of
    // characters — but this cannot say where it ends, so it claims nothing.
    //
    // The cursor still moves past it, and that is the point. Skipping without
    // advancing left every quoted PARAGRAPH inside such a rewrite opening a
    // block of its own, so a reference was bounded to one paragraph of a
    // 95,000-character provision and the answer sitting 40,000 characters away
    // in the same block could not be reached. Falling back to the whole bill
    // section is the behaviour these had before any of this, and it is honest;
    // a fragment is a boundary this module invented.
    if (close - openAt > MAX_QUOTED) { openTo = close + pair[1].length; continue; }
    const end = close + pair[1].length;
    // A quotation, but not necessarily a BLOCK of new law. A bill hard-wraps at
    // 72 columns, so the operand of a strike lands at a line head whenever the
    // instruction happens to break in front of it:
    //
    //     (iii) in subparagraph (E), by striking
    //   ``subparagraph (B) or (D)'' and inserting ``subparagraph (A) or (C)''
    //
    // 330 of the corpus's 14,694 quoted-law references sit in one of these, and
    // 62 of them in language being STRUCK — so a pane that called all of them
    // "language the bill is inserting" was telling 62 readers the opposite of
    // what the bill does. Both are quotations from the statute and both bound a
    // reference the same way; only the sentence describing them differs.
    //
    // Real new law carries an outline marker at the head of one of its lines,
    // which is the same signal scopeAdditions() reads to decide how deep an
    // addition sits. A phrase lifted out of a sentence carries none.
    const body = text.slice(openAt, end);
    const phrase = !RE_BLOCK_OUTLINE.test(body) && body.length <= PHRASE_MAX;
    out.push(phrase ? { start: openAt, end, phrase: true } : { start: openAt, end });
    openTo = end;
  }
  cachedText = text;
  cachedBlocks = out;
  return out;
}

/** The block of quoted inserted law containing `offset`, or null. */
export function quotedBlockAt(text, offset) {
  return quotedBlocks(text).find((b) => offset >= b.start && offset < b.end) || null;
}

// ---------------------------------------------------------------------------
// Plain statutory text -> the node tree the context pane renders
// ---------------------------------------------------------------------------

/** Semantic depth by marker STYLE, the one signal that survives extraction. */
const DEPTH = { subsection: 1, paragraph: 2, subparagraph: 3, clause: 4, subclause: 5, item: 6, subitem: 7 };

function depthOfMarker(marker) {
  const s = marker.slice(1, -1);
  if (/^\d+$/.test(s)) return DEPTH.paragraph;
  if (/^[IVXLC]{2,}$/.test(s)) return DEPTH.subclause;
  if (/^[ivxlc]{2,}$/.test(s)) return DEPTH.clause;
  if (/^[a-z]{2}$/.test(s)) return DEPTH.item;
  if (/^[A-Z]{2}$/.test(s)) return DEPTH.subitem;
  if (/^[ivx]$/.test(s)) return DEPTH.clause;
  if (/^[IVX]$/.test(s)) return DEPTH.subclause;
  if (/^[a-z]$/.test(s)) return DEPTH.subsection;
  if (/^[A-Z]$/.test(s)) return DEPTH.subparagraph;
  return DEPTH.subparagraph;
}

/** A run of markers at the head of a line: "(a)", "(a)(1)", "``(B)(i)". */
const RE_HEAD_MARKERS = new RegExp(`^${LEAD}((?:\\([A-Za-z0-9]{1,8}\\))+)(?=[ \\t]|$)`);

/** The section head a Public Law prints above its text: "SEC. 2001. TITLE." */
const RE_SEC_HEAD = /^\s*SEC(?:TION)?\.?\s+[0-9]+[A-Za-z]*\.\s*/;

/** A run-in heading — "In General.--", "DEFINITIONS.--" — leading a provision. */
const RE_RUN_IN = /^([A-Z][A-Za-z0-9 ,'’()\-]{1,70}?)\.\s*(?:--|[—–])\s*/;

/**
 * Join the lines of one provision into a paragraph.
 *
 * This is the `inline()` transform from render-bill.js, and it is safe for the
 * same reason: the slice has already been cut, so no offset is computed against
 * the result. A statute hard-wraps at about 72 columns and indents every
 * continuation, so a phrase broken across the measure carries both the newline
 * and the indent — "the Secretary\n        shall" — and rendering that verbatim
 * puts eight spaces through the middle of a sentence.
 *
 * A run of spaces NOT touching a line break is left alone: govinfo double-spaces
 * after a colon, and a table is aligned with runs of spaces. That is the
 * drafter's typography rather than an artifact of the measure.
 */
function joinLines(lines) {
  return lines
    .join('\n')
    // Page furniture from the Statutes at Large rendition, wedged through the
    // middle of sentences: "…as if enacted on February 2, 2020. [[Page 134 STAT.
    // 1923]] If application of this section…". The same class of apparatus as
    // the <<NOTE: …>> markers stripped at ingest, and it is dropped here rather
    // than there only because it costs nothing to do at render and the shipped
    // shards already contain it.
    .replace(/\[\[\s*Page[^\]]*\]\]/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/\s{2,}/g, (m, i, s) => (/[.:]\s*$/.test(s.slice(0, i)) ? m : ' '))
    .replace(/\s+$/, '')
    .trim();
}

/**
 * Parse a section of plain statutory text into the tree the pane renders.
 *
 * `data/plaw` stores each section as the law prints it — hard-wrapped at 72
 * columns, indented by depth, one string. Rendered as that string it is a solid
 * block: 14,852 characters of Pub. L. 117-2 § 2001 with no visible structure,
 * which is exactly what the outline is for. The Code's own sections arrive from
 * USLM already nested, so `nodeEl` has always had a tree to draw; this gives a
 * Public Law the same one, built from the only structure its text carries — the
 * markers at the heads of its lines.
 *
 * Everything here defers to the module's existing rules rather than restating
 * them: a marker is skipped when `isWrappedMarkerLine` says it is only there
 * because a reference ran off the measure, and a RUN of markers on one line
 * ("(B)(i) The President may waive") opens two provisions, not one — the same
 * correction `outline()` in internal.js needed.
 *
 * @returns {Array} nodes shaped like the USLM tree: {marker, path, heading,
 *   text, children}.
 */
export function parseProvision(text) {
  const root = { marker: '', path: '', heading: '', lines: [], children: [], depth: 0 };
  const stack = [root];
  let cur = root;
  const lines = String(text || '').split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // The section head is the entry's own heading and is shown above the text.
    if (i === 0 && RE_SEC_HEAD.test(line)) {
      line = line.replace(RE_SEC_HEAD, '');
      // Its own heading may wrap onto the following lines; those are consumed
      // until the line that ends it with a period.
      while (!/\.\s*$/.test(line) && i + 1 < lines.length && lines[i + 1].trim()) {
        line += ` ${lines[++i].trim()}`;
      }
      continue;
    }
    if (!line.trim()) { cur.lines.push(''); continue; }

    const m = RE_HEAD_MARKERS.exec(line);
    if (!m || isWrappedMarkerLine(i > 0 ? lines[i - 1] : null, line)) {
      cur.lines.push(line);
      continue;
    }

    const markers = m[1].match(/\([A-Za-z0-9]{1,8}\)/g) || [];
    let rest = line.slice(m[0].length);
    for (let k = 0; k < markers.length; k++) {
      const marker = markers[k];
      const depth = depthOfMarker(marker);
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const node = {
        marker,
        path: parent.path + marker,
        heading: '',
        lines: [],
        children: [],
        depth,
      };
      parent.children.push(node);
      stack.push(node);
      cur = node;
      // Only the innermost marker of a run carries the line's text.
      if (k === markers.length - 1) cur.lines.push(rest);
      rest = '';
    }
  }

  const finish = (n) => {
    n.text = joinLines(n.lines);
    const h = RE_RUN_IN.exec(n.text);
    if (h) {
      n.heading = h[1];
      n.text = n.text.slice(h[0].length);
    }
    delete n.lines;
    delete n.depth;
    n.children.forEach(finish);
    return n;
  };
  finish(root);

  // Text before the first marker is the provision's lead-in and has no marker
  // of its own. It is a node so the renderer has one shape to draw.
  const out = [];
  if (root.text) out.push({ marker: '', path: '', heading: root.heading, text: root.text, children: [] });
  return out.concat(root.children);
}
