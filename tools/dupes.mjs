// How often does the app draw a GREEN pending insert into a provision that
// already substantially contains those words? Graded with word containment,
// which the redline does not use, so agreement is evidence and not tautology.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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
const words = (s) => (String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
const rows = [];
let drawn = 0;
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
    const hits = [];
    const record = (p, segs) => { for (const s of segs) if (s.type === 'ins') hits.push({ p, text: s.text }); };
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
    for (const h of hits) {
      const w = words(h.text);
      drawn++;
      if (w.length < 8) continue;
      const node = nodeAt.get(h.p);
      const hay = new Set(words(node ? flattenText(node) : res.lead || ''));
      const share = w.filter((x) => hay.has(x)).length / w.length;
      if (share < 0.9) continue;
      rows.push({
        b: bill.id, cite: res.citation || '', p: h.p, share: Number(share.toFixed(3)),
        ins: h.text.replace(/\s+/g, ' ').slice(0, 110),
      });
    }
  }
}
rows.sort((x, y) => y.share - x.share);
console.log('green inserts drawn:', drawn, '· of 8+ words, >=0.90 already in the node:', rows.length);
for (const r of rows.slice(0, 14)) console.log(`  ${r.share} ${r.b} ${r.cite} [${r.p}] "${r.ins}"`);
writeFileSync('dupes.json', JSON.stringify(rows, null, 1));
