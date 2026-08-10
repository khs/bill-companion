// Bill structure parsing: split raw bill text into navigable sections.
//
// Congressional drafting style is rigid enough to key off directly:
//   SECTION 1. SHORT TITLE.        <- only the first section spells out "SECTION"
//   SEC. 2. DEFINITIONS.
//   TITLE I—ENERGY SECURITY
//   Subtitle A—Efficiency
// Section headings are set in caps and terminated by a period.

// govinfo plain text renders the em dash between a label and its heading as a
// DOUBLE hyphen — "DIVISION A--LIMIT FEDERAL SPENDING". A separator class
// matching a single character consumed one of the two and handed the other to
// the heading, so every plain-text bill in the corpus carried headings reading
// "-LIMIT FEDERAL SPENDING". Take the pair before the singleton.
const RE_DIVISION = /^\s*(DIVISION\s+[A-Z0-9]+|TITLE\s+[IVXLC]+|Subtitle\s+[A-Z]|CHAPTER\s+[IVXLC0-9]+)\s*(?:--|[—–-])\s*(.+?)\s*$/;
// The same units, set the way an appropriations act sets them: the label
// centred on a line of its own, and the heading two lines below it.
//
//     TITLE I
//
//         DEPARTMENTAL MANAGEMENT, OPERATIONS, INTELLIGENCE, AND OVERSIGHT
//
// RE_DIVISION needs a separator on the same line, so it matched none of these:
// 44 titles in H.J. Res. 31 and not one of them visible. That is the whole
// navigational structure of an appropriations act — everything under it hangs
// off a title nobody could see.
//
// Anchored end-to-end, so the line must be the label and nothing else. "TITLE I"
// occurring in a sentence, or "TITLE I--DEFINITIONS" (which RE_DIVISION already
// handles), does not match.
const RE_DIVISION_BARE = /^\s*(DIVISION\s+[A-Z0-9]+|TITLE\s+[IVXLC]+|Subtitle\s+[A-Z]|CHAPTER\s+[IVXLC0-9]+)\s*$/;

const RE_SECTION = /^\s*(SECTION|SEC\.)\s+(\d+[A-Za-z]*)\.\s*(.*)$/;
// The same heading as an appropriations bill sets it: "Sec. 101. Notwithstanding
// any other provision of law…". Gated on position, never used on its own — see
// the call site in parseBill.
//
// Only the abbreviated, capitalised form. A blanket /i was the obvious way to
// write this and it is wrong, because bills wrap at 72 columns and a citation
// broken across the measure puts "section 1931." at the head of a line —
//
//     …the State plan under
//     section 1931.''.
//
// which is the tail of a sentence, not a heading. That alone invented 12
// sections in the Affordable Care Act and 5 in the 2017 tax act, each one
// swallowing the real section it appeared in. The full word "Section" in
// sentence case is excluded for the same reason: it opens sentences, and
// "Sec." does not.
// The leading whitespace is the discriminator, and it is a sharp one. govinfo
// sets a table-of-contents entry flush left and indents a real heading with the
// body it opens:
//
//     Sec. 1. Short title.                        <- entry, column 0
//         Sec. 101.  Not later than 30 days …     <- heading, indented
//
// In H.J. Res. 31 that splits 656 candidates into 7 entries and 649 headings
// with nothing in between. It is a plain-text convention rather than a drafting
// rule, which is exactly why it is confined to this pattern: caps headings are
// matched by RE_SECTION whatever their indentation, and a PDF — where leading
// space does not survive extraction at all — never reaches this one.
const RE_SECTION_LOOSE = /^[ \t]+(Sec\.)\s+(\d+[A-Za-z]*)\.\s+(\S.*)$/;

// How the structural units nest. A bill states the depth in the label word
// itself, which is the only thing that survives — indentation does not, and the
// numbering restarts inside every division ("TITLE I" appears three times in
// the Fiscal Responsibility Act, once under each of divisions A, B and C).
const DIVISION_RANK = { DIVISION: 0, TITLE: 1, SUBTITLE: 2, CHAPTER: 3 };
const rankOf = (label) => DIVISION_RANK[label.split(/\s+/)[0].toUpperCase()] ?? 9;
// Opens the table of contents. The phrase wraps in PDF-extracted text ("The
// table of contents for\nthis Act is as follows:"), so only the head of it can
// be matched on a single line.
const RE_TOC_ANNOUNCE = /table\s+of\s+contents/i;
// One entry in that table. Sentence case is what separates it from the real
// heading RE_SECTION matches — "Sec. 101." here, "SEC. 101." there.
const RE_TOC_ENTRY = /^\s*Sec\.\s+\d/;

