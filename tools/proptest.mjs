#!/usr/bin/env node
//
//   node tools/proptest.mjs
//
// Random and property testing over the whole pipeline.
//
// Two halves. PROPERTIES are invariants nothing currently asserts, checked over
// every op and citation the 30 corpus bills produce — the kind of thing a
// hand-written fixture cannot cover because it needs the whole population.
// FUZZ feeds deliberately damaged text in: truncated quotes, unbalanced markers,
// text cut mid-instruction. Nothing here should ever throw, and no property
// should ever fail.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(R, p)).href);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:/i.test(u)) return realFetch(u, opts);
  const p = join(R, u);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')),
           arrayBuffer: async () => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
};
globalThis.DOMMatrix ??= class { constructor() {} };
const { extractCitations, extractAmendments, expandRelativeRefs } = await imp('app/parse/citations.js');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { createRedline } = await imp('app/ui/redline.js');
const { subtreeText } = await imp('app/ui/render-context.js');
const { quotedBlocks } = await imp('app/parse/outline.js');

const fails = [];
const fail = (prop, detail) => { if (fails.length < 60) fails.push(`${prop}: ${detail}`); };
const counts = {};
const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

const manifest = JSON.parse(readFileSync(join(R, 'corpus/corpus.json'), 'utf8'));
const bills = (Array.isArray(manifest) ? manifest : manifest.bills || Object.values(manifest)[0]);
const MARK = /\([A-Za-z0-9]{1,8}\)/g;

// ------------------------------------------------------------------ properties
for (const bill of bills) {
  const path = bill.local ? join(R, bill.local) : join(R, 'corpus/files', `${bill.id}.htm`);
  if (!existsSync(path) || /\.pdf$/i.test(path)) continue;
  const text = normalizeText(unwrapPre(readFileSync(path, 'utf8')));
  const cites = extractCitations(text);
  // The same four arguments main.js passes. A property checked against a looser
  // parse than the app runs is a property about nothing — and the bound below
  // exists precisely because a call site can forget the last one.
  const b = parseBill(text);
  const ams = extractAmendments(text, cites, b.divisions, b.sections);
  const expanded = expandRelativeRefs(cites, ams);

  // P1 every citation span round-trips to its recorded text.
  for (const c of cites) {
    bump('citations');
    if (text.slice(c.start, c.end) !== c.text) fail('P1 citation span', `${bill.id} ${c.kind} @${c.start}`);
  }
  // P2 no two citations share a start.
  const starts = new Map();
  for (const c of cites) {
    if (starts.has(c.start)) fail('P2 shared citation start', `${bill.id} @${c.start} ${c.kind}/${starts.get(c.start)}`);
    starts.set(c.start, c.kind);
  }
  for (const am of ams) {
    // P3 op spans round-trip, unless the bill NAMED the operand rather than
    // quoting it (`operand`), where `text` is the phrase the reader clicked.
    const opStarts = new Set();
    for (const o of am.ops || []) {
      if (o.start == null) continue;
      bump('ops');
      if (text.slice(o.start, o.end) !== o.text) fail('P3 op span', `${bill.id} ${o.type} @${o.start}`);
      // P4 no two ops of one amendment share a start.
      if (opStarts.has(o.start)) fail('P4 shared op start', `${bill.id} ${o.type} @${o.start}`);
      opStarts.add(o.start);
      // P5 a scope is a marker path and nothing else.
      if (o.scope != null && o.scope !== '' && String(o.scope).replace(MARK, '') !== '') {
        fail('P5 scope not a marker path', `${bill.id} ${o.type} scope=${o.scope}`);
      }
      // P6 no scope repeats a marker immediately — (h)(h)(5) is the shape three
      // separate bugs have produced.
      const mk = String(o.scope || '').match(MARK) || [];
      for (let i = 1; i < mk.length; i++) {
        if (mk[i] === mk[i - 1]) fail('P6 doubled marker in scope', `${bill.id} ${o.type} ${o.scope}`);
      }
    }
  }
  // P7 the same, for composed addresses the reader clicks.
  for (const c of expanded.filter((x) => x.relative)) {
    bump('relative');
    const mk = String(c.subsection || '').match(MARK) || [];
    for (let i = 1; i < mk.length; i++) {
      if (mk[i] === mk[i - 1]) fail('P7 doubled marker in address', `${bill.id} ${c.title}:${c.section}${c.subsection}`);
    }
  }
  // P8 quotedBlocks never overlap and never run backwards.
  const blocks = quotedBlocks(text);
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].end <= blocks[i].start) fail('P8 empty/inverted block', `${bill.id} @${blocks[i].start}`);
    if (i && blocks[i].start < blocks[i - 1].end) fail('P8 overlapping blocks', `${bill.id} @${blocks[i].start}`);
  }
  // P11 an instruction never reaches past the end of the bill section it is
  // written in. A bill's own section heading is an absolute boundary — no
  // instruction spans one — so an op, step or ref beyond it belongs to a
  // different instruction against a different provision. 550 relative
  // citations were composed across one, 296 of them answering with a real
  // provision, which is the worst category this app has.
  //
  // Written as a property rather than a fixture because it is the guard on a
  // parameter a caller can forget: extractAmendments() takes the sections and
  // does nothing without them, so a call site that omits them fails here
  // rather than quietly reverting to the old bound.
  //
  // Only where the head sits INSIDE a parsed section. parseBill misses a
  // run-in appropriations head written as a bare "Sec. 401." line, parking
  // later text in the previous section, and attributing by position rather
  // than containment is what made the first measurement of this overcount.
  for (const am of ams) {
    const sec = b.sections.find((s) => am.start >= s.start && am.start < s.end);
    if (!sec) continue;
    for (const o of am.ops || [])
      if (o.start != null && o.start >= sec.end)
        fail('P11 op past its section', `${bill.id} #${sec.num} ${o.type}@${o.start} >= ${sec.end}`);
    for (const st of [...(am.steps || []), ...(am.refs || [])])
      if (st.start >= sec.end)
        fail('P11 address past its section', `${bill.id} #${sec.num} @${st.start} >= ${sec.end}`);
  }

  // P9 sections are ordered, non-overlapping and inside the text.
  let prev = -1;
  for (const s of b.sections) {
    bump('sections');
    if (s.start < prev) fail('P9 sections out of order', `${bill.id} #${s.num}`);
    if (s.end > text.length) fail('P9 section past end', `${bill.id} #${s.num}`);
    prev = s.start;
  }
}

