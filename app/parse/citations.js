// Citation extraction for federal legislative text.
//
// Every matcher returns absolute [start, end) offsets into the source string so
// the renderer can splice links in without re-scanning. Matches are collected
// from all matchers, then overlaps are resolved by specificity (see dedupe()).

import { POPULAR_NAMES } from '../resolve/popular-names.js';
// Depth-by-marker-style, shared rather than reimplemented: it decides where an
// addition belongs here and where a cross-reference points there, and the two
// answers have to agree.
import { markerDepth } from '../resolve/internal.js';

// A subsection path: the "(s)(2)(B)" trailing a section number. Bounded repeat
// keeps a runaway "(" in scanned text from eating the rest of the document.
const SUBSEC = '(?:\\([A-Za-z0-9]{1,8}\\))*';

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

// 42 U.S.C. 7401 / 42 USC § 7401(a)(1) / 26 U.S.C. §§ 501-505 / 15 U.S.C. 78a et seq.
// The word that turns a section citation into a citation of something else.
const RE_NOTE_SUFFIX = /^\s*note\b/i;

const RE_USC = new RegExp(
  '\\b(\\d{1,2}[A-Z]?)\\s*U\\.?\\s?S\\.?\\s?C\\.?' +
    '\\s*(?:§§?\\s*)?' +
    // The \s* after the dash is for line wrapping, not prettiness. govinfo
    // breaks a long citation at the hyphen — "15 U.S.C. 80a-\n3(a)" — and
    // without this the match stops at "80a", which is not a section that
    // exists. The captured number is whitespace-stripped at the push site.
    '(\\d+[A-Za-z]*(?:[–—-]\\s*\\d+[A-Za-z]*)?)' +
    `(${SUBSEC})` +
    '(\\s*(?:et\\s+seq\\.?|and\\s+following))?',
  'gi'
);

// "section 801(a)(2)(A) of title 5, United States Code" — the form bills use for
// positive-law titles instead of "5 U.S.C. 801". Common enough that missing it
// leaves real amendments with no resolvable target.
const RE_USC_LONG = new RegExp(
  '\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)' +
    `(${SUBSEC})` +
    '\\s+of\\s+title\\s+(\\d{1,2}[A-Z]?),\\s*United\\s+States\\s+Code',
  'g'
);

// "section 45K(c)(3) of the Internal Revenue Code of 1986".
//
// Only valid for Acts flagged `sectionsMatchCode` — those whose own section
// numbers are the numbers the Code uses. For the IRC that is exact, and it is
// how tax bills cite almost everything, so without this the reader lands on the
// head of title 26 instead of the provision. For every other Act the numbering
// diverges (Social Security Act § 1861 is 42 U.S.C. 1395x), and those keep
// resolving to the Act with its numbering caveat rather than a confident guess.
const RE_ACT_SECTION = POPULAR_NAMES.filter((a) => a.sectionsMatchCode).map((act) => ({
  act,
  re: new RegExp(
    `\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)(${SUBSEC})\\s+of\\s+the\\s+(?:${act.pattern})`,
    'g'
  ),
}));

// "section 1861 of the Social Security Act" — the same shape, for Acts whose
// numbering does NOT match the Code's.
//
// These cannot be composed here the way the IRC's are, because there is no rule
// to apply: SSA § 1861 is 42 U.S.C. 1395x by an act of codification, not by
// arithmetic. What this does is carry the Act-relative number through as
// `actSection` so the resolver can look it up in the table the ingester derives
// from the Code's own source credits. Where the lookup misses, the citation is
// exactly what it was before this existed — the Act, with its numbering caveat.
const RE_ACT_REL_SECTION = POPULAR_NAMES.filter((a) => a.enactedAs && !a.sectionsMatchCode).map(
  (act) => ({
    act,
    re: new RegExp(
      `\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)(${SUBSEC})\\s+of\\s+the\\s+(?:${act.pattern})`,
      'g'
    ),
  })
);

// 40 CFR 60.1 / 40 C.F.R. § 60.1(a) / 40 CFR part 60 / 45 C.F.R. parts 160, 164
const RE_CFR = new RegExp(
  '\\b(\\d{1,2})\\s*C\\.?\\s?F\\.?\\s?R\\.?' +
    '\\s*(?:§§?\\s*)?' +
    '(?:(parts?|subparts?|chapters?|subchapters?)\\s*)?' +
    '([0-9]+[A-Za-z]?(?:\\.[0-9]+[A-Za-z0-9\\-]*)?)' +
    `(${SUBSEC})`,
  'gi'
);

// Public Law 117-58 / Pub. L. No. 117-58 / P.L. 117-58
const PUBLAW_NAME = String.raw`(?:Pub(?:lic)?\.?\s*L(?:aw)?\.?|P\.\s?L\.)\s*(?:No\.?\s*)?(\d{1,3})\s*[–—-]\s*(\d{1,4})`;

const RE_PUBLAW = new RegExp(`\\b${PUBLAW_NAME}`, 'gi');

// "section 12306 of Public Law 113-79" — the Act-relative shape again, and it
// resolves the same way. A Public Law names its own sections, and the Code's
// source credits say where each one landed ("Pub. L. 113–79, title XII,
// § 12306" is 7 U.S.C. 1632c), so `data/usc/acts/pub_l_113_79.json` already
// answers this. 1,737 Public Laws are indexed and shipped; the previous
// behaviour for all of them was an outbound link.
//
// This is a *longer* match over the same span as RE_PUBLAW, at the same rank, so
// dedupe() keeps it — the same mechanism the Act-relative form relies on.
const RE_PUBLAW_SECTION = new RegExp(
  `\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)(${SUBSEC})\\s+of\\s+` +
  // An omnibus restarts its numbering in every division, so "of division G of"
  // is not decoration — it is the half of the address that disambiguates.
  `(?:[Dd]iv(?:ision)?\\.?\\s+([A-Z]{1,2})\\s+of\\s+)?${PUBLAW_NAME}`,
  'g'
);

// 117 Stat. 1234
const RE_STAT = /\b(\d{1,3})\s+Stat\.\s*(\d{1,5})/gi;

// Amendatory instruction heads. Two shapes dominate in real bills:
//   "Section 1861(s)(2) of the Social Security Act (42 U.S.C. 1395x(s)(2)) is amended—"
//   "Subsection (a) of section 3 of the Widget Act is amended by striking ..."
// We capture the whole head so the resolver can pull the target citation out of it.
// The middle span must be able to cross "U.S.C." and "Pub. L.", so it cannot
// exclude periods — nearly every real amendment names its target that way. It's
// tempered instead: lazy, length-capped, and barred from crossing a semicolon or
// a paragraph break, which is what actually separates one instruction from the
// next. The m flag lets ^ anchor at a line start, where bills usually put these.
// Deliberately case-SENSITIVE. Bills use "Section 254 of the ... Act is amended"
// for an amendment target, but "SEC. 102." for their own section headings. A
// case-insensitive match conflates the two and anchors amendments to headings,
// which makes the wrong provision the target. Alternations spell out both cases
// where a word genuinely varies, and "Sec." is excluded entirely.
// The boundary must also admit a run-in heading. Modern drafting puts the
// target immediately after one — "(a) In General.--Section 5330 of title 31 ...
// is amended" — with no space between the period and the dash, so `[.;:]\s+`
// never fires and the most common shape in the bill goes unseen.
const AMEND_BOUNDARY = '(?:^|[.;:]\\s+|[—–]\\s*|-{2,}\\s*|\\)\\s+)';

// What the span between the target and "is amended" may not cross. A run-in
// heading (".--") or a new bill section ("SEC. 205.") means a *different*
// instruction has started: without these guards the middle runs past the end of
// one sentence and pairs "is amended" with a target from the paragraph above,
// which silently reports the wrong provision as the one being changed.
//
// A finished sentence followed by an outline marker — ". (2) " — is the same
// event and was missing. In a list of provisions:
//
//   (D) Section 15F(h)(5)(A)(i) of the Securities Exchange Act of 1934 (…).
//   (2) Section 752 of the Wall Street … Act of 2010 (15 U.S.C. 8325) is
//       amended by striking ``1a(39)'' and inserting ``1a(40)''.
//
// the middle ran from item (D) across the period into instruction (2) and
// paired its "is amended" with item (D)'s target. The strike and insert were
// reported against 15 U.S.C. 78o-10, which they do not touch, and 15 U.S.C.
// 8325, which they do, got no amendment at all. Both halves silent.
// The semicolon exception. Bills separate sub-instructions with ";", which is
// why it ends the middle — but a parenthetical citation routinely contains one:
//
//   Section 1404 of SAFETEA-LU (23 U.S.C. 402 note; Public Law 109-59) is repealed
//   … the Supplemental Appropriations … Act, 2017 (division B of Public Law 115-56) is amended
//
// and the blanket ban made every instruction written that way invisible — 35 of
// them across the corpus, concentrated in transportation and appropriations
// bills where "(<code> note; Public Law N-N)" is the house style. A semicolon is
// admitted only when a closing paren comes before any opening one, which is to
// say only when we are inside a parenthetical. At a real clause break the next
// paren is an opening outline marker — "; and (2) by inserting" — so the
// lookahead fails and the middle still stops, which is the whole point.
const SEMI_IN_PAREN = ';(?=[^()]*\\))';

const AMEND_MIDDLE =
  '(?:(?!\\n[ \\t]*\\n)(?!\\.\\s*--)(?!\\.\\s+SEC\\.)(?!\\.\\s*\\([A-Za-z0-9]{1,8}\\)\\s)' +
  `(?:[^;]|${SEMI_IN_PAREN}))`;

const RE_AMEND_HEAD = new RegExp(
  AMEND_BOUNDARY +
    // "Subsection (b)(1)(B) of such section 119, as so amended, is amended" —
    // "such" is how a bill refers back to a section it named a paragraph ago,
    // and without it the inner unit stopped matching and the instruction was
    // lost. Multiple markers too: the group took one, so "(b)(1)(B)" failed.
    '((?:[Ss]ubsections?|[Pp]aragraphs?|[Ss]ubparagraphs?|[Cc]lauses?)\\s*(?:\\([A-Za-z0-9]{1,8}\\))+\\s+of\\s+(?:such\\s+)?)?' +
    '([Ss]ection|[Cc]hapter|[Pp]art|[Tt]itle)\\s+' +
    '([0-9]+[A-Za-z]*)' +
    `(${SUBSEC})` +
    `(${AMEND_MIDDLE}{0,240}?)` +
    '\\s+(is|are)\\s+(amended|repealed|redesignated)',
  'gm'
);

