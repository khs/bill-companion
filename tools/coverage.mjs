#!/usr/bin/env node
//
// What the redline actually DRAWS, against the real U.S. Code.
//
//   node tools/coverage.mjs            # every corpus bill, then a total
//   node tools/coverage.mjs <id>       # one bill
//
// Why this exists separately from corpus.mjs: corpus metrics are deliberately
// parse-only, because resolution numbers move whenever the Code is re-ingested
// and every release point would otherwise look like a parser regression. So
// nothing measured the thing the reader actually sees — of the operations a
// bill states, how many end up marked on the provision in front of them.
//
// That left "the redline covers about 75% of a pending bill and 20% of an
// enacted one" as a remembered figure rather than a measured one. It is
// measured here. Like impact.mjs this is a report, not a test: no baseline,
// nothing to fail, and the numbers move with the Code.
//
// The four outcomes are not degrees of success. `drawn` and `in force` are both
// the app working — one is a change the bill would make, the other one it
// already made. `withheld` is a guard declining on purpose. Only `not found` is
// a gap.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node's ESM loader rejects a bare Windows path; see CLAUDE.md.
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// Static shards live on disk here, not behind an HTTP server. Same shim
// impact.mjs and selftest.mjs use.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:/i.test(u)) return realFetch(u, opts);
  const p = join(ROOT, u);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')),
           // Whole-file bytes: loadBundled() slices the range itself, which is
           // also what happens against a server that ignores Range.
           arrayBuffer: async () => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
};

globalThis.DOMMatrix ??= class { constructor() {} };
const { extractCitations, extractAmendments } = await imp('app/parse/citations.js');
const { normalizeText } = await imp('app/parse/bill.js');
const { unwrapPre } = await imp('tools/measure.mjs');
const { resolve } = await imp('app/resolve/index.js');
const { flattenText } = await imp('app/resolve/provision-tree.js');
const { createRedline } = await imp('app/ui/redline.js');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const only = process.argv[2];
const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/corpus.json'), 'utf8'));
const bills = (Array.isArray(manifest) ? manifest : manifest.bills || Object.values(manifest)[0])
  .filter((x) => !only || x.id === only);

const zero = () => ({
  drawn: 0, enacted: 0, withheld: 0, missing: 0,
  addDrawn: 0, addApplied: 0, addStranded: 0,
  repMarked: 0, repInForce: 0, repWhole: 0, repHeading: 0, repStranded: 0,
  widened: 0, lost: 0,
});
const total = zero();

async function textOf(path) {
  if (path.toLowerCase().endsWith('.pdf')) {
    const { pdfToText } = await imp('app/parse/pdf.js');
    return (await pdfToText(new Uint8Array(readFileSync(path)).buffer)).text;
  }
  const raw = readFileSync(path, 'utf8');
  return /\.html?$/i.test(path) ? unwrapPre(raw) : raw;
}

