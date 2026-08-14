#!/usr/bin/env node
//
// Every mark the reader sees, dumped so two runs can be diffed.
//
//   node tools/marks.mjs --save before.txt      # snapshot, then make a change
//   node tools/marks.mjs --diff before.txt      # what moved, and how
//   node tools/marks.mjs --diff before.txt --full   # print every line, not a sample
//   node tools/marks.mjs --dir <folder>         # a different sample of bills
//
// Why this exists, and why it is not a baseline.
//
// `corpus.mjs` is deliberately parse-only, because resolution numbers move
// whenever the Code is re-ingested and every release point would otherwise look
// like a parser regression. `coverage.mjs` counts what the redline draws, but it
// counts per OPERATION — an op drawn in nine subsections is one op — and it is
// explicitly a report rather than a score. So the thing the reader actually
// looks at, the individual mark on the individual provision, was measured by
// nobody, and every change that moved marks was audited by a script written from
// scratch for that change and thrown away afterwards. That happened at least
// three times (items 100, 111, 112), and each time the script had to be debugged
// before it could be believed.
//
// It is a DIFF tool and not a baseline for the reason corpus.mjs is parse-only:
// a checked-in mark file would rot on the next ingest and start reporting the
// Code's own movement as a regression. Snapshot before, diff after, read the
// withdrawals.
//
// Read the WITHDRAWALS. That is the whole point of the tool and it is the rule
// this project keeps rediscovering: a change is audited by what it removes, not
// by what it adds. Items 100 and 111 both shipped only because the withdrawal
// list was read line by line — item 100's first two cuts each moved ~20 correct
// marks one paragraph early while every suite stayed green.
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// The shards are fetched over HTTP by the app; off a server, read them off disk.
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
globalThis.DOMMatrix ??= class {
  constructor() {}
};