// "Subsection (c) of such section is amended" — a sub-unit hanging off a
// section the bill named in an earlier instruction, with no number of its own.
//
// RE_AMEND_HEAD cannot see this: it requires "section <number>", and here the
// number is precisely what has been elided. 252 instructions across the corpus,
// almost all of them in the NDAA, every one reporting that the bill changes
// nothing.
//
// Kept narrow on purpose. It anchors on the sub-unit, requires "of such", and
// requires the verb within a short middle — the referent is resolved from the
// PREVIOUS INSTRUCTION'S TARGET rather than from the nearest citation, and a
// loose match here would attach a real amendment to the wrong section, which
// is much worse than not seeing it.
const RE_AMEND_HEAD_SUCH = new RegExp(
  AMEND_BOUNDARY +
    '((?:[Ss]ubsections?|[Pp]aragraphs?|[Ss]ubparagraphs?|[Cc]lauses?)\\s*(?:\\([A-Za-z0-9]{1,8}\\))+)' +
    '\\s+of\\s+such\\s+([Ss]ection|[Ss]ubsection|[Pp]aragraph)\\b' +
    `(${AMEND_MIDDLE}{0,120}?)` +
    '\\s+(is|are)\\s+(amended|repealed|redesignated)',
  'gm'
);

// Amendments whose target is a whole Act or a structural unit, not a numbered
// section. This is how a bill *adds* a section rather than editing one —
//   "The Securities Act of 1933 (15 U.S.C. 77a et seq.) is amended by inserting
//    after section 4A (15 U.S.C. 77d-1) the following:"
// — and how it reaches a subchapter or a table of sections. The section-shaped
// matcher above cannot see any of these: there is no "section <number>" to
// anchor on. In bills that build new regimes this is the dominant form, so
// missing it understates what the bill does by most of its operative weight.
const RE_AMEND_HEAD_UNIT = new RegExp(
  AMEND_BOUNDARY +
    '(' +
      // "The table of sections for subchapter II of chapter 53 of title 31 ..."
      // Greedy, unlike the units below, because the whole phrase *is* the label
      // here: there is no Act name or section number to fall back on, so a lazy
      // tail left the amendment showing as "The table of sections for sub".
      // "…for subchapter II", "…in section 1(b)", and the form title 10 prefers,
      // "The table of sections at the beginning of chapter 1407 of such title".
      // That last one is 26 instructions in the NDAA alone, every one of them a
      // clerical amendment following a substantive one.
      `[Tt]he\\s+table\\s+of\\s+(?:sections|contents)\\s+(?:for|in|at\\s+the\\s+beginning\\s+of)\\s+${AMEND_MIDDLE}{3,120}` +
      '|' +
      // "The analysis for chapter 1 of title 23, United States Code, is amended".
      // Titles 23, 40 and 49 call their table of sections "the analysis", and
      // the clerical amendment that updates it follows almost every substantive
      // one. 31 of these in the Infrastructure Act alone, none of them seen.
      `[Tt]he\\s+analysis\\s+for\\s+${AMEND_MIDDLE}{3,120}` +
      '|' +
      // "Subchapter II of chapter 53 of title 31, United States Code", and
      // "Subtitle A of title XXII of the Homeland Security Act of 2002".
      // Subtitles are lettered far more often than they are numbered, and
      // `[IVXLC0-9]` admits a letter only by the accident of I, V, X, L and C
      // being roman digits — so Subtitle A, B, D … matched nothing at all.
      `(?:[Ss]ubchapter|[Ss]ubtitle)\\s+(?:[IVXLC0-9]+[A-Za-z]*|[A-Z]\\b)` +
      '|' +
      // "Title I of the Securities Exchange Act of 1934 (15 U.S.C. 78a et seq.)",
      // "Part B of title XVIII of the Social Security Act". This is how a bill
      // adds a whole new section to an Act, and it appeared in every real bill
      // sampled — all three CLARITY Act texts and the sample bill — while being
      // invisible to both matchers: there is no "section <number>" to anchor on,
      // and the Act-name alternative below can only start at "The".
      //
      // Roman and letter numbering only. A numeric "title 31" is a U.S. Code
      // title, which the section-shaped matcher above already handles; letting
      // this alternative take it would strip the number off the target.
      //
      // The "of ..." tail is deliberately left out of this group and picked up
      // by the middle below. Inside the group it was captured lazily, so it
      // matched its three-character minimum and named the amendment "Title I of
      // the" in the UI. The middle covers the same span either way, so the head
      // still reaches the parenthetical U.S.C. cite that resolves the target.
      `(?:[Tt]itle|[Pp]art|[Cc]hapter)\\s+(?:[IVXLC]+|[A-Z])\\b` +
      '|' +
      // "The Securities Investor Protection Act of 1970"
      `[Tt]he\\s+[A-Z]${AMEND_MIDDLE}{2,90}?Act(?:\\s+of\\s+\\d{4})?` +
    ')' +
    `(${AMEND_MIDDLE}{0,200}?)` +
    '\\s+(is|are)\\s+(amended|repealed)',
  'gm'
);

// One instruction, many targets:
//
//   (1) Each of the following provisions of law is amended by striking
//       ``1a(18)'' and inserting ``1a(19)'':
//         (A) Section 4s(h)(5)(A)(i) of the Commodity Exchange Act (7 U.S.C. 6s(h)(5)(A)(i)).
//         (B) Section 5(e) of the Securities Act of 1933 (15 U.S.C. 77e(e)).
//         (C) Section 6(g)(5)(B) of the Securities Exchange Act of 1934 (…).
//         (D) Section 15F(h)(5)(A)(i) of the Securities Exchange Act of 1934 (…).
//
// The operative language is written once and applies to every provision listed
// under it. Neither matcher above can see this: the phrase names no provision at
// all, so there is nothing to anchor a target on, and the whole instruction —
// four real changes to four different statutes — was simply absent from the bill
// view. This is the standard shape of a conforming-amendments block, so in a
// bill that renumbers a definition it is most of what the bill does.
const RE_AMEND_HEAD_EACH = new RegExp(
  AMEND_BOUNDARY +
    `([Ee]ach\\s+of\\s+the\\s+following${AMEND_MIDDLE}{0,120}?)` +
    '\\s+(is|are)\\s+(amended|repealed)',
  'gm'
);

// An outline marker at the head of a line: "(A) ", "(2) ".
const RE_OUTLINE_ITEM = /(?:^|\n)[ \t]*(\([A-Za-z0-9]{1,3}\))[ \t]+/g;

// "Section 4s(h)(5)(A)(i) of the Commodity Exchange Act (7 U.S.C. 6s(h)(5)(A)(i))"
const RE_LISTED_TARGET = new RegExp(
  `([Ss]ection|[Cc]hapter|[Pp]art|[Tt]itle)\\s+([0-9]+[A-Za-z]*)(${SUBSEC})`
);

/**
 * The provisions listed under an "Each of the following …:" instruction.
 *
 * Walks the outline markers after the colon and takes them while they run
 * consecutively from (A). The first marker that breaks the run ends the list —
 * in practice the next instruction's "(2)", which must not be swallowed.
 */
function listedProvisions(text, from, to) {
  RE_OUTLINE_ITEM.lastIndex = from;
  const marks = [];
  let m;
  while ((m = RE_OUTLINE_ITEM.exec(text)) && m.index < to) {
    marks.push({ label: m[1].slice(1, -1), start: m.index + m[0].lastIndexOf('(') });
  }
  const items = [];
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].label !== String.fromCharCode(65 + i)) break;
    items.push({ start: marks[i].start, end: marks[i + 1] ? marks[i + 1].start : to });
  }
  return items;
}

