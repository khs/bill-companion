// A DIFFERENT sample: not a consistency check. For a seeded random draw of the
// marks the reader actually sees, print the instruction that produced the mark
// beside the provision text it landed in, so the two can be read together.
//
//   node sample.mjs <seed> <n>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]$/, '');
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
const { extractCitations, extractAmendments } = await imp('app/parse/citations.js');
const { normalizeText, parseBill } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { createRedline } = await imp('app/ui/redline.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { subtreeText } = await imp('app/ui/render-context.js');

const SEED = Number(process.argv[2] || 20260811);
const N = Number(process.argv[3] || 40);
let s = SEED >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

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

const all = [];
for (const bill of bills) {
  const path = bill.local ? join(ROOT, bill.local) : join(ROOT, 'corpus/files', `${bill.id}.htm`);
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
    const nodeAt = new Map();
    const collect = (n) => { paths.add(String(n.path || '')); nodeAt.set(String(n.path || ''), n); (n.children || []).forEach(collect); };
    res.tree.forEach(collect);
    const red = createRedline(a.ops, whole, paths.size ? paths : null);
    const found = [];
    const record = (p, segs) => {
      for (const seg of segs) {
        if (seg.type === 'keep') continue;
        found.push({ p, kind: seg.type, text: seg.text });
      }
    };
    if (red.wholeSectionRewrite) red.wholeSectionRewrite();
    const walk = (n) => {
      if (red.replacedAt) red.replacedAt(n.path || '', subtreeText(n));
      record(n.path || '', red.apply(n.text || '', n.path || ''));
      n.children.forEach(walk);
      red.additionsAt(n.path || '');
    };
    record('', red.apply(res.lead || '', ''));
    res.tree.forEach(walk);
    red.additionsAt('');
    for (const f of found) {
      const node = nodeAt.get(f.p);
      all.push({
        bill: bill.id, cite: res.citation || '', path: f.p, kind: f.kind,
        mark: f.text.replace(/\s+/g, ' ').slice(0, 120),
        instruction: text.slice(a.start, Math.min(a.end, a.start + 330)).replace(/\s+/g, ' '),
        provision: (node ? flattenText(node) : res.lead || '').replace(/\s+/g, ' ').slice(0, 330),
      });
    }
  }
}
// seeded draw
const pick = [];
const seen = new Set();
while (pick.length < Math.min(N, all.length)) {
  const i = Math.floor(rnd() * all.length);
  if (seen.has(i)) continue;
  seen.add(i);
  pick.push(all[i]);
}
console.log(`population ${all.length} marks · seed ${SEED} · drew ${pick.length}\n`);
pick.forEach((r, i) => {
  console.log(`--- ${i + 1}. ${r.bill} | ${r.cite} [${r.path}] | ${r.kind}`);
  console.log(`    MARK:        "${r.mark}"`);
  console.log(`    INSTRUCTION: ${r.instruction}`);
  console.log(`    PROVISION:   ${r.provision}`);
  console.log('');
});
// Printed, not written: a report that drops a file in the repo root gets
// committed by accident, and a stale one then reads as data.
