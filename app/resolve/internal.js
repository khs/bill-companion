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
export function outline(text, from, to) {
  // A RUN of markers, not one. A drafter opens a subparagraph and its first
  // clause on the same line — "(B)(i) The President may waive …" — and matching
  // a single marker with a whitespace lookahead found *neither*: `(B)` fails
  // because the next character is `(`, and `(i)` is not at a line head. 887 such
  // pairs across the corpus, and every provision opened this way was invisible
  // to `parentSpan` and `walk`, so a reference to "clause (i) of this
  // subparagraph" found nothing in its parent and fell through to the nearest
  // match anywhere in the section — 5,594 characters away, onto a *subsection*
  // letter, in the case that reported this.
  //
  // Both markers have to be emitted, at their own depths and their own offsets.
  // Revealing only the first is worse than revealing neither: the parent becomes
  // findable while the child it introduces stays missing, so the walk now has a
  // scope to search and still cannot find the thing in it.
  const re = new RegExp(`${LINE_HEAD}((?:\\([A-Za-z0-9]{1,8}\\))+)(?=[ \\t\\n]|$)`, 'g');
  const out = [];
  // Start at the head of the line `from` sits on, not at `from` itself.
  //
  // LINE_HEAD is anchored `(?:^|\n)` with no `m` flag, so past offset 0 only a
  // literal newline can begin a match — and setting lastIndex to `from` puts the
  // engine PAST the newline that introduces `from`'s own line. That was harmless
  // while every caller passed a section boundary, which is a line start. It stops
  // being harmless the moment a caller passes a quoted block, because a block
  // begins mid-line at its quote opener and its own first marker sits two
  // characters later:
  //
  //     ``(A) In general.--The Secretary shall …
  //     ``(B) Exception.--Subparagraph (A) shall not apply …
  //
  // (A) was unreachable, so "subparagraph (A)" — the commonest reference there
  // is in inserted law, a provision referring to the one that opens the block it
  // sits in — found nothing and declined. 185 of hr1892's 185 marker-opening
  // blocks were affected: all of them.
  //
  // Markers that begin before `from` are then dropped, which is what keeps the
  // bounding honest: the bill's own sub-instruction marker at the head of that
  // same line ("(3) in paragraph (2), by striking ``(A) …") is outside the block
  // and must stay outside it.
  // The newline ITSELF, not the character after it: the pattern has to consume
  // it to match at all. -1 (no newline above) becomes 0, where `^` does the job.
  re.lastIndex = Math.max(0, text.lastIndexOf('\n', from));
  let m;
  while ((m = re.exec(text)) && m.index < to) {
    const at = m.index + m[0].lastIndexOf(m[1]);
    const end = at + m[1].length;
    if (end <= from) { re.lastIndex = Math.max(re.lastIndex, end); continue; }
    // The wrap test asks about the line head, so it is the run's first marker
    // that answers it — the rest are not at a line head at all and cannot be
    // there because a reference broke across the measure.
    if (isWrappedMarker(text, at)) {
      re.lastIndex = Math.max(re.lastIndex, end);
      continue;
    }
    let off = at;
    for (const marker of m[1].match(/\([A-Za-z0-9]{1,8}\)/g) || []) {
      // A run may straddle the boundary — "(3) in paragraph (2)" is the bill's,
      // but a quoted "``(l)(1)" opening a block is the block's own pair.
      if (off >= from) out.push({ at: off, marker, depth: markerDepth(marker) });
      off += marker.length;
    }
    // Overlapping line starts are impossible, but a zero-width step is not.
    re.lastIndex = Math.max(re.lastIndex, end);
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
/** The outermost unit a section sits in — its division, where it has one. */
function divisionOf(sec) {
  return (sec && sec.ancestors && sec.ancestors[0] && sec.ancestors[0].label) || '';
}

/**
 * Which "section 708 of this Act" is meant.
 *
 * A section number is not unique — the tracked invariant, here on the resolving
 * side rather than the rendering side. Every division of an appropriations act
 * restarts at 101, so H.J. Res. 31 has six Sec. 505s, and taking the first by
 * number answered from division A for a reference written in division C. 81 of
 * these across the corpus, none of them hedged: the pane said a flat "Section
 * 505 of this bill."
 *
 * The rule is not a heuristic. These bills state it themselves, in their own
 * section 3:
 *
 *   any reference to ``this Act'' contained in any division of this Act shall
 *   be treated as referring only to the provisions of that division.
 *
 * So a reference resolves inside its own division first, and only falls back to
 * a bill-wide search when its division has no section by that number — which is
 * what a bill with no divisions at all does on every reference.
 */
function sectionByNumber(bill, cite) {
  const hits = bill.sections.filter((s) => s.num === cite.section);
  if (hits.length < 2) return hits[0] || null;
  const from = sectionAt(bill, cite.start);
  const want = divisionOf(from);
  return (want && hits.find((s) => divisionOf(s) === want)) || hits[0];
}

export function locateInternal(bill, cite) {
  const text = bill.text;

  // "section 4(a) of this Act" / "section 3 of this title" — a section of the
  // bill itself, which we can name exactly.
  if (cite.refType === 'section' && cite.section) {
    const sec = sectionByNumber(bill, cite);
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

  // A reference inside quoted inserted law is bounded by that law.
  //
  // The bill's own sentences and the statute it is writing are the same
  // characters in the same file, and the widening below cannot tell them apart:
  // "the table contained in subsection (d)", sitting inside the new 26 U.S.C.
  // 1(j) the Tax Cuts and Jobs Act adds, was answered with section 11001(d) OF
  // THE BILL — a different amendment about tax-preparer diligence — under the
  // heading "the only (d) inside the enclosing provision". 1,336 of these across
  // the corpus, every one of them unhedged, and 379 more marked a guess when
  // they were not even that.
  //
  // Bounded, the widening still happens; it just stops at the edge of the new
  // law, which is the furthest a reference inside it can possibly reach. What
  // lies past that edge is the drafting instruction, not the statute, and the
  // right answer there is nothing at all — see resolve()'s note, which now says
  // the reference points into the law being amended rather than pretending no
  // such provision exists anywhere.
  const bounds = cite.inserted || { start: sec.start, end: sec.end };

  const depth = UNIT_DEPTH[cite.refType] ?? markerDepth(marks[0]);
  const scope = parentSpan(text, bounds.start, bounds.end, cite.start, depth);
  let hits = walk(text, scope.start, scope.end, marks).filter((i) => i < cite.start || i > cite.end);
  let scoped = true;
  if (!hits.length) {
    // Nothing at this level — the reference may reach outside its own parent, or
    // the outline may not have survived extraction. Widen to the enclosing
    // block rather than giving up, and say so.
    hits = walk(text, bounds.start, bounds.end, marks).filter((i) => i < cite.start || i > cite.end);
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
      : `There is no ${marks[marks.length - 1]} inside the enclosing provision at all, so this is the nearest one anywhere in ${cite.inserted ? 'the block of new law this sits in' : 'the section'} — it may belong to a different provision, or the reference may point out to the U.S. Code rather than into the bill.`,
    section: sec,
    ambiguous: hits.length > 1 || !scoped,
    // Two different degrees of doubt, and collapsing them into one flag
    // undersells the worse of them. Several candidates inside the RIGHT parent
    // is a near-miss — the answer is one of them. Nothing in the right parent at
    // all means this came from somewhere the reference does not govern, and it
    // is a guess, which the pane and the bill both have to say outright.
    guess: !scoped,
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
