#!/usr/bin/env node
//
// Does the panel tell the reader the truth about what the pane drew?
//
//   node tools/paneltest.mjs            # every corpus bill
//   node tools/paneltest.mjs <id>       # one bill
//   node tools/paneltest.mjs --list     # every distinct sentence, with counts
//
// Every other instrument here samples MARKS or CITATIONS. None has ever sampled
// the SENTENCES, and that is the one population the reports are structurally
// blind to: `coverage.mjs` decides an op's bucket with `here(placed, o)`, which
// is the same call the panel makes, so the report and the panel agree by
// construction and a disagreement between the panel and the PROVISION cannot
// show up in either. CLAUDE.md says so twice, about two different bugs.
//
// The invariant behind it is the one that has broken five times — "every 'dealt
// with but deliberately not drawn' flag has to be named in BOTH the decliner and
// placed()". Every one of those breaks was a sentence contradicting a mark, and
// none was catchable by counting.
//
// It is a test, not a report: it exits non-zero.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

let parseHTML;
try {
  ({ parseHTML } = await import('linkedom'));
} catch {
  console.log('linkedom not installed — skipping panel tests.');
  console.log('  install with:  npm i -D linkedom');
  process.exit(0);
}

// Shards off disk, the same shim coverage.mjs and impact.mjs use.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:/i.test(u)) return realFetch(u, opts);
  const p = join(ROOT, u);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(p, 'utf8')),
    arrayBuffer: async () => {
      const b = readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
};
globalThis.DOMMatrix ??= class { constructor() {} };

const { window, document } = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8'));
globalThis.window = window;
globalThis.document = document;
globalThis.DOMParser = window.DOMParser;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