// A line that a table of contents could BEGIN with: an entry, or one of the
// subdivision listings a long table is grouped under.
const RE_TOC_LISTING = /^\s*(?:Sec\.|SEC\.|TITLE|DIVISION|Subtitle|PART|CHAPTER)\b/;

/**
 * Does a table of contents actually follow this line?
 *
 * `RE_TOC_ANNOUNCE` is the phrase "table of contents", and bills say it for two
 * completely different reasons. One announces a table. The other amends
 * somebody else's:
 *
 *     …and (2) in the table of contents of that Act, by striking the part
 *     heading for part B of title IV and inserting the following:
 *
 * One of those in the middle of the Consolidated Appropriations Act, 2020 set
 * `inToc` and **nothing ever cleared it**: the loop only closes the table when a
 * real body follows, and in an appropriations division the next non-caps line is
 * a lowercase account heading, so `realBodyFollows` says no. From there to the
 * end of the bill — 684 KB — `RE_SECTION_LOOSE` was gated off. **338 of hr1865's
 * 897 sections vanished**, with no section head, no `#sec-N` anchor and no jump
 * entry, and `sectionAt()` answered for a paragraph with a section 205 KB
 * earlier, so every "section N of this Act" in that stretch resolved against the
 * wrong one. 101 mid-body mentions across 20 of 26 bills; this is the one that
 * lands.
 *
 * A phrasing test cannot separate them — the announce wraps the 72-column
 * measure ("The table of contents for\nthis Act is as follows:"), so its head is
 * all a single line carries, and a clerical amendment wraps onto a line starting
 * with the identical words. What separates them is what comes NEXT: a table is a
 * listing, so entries follow it. Positive, like `realBodyFollows`, but pointing
 * the other way — ambiguity now keeps us OUT of the table, which is the cheaper
 * error since a flush-left entry is not matched by `RE_SECTION_LOOSE` anyway.
 *
 * The window steps over blank lines and stops after a few, because the entries
 * begin immediately when they begin at all.
 */
function tocFollows(lines, i) {
  for (let j = i + 1, seen = 0; j < lines.length && seen < 4; j++) {
    if (!lines[j].trim()) continue;
    seen++;
    if (RE_TOC_LISTING.test(lines[j])) return true;
  }
  return false;
}

// "This Act may be cited as the ``Digital Asset Market Clarity Act''".
//
// The title is quoted, and the quote style follows the source: govinfo plain
// text writes ``like this'', GPO's typeset PDFs use doubled singles ‘‘like
// this’’, and pasted text has straight or curly doubles. Matching an explicit
// *pair* is what keeps the capture honest — a class of "anything but a quote"
// could not see ’’ at all, so a compound title ran on through every alternative
// name in the sentence and reported "A Act of 2025’’ or the ‘‘B Act of 2025’’
// and the ‘‘C Act" as one title. Only the first name is the Act's short title.
//
// A lone curly single is not a closer (it is usually an apostrophe), so both
// single-quote conventions take two characters, matching QO/QC in
// app/parse/citations.js.
const RE_SHORT_TITLE =
  /may\s+be\s+cited\s+as\s+(?:the\s+)?(?:``|‘‘|[“"])([\s\S]{3,160}?)(?:''|’’|[”"])/i;