for (const bill of bills) {
  const path = bill.local ? join(ROOT, bill.local) : join(ROOT, 'corpus/files', `${bill.id}.htm`);
  if (!existsSync(path)) continue;
  const text = normalizeText(await textOf(path));
  const ams = extractAmendments(text, extractCitations(text));
  const s = zero();

  for (const a of ams) {
    if (!a.target || !a.ops.length) continue;
    let res;
    try { res = await resolve(a.target); } catch { continue; }
    if (!res || !res.tree) continue;

    const whole = [res.lead || '', ...res.tree.map(flattenText)].join('\n');
    // Same three arguments render-context passes, or this measures a rendering
    // nobody sees — scopes would go unreconciled here and reconciled on screen.
    const paths = new Set();
    const collect = (n) => { paths.add(String(n.path || '')); (n.children || []).forEach(collect); };
    res.tree.forEach(collect);
    const red = createRedline(a.ops, whole, paths.size ? paths : null);
    // The same walk render-context does: apply() at each node with its own
    // path, then additionsAt() once that node's children are laid out. Asking
    // in any other order would measure a rendering nobody sees.
    if (red.wholeSectionRewrite) red.wholeSectionRewrite();
    const walk = (n) => {
      // nodeEl() asks replacedAt() for every node it lays out, so this has to as
      // well — leaving it out reported all 923 replacements as "not on screen"
      // while the pane was marking them, which is the same measuring-a-rendering-
      // nobody-sees mistake the comment above warns about.
      if (red.replacedAt) red.replacedAt(n.path || '', flattenText(n));
      red.apply(n.text || '', n.path || '');
      n.children.forEach(walk);
      red.additionsAt(n.path || '');
    };
    red.apply(res.lead || '', '');
    res.tree.forEach(walk);
    red.additionsAt('');

    const placed = red.placed();
    const enacted = red.enactedInserts();
    const applied = red.appliedAdditions();
    // Addresses the provision does not have: widened to a level it does, or
    // surviving nowhere and drawn nowhere. Counted per op, not per amendment.
    s.widened += red.widenedScope().length;
    s.lost += red.lostScope().length;
    const here = (list, o) => list.some((q) => q.start === o.start);
    for (const o of a.ops) {
      const structural = o.type === 'add-at-end' || o.placement === 'after-unit';
      if (o.type === 'replace') {
        // Counted in their own bucket rather than dropped. 169 of these were
        // inserts until the replacement pass claimed them, and letting them fall
        // out of both buckets would have shrunk the inline denominator by that
        // much and read as an improvement.
        const rep = red.replacedOps ? red.replacedOps().find((q) => q.start === o.start) : null;
        // A heading rewrite is REFUSED, not stranded, and the difference matters:
        // lumping a deliberate refusal in with "the provision is not on screen"
        // turns a wrong label into no label, which is not an improvement.
        if (o.headingOnly) s.repHeading++;
        else if (rep && rep.wholeSection) s.repWhole++;
        else if (rep && rep.inLaw) s.repInForce++;
        else if (here(placed, o)) s.repMarked++;
        else s.repStranded++;
      } else if (structural) {
        if (here(applied, o)) s.addApplied++;
        else if (here(placed, o)) s.addDrawn++;
        else s.addStranded++;
      } else if (o.type === 'strike' || o.type === 'insert') {
        if (here(enacted, o)) s.enacted++;
        else if (here(placed, o)) s.drawn++;
        else if (red.isStale()) s.withheld++;
        else s.missing++;
      }
    }
  }

  const inline = s.drawn + s.enacted + s.withheld + s.missing;
  const adds = s.addDrawn + s.addApplied + s.addStranded;
  if (!inline && !adds) continue;
  for (const k of Object.keys(s)) total[k] += s[k];
  const pct = inline ? Math.round(((s.drawn + s.enacted) / inline) * 100) : 0;
  console.log(
    `${bold(bill.id.padEnd(26))} ${String(pct).padStart(3)}%  ` +
      dim(
        `drawn ${String(s.drawn).padStart(4)}  in force ${String(s.enacted).padStart(4)}  ` +
        `withheld ${String(s.withheld).padStart(4)}  not found ${String(s.missing).padStart(4)}  ` +
        `| adds ${s.addDrawn}/${s.addApplied}/${s.addStranded}`
      )
  );
}

const inline = total.drawn + total.enacted + total.withheld + total.missing;
const adds = total.addDrawn + total.addApplied + total.addStranded;
const shown = total.drawn + total.enacted;
console.log(`\n${'─'.repeat(64)}`);
console.log(bold('inline operations'), inline);
console.log(`  drawn as a pending change  : ${total.drawn}`);
console.log(`  marked already in force    : ${total.enacted}`);
console.log(`  withheld (amendment stale) : ${total.withheld}`);
console.log(`  not found in the provision : ${total.missing}`);
console.log(bold(`  shown to the reader        : ${shown}` +
                 ` (${inline ? Math.round((shown / inline) * 100) : 0}%)`));
console.log(bold('\naddresses the provision does not have'), total.widened + total.lost);
console.log(`  widened to a level it does : ${total.widened}`);
console.log(`  no such level at all       : ${total.lost}` +
            dim('  (drawn nowhere, reported to the reader)'));
console.log(bold('\nadditions'), adds);
console.log(`  drawn                      : ${total.addDrawn}`);
console.log(`  already in the law         : ${total.addApplied}`);
console.log(`  provision not on screen    : ${total.addStranded}`);

// Whole-provision replacements. Deliberately not a diff — see replacedAt() in
// redline.js — so a mark is the success state, and the split that matters is
// whether the rewrite has already happened, because that decides whether the
// text on screen is the provision as it stands or as this bill made it.
const reps = total.repMarked + total.repInForce + total.repWhole + total.repHeading + total.repStranded;
if (reps) {
  console.log(bold('\nwhole-provision replacements'), reps);
  console.log(`  already in force           : ${total.repInForce}`);
  console.log(`  whole section, stated      : ${total.repWhole}`);
  console.log(`  heading only, refused      : ${total.repHeading}`);
  console.log(`  marked, rewrite not matched: ${total.repMarked}`);
  console.log(`  provision not on screen    : ${total.repStranded}`);
}