const { extractCitations, extractAmendments } = await imp('app/parse/citations.js');
const { normalizeText, parseBill } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { createRedline } = await imp('app/ui/redline.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { subtreeText } = await imp('app/ui/render-context.js');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const savePath = flag('--save');
const diffPath = flag('--diff');
const dirArg = flag('--dir');
const full = args.includes('--full');

const bills = dirArg
  ? readdirSync(dirArg)
      .filter((f) => /\.(htm|html|txt|pdf)$/i.test(f))
      .map((f) => ({ id: f.replace(/\.[^.]+$/, ''), local: join(dirArg, f) }))
  : (() => {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/corpus.json'), 'utf8'));
      return Array.isArray(manifest) ? manifest : manifest.bills || Object.values(manifest)[0];
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
 * Collect every mark, by walking the provision the way render-context does.
 *
 * A redline is STATEFUL and single-use — `additionsAt()` hands each addition out
 * once — so this must be the only walk over it. Reconstructing the marks from a
 * second pass reports every addition as "the provision it follows is not shown",
 * which is a rendering nobody sees. Same reason paneltest reads its facts out of
 * one render.
 */
async function collect() {
  const out = [];
  for (const bill of bills) {
    const path = bill.local
      ? (bill.local.startsWith(ROOT) || dirArg ? bill.local : join(ROOT, bill.local))
      : join(ROOT, 'corpus/files', `${bill.id}.htm`);
    if (!existsSync(path)) continue;
    const text = normalizeText(await textOf(path));
    const parsed = parseBill(text);
    const ams = extractAmendments(text, extractCitations(text), parsed.divisions, parsed.sections);
    for (const a of ams) {
      if (!a.target || !a.ops.length) continue;
      let res;
      try {
        res = await resolve(a.target);
      } catch {
        continue;
      }
      if (!res || !res.tree) continue;
      // Both renderings, because an already-happened test may match in either —
      // the Code stores a heading apart from its body and a bill writes the two
      // together. See the `hays` note in redline.js.
      const whole = [
        [res.lead || '', ...res.tree.map(flattenText)].join('\n'),
        [res.lead || '', ...res.tree.map(subtreeText)].join('\n'),
      ];
      const paths = new Set();
      const collectPaths = (n) => {
        paths.add(String(n.path || ''));
        (n.children || []).forEach(collectPaths);
      };
      res.tree.forEach(collectPaths);
      const red_ = createRedline(a.ops, whole, paths.size ? paths : null);
      const found = [];
      const record = (p, segs) => {
        for (const s of segs) if (s.type !== 'keep') found.push({ p, kind: s.type, text: s.text });
      };
      if (red_.wholeSectionRewrite) red_.wholeSectionRewrite();
      const walk = (n) => {
        if (red_.replacedAt) red_.replacedAt(n.path || '', subtreeText(n));
        record(n.path || '', red_.apply(n.text || '', n.path || ''));
        n.children.forEach(walk);
        red_.additionsAt(n.path || '');
      };
      record('', red_.apply(res.lead || '', ''));
      res.tree.forEach(walk);
      red_.additionsAt('');
      for (const f of found)
        out.push(
          [bill.id, res.citation || '', f.p, f.kind, f.text.replace(/\s+/g, ' ').slice(0, 90)].join('\t')
        );
    }
  }
  // Sorted, so two runs diff cleanly. Offsets are deliberately NOT in the key:
  // a parse change moves every offset in the bill, and a diff keyed on them
  // would report the whole corpus as churn.
  return out.sort();
}

const now = await collect();

if (savePath) {
  writeFileSync(savePath, now.join('\n'));
  console.log(`${now.length} marks -> ${savePath}`);
  process.exit(0);
}

if (!diffPath) {
  const byKind = {};
  for (const l of now) byKind[l.split('\t')[3]] = (byKind[l.split('\t')[3]] || 0) + 1;
  console.log(`${bold(String(now.length))} marks over ${bills.length} bill(s)`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(12)} ${n}`);
  console.log(dim('\n  --save <file> to snapshot, then --diff <file> after a change'));
  process.exit(0);
}

const before = readFileSync(diffPath, 'utf8').split('\n').filter(Boolean);
const bset = new Set(before);
const nset = new Set(now);
const gone = before.filter((l) => !nset.has(l));
const came = now.filter((l) => !bset.has(l));

console.log(`marks ${bold(String(before.length))} -> ${bold(String(now.length))}`);
console.log(`  ${red(`withdrawn ${gone.length}`)}   ${green(`added ${came.length}`)}\n`);

const tally = (list, i) => {
  const m = new Map();
  for (const l of list) m.set(l.split('\t')[i], (m.get(l.split('\t')[i]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
for (const [label, list] of [
  ['withdrawn', gone],
  ['added', came],
]) {
  if (!list.length) continue;
  console.log(bold(label));
  console.log('  by kind: ' + tally(list, 3).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('  by bill: ' + tally(list, 0).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(' · '));
  // A `was` mark says the law already contains this language. On an enacted
  // bill that is the claim doing its job; on a bill that never passed it is
  // worth looking at, which is why the split is printed rather than the total.
  const enr = list.filter((l) => /-enr\b/.test(l.split('\t')[0])).length;
  const w = list.filter((l) => l.split('\t')[3] === 'was').length;
  if (w) console.log(`  of ${w} 'was' marks, ${list.filter((l) => l.split('\t')[3] === 'was' && /-enr\b/.test(l.split('\t')[0])).length} are on an enrolled bill` + dim(` (${enr}/${list.length} of all marks are)`));
  console.log('');
}

// The withdrawals in full, because reading them IS the audit. A change that
// moves a mark from one provision to another shows up here as one withdrawal
// and one addition, and only reading both tells you which way it went.
const show = (label, list, cap) => {
  if (!list.length) return;
  console.log(bold(`${label} (${full || list.length <= cap ? 'all' : `first ${cap} of ${list.length}`})`));
  for (const l of (full ? list : list.slice(0, cap))) {
    const [b, cite, p, kind, txt] = l.split('\t');
    console.log(`  ${b.padEnd(20)} ${cite} [${p}] ${kind}  ${dim(txt)}`);
  }
  console.log('');
};
show('withdrawn', gone, 40);
show('added', came, full ? 40 : 12);

if (!gone.length && !came.length) console.log(green('no mark moved'));
