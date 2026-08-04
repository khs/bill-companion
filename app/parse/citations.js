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
// "division J of the Infrastructure Investment and Jobs Act" — an omnibus is
// cited by division, and the division is the address. Without this the phrase
// resolved to the head of the Act, which is to say it pointed 630 sections away
// from what was meant.
//
// Every Act gets one, not just the ones with a codified home: what makes this
// resolvable is the Public Law behind the name, and app/resolve/plaw.js holds
// 25 of those in full.
// The subdivision chain between a section number and the law it sits in:
// "section 2118(a) of title II of division A of Public Law 116-136". Congress
// walks down as many levels as it needs, and the chain is written inside-out —
// the level nearest the section number comes first and the outermost level last,
// which is the reverse of the order the law itself is structured in.
//
// 489 citations across the corpus carry a chain. Matching only the bare
// "division X of" form read 354 of them and lost the other 135, and the loss
// was total rather than partial: with the chain unmatched the whole citation
// failed and only the bare "Public Law 116-136" survived, so the section number
// went with it.
const SUBDIV_UNIT =
  '(?:[Tt]itles?|[Ss]ubtitles?|[Pp]arts?|[Ss]ubparts?|[Cc]hapters?|[Ss]ubchapters?' +
  '|[Dd]ivisions?|[Dd]iv\\.)';
const SUBDIV_CHAIN = `(?:${SUBDIV_UNIT}\\s+[A-Za-z0-9]{1,5}\\s+of\\s+){0,4}`;

// Every level of such a chain, in the order written.
const RE_CHAIN_STEP = new RegExp(`(${SUBDIV_UNIT})\\s+([A-Za-z0-9]{1,5})\\s+of`, 'g');

// The division named anywhere in such a chain, if one is.
const RE_CHAIN_DIVISION = /\b(?:division|div\.?)\s+([A-Za-z0-9]{1,2})\s+of/i;

// The levels a chain may name *below* a division — everything except a division
// itself, so the pattern below can anchor on the division without the chain
// swallowing it.
const SUBDIV_INNER =
  '(?:(?:[Tt]itles?|[Ss]ubtitles?|[Pp]arts?|[Ss]ubparts?|[Cc]hapters?|[Ss]ubchapters?)' +
  '\\s+[A-Za-z0-9]{1,5}\\s+of\\s+){0,4}';

// "division J of the Infrastructure Investment and Jobs Act", and the deeper
// form "Subtitle A of title II of division A of the CARES Act". A division with
// no section number is an address rather than a provision, so every level the
// citation names is doing work: division A of the CARES Act is 90 sections and
// Subtitle A of title II of it is 16. Matching only the bare form did not merely
// discard the inner levels, it started the chip after them.
const RE_ACT_DIVISION = POPULAR_NAMES.map((act) => ({
  act,
  re: new RegExp(
    `\\b(${SUBDIV_INNER})[Dd]ivisions?\\s+([A-Z]{1,2})\\s+of\\s+(?:the\\s+)?(?:${act.pattern})`,
    'g'
  ),
}));

// "title V of the Housing Act of 1949", "title XVIII of the Social Security Act"
//
// A title of an Act is a range, exactly as a division of a Public Law is, and
// for a long time this was written off as unresolvable: the Act index maps an
// Act's SECTIONS onto the Code and appeared to know nothing about its titles.
// It knows. The credit states the title in the same breath as the section —
// "(July 15, 1949, ch. 338, title V, § 501, …)" — so the ingester inverts both,
// and "title V of the Housing Act of 1949" is 42 U.S.C. 1471 et seq. by the same
// derivation that makes the section index trustworthy.
//
// 727 of these across the corpus, every one of them previously answered with the
// head of the Act. Only Acts wired to an enacting credit are eligible, the same
// gate `resolveActSection` is behind.
const RE_ACT_TITLE = POPULAR_NAMES.filter((a) => a.enactedAs).map((act) => ({
  act,
  re: new RegExp(
    `\\b[Tt]itles?\\s+([IVXLCDM]{1,7}|\\d{1,3}[A-Z]?)\\s+of\\s+(?:the\\s+)?(?:${act.pattern})`,
    'g'
  ),
}));