const { extractCitations, extractAmendments } = await imp('app/parse/citations.js');
const { normalizeText, parseBill } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { createRedline, fold } = await imp('app/ui/redline.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { renderContext, subtreeText } = await imp('app/ui/render-context.js');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const only = args.filter((a) => !a.startsWith('--')).find((a) => a !== (args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null));
// A DIRECTORY of bills instead of the corpus, so the same instrument can be
// pointed at a different sample. The corpus is 28 enacted bills and 2 pending
// ones, which is a blind spot in exactly the dimension the enacted/pending
// guards operate in — pointing this at a folder of introduced bills is how you
// find out whether the sentences hold up there too.
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const bills = dirArg
  ? readdirSync(dirArg)
      .filter((f) => /\.(htm|html|txt|pdf)$/i.test(f))
      .map((f) => ({ id: f.replace(/\.[^.]+$/, ''), local: join(dirArg, f) }))
  : (() => {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/corpus.json'), 'utf8'));
      return (Array.isArray(manifest) ? manifest : manifest.bills || Object.values(manifest)[0])
        .filter((x) => !only || x.id === only);
    })();

async function textOf(path) {
  if (path.toLowerCase().endsWith('.pdf')) {
    const { pdfToText } = await imp('app/parse/pdf.js');
    return (await pdfToText(new Uint8Array(readFileSync(path)).buffer)).text;
  }
  const raw = readFileSync(path, 'utf8');
  return /\.html?$/i.test(path) ? unwrapPre(raw) : raw;
}

/**
 * What each sentence CLAIMS about whether this op is marked in the provision.
 *
 * `true`  — the reader is sent to look for it above.
 * `false` — the reader is told it is not drawn, for a stated reason.
 * `null`  — the sentence is about the LAW, not about the pane, and claims
 *           nothing either way.
 *
 * Keyed on the sentence rather than on the branch that produced it, because the
 * sentence is what the reader gets and a branch can be reached two ways. FIRST
 * match wins, so the narrower wording has to come first: "already in the law —
 * marked above" sends the reader upward and "already in the law as it stands"
 * does not.
 */
const CLAIMS = [
  [/already in the law as it stands/i, null],
  [/found in current text/i, null],
  [/shown above/i, true],
  [/struck above/i, true],
  [/marked above/i, true],
  [/the provision above already reads/i, true],
  [/changes capitalisation only/i, false],
  [/heading, not its text/i, false],
  [/removes a run of text/i, false],
  [/already struck from the law/i, false],
  [/not found verbatim/i, false],
  [/anchor text not found/i, false],
  [/position not stated/i, false],
  [/which is not in this provision/i, false],
  [/not shown here/i, false],
  [/the provision it follows is not shown/i, false],
  [/whole section, not part of this provision/i, false],
  [/not to the provision shown/i, false],
  [/added at the end of the Act/i, false],
  [/adds a whole new section/i, false],
  [/added language not delimited/i, false],
];
const claimOf = (s) => {
  for (const [re, v] of CLAIMS) if (re.test(s)) return v;
  return undefined;
};

// An operation drawn as a block or a node mark rather than as a run of text.
const structural = (o) =>
  o.type === 'add-at-end' || o.type === 'replace' || (o.type === 'insert' && o.placement === 'after-unit');

let checked = 0;
let unknown = 0;
let inlineBad = 0;
let countBad = 0;
const seen = new Map();
const bad = [];
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

for (const bill of bills) {
  const path = bill.local
    ? (existsSync(bill.local) ? bill.local : join(ROOT, bill.local))
    : join(ROOT, 'corpus/files', `${bill.id}.htm`);
  if (!existsSync(path)) continue;
  const text = normalizeText(await textOf(path));
  const parsed = parseBill(text);
  const ams = extractAmendments(text, extractCitations(text), parsed.divisions, parsed.sections);

  for (const a of ams) {
    if (!a.target || !a.ops.length) continue;
    let res;
    try { res = await resolve(a.target); } catch { continue; }
    if (!res || !res.tree) continue;

    const whole = [
      [res.lead || '', ...res.tree.map(flattenText)].join('\n'),
      [res.lead || '', ...res.tree.map(subtreeText)].join('\n'),
    ];
    const paths = new Set();
    const collect = (n) => { paths.add(String(n.path || '')); (n.children || []).forEach(collect); };
    res.tree.forEach(collect);
    const redline = createRedline(a.ops, whole, paths.size ? paths : null);

    // ONE render, and every fact read back out of it.
    //
    // A redline is stateful and single-use — `done` latches and additionsAt()
    // hands each addition out once — so walking it here and letting
    // renderContext() walk it again reported 612 additions as "the provision it
    // follows is not shown" when the first walk had already consumed them. The
    // panel and the provision come out of the SAME render, which is also what
    // makes this a test of the pane rather than of a reconstruction of it.
    const root = renderContext({ ...res, effect: { ops: a.ops, redline, unmatched: false } }, {});

    // Inline marks, by text. A segment carries no op — it is a run of the LAW,
    // and the op is what asked for it — so the two are matched on folded text.
    // A MULTISET, because several operations of one instruction routinely strike
    // the same word and the tally below compares counts.
    const inlineMarks = [];
    for (const e of root.querySelectorAll('.del, .ins, .was-ins'))
      inlineMarks.push(fold(e.textContent).norm.trim());
    // Structural marks have no text of their own to match — a `.node.added`
    // block is the bill's language and a `.node.replaced` or `.was-added` is the
    // LAW's — so they are counted rather than matched. That is weaker per op and
    // exactly strong enough for the invariant this exists for: a refusal spelled
    // "mark done and draw nothing" makes the panel promise more marks than the
    // provision carries.
    const nodeMarks = {
      added: root.querySelectorAll('.node.added').length,
      replaced: root.querySelectorAll('.node.replaced').length,
      wasAdded: root.querySelectorAll('.was-added').length,
      // A whole-section rewrite has no node to mark — it is stated in a card at
      // the top of the provision, which is what "the provision is marked above"
      // means for that shape.
      whole: root.querySelectorAll('.card.warn').length,
    };
    let promised = 0;
    const tally = new Map();

    const rows = [...root.querySelectorAll('.op-row')];
    for (let i = 0; i < rows.length; i++) {
      const status = [...rows[i].children]
        .slice(1)
        .map((e) => e.textContent.trim())
        .filter((t) => /^[✓⚠]/.test(t))
        .join(' ');
      if (!status) continue;
      const op = a.ops[i];
      if (!op) continue;
      checked++;
      bump(seen, status.replace(/[“”][^“”]*[“”]/g, '“…”').slice(0, 90));
      const claim = claimOf(status);
      if (claim === undefined) {
        unknown++;
        if (bad.length < 40) bad.push({ bill: bill.id, why: 'UNCLASSIFIED SENTENCE', status });
        continue;
      }
      if (claim === null) continue;
      if (structural(op)) { if (claim) promised++; continue; }

      const needle = fold(op.operand || op.text || '').norm.trim();
      // Four alphanumerics is the floor `alreadyThere` uses, and for the same
      // reason: below it a match is a coincidence. Bills insert a lone comma
      // constantly, and two of them in one instruction cannot be told apart.
      if (needle.replace(/[^a-z0-9]/g, '').length < 4) continue;
      if (!tally.has(needle)) tally.set(needle, { yes: new Set(), no: 0, rows: [] });
      const t = tally.get(needle);
      // Counted per SCOPE, not per op, and the reason is `segments()`. Two
      // operations of one instruction can enact the SAME phrase at the same
      // offset — 7 U.S.C. 1377 and 18 U.S.C. 477 each do — and the overlap rule
      // keeps one mark, deliberately, so that a strikethrough is never drawn
      // through the middle of a `was` mark. Both rows then honestly send the
      // reader to that one mark. Per-op counting reports those two as lies; per
      // scope it asks the question that survives the collapse: for each
      // provision the panel says is marked, is something marked there?
      if (claim) t.yes.add(String(op.scope || '')); else t.no++;
      t.rows.push({ op, status, claim });
    }

    // Counted per NEEDLE, not per op, because several operations of one
    // instruction routinely strike the same word and no text match can tell them
    // apart: 38 U.S.C. 1720F strikes "veterans" four times and a plain strike
    // fires once, so three rows correctly say "not found verbatim" while the
    // fourth's mark sits on screen. Comparing counts asks the question that
    // survives that — does the panel promise more marks than the provision
    // carries, or carry more than it accounts for?
    for (const [needle, t] of tally) {
      const equal = inlineMarks.filter((m) => m === needle).length;
      const covering = inlineMarks.filter((m) => m === needle || m.includes(needle)).length;
      // Over-promised: more rows send the reader upward than there are marks
      // covering those characters. `covering`, not `equal`, because a strike
      // enacted through its paired insert has no mark of its own and the `was`
      // span over the new phrase contains the struck words.
      if (t.yes.size > covering) {
        inlineBad++;
        if (bad.length < 40)
          bad.push({ bill: bill.id, cite: res.citation, type: t.rows[0].op.type,
                     op: needle.slice(0, 55),
                     why: `${t.yes.size} scope(s) say drawn, ${covering} mark(s) cover it`,
                     status: (t.rows.find((r) => r.claim) || t.rows[0]).status });
      }
      // Unaccounted: a mark IS those characters and no row claims it. That is
      // the shape of every break of the placed() invariant — a refusal spelled
      // "mark done and draw nothing" leaves the mark drawn and the sentence
      // denying it.
      // Only where NO row claims a mark. One operation legitimately draws
      // several — "each place it appears", and a scope that names a list — so
      // `equal > yes` on its own is the instrument counting an op twice rather
      // than the panel denying a mark.
      if (t.yes.size === 0 && equal > 0) {
        inlineBad++;
        if (bad.length < 40)
          bad.push({ bill: bill.id, cite: res.citation, type: t.rows[0].op.type,
                     op: needle.slice(0, 55),
                     why: `${equal} mark(s) drawn, no row claims one`,
                     status: (t.rows.find((r) => !r.claim) || t.rows[0]).status });
      }
    }

    const have = nodeMarks.added + nodeMarks.replaced + nodeMarks.wasAdded + nodeMarks.whole;
    if (promised > have) {
      countBad++;
      if (bad.length < 40)
        bad.push({
          bill: bill.id,
          cite: res.citation,
          why: `panel promises ${promised} structural mark(s), the provision carries ${have}`,
          status: `added ${nodeMarks.added} · replaced ${nodeMarks.replaced} · was-added ${nodeMarks.wasAdded} · whole ${nodeMarks.whole}`,
        });
    }
  }
}

if (listMode) {
  console.log(bold('\nevery status sentence the corpus produces\n'));
  for (const [s, n] of [...seen].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${s}`);
}

console.log(`\n${'─'.repeat(64)}`);
console.log(bold('op rows with a status sentence'), checked);
console.log(`  distinct sentences           : ${seen.size}`);
console.log(`  sentences this cannot judge  : ${unknown}` + dim('  (a new one needs a CLAIMS entry)'));
console.log(bold(`  inline: sentence vs the mark : ${inlineBad}`));
console.log(bold(`  structural: promised > drawn : ${countBad}`));
for (const b of bad.slice(0, 25))
  console.log(
    `\n  ${b.bill} ${b.cite || ''} ${b.type || ''} ${b.op ? JSON.stringify(b.op) : ''}` +
      `\n     ${b.why}: ${JSON.stringify(b.status)}`
  );

const total = unknown + inlineBad + countBad;
if (total) {
  console.log(`\n\x1b[31m${total} panel failure(s)\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32mevery sentence agrees with the provision\x1b[0m');
