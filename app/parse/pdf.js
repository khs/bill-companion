// PDF -> plain text, tuned for the way Congress publishes bills.
//
// pdf.js hands back positioned text runs, not lines. Naive concatenation of
// item.str produces text where a citation can be split across "items" and the
// marginal line numbers on introduced/engrossed bills ("1".."25" down the left
// edge) get interleaved into the body — both of which wreck citation matching.
// So we rebuild lines from glyph geometry and drop the margin gutter.

import * as pdfjsLib from '../../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;

/**
 * @param {ArrayBuffer} buf
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{text:string, pages:number}>}
 */
export async function pdfToText(buf, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const [, , , , , pageTop] = page.view; // view = [x0,y0,x1,y1]
    pages.push(pageText(content.items, page.view));
    page.cleanup();
    if (onProgress) onProgress(i, pdf.numPages);
    void pageTop;
  }

  await pdf.destroy();
  return { text: pages.join('\n\n').replace(/\n{3,}/g, '\n\n'), pages: pages.length };
}

function pageText(items, view) {
  const pageWidth = view[2] - view[0];
  const rows = groupRows(items);
  const gutter = findGutter(rows, pageWidth);
  const lines = [];

  for (const runs of rows) {
    const stripped = stripLineNumber(runs, gutter);
    if (!stripped.length) continue;

    let line = '';
    let prevEnd = null;
    for (const r of stripped) {
      // Insert a space when there's a visible gap and neither side already has
      // one; pdf.js often emits adjacent runs with no separator.
      if (prevEnd !== null && r.x - prevEnd > 1 && !/\s$/.test(line) && !/^\s/.test(r.str)) line += ' ';
      line += r.str;
      prevEnd = r.x + r.width;
    }
    const t = line.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }

  return dehyphenate(lines).join('\n');
}

// Glyphs on one baseline belong to one line. Bucketing by a rounded Y is the
// obvious way to group them and it is wrong: a page whose baselines land on odd
// integers puts y/2 exactly on the rounding boundary, and float drift then sends
// some glyphs of a single line up and the rest down. A real page here has every
// glyph of a line at y=707 — 707/2 is 353.5 — and the line came apart into
// "(1) A" and "CCEPTABLE LEVELS OF CATASTROPHIC". Cluster by distance instead,
// so grouping depends on how far apart baselines are and never on where they sit.
const ROW_TOLERANCE = 2; // pt — absorbs subpixel drift, far under line spacing

function groupRows(items) {
  const glyphs = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    glyphs.push({ x: it.transform[4], y: it.transform[5], str: it.str, width: it.width || 0 });
  }
  glyphs.sort((a, b) => b.y - a.y); // top of page first

  const rows = [];
  let cur = null;
  for (const g of glyphs) {
    if (!cur || cur.y - g.y > ROW_TOLERANCE) { cur = { y: g.y, runs: [] }; rows.push(cur); }
    cur.runs.push(g);
  }
  return rows.map((r) => r.runs.sort((a, b) => a.x - b.x));
}

// Bills number every line in the left margin, but where that margin falls is a
// choice of the typesetter, not a constant: govinfo's enrolled PDFs set the
// numbers near the paper's edge, while a sponsor's XML draft indents the whole
// text block and lands them a fifth of the way across the page. A fixed "leftmost
// 8%" rule silently keeps every number on the latter, which leaves "3 SEC. 2."
// in the text and hides every section heading from the parser.
//
// So ask the page. A numbered line starts with a bare 1-2 digit run, aligns with
// its neighbours, and has a wide gap to the body text — and the numbers count
// upward down the page. Ordinary prose beginning with a number does none of that
// consistently.
//
// Which edge they align on also varies. These numbers are right-aligned, so "1"
// and "10" start at different x and a left-edge consensus finds only the 10-25
// column, quietly leaving 1-9 in the text. Score both edges and keep whichever
// the page actually agrees on.
function findGutter(rows, pageWidth) {
  const byLeft = new Map();
  const byRight = new Map();

  for (const runs of rows) {
    if (runs.length < 2) continue;
    const [first, second] = runs;
    if (!/^\d{1,2}$/.test(first.str.trim())) continue;
    if (first.x > pageWidth * 0.35) continue;                 // the gutter is a left margin
    if (second.x - (first.x + first.width) < 8) continue;     // a word space is ~3pt, not 8
    push(byLeft, Math.round(first.x), Number(first.str.trim()));
    push(byRight, Math.round(first.x + first.width), Number(first.str.trim()));
  }

  const left = bestColumn(byLeft);
  const right = bestColumn(byRight);
  if (!left && !right) return null;
  if (left && right) return right.count >= left.count ? { edge: 'right', x: right.x } : { edge: 'left', x: left.x };
  return left ? { edge: 'left', x: left.x } : { edge: 'right', x: right.x };
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function bestColumn(tally) {
  let best = null;
  for (const [x, nums] of tally) {
    if (nums.length < 4) continue;
    // Counting upward is what separates a line-number gutter from a column of
    // figures that merely happens to line up.
    let ascending = 0;
    for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) ascending++;
    if (ascending < (nums.length - 1) * 0.6) continue;
    if (!best || nums.length > best.count) best = { x, count: nums.length };
  }
  return best;
}

function stripLineNumber(runs, gutter) {
  if (!gutter || runs.length < 2) return runs;
  const first = runs[0];
  const edge = gutter.edge === 'right' ? first.x + first.width : first.x;
  if (Math.abs(edge - gutter.x) > 2) return runs;
  if (!/^\d{1,2}$/.test(first.str.trim())) return runs;
  return runs.slice(1);
}

// Bill text is justified and hyphenates across lines. Rejoin "environ-\nmental"
// but leave real compounds ("cost-\neffective" stays hyphenated) alone by only
// merging when the next line starts lowercase.
function dehyphenate(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (/[a-z]-$/.test(line) && i + 1 < lines.length && /^[a-z]/.test(lines[i + 1])) {
      line = line.slice(0, -1) + lines[i + 1];
      i++;
    }
    out.push(line);
  }
  return out;
}