// ----------------------------------------------- redline outcome exclusivity
for (const bill of bills.slice(0, 12)) {
  const path = bill.local ? join(R, bill.local) : join(R, 'corpus/files', `${bill.id}.htm`);
  if (!existsSync(path) || /\.pdf$/i.test(path)) continue;
  const text = normalizeText(unwrapPre(readFileSync(path, 'utf8')));
  const parsed = parseBill(text);
  for (const am of extractAmendments(
    text, extractCitations(text), parsed.divisions, parsed.sections
  )) {
    if (!am.target || !(am.ops || []).length) continue;
    let res; try { res = await resolve(am.target); } catch { continue; }
    if (!res || !res.tree) continue;
    const paths = new Set();
    const collect = (n) => { paths.add(String(n.path || '')); (n.children || []).forEach(collect); };
    res.tree.forEach(collect);
    const whole = [res.lead || '', ...res.tree.map(flattenText)].join('\n');
    const red = createRedline(am.ops, whole, paths.size ? paths : null);
    if (red.wholeSectionRewrite) red.wholeSectionRewrite();
    const walk = (n) => { red.replacedAt(n.path || '', subtreeText(n)); (n.children || []).forEach(walk); };
    res.tree.forEach(walk);
    const placed = new Set(red.placed().map((o) => o.start));
    // P10 an op that was REFUSED must never be reported placed. This is the
    // invariant that has broken five times: every "dealt with but deliberately
    // not drawn" flag has to be named in both the decliner and placed().
    for (const o of red.replacedOps()) {
      bump('replacements');
      if ((o.rangeSkip || o.headingOnly) && placed.has(o.start)) {
        fail('P10 refused op reported placed', `${bill.id} ${o.scope} rangeSkip=${!!o.rangeSkip}`);
      }
      // P11 a marked replacement's node marker IS the block's lead.
      if (o.done && !o.rangeSkip && o.scope) {
        const lead = String(o.text || '').match(/^\s*(?:``|‘‘|["“])?\s*(\([A-Za-z0-9]{1,8}\))/);
        const own = (String(o.scope).match(MARK) || []).pop();
        if (lead && own !== lead[1]) fail('P11 identity', `${bill.id} scope=${o.scope} lead=${lead[1]}`);
      }
    }
    for (const o of red.unplacedReplacements()) {
      if (placed.has(o.start)) fail('P10b unplaced op reported placed', `${bill.id} ${o.scope}`);
    }
  }
}

// ------------------------------------------------------------------------ fuzz
// A cheap deterministic PRNG so a failure can be reproduced from its seed.
let seed = 20260809;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];

const base = normalizeText(unwrapPre(readFileSync(join(R, 'corpus/files/hr1719-119-ih.htm'), 'utf8')));
const MUT = [
  (s) => s.slice(0, Math.floor(rnd() * s.length)),                       // truncate anywhere
  (s) => s.replace(/``/g, ''),                                           // strip openers
  (s) => s.replace(/''/g, ''),                                           // strip closers
  (s) => s.replace(/\)/g, ''),                                           // unbalance markers
  (s) => s.replace(/\n/g, ' '),                                          // destroy the outline
  (s) => s + s,                                                          // duplicate
  (s) => s.replace(/[0-9]/g, '9'),                                       // flatten numbers
  (s) => s.split('').reverse().join(''),                                 // nonsense
  (s) => `${s.slice(0, 400)}${'('.repeat(500)}${s.slice(400)}`,          // paren bomb
  (s) => s.replace(/section/gi, 'section section section'),              // keyword storm
];
let ran = 0;
for (let i = 0; i < 220; i++) {
  let t = base;
  const n = 1 + Math.floor(rnd() * 3);
  const applied = [];
  for (let k = 0; k < n; k++) { const m = pick(MUT); applied.push(MUT.indexOf(m)); t = m(t); }
  try {
    const nt = normalizeText(t);
    const cs = extractCitations(nt);
    const as = extractAmendments(nt, cs);
    expandRelativeRefs(cs, as);
    parseBill(nt);
    quotedBlocks(nt);
    ran++;
    // Offsets must survive damage too: a span that does not round-trip would
    // mis-render the bill pane.
    for (const c of cs) if (nt.slice(c.start, c.end) !== c.text) {
      fail('FUZZ span broken', `mutations=${applied} kind=${c.kind}`);
      break;
    }
    for (const a of as) for (const o of a.ops || []) {
      if (o.start != null && nt.slice(o.start, o.end) !== o.text) {
        fail('FUZZ op span broken', `mutations=${applied} ${o.type}`);
        break;
      }
    }
  } catch (err) {
    fail('FUZZ threw', `mutations=${applied} ${err.message}`);
  }
}

console.log('counts:', JSON.stringify(counts));
console.log(`fuzz cases run without throwing: ${ran}/220`);
console.log(fails.length ? `\nFAILURES (${fails.length}):` : '\nno property or fuzz failures');
for (const f of fails) console.log('  ' + f);

process.exit(fails.length ? 1 : 0);
