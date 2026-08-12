#!/usr/bin/env node
//
// A seeded draw of the cases the app DECLINES, printed with enough context to
// read. Not a test — a reading list.
//
//   node tools/declines.mjs ops  <seed> <n>   operations reported "not found"
//   node tools/declines.mjs refs <seed> <n>   cross-references that reach nothing
//
// Every other sampler here draws from what the app ASSERTS, and asks whether the
// assertion is right. This draws from what it REFUSES, and asks a different
// question: is the answer stated right here, in words the parser did not read?
// That is item 26's method, and it is the one that has produced shapes worth
// building rather than one-off corrections — a wrong answer is a bug in a rule
// that exists, where a refusal is usually a rule that does not.
//
// The op mode's population is `coverage.mjs`'s `missing` bucket, and it is
// classified there rather than re-derived: an operand not found in the provision
// the instruction names. The ref mode's is a bare internal cross-reference that
// `locateInternal` cannot place and no composition reaches.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:/i.test(u)) return realFetch(u, opts);
  const p = join(ROOT, u);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(readFileSync(p, 'utf8')),
    arrayBuffer: async () => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  };
};
globalThis.DOMMatrix ??= class { constructor() {} };

const { extractCitations, extractAmendments, expandRelativeRefs } = await imp('app/parse/citations.js');
const { normalizeText, parseBill } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { createRedline } = await imp('app/ui/redline.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { subtreeText } = await imp('app/ui/render-context.js');

const MODE = (process.argv[2] || 'ops').toLowerCase();
const SEED = Number(process.argv[3] || 20260812);
const N = Number(process.argv[4] || 14);
let s = SEED >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const flat = (x, n) => String(x || '').replace(/\s+/g, ' ').slice(0, n);

const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/corpus.json'), 'utf8'));
const bills = Array.isArray(manifest) ? manifest : manifest.bills || Object.values(manifest)[0];
async function textOf(path) {
  if (path.toLowerCase().endsWith('.pdf')) {
    const { pdfToText } = await imp('app/parse/pdf.js');
    return (await pdfToText(new Uint8Array(readFileSync(path)).buffer)).text;
  }
  const raw = readFileSync(path, 'utf8');
  return /\.html?$/i.test(path) ? unwrapPre(raw) : raw;
}

const pool = [];
for (const bill of bills) {
  const path = bill.local ? join(ROOT, bill.local) : join(ROOT, 'corpus/files', `${bill.id}.htm`);
  if (!existsSync(path)) continue;
  const text = normalizeText(await textOf(path));
  const parsed = parseBill(text);
  const raw = extractCitations(text);
  const ams = extractAmendments(text, raw, parsed.divisions, parsed.sections);

  if (MODE === 'refs') {
    // A bare internal reference the bill's own text cannot place. The pane says
    // so honestly; the question is whether the sentence around it says more.
    // `locateInternal(bill, cite)` — the BILL first. Reversing those two makes
    // every call fail and reports the whole population as unresolved, which is
    // how the first run of this claimed 31,429 rather than 2,935. Check the
    // instrument before the product.
    const { locateInternal } = await imp('app/resolve/internal.js');
    const cites = expandRelativeRefs(raw, ams);
    // The same population impact.mjs splits by fate: a BARE cross-reference, not
    // one that names its own section and not an Act-scoped one.
    const bare = (c) => c.kind === 'internal' && c.scope !== 'act' && c.refType !== 'section';
    for (const c of cites) {
      if (!bare(c)) continue;
      let hit = null;
      try { hit = locateInternal(parsed, c); } catch { hit = null; }
      if (hit && hit.start != null) continue;
      pool.push({
        bill: bill.id, what: c.text,
        where: flat(text.slice(Math.max(0, c.start - 420), c.start), 420),
        after: flat(text.slice(c.end, c.end + 260), 260),
      });
    }
    continue;
  }

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
    const nodeAt = new Map();
    const collect = (n) => { paths.add(String(n.path || '')); nodeAt.set(String(n.path || ''), n); (n.children || []).forEach(collect); };
    res.tree.forEach(collect);
    const red = createRedline(a.ops, whole, paths.size ? paths : null);
    if (red.wholeSectionRewrite) red.wholeSectionRewrite();
    const walk = (n) => {
      if (red.replacedAt) red.replacedAt(n.path || '', subtreeText(n));
      red.apply(n.text || '', n.path || '');
      n.children.forEach(walk);
      red.additionsAt(n.path || '');
    };
    red.apply(res.lead || '', '');
    res.tree.forEach(walk);
    red.additionsAt('');
    if (red.isStale()) continue; // withheld on purpose, not a gap
    const placed = red.placed ? red.placed() : [];
    const enacted = red.enactedInserts ? red.enactedInserts() : [];
    const here = (list, o) => list.some((p) => p.start === o.start);
    for (const op of a.ops) {
      if (op.type !== 'strike' && op.type !== 'insert') continue;
      if (op.placement === 'after-unit') continue;
      if (here(placed, op) || here(enacted, op)) continue;
      const scope = op.scope ?? '';
      const node = nodeAt.get(scope);
      pool.push({
        bill: bill.id, cite: res.citation || '', type: op.type, scope,
        operand: flat(op.operand || op.text, 150),
        anchor: op.anchor ? flat(op.anchor, 70) : '',
        instruction: flat(text.slice(a.start, Math.min(a.end, a.start + 420)), 420),
        atScope: flat(node ? flattenText(node) : '(no node at that path)', 330),
        levels: [...paths].filter((p) => p && (!scope || p.startsWith(scope))).slice(0, 14).join(' '),
      });
    }
  }
}

const pick = [];
const seen = new Set();
while (pick.length < Math.min(N, pool.length)) {
  const i = Math.floor(rnd() * pool.length);
  if (seen.has(i)) continue;
  seen.add(i);
  pick.push(pool[i]);
}
console.log(`${MODE}: population ${pool.length} · seed ${SEED} · drew ${pick.length}\n`);
pick.forEach((r, i) => {
  if (MODE === 'refs') {
    console.log(`--- ${i + 1}. ${r.bill} | "${r.what}"`);
    console.log(`    BEFORE: …${r.where}`);
    console.log(`    AFTER : ${r.after}…\n`);
    return;
  }
  console.log(`--- ${i + 1}. ${r.bill} | ${r.cite} | ${r.type} @ [${r.scope}]`);
  console.log(`    OPERAND:     "${r.operand}"${r.anchor ? `   (after "${r.anchor}")` : ''}`);
  console.log(`    INSTRUCTION: ${r.instruction}`);
  console.log(`    AT SCOPE:    ${r.atScope}`);
  console.log(`    LEVELS:      ${r.levels}\n`);
});