// Pasted text sometimes arrives with its quote marks stripped. Read to the end
// of the sentence instead, rather than falling all the way back to the section
// heading ("SHORT TITLE; TABLE OF CONTENTS", which names nothing).
const RE_SHORT_TITLE_BARE = /may\s+be\s+cited\s+as\s+(?:the\s+)?([^".\n]{3,160}?)\s*\./i;

/**
 * Canonicalise line endings before anything measures a character offset.
 *
 * Pasted and downloaded bill text is overwhelmingly CRLF. JS regex treats \r as
 * a line terminator, so a trailing \r makes every `$` anchor fail and silently
 * breaks heading detection. Callers must normalise once, up front, and then use
 * the returned string for parsing, citation offsets, and rendering alike —
 * mixing normalised and raw text would desynchronise every offset in the app.
 */
export function normalizeText(raw) {
  return String(raw).replace(/\r\n?/g, '\n');
}

export function parseBill(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const divisions = [];
  let current = null;
  let offset = 0;
  // The chain of structural units currently open, outermost first. A single
  // "last heading seen" variable is not enough: "TITLE III" overwrote
  // "DIVISION A", and since a bill restarts its title numbering inside every
  // division, the label left behind named three different places at once.
  // Section 123 of the Fiscal Responsibility Act reported "TITLE III—BUDGET
  // ENFORCEMENT IN THE SENATE" and nothing about which division that was in.
  let stack = [];

  let inToc = false;
  // Has the bill's real body started? A sentence-case heading is only
  // believable after it has: everything before is front matter and the table of
  // contents, where the same shape means an entry rather than a section.
  let bodyStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1;

    let sm = line.match(RE_SECTION);
    const capsHead = !!sm;
    // Appropriations bills set their REAL headings in sentence case — "Sec. 101.
    // Notwithstanding any other provision of law…" — which is the shape a table
    // of contents uses for its entries, and the reason matching is
    // case-sensitive at all. Case cannot separate them, so position does: a
    // sentence-case heading counts only outside the table and only once the
    // bill's real body has begun. Both are already tracked.
    if (!sm && bodyStarted && !inToc) sm = line.match(RE_SECTION_LOOSE);
    let dm = sm ? null : line.match(RE_DIVISION);
    // A bare label, with its heading on a later line. Read but not consumed —
    // the heading line is left for the loop, which will ignore it, so no offset
    // moves. Falls back to no heading at all rather than reaching far: a label
    // on its own is still worth navigating by.
    if (!sm && !dm) {
      const bm = line.match(RE_DIVISION_BARE);
      if (bm) dm = [bm[0], bm[1], headingBelow(lines, i)];
    }

    if (dm) {
      // A bill's table of contents lists its divisions in lines byte-identical
      // to the real headings, so every bill with a table of contents was
      // producing each division twice — and the last phantom one carried
      // forward onto the sections that follow the table. That put SEC. 2
      // (DEFINITIONS), which sits above TITLE I, under "TITLE IX—OTHER MATTERS".
      if (inToc && !realBodyFollows(lines, i)) continue;
      inToc = false;
      // A division heading ends the section above it. Only a following SECTION
      // used to close one, so the last section of every division ran on through
      // the heading that ended it — Pub. L. 117-58 § 905 finished with
      // "…may be cited as the ``Infrastructure Investments and Jobs
      // Appropriations Act''. DIVISION K-- MINORITY BUSINESS DEVELOPMENT", and
      // the pane showed that to the reader as part of § 905. 352 of the 19,612
      // section entries in data/plaw, 1.79%.
      //
      // `current` is cleared as well as closed: the next section's own
      // `current.end = lineStart` would otherwise reopen this one and push its
      // end past the division again, which is the same bug one step later.
      if (current) {
        current.end = lineStart;
        current = null;
      }
      const label = dm[1].trim();
      const division = {
        label,
        heading: joinWrappedHeading(lines, i, dm[2], false),
        start: lineStart,
      };
      // A unit closes every unit at its own rank or deeper: TITLE II ends
      // TITLE I, and DIVISION B ends both TITLE III and DIVISION A.
      const rank = rankOf(label);
      while (stack.length && rankOf(stack[stack.length - 1].label) >= rank) stack.pop();
      stack.push(division);
      divisions.push(division);
      bodyStarted = true;
      continue;
    }

    if (sm) {
      inToc = false;
      if (current) current.end = lineStart;
      const ancestors = stack.map((d) => ({ label: d.label, heading: d.heading, start: d.start }));
      current = {
        id: `s${sections.length}`,
        num: sm[2],
        heading: joinWrappedHeading(lines, i, sm[3], true).replace(/\.\s*$/, '').trim(),
        // The innermost enclosing unit, kept as it always was. `ancestors` is
        // the full chain, which is what actually answers "where am I".
        division: stack.length
          ? `${stack[stack.length - 1].label}—${stack[stack.length - 1].heading}`
          : null,
        ancestors,
        // A run-in heading is the appropriations shape: "Sec. 101.  Not later
        // than 30 days …" is the first line of the provision, not a title over
        // it. The renderer needs to know, because the caps styling a real
        // heading gets would shout an entire sentence, and the hard paragraph
        // break after one would cut that sentence in half.
        runIn: !capsHead,
        start: lineStart,
        end: text.length,
      };
      sections.push(current);
      bodyStarted = true;
      // "SEC. 2. TABLE OF CONTENTS." opens the table by itself. Most bills then
      // write "The table of contents for this Act is as follows:", which is the
      // line RE_TOC_ANNOUNCE was built for — but that line is optional, and
      // H.J. Res. 31 goes straight from the heading to the first entry. The
      // heading is consumed here with a `continue`, so the announce check at
      // the bottom of the loop never saw it and the table was never open.
      if (RE_TOC_ANNOUNCE.test(current.heading)) inToc = true;
      continue;
    }

    // "The table of contents for this Act is as follows:" opens the listing.
    // Checked after the two matchers above so that section 1's own heading —
    // "SHORT TITLE; TABLE OF CONTENTS." — is read as the heading it is.
    if (!inToc && RE_TOC_ANNOUNCE.test(line) && tocFollows(lines, i)) inToc = true;
  }

  return {
    text,
    sections,
    divisions,
    meta: guessMeta(text, sections),
  };
}

/**
 * The heading belonging to a label that sits on a line of its own.
 *
 * Appropriations acts centre "TITLE I", leave a blank line, then centre the
 * heading. Scans past blank lines for the first all-caps line, and stops at
 * anything that ends the gap — another label, a section, or body text — so a
 * title with no heading gets an empty one rather than borrowing the next
 * title's.
 *
 * Bounded tightly. The heading is always within a line or two; searching
 * further would eventually find *some* all-caps line and attach it to the
 * wrong label, which is worse than the blank it replaces.
 */
function headingBelow(lines, i) {
  for (let j = i + 1; j < lines.length && j - i <= 3; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (RE_SECTION.test(l) || RE_DIVISION.test(l) || RE_DIVISION_BARE.test(l)) return '';
    if (!isHeadingContinuationLine(l)) return '';
    return joinWrappedHeading(lines, j, l.trim(), false);
  }
  return '';
}

/**
 * Can this line be the continuation of an all-caps heading above it?
 *
 * Exported because the renderer has to ask the same question: parseBill uses it
 * to rebuild the heading *text*, and app/ui/render-bill.js uses it to keep the
 * continuation in the same paragraph as the heading it belongs to. Two spellings
 * of this rule would put the two out of step, and the visible symptom — half a
 * heading in the left pane, styled as body text — is one nobody would connect
 * back to here.
 */
export function isHeadingContinuationLine(line, sofar = '') {
  if (!line.trim()) return false;
  if (RE_SECTION.test(line) || RE_DIVISION.test(line)) return false;
  if (/[a-z]/.test(line)) return false; // body text
  if (/^\s*\(/.test(line)) return false; // an outline marker opens the body
  // Running page furniture in a typeset PDF sits in exactly this gap and is
  // caps-only too: a bulleted running head ("•HR 3633 EH1S") or a bare folio.
  // Tested by shape rather than by "has two capitals in it", which threw away
  // the legitimate continuation "1933." of "DEFINITIONS UNDER THE SECURITIES
  // ACT OF".
  if (/^\s*[•·]/.test(line)) return false;
  // A bare number is a folio — unless the heading so far ends with a comma, in
  // which case it is plainly unfinished and the number is the rest of it.
  // "DIVISION A—DEPARTMENT OF HOMELAND SECURITY APPROPRIATIONS ACT," / "2019"
  // is a real heading in the Consolidated Appropriations Act, 2019, and a folio
  // never follows a comma.
  if (/^\s*\d{1,4}\s*$/.test(line) && !/,$/.test(sofar.trimEnd())) return false;
  return /[A-Za-z0-9]/.test(line);
}

/**
 * A heading too long for the 72-column measure runs onto the next line, and the
 * part that ran on was simply dropped:
 *
 *     SEC. 271. TERMINATION OF SUSPENSION OF PAYMENTS ON FEDERAL STUDENT
 *       LOANS; RESUMPTION OF ACCRUAL OF INTEREST AND COLLECTIONS.
 *
 * The jump menu and the section head showed the first line alone, which stops
 * mid-phrase and reads as a different provision than the one it names.
 *
 * `terminated` says which signal ends the heading. A section heading is set in
 * caps and closed with a period, so the absence of one is what says it wrapped.
 * A division heading carries no period at all, so it runs to the blank line
 * that always follows it.
 *
 * Only an all-caps line can continue an all-caps heading: body text carries
 * lower case, and an outline marker opens the body outright. Continuation lines
 * are read but never consumed — the loop still walks them, so every offset in
 * the bill stays exactly where it was.
 */
function joinWrappedHeading(lines, i, first, terminated) {
  let out = first.trim();
  if (terminated && /\.\s*$/.test(out)) return out;

  // The real terminators below do the work; the cap is only a backstop. A
  // typeset PDF sets headings in a narrow column, and the CLARITY Act's
  // "TITLE IV—REGISTRATION FOR / DIGITAL COMMODITY INTER- / MEDIARIES AT THE
  // COM- / MODITY FUTURES TRADING / COMMISSION" runs to five lines.
  for (let j = i + 1; j < lines.length && j - i <= 6; j++) {
    const l = lines[j];
    if (!isHeadingContinuationLine(l, out)) break;
    // A word broken across the measure keeps its hyphen and loses the space,
    // the same rule guessMeta() uses for a wrapped short title. That leaves
    // "RULE-MAKING" rather than gluing it into "RULEMAKING" — the hyphen may
    // be spurious, but inventing a word is worse than showing a visible seam.
    out += /-$/.test(out) ? l.trim() : ` ${l.trim()}`;
    if (terminated && /\.\s*$/.test(out)) break;
  }
  return out;
}

/**
 * Standing inside the table of contents, does the division heading on line `i`
 * open the bill's real body?
 *
 * The listed line and the real one are byte-identical, so the answer is in what
 * follows: the bill's own "SEC. 101." heading means the table is over, while the
 * table's "Sec. 101." entries mean it is not. Nested listings are skipped on the
 * way, because a table puts "TITLE I" straight after "DIVISION A" with nothing
 * in between.
 *
 * Deliberately a *positive* test. Asking the opposite question — "is a table
 * entry next?" — reads anything unexpected as the end of the table, and a long
 * heading wrapped onto a second line ("TITLE IV—TERMINATION OF SUSPENSION OF
 * PAYMENTS ON FEDERAL STUDENT / LOANS; RESUMPTION OF ACCRUAL OF INTEREST") is
 * exactly that. It ended the table two thirds of the way through and let the
 * remaining six listings back in. Inside an announced table, ambiguity should
 * leave us in it.
 */
function realBodyFollows(lines, i) {
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    // Tested before the all-caps skip below, because a real section heading is
    // itself all caps.
    if (RE_SECTION.test(l)) return true;
    // An appropriations act's real headings are sentence case, so asking only
    // for caps meant its first real division could never prove itself and the
    // whole bill stayed "inside the table of contents". The indentation
    // requirement is what keeps this from matching the table's own entries.
    if (RE_SECTION_LOOSE.test(l)) return true;
    if (RE_DIVISION.test(l)) continue;
    // A heading too long for the measure wraps, and a typeset PDF hyphenates it
    // where it breaks: "TITLE I—DEFINITIONS; RULE- / MAKING; EXPEDITED REG- /
    // ISTRATION / SEC. 101. …". Those continuation lines sit between the
    // division and its first section, and stopping on one hid a real TITLE I.
    // Running page furniture ("•HR 3633 EH1S", a bare folio) is caps-only too,
    // and gets skipped by the same test. A table entry never is — "Sec. 101.
    // Definitions under the Securities Act of 1933" is full of lowercase.
    if (!/[a-z]/.test(l)) continue;
    return false;
  }
  return false;
}

function guessMeta(text, sections) {
  const head = text.slice(0, 4000);

  // "H. R. 1" / "S. 2345" — the bill designation, usually the first strong token.
  const desig = head.match(/\b([HS])\.\s?(?:(R|J\.\s?RES|CON\.\s?RES|RES)\.)?\s?(\d{1,5})\b/i);
  // The short title lives in section 1: "This Act may be cited as the ... Act".
  const short = text.match(RE_SHORT_TITLE) || text.match(RE_SHORT_TITLE_BARE);
  const congress = head.match(/(\d{2,3})(?:st|nd|rd|th)\s+CONGRESS/i);

  return {
    designation: desig ? desig[0].replace(/\s+/g, ' ').trim() : null,
    // Bills hard-wrap at about 72 columns, so a title long enough to matter is
    // usually split across a line with the next line indented. Collapse the
    // wrap: the title is rendered inline, where a raw newline breaks the layout.
    // A hyphen at a line break is part of the name, not a break in it: govinfo
    // wrapped "United States-\nMexico-Canada" and collapsing the newline to a
    // space left "United States- Mexico-Canada". Rejoin at the hyphen first.
    shortTitle: short
      ? short[1].replace(/-\s*\n\s*/g, '-').replace(/\s+/g, ' ').trim()
      : sections[0]
      ? sections[0].heading
      : null,
    congress: congress ? congress[1] : null,
  };
}

/** Which bill section contains a given character offset. */
export function sectionAt(bill, offset) {
  return bill.sections.find((s) => offset >= s.start && offset < s.end) || null;
}
