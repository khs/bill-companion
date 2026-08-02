// Internal cross-references — "subparagraph (C)", "section 4(a) of this Act".
//
// These resolve *within the bill*, not against the Code, which is why they never
// had a resolver: there is nothing to fetch. But they are the single most common
// citation kind in a modern bill — 162 of the 164 internal refs in the CLARITY
// Act's House print are the bare "clause (ii)" form — and answering a click on
// one with "Points at another part of the provision currently being amended" is
// a restatement of the words the reader just clicked. What they want is to be
// shown the provision.
//
// Almost all of them sit inside a block of quoted new law the bill is inserting,
// so the thing referred to is a few lines away in the bill text.

import { sectionAt } from '../parse/bill.js';
import { isWrappedMarker } from '../parse/outline.js';

// Same hierarchy the amendment parser uses, and for the same reason: the unit
// word states the depth outright, which is the only thing that makes a bare
// "(ii)" locatable. See UNIT_DEPTH in app/parse/citations.js.
const UNIT_DEPTH = {
  subsection: 0,
  paragraph: 1,
  subparagraph: 2,
  clause: 3,
  subclause: 4,
  item: 5,
  subitem: 6,
};

/**
 * How deep is a marker, judged by its own style?
 *
 * US statutory drafting numbers each level differently — (a), (1), (A), (i),
 * (I), (aa), (AA) — so the style alone gives the depth. That matters because
 * indentation does not survive PDF extraction: every line in a typeset bill
 * comes back flush left, so nesting cannot be read from the layout.
 *
 * (i), (v) and (x) are genuinely ambiguous between a letter and a roman
 * numeral, and nothing here can settle it — "(i)" following "(h)" is a
 * subsection, "(i)" following "(A)" is a clause. Read as roman, which is the
 * commoner case by a wide margin at the depths these references appear.
 */
export function markerDepth(marker) {
  const s = marker.slice(1, -1);
  if (/^\d+$/.test(s)) return UNIT_DEPTH.paragraph;
  if (/^[IVXLC]{2,}$/.test(s)) return UNIT_DEPTH.subclause;
  if (/^[ivxlc]{2,}$/.test(s)) return UNIT_DEPTH.clause;
  if (/^[a-z]{2}$/.test(s)) return UNIT_DEPTH.item;
  if (/^[A-Z]{2}$/.test(s)) return UNIT_DEPTH.subitem;
  if (/^[ivx]$/.test(s)) return UNIT_DEPTH.clause;
  if (/^[IVX]$/.test(s)) return UNIT_DEPTH.subclause;
  if (/^[a-z]$/.test(s)) return UNIT_DEPTH.subsection;
  if (/^[A-Z]$/.test(s)) return UNIT_DEPTH.subparagraph;
  return UNIT_DEPTH.subparagraph;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A marker at the head of a line. The quote openers are load-bearing: inserted
// statutory text is quoted, so its outline markers sit behind one —
// ``(C) The term …'' — and a pattern anchored on whitespace alone finds none of
// the ones that matter. All four conventions, as everywhere else here.
const LINE_HEAD = '(?:^|\\n)[ \\t]*(?:``|‘‘|["“])?[ \\t]*';

/**
 * Every line-start marker in [from, to), with its offset and depth.
 *
 * Markers that are only there because a reference wrapped across the 72-column
 * measure are skipped — see app/parse/outline.js. They are indistinguishable by
 * shape from real ones, and leaving them in gives the enclosing provision a
 * phantom sibling that steals every later reference to the real marker.
 */
function outline(text, from, to) {
  const re = new RegExp(`${LINE_HEAD}(\\([A-Za-z0-9]{1,8}\\))(?=[ \\t\\n]|$)`, 'g');
  const out = [];
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) && m.index < to) {
    const at = m.index + m[0].lastIndexOf(m[1]);
    if (isWrappedMarker(text, at)) {
      re.lastIndex = Math.max(re.lastIndex, at + m[1].length);
      continue;
    }
    out.push({ at, marker: m[1], depth: markerDepth(m[1]) });
    // Overlapping line starts are impossible, but a zero-width step is not.
    re.lastIndex = Math.max(re.lastIndex, at + m[1].length);
  }
  return out;
}

/** Offsets in [from, to) where a line begins with exactly `marker`. */
function markerStarts(text, from, to, marker) {
  return outline(text, from, to).filter((o) => o.marker === marker).map((o) => o.at);
}

/** The markers in a path: "(b)(1)" -> ["(b)", "(1)"]. */
function markersOf(path) {
  return String(path || '').match(/\([A-Za-z0-9]{1,8}\)/g) || [];
}

