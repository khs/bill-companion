// One definition of "what did this bill parse to", shared by tools/impact.mjs
// (one bill, printed) and tools/corpus.mjs (many bills, diffed against a
// baseline). Keeping it in one place is the point: a metric that means something
// slightly different in the two reports is worse than no metric.
//
// Everything here is a pure function of the bill text. U.S. Code resolution is
// deliberately NOT part of it — those numbers move when the Code is re-ingested,
// which would make every release point look like a parser regression. Resolution
// is measured separately, by impact.mjs, where that is the question being asked.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node's ESM loader rejects a bare Windows path ("Received protocol 'c:'");
// bun accepts one. Every dynamic import here goes through a file:// URL so the
// tools run the same under both.
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { extractCitations, extractAmendments, expandRelativeRefs } =
  await imp('app/parse/citations.js');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');

/** Read a bill off disk. Handles the three shapes the corpus holds. */
export async function loadBill(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) {
    globalThis.DOMMatrix ??= class { constructor() {} };
    const { pdfToText } = await imp('app/parse/pdf.js');
    const { text, pages } = await pdfToText(new Uint8Array(readFileSync(path)).buffer);
    return { text, pages };
  }
  const raw = readFileSync(path, 'utf8');
  // govinfo serves bill text as HTML with the whole bill inside one <pre>.
  if (lower.endsWith('.htm') || lower.endsWith('.html')) return { text: unwrapPre(raw), pages: null };
  return { text: raw, pages: null };
}

/** Pull the bill out of a govinfo <pre> wrapper, entities and all. */
export function unwrapPre(html) {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const body = m ? m[1] : html.replace(/<[^>]+>/g, '');
  return body
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Every "is amended" must fall inside a parsed amendment. See selftest.mjs.
 *
 * The qualifier is part of the verb, and leaving it out made this instrument
 * blind to 435 amendatory verbs across the corpus — "is FURTHER amended" is one
 * of the commonest phrasings there is, and "are each amended" is the whole
 * distributed form. Verbs sitting outside every parsed instruction were 285 by
 * the old count and 580 by this one, so the tail this project tracks as a
 * hundred-odd one-off phrasings was undercounted by half.
 *
 * The four are measured, not guessed: further 361, each 62, hereby 11, both 1,
 * and nothing else occurs. An alternation with a dead branch is a claim about
 * the corpus that nobody checked.
 */
export function uncoveredAmendVerbs(text, ams) {
  const re = /\b(is|are)\s+(?:further\s+|each\s+|hereby\s+|both\s+)?(amended|repealed)\b/g;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    const i = m.index;
    if (!ams.some((a) => i >= (a.viaInstruction ?? a.start) && i <= a.end)) n++;
  }
  return n;
}

/**
 * @param {string} raw  bill text, un-normalised
 * @returns metrics, plus the parsed objects for callers that want to dig
 */
export function measure(raw) {
  const text = normalizeText(raw);
  const bill = parseBill(text);
  const cites = extractCitations(text);
  const ams = extractAmendments(text, cites, bill.divisions, bill.sections);
  const expanded = expandRelativeRefs(cites, ams);

  const byKind = {};
  for (const c of cites) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  const ops = {};
  for (const a of ams) for (const o of a.ops) ops[o.type] = (ops[o.type] || 0) + 1;

  const sorted = cites.slice().sort((a, b) => a.start - b.start);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) overlaps++;

  const opSpans = new Set(
    ams.flatMap((a) => a.ops.filter((o) => o.start != null).map((o) => `${o.type}:${o.start}-${o.end}`))
  );

  return {
    metrics: {
      chars: text.length,
      sections: bill.sections.length,
      divisions: bill.divisions.length,
      citations: cites.length,
      byKind,
      amendments: ams.length,
      targeted: ams.filter((a) => a.target).length,
      distributed: ams.filter((a) => a.distributed).length,
      steps: ams.reduce((n, a) => n + a.steps.length, 0),
      refs: ams.reduce((n, a) => n + a.refs.length, 0),
      relative: expanded.filter((c) => c.relative).length,
      ops,
      opSpans: opSpans.size,
      // Tracked, not absolute. Every "is amended" ought to sit inside a parsed
      // amendment, and on the four bills the test suite asserts against it does
      // — but across the wider corpus a long tail of one-off phrasings remains,
      // so this is baselined and watched for growth rather than required to be
      // zero. It went 93 → 16 when the analysis-for, semicolon-in-parenthetical
      // and "of such section" gaps were closed.
      uncoveredVerbs: uncoveredAmendVerbs(text, ams),
      badOffsets: cites.filter((c) => text.slice(c.start, c.end) !== c.text).length,
      overlaps,
      badOpOffsets: ams
        .flatMap((a) => a.ops)
        .filter((o) => o.text != null && o.start != null && text.slice(o.start, o.end) !== o.text).length,
    },
    shortTitle: bill.meta.shortTitle,
    text,
    bill,
    cites,
    ams,
    expanded,
  };
}

/**
 * Metrics that are always a bug when non-zero, whatever the baseline says.
 *
 * These are structural: a citation offset that doesn't round-trip, two citations
 * claiming the same characters, or an operand span pointing at text it doesn't
 * match will each mis-render the bill. All three are zero across every bill in
 * the corpus, which is what makes them safe to assert absolutely rather than
 * baseline. `uncoveredVerbs` is deliberately not here — see above.
 */
export const INVARIANTS = ['badOffsets', 'overlaps', 'badOpOffsets'];