const RE_ACT_REL_SECTION = POPULAR_NAMES.filter((a) => a.enactedAs && !a.sectionsMatchCode).map(
  (act) => ({
    act,
    re: new RegExp(
      `\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)(${SUBSEC})` +
        // "section 7(a) or (b) of the Small Business Act" — a bill names two
        // subsections of one section, and the alternation sat between the
        // number and the "of the …" the pattern needs, so the whole citation
        // was missed and only the bare Act name survived. Consumed but not
        // captured: the section is what resolves, and the first subsection is
        // the one already in hand — claiming to know which of two alternatives
        // the drafter meant would be inventing an answer.
        `(?:\\s*(?:,|or|and)\\s*${SUBSEC})*` +
        `\\s+of\\s+(${SUBDIV_CHAIN})the\\s+(?:${act.pattern})`,
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

// "division E of Public Law 110-161" — an omnibus named by division and no
// section, which is an address in its own right. RE_ACT_DIVISION reads this
// shape for the 78 named Acts and nothing read it for a law cited by number, so
// 153 of these across the corpus kept only the bare "Public Law 110-161" and
// answered with the whole law: a division of an appropriations act against
// hundreds of sections of one.
//
// At least one level is required, and the division is mandatory — a chain of
// titles alone does not change WHICH provision is meant, and this pattern exists
// only for the level that does. `resolvePlawDivision` already answers it.
const RE_PUBLAW_DIVISION = new RegExp(
  `\\b((?:${SUBDIV_UNIT}\\s+[A-Za-z0-9]{1,5}\\s+of\\s+){0,3}[Dd]ivisions?\\s+([A-Z]{1,2})\\s+of\\s+)${PUBLAW_NAME}`,
  'g'
);

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
  `(${SUBDIV_CHAIN})${PUBLAW_NAME}`,
  'g'
);

// "Section 107 of the Department of Homeland Security Appropriations Act, 2018
// (division F of Public Law 115-141)" — the shape that names a *division's own*
// short title and then supplies the address in a parenthetical.
//
// 173 across the corpus, of which the parser previously read the parenthetical
// "Public Law 115-141" and nothing else: the section number, the division, and
// the fact that the two belong together were all discarded, so a complete
// address became a link to a 1,254-section law.
//
// This is the answer to the half of the division problem that could not be
// solved by mapping short titles to division letters — the bill has already
// done that mapping and written the letter down. The name in the middle is not
// looked up and does not need to be; the parenthetical is the address, and it
// is the *bill's own* statement of where the section sits.
//
// The middle must be a NAME and nothing else, and that is the whole safety of
// this pattern. A parenthetical belongs to the name immediately in front of it,
// so anything that gets between them belongs to something else:
//
//   section 313 of the Public Health Service Act, as amended by section 311
//   of division BB of the Consolidated Appropriations Act, 2021 (Pub. L. 116-260)
//
// Left ungated, that reads as PHSA § 313 living in Pub. L. 116-260 — a real law,
// a real section number, and the wrong statute entirely. The parenthetical is
// the *Consolidated Appropriations Act's*, and the tell is that a second
// "section" intervenes.
//
// The same failure in a second shape, from the Fiscal Responsibility Act, where
// the connective is a bare preposition and no second "section" appears:
//
//   …pursuant to section 251(b) of the Balanced Budget and Emergency Deficit
//   Control Act of 1985 in division J of the Infrastructure Investment and
//   Jobs Act (Public Law 117-58)
//
// Two references, and the parenthetical is the second one's. The tell there is
// a subdivision word inside the name: "division" opens a new address, and the
// place a chain may legitimately appear is the slot in front of the name, not
// inside it.
//
// So the middle must be a NAME and nothing else — no further section reference,
// no subdivision word, no "as amended / added / authorized / in effect"
// connective, no semicolon, no paren (the lazy stop is the opening one) and no
// paragraph break.
//
// This is the "wrong beats blank" rule doing its job: every guard here turns a
// confident answer about the wrong Act back into the bare Public Law link the
// citation had before.
const PAREN_ACT_NAME =
  '(?:(?!\\n[ \\t]*\\n)(?![Ss]ections?\\s)' +
  `(?!${SUBDIV_UNIT}\\s)` +
  '(?!\\s*,?\\s*as\\s+(?:amended|added|authorized|enacted|in\\s+effect|so\\s+))' +
  '[^();])';

const RE_PUBLAW_PAREN = new RegExp(
  `\\b[Ss]ections?\\s+(\\d+[A-Za-z]*)(${SUBSEC})\\s+of\\s+` +
    // Either side may carry the chain: "section 702 of division N of the
    // Consolidated Appropriations Act, 2021 (Public Law 116-260)" writes it
    // before the name and "…Act, 2018 (division F of Public Law 115-141)" after.
    `(${SUBDIV_CHAIN})(?:the\\s+)?` +
    `(${PAREN_ACT_NAME}{5,140}?)` +
    // The Public Law is not always the first thing in the parenthetical. An
    // uncodified section is cited beside the note it is printed under —
    // "section 8301 of the Agricultural Act of 2014 (16 U.S.C. 1642 note;
    // Public Law 113-79)" — and requiring the law to come first read none of
    // them, so 41 across the corpus kept only the bare law and lost the section
    // number that made the citation an address.
    //
    // Exactly one leading clause is admitted, and only a Code or Statutes cite:
    // that is the apparatus a drafter actually puts there, and anything looser
    // would let arbitrary text separate a name from a parenthetical it does not
    // own — the same theft the name guard above exists to stop. Note it is a
    // *note* cite, which per the note rule must not itself become the target;
    // the Public Law beside it is what resolves.
    `\\s*\\(\\s*(?:[^();\\n]{0,40}?(?:U\\.?\\s?S\\.?\\s?C\\.?|Stat\\.)[^();\\n]{0,30};\\s*)?` +
    `(${SUBDIV_CHAIN})${PUBLAW_NAME}`,
  'g'
);

// "subsection (h) of section 502 of the Housing Act of 1949 (42 U.S.C. 1472)"
//
// The subsection is stated in the prose and the parenthetical gives only the
// section, so the two halves of one address arrive separately and the pane opens
// the whole of 42 U.S.C. 1472 — which is the complaint that produced
// `defaultScope()`: a reader who asked for (h) should not be handed the section.
// 33 across the corpus; a further 45 already repeat the subsection inside the
// parenthetical and need nothing.
//
// The unit phrase itself is no longer an internal citation (it names its own
// section), so nothing is being taken from anywhere — this is the address being
// assembled instead of dropped.
//
// The middle is tempered exactly like the parenthetical-address form: no second
// section reference, no semicolon, no paren. The alternation "subsection (b) or
// (j) of section 505" is consumed but not captured, the same rule
// RE_ACT_REL_SECTION follows — nothing in the text says which of two the drafter
// meant, and the first is the one already in hand.
const RE_UNIT_SUB_USC = new RegExp(
  `\\b(?:subsections?|paragraphs?|subparagraphs?|clauses?)\\s+(${SUBSEC})` +
    `(?:\\s*(?:,|and|or)\\s*${SUBSEC})*` +
    `\\s+of\\s+(?:such\\s+section|[Ss]ections?\\s+\\d+[A-Za-z]*(?:${SUBSEC})?)` +
    `(?:(?![Ss]ections?\\s)[^();\\n]){0,120}?` +
    `\\(\\s*(\\d{1,2})\\s*U\\.?\\s?S\\.?\\s?C\\.?\\s*(?:§+\\s*)?([0-9]+[A-Za-z0-9\\-–—]*)\\s*\\)`,
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
// "That" is the last of these and the least obvious. An appropriations act
// chains its amendments inside provisos —
//
//   …is amended by striking ``2023'' and inserting ``2024'': Provided further,
//   That section 9(h)(3) of the Richard B. Russell National School Lunch Act
//   (42 U.S.C. 1758(h)(3)) is amended in the first sentence by striking …
//
// — and the colon that opens the proviso sits before "Provided", not before the
// target, so no boundary fell where the second instruction actually starts. 14
// of the 147 amendatory verbs still outside any parsed amendment, and the only
// double-digit cause left in that set.
const AMEND_BOUNDARY = '(?:^|[.;:]\\s+|[—–]\\s*|-{2,}\\s*|\\)\\s+|\\bThat\\s+)';

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
 * The op takes the path of the last step written before it. An op with no step
 * before it falls back to `base` — the address the instruction's own head names.
 *
 * That fallback is the other half of the same bug. "Subsection (g) of section
 * 6695 is amended by striking ``X''" never navigates, so the strike was left
 * unscoped and searched the WHOLE of section 6695 — every subsection the
 * instruction had just told us it was not talking about. 813 operations across
 * the corpus. The instruction states its address in its first six words and
 * nothing was reading it.
 *
 * `base` is only a claim, never an assertion: it is the Act's own numbering
 * wherever the parenthetical carried no codified one, and 41 of 306 name a level
 * the Code flattened away. Those carry `scopeFromHead` so reScope() can fall
 * back to the whole provision — which is exactly today's behaviour — instead of
 * reporting the operation lost. A navigation step naming a level that does not
 * exist stays lost, because that one really is unaccounted for.
 */
function scopeOps(ops, steps, base = '') {
  for (const op of ops) {
    if (op.start == null) continue;
    let inForce = null;
    for (const st of steps || []) {
      if (st.start > op.start) break;
      inForce = st;
    }
    if (inForce) {
      op.scope = inForce.path;
      // "in the matter preceding (A)" scopes to the parent but excludes its
      // children; every other step includes them.
      if (inForce.exact) op.exact = true;
    } else if (base) {
      op.scope = base;
      op.scopeFromHead = true;
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

/**
 * "The National Environmental Policy Act of 1969 (42 U.S.C. 4321 et seq.) is
 * amended by adding at the end the following: SEC. 106. …"
 *
 * `et seq.` names a RANGE, and the resolver answers with the section it begins
 * at — 42 U.S.C. 4321, NEPA's own first section. The addition then had no
 * navigation to scope it, so it landed at that section's root, and the pane drew
 * a whole new SECTION OF THE ACT inside the Act's first section, in the
 * insertion colour, as though the bill had put it there. 184 across the corpus,
 * 131 of them opening with "SEC. N." outright.
 *
 * The end of a range is not the end of the section it starts at, and nothing
 * here knows where the range stops — the Act's last section is not a fact this
 * citation carries. So the op is marked and the pane declines to place it,
 * saying what is being added and where it goes. Blank beats wrong, and this was
 * the wrong kind of wrong: a real provision, in the right colour, in a section
 * the bill never mentions.
 *
 * Only additions. A strike on the same target searches for its language and
 * simply fails to find it, which is already the honest answer; an addition is
 * placed structurally and so is never checked against anything.
 */
function markRangeAdditions(ops, target) {
  if (!target || !target.etSeq) return;
  for (const op of ops) if (op.type === 'add-at-end') op.rangeEnd = true;
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
    // Already placed by the anchor-first matcher, which read both operands of
    // one phrase. Re-deriving from what follows would find the NEXT
    // instruction's connective and move it.
    if (op.relation && op.anchor) continue;
    // Likewise for a unit-anchored insert read forwards from its own phrase:
    // the anchor is already the one this instruction wrote, and the pairing
    // tests below would look at whatever strike happens to precede it and
    // report the new provision as that strike's replacement.
    if (op.unitAnchor) continue;

    const prev = spans[i - 1];
    if (prev && prev.type === 'strike' && op.start - prev.end < 100) {
      // Which gap test applies depends on where the op's span begins. A quoted
      // insert starts INSIDE its quotes, so the verb is left behind in the gap
      // and RE_REPLACES looks for it there. A named insert ("and inserting a
      // semicolon") starts at the verb, so the gap in front of it is only the
      // connective — asking RE_REPLACES about it finds no "inserting" and
      // silently declines every one of them.
      const gap = text.slice(prev.end, op.start);
      if (op.punctuation ? RE_PUNCT_REPLACES.test(gap) : RE_REPLACES.test(gap)) {
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

// "by inserting after paragraph (8) the following:" followed by the new
// paragraph itself — the sibling of RE_ADD_END, and the one that never got a
// block reader.
//
// RE_INSERT caps its quoted operand at 400 characters, and the cap does not
// TRUNCATE: the lazy run cannot reach the closer, so the whole match fails and
// no op is created at all. A new provision is routinely longer than that. Across
// the corpus, 779 phrases of this shape yield only 307 operations, and 379 of
// the 428 missing blocks that can be measured run past the cap — 800 to 3,450
// characters each, every one a whole new subsection or paragraph the reader was
// never shown. The Fiscal Responsibility Act's own discretionary caps for fiscal
// years 2024 and 2025 are two of them: 430 characters, thirty over.
//
// Read forwards from the phrase with readAddedBlock(), exactly as RE_ADD_END is,
// and for the same reason — the block is delimited by its quotes and by nothing
// else, so a character budget is the wrong instrument. This only matches the
// UNIT-anchored form; "inserting after ``X'' the following" is the quoted-anchor
// shape and belongs to RE_INSERT_ANCHOR_FIRST.
const RE_INSERT_AFTER_UNIT = new RegExp(
  `\\binsert(?:ing)?\\s+(?:immediately\\s+)?after\\s+(?:the\\s+)?` +
    `(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem)s?\\s+` +
    `(\\([A-Za-z0-9]{1,8}\\)(?:\\([A-Za-z0-9]{1,8}\\))*)`,
  'gi'
);

// "by striking the period at the end and inserting ``; or''"
//
// The commonest way a bill re-punctuates a list, and the strike names the mark
// rather than quoting it — so `RE_STRIKE` finds no operand (it is tempered
// against reaching across "insert", correctly) and `RE_REPLACES` has no strike
// to pair the insert with. The insert was then unplaced, and 320 of the corpus's
// 2,431 unplaced inserts are this one shape.
//
// Synthesised as an ordinary strike whose operand is the mark itself, which the
// redline can already find: `occurrences()` requires a word boundary only at an
// end that is a word character, so a lone "." or ";" matches. Everything
// downstream — the pairing, the scoping, the drawing — then works unchanged.
//
// "at the end" is what makes it locatable: the mark occurs throughout a
// provision and the one meant is the last, which is the same reason the flag
// exists for a quoted operand.
const PUNCT_WORD = { period: '.', semicolon: ';', comma: ',', colon: ':' };
// The unit is part of the phrase, not a gap after it: "striking the period at
// the end OF PARAGRAPH (2) and inserting" names both the mark and which
// provision's end it sits at. Left out of the match, those words fell into the
// gap that `RE_REPLACES` reads — and that gap admits only a short connective,
// correctly, so the insert never paired.
//
// 94 across the corpus, 77 of which pair; the other 17 are strikes with no
// insert after them, which is the bill re-punctuating without replacing. The
// count of synthesised strikes does not move at all (446 either way) — this
// only extends a span so the gap after it reads as the connective it is.
//
// The corpus cannot see this. `opSpans` is the SIZE of a set of
// `type:start-end` keys, so moving an `end` changes every key and no count;
// the same blind spot TODO 12 records. Measured directly instead.
//
// The unit is consumed rather than captured. The step machinery has already
// scoped the op to the provision the instruction walked to, so a second opinion
// here could only disagree with it.
//
// The units are spelled out rather than sharing `UNIT_WORDS`, which is declared
// below this line: a `const` referenced above its declaration is a temporal dead
// zone, and at module top level that throws on import rather than failing a
// test. `RE_UNIT_ANCHOR` spells them out for the same reason.
const PUNCT_UNIT_TAIL =
  '(?:\\s+(?:of|in)\\s+(?:such\\s+)?' +
  '(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem)s?' +
  '\\s*(?:\\([A-Za-z0-9]{1,8}\\))*)?';

// Two forms, and the second is why "at the end" is not required.
//
//   A  by striking the period at the end of paragraph (2) and inserting …
//   B  by striking the period and inserting a semicolon
//
// B is the same idiom with the position left unsaid, 103 times across the corpus
// — and in 89 of those the very next words are "and inserting", which is the list
// re-punctuation idiom and nothing else. The mark meant is the terminal one.
//
// Form B is admitted ONLY on that lookahead, and the lookahead consumes nothing,
// so the span still ends at the mark. The other 14 are left alone: "striking the
// comma after ``in the agreement''" is an anchored strike naming a different
// comma, and sweeping it in here would strike the wrong character.
//
// Both forms carry `atEnd`, which is a claim the redline then CHECKS rather than
// trusts — it takes the last occurrence and draws only where nothing but
// punctuation follows it. So inferring the position costs nothing when the
// inference is wrong: the honest blank is what comes out.
//
// `\b` after the mark is load-bearing once "at the end" stops being mandatory,
// or "the periodic review" reads as a period followed by "ic review".
const RE_STRIKE_PUNCT_END = new RegExp(
  'strik(?:e|ing)\\s+(?:out\\s+)?the\\s+(period|semicolon|comma|colon)\\b' +
    `(?:\\s+at\\s+(?:the\\s+)?end${PUNCT_UNIT_TAIL}` +
    `|${PUNCT_UNIT_TAIL}(?=\\s*,?\\s+and\\s+insert))`,
  'gi'
);

// "and inserting a semicolon" — the mirror of the strike above, and the half
// that was missing.
//
// A bill that names the mark it removes usually names the mark it puts back, and
// `RE_INSERT` wants a QUOTED operand, so no insert op existed at all. The strike
// drew and nothing replaced it: the reader was shown language being removed from
// the statute book with nothing put in its place, which is a redline that states
// something the bill does not say. 234 across the corpus, in 20 of the 30 bills.
//
// 157 of those had no insert op whatsoever. The other 77 had something worse —
// see the `claimed` push at the synthesis site: the generic scan reaches up to
// 120 characters past the verb for a quote opener, and at these sites the nearest
// opener regularly belongs to the NEXT instruction, so its added block was
// reported as this instruction's insertion.
//
// Same split as the strike: `text` is the phrase the bill wrote, because the span
// must round-trip to it, and the mark travels as `operand`. `punctuation` marks
// it for the pairing rule below — the span begins at the VERB rather than inside
// a quote, so the gap in front of it is a bare connective.
const RE_INSERT_PUNCT = new RegExp(
  'insert(?:ing)?\\s+(?:in\\s+lieu\\s+thereof\\s+)?(?:a|an|the)\\s+' +
    '(period|semicolon|comma|colon)\\b',
  'gi'
);

// The gap between a strike and the named insert that replaces it.
//
// `RE_REPLACES` reads the gap expecting to find the words "and inserting" inside
// it, because a quoted insert's span starts INSIDE its quotes and so leaves the
// verb behind in the gap. A named insert's span starts at the verb itself, so all
// that is left in front of it is the connective — and the closing quote, where
// the strike it replaces was the quoted one ("by striking ``, and'' and inserting
// a period").
const RE_PUNCT_REPLACES = /^\s*(?:''|’’|["”])?\s*,?\s*(?:and|or)?\s*$/i;

// "by inserting after ``X'' the following: ``Y''" — the anchor written BEFORE
// the language it places.
//
// `RE_ANCHORED` reads the other order, "by inserting ``Y'' after ``X''", by
// looking at what follows the operand. In this order the first quoted string is
// the anchor and the second is the new language, and the generic insert scan —
// which takes the first quoted string after the verb — read the ANCHOR as the
// inserted text. That is not a missing answer but a wrong one: it would draw
// "compliance with procedural steps required by paragraph (1)(B)", language
// already sitting in 5 U.S.C. 801(a)(2)(A), as green text the bill adds, while
// the language actually being added went unmentioned and the panel reported
// "position not stated" about the one thing it knew.
//
// Both orders are common and neither is a variant of the other, so this is its
// own matcher rather than a widening of the existing one.
//
// The gap between anchor and language is tempered against both amendatory verbs,
// for the reason every gap in this file is: "…after ``X'' the following" may run
// through a unit word and a line break, but if it reaches another strike or
// insert then the quoted operand it found belongs to that instruction and
// pairing them would report language the bill removes as language it adds.
const RE_INSERT_ANCHOR_FIRST = new RegExp(
  `insert(?:ing)?\\s+(?:immediately\\s+)?(after|before)\\s+${QO}([\\s\\S]{1,300}?)${QC}` +
    `((?:(?!strik|insert)[\\s\\S]){0,120}?)${QO}([\\s\\S]{1,400}?)${QC}`,
  'gi'
);

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

// The destination of a whole-section redesignation, read forwards from the
// instruction head: "… is redesignated as section 55123 of such title".
//
// Anchored at the head's end, so the "as section N" found is this instruction's
// and not one belonging to a sentence further down. A section number may carry
// a letter or a dash (399V-1, 2851a) and may be followed by a subsection, which
// is kept — "redesignated as section 2534(a) of title 14" renumbers into a
// subsection and saying just "section 2534" would name a different provision.
const RE_REDESIG_DEST =
  /^[\s,]*as\s+section\s+([0-9]+[A-Za-z]*(?:[-–—][0-9A-Za-z]+)?(?:\([A-Za-z0-9]{1,8}\))*)/i;

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
  // Spans a navigation phrase has claimed, in absolute offsets, for the whole
  // instruction rather than one line. See the note at pass 1.
  const claimed = [];

  const lines = text.slice(from, to).split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineStart = off;
    off += line.length + 1;

    // A phrase broken across the 72-column measure — "by striking paragraph \n
    // (4) and by redesignating" — matched nothing, because every pattern here
    // runs against one physical line. 450 across the corpus sit inside an
    // amendment with a Code target and outside any quoted block, so they were
    // never composed into an address at all; they survived as plain internal
    // references and got pointed at whatever same-shaped marker was nearest.
    //
    // The fix has to keep offsets exact — the whole file's first invariant — so
    // the two lines are not joined but *overlaid*: the newline is replaced by a
    // single space, which is the same one character, and the next line's own
    // indent is left standing as the spaces it already is. Every index into
    // `probe` is therefore the same index into the original text.
    //
    // Matches that begin past this line's end belong to the next iteration and
    // are dropped here, so nothing is emitted twice.
    const probe = li + 1 < lines.length ? `${line} ${lines[li + 1]}` : line;
    const onThisLine = (i) => i < line.length;

    // Quoted inserted law: not an instruction, and its cross-references point
    // inside itself rather than into the Code. The run persists across
    // continuation lines and ends on the line that closes the quotation.
    if (RE_QUOTED_LINE.test(line)) inQuotedBlock = true;
    const inserted = inQuotedBlock;
    if (inserted && RE_QUOTE_CLOSE.test(line)) inQuotedBlock = false;
    if (inserted) continue;

    // Pass 1: navigation. Records the spans it claims so pass 2 skips them.
    //
    // Claims are kept in ABSOLUTE offsets and outlive the line, because a
    // navigation phrase can wrap the 72-column measure while the reference
    // inside it sits on the next physical line:
    //
    //     in the matter
    //         preceding subclause (I), by striking ...
    //
    // The phrase is matched on this line's overlay probe (see above); the bare
    // "subclause (I)" is matched on the NEXT iteration, where a per-line claim
    // list has already been thrown away. So the phrase became navigation AND
    // leaked its own marker as an inert reference to the very provision it
    // identifies itself by staying outside of — the thing item 4 exists to stop,
    // surviving in exactly the wrapped case nobody could see.
    const rel = (i) => lineStart + i;

    RE_NAV.lastIndex = 0;
    let nm;
    while ((nm = RE_NAV.exec(probe))) {
      if (!onThisLine(nm.index)) continue;
      if (!isInstructionPosition(probe.slice(0, nm.index))) continue;
      const phraseStart = nm.index + nm[0].indexOf(nm[1]);
      const resolved = resolvePhrase(unitPairs(nm[1]), current);
      if (!resolved) continue;
      claimed.push([rel(phraseStart), rel(nm.index + nm[0].length)]);
      emit(steps, resolved, probe, lineStart, phraseStart, nm[1], text);
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
    while ((mm = RE_NAV_MATTER.exec(probe))) {
      if (!onThisLine(mm.index)) continue;
      if (!isMatterPosition(probe.slice(0, mm.index))) continue;
      const resolved = resolvePhrase(unitPairs(mm[1]), current);
      if (!resolved || !resolved.addresses.length) continue;
      const levels = resolved.addresses[0].levels;
      // No parent, no matter. "In the matter preceding subsection (a)" would be
      // the section's own opening text, which is not addressable as a path.
      if (levels.length < 2) continue;
      const parent = levels.slice(0, -1);
      claimed.push([rel(mm.index), rel(mm.index + mm[0].length)]);
      steps.push({
        start: lineStart + mm.index,
        end: lineStart + mm.index + mm[0].length,
        text: text.slice(lineStart + mm.index, lineStart + mm.index + mm[0].length),
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
    const quoted = quotedSpans(probe);
    RE_REF.lastIndex = 0;
    let rm;
    while ((rm = RE_REF.exec(probe))) {
      const s = rm.index;
      if (!onThisLine(s)) continue;
      if (claimed.some(([a, b]) => rel(s) < b && rel(s) + rm[0].length > a)) continue;
      if (quoted.some(([a, b]) => s < b && s + rm[0].length > a)) continue;
      const resolved = resolvePhrase(unitPairs(rm[1]), current);
      if (!resolved) continue;
      emit(refs, resolved, probe, lineStart, s, rm[1], text);
    }
  }
  return { steps, refs };
}

/**
 * Turn a resolved phrase into one entry per address, with exact offsets.
 *
 * `line` may be the two-line probe, whose newline has been overlaid with a
 * space so that indices still line up. The offsets are therefore right either
 * way — but the recorded `text` must come from the ORIGINAL string, or a phrase
 * that wrapped carries a run of spaces where its line break was, and every
 * consumer that re-wraps it (inline() in render-bill.js) sees nothing to fix.
 */
function emit(out, resolved, line, lineStart, phraseStart, phrase, source) {
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
      text: (source || line).slice(source ? lineStart + start : start, source ? lineStart + end : end),
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

// A unit phrase that names its own section is not an internal reference.
//
// "Subsection (g) of section 6695 is amended", "Paragraph (2) of section 529A(b)",
// "subparagraph (A) of section 152(b)(3)" — RE_INTERNAL matches the head unit and
// stops, because it has no lookahead for what follows, so the half of the address
// that says WHICH section is thrown away. `locateInternal` then goes looking for a
// same-shaped marker in the bill and finds one: 1,460 of these across the corpus,
// 931 answered with something in the bill and 616 of those with no hedge at all.
// Every one is a confident answer about the wrong provision — "Subsection (g) of
// section 6695" pointed at a subsection (g) of whatever the reader was near.
//
// The address is external and the amendment machinery already reads it:
// RE_AMEND_HEAD_UNIT composes "Subsection (g) of section 6695" onto the target,
// so the instruction's own tag carries the right provision. Dropping the chip
// leaves that standing and removes the wrong one — blank beats wrong.
//
// "of such section" is included because it is the same phrase with the number
// elided, and elided is not absent: TODO 1's `impliedSuchUnit` resolves it.
const RE_UNIT_OF_SECTION = /^\s*of\s+(?:such\s+)?(?:section|title)\b/i;

// The one form of it that IS internal, and is then composed rather than dropped:
// "subsection (a) of section 503 of this Act". The bill says whose section 503 it
// means, so the address is complete and points inside the bill. 13 across the
// corpus against 1,531 that name someone else's section or say nothing — which is
// why the default is to drop. The unit named first is the innermost, so its
// marker goes on the END of the section's own path: "Subparagraph (B) of section
// 1313(a)(6) of this Act" is 1313(a)(6)(B).
const RE_UNIT_OF_THIS_SECTION = new RegExp(
  `^\\s*of\\s+(?:such\\s+)?section\\s+(\\d+[A-Za-z]*)(${SUBSEC})\\s+of\\s+this\\s+(Act|title)`,
  'i'
);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** The division named in a subdivision chain, upper-cased, or null. */
function divisionOf(chain) {
  const m = RE_CHAIN_DIVISION.exec(String(chain || ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * A subdivision chain as a path, outermost first: the order the law is built in
 * rather than the order the citation writes it.
 *
 * "title II of division A of" is written inside-out, so the segments are
 * reversed to give ["DIVISION A", "TITLE II"] — which is the shape
 * `data/plaw`'s table of contents records, and so is directly a prefix test
 * against it. Normalised to upper case because a bill sets its own headings and
 * writes "Subtitle A" where it writes "TITLE II"; the unit word is not evidence
 * about anything, only the level is.
 *
 * `outer` is prepended after the reversal — the division RE_ACT_DIVISION matched
 * separately sits outside everything the chain names.
 */
function wherePath(chain, outer) {
  const steps = [];
  RE_CHAIN_STEP.lastIndex = 0;
  let m;
  while ((m = RE_CHAIN_STEP.exec(String(chain || '')))) {
    const unit = m[1].toUpperCase().replace(/\.$/, '').replace(/S$/, '').replace(/^DIV$/, 'DIVISION');
    steps.push(`${unit} ${m[2].toUpperCase()}`);
  }
  steps.reverse();
  if (outer) steps.unshift(String(outer).toUpperCase());
  // A path that says nothing is no path. The caller falls back to the division
  // alone, which is what it had before.
  return steps.length ? steps : null;
}

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
  for (const { act, re } of RE_ACT_DIVISION) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const division = m[2].toUpperCase();
      push(out, m, 'act', { act, division, where: wherePath(m[1], `DIVISION ${division}`) });
    }
  }

  // After the division form and before the section form, which is the order
  // dedupe would settle anyway — but stated here because the reason matters: a
  // citation naming BOTH a title and a section ("section 501 of title V of …")
  // is about the section, and the section match is longer.
  for (const { act, re } of RE_ACT_TITLE) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      push(out, m, 'act', { act, actTitle: m[1].toUpperCase() });
    }
  }

  for (const { act, re } of RE_ACT_REL_SECTION) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      push(out, m, 'act', {
        act,
        actSection: m[1],
        subsection: m[2] || '',
        division: divisionOf(m[3]),
        where: wherePath(m[3]),
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
      division: divisionOf(m[3]),
      where: wherePath(m[3]),
      ladder: subsectionLadder(m[2]),
    });
  }

  RE_PUBLAW_DIVISION.lastIndex = 0;
  while ((m = RE_PUBLAW_DIVISION.exec(text))) {
    push(out, m, 'publaw', {
      congress: m[3],
      law: m[4],
      division: m[2].toUpperCase(),
      // The chain already ends with the division, so no outer level is supplied.
      where: wherePath(m[1]),
    });
  }

  RE_PUBLAW_PAREN.lastIndex = 0;
  while ((m = RE_PUBLAW_PAREN.exec(text))) {
    // The parenthetical chain sits next to the Public Law and wins where both
    // are written; the outer one is the same address said earlier in the phrase.
    const where = wherePath(m[5]) || wherePath(m[3]);
    push(out, m, 'publaw', {
      congress: m[6],
      law: m[7],
      actSection: m[1],
      subsection: m[2] || '',
      division: divisionOf(m[5]) || divisionOf(m[3]),
      where,
      // The short title the bill used. Worth carrying: it is usually the name of
      // the division itself, which is the one thing "Pub. L. 115-141, division F"
      // does not tell a reader.
      shortTitle: m[4].replace(/\s+/g, ' ').trim(),
      ladder: subsectionLadder(m[2]),
    });
  }

  RE_UNIT_SUB_USC.lastIndex = 0;
  while ((m = RE_UNIT_SUB_USC.exec(text))) {
    push(out, m, 'usc', {
      title: m[2],
      section: m[3].replace(/\s+/g, ''),
      subsection: m[1] || '',
      etSeq: false,
      ladder: subsectionLadder(m[1]),
      // The subsection came from the sentence, not from the parenthetical. Worth
      // recording: the pane can say where it got it, and a future reader of this
      // code can tell the two sources apart.
      subFromProse: true,
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
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const own = RE_UNIT_OF_THIS_SECTION.exec(tail);
      if (own) {
        // The whole phrase is one address. Span it all, so the chip covers what
        // the reader sees as the citation rather than just its first two words.
        const whole = m[0] + own[0];
        const sub = `${own[2] || ''}${m[6] || ''}`;
        push(out, { 0: whole, index: m.index }, 'internal', {
          refType: 'section',
          section: own[1],
          subsection: sub,
          scope: (own[3] || 'Act').toLowerCase(),
          ladder: subsectionLadder(sub),
        });
      } else if (!RE_UNIT_OF_SECTION.test(tail)) {
        push(out, m, 'internal', {
          refType: (m[5] || '').toLowerCase(),
          section: '',
          subsection: m[6] || '',
          scope: 'section',
        });
      }
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
  // Dedupe needs the flag too, so it is set on the candidates first and then
  // re-set on the survivors. A note citation outranks everything by kind — it is
  // a `usc` — and would evict the composite that spans it: "section 8301 of the
  // Agricultural Act of 2014 (16 U.S.C. 1642 note; Public Law 113-79)" was being
  // reduced to "16 U.S.C. 1642", the one provision the note rule says it is not.
  for (const c of out) {
    if (c.kind === 'usc') c.note = RE_NOTE_SUFFIX.test(text.slice(c.end, c.end + 8));
  }
  const cites = dedupe(out);
  // …and again against each survivor's own `end`, which push() may have moved
  // for a boundary group. Testing from the wrong offset reads as working while
  // flagging nothing at all.
  for (const c of cites) {
    if (c.kind === 'usc') c.note = RE_NOTE_SUFFIX.test(text.slice(c.end, c.end + 8));
  }
  return cites;
}

// Specificity ranking. When two matches overlap we keep the more useful one:
// a real code citation beats a bare Act name, which beats a vague internal ref.
const RANK = { usc: 5, cfr: 5, publaw: 4, stat: 4, act: 3, internal: 1 };

/**
 * Rank, with the one exception the note rule forces.
 *
 * A "16 U.S.C. 1642 note" citation is a `usc` and so outranks everything — but
 * it is the single kind of citation that must NOT stand for the section it
 * names, and it is written inside a parenthetical belonging to something else:
 * "section 8301 of the Agricultural Act of 2014 (16 U.S.C. 1642 note; Public
 * Law 113-79)". Ranked normally it evicts the address that spans it and leaves
 * the reader with the provision the note is printed under, which is exactly the
 * confident wrong answer the note rule exists to prevent.
 *
 * It keeps its rank against everything else, so a note cited on its own is still
 * preferred over a bare Act name; only a Public Law is allowed to outrank it,
 * and only by spanning it.
 */
function rankOfCite(c) {
  return c.kind === 'usc' && c.note ? RANK.publaw - 0.5 : RANK[c.kind];
}

function dedupe(all) {
  const sorted = all
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end || rankOfCite(b) - rankOfCite(a));
  const kept = [];
  for (const c of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && c.start < prev.end) {
      // Overlap: replace the incumbent only if this match is strictly better.
      const better = rankOfCite(c) > rankOfCite(prev) ||
        (rankOfCite(c) === rankOfCite(prev) && c.end - c.start > prev.end - prev.start);
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
    // "That" is a boundary like the punctuation beside it, so it is trimmed the
    // same way — the instruction starts at its target, not at the conjunction
    // that introduced it.
    const lead = raw.length - raw.replace(/^(?:[\s.;:—–)-]+|That\s+)+/, '').length;
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
    // "That" is a boundary like the punctuation beside it, so it is trimmed the
    // same way — the instruction starts at its target, not at the conjunction
    // that introduced it.
    const lead = raw.length - raw.replace(/^(?:[\s.;:—–)-]+|That\s+)+/, '').length;
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
    // "That" is a boundary like the punctuation beside it, so it is trimmed the
    // same way — the instruction starts at its target, not at the conjunction
    // that introduced it.
    const lead = raw.length - raw.replace(/^(?:[\s.;:—–)-]+|That\s+)+/, '').length;
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
    // "That" is a boundary like the punctuation beside it, so it is trimmed the
    // same way — the instruction starts at its target, not at the conjunction
    // that introduced it.
    const lead = raw.length - raw.replace(/^(?:[\s.;:—–)-]+|That\s+)+/, '').length;
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
    // The anchor-first form is claimed before the generic scans run, because
    // both would otherwise match inside it and report the anchor as the
    // inserted language.
    const claimed = [];
    RE_INSERT_ANCHOR_FIRST.lastIndex = 0;
    let af;
    while ((af = RE_INSERT_ANCHOR_FIRST.exec(body))) {
      claimed.push([af.index, af.index + af[0].length]);
      const rel = af[0].lastIndexOf(af[4]);
      ops.push({
        type: 'insert',
        text: af[4],
        relation: af[1].toLowerCase(),
        anchor: af[2],
        start: h.headEnd + af.index + rel,
        end: h.headEnd + af.index + rel + af[4].length,
      });
    }

    // The punctuation strike is synthesised before the generic scans so that
    // placeOps sees it in document order and can pair the insert that follows.
    RE_STRIKE_PUNCT_END.lastIndex = 0;
    let pm;
    while ((pm = RE_STRIKE_PUNCT_END.exec(body))) {
      const mark = PUNCT_WORD[pm[1].toLowerCase()];
      if (!mark) continue;
      ops.push({
        type: 'strike',
        // `text` is what the BILL says, because an op's span must round-trip to
        // its text — the badOpOffsets invariant, and it exists because a span
        // pointing at text it does not match mis-renders the bill pane. There is
        // no quoted operand here, so the span is the phrase the bill wrote and
        // the reader clicked; the mark it names travels as `operand`, which is
        // what the redline matches against in the LAW.
        text: pm[0],
        operand: mark,
        atEnd: true,
        start: h.headEnd + pm.index,
        end: h.headEnd + pm.index + pm[0].length,
        punctuation: true,
      });
    }

    // The mirror: "and inserting a semicolon". Claimed, unlike the strike above,
    // and the claim is doing two separate jobs.
    //
    // The strike needs none because RE_STRIKE is tempered against "insert" and so
    // stops before it ever reaches a quote. RE_INSERT has no such temper against a
    // second "insert": from "inserting a comma, and by inserting after paragraph
    // (15) the following new paragraph: ``(16) …''" it matches at the FIRST verb
    // and captures the block belonging to the SECOND, then — being a global scan —
    // advances lastIndex past that verb entirely, so the real insertion never gets
    // an op of its own. The block the bill adds to paragraph (16) was being drawn
    // as though this instruction added it.
    RE_INSERT_PUNCT.lastIndex = 0;
    let im;
    while ((im = RE_INSERT_PUNCT.exec(body))) {
      const mark = PUNCT_WORD[im[1].toLowerCase()];
      if (!mark) continue;
      claimed.push([im.index, im.index + im[0].length]);
      ops.push({
        type: 'insert',
        text: im[0],
        operand: mark,
        start: h.headEnd + im.index,
        end: h.headEnd + im.index + im[0].length,
        punctuation: true,
      });
    }

    // "by inserting after paragraph (8) the following: ``(9) …''", where the
    // block is longer than RE_INSERT's operand budget and so produced nothing at
    // all. Claimed before the generic scans for the same reason the anchor-first
    // form is: otherwise a block short enough to fit the budget would be read
    // twice, once here and once there.
    //
    // The anchor is captured from the phrase rather than looked up backwards by
    // placeOps(), because this reads forwards and already has it in hand.
    RE_INSERT_AFTER_UNIT.lastIndex = 0;
    let um;
    while ((um = RE_INSERT_AFTER_UNIT.exec(body))) {
      const block = readAddedBlock(text, h.headEnd + um.index + um[0].length);
      // No delimited block after the phrase — this is "inserting after paragraph
      // (8) ``X''" with an ordinary short operand, or a shape whose quotes do not
      // close. Left entirely to the generic scan, which already handles it.
      if (!block) continue;
      claimed.push([um.index, Math.max(um.index + um[0].length, block.end - h.headEnd)]);
      ops.push({
        type: 'insert',
        text: text.slice(block.start, block.end),
        start: block.start,
        end: block.end,
        unitAnchor: um[1],
      });
    }

    for (const [re, type] of [[RE_STRIKE, 'strike'], [RE_INSERT, 'insert']]) {
      re.lastIndex = 0;
      let om;
      while ((om = re.exec(body))) {
        const hit = claimed.find(([a, b]) => om.index < b && om.index + om[0].length > a);
        if (hit) {
          // Resume just past the claimed phrase rather than past this whole
          // match. The match being discarded may have run far beyond the claim —
          // that is exactly the over-reach the claim exists to stop — and leaving
          // lastIndex at its end would consume the very instruction the claim was
          // protecting, trading a wrong op for no op at all.
          re.lastIndex = Math.max(re.lastIndex > hit[1] ? hit[1] : re.lastIndex, om.index + 1);
          continue;
        }
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

    // "Section 55301 of title 46, United States Code, is redesignated as section
    // 55123 of such title" — the instruction says exactly what it does and the
    // pane said nothing at all about it. `verb` recorded "redesignated" and no
    // op was ever emitted, so attachEffect() returned early on `!ops.length` and
    // the reader got the provision with no indication the bill renumbers it.
    // 13 of the corpus's 17 section-level redesignations, all in the NDAA.
    //
    // Emitted as an ordinary `redesignate` op because the panel already draws
    // that shape as "from → to"; the destination was the only thing missing.
    // The op carries no span: the language is not being changed, so there is
    // nothing in the bill for the redline to mark, and a span that did not
    // round-trip would break the badOpOffsets invariant for nothing.
    if (h.verb === 'redesignated' && !ops.some((o) => o.type === 'redesignate')) {
      const dest = text.slice(h.headEnd, h.headEnd + 160).match(RE_REDESIG_DEST);
      if (dest) {
        const from = `${h.unit.replace(/\.$/, '')} ${h.section}${h.subsection}`.trim();
        ops.push({ type: 'redesignate', from, to: `section ${dest[1]}` });
      }
    }

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

    // "Subsection (a) of section 3" — the inner unit narrows the target further,
    // and it goes on the END of the section's own path. The unit named first is
    // the INNERMOST, the same rule the unit-phrase citation follows: in
    // "Subparagraph (B) of section 280F(d)(7)" the address is 280F(d)(7)(B), not
    // 280F(B)(d)(7). Composed the other way round for as long as this existed —
    // 208 amendments across the corpus, every one of them carrying a path with
    // its levels transposed.
    const innerSub = (h.inner.match(/\([A-Za-z0-9]{1,8}\)/g) || []).join('');
    const subsection = h.subsection + innerSub;

    // Nested "in paragraph (3)(B)" / "in clause (iv)" addresses, composed
    // against the target's own path. Anchored on the *codified* subsection
    // (target.subsection) wherever the citation states one, not the Act-relative
    // one, because that is the numbering the resolved provision actually uses —
    // and the two really do diverge. 12 U.S.C. 375 IS section 22(d) of the
    // Federal Reserve Act, so the Act's own "(d)" names nothing in the codified
    // section; 3,467 of 3,731 agree and the 28 that genuinely differ are all of
    // this shape.
    //
    // Where the parenthetical carries NO subsection the head is the only address
    // there is, and dropping it lost a level off everything downstream:
    //
    //   Section 2(a) of the Investment Company Act of 1940 (15 U.S.C. 80a-2)
    //     is amended-- (1) in paragraph (36), ...
    //
    // composed the step as "(36)" when the provision is 80a-2(a)(36) — which the
    // same bill writes out in full four lines earlier. 406 instructions, 209
    // navigation steps and 396 already-scoped operations. The head's subsection
    // exists in the resolved provision for 265 of the 306 that resolve; the other
    // 41 are the Act-relative divergence above, and reScope() reconciles those
    // against the tree rather than this pass guessing at them.
    const base = (target && target.subsection) || subsection;
    const nav = extractSteps(text, h.headEnd, bodyEnd, base);
    scopeOps(ops, nav.steps, base);
    scopeAdditions(ops);
    scopeUnitInserts(ops);
    markRangeAdditions(ops, target);

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
