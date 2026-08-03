// Build samples/library.json — the menu behind "Load sample".
//
// The bills are already in the repo: corpus/files holds thirty real ones and
// corpus/corpus.json already carries a name and a reason for each, written when
// they were chosen as regression fixtures. So the menu is derived rather than
// authored, the same rule the popular-names table follows, and a bill cannot
// appear in it that the corpus does not actually have.
//
// Curated by SIZE rather than exhaustively. Thirty entries is a directory
// listing, not a menu, and the useful thing to offer someone opening this for
// the first time is a spread: a ten-kilobyte introduced bill they can read end
// to end, an appropriations act with 660 sections, and the recognisable
// landmarks in between.
//
//     node tools/make-library.mjs

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Chosen for range: smallest first, so the menu reads as an on-ramp. Each is a
// corpus id; the name and the note come from corpus.json.
const PICKS = [
  'hr1719-119-ih',        // introduced, 10 KB — readable end to end
  'hr1957-116-enr',       // 16 KB
  's2938-117-enr',        // 95 KB
  'hr3746-118-enr',       // 117 KB — the long-standing default sample
  'hr6201-116-enr',       // 126 KB
  's756-115-enr',         // 173 KB
  'hr3162-107-enr',       // 407 KB
  'hr3633-119-rs-substitute', // 464 KB — a PENDING bill, not an enacted one
  'hr1-115-enr',          // 562 KB — tax, heavy on "such Code"
  'hr5376-117-enr',       // 844 KB
  'hr748-116-enr',        // 1.0 MB
  'hjres31-116-enr',      // 1.4 MB — appropriations shape, 660 sections
  'hr3590-111-enr',       // 2.8 MB — the largest worth offering
];

const LIMIT = 96;

/** One line of prose, cut at a word boundary, or a full stop that really ends a
 *  sentence — a period after a single capital is an initial ("S. 2938"). */
