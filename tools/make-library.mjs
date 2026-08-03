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
  out.push({
    id,
    file,
    name: b.name.replace(/\s*\((?:enrolled|joint resolution, enrolled)\)\s*$/, ''),
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
