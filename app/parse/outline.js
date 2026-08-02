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