function summarise(why) {
  // The size leads several of these notes and the menu already has a column for
  // it, so it is dropped rather than shown twice.
  const s = why.replace(/\s+/g, ' ').replace(/^~?\d+(?:\.\d+)?\s*[KM]B[.,]?\s*/i, '').trim();
  const stop = s.search(/(?<![A-Z])\.\s+[A-Z]/);
  if (stop > 0 && stop <= LIMIT) return s.slice(0, stop + 1);
  if (s.length <= LIMIT) return s;
  const cut = s.slice(0, LIMIT);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

// Written-out years, as an enrolled bill prints its own session:
//
//   "Begun and held at the City of Washington on Friday, the third day of
//    January, two thousand and twenty"
//
// so the year is read off the bill rather than typed beside it. A session runs
// within one calendar year and a bill is enrolled in the session that passed it,
// which makes this the year the Act was enacted.
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordsToYear(s) {
  const w = s.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((x) => x && x !== 'and');
  // "nineteen ninety eight" | "two thousand and twenty" | "two thousand nine"
  if (w[0] === 'two' && w[1] === 'thousand') {
    const rest = w.slice(2);
    if (!rest.length) return 2000;
    let n = 0;
    for (const t of rest) {
      if (TENS[t] != null) n += TENS[t];
      else if (ONES.indexOf(t) > 0) n += ONES.indexOf(t);
      else return null;
    }
    return 2000 + n;
  }
  if (w[0] === 'nineteen') {
    let n = 0;
    for (const t of w.slice(1)) {
      if (TENS[t] != null) n += TENS[t];
      else if (ONES.indexOf(t) > 0) n += ONES.indexOf(t);
      else return null;
    }
    return 1900 + n;
  }
  return null;
}

/**
 * The year a bill that has NOT been enacted belongs to.
 *
 * A pending bill has no enrolled preamble because it has no session that passed
 * it, and no enactment year because it has not been enacted. What it does have
 * is the Congress it is before, which is in its corpus id — the 1st Congress
 * convened in 1789 and each runs two years, so the 119th opened in 2025.
 *
 * That is the honest year for a bill still in progress, and it is what the name
 * of such a bill uses anyway: "Farm to Fly Act of 2025", introduced in the
 * 119th.
 */
function congressYear(id) {
  const m = /-(\d{2,3})-/.exec(id);
  return m ? 1789 + 2 * (Number(m[1]) - 1) : null;
}

/** The year the bill's own preamble names, or null. */
function yearOf(file) {
  let text = readFileSync(join(ROOT, file), 'utf8');
  if (/\.html?$/i.test(file)) text = text.replace(/<[^>]*>/g, '');
  const head = text.slice(0, 4000).replace(/\s+/g, ' ');
  const m = /day\s+of\s+[A-Z][a-z]+,\s+((?:nineteen|two\s+thousand)[a-z\s-]{0,28}?)(?=[,.]|\s+An\s+Act|\s+Joint\s+Resolution|$)/i.exec(head);
  return m ? wordsToYear(m[1]) : null;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/corpus.json'), 'utf8'));
const bills = Array.isArray(manifest) ? manifest : manifest.bills;
const byId = new Map(bills.map((b) => [b.id, b]));

const out = [];
for (const id of PICKS) {
  const b = byId.get(id);
  if (!b) throw new Error(`${id} is not in corpus.json`);
  // A tracked fixture under samples/ is preferred where one exists: it is the
  // file the tests already assert against, and it is served locally either way.
  let file = b.local || null;
  if (!file) {
    for (const ext of ['.htm', '.txt', '.pdf']) {
      if (existsSync(join(ROOT, `corpus/files/${id}${ext}`))) { file = `corpus/files/${id}${ext}`; break; }
    }
  }
  if (!file || !existsSync(join(ROOT, file))) throw new Error(`${id}: no file on disk`);
  // Every entry says when. A name that already carries its year keeps it —
  // "Inflation Reduction Act of 2022" must not become "…of 2022 (2022)" — and
  // one that does not gets it in parentheses.
  const bare = b.name.replace(/\s*\((?:enrolled|joint resolution, enrolled)\)\s*$/, '');
  // The enrolled preamble first, because it names the session that actually
  // passed the bill; the Congress only where there is no preamble to read.
  const year = yearOf(file) || congressYear(id);
  const hasYear = /\b(?:1[89]\d\d|20\d\d)\b/.test(bare);
  if (!hasYear && !year) throw new Error(`${id}: no year in the name and none in the text`);
  out.push({
    id,
    file,
    // A name that already ends in a parenthetical takes the year INSIDE it —
    // "CLARITY Act (H.R. 3633, Senate substitute text) (2025)" is two brackets
    // where one will do.
    name: hasYear ? bare
      : /\)$/.test(bare) ? bare.replace(/\)$/, `, ${year})`)
      : `${bare} (${year})`,
    year: year || Number(bare.match(/\b(?:1[89]\d\d|20\d\d)\b/)[0]),
    // Why the bill is in the corpus, trimmed to a line. Written for another
    // developer, but it says what is interesting about the bill, which is
    // exactly what a menu entry needs.
    //
    // Cut on LENGTH at a word boundary rather than on the first full stop: these
    // notes are dense with abbreviations, and "first sentence" gave "A Senate
    // bill, so it exercises the S." and a bare "15 KB." A truncation that admits
    // it is one is better than a sentence that ends in the middle of a citation.
    note: summarise(String(b.why || '')),
    bytes: statSync(join(ROOT, file)).size,
  });
}

out.sort((a, b) => a.bytes - b.bytes);
writeFileSync(join(ROOT, 'samples/library.json'), `${JSON.stringify(out, null, 1)}\n`, 'utf8');
console.log(`samples/library.json: ${out.length} bills, ${(out.reduce((n, e) => n + e.bytes, 0) / 1048576).toFixed(1)} MB total`);
for (const e of out) console.log(`  ${String(Math.round(e.bytes / 1024)).padStart(5)}K  ${e.name}`);
