// Applying an amendment to the text of the law, so the change can be read as a
// redline rather than as a list of instructions.
//
// The bill says «by striking ``widget'' and inserting ``gadget''». That is
// perfectly precise and almost unreadable: to know what the law will say you
// have to find "widget" in the provision yourself and do the substitution in
// your head. Marking it in the *provision* — widget struck through in red,
// gadget in green beside it — is the whole point of showing the two panes
// together.
//
// Two things make this harder than a string replace.
//
// First, the bill and the U.S. Code never spell the same passage identically:
// the bill quotes with ``…'' or ‘‘…’’, the Code shard has curly doubles, and a
// PDF bill wraps its operand across a line so the phrase carries a newline the
// Code does not have. So matching happens on a folded copy of both — and because
// the mark has to land on the *original* characters, the fold carries an index
// back to them.
//
// Second, an insertion has no text of its own to attach to. Where it goes comes
// from the connective the bill used ("and inserting", "after ``Y''"), captured
// by placeOps() in app/parse/citations.js.

// The one spelling of "what shape does this run of line-head markers have?" —
// see appliedNodePaths(), which reads an added block's own outline rather than
// re-deriving one.
import { parseProvision } from '../parse/outline.js';

/**
 * Fold a passage onto the common ground the two sources share, keeping a map
 * back to the original offsets.
 *
 * Quote convention, DASH convention, case and whitespace runs are all normalised
 * away — the same fold main.js uses to decide whether struck language is present
 * at all, except that this one can say *where*.
 *
 * The dash is the quote convention's exact twin, and was missed for as long as
 * this existed. govinfo writes the em dash as two hyphens and the Code writes a
 * real one, so the Fiscal Responsibility Act's new spending caps —
 *
 *   bill:  ``(9) for fiscal year 2024--
 *   law:     (9) for fiscal year 2024—
 *
 * — differ in one character out of eighty and matched nothing. That is the same
 * text, and alreadyIn() has to be able to say so: without it an addition the law
 * demonstrably contains is drawn in the insertion colour beside the identical
 * paragraph already there, which is the duplication every guard here exists to
 * prevent. The em dash is canonical because the ASCII hyphen must stay distinct
 * — "REG-ISTRATION" and "PAY-AS-YOU-GO" carry real hyphens, and folding those
 * together would match across words the drafter kept apart.
 */
export function fold(s) {
  let norm = '';
  const from = [];
  const to = [];
  let i = 0;
  let lastWasSpace = false;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === '``' || two === "''" || two === '‘‘' || two === '’’') {
      norm += '"'; from.push(i); to.push(i + 2); i += 2; lastWasSpace = false; continue;
    }
    // Two hyphens are one em dash, and take two characters of the original the
    // same way a doubled quote mark does.
    if (two === '--') {
      norm += '—'; from.push(i); to.push(i + 2); i += 2; lastWasSpace = false; continue;
    }
    const c = s[i];
    if (/\s/.test(c)) {
      // A run of whitespace folds to one space, mapped over the whole run so a
      // mark that ends on it covers the line break rather than half of it.
      const start = i;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (!lastWasSpace) { norm += ' '; from.push(start); to.push(i); lastWasSpace = true; }
      else { to[to.length - 1] = i; }
      continue;
    }
    lastWasSpace = false;
    // The en dash joins the em dash: USLM prints both, and a bill writing either
    // means the same separator. The ASCII hyphen is deliberately left alone.
    // A LONE curly single is an apostrophe, and the two sources spell it
    // differently: the bill writes "taxpayer's" with U+0027 and the Code
    // "taxpayer’s" with U+2019. Every already-happened test compares folded
    // strings, so 26 U.S.C. 3402(a)(2) could not be recognised as in force over
    // one character out of 112. The DOUBLED forms are consumed above, which is
    // what makes this safe: a lone one reaching here is never a delimiter.
    norm +=
      c === '“' || c === '”'
        ? '"'
        : c === '–' || c === '—'
        ? '—'
        : c === '’' || c === '‘'
        ? "'"
        : c.toLowerCase();
    from.push(i); to.push(i + 1); i++;
  }
  return { norm, from, to };
}

/**
 * Every occurrence of `needle` in a folded passage, as original-offset ranges.
 *
 * Whole words only. Bills strike very short operands constantly — "and", "or",
 * a lone semicolon — and a plain substring search struck the "or" inside "for"
 * and the "and" inside "understanding", drawing a line through the middle of a
 * word the amendment never mentions. The boundary is only required at an end
 * that is itself a word character, so punctuation operands still match.
 */
function occurrences(folded, needle) {
  const n = fold(needle).norm.trim();
  const out = [];
  if (!n) return out;
  const openWord = /\w/.test(n[0]);
  const closeWord = /\w/.test(n[n.length - 1]);
  let at = folded.norm.indexOf(n);
  while (at >= 0) {
    const before = at > 0 ? folded.norm[at - 1] : '';
    const after = folded.norm[at + n.length] || '';
    if (!(openWord && /\w/.test(before)) && !(closeWord && /\w/.test(after))) {
      out.push({ start: folded.from[at], end: folded.to[at + n.length - 1] });
    }
    at = folded.norm.indexOf(n, at + 1);
  }
  return out;
}

/**
 * The spans of a passage's sentences, as [start, end) pairs over the original.
 *
 * A bill scopes an operation to a sentence — "in the first sentence, by striking
 * ``2018''" — 326 times across the corpus, and until this existed the op kept
 * whatever scope the walk reached and struck the first occurrence anywhere under
 * it. 49 U.S.C. 31104(b)(2) is the shape of it: three instructions strike "The
 * Secretary" in the third, second and first sentences to designate three new
 * subparagraphs, and all three landed on the same words.
 *
 * A sentence ends at a full stop followed by whitespace and the start of another
 * one. What makes that unsafe in statutory prose is the abbreviations, and they
 * are a closed set here: a citation ("42 U.S.C. 1758", "Pub. L. 115-141", "et
 * seq."), an initial, and the handful of forms the OLRC prints. Anything the
 * list does not know is a sentence boundary, which is the direction that fails
 * safely — an over-split names a shorter span than the drafter meant and the
 * operand is simply not found there, where an under-split hands back a span
 * containing a neighbour's words.
 *
 * A trailing quote or bracket belongs to the sentence it closes.
 */