// Where an inserted phrase goes, relative to the text already there.
//
// Knowing *what* a bill inserts is only half an amendment; without knowing where,
// the new language can be listed but not shown in place, and the reader is left
// to work out the result themselves. These are the connectives that say where,
// read from the text between one quoted operand and the next.
//
//   by striking ``A'' and inserting ``B''        <- B replaces A. The dominant
//                                                  form by a wide margin.
//   by striking ``A'' each place it appears and inserting ``B''
//   by inserting ``B'' after ``Y''              <- anchored to existing text
//   by inserting ``B'' before ``Y''
//
// The gap is bounded: "and inserting" sits directly between the two operands, so
// anything longer than a short connective means these are two unrelated
// instructions that happen to be adjacent, and pairing them would show a
// replacement the bill never wrote.
const RE_REPLACES = /^\s*(?:''|’’|["”])?\s*(?:,\s*)?(?:each\s+place\s+(?:it|they)\s+(?:appears?|occurs?)\s*)?(?:,\s*)?and\s+insert(?:ing)?(?:\s+in\s+lieu\s+thereof)?\s*(?:``|‘‘|["“])?\s*$/i;
const RE_EACH_PLACE = /each\s+place\s+(?:it|they)\s+(?:appears?|occurs?)/i;
const RE_AT_THE_END = /^\s*(?:''|’’|["”])?\s*,?\s*at\s+the\s+end\b/i;
const RE_ANCHORED = /^\s*(?:''|’’|["”])?\s*(after|before)\s+(?:``|‘‘|["“])([\s\S]{1,200}?)(?:''|’’|["”])/i;


/**
 * Work out where each inserted phrase belongs, in document order.
 *
 * Runs over the ops of one instruction after they are collected, so the strike
 * and insert scans stay exactly as they were — this only adds fields. `replaces`
 * points at the strike an insert supersedes; `relation`/`anchor` carry the
 * "after ``Y''" form; `all` marks a strike that applies to every occurrence.
 */
/**
 * Bind each operation to the provision the instruction had navigated to when it
 * wrote that operation.
 *
 * An instruction is a walk, and its operations happen at points along it:
 *
 *   Section 1114 … (7 U.S.C. 9014) is amended—
 *     (1) in subsection (d)—
 *       (A) in paragraph (1), by inserting ``…'' before the period; and
 *       (B) in paragraph (2)—
 *         (i) in subparagraph (A), by striking ``or'' at the end;
 *
 * That strike belongs to (d)(2)(A) and nowhere else. Applied to the section as a
 * whole — which is what the redline did — "at the end" took the last standalone
 * "or" in the entire section and drew a strikethrough through subsection (e),
 * across a sentence the bill never mentions. The steps were parsed and sitting
 * right there; nothing was asking them.
 *
 * The op takes the path of the last step written before it. Ops with no step
 * before them stay unscoped and apply to the whole provision, which is correct
 * for a one-line instruction that never navigates.
 */
function scopeOps(ops, steps) {
  if (!steps || !steps.length) return;
  for (const op of ops) {
    if (op.start == null) continue;
    let inForce = null;
    for (const st of steps) {
      if (st.start > op.start) break;
      inForce = st;
    }
    if (inForce) {
      op.scope = inForce.path;
      // "in the matter preceding (A)" scopes to the parent but excludes its
      // children; every other step includes them.
      if (inForce.exact) op.exact = true;
    }
  }
}

/**
 * An addition belongs beside its siblings, not inside the provision the walk
 * stopped at.
 *
 * scopeOps() binds every op to the last step written before it, which is right
 * for a strike or an insert — those act *on* the provision the instruction
 * walked to. An addition does not. It is written as the last item of a list of
 * sub-instructions:
 *
 *     (1) in paragraph (3)—
 *         (A) in subparagraph (B), by striking ``or'' at the end;
 *         (B) in subparagraph (C), by striking the period and inserting ``; or''; and
 *         (C) by adding at the end the following:
 *     ``(D) a contract of sale of a digital commodity.'';
 *
 * The last step written is "in subparagraph (C)", so the new subparagraph (D)
 * was scoped to (a)(3)(C) — drawn *inside* (C), when (D) is plainly its sibling
 * and belongs at the end of paragraph (3). Every count stayed green while the
 * new language was being attached one level too deep.
 *
 * The added block states its own depth, in the only way that survives PDF
 * extraction: the style of its leading marker. (D) is a subparagraph, so its
 * parent is the nearest enclosing paragraph — the walked path with everything at
 * subparagraph depth or below dropped. The same rule puts a new ``(iv)'' beside
 * clause (iii) rather than inside it, and a new ``(f)'' at the end of the
 * section rather than inside a subparagraph four levels down.
 *
 * An addition with no leading marker — "adding at the end the following flush
 * sentence: ``The preceding sentence shall not apply…''" — carries no depth
 * signal and is left exactly where the instruction walked to, which is where a
 * flush sentence does in fact go.
 */
function scopeAdditions(ops) {
  for (const op of ops) {
    if (op.type !== 'add-at-end' || !op.text || !op.scope) continue;
    const lead = op.text.match(/^\s*(\([A-Za-z0-9]{1,8}\))/);
    if (!lead) continue;
    const depth = markerDepth(lead[1]);
    const kept = (op.scope.match(MARKER_RE) || []).filter((mk) => markerDepth(mk) < depth);
    op.scope = kept.join('');
  }
}

/**
 * "by inserting after subparagraph (C) the following" places a whole provision
 * among siblings, so it is scoped to the anchor itself.
 *
 * The renderer calls additionsAt() for every node once it has laid out that
 * node's children, so an op scoped to "(a)(3)(C)" draws immediately after
 * subparagraph (C)'s entire subtree — which is what "after subparagraph (C)"
 * means. Scoping it to the walked path instead would draw it inside whatever
 * the instruction had navigated to, which is the same mistake scopeAdditions()
 * exists to undo for add-at-end.
 *
 * The anchor's depth truncates the walked path the same way, because the walk
 * may have gone deeper than the anchor: "in paragraph (3)— (B) in subparagraph
 * (C), by inserting after subparagraph (C) the following" must not compose
 * "(a)(3)(C)(C)".
 *
 * Only ever promoted when the inserted text opens with its own marker. Without
 * one this is a phrase being woven into a sentence, and drawing it as a block
 * would be a different claim entirely.
 */
function scopeUnitInserts(ops) {
  for (const op of ops) {
    if (op.type !== 'insert' || !op.unitAnchor || !op.text) continue;
    if (!/^\s*(?:``|‘‘|["“])?\s*\([A-Za-z0-9]{1,8}\)/.test(op.text)) continue;
    // The anchor may be a chain — "after subparagraph (B)(ii) the following new
    // clause" places the new clause among (B)'s clauses, not among the
    // subparagraphs. Truncate the walked path above the chain's OUTERMOST
    // marker and append the whole chain; keying on the anchor's first marker
    // alone put a clause where a subparagraph goes.
    const chain = op.unitAnchor.match(MARKER_RE) || [];
    if (!chain.length) continue;
    // The added block's own leading marker states the level the new provision
    // belongs at, which is the one signal that survives extraction — the same
    // one scopeAdditions() reads. The anchor chain is then trimmed to that
    // level: "inserting after subparagraph (H)(iii) the following: ``(I) …''"
    // names the end of (H) but adds a SUBPARAGRAPH, so it belongs after (H),
    // not after (H)'s last clause. (H.R. 1865 does exactly this, having just
    // redesignated the old (I) as (K) to make room.)
    const added = op.text.match(/^\s*(?:``|‘‘|["“])?\s*(\([A-Za-z0-9]{1,8}\))/);
    const addedDepth = markerDepth(added[1]);
    const anchorPath = chain.filter((mk) => markerDepth(mk) <= addedDepth);
    if (!anchorPath.length) continue;
    const depth = markerDepth(anchorPath[0]);
    const kept = ((op.scope || '').match(MARKER_RE) || []).filter((mk) => markerDepth(mk) < depth);
    op.scope = kept.join('') + anchorPath.join('');
    // Routed to the structural placer in redline.js rather than to apply(),
    // which weaves text into one passage and cannot see where a subtree ends.
    op.placement = 'after-unit';
  }
}

function placeOps(text, ops) {
  const spans = ops.filter((o) => o.start != null).sort((a, b) => a.start - b.start);
  for (let i = 0; i < spans.length; i++) {
    const op = spans[i];
    if (op.type === 'strike') {
      const after = text.slice(op.end, op.end + 60);
      // "striking ``A'' each place it appears" — struck throughout, not once.
      if (RE_EACH_PLACE.test(after)) op.all = true;
      // "by striking ``and'' at the end" — the operand is a word that occurs all
      // over the provision, and the one meant is the last. Without this the
      // strike lands in the first sentence of the subsection instead of on the
      // semicolon-and that closes it.
      if (RE_AT_THE_END.test(after)) op.atEnd = true;
      continue;
    }
    if (op.type !== 'insert') continue;

    const prev = spans[i - 1];
    if (prev && prev.type === 'strike' && op.start - prev.end < 100) {
      if (RE_REPLACES.test(text.slice(prev.end, op.start))) {
        op.replaces = prev.start;
        continue;
      }
    }
    const m = text.slice(op.end, op.end + 260).match(RE_ANCHORED);
    if (m) {
      op.relation = m[1].toLowerCase();
      op.anchor = m[2];
      continue;
    }
    // Nothing quoted to anchor to. Look back for a unit anchor instead — this
    // is a whole new provision taking its place among siblings, not a phrase
    // woven into a sentence.
    // op.start points INSIDE the quotes, so the window ends with the opener
    // itself. Trim it, or the tempered tail — which exists to stop the phrase
    // being read across an earlier operand — can never reach the end.
    const before = text
      .slice(Math.max(0, op.start - 200), op.start)
      .replace(/(?:``|‘‘|["“])\s*$/, '');
    const u = before.match(RE_UNIT_ANCHOR);
    if (u) op.unitAnchor = u[2];
  }
}

// How far past the instruction head its operations can run. Amendments nest
// ("(1) by striking...; (2) by inserting..."), so the body needs room — but
// letting it run to the next head made one instruction span 57k characters of
// unrelated bill text and swallow everything in between.
const MAX_AMEND_BODY = 2500;

// The operative verbs inside an amendment, and the language they quote.
//
// Quote style varies by source and every one of these must work: govinfo plain
// text uses the typewriter convention ``like this'', pasted text often has
// straight "like this", some sources use curly “like this”, and GPO's typeset
// PDFs use *doubled singles* — ‘‘like this’’ — which is what pdf.js hands back
// for every bill printed by the Government Publishing Office.
//
// That last pair was missing, and because it is the only quote style in a
// typeset bill the cost was total: not one struck or inserted operand was
// extracted from any PDF, so the diff preview — the thing the app is for — came
// up empty for every PDF bill while the text path looked fine. It went unseen
// because the only PDF fixture, the FRONTIER Act, is freestanding and has no
// amendments at all. 46 "striking" and 69 "inserting" instructions in the
// House-passed CLARITY Act yielded zero operands.
//
// A LONE curly single is still deliberately not a delimiter — U+2019 is far
// more often an apostrophe ("the Nation’s") and would close a quoted string in
// the middle of a word. Both single-quote conventions therefore take two
// characters to open or close; only the unambiguous double quotes take one.
const QO = '(?:``|‘‘|[“"])';
const QC = '(?:\'\'|’’|[”"])';

// The connective between verb and operand varies a lot ("striking out",
// "inserting after paragraph (8) the following:", with the quote often on the
// next line), so it's bounded and lazy. It's also tempered against the opposite
// verb: in "striking paragraph (3) and inserting ``X''" the strike has no quoted
// operand, and without the guard it would reach across and report X as struck.
const RE_STRIKE = new RegExp(
  `strik(?:e|ing)\\b(?:(?!insert)[\\s\\S]){0,60}?${QO}([\\s\\S]{1,400}?)${QC}`, 'gi');
const RE_INSERT = new RegExp(
  `insert(?:ing)?\\b(?:(?!strik)[\\s\\S]){0,120}?${QO}([\\s\\S]{1,400}?)${QC}`, 'gi');
const RE_ADD_END = /adding\s+at\s+the\s+end\s+the\s+following/gi;

// "by inserting after subparagraph (C) the following new subparagraph:" —
// anchored to a UNIT rather than to a quoted phrase, and looking backwards from
// the operand rather than forwards, because here the anchor is written before
// the language it places.
//
// These were being dropped on the floor. An insert with neither `replaces` nor
// `anchor` is never drawn by apply(), so a bill adding a whole new subparagraph
// this way showed nothing at all — not misplaced, invisible. 2,801 of the
// corpus's 9,828 insert ops reach apply() with neither, and this is the largest
// family in that set with a structural answer.
//
// Anchored to the end of the searched window so that the phrase found is the one
// immediately preceding THIS operand: a quote opener in between means the phrase
// belongs to an earlier instruction.
const RE_UNIT_ANCHOR = new RegExp(
  `\\binsert(?:ing)?\\s+(after)\\s+(?:the\\s+)?` +
  `(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem)s?\\s+` +
  `(\\([A-Za-z0-9]{1,8}\\)(?:\\([A-Za-z0-9]{1,8}\\))*)(?:(?!${QO})[\\s\\S]){0,60}$`,
  'i'
);

// The commonest way a bill creates new law, and for a long time the one whose
// language was never captured: "by adding at the end the following new
// paragraph:" followed by the paragraph itself. The op recorded that an addition
// happened and nothing about what was added, so the redline had nothing to draw
// and the panel could only say "adds new language at the end".
//
// Reading the block needs the opener and closer as a *pair* — QO/QC above are
// alternations, which is right for "find any quoted operand" and wrong here,
// because a block opened with `` must be closed by '' and not by a curly double
// that happens to appear inside it.
const QUOTE_PAIRS = [
  ['``', "''"],
  ['‘‘', '’’'],
  ['“', '”'],
  ['"', '"'],
];

// Between the phrase and the block sits an optional unit ("new paragraph:",
// "new flush sentence:", "new subchapter:") and, in a typeset PDF, a page break
// with its furniture — "•HR 3633 EH1S", a page number, blank lines. None of it
// contains a quote opener, which is what makes "everything up to the opener"
// a safe way across. 120 characters covers the longest real gap seen; beyond
// that the phrase and the block are unrelated.
const ADD_END_GAP = /^[^`‘“"]{0,120}(?=``|‘‘|[“"])/;

// …but the crossing must not step over another instruction on the way.
//
//     is amended by adding at the end the following new subclause:
//         (A) in subclause (VI), by striking ``and'' at the end;
//
// The next quote opener there belongs to the *strike*, and reading up to it
// reported "and" — a word being removed from the statute book — as the new
// language this bill adds. One of these verbs in the gap means the quote that
// follows is that verb's operand, not the block this phrase introduced.
//
// Only the verbs that take a quoted operand. "amend" is not one of them and
// appears in the gap legitimately — "adding at the end the following new
// section (and amending the table of sections accordingly):" is three real
// additions that a broader guard threw away.
const ADD_END_INTERVENING = /\b(?:strik|insert|redesignat)/i;

// A runaway guard, not a judgement about length: added blocks legitimately run
// to tens of thousands of characters when a bill adds a whole chapter (the
// largest in the corpus is 59k). Past this the closer was almost certainly
// missed and the "block" is the rest of the bill.
const MAX_ADDED = 60000;

/**
 * Read the block of new law introduced by "adding at the end the following".
 *
 * Searched in the whole bill, not in the instruction's body: the body is capped
 * at MAX_AMEND_BODY so that one instruction cannot swallow the next, and an
 * added block is routinely longer than that cap on its own.
 *
 * The first closer wins. In every convention bills actually use, a multi-
 * paragraph block opens each paragraph with a quote mark and closes only once,
 * at the very end — so there are no intermediate closers to step over, and a
 * nested single-quoted term (`covered entity') is not a closer because both
 * single conventions take two characters. Measured across the corpus, that rule
 * ends the block correctly at 3,251 of 3,253 sites; the two exceptions write
 * each added subparagraph as its own closed quote, where this reads the first
 * and stops — short of the whole addition rather than wrong about it.
 *
 * @returns {{start:number,end:number}|null} absolute offsets of the added text,
 *   or null where the block cannot be delimited — in which case the caller still
 *   records that an addition happens, just not what it says.
 */
function readAddedBlock(text, from) {
  const g = text.slice(from, from + 200).match(ADD_END_GAP);
  if (!g || ADD_END_INTERVENING.test(g[0])) return null;
  const openAt = from + g[0].length;
  const pair = QUOTE_PAIRS.find(([open]) => text.startsWith(open, openAt));
  if (!pair) return null;
  const start = openAt + pair[0].length;
  const close = text.indexOf(pair[1], start);
  if (close < 0 || close - start > MAX_ADDED) return null;
  return { start, end: close };
}
// Both sides of a redesignation are ranges: "redesignating clauses (v) through
// (vii) as clauses (vi) through (viii)". The second group used to take a single
// marker, so the panel read "clauses (v) through (vii) → clauses (vi)" — an
// arrow pointing at a range with its end cut off, which reads as renumbering
// three clauses into one.
const REDESIG_LIST =
  '(?:subsection|paragraph|subparagraph|clause|item|section)s?\\s*\\([A-Za-z0-9]{1,8}\\)' +
  '(?:\\s*(?:,|and|or|through)\\s*\\([A-Za-z0-9]{1,8}\\))*';
const RE_REDESIG = new RegExp(
  `redesignat(?:e|ing)\\s+(${REDESIG_LIST})\\s+as\\s+(${REDESIG_LIST})`, 'gi'
);

// Navigation steps inside an amendment body:
//
//   Section 40007(a) of the ... Act (49 U.S.C. 44504) is amended—
//     (1) in paragraph (3)(B)—
//       (A) in clause (iv), by inserting ``and sustainable aviation fuel'' ...
//
// "paragraph (3)(B)" and "clause (iv)" are not vague cross-references — they are
// an address, read relative to the enclosing amendment's target and to each
// other. Composed, that clause is 49 U.S.C. 44504(a)(3)(B)(iv). Treating them as
// generic internal refs throws away the one thing the reader needs.
//
// A unit reference phrase, in every shape bills actually write it:
//   paragraph (3)(B)
//   subparagraph (C) of paragraph (2) of subsection (a)     <- inside-out order
//   subparagraphs (A) and (B)                               <- list
//   clauses (i) through (iii)                               <- range
const UNIT_WORDS = '(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem)s?';
const MARKER = '\\([A-Za-z0-9]{1,8}\\)';
// The group is load-bearing: `${MARKER}+` would apply the + to the trailing
// escaped paren, matching "(a)))" rather than "(a)(2)(C)".
const MARKER_PATH = `(?:${MARKER})+`;
const MARKER_LIST = `${MARKER_PATH}(?:\\s*(?:,\\s*|\\band\\b|\\bor\\b|\\bthrough\\b|\\bto\\b)\\s*${MARKER_PATH})*`;
const UNIT_PHRASE = `${UNIT_WORDS}\\s+${MARKER_LIST}(?:\\s+of\\s+${UNIT_WORDS}\\s+${MARKER_LIST})*`;

const RE_NAV = new RegExp(`\\bin\\s+(${UNIT_PHRASE})`, 'gi');
// "in the matter preceding subparagraph (A), by striking ..." — 734 of these
// across the corpus, 692 "preceding" and 42 "following", which makes it the
// largest navigation shape nothing handled.
//
// It names the flush text of (A)'s PARENT: the words that introduce the list
// (A) belongs to, or close it. RE_NAV cannot see it because "the matter
// preceding" sits between "in" and the unit phrase, so pass 2 picked up
// "subparagraph (A)" as a bare reference and the operation was never scoped at
// all.
//
// "preceding" and "following" resolve to the same place on purpose. Both are
// the parent's own text; which half is not something the provision tree
// records, and inventing a distinction it cannot represent would be a claim
// the data does not support.
const RE_NAV_MATTER = new RegExp(
  `\\bin\\s+the\\s+matter\\s+(?:preceding|following)\\s+(${UNIT_PHRASE})`,
  'gi'
);
const RE_REF = new RegExp(`\\b(${UNIT_PHRASE})`, 'gi');
const RE_PAIR = new RegExp(`(${UNIT_WORDS})\\s+(${MARKER_LIST})`, 'gi');
const RE_LIST_SEP = /\s*(?:,\s*|\band\b|\bor\b|\bthrough\b|\bto\b)\s*/;

/**
 * Is this reference an *instruction* to descend, or just a mention?
 *
 * "(1) in subparagraph (E)--" navigates. But quoted text being inserted is full
 * of ordinary cross-references — "a projection described in subparagraph (A)" —
 * and letting those move the cursor silently reparents every later step in the
 * instruction. Navigation only counts at the head of an instruction: start of
 * line, after the bill's own outline marker, after a dash, or after "amended".
 */
function isInstructionPosition(before) {
  return /(?:^|--|—|–|\bamended\b|[.;:])\s*(?:\([A-Za-z0-9]{1,8}\)\s*)?(?:(?:and|by)\s+)?$/.test(before);
}

/**
 * The same question for "in the matter preceding X", which is written
 * differently.
 *
 * A bare unit reference after a comma is a mention, not a step — that is why
 * isInstructionPosition() stops at "[.;:]" — but "in subsection (d)(2), in the
 * matter preceding subparagraph (A), by striking …" is the ordinary way this
 * phrase is written, and rejecting the comma loses most of them.
 *
 * The open paren is still rejected, and that is the guard doing real work: 167
 * of the corpus's 932 occurrences sit inside a parenthetical — "the requirement
 * described in section 1101(a)(15) (in the matter preceding subparagraph (A))"
 * — which describes a provision rather than instructing anyone to amend it.
 */
function isMatterPosition(before) {
  return /(?:^|--|—|–|\bamended\b|[.;:,])\s*(?:\([A-Za-z0-9]{1,8}\)\s*)?(?:(?:and|by)\s+)?$/.test(
    before
  );
}

// Statutory hierarchy. The unit word states its own depth, which is what makes
// these references resolvable at all: "clause (iv)" is the 4th level down, no
// matter where it appears or how the bill happens to have numbered its own
// instructions.
const UNIT_DEPTH = {
  subsection: 0,
  paragraph: 1,
  subparagraph: 2,
  clause: 3,
  subclause: 4,
  item: 5,
  subitem: 6,
};

const MARKER_RE = /\([A-Za-z0-9]{1,8}\)/g;

/**
 * Walk an amendment body and compose each navigation step into a full path.
 *
 * Each step *replaces* the running path from its own depth downward rather than
 * only appending. That distinction is the whole correctness argument: after
 * descending to a clause, a following "subsection (c)" is a jump back to the top
 * level, and blind appending yields 801(a)(2)(A)(c) — a subsection nested inside
 * a subparagraph, which cannot exist. Truncating to the unit's depth also makes
 * sibling steps ("in clause (iv)" then "in clause (v)") fall out for free.
 *
 * @param {string} text      whole bill
 * @param {number} from      first offset of the body (just past the head)
 * @param {number} to        end of the body
 * @param {string} basePath  the target's own subsection path, e.g. "(a)"
 */
/** Split a unit phrase into its (unit, markers) pairs, in text order. */
function unitPairs(phrase) {
  const pairs = [];
  RE_PAIR.lastIndex = 0;
  let m;
  while ((m = RE_PAIR.exec(phrase))) {
    const unit = m[1].toLowerCase().replace(/s$/, '');
    const depth = UNIT_DEPTH[unit];
    if (depth === undefined) continue;
    pairs.push({
      unit,
      depth,
      // "(A) and (B)" is two addresses; "(a)(2)(C)" is one, three levels deep.
      items: m[2].split(RE_LIST_SEP).map((s) => s.trim()).filter(Boolean),
      offset: m.index,
      raw: m[0],
    });
  }
  return pairs;
}

/** Place a marker path at `depth`, discarding anything at that depth or below. */
function place(levels, depth, markerPath) {
  const kept = levels.filter((l) => l.depth < depth);
  const added = (markerPath.match(MARKER_RE) || []).map((marker, i) => ({ marker, depth: depth + i }));
  return [...kept, ...added];
}

/**
 * Resolve one unit phrase against the running context.
 *
 * The first pair is the subject; any "of ..." pairs after it name the subject's
 * ancestors and are applied shallowest-first before the subject itself. That is
 * what makes the inside-out drafting order work — "subparagraph (C) of paragraph
 * (2) of subsection (a)" states its own address backwards, and reading only the
 * leading pair yields a bare (C) hanging off whatever happened to precede it.
 *
 * Returns one entry per item in the subject's list, so "subparagraphs (A) and
 * (B)" produces two addresses rather than silently dropping the second.
 */
function resolvePhrase(pairs, contextLevels) {
  if (!pairs.length) return null;
  const [subject, ...ancestors] = pairs;

  let base = contextLevels;
  for (const a of [...ancestors].sort((x, y) => x.depth - y.depth)) {
    base = place(base, a.depth, a.items[0]);
  }

  const addresses = subject.items.map((item) => ({
    item,
    levels: place(base, subject.depth, item),
  }));
  return { subject, addresses };
}

/**
 * Walk an amendment body and turn every unit reference into a full address.
 *
 * Two categories, and the distinction matters:
 *   steps — "in subparagraph (A)—" is an instruction to descend. It moves the
 *           cursor, so everything after it reads relative to the new position.
 *   refs  — "after clause (i)", "by redesignating clauses (ii) and (iii)" name a
 *           provision without descending into it. They resolve against wherever
 *           the cursor currently is, and must NOT move it — treating them as
 *           navigation would reparent every following instruction.
 *
 * @param {string} text      whole bill
 * @param {number} from      first offset of the body (just past the head)
 * @param {number} to        end of the body
 * @param {string} basePath  the target's own subsection path, e.g. "(a)"
 */
// A line that OPENS quoted law the bill is inserting. GPO opens every quoted
// paragraph with a quote mark and closes only at the end of the whole block, so
// this marks the start of a run rather than each line of it — the reference that
// exposed the bug sat on a *continuation* line ("…in accordance \n with
// subparagraph (B)(iii) as having a…"), which carries no quote mark at all.
const RE_QUOTED_LINE = /^\s*(?:``|‘‘|["“])/;
// …and what ends the run. Deliberately two characters for the single-quote
// conventions: a lone ’ is an apostrophe, and the blocks are full of defined
// terms in single quotes (`applicable material') that must not close anything.
const RE_QUOTE_CLOSE = /''|’’|[”]/;

/** Inline quoted operands on one line, as [start, end) spans. */
function quotedSpans(line) {
  const re = new RegExp(`${QO}[\\s\\S]*?${QC}`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(line))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Compose the addresses an instruction navigates to and refers to.
 *
 * References inside quoted *inserted* text are excluded, and that exclusion is
 * the difference between a useful address and a wrong one. New law refers to
 * itself constantly — a paragraph the bill is adding says "For purposes of
 * subparagraph (A)", meaning subparagraph (A) *of the paragraph being added*,
 * which does not exist in the Code yet. Composed against the instruction's
 * target it became 7 U.S.C. 8101(3)(A): a real provision, about something else
 * entirely, presented as the referent.
 *
 * Navigation was already guarded by isInstructionPosition; references were not,
 * so half the rule was in place. Left alone, these stay plain internal refs and
 * locateInternal finds them where they actually are — a few lines up in the
 * quoted block.
 */
function extractSteps(text, from, to, basePath) {
  const steps = [];
  const refs = [];
  // Each open level carries its semantic depth, not merely its position. The two
  // diverge whenever the bill skips a level: with no base subsection, a bare
  // "paragraph (1)" sits at position 0 while still *being* depth 1, and keying
  // off position would make the next "paragraph (2)" nest inside it as (1)(2).
  let current = (basePath.match(MARKER_RE) || []).map((marker, i) => ({ marker, depth: i }));
  let off = from;
  let inQuotedBlock = false;

  for (const line of text.slice(from, to).split('\n')) {
    const lineStart = off;
    off += line.length + 1;

    // Quoted inserted law: not an instruction, and its cross-references point
    // inside itself rather than into the Code. The run persists across
    // continuation lines and ends on the line that closes the quotation.
    if (RE_QUOTED_LINE.test(line)) inQuotedBlock = true;
    const inserted = inQuotedBlock;
    if (inserted && RE_QUOTE_CLOSE.test(line)) inQuotedBlock = false;
    if (inserted) continue;

    // Pass 1: navigation. Records the spans it claims so pass 2 skips them.
    const claimed = [];

    RE_NAV.lastIndex = 0;
    let nm;
    while ((nm = RE_NAV.exec(line))) {
      if (!isInstructionPosition(line.slice(0, nm.index))) continue;
      const phraseStart = nm.index + nm[0].indexOf(nm[1]);
      const resolved = resolvePhrase(unitPairs(nm[1]), current);
      if (!resolved) continue;
      claimed.push([phraseStart, nm.index + nm[0].length]);
      emit(steps, resolved, line, lineStart, phraseStart, nm[1]);
      // Only the first address of a list advances the cursor.
      current = resolved.addresses[0].levels;
    }

    // Pass 1b: "in the matter preceding X".
    //
    // After pass 1 and before pass 2, and both halves of that matter. It needs
    // the cursor this line's own navigation has already moved — "in subsection
    // (d)(2), in the matter preceding subparagraph (A)" only has a parent to
    // name once (d)(2) is in hand — and it has to claim the span before pass 2
    // reads the "(A)" inside it as a bare reference to the very provision this
    // instruction identifies itself by staying out of.
    //
    // RE_NAV cannot claim it first: it matches "in <unit>", and here "in" is
    // followed by "the".
    RE_NAV_MATTER.lastIndex = 0;
    let mm;
    while ((mm = RE_NAV_MATTER.exec(line))) {
      if (!isMatterPosition(line.slice(0, mm.index))) continue;
      const resolved = resolvePhrase(unitPairs(mm[1]), current);
      if (!resolved || !resolved.addresses.length) continue;
      const levels = resolved.addresses[0].levels;
      // No parent, no matter. "In the matter preceding subsection (a)" would be
      // the section's own opening text, which is not addressable as a path.
      if (levels.length < 2) continue;
      const parent = levels.slice(0, -1);
      claimed.push([mm.index, mm.index + mm[0].length]);
      steps.push({
        start: lineStart + mm.index,
        end: lineStart + mm.index + mm[0].length,
        text: line.slice(mm.index, mm.index + mm[0].length),
        unit: 'matter',
        markers: resolved.addresses[0].item,
        path: parent.map((l) => l.marker).join(''),
        // The whole point. An op scoped here belongs to the parent's own text
        // and NOT to its children — "preceding subparagraph (A)" excludes (A)
        // by name. See inScope() in app/ui/redline.js.
        exact: true,
      });
      current = parent;
    }


    // Pass 2: bare references anywhere else on the line, except inside an
    // inline quoted operand — "by striking ``paragraph (3)''" quotes the words,
    // it does not refer to the paragraph.
    const quoted = quotedSpans(line);
    RE_REF.lastIndex = 0;
    let rm;
    while ((rm = RE_REF.exec(line))) {
      const s = rm.index;
      if (claimed.some(([a, b]) => s < b && s + rm[0].length > a)) continue;
      if (quoted.some(([a, b]) => s < b && s + rm[0].length > a)) continue;
      const resolved = resolvePhrase(unitPairs(rm[1]), current);
      if (!resolved) continue;
      emit(refs, resolved, line, lineStart, s, rm[1]);
    }
  }
  return { steps, refs };
}

/** Turn a resolved phrase into one entry per address, with exact offsets. */
function emit(out, resolved, line, lineStart, phraseStart, phrase) {
  const { subject, addresses } = resolved;
  let cursor = 0;
  addresses.forEach((addr, i) => {
    const idx = phrase.indexOf(addr.item, cursor);
    if (idx === -1) return;
    cursor = idx + addr.item.length;
    // The first address wears the unit word ("clauses (ii)"); later items in a
    // list are just their own marker, so the chips never overlap.
    const start = i === 0 ? phraseStart : phraseStart + idx;
    const end = phraseStart + idx + addr.item.length;
    out.push({
      start: lineStart + start,
      end: lineStart + end,
      text: line.slice(start, end),
      unit: subject.unit,
      markers: addr.item,
      path: addr.levels.map((l) => l.marker).join(''),
    });
  });
}

/**
 * Turn each amendment's navigation steps into first-class citations that inherit
 * the amendment's target, so they resolve and render like any other chip.
 *
 * Returns a new citation list; internal refs overlapping a resolved step are
 * dropped, since the composed address strictly supersedes them.
 */
export function expandRelativeRefs(citations, amendments) {
  const extra = [];
  for (const am of amendments) {
    const t = am.target;
    if (!t || (t.kind !== 'usc' && t.kind !== 'cfr')) continue;
    for (const st of [...(am.steps || []), ...(am.refs || [])]) {
      extra.push({
        ...t,
        id: `r${extra.length}`,
        text: st.text,
        start: st.start,
        end: st.end,
        subsection: st.path,
        ladder: subsectionLadder(st.path),
        // Flags for the UI: this address was composed from context, not written
        // out in the bill, so it's worth showing how it was derived.
        relative: true,
        relUnit: st.unit,
        relMarkers: st.markers,
        viaAmendment: am.id,
        viaTarget: t.text,
      });
    }
  }
  if (!extra.length) return citations;

  const kept = citations.filter((c) => !extra.some((e) => c.start < e.end && c.end > e.start));
  return [...kept, ...extra].sort((a, b) => a.start - b.start);
}

// Internal cross-references: "section 4(a) of this Act", "subsection (b)".
const RE_INTERNAL = new RegExp(
  '\\b(?:(section|sec\\.)\\s+(\\d+[A-Za-z]*)' +
    `(${SUBSEC})\\s+of\\s+this\\s+(Act|title|section)` +
    '|(subsection|paragraph|subparagraph|clause)\\s+(\\([A-Za-z0-9]{1,8}\\)(?:\\([A-Za-z0-9]{1,8}\\))*))',
  'gi'
);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function push(out, m, kind, extra) {
  // Some patterns intentionally start with a boundary group (punctuation or a
  // leading space) that isn't part of the citation. Trim it off the offsets so
  // the highlight lands on the citation text itself.
  const raw = m[0];
  const lead = raw.length - raw.replace(/^[\s.;:—)]+/, '').length;
  out.push({
    kind,
    text: raw.slice(lead),
    start: m.index + lead,
    end: m.index + raw.length,
    ...extra,
  });
}

/** Build the zoom-out ladder for a subsection path: (s)(2)(B) -> ["", "(s)", "(s)(2)", "(s)(2)(B)"]. */
export function subsectionLadder(path) {
  if (!path) return [''];
  const parts = path.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  const ladder = [''];
  let acc = '';
  for (const p of parts) {
    acc += p;
    ladder.push(acc);
  }
  return ladder;
}

export function extractCitations(text) {
  const out = [];
  let m;

  RE_USC.lastIndex = 0;
  while ((m = RE_USC.exec(text))) {
    push(out, m, 'usc', {
      title: m[1],
      // A citation wrapped at its hyphen carries the line break inside the
      // section number; the number itself never contains whitespace.
      section: m[2].replace(/\s+/g, ''),
      subsection: m[3] || '',
      etSeq: Boolean(m[4]),
      ladder: subsectionLadder(m[3]),
    });
  }

  RE_USC_LONG.lastIndex = 0;
  while ((m = RE_USC_LONG.exec(text))) {
    push(out, m, 'usc', {
      title: m[3],
      section: m[1],
      subsection: m[2] || '',
      etSeq: false,
      ladder: subsectionLadder(m[2]),
    });
  }

  for (const { act, re } of RE_ACT_SECTION) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      push(out, m, 'usc', {
        title: act.title,
        section: m[1],
        subsection: m[2] || '',
        etSeq: false,
        ladder: subsectionLadder(m[2]),
        viaAct: act.name,
      });
    }
  }

  // Still an `act` citation, not a `usc` one: the Code section is not known
  // until the resolver has read the Act's table, and asserting one here would be
  // asserting the very equivalence this exists because it cannot be assumed.
  for (const { act, re } of RE_ACT_REL_SECTION) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      push(out, m, 'act', {
        act,
        actSection: m[1],
        subsection: m[2] || '',
        ladder: subsectionLadder(m[2]),
      });
    }
  }

  RE_CFR.lastIndex = 0;
  while ((m = RE_CFR.exec(text))) {
    const unit = (m[2] || '').toLowerCase().replace(/s$/, '');
    const num = m[3];
    // "40 CFR 60.1" -> part 60, section 60.1. "40 CFR part 60" -> part 60, no section.
    const isSection = num.includes('.') && !unit.startsWith('part') && !unit.startsWith('chapter');
    push(out, m, 'cfr', {
      title: m[1],
      unit: unit || (isSection ? 'section' : 'part'),
      part: isSection ? num.split('.')[0] : num,
      section: isSection ? num : '',
      subsection: m[4] || '',
      ladder: subsectionLadder(m[4]),
    });
  }

  RE_PUBLAW.lastIndex = 0;
  while ((m = RE_PUBLAW.exec(text))) {
    push(out, m, 'publaw', { congress: m[1], law: m[2] });
  }

  RE_PUBLAW_SECTION.lastIndex = 0;
  while ((m = RE_PUBLAW_SECTION.exec(text))) {
    push(out, m, 'publaw', {
      congress: m[4],
      law: m[5],
      actSection: m[1],
      subsection: m[2] || '',
      division: m[3] ? m[3].toUpperCase() : null,
      ladder: subsectionLadder(m[2]),
    });
  }

  RE_STAT.lastIndex = 0;
  while ((m = RE_STAT.exec(text))) {
    push(out, m, 'stat', { volume: m[1], page: m[2] });
  }

  RE_INTERNAL.lastIndex = 0;
  while ((m = RE_INTERNAL.exec(text))) {
    if (m[2]) {
      push(out, m, 'internal', {
        refType: 'section',
        section: m[2],
        subsection: m[3] || '',
        scope: (m[4] || 'Act').toLowerCase(),
      });
    } else {
      push(out, m, 'internal', {
        refType: (m[5] || '').toLowerCase(),
        section: '',
        subsection: m[6] || '',
        scope: 'section',
      });
    }
  }

  // Popular Act names ("the Clean Air Act"). Built once from the mapping table.
  for (const entry of POPULAR_NAMES) {
    const re = new RegExp(`\\b${entry.pattern}\\b`, 'gi');
    while ((m = re.exec(text))) {
      push(out, m, 'act', { act: entry });
    }
  }

  // "10 U.S.C. 1580 note" is NOT section 1580. A note is uncodified law printed
  // beneath a section, usually the very Act provision that created whatever the
  // section administers, so resolving it to the section shows a real provision
  // that is not the one cited. 815 of the corpus's 12,918 U.S.C. citations
  // (6.3%) are of this form.
  //
  // Flagged here, against each citation's own `end`, rather than at the two
  // push sites: the regex match end is not the citation end (push() adjusts for
  // boundary groups), and testing from the wrong offset reads as working while
  // flagging nothing at all.
  const cites = dedupe(out);
  for (const c of cites) {
    if (c.kind === 'usc') c.note = RE_NOTE_SUFFIX.test(text.slice(c.end, c.end + 8));
  }
  return cites;
}

// Specificity ranking. When two matches overlap we keep the more useful one:
// a real code citation beats a bare Act name, which beats a vague internal ref.
const RANK = { usc: 5, cfr: 5, publaw: 4, stat: 4, act: 3, internal: 1 };

function dedupe(all) {
  const sorted = all
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end || RANK[b.kind] - RANK[a.kind]);
  const kept = [];
  for (const c of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && c.start < prev.end) {
      // Overlap: replace the incumbent only if this match is strictly better.
      const better = RANK[c.kind] > RANK[prev.kind] ||
        (RANK[c.kind] === RANK[prev.kind] && c.end - c.start > prev.end - prev.start);
      if (better) kept[kept.length - 1] = c;
      continue;
    }
    kept.push(c);
  }
  return kept.map((c, i) => ({ ...c, id: `c${i}` }));
}

// ---------------------------------------------------------------------------
// Amendatory instructions
// ---------------------------------------------------------------------------

/**
 * Which amendment's effect should be shown when this citation is clicked?
 *
 * The redline is the reason the two panes sit side by side, and it was reachable
 * from exactly one control: the "▸ amends …" tag. Every other click — including
 * the one a reader is most likely to make, on the composed address "clause (iv)",
 * pressed *because* they want to see what happens to clause (iv) — resolved the
 * provision correctly and drew nothing on it.
 *
 * Two links count, and deliberately no more:
 *
 *   - a composed address belongs to the instruction it was derived from, by
 *     construction (`viaAmendment`);
 *   - an instruction's own target is the provision being changed.
 *
 * A citation that merely *sits inside* an instruction is not enough. Quoted
 * inserted language is full of cross-references to other statutes, and heading
 * one of those with "What this amendment does" would attribute the change to a
 * provision the bill never touches.
 */
export function amendmentFor(cite, amendments) {
  if (!cite || !amendments) return null;
  if (cite.viaAmendment) return amendments.find((a) => a.id === cite.viaAmendment) || null;
  return amendments.find((a) => a.target && a.target.id === cite.id) || null;
}

// "Except as otherwise expressly provided, whenever in this division an
// amendment … is expressed in terms of an amendment to a section …, the
// reference shall be considered to be made to a section … of the Internal
// Revenue Code of 1986."
//
// Every tax title carries this sentence, and it is what licenses the rest of the
// division to write "Section 403(b) is amended" with no Act named at all. Read
// literally those instructions amend nothing identifiable, which is how 219
// amendments across two appropriations bills — the SECURE Act and SECURE 2.0,
// the entire retirement-savings overhaul in each — came out with no target.
// Global: a bill declares this once per unit it applies to, and a tax bill has
// several. The Inflation Reduction Act carries one in each of two subtitles, and
// reading only the first left the whole of the second — the entire energy-credit
// half of the Act — with bare section numbers resolving to nothing.
const RE_1986_CODE =
  /whenever\s+in\s+this\s+(division|Act|title|subtitle)\b[\s\S]{0,400}?Internal\s+Revenue\s+Code\s+of\s+1986/gi;

/**
 * The span in which a bare "Section 403(b)" means the Internal Revenue Code.
 *
 * Scoped to the division holding the clause, never the whole bill. These
 * declarations live inside omnibus vehicles carrying twenty unrelated divisions,
 * and applying one Act-wide would relabel every bare section number in the other
 * nineteen as a tax provision — a confidently wrong answer, which is worse than
 * the blank it replaces.
 */
/**
 * A bare "Section 403(b) is amended", inside a division that declared the 1986
 * Code, resolves to 26 U.S.C. 403(b).
 *
 * Synthesised rather than found in the text: there is no citation to point at,
 * which is exactly the problem. Marked `implied` so the pane can say the Act was
 * supplied by the division's declaration rather than written in the instruction.
 * Safe because the IRC is the one Act whose own section numbers ARE the Code's —
 * doing this for the Social Security Act would give a confidently wrong section.
 */
function impliedIrc(h, ranges) {
  if (!ranges || !h.section) return null;
  if (!ranges.some((r) => h.start >= r.start && h.start < r.end)) return null;
  if (!/^[Ss]ection$/.test(h.unit)) return null;
  // Only where the instruction names no Act at all. "Section 5 of the Widget
  // Act" inside a tax division is still the Widget Act.
  if (/\bof\s+(?:the\s+|such\s+|title\s+)/i.test(h.middle)) return null;
  return {
    id: `i${h.start}`,
    kind: 'usc',
    text: `section ${h.section}${h.subsection}`,
    start: h.start,
    end: h.headEnd,
    title: '26',
    section: h.section,
    subsection: h.subsection || '',
    ladder: subsectionLadder(h.subsection || ''),
    implied: 'Internal Revenue Code of 1986',
  };
}

/**
 * "Section 9203 of such title is amended" — the title is whichever one the bill
 * last named.
 *
 * Anaphora is how a bill avoids writing "of title 10, United States Code" forty
 * times in a row, and a title-10 defence bill does exactly that: 305 of the
 * NDAA's instructions refer back rather than out, and every one of them reported
 * amending nothing. The referent is by definition the most recent U.S. Code
 * citation before this point, so that is what is carried forward.
 *
 * "such Act" is deliberately NOT handled. The section number in "section 251 of
 * such Act" is Act-relative, and Act numbering diverges from the Code's for
 * everything except the IRC — turning it into a U.S. Code cite would produce a
 * confidently wrong provision, which is the one outcome worse than a blank.
 */
function impliedSuch(h, citations) {
  if (!h.section) return null;
  // Sections only. "Chapter 9 of such title is amended" carries a chapter
  // number, and synthesising 10 U.S.C. § 9 from it points at an unrelated
  // provision that really exists — the worst kind of wrong, because it looks
  // right. Chapters are not addressable in shards keyed by section anyway.
  if (!/^[Ss]ection$/.test(h.unit)) return null;
  const anaphoric = /\bsuch\s+title\b/i.test(h.middle) || /\bsuch\s+$/i.test(h.inner);
  if (!anaphoric) return null;
  let nearest = null;
  for (const c of citations) {
    if (c.start >= h.start) break; // citations arrive in document order
    if (c.kind === 'usc' && c.title) nearest = c;
  }
  if (!nearest) return null;
  return {
    id: `s${h.start}`,
    kind: 'usc',
    text: `section ${h.section}${h.subsection} of title ${nearest.title}`,
    start: h.start,
    end: h.headEnd,
    title: nearest.title,
    section: h.section,
    subsection: h.subsection || '',
    ladder: subsectionLadder(h.subsection || ''),
    implied: `title ${nearest.title}, carried from the last title the bill named`,
  };
}

/**
 * "Subsection (c) of such section is amended" — the section is the one the
 * PREVIOUS INSTRUCTION was amending.
 *
 * Deliberately not "the nearest preceding U.S. Code citation", which is how
 * impliedSuch() resolves "of such title" and is wrong here. A bill's
 * instructions quote their operands, and a quoted operand is frequently a
 * citation: "…by striking ``section 3401''." leaves "section 3401" as the
 * nearest cite, and carrying it forward would attribute the next instruction to
 * a section the bill merely mentioned in passing. The enclosing instruction's
 * own resolved target is the referent the drafter meant, and it is the one
 * thing that cannot be a quotation.
 *
 * Restricted to U.S. Code targets for the reason impliedSuch() excludes "such
 * Act": a sub-unit of an Act-relative section is Act-relative too, and
 * presenting it as a Code address would be confidently wrong.
 */
function impliedSuchUnit(h, lastTarget) {
  if (!h.suchOf || !h.subsection) return null;
  if (!lastTarget || lastTarget.kind !== 'usc' || !lastTarget.title || !lastTarget.section) return null;
  // "…(10 U.S.C. 1580 note) is amended" targets a note, not section 1580, and
  // the section it names is somebody else's. Composing a subsection onto it
  // would take a pre-existing mis-resolution and spread it to the instructions
  // that refer back to it.
  if (lastTarget.note) return null;

  // "such section" replaces the previous target's own sub-path; "such
  // subsection"/"such paragraph" descends further into it. Getting this
  // backwards composes (c)(2) as (2) or (c)(c)(2).
  const base = h.suchOf === 'section' ? '' : lastTarget.subsection || '';
  const subsection = base + h.subsection;
  return {
    id: `u${h.start}`,
    kind: 'usc',
    text: `${h.unit} of section ${lastTarget.section} of title ${lastTarget.title}`,
    start: h.start,
    end: h.headEnd,
    title: lastTarget.title,
    section: lastTarget.section,
    subsection,
    ladder: subsectionLadder(subsection),
    implied:
      `section ${lastTarget.section} of title ${lastTarget.title}, carried from the ` +
      `instruction immediately before this one`,
  };
}

/**
 * A Public Law target, carrying the section number the instruction named.
 *
 * "Section 105(f)(1) of the Gulf of Mexico Energy Security Act of 2006
 * (43 U.S.C. 1331 note; Public Law 109-432) is amended" is an amendment to
 * section 105 of Pub. L. 109-432. The bare Public Law citation says which law
 * but not which section, and the section number is sitting in the head — so it
 * is attached, and resolve() then answers through the same Act-section index
 * and local Public Law text that "section N of Public Law X-Y" uses.
 *
 * A shallow copy, because resolve() memoises by citation and the same Public
 * Law is cited from many instructions with different sections.
 */
function publawTarget(h, cite) {
  if (!cite) return null;
  if (cite.kind !== 'publaw' || !h.section || cite.actSection) return cite;
  // Which division the instruction named, if any. An omnibus Public Law
  // restarts its section numbering in every division — Pub. L. 114-113 has a
  // section 110 in division B and another in division N — so the number alone
  // does not identify a provision. resolveActSection() answers from the Code's
  // credits, which state the division; this is what lets the resolver check
  // the two against each other instead of trusting the number. See the
  // division guard in app/resolve/index.js.
  const head = (h.inner || '') + (h.unit || '') + ' ' + (h.middle || '');
  const dm = head.match(/\bdiv(?:ision)?\.?\s+([A-Z]{1,2})\b/i);
  return {
    ...cite,
    actSection: h.section,
    subsection: h.subsection || '',
    ladder: subsectionLadder(h.subsection || ''),
    division: dm ? dm[1].toUpperCase() : null,
  };
}

function ircScopes(text, divisions) {
  RE_1986_CODE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = RE_1986_CODE.exec(text))) {
    const unit = m[1].toLowerCase();
    if (unit === 'act') return [{ start: 0, end: text.length }];

    // Match the unit the clause actually names. parseBill's `divisions` holds
    // every structural heading — DIVISION, TITLE, Subtitle, CHAPTER — so scoping
    // "this division" against all of them lands on the nearest *subtitle* and
    // ends at the next one, a window a few lines wide containing none of the
    // instructions the declaration governs.
    const rx = unit === 'division' ? /^DIVISION\b/i : unit === 'title' ? /^TITLE\b/i : /^Subtitle\b/i;
    const starts = divisions.filter((d) => rx.test(d.label)).map((d) => d.start).sort((a, b) => a - b);
    const open = starts.filter((s) => s <= m.index).pop();
    if (open == null) return [{ start: 0, end: text.length }];
    out.push({ start: open, end: starts.find((s) => s > open) ?? text.length });
  }
  return out.length ? out : null;
}

/**
 * Find amendatory instructions and pair each with the citation it operates on.
 *
 * The head ("Section 1861(s)(2) of the Social Security Act ... is amended") tells
 * us the target; the body that follows carries the strike/insert operations. We
 * bound the body at the next head so consecutive instructions don't bleed.
 *
 * @param {Array} divisions  from parseBill(), used only to scope the Internal
 *                           Revenue Code declaration above. Optional.
 */
export function extractAmendments(text, citations, divisions = []) {
  const ircRanges = ircScopes(text, divisions);
  const heads = [];
  let m;
  RE_AMEND_HEAD.lastIndex = 0;
  while ((m = RE_AMEND_HEAD.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[\s.;:—–)-]+/, '').length;
    heads.push({
      start: m.index + lead,
      headEnd: m.index + raw.length,
      inner: m[1] || '',        // "Subsection (a) of "
      unit: m[2],               // "Section"
      section: m[3],
      subsection: m[4] || '',
      middle: m[5] || '',       // "of the Social Security Act (42 U.S.C. 1395x(s)(2))"
      verb: m[7].toLowerCase(),
    });
  }

  // Registered as an ordinary head so it takes part in the sort and the
  // next-head body bounds, then expanded into one amendment per listed
  // provision at the end. Skipping that and matching it separately let the
  // *preceding* instruction's body run over this one and claim its operations.
  RE_AMEND_HEAD_EACH.lastIndex = 0;
  while ((m = RE_AMEND_HEAD_EACH.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[\s.;:—–)-]+/, '').length;
    heads.push({
      start: m.index + lead,
      headEnd: m.index + raw.length,
      each: true,
      inner: '',
      unit: m[1].replace(/\s+/g, ' ').trim(),
      section: '',
      subsection: '',
      middle: '',
      verb: m[3].toLowerCase(),
    });
  }

  RE_AMEND_HEAD_SUCH.lastIndex = 0;
  while ((m = RE_AMEND_HEAD_SUCH.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[\s.;:—–)-]+/, '').length;
    heads.push({
      start: m.index + lead,
      headEnd: m.index + raw.length,
      inner: '',
      unit: m[1].replace(/\s+/g, ' ').trim(), // "Subsection (c)"
      section: '',
      subsection: (m[1].match(MARKER_RE) || []).join(''),
      middle: m[3] || '',
      verb: m[5].toLowerCase(),
      // Which unit "such" points back at, so the target can be composed from
      // the previous instruction rather than guessed at from nearby text.
      suchOf: m[2].toLowerCase(),
    });
  }

  RE_AMEND_HEAD_UNIT.lastIndex = 0;
  while ((m = RE_AMEND_HEAD_UNIT.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[\s.;:—–)-]+/, '').length;
    heads.push({
      start: m.index + lead,
      headEnd: m.index + raw.length,
      // The whole phrase is the unit here — "The Securities Act of 1933" — so
      // there is no separate number to carry.
      inner: '',
      unit: m[1].replace(/\s+/g, ' ').trim(),
      section: '',
      subsection: '',
      middle: m[2] || '',
      verb: m[4].toLowerCase(),
    });
  }

  // Both matchers can land on the same instruction — "Subchapter II of chapter
  // 53" is a unit head, but the section-shaped matcher sees "chapter 53" inside
  // it. Keep the one that starts earliest, which is the one that captured the
  // full target phrase.
  heads.sort((a, b) => a.start - b.start || b.headEnd - a.headEnd);
  const merged = [];
  for (const h of heads) {
    const prev = merged[merged.length - 1];
    if (prev && h.start < prev.headEnd) continue;
    merged.push(h);
  }

  // The target the previous instruction resolved to, for anaphora. Threaded
  // rather than looked up, because "such section" means the section the bill was
  // just talking about — see impliedSuchUnit().
  let lastTarget = null;

  const out = merged.flatMap((h, i) => {
    const nextHead = i + 1 < merged.length ? merged[i + 1].start : text.length;
    const bodyEnd = Math.min(nextHead, h.headEnd + MAX_AMEND_BODY, text.length);
    const body = text.slice(h.headEnd, bodyEnd);

    // Prefer an explicit code citation inside the head — "(42 U.S.C. 1395x(s)(2))"
    // is unambiguous, whereas the bare section number is relative to some Act.
    // A Public Law or Statutes at Large cite is the last resort but is still an
    // answer: "Section 1201 of Public Law 103-434 (108 Stat. 4550) is amended"
    // names its target perfectly well, and leaving it targetless reported the
    // instruction as amending nothing at all. 153 amendments across the corpus,
    // and nearly every one in a public-lands bill, where uncodified Public Law
    // sections are the normal thing to amend.
    //
    // A "note" citation is NOT one of those. "Section 203(c) of the Judicial
    // Improvements Act of 1990 (Public Law 101-650; 28 U.S.C. 133 note)" names
    // an uncodified provision printed beneath 28 U.S.C. 133; the section itself
    // is "Appointment and number of district judges", which is a real provision
    // about something else. 319 amendments across the corpus targeted a note
    // this way and every one of them showed the wrong law. The parenthetical
    // almost always carries a Public Law beside it, and that IS the target —
    // so notes are skipped here and picked up by the publaw branch below,
    // carrying the head's own section number.
    const inHead = (c) => c.start >= h.start && c.start < h.headEnd;
    const target =
      citations.find((c) => (c.kind === 'usc' || c.kind === 'cfr') && !c.note && inHead(c)) ||
      citations.find((c) => c.kind === 'act' && inHead(c)) ||
      publawTarget(h, citations.find((c) => (c.kind === 'publaw' || c.kind === 'stat') && inHead(c))) ||
      impliedIrc(h, ircRanges) ||
      impliedSuch(h, citations) ||
      impliedSuchUnit(h, lastTarget) ||
      null;
    // "such" means the instruction immediately before this one, so EVERY
    // instruction updates the referent — including one whose target is an Act
    // or a Public Law, and including one with no target at all. Only usc
    // targets can be composed against (impliedSuchUnit declines the rest), so
    // recording them all is what makes an intervening instruction *break* the
    // chain rather than be stepped over.
    //
    // Skipping non-usc instructions instead reached back past them: "Subsection
    // (b) of such section", written after an instruction amending section
    // 235(a)(4) of an NDAA, was attributed to a 10 U.S.C. section named several
    // instructions earlier. Confidently wrong, and about a real provision.
    lastTarget = target;

    const ops = [];
    for (const [re, type] of [[RE_STRIKE, 'strike'], [RE_INSERT, 'insert']]) {
      re.lastIndex = 0;
      let om;
      while ((om = re.exec(body))) {
        // Absolute offsets of the quoted operand, so the bill pane can mark the
        // exact run of text this instruction adds or removes. The operand is the
        // last thing in the match (the connective precedes it), so lastIndexOf
        // lands on the operand even when the same words appear in the lead-in.
        const rel = om[0].lastIndexOf(om[1]);
        ops.push({
          type,
          text: om[1],
          start: h.headEnd + om.index + rel,
          end: h.headEnd + om.index + rel + om[1].length,
        });
      }
    }
    placeOps(text, ops);

    RE_REDESIG.lastIndex = 0;
    let rm;
    while ((rm = RE_REDESIG.exec(body))) {
      ops.push({ type: 'redesignate', from: rm[1], to: rm[2] });
    }
    // One op per occurrence, each carrying the language it adds. A single
    // instruction commonly adds at the end of more than one provision ("in
    // subsection (a), by adding at the end the following … ; in subsection (b),
    // by adding at the end the following …"), and a lone boolean reported those
    // as one nameless addition.
    //
    // start/end delimit the added language itself, like every other op that
    // carries text — the bill pane marks that span, and an offset that doesn't
    // round-trip to op.text mismarks it. They also sit just past the phrase, so
    // scopeOps() binds each addition to the subsection the instruction had
    // walked to and the new language lands under the provision it belongs to
    // rather than at the end of the whole section.
    RE_ADD_END.lastIndex = 0;
    let am;
    while ((am = RE_ADD_END.exec(body))) {
      const block = readAddedBlock(text, h.headEnd + am.index + am[0].length);
      // Undelimited: record that an addition happens without claiming to know
      // what it says, or where. Blank beats wrong.
      if (!block) { ops.push({ type: 'add-at-end' }); continue; }
      ops.push({
        type: 'add-at-end',
        text: text.slice(block.start, block.end),
        start: block.start,
        end: block.end,
      });
    }
    if (h.verb === 'repealed') ops.push({ type: 'repeal' });

    // One instruction over a list of provisions becomes one amendment per
    // provision, each anchored on its own list item. That keeps the model's
    // "one amendment, one target" shape — the alternative, a single amendment
    // holding four targets, would have to pick one to show and would be wrong
    // three times — and it lands each block on its own paragraph, since a list
    // item begins with an outline marker and so starts one.
    //
    // The operations stay pointed at the quoted language in the head, which is
    // where the bill actually writes it: the head sentence carries the diff and
    // each listed provision carries a labelled block. Duplicate op spans are
    // collapsed by the renderer, so the language is marked once, not four times.
    if (h.each) {
      const colon = text.indexOf(':', h.headEnd);
      const items = listedProvisions(
        text, colon >= 0 && colon < bodyEnd ? colon + 1 : h.headEnd, bodyEnd
      );
      if (items.length) {
        return items.map((it) => {
          const itemText = text.slice(it.start, it.end);
          const lt = itemText.match(RE_LISTED_TARGET) || [];
          const inSpan = (c) => c.start >= it.start && c.start < it.end;
          return {
            start: it.start,
            end: it.end,
            unit: lt[1] || 'Section',
            section: lt[2] || '',
            subsection: lt[3] || '',
            ladder: subsectionLadder(lt[3] || ''),
            verb: h.verb,
            target:
              citations.find((c) => (c.kind === 'usc' || c.kind === 'cfr') && inSpan(c)) ||
              citations.find((c) => c.kind === 'act' && inSpan(c)) ||
              null,
            actName: (itemText.match(/of\s+the\s+([A-Z][^(]{2,80}?Act(?:\s+of\s+\d{4})?)/) || [])[1] || null,
            // Copied, not shared: main.js rebuilds ops when it attaches the
            // struck-language check, and one instruction's result must not
            // appear on its three siblings.
            ops: ops.map((o) => ({ ...o })),
            steps: [],
            refs: [],
            // Provenance, so the pane can say this is one of several provisions
            // changed by the same instruction rather than a standalone edit.
            distributed: true,
            viaInstruction: h.start,
          };
        });
      }
      // No list found — fall through and report the instruction on its own
      // rather than dropping it silently.
    }

    // "Subsection (a) of section 3" — the inner unit narrows the target further.
    const innerSub = (h.inner.match(/\([A-Za-z0-9]{1,8}\)/g) || []).join('');
    const subsection = innerSub + h.subsection;

    // Nested "in paragraph (3)(B)" / "in clause (iv)" addresses, composed
    // against the target's own path. Anchored on the *codified* subsection
    // (target.subsection), not the Act-relative one, because that's the
    // numbering the resolved provision actually uses.
    const nav = extractSteps(text, h.headEnd, bodyEnd, (target && target.subsection) || '');
    scopeOps(ops, nav.steps);
    scopeAdditions(ops);
    scopeUnitInserts(ops);

    return [{
      start: h.start,
      end: bodyEnd,
      unit: h.unit.replace(/\.$/, ''),
      section: h.section,
      subsection,
      ladder: subsectionLadder(subsection),
      verb: h.verb,
      target,
      actName: (h.middle.match(/of\s+the\s+([A-Z][^(]{2,80}?Act(?:\s+of\s+\d{4})?)/) || [])[1] || null,
      ops,
      ...nav,
    }];
  });

  // Ids are assigned after expansion, so they stay dense and in document order
  // however many amendments a single head turned into. expandRelativeRefs keys
  // `viaAmendment` off these.
  out.forEach((a, i) => { a.id = `a${i}`; });
  return out;
}
