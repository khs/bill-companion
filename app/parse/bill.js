// Bill structure parsing: split raw bill text into navigable sections.
//
// Congressional drafting style is rigid enough to key off directly:
//   SECTION 1. SHORT TITLE.        <- only the first section spells out "SECTION"
//   SEC. 2. DEFINITIONS.
//   TITLE I—ENERGY SECURITY
//   Subtitle A—Efficiency
// Section headings are set in caps and terminated by a period.

const RE_DIVISION = /^\s*(DIVISION\s+[A-Z0-9]+|TITLE\s+[IVXLC]+|Subtitle\s+[A-Z]|CHAPTER\s+[IVXLC0-9]+)\s*[—–-]\s*(.+?)\s*$/;
const RE_SECTION = /^\s*(SECTION|SEC\.)\s+(\d+[A-Za-z]*)\.\s*(.*)$/;
// Opens the table of contents. The phrase wraps in PDF-extracted text ("The
// table of contents for\nthis Act is as follows:"), so only the head of it can
// be matched on a single line.
const RE_TOC_ANNOUNCE = /table\s+of\s+contents/i;
// One entry in that table. Sentence case is what separates it from the real
// heading RE_SECTION matches — "Sec. 101." here, "SEC. 101." there.
const RE_TOC_ENTRY = /^\s*Sec\.\s+\d/;

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
  let division = null;

  let inToc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1;

    const sm = line.match(RE_SECTION);
    const dm = sm ? null : line.match(RE_DIVISION);

    if (dm) {
      // A bill's table of contents lists its divisions in lines byte-identical
      // to the real headings, so every bill with a table of contents was
      // producing each division twice — and the last phantom one carried
      // forward onto the sections that follow the table. That put SEC. 2
      // (DEFINITIONS), which sits above TITLE I, under "TITLE IX—OTHER MATTERS".
      if (inToc && !realBodyFollows(lines, i)) continue;
      inToc = false;
      division = { label: dm[1].trim(), heading: dm[2].trim(), start: lineStart };
      divisions.push(division);
      continue;
    }

    if (sm) {
      inToc = false;
      if (current) current.end = lineStart;
      current = {
        id: `s${sections.length}`,
        num: sm[2],
        heading: sm[3].replace(/\.\s*$/, '').trim(),
        division: division ? `${division.label}—${division.heading}` : null,
        start: lineStart,
        end: text.length,
      };
      sections.push(current);
      continue;
    }

    // "The table of contents for this Act is as follows:" opens the listing.
    // Checked after the two matchers above so that section 1's own heading —
    // "SHORT TITLE; TABLE OF CONTENTS." — is read as the heading it is.
    if (!inToc && RE_TOC_ANNOUNCE.test(line)) inToc = true;
  }

  return {
    text,
    sections,
    divisions,
    meta: guessMeta(text, sections),
  };
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