const SENT_ABBREV =
  /(?:^|[\s(“"'])(?:[A-Z]|U\.?S\.?C|Pub|L|Sec|Secs|No|Nos|Stat|Cong|Doc|Rept|art|para|subpara|cl|seq|etc|Inc|Corp|Co|Jr|Sr|St|Mr|Mrs|Ms|Dr|approx|Fed|Reg|Cir|Ct|ed|vol|pt|Ch|Div|Subch|Art)\.$/;
export function sentenceSpans(text) {
  const out = [];
  const re = /[.!?](?:['"’”]|'')?(?=\s)/g;
  let from = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    // The next non-space has to look like the start of a sentence, or this is a
    // decimal point, a numbered item, or a citation running on.
    const rest = text.slice(end);
    const nextAt = rest.search(/\S/);
    if (nextAt < 0) break;
    if (!/[A-Z(“"`‘]/.test(rest[nextAt])) continue;
    if (SENT_ABBREV.test(text.slice(Math.max(0, m.index - 12), m.index + 1))) continue;
    out.push([from, end]);
    from = end + nextAt;
  }
  if (from < text.length && text.slice(from).trim()) out.push([from, text.length]);
  return out;
}

/**
 * A redliner for one amendment, applied across the provision in document order.
 *
 * Stateful on purpose. A struck phrase is struck once, in the first node that
 * contains it — statutory language does repeat, and marking every match would
 * report an amendment as touching provisions it never mentions. `each place it
 * appears` is the exception the bill states explicitly, and only then are all
 * matches marked.
 *
 * @param {Array} ops  the amendment's ops, already carrying placement metadata
 */
// How much inserted language has to be present before "these words are here"
// counts as evidence that this bill put them here. `alreadyIn` uses the same
// floor for block additions and for the same reason: below it, a match is a
// coincidence of common statutory phrasing rather than a fingerprint. Only the
// unanchored case is subject to it — an anchor is positional proof on its own.
const ENACTED_MIN = 24;

/**
 * The longest operand that is a PHRASE rather than a provision.
 *
 * Woven into a sentence, a phrase reads; a provision does not. This is the same
 * 400 characters RE_INSERT used as its operand budget, and that is not a
 * coincidence being reused — it is where the two populations actually divide.
 * Measured before it was imposed: across the corpus the inline renderer drew
 * 601 green inserts and NOT ONE of them was over 400 characters, because an
 * operand that long could not be parsed at all. Reading those blocks (item 77's
 * other half) put 549 new operations into the panel, of which exactly two
 * reached this branch — and both were wrong in the way this file cares about
 * most. 42 U.S.C. 1396d(a)(4)(A) already carries the American Rescue Plan's
 * subparagraph (E) and 1396o(a)(2)(B) already carries the tobacco-cessation
 * clause, so 1,099 and 458 characters of law in force were drawn as pending
 * additions. Neither in-force test could see it: the codifier writes "March 11,
 * 2021" where the bill wrote "the date of the enactment of the American Rescue
 * Plan Act of 2021".
 *
 * So a block is LISTED and not woven. The panel prints its language, which is
 * the whole of what reading it gained; drawing it was never part of that.
 * Marking one as already in force is unaffected — that is a claim about text
 * on screen, and positive evidence is safe at any length.
 */
const INLINE_MAX = 400;

/**
 * An operation scoped to a path the provision does not have.
 *
 * `inScope` asks whether the node's path starts with the op's scope, so a scope
 * naming a level that does not exist matches NOTHING and every operation under
 * it silently vanishes — no mark, no message, nothing for the reader to notice.
 * 496 across the corpus.
 *
 * The cause is mostly US, and that was worth measuring rather than assuming.
 * A bill CAN write a bad address — the Fiscal Responsibility Act cites "7 U.S.C.
 * 2015(6)(o)(3)" for 2015(o)(3), duplicating the Act's own section number into
 * the parenthetical, and cites the same provision correctly thirty lines later —
 * but that is one citation, not the pattern. Classified across the corpus:
 *
 *    46  dropping the leading marker gives a real path
 *   413  every marker exists in the tree, but not in that order or nesting
 *   199  the leading marker is nowhere in the provision at all
 *
 * and 658 of the 675 are plain U.S.C. cites rather than Act-relative ones, so
 * this is not the Act-numbering hazard either. Two of our own faults are
 * confirmed behind it: a shard whose tree is missing a level — 42 U.S.C. 4332
 * has (A)–(H) at top level, with NEPA's own "(2) all agencies … shall" gone, so
 * the correct address (2)(A) cannot match — and scope composition dropping a
 * level, which is how "section 2(a)(36)" reached 15 U.S.C. 80a-2 as bare (36).
 *
 * So this is a symptom to REPORT and a signal to follow, not a bill to blame.
 * Reporting it is still right: the alternative is drawing nothing and saying
 * nothing, which is how it stayed invisible. Following it is what found TODO 35:
 * the instruction's own head was never consulted at all, so 813 operations that
 * never navigate were searching whole sections. The count above is now 1,233,
 * of which only 280 survive nowhere. See TODO 34 and TODO 35.
 *
 * Shortened from the inside out until something matches, which is exactly what
 * `resolvePlawDivision` does with a Public Law subdivision, and for the same
 * reason: narrow and honest beats wide and silent. Two rules keep it honest —
 *
 *   - it never shortens a NAVIGATION scope to nothing. Falling back to the whole
 *     section would let a one-word operand land in a sentence the instruction
 *     never mentions, which is the hazard `scope` exists to prevent. An address
 *     that survives nowhere is recorded as lost and drawn nowhere.
 *     The single exemption is `scopeFromHead` — see the note at the bottom of
 *     this function. It is not a softening of this rule but its complement: the
 *     whole provision is where such an op applied before the head was read at
 *     all, so shortening to nothing restores the previous answer rather than
 *     widening past a claim the instruction made.
 *   - it never REORDERS. (6)(o)(E) against a provision holding (o)(6)(E) is a
 *     transposition anyone can see, and correcting it would be a guess about
 *     what the drafter meant.
 */
function reScope(ops, knownPaths) {
  const paths = [...knownPaths];
  const exists = (s) => paths.some((p) => String(p).startsWith(s));
  // A repaired scope drops its sibling list. `scopes` is the members the bill
  // named as a list, and a first member the provision does not have means the
  // list was read against a structure this provision does not share — so the
  // other members are no more trustworthy than the one being repaired. The
  // members that DO exist are simply left undrawn, which is where they were.
  const fix = (o) => {
    const r = repair(o);
    return r === o || !o.scopes ? r : { ...r, scopes: undefined };
  };
  const repair = (o) => {
    const scope = String(o.scope || '');
    if (!scope || exists(scope)) return o;
    const marks = scope.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
    // A REPLACEMENT keeps its last marker, because that marker is the provision.
    // The block reopens what it replaces by name — "``(4) Congestion
    // mitigation…''" replaces (4) — so where the walk composed too many levels
    // above it ("(b)(3)" + "(4)" = "(b)(3)(4)"), the repair is to drop INTERIOR
    // levels and keep the lead, not to shorten from the end. Shortening from the
    // end throws away the one marker that names the provision, which is what
    // left 42 U.S.C. 1396a(a) claiming a 1,786-character block.
    //
    // Exact membership, not the prefix test the other branches use, because
    // replacedAt() matches with `===`. A test rather than a guess: it only ever
    // adopts a path the provision actually has, which is why it withdraws
    // nothing.
    if (o.type === 'replace' && marks.length > 1) {
      const lead = marks[marks.length - 1];
      for (let i = marks.length - 2; i >= 0; i--) {
        const tryPath = marks.slice(0, i).join('') + lead;
        if (paths.some((p) => String(p) === tryPath)) {
          return { ...o, scope: tryPath, scopeWidened: scope };
        }
      }
    }
    // A phrase-composed scope naming nothing falls back to where the op applied
    // before the phrase was read, rather than being reported lost. See
    // scopeReplacements().
    if (o.scopeFromPhrase && o.scopeFallback && exists(o.scopeFallback)) {
      return { ...o, scope: o.scopeFallback, scopeWidened: scope };
    }
    for (let i = marks.length - 1; i > 0; i--) {
      const shorter = marks.slice(0, i).join('');
      if (exists(shorter)) return { ...o, scope: shorter, scopeWidened: scope };
    }
    // Nothing shallower matched, so try dropping markers off the FRONT instead.
    //
    // A level the CODE ITSELF does not mark up. 42 U.S.C. 4332's USLM puts
    // NEPA's "(1) the policies … and (2) all agencies … shall—" inline in the
    // <chapeau> and hangs the (A)–(L) <subparagraph> elements straight off the
    // section — there is no (2) element in the source at all. So the shard is
    // faithful, the citation "(2)(A)" is correct, and neither can be fixed:
    // what is left is to notice that the tail names a real provision. 17
    // sections Code-wide are shaped this way (checked, of 35,054).
    //
    // Safe because it is still a test, never a guess: the remainder has to be a
    // real path. The Fiscal Responsibility Act's transposed (6)(o)(E) offers
    // (o)(E), which is a prefix of nothing in 7 U.S.C. 2015, so it stays lost
    // rather than being quietly relocated.
    for (let i = 1; i < marks.length; i++) {
      const tail = marks.slice(i).join('');
      if (exists(tail)) return { ...o, scope: tail, scopeWidened: scope };
    }
    // A scope taken from the instruction's own head, naming nothing here.
    //
    // This is the ONE case where shortening to nothing is right, and the reason
    // is that the whole provision is where the op was applied before the head
    // was read at all. "Section 22(d) of the Federal Reserve Act (12 U.S.C. 375)
    // is amended" — the Act's subsection (d) IS the codified section, so 375 has
    // no (d) and never will. 41 of the 306 head addresses that resolve are this
    // shape. Declaring them lost would withdraw marks the reader can see today
    // in order to fix a level that was never wrong.
    //
    // A navigation step is not eligible: "in paragraph (14)" of a provision with
    // no (14) is unaccounted for, and widening it to the whole section is how a
    // one-word operand lands in a sentence the instruction never mentions.
    if (o.scopeFromHead) return { ...o, scope: '', scopeWidened: scope };
    return { ...o, scopeLost: scope };
  };
  return ops.map(fix);
}

/**
 * "(a) through (i)" names nine subsections and parses to two.
 *
 * A range is written as its ends, so `MARKER_LIST` gives the two and the
 * provisions between are named only by implication — which is why the citation
 * card refuses to chip them, and right, because nothing in the CITATION says
 * what lies between. Here it is not an implication: the siblings are in the
 * provision on screen. 10 U.S.C. 9063 has (a) through (i) and all nine contain
 * "in the Air Force", which is what the NDAA struck each place it appears; two
 * were marked.
 *
 * A test, never a guess. Both ends must be real paths in the tree, at the same
 * depth, under the same parent, and in that order — anything else returns the
 * op untouched. The order comes from `knownPaths`, which every caller builds by
 * walking the tree, so its iteration order IS document order.
 */
function expandRange(op, knownPaths) {
  if (!op.scopeRange || !op.scopes || op.scopes.length !== 2) return op;
  const marks = (s) => String(s).match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  const [a, b] = op.scopes;
  const ma = marks(a);
  const mb = marks(b);
  if (!ma.length || ma.length !== mb.length) return op;
  const parent = ma.slice(0, -1).join('');
  if (mb.slice(0, -1).join('') !== parent) return op;
  const sibs = [...knownPaths]
    .map(String)
    .filter((p) => {
      const m = marks(p);
      return m.length === ma.length && m.slice(0, -1).join('') === parent;
    });
  const i = sibs.indexOf(a);
  const j = sibs.indexOf(b);
  if (i < 0 || j < 0 || j <= i) return op;
  return { ...op, scopes: sibs.slice(i, j + 1) };
}

/**
 * @param {Array}  ops        the amendment's ops, already carrying placement
 * @param {string|string[]} fullText  the whole provision, for the
 *                            already-happened tests. An ARRAY where the caller
 *                            can render the provision more than one way; see
 *                            `hays` below.
 * @param {Set}    knownPaths every path in the tree being rendered, so an op
 *                            addressed to a level that does not exist can be
 *                            widened to one that does rather than disappearing
 */
export function createRedline(ops, fullText, knownPaths) {
  // The provision arrives in as many renderings as the caller can produce, and
  // every already-happened test below asks all of them. Two exist and they
  // differ by a HEADING: the Code stores a node's heading apart from its body,
  // and whether the bill's own language carries one cuts both ways —
  //
  //   2 U.S.C. 901(d)  bill: "(d) Enforcement of Discretionary Spending
  //                           Limits.--It shall not be in order…"
  //                    Code: heading held apart, body "It shall not be in order…"
  //   15 U.S.C. 78i(a) bill: "(a) It shall be unlawful for any person…"
  //                    Code: heading "Transactions relating to purchase or sale
  //                           of security" — supplied editorially, not enacted
  //
  // alreadyIn() matches the first 80 folded characters, so a heading on either
  // side alone is inside the window and defeats the match. Testing one rendering
  // trades one blind spot for the other: on the corpus, flattening alone missed
  // 877 additions the law demonstrably contains — the sample bill drew
  // 2 U.S.C. 901(d) twice on one screen, once as law and once as a pending
  // addition of the same words — and heading-inline alone missed 14 the other
  // way. Both strings are true renderings of the same provision, so a match in
  // either is evidence and neither is authority.
  //
  // The FIRST entry is the provision's own text, and `stale` asks only that one.
  // The asymmetry is the point and it is not a convenience: "the law contains
  // this language" is POSITIVE evidence, safe to accept from any true rendering,
  // while staleness is NEGATIVE — "not one thing this amendment strikes is still
  // here" — and a single coincidental hit anywhere destroys it. Asking every
  // rendering rescued 22 amendments from staleness and 15 of them were caption
  // hits: hr2-115 strikes "2018" from 7 U.S.C. 1932(b)(2), and the heading of an
  // unrelated subsection (f) contains the year. The 7 genuine ones strike across
  // the heading/body juncture ("Retroactive Changes in Plan.--A stock bonus")
  // and stay withheld, which is the conservative direction: withholding shows
  // nothing, and drawing an insertion the law already carries shows it twice.
  //
  // An EMPTY string is kept, and that is not tidiness. 9,547 shards are stubs —
  // repealed, transferred, omitted — with no text at all, and `stale` is
  // `hays.length > 0 && …`, standing in for the old `typeof fullText ===
  // 'string'`. Dropping the empties made hays.length 0 on every stub, which
  // flipped 246 operations out of "the amendment has already happened" and into
  // "not found in the provision" with no evidence for the change.
  const hays = (Array.isArray(fullText) ? fullText : [fullText]).filter(
    (s) => typeof s === 'string'
  );
  // An insert placed structurally belongs to `additions` and to nothing else.
  // It used to be in both lists as two separate objects: the additions copy was
  // handled and the work copy was never marked done, so unplaced() reported a
  // stranded insertion for one that had in fact been dealt with — and the panel
  // told the reader "not drawn into the text" about language that was already
  // in the law.
  const structural = (o) => o.type === 'add-at-end' || (o.type === 'insert' && o.placement === 'after-unit');

  // `operand` is set where the bill NAMES what it operates on instead of quoting
  // it — "by striking the period at the end", "and inserting a semicolon". The
  // span in the bill is the phrase the reader clicked, so that is what `text`
  // holds; what has to be found in — or added to — the LAW is the mark itself.
  //
  // Substituted HERE, before the split, and that placement is the whole point.
  // This map used to sit in the `additions` chain alone, where an operand-bearing
  // op can never arrive: structural() admits only `add-at-end` and after-unit
  // inserts, and every op carrying `operand` is a plain strike or insert. So it
  // was dead code in the one list that could not use it, and missing from the one
  // that could. Every synthesised punctuation strike matched the PHRASE against
  // the law's text, found nothing, and drew nothing — and its paired insert went
  // with it, because `replaces` pointed at a strike that never reached struckAt.
  // 446 strikes and 343 paired inserts across the corpus, every count green and
  // not one pixel drawn.
  const named = (ops || []).map((o) => (o.operand ? { ...o, text: o.operand } : o));
  // Addresses are reconciled against the tree BEFORE anything is split or
  // measured, so `work`, `additions` and `stale` all reason about the same
  // scopes the renderer will ask with.
  // Ranges last, so an op whose scope reScope() had to repair — which drops its
  // sibling list along with it — is never expanded off a path it does not have.
  const scoped = knownPaths
    ? reScope(named, knownPaths).map((o) => expandRange(o, knownPaths))
    : named;

  const work = scoped
    .filter((o) => (o.type === 'strike' || o.type === 'insert') && typeof o.text === 'string')
    // An operation aimed at a provision's HEADING is refused by being kept out
    // of this list, so `placed()` is right without being told — the same shape
    // headingRewrites() and elsewhere() use. The Code stores a heading apart
    // from its body, so apply() searches text the words are not in, and where
    // they happen to occur in the body the mark lands there: 112 across the
    // corpus. See markHeadingOps() in app/parse/citations.js.
    .filter((o) => !structural(o) && !o.scopeLost && !o.otherSection && !o.headingOnly)
    .map((o) => ({ ...o, done: false }));

  // Additions are placed structurally rather than woven into a run of text.
  //
  // "by adding at the end the following: ``(D) …''" puts a whole new provision
  // *after the last child* of the one it names — new subparagraph (D) follows
  // (A), (B) and (C). apply() works inside one passage at a time and cannot see
  // where a subtree ends, so weaving it in would land the new language directly
  // after paragraph (3)'s lead-in sentence and before the subparagraphs it is
  // supposed to follow. The renderer asks for these once it has finished a
  // node's children instead; see additionsAt().
  //
  // "by inserting after subparagraph (C) the following" joins the same list.
  // It is an insert by verb but a new provision by shape, and it was reaching
  // apply() with nothing to anchor to — no quoted phrase, no paired strike —
  // so it drew nothing at all. Scoped to (C) itself by scopeUnitInserts(), it
  // lands after (C)'s subtree, which is where the bill puts it.
  const additions = scoped
    .filter((o) => typeof o.text === 'string' && structural(o) && !o.scopeLost && !o.otherSection)
    // `inLaw` is decided here rather than inside additionsAt(), because whether
    // the law already contains this language has nothing to do with which node
    // the renderer happens to be laying out when it asks. Deciding it lazily
    // made appliedNodePaths() depend on walk order, which is the kind of thing
    // that works until a tree is shaped differently.
    .map((o) => ({ ...o, done: false, inLaw: hays.some((h) => alreadyIn(h, o.text)) }));

  // Whole-provision replacements. Excluded from `work` and `additions` by their
  // type alone, so they were being dropped silently; they get their own list
  // because they are placed by identity — the provision whose path they name —
  // rather than by matching text or by joining a list. `scopeLost` is honoured
  // for the same reason it is there: an address the provision does not have is
  // reported, not guessed at.
  // A heading rewrite is refused by being kept OUT of this list rather than by a
  // flag inside it, and that is deliberate. placed() is
  // `[...work, ...additions.filter(…), ...replacements].filter(o => o.done)` —
  // `replacements` is unfiltered — so a refusal spelled "do not mark, but mark
  // done" leaves placed() true and the panel prints "the provision is marked
  // above" about a node carrying no mark. That is the tracked invariant this file
  // has broken three times ("placed() must know all of them… each of the three
  // was added separately and each broke this the same way"), and coverage.mjs
  // tests here(placed, o), so the report could not have detected its own bug.
  // Absent from the list, every consumer is right for free.
  // Any type, not just `replace`. The phrase introduces an ordinary strike or
  // insert far more often than a whole-provision rewrite, and those were being
  // drawn into the body — see the `work` filter below.
  const headingRewrites = scoped.filter((o) => o.headingOnly);
  const replacements = scoped
    .filter(
      (o) =>
        o.type === 'replace' &&
        typeof o.text === 'string' &&
        !o.scopeLost &&
        !o.headingOnly &&
        !o.otherSection &&
        // A whole SECTION, or a PART heading, is never the text of a
        // subparagraph. markSectionAdditions() has set this flag on a scoped
        // replacement since item 58 and nothing read it — item 33's rule broken
        // two commits after item 59 restated it, and item 60 fixed the heading
        // half and left this live. 4 replace ops carry it and 2 reached a mark:
        // 2 U.S.C. 1382(a)(2)(B) was told it now reads the Architect of the
        // Capitol's pay section, from a block belonging to an instruction four
        // lines later against a different Act.
        !o.newSection
    )
    .map((o) => ({ ...o, done: false }));

  // Has this amendment already happened?
  //
  // The Code we hold is current, so an *enacted* bill has usually already been
  // applied to it — its struck language is gone and its inserted language is
  // there. Drawing the insertions anyway produced "for the 2018 crop year,
  // {+for the 2018 crop year,+} all of the producers": the same words twice,
  // one of them coloured as a change.
  //
  // An amendment that strikes something is a claim about what the provision
  // currently says. When not one of its strikes can be found, that claim is
  // false, the provision has moved on, and its insertions are being anchored to
  // text that no longer means what the drafter meant. Draw nothing and say so.
  // ...but only a strike whose operand could go missing is evidence either way.
  //
  // Bills strike ".", ";", "or" and "and" constantly, and those occur
  // throughout every provision — so finding one says nothing about whether this
  // amendment has happened, while ANY strike being found held the whole
  // amendment open. One period kept 157 amendments "pending" across the corpus,
  // and 580 rested on nothing longer than four characters. The Fiscal
  // Responsibility Act's SNAP changes are the shape of it: 7 U.S.C. 2015(o)(6)
  // reads "Subject to subparagraphs (G) through (I)" — the words this bill
  // inserted, in force — and every insertion in that instruction was withheld
  // because two of its seven strikes were punctuation that trivially matched.
  //
  // Four alphanumeric characters is the floor, which is what separates "or",
  // "and" and a lone semicolon from a phrase. Where an amendment strikes
  // nothing else, there is no evidence to reason from and the old answer stands
  // — `evidence.length > 0` keeps that case unchanged rather than calling it
  // stale on an empty set.
  const distinctive = (o) => String(o.text).replace(/[^A-Za-z0-9]/g, '').length >= 4;
  const evidence = work.filter((o) => o.type === 'strike' && distinctive(o));
  // The provision's own text and no alternate rendering — see `hays` above for
  // why negative evidence takes the narrowest haystack.
  const stale =
    hays.length > 0 &&
    evidence.length > 0 &&
    !evidence.some((o) => occurrences(fold(hays[0]), o.text).length);

  // A CASE-ONLY amendment folds to a no-op, and drawing it shows the same words
  // twice.
  //
  // "by striking ``the council's functions'' and inserting ``the Council's
  // functions''" capitalises one letter. `fold()` lowercases, because the bill
  // and the Code disagree about case constantly and matching would otherwise
  // fail everywhere — so the struck text and the inserted text are the SAME
  // folded string, the strike is found, and the insert is drawn beside it
  // reading identically. The reader is shown a change with no visible
  // difference; on an enacted bill it is also a claim that the change is
  // pending. 46 pairs of 6,455 across the corpus, most of them the Consolidated
  // Appropriations Act's "Indian tribes" -> "Indian Tribes" sweep.
  //
  // Neither half is drawn and the panel says why. The `spans` test below cannot
  // reach these: it asks whether the new phrase reaches PAST the struck words,
  // and here it occupies exactly the same span.
  for (const op of work) {
    if (op.type !== 'insert' || op.replaces == null) continue;
    const s = work.find((o) => o.start === op.replaces);
    if (!s || typeof s.text !== 'string') continue;
    if (fold(op.text).norm.trim() !== fold(s.text).norm.trim()) continue;
    op.caseOnly = true;
    s.caseOnly = true;
  }

  // Where each strike landed, keyed by its offset in the bill, so an insert that
  // replaces it can be placed immediately after.
  const struckAt = new Map();

  /**
   * @param {string} text  a passage of the provision
   * @param {string} path  that passage's own path, e.g. "(d)(2)(A)"
   *
   * An operation carries the path the instruction had navigated to when it was
   * written, and applies only there or below. Without that, "in subparagraph
   * (A), by striking ``or'' at the end" searched the whole section and struck an
   * "or" three subsections away.
   */
  function apply(text, path = '') {
    if (!text || !work.length) return [{ type: 'keep', text: text || '' }];
    // An op normally applies at its own scope or anywhere below it. "In the
    // matter preceding subparagraph (A)" is the exception: it names the
    // parent's own text and excludes the subparagraphs, so a strike scoped
    // there must not be allowed to land inside (A) — which is exactly the text
    // the instruction identifies itself by staying out of.
    //
    // `scopes` is a navigation LIST: "in subsections (a) through (i), by
    // striking ``in the Air Force''" names nine provisions and the op belongs
    // to every one of them. Returns WHICH member this passage sits in — the
    // longest, so a member nested inside another wins — because the latch below
    // is per member rather than per op. Null where the op does not apply here.
    const scopeHit = (op) => {
      const p = String(path);
      const test = (sc) => (op.exact ? p === sc : p.startsWith(sc));
      if (!op.scopes) return !op.scope ? '' : test(op.scope) ? op.scope : null;
      let best = null;
      for (const sc of op.scopes) if (test(sc) && (best === null || sc.length > best.length)) best = sc;
      return best;
    };
    const inScope = (op) => scopeHit(op) !== null;
    const folded = fold(text);

    /**
     * The occurrences of an op's operand that lie in the sentence it names.
     *
     * An op with no `sentence` gets all of them, which is every op but 326. A
     * sentence the passage does not have — because the amendment has already
     * been made and the sentences renumbered, or because this is the wrong node
     * — yields none, and the op then draws nothing and is reported. That is the
     * same refusal `atEnd` makes when the passage does not end where the bill
     * says it does.
     */
    const sentences = () => (sentenceCache ??= sentenceSpans(text));
    let sentenceCache = null;
    const inSentence = (op, hits) => {
      if (op.sentence === undefined || !hits.length) return hits;
      const spans = sentences();
      if (!spans.length) return [];
      const span = op.sentence === -1 ? spans[spans.length - 1] : spans[op.sentence - 1];
      if (!span) return [];
      return hits.filter((h) => h.start >= span[0] && h.end <= span[1]);
    };
    const dels = [];
    const inss = [];

    /**
     * May this op fire again in a later passage?
     *
     * "Each place it appears" is a claim about the whole provision, and the
     * pane draws one node at a time — `nodeEl()` calls `apply()` once per node
     * over a shared `work` array — so latching `done` after the first passage
     * meant `all` could only ever widen WITHIN one node. 26 U.S.C. 461(l)(1)
     * holds "January 1, 2027" in both (A) and (B) and one was marked; 7 U.S.C.
     * 136w-8 holds "subsection (b)(3)" in ten nodes and one was marked. 12
     * strikes corpus-wide, 41 unmarked passages.
     *
     * The PAIRED insert has to repeat with it. Un-latching only the strike
     * gives a later node a strikethrough with no replacement beside it, which
     * is a worse rendering than the bug. `done` is still set either way,
     * because `placed()` reads it.
     *
     * A navigation LIST repeats too, and it repeats ONCE PER MEMBER rather
     * than freely. "In subsections (a) through (i), by striking ``in the Air
     * Force''" means one occurrence in each of nine subsections — a member's
     * subtree is many nodes, and firing in all of them would strike nine
     * provisions nine times over. `doneIn` records the members already
     * satisfied, so the latch is per member and `all` is what lifts it inside
     * one.
     *
     * Nothing else repeats. `atEnd` stays latched deliberately — a provision
     * has one end — and an ordinary strike with a single scope means one
     * occurrence, which is the whole reason `all` has to be written down.
     */
    const pairedTo = (op) =>
      op.replaces != null ? work.find((o) => o.start === op.replaces) : null;
    const mayFire = (op, hit) => {
      if (!op.done) return true;
      const src = pairedTo(op) || op;
      if (src.all) return true;
      return Boolean(src.scopes) && !(op.doneIn && op.doneIn.has(hit));
    };
    const fired = (op, hit) => {
      op.done = true;
      if (hit) (op.doneIn || (op.doneIn = new Set())).add(hit);
    };

    for (const op of work) {
      if (op.type !== 'strike') continue;
      // Indistinguishable from its replacement on the fold; see above.
      if (op.caseOnly) continue;
      const hit = scopeHit(op);
      if (hit === null || !mayFire(op, hit)) continue;
      const hits = inSentence(op, occurrences(folded, op.text));
      if (!hits.length) continue;
      // "each place it appears" is the bill saying so outright. Otherwise one
      // occurrence is struck: "by striking ``and'' at the end" means the last
      // one, and everything else means the first. Getting this wrong on a
      // one-word operand puts the strike in a different sentence entirely.
      //
      // "at the end" is also a claim that can be checked, and checking it is
      // what stops a stale match. The Code we hold is current, so an enacted
      // bill's strike has usually already happened: asked to strike "or" at the
      // end of a subparagraph that no longer ends in "or", taking the last
      // occurrence found "a socially disadvantaged farmer [or] rancher" in the
      // middle of the sentence and drew a line through it. If nothing but
      // punctuation follows the match, it really is at the end; otherwise the
      // language is gone and the honest answer is to mark nothing.
      let chosen;
      // A RUN, not a phrase — "by striking ``X'' and all that follows through
      // ``Y''" removes everything from X to Y — and a run is never drawn as a
      // deletion. That refusal was measured rather than chosen.
      //
      // Marking X alone, which is what the strike scan gives, shows a far
      // smaller change than the bill makes. Extending the mark to the endpoint
      // is the obvious repair and it is wrong: of 42 extended marks read against
      // the shipped shards by two independent lenses, 38 were wrong and 4 right.
      // Every failure is the same one. The Code is CURRENT, so an enacted bill's
      // run has already been made; the operand survives inside the language the
      // bill inserted (a rewrite quotes its opening words back), the endpoint
      // survives with it, and the extension then strikes the amendment's own
      // result — 26 U.S.C. 3402(a)(2), 2 U.S.C. 287c(a), 7 U.S.C. 3322(b)(1),
      // 400 characters at a time, with the identical sentence re-inserted in
      // green beside it. That is the duplication every guard in this file
      // exists to prevent, at the scale of a whole paragraph.
      //
      // Nor can "has this run already been made?" be answered by comparing the
      // insert against the passage. Four separate things defeat it, each
      // measured: the bill writes "taxpayer's" and the Code "taxpayer’s"; the
      // codifier translates a cross-reference ("section 473" -> "section 673 of
      // this title", "this Act" -> "this chapter"); the insert carries its own
      // markers, which the Code holds as child NODES rather than as text; and a
      // rewrite regularly prepends words in front of the operand.
      //
      // So the run is stated and not drawn. What IS drawn is the positive case
      // below: where the inserted language demonstrably sits at the run's start,
      // it is marked as already in force. That asymmetry is the one this file
      // uses everywhere — a match is evidence, its absence is not.
      //
      // The extent is still computed, because the in-force test needs it. The
      // endpoint is searched for AT OR AFTER the opening phrase, since a run
      // does not double back and statutory language repeats.
      if (op.runUnknown) continue;
      if (op.runTo || op.runToEnd) {
        const from = hits[0];
        const stop = op.runTo
          ? occurrences(folded, op.runTo).find((h) => h.start >= from.end)
          : { end: text.replace(/\s+$/, '').length };
        if (!stop || stop.end <= from.start) continue;
        struckAt.set(op.start, { start: from.start, end: stop.end });
        continue;
      }
      if (op.all) chosen = hits;
      else if (op.atEnd) {
        const last = hits[hits.length - 1];
        if (!/^[\s;.,:]*$/.test(text.slice(last.end))) continue;
        chosen = [last];
      } else chosen = [hits[0]];
      for (const h of chosen) dels.push({ ...h, op });
      fired(op, hit);
      struckAt.set(op.start, chosen[chosen.length - 1]);
    }

    /**
     * This language is already in the law, and it is here because of this bill.
     *
     * Marks the words where they now sit instead of drawing them as a pending
     * change. `near` is the position the instruction would have put them, so the
     * occurrence chosen is the one the bill is talking about — statutory
     * language repeats, and the first match is regularly a different sentence.
     */
    const enact = (op, near, known, member) => {
      const hits = known ? [known] : occurrences(folded, op.text);
      if (!hits.length) return false;
      let pick = hits[0];
      if (near != null) {
        for (const h of hits) {
          if (Math.abs(h.start - near) < Math.abs(pick.start - near)) pick = h;
        }
      } else if (op.atEnd) pick = hits[hits.length - 1];
      dels.push({ ...pick, op, mark: 'was' });
      // A list-scoped op is latched per MEMBER, so the member has to travel
      // here too — enacting in subsection (a) must not settle subsection (b).
      fired(op, member);
      op.enacted = true;
      return true;
    };

    for (const op of work) {
      if (op.type !== 'insert') continue;
      if (op.caseOnly) continue;
      const hit = scopeHit(op);
      if (hit === null || !mayFire(op, hit)) continue;
      // Placed structurally, by additionsAt(). Weaving it in here too would
      // draw the same new provision twice.
      if (op.placement === 'after-unit') continue;
      if (op.replaces != null) {
        const where = struckAt.get(op.replaces);
        const struckOp = work.find((o) => o.start === op.replaces);
        const isRun = Boolean(struckOp && (struckOp.runTo || struckOp.runToEnd));
        // Only in the same passage the strike landed in; otherwise wait, the
        // provision may continue in a later node. A RUN has no `del` to look
        // for — it is never drawn as one — so its recorded extent stands in.
        if (where && (isRun || dels.some((d) => d.start === where.start))) {
          // The replacement has already been made. A bill most often rewrites a
          // phrase by quoting it back with something in front of it — strike
          // "The substitution", insert "Subject to paragraph (6), the
          // substitution" — so once the Code has been amended the OLD operand is
          // still there, inside the new phrase, and the strike lands on it.
          // Nothing above catches that: `stale` asks whether every strike is
          // gone, and this one demonstrably is not. The positional evidence is
          // what settles it — the new language already sits across the span the
          // strike landed on, beginning or ending exactly where the replacement
          // would have put it. That is the same proof the `op.anchor` branch
          // below has always had and this one never did.
          //
          // The new phrase must SPAN the struck words and reach past them on at
          // least one side. Testing only that it sits at one end fires on any
          // insert sharing a word with the operand — "by striking ``paragraph
          // and in'' and inserting ``paragraph,''" starts with the same word,
          // and the operand still being there is the amendment NOT having
          // happened. Nothing that lies inside the struck span is evidence.
          //
          // A RUN is the one shape where EQUALITY is the evidence rather than
          // its absence. "by striking ``means the amount'' and all that
          // follows and inserting ``means the amount by which the wages
          // exceed…''" replaces everything from the operand to the end of the
          // passage, so once it is in force the struck span IS the new text,
          // exactly — and the strict-larger test above rejects that. It
          // rejected it in the worst possible direction: 26 U.S.C. 3402(a)(2)
          // reads the amended way today, and the run drew a strikethrough
          // across the whole of it with the identical words inserted beside.
          // The test for a run is therefore that the new language BEGINS where
          // the run begins, which is where the replacement put it. This is the
          // ONLY thing a run draws — see the strike loop for why.
          const spans = occurrences(folded, op.text).find((h) =>
            isRun
              ? h.start === where.start
              : h.start <= where.start &&
                h.end >= where.end &&
                (h.start < where.start || h.end > where.end)
          );
          if (spans) {
            // The strike goes with it. Those words are part of the new phrase,
            // not language on its way out, and a strikethrough drawn through
            // the middle of a `was` mark says the opposite of what happened.
            for (let i = dels.length - 1; i >= 0; i--) {
              if (dels[i].op.start === op.replaces) dels.splice(i, 1);
            }
            if (struckOp) { struckOp.enacted = true; struckOp.done = true; }
            enact(op, null, spans, hit);
            continue;
          }
          // A run's replacement is not drawn either, and for the same reason
          // the run is not: the words would have to go where the run ended, and
          // the run's end is the thing that cannot be confirmed. Drawing it
          // would put a green paragraph in the middle of text that may already
          // read that way. The panel prints the new language instead.
          if (isRun) continue;
          if (!stale && String(op.text).length <= INLINE_MAX) {
            inss.push({ at: where.end, text: op.text, op });
            fired(op, hit);
          }
          continue;
        }
        // The strike did not land. Where EVERY strike this amendment makes is
        // already gone and this language is already here, both halves of the
        // amendment have plainly happened — so the words are marked as the
        // bill's work rather than withheld. The length floor is `alreadyIn`'s,
        // because there is no anchor here doing the positional work: staleness
        // is evidence about the amendment, not about this spot.
        if (stale && String(op.text).trim().length >= ENACTED_MIN) enact(op, null, undefined, hit);
        continue;
      }
      if (op.anchor) {
        const found = inSentence(op, occurrences(folded, op.anchor))[0];
        if (found) {
          const at = op.relation === 'before' ? found.start : found.end;
          // The words already sit against the anchor the instruction names.
          // That is positional proof and needs no length floor — it used to be
          // grounds for drawing nothing at all, which told the reader the
          // anchor could not be found when the truth was the opposite.
          if (alreadyThere(text, at, op.text)) { enact(op, at, undefined, hit); continue; }
          if (stale || String(op.text).length > INLINE_MAX) continue;
          inss.push({ at, text: op.text, op });
          fired(op, hit);
        }
      }
    }

    return segments(text, dels, inss);
  }

  /**
   * New language this amendment adds at the end of the provision at `path`.
   *
   * Called by the renderer after it has laid out that node's children, so the
   * addition falls where the bill puts it — after the last existing sibling.
   *
   * Subject to the same "has this already happened?" discipline as everything
   * else here. The Code we hold is current, so an enacted bill's addition is
   * usually already in it, and drawing it again would show the provision twice
   * with one copy coloured as new. An amendment whose strikes cannot be found is
   * stale in full and adds nothing either.
   */
  function additionsAt(path) {
    const out = [];
    for (const op of additions) {
      if (op.done || (op.scope || '') !== (path || '')) continue;
      op.done = true;
      // Asked before `inLaw`, and for a stronger reason than the ordering below:
      // this op is not about the provision on screen at all. The bill cited a
      // range ("42 U.S.C. 4321 et seq.") and adds at the end of THAT, so testing
      // whether the language is already in the first section, or drawing it
      // there, both answer a question nobody asked. The panel says where it goes.
      // …and the same for a block that IS a whole new section: it is not about
      // the provision on screen at all, so testing whether its language is
      // already there, or drawing it, both answer a question nobody asked.
      // `rangeSkip` is reused deliberately rather than adding a fourth flag —
      // placed() has to know every "dealt with but not drawn" marker, and each
      // one added separately has broken that the same way.
      if (op.rangeEnd || op.newSection) { op.rangeSkip = true; continue; }
      // `inLaw` is asked FIRST. Both flags say "this has already happened", but
      // one is evidence about this very language and the other is an inference
      // from the amendment's strikes. Where they agree the order is immaterial;
      // where a strike's operand simply is not in the provision, checking
      // staleness first reported an addition the law demonstrably contains as
      // one that could not be placed.
      if (op.inLaw) { op.applied = true; continue; }
      if (stale) { op.staleSkip = true; continue; }
      out.push(op);
    }
    return out;
  }

  /**
   * The provision this bill rewrites from end to end, if it is this one.
   *
   * A whole-provision replacement is not a phrase woven into a passage and not a
   * block joining a list, so neither apply() nor additionsAt() can carry it — and
   * before these ops existed nothing carried it at all: the redline drew nothing
   * and the panel, which returns early on an amendment with no operations, said
   * nothing either. 1,067 across the corpus.
   *
   * What is deliberately NOT done here is a diff. Striking the whole provision
   * and drawing the block after it is the literal truth of a pending bill and
   * exactly wrong for an enacted one, where the Code already reads the new text —
   * that is the duplication every guard in this file exists to prevent, at the
   * scale of a whole provision. So the node is marked and the panel states the
   * new language; the reader compares it against the text in front of them,
   * which is a weaker claim than a diff and one that cannot be wrong.
   *
   * Matched with `===` rather than a prefix: a replacement acts on exactly the
   * provision it names, never on its children, the same way an `exact` scope
   * behaves in inScope().
   */
  function replacedAt(path, provisionText) {
    const op = replacements.find((o) => !o.done && (o.scope || '') === (path || ''));
    if (!op) return null;
    // IDENTITY. A replacement names one provision, and the block reopens it by
    // its own marker — "``(4) Congestion mitigation…''" replaces (4) and nothing
    // else. So the node's own marker has to BE that marker, and where it is not,
    // this scope arrived here by repair rather than by the bill saying so.
    //
    // That happens through reScope(): scopeReplacements() appends the block's
    // marker at the END and reScope()'s shorten branch drops from the END, so
    // shortening always removes the very marker that names the provision. The
    // result is a claim about an ancestor — and then rewriteInForce() measures
    // containment against the wrong haystack, which is how 42 U.S.C. 1396a(a),
    // 107,063 characters of it, came to be titled "already in force" for a
    // 1,786-character block. Provable rather than observed: of 171 such claims,
    // zero had the marked node's marker equal to the block's lead.
    //
    // A block with no leading marker cannot be tested and is left alone — that
    // is the flush-sentence shape, one case, and refusing it would be a guess
    // rather than a test.
    const lead = String(op.text || '').match(/^\s*(?:``|‘‘|["“])?\s*(\([A-Za-z0-9]{1,8}\))/);
    if (lead) {
      const own = (String(path || '').match(/\([A-Za-z0-9]{1,8}\)/g) || []).pop();
      if (own !== lead[1]) return null;
    }
    op.done = true;
    // …and whether it has already happened, which is the one thing that makes
    // the mark say something. Decided HERE rather than at construction — the
    // opposite of an addition's `inLaw`, deliberately — because the haystack is
    // different. "Does the law already contain this added language anywhere in
    // the provision?" is the right question for an addition; for a replacement
    // the question is whether THIS node reads the new text, and testing the
    // whole provision answers a laxer one. Measured: against the whole
    // provision, 42 U.S.C. 254b-2(b)(1)(F) reports in force for a rewrite that
    // genuinely differs, because the words turn up elsewhere in the section.
    // The caller has the node; nothing here does.
    if (typeof provisionText === 'string') op.inLaw = rewriteInForce(provisionText, op.text);
    // A range target answers with the section the range BEGINS at, which is
    // rarely the section being rewritten. Declined unless the law already reads
    // the block — two of the twelve corpus claims are right and a blanket
    // refusal deletes both. See markRangeAdditions().
    if (op.rangeEnd && !op.inLaw) { op.rangeSkip = true; op.done = true; return null; }
    return op;
  }

  /**
   * The provisions an already-enacted addition put into the law, by path.
   *
   * When the Code already contains the added language there is nothing to draw
   * — drawing it would show the provision twice, once coloured as new. But
   * "nothing to draw" is not the same as "nothing to say": the reader is
   * looking at a bill, and the provisions it created are right there on screen,
   * indistinguishable from law that predates it. These are the paths of those
   * provisions, so the pane can mark them as this bill's work.
   *
   * The added block's own leading markers give the numbers — the same signal
   * scopeAdditions() reads for depth. An add-at-end op is scoped to the parent,
   * so its children hang directly off it; an after-unit op is scoped to the
   * sibling it follows, so they hang off that sibling's parent.
   *
   * Only the block's TOP level, and that is the correction. Reading every
   * line-head marker took the block's own interior — its (1)s, (A)s and (i)s —
   * and hung each one off the base as though it were a sibling of the block
   * root. Off a base of `(c)` that is harmless, because `(c)(A)` names nothing;
   * off an empty base it is not, because `(i)` names subsection (i). Lifting
   * the scope guard below without this would have added 451 correct marks and
   * 2,334 wrong ones — "added by this bill" written across provisions the bill
   * never touched, in 26 U.S.C. 59(i) among others. Children need no mark of
   * their own: they are drawn inside the parent, which carries the rule.
   *
   * parseProvision() answers this rather than a local scan, because it is the
   * module that owns marker depth and it already steps over a marker that is
   * only at a line head because the line wrapped.
   *
   * A nullish scope is the empty path. An instruction that never navigates —
   * "Section 251 … is amended by adding at the end the following" — leaves
   * `scope` undefined, and `typeof op.scope !== 'string'` skipped every one, so
   * 256 enacted additions could never mark the provision they created. The
   * Fiscal Responsibility Act's new 2 U.S.C. 901(d) is one: the panel said
   * "✓ already in the law as it stands" while the subsection it names sat
   * unmarked a few lines below.
   */
  function appliedNodePaths() {
    const out = new Set();
    for (const op of additions) {
      if (!op.inLaw) continue;
      const scope = op.scope == null ? '' : String(op.scope);
      const base =
        op.placement === 'after-unit'
          ? scope.replace(/\([A-Za-z0-9]{1,8}\)$/, '')
          : scope;
      for (const node of parseProvision(op.text)) {
        if (node.marker) out.add(base + node.marker);
      }
    }
    return out;
  }

  return {
    apply,
    additionsAt,
    replacedAt,
    appliedNodePaths,
    isStale: () => stale,
    /** Ops that never found a home, for the panel to report honestly. */
    unplaced: () => work.filter((o) => !o.done),
    // Drawn into the law, which is not the same as dealt with: an addition the
    // law already contains is marked done and deliberately not drawn, and
    // reporting it as "shown above" would send the reader looking for green text
    // that isn't there. `rangeSkip` is the third of these and the same trap —
    // an addition at the end of an Act is marked done by the node that declined
    // it, and calling that "shown above" is the opposite of what was decided.
    // A replacement is "placed" once the node it names has been laid out and
    // marked, which is the whole of what it claims — the provision on screen is
    // the one this bill rewrites. It draws no coloured text, so the panel says
    // "marked above" rather than "shown above"; see effect().
    // `replacements` is filtered here too, and it must be. A refusal spelled
    // "mark done and draw nothing" — which is how rangeSkip works — otherwise
    // leaves placed() true and the panel says "the provision is marked above"
    // about a node carrying no mark. Fifth time this list has needed a new
    // exclusion; the pattern is that every "dealt with but deliberately not
    // drawn" flag has to be named in BOTH places.
    placed: () =>
      [
        ...work,
        ...additions.filter((o) => !o.applied && !o.staleSkip && !o.rangeSkip),
        ...replacements.filter((o) => !o.rangeSkip),
      ].filter((o) => o.done),
    /** Additions whose scope names a provision that isn't in the tree shown. */
    unplacedAdditions: () => additions.filter((o) => !o.done),
    /** …and replacements whose provision is not in the tree being shown. */
    unplacedReplacements: () => replacements.filter((o) => !o.done),
    /** Every replacement, so a report can split them by `inLaw` after the walk. */
    replacedOps: () => replacements,
    /**
     * Rewrites of a provision's HEADING, refused above and reported here.
     *
     * Refusing is not the same as saying nothing: the bill really does rename
     * this provision, and that is worth one true sentence. Routing them through
     * `newSection` would have printed "adds a whole new section, not part of
     * this one" — and not one of them adds a section; every one renames one.
     */
    headingRewrites: () => headingRewrites,
    /**
     * A rewrite of the whole section, which has no node to hang a mark on.
     *
     * Marked done so `placed()` counts it — the pane states it at the top of the
     * provision, which is what "dealt with" means for this shape. `inLaw` is
     * judged against the whole provision here and that is the right haystack for
     * once: the claim IS about the whole of it.
     */
    wholeSectionRewrite: () => {
      const op = replacements.find((o) => o.wholeSection);
      if (!op) return null;
      if (!op.done) {
        op.done = true;
        op.inLaw = hays.some((h) => rewriteInForce(h, op.text));
        // Same refusal as replacedAt(): a range target answers with the section
        // the range begins at, and three of the whole-section cards named a
        // different section from the one on screen.
        if (op.rangeEnd && !op.inLaw) op.rangeSkip = true;
      }
      return op.rangeSkip ? null : op;
    },
    /**
     * Inserts already in the law, marked where they now sit.
     *
     * Read by the panel so it can say "already in force" rather than "shown
     * above": both are true, and only one of them tells the reader that the
     * words in front of them are not a proposal.
     */
    enactedInserts: () => work.filter((o) => o.enacted),
    /**
     * Operations whose two halves are the same words in different case.
     *
     * Neither is drawn — see the note where `caseOnly` is set — and the panel
     * needs to say which silence this is, because "not found verbatim" is false
     * about a strike whose operand is demonstrably right there.
     */
    caseOnly: () => work.filter((o) => o.caseOnly),
    /**
     * Operations whose address does not exist in this provision at all.
     *
     * Deliberately drawn nowhere — see reScope() — but they are the one outcome
     * the reader most needs told, because the bill plainly says it changes
     * something and the page would otherwise be blank about it.
     */
    // Excluding the ops refused for belonging to another section, which is the
    // better reason and the earlier one: an address that names nothing in THIS
    // provision is unsurprising when the bill was addressing a different
    // provision, and reporting the level would send the reader looking for a
    // drafting error that is not there.
    lostScope: () => scoped.filter((o) => o.scopeLost && !o.otherSection),
    /**
     * Operations the instruction walked into ANOTHER section to make.
     *
     * Kept out of `work`, `additions` and `replacements` above rather than
     * flagged inside them, so `placed()` is right without being told — the
     * same refusal shape as headingRewrites(). Reported so the panel can say
     * which section, which is a fact the bill wrote down and the reader can
     * act on.
     */
    elsewhere: () => scoped.filter((o) => o.otherSection),
    /** Operations drawn at a shallower level than the bill addressed. */
    widenedScope: () => scoped.filter((o) => o.scopeWidened),
    /**
     * Additions the law already contains — the bill has been enacted.
     *
     * Asks `inLaw`, not `applied`, and the difference is the whole point.
     * `applied` is set inside additionsAt(), so it exists only once the renderer
     * has laid out the node that addition is scoped to — which makes "has this
     * amendment already happened?" depend on what the reader happens to be
     * looking at. `inLaw` is decided at construction against the whole
     * provision, for exactly the reason stated where it is computed.
     *
     * The Fiscal Responsibility Act is the shape of it. It strikes ``and'' at
     * the end of 2 U.S.C. 901(c)(7)(B) and inserts paragraphs (9) and (10)
     * after paragraph (8); the Code holds both new paragraphs, so the amendment
     * is demonstrably in force. But the insertion is scoped to (c)(8), and a
     * reader who clicked "paragraph (7)(B)" is shown (c)(7) — so additionsAt()
     * was never asked about (c)(8), `applied` was never set, and the one strike
     * is three characters long and so cannot vouch for anything either (see
     * `distinctive`). With both sources empty the panel fell through to
     * "⚠ not found verbatim … usually means the amendment targets a different
     * subsection than the one shown", about a strike whose subsection is
     * exactly the one shown, with the proof sitting in `fullText` unread.
     *
     * A range addition is excluded for the same reason additionsAt() refuses to
     * draw one: it belongs at the end of the Act, so whether this section
     * contains its language is a question about the wrong provision.
     */
    appliedAdditions: () => additions.filter((o) => o.inLaw && !o.rangeEnd && !o.newSection),
  };
}

/**
 * Is this added language already in the provision?
 *
 * The counterpart to alreadyThere() for a whole added block. An addition has no
 * anchor text to test, so the test is the language itself: if the opening of the
 * new provision is already in the law, the bill has been enacted and applied and
 * there is nothing to draw. Compared on the fold, because the bill quotes the
 * block and wraps it to its own measure while the Code does neither.
 *
 * The first 80 folded characters are enough to identify a provision and short
 * enough to survive later amendment of its tail; below 24 there is not enough to
 * be sure, and a false positive here silently hides real new law.
 *
 * The block's own paragraph openers come off first, and they are the reason this
 * test kept failing on blocks the law plainly contained. GPO opens EVERY
 * paragraph of a multi-paragraph addition with a quote mark and closes only at
 * the very end — so the bill writes
 *
 *   ``(9) for fiscal year 2024--
 *       ``(A) for the revised security category, $886,349,000,000 …
 *
 * where the Code has no quote mark before (A) at all, and `fold` faithfully
 * turns that opener into a `"` that the law can never match. Those marks are the
 * convention's structure, not the provision's words. Only an opener at the head
 * of a line is removed: a quoted term inside the sentence is content, and both
 * single conventions take two characters, so a lone apostrophe is left alone.
 */
/**
 * Does this provision already read the way the bill rewrites it?
 *
 * A whole-provision rewrite needs a different test from `alreadyIn` and the
 * reason is length. `alreadyIn` matches the first 80 folded characters, which
 * identifies a short added block and is exactly wrong here: a rewrite is
 * usually a near-copy of the old provision with one clause changed, so its
 * opening 80 characters match whether or not the change has happened. What
 * separates the two is the whole of it.
 *
 * So: what share of the new text's words does the provision already contain?
 * Measured over the corpus, the populations separate sharply — of 541
 * replacements whose provision resolves, 411 sit at 95% or better and the
 * samples there are exact matches, while the tail below 70% is genuinely
 * different text. There is no middle to speak of.
 *
 * Words of three letters or more, so the statutory scaffolding ("of", "the",
 * "any") cannot carry a match on its own, and at least eight of them, because
 * below that a short provision matches anything of its kind. A false positive
 * here tells the reader a pending rewrite has already happened, which is this
 * app's worst category, so the threshold is set where the measurement put the
 * gap rather than where it would score best.
 */
const REWRITE_MATCH = 0.95;
const REWRITE_MIN_WORDS = 8;
function rewriteInForce(provisionText, block) {
  if (typeof provisionText !== 'string' || !provisionText) return false;
  const words = (s) =>
    fold(String(s).replace(BLOCK_OPENERS, '$1$2')).norm.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  // A whole-section rewrite opens with its own caption — "SEC. 6102. …" — and
  // no section number ever appears in the provision's body, so the figure guard
  // below rejected essentially every one of them: 68 of 106 passed the word
  // test at ≥0.95 and all 68 failed on the caption's own number. Dropped the
  // same way BLOCK_OPENERS is, and only the FIRST line, because a caption is
  // the one line whose text is apparatus rather than the provision.
  const body = String(block).replace(/^\s*(?:``|‘‘|["“])?\s*SEC(?:TION)?\.?\s+[\w–—-]+\.[^\n]*\n/i, '');
  const want = words(body);
  if (want.length < REWRITE_MIN_WORDS) return false;
  const have = new Set(words(provisionText));
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  if (hit / want.length < REWRITE_MATCH) return false;
  // The containment is DELIBERATELY one-directional, and that was measured
  // rather than assumed. A rewrite that only DELETES — the ordinary way a bill
  // repeals a requirement — is a subset of the provision it replaces, so it
  // scores 1.0 and would be reported "already in force" while the clause it
  // removes is still on disk. The obvious fix is to require containment both
  // ways, and it is wrong: a provision the Code holds today is regularly LONGER
  // than what this bill made it, because a later Act added to it. 26 U.S.C.
  // 25C(b) is the IRA's own rewrite plus the IRA's own later home-audit
  // paragraph; 30C(c) the same with the census-tract definitions. A symmetric
  // test at this threshold withdrew 42 claims across the corpus and every one
  // sampled was that shape, against 0 demonstrated false positives — nothing
  // textual separates "the bill deleted a clause" from "someone else added
  // one". Recorded rather than built; see CLAUDE.md.
  // EVERY figure has to be there, and unigram containment cannot see that a
  // figure changed. A rewrite is usually a near-copy with one clause altered,
  // and the clause altered is very often a dollar amount, a percentage or a
  // year — so the words match at 96% while the one thing the bill actually does
  // is absent. 26 U.S.C. 25C(d) scored 0.9624 against a provision that does not
  // contain the bill's two-tier version at all; 6 of 484 in-force claims had a
  // figure the provision does not hold.
  //
  // A whole-token test, so "1,000" and "10,000" cannot satisfy each other, and
  // asked of the block's figures only: the provision may carry figures the
  // rewrite drops, which is the rewrite doing its job.
  const figures = (s) => String(s).match(/\d[\d,.]*/g) || [];
  const held = new Set(figures(provisionText).map((f) => f.replace(/[.,]$/, '')));
  for (const f of figures(String(body).replace(BLOCK_OPENERS, '$1$2'))) {
    if (!held.has(f.replace(/[.,]$/, ''))) return false;
  }
  return true;
}

const BLOCK_OPENERS = /(^|\n)([ \t]*)(?:``|‘‘|["“])/g;
function alreadyIn(fullText, added) {
  if (typeof fullText !== 'string' || !fullText) return false;
  const needle = fold(String(added).replace(BLOCK_OPENERS, '$1$2')).norm.trim().slice(0, 80).trim();
  if (needle.length < 24) return false;
  return fold(fullText).norm.includes(needle);
}

/**
 * Are these words already sitting at the point they would be inserted?
 *
 * The narrower companion to the staleness check above: an amendment with no
 * strikes at all cannot be tested that way, but an insertion whose language is
 * already immediately before or after the anchor has plainly been applied
 * already. Checked on the folded text, so quoting and line wrapping don't hide
 * the match.
 */
function alreadyThere(text, at, insertText) {
  const needle = fold(insertText).norm.trim().replace(/^[\s;.,:]+|[\s;.,:]+$/g, '');
  if (needle.length < 4) return false;
  const span = needle.length + 40;
  const after = fold(text.slice(at, at + span)).norm.replace(/^[\s;.,:]+/, '');
  const before = fold(text.slice(Math.max(0, at - span), at)).norm.replace(/[\s;.,:]+$/, '');
  return after.startsWith(needle) || before.endsWith(needle);
}

/** Weave deletions and insertions into a flat run of segments. */
function segments(text, dels, inss) {
  dels.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const d of dels) {
    if (kept.length && d.start < kept[kept.length - 1].end) continue; // overlapping marks
    kept.push(d);
  }
  inss.sort((a, b) => a.at - b.at);

  const out = [];
  let cursor = 0;
  let di = 0;
  let ii = 0;
  const push = (type, t) => { if (t) out.push({ type, text: t }); };

  while (di < kept.length || ii < inss.length) {
    const d = kept[di];
    const n = inss[ii];
    if (d && (!n || d.start <= n.at)) {
      push('keep', text.slice(cursor, d.start));
      // `mark` distinguishes language being REMOVED from language this bill
      // already added. Both are spans over text that is on screen, which is why
      // they travel together and share the overlap rule; only the colour and
      // the claim differ.
      push(d.mark || 'del', text.slice(d.start, d.end));
      cursor = d.end;
      di++;
    } else {
      if (n.at > cursor) push('keep', text.slice(cursor, n.at));
      // The operand crosses from the bill's typesetting into the law's. A quoted
      // phrase in a bill is wrapped to the measure — "and sustainable \n
      // aviation fuel" — and that line break is layout, not language. Collapsed
      // to single spaces so the inserted words read as a phrase where they now
      // sit, rather than opening a gap the width of the bill's left margin.
      push('ins', n.text.replace(/\s+/g, ' '));
      cursor = Math.max(cursor, n.at);
      ii++;
    }
  }
  push('keep', text.slice(cursor));
  return out.length ? out : [{ type: 'keep', text }];
}