/**
 * The span of the provision that encloses `offset` at a depth above `depth`.
 *
 * Walks back to the nearest line-start marker shallower than the reference, then
 * forward to the next marker at that same level or shallower. That span is the
 * parent, and the referenced sibling is inside it.
 *
 * This is the whole correctness argument. Choosing the *nearest* matching marker
 * instead looks reasonable and is wrong in exactly the cases that matter: in
 * "(B) ASSOCIATED PERSON OF A DIGITAL COMMODITY DEALER — (i) IN GENERAL. Except
 * as provided in clause (ii)", the nearest "(ii)" is the one belonging to the
 * *broker* subparagraph above, and the one meant is below. Direction is not a
 * tiebreak either — references point forward as often as back.
 */
function parentSpan(text, from, to, offset, depth) {
  const marks = outline(text, from, to);
  let start = from;
  let parentDepth = -1;
  for (const m of marks) {
    if (m.at >= offset) break;
    if (m.depth < depth) { start = m.at; parentDepth = m.depth; }
  }
  let end = to;
  for (const m of marks) {
    if (m.at <= start) continue;
    if (m.depth <= parentDepth) { end = m.at; break; }
  }
  return { start, end };
}

/**
 * Where does this internal reference point, as an offset into the bill text?
 *
 * @param {object} bill  from parseBill()
 * @param {object} cite  an `internal` citation
 * @returns {{start:number, label:string, why:string, section:object|null}|null}
 */
export function locateInternal(bill, cite) {
  const text = bill.text;

  // "section 4(a) of this Act" / "section 3 of this title" — a section of the
  // bill itself, which we can name exactly.
  if (cite.refType === 'section' && cite.section) {
    const sec = bill.sections.find((s) => s.num === cite.section);
    if (!sec) return null;
    let start = sec.start;
    let why = `Section ${cite.section} of this bill.`;
    if (cite.subsection) {
      const hits = walk(text, sec.start, sec.end, markersOf(cite.subsection));
      if (hits.length) {
        start = hits[0];
        why = `Section ${cite.section}${cite.subsection} of this bill.`;
      }
    }
    return { start, label: `Sec. ${sec.num}. ${sec.heading}`, why, section: sec };
  }

  // "subparagraph (C)" — a sibling within the provision this reference sits in.
  const sec = sectionAt(bill, cite.start);
  if (!sec) return null;
  const marks = markersOf(cite.subsection);
  if (!marks.length) return null;

  const depth = UNIT_DEPTH[cite.refType] ?? markerDepth(marks[0]);
  const scope = parentSpan(text, sec.start, sec.end, cite.start, depth);
  let hits = walk(text, scope.start, scope.end, marks).filter((i) => i < cite.start || i > cite.end);
  let scoped = true;
  if (!hits.length) {
    // Nothing at this level — the reference may reach outside its own parent, or
    // the outline may not have survived extraction. Widen to the bill section
    // rather than giving up, and say so.
    hits = walk(text, sec.start, sec.end, marks).filter((i) => i < cite.start || i > cite.end);
    scoped = false;
  }
  if (!hits.length) return null;

  // Within the right parent there is normally exactly one. Where the outline
  // repeats, the nearest is the best available guess and the pane says so.
  const at = hits.reduce((b, o) => (Math.abs(o - cite.start) < Math.abs(b - cite.start) ? o : b), hits[0]);

  return {
    start: at,
    label: `${cite.refType || 'reference'} ${cite.subsection}`,
    why: scoped
      ? hits.length > 1
        ? `The nearest ${marks[marks.length - 1]} inside the enclosing provision, which has ${hits.length}.`
        : `The only ${marks[marks.length - 1]} inside the enclosing provision.`
      : `No ${marks[marks.length - 1]} inside the enclosing provision, so this is the nearest one in the section.`,
    section: sec,
    ambiguous: hits.length > 1 || !scoped,
  };
}

/** Follow a marker path down the outline, returning every offset it reaches. */
function walk(text, from, to, marks) {
  let spans = [{ start: from, end: to }];
  let hits = [];
  for (let i = 0; i < marks.length; i++) {
    hits = [];
    for (const sp of spans) hits.push(...markerStarts(text, sp.start, sp.end, marks[i]));
    if (!hits.length) return [];
    if (i === marks.length - 1) break;
    // Descend: the next marker must be inside this one's own subtree, which runs
    // until the next marker at the same level or shallower.
    const d = markerDepth(marks[i]);
    spans = hits.map((h) => {
      const after = outline(text, h + 1, to).find((m) => m.depth <= d);
      return { start: h, end: after ? after.at : to };
    });
  }
  return hits;
}
