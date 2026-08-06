#!/usr/bin/env bun
//
// Impact report: run a bill all the way through the pipeline and print what
// came out the far end.
//
//   bun tools/impact.mjs                  # every sample in samples/
//   bun tools/impact.mjs samples/x.pdf    # one file
//
// This exists because the unit tests check *shapes* and this checks *outputs*.
// Every assertion in selftest.mjs can pass while a real bill loses eleven of
// its twelve amendment blocks, or resolves a navigation step to the wrong
// subtree — the counts here are what caught that. Numbers are meant to be
// diffed against the previous run after touching extraction: a line that moves
// is either a fix you made or a regression you didn't notice.
//
// "inert" below means an internal cross-reference that stayed a bare
// "paragraph (3)" note instead of being composed into a real address by
// expandRelativeRefs. Fewer is better; zero is not the target, because some
// references genuinely name a position rather than a provision.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node's ESM loader rejects a bare Windows path ("Received protocol 'c:'");
// bun accepts one. Go through a file:// URL so the tools run under both.
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// Static shards live on disk here, not behind an HTTP server; the resolver
// fetches them by relative URL. Same shim selftest.mjs uses.
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

const { extractCitations, extractAmendments, expandRelativeRefs } =
  await imp('app/parse/citations.js');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');
const { resolveUsc } = await imp('app/resolve/usc.js');
const { resolveActSection } = await imp('app/resolve/act-sections.js');
const { locateInternal, markerDepth, refDepth } = await imp('app/resolve/internal.js');

/**
 * Where every internal cross-reference ends up, split by WHY.
 *
 * "1,677 lost" was one number covering four different things, and that is how
 * three separate faults shipped inside one change: honest declines, a block whose
 * own opening marker was unreachable, a long block fragmenting into its own
 * paragraphs, and a referent quoted in a sibling block. Each would have stood out
 * immediately here. None of them is visible to selftest, rendertest or the corpus
 * baseline — the corpus is deliberately parse-only, and all of this is resolution.
 *
 *   composed    superseded by a real Code address (the best outcome)
 *   inBill      not in quoted law, and found in the bill
 *   inBlock     in quoted law, and found inside that block
 *   headAbove   in quoted law, not found, and the reference names a level
 *               SHALLOWER than the block's own root marker — so the block cannot
 *               contain it and we know it points out to the statute. These are
 *               the ones a composition pass ought to reach and does not.
 *   declined    in quoted law, not found, nothing more to say
 *   unresolved  not in quoted law, and not found
 */
function internalSplit(bill, text, cites, expanded) {
  const n = { composed: 0, inBill: 0, inBlock: 0, headAbove: 0, declined: 0, unresolved: 0 };
  const bare = (c) => c.kind === 'internal' && c.scope !== 'act' && c.refType !== 'section';
  const kept = new Set(expanded.filter(bare).map((c) => c.id));
  for (const c of cites.filter(bare)) {
    if (!kept.has(c.id)) { n.composed++; continue; }
    const at = locateInternal(bill, c);
    if (!c.inserted) { if (at) n.inBill++; else n.unresolved++; continue; }
    if (at && at.start >= c.inserted.start && at.start < c.inserted.end) { n.inBlock++; continue; }
    // The block's own root marker states how deep the new law sits.
    const lead = text
      .slice(c.inserted.start, c.inserted.start + 40)
      .match(/^(?:``|‘‘|["“])?\s*(\([A-Za-z0-9]{1,8}\))/);
    const d = refDepth(c);
    if (lead && d != null && d < markerDepth(lead[1])) n.headAbove++;
    else n.declined++;
  }
  return n;
}

async function textOf(path) {
  if (!path.toLowerCase().endsWith('.pdf')) return readFileSync(path, 'utf8');
  globalThis.DOMMatrix ??= class { constructor() {} };
  const { pdfToText } = await imp('app/parse/pdf.js');
  const { text, pages } = await pdfToText(new Uint8Array(readFileSync(path)).buffer);
  return { text, pages };
}

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

export async function report(path) {
  const loaded = await textOf(path);
  const raw = typeof loaded === 'string' ? loaded : loaded.text;
  const pages = typeof loaded === 'string' ? null : loaded.pages;

  const text = normalizeText(raw);
  const bill = parseBill(text);
  const cites = extractCitations(text);
  const ams = extractAmendments(text, cites);
  const expanded = expandRelativeRefs(cites, ams);

  const byKind = {};
  for (const c of cites) byKind[c.kind] = (byKind[c.kind] || 0) + 1;

  const steps = ams.reduce((n, a) => n + (a.steps || []).length, 0);
  const refs = ams.reduce((n, a) => n + (a.refs || []).length, 0);
  const relative_ = expanded.filter((c) => c.relative);
  const inertBefore = cites.filter((c) => c.kind === 'internal' && c.scope !== 'act').length;
  const inertAfter = expanded.filter((c) => c.kind === 'internal' && c.scope !== 'act').length;

  // Do the composed addresses actually exist in the Code? A step that resolves
  // to a subsection the target section doesn't have is a navigation bug wearing
  // a plausible-looking address.
  const uscTargets = expanded.filter((c) => c.kind === 'usc');
  let hit = 0, missSection = 0, missSubsection = 0;
  const misses = [];
  const seen = new Map();
  for (const c of uscTargets) {
    const key = `${c.title}|${c.section}|${c.subsection || ''}`;
    if (!seen.has(key)) seen.set(key, await resolveUsc(c));
    const r = seen.get(key);
    if (r.missing) { missSection++; misses.push(`${c.title} U.S.C. ${c.section} — no such section`); }
    else if (r.focusMissing) { missSubsection++; misses.push(`${c.title} U.S.C. ${c.section}${c.subsection} — section exists, subsection does not`); }
    else hit++;
  }

  // "Section 1861 of the Social Security Act" — an Act's own numbering, which is
  // not the Code's. These used to reach only the head of the Act; each one that
  // resolves is a provision the reader can now actually open. Measured here
  // rather than in corpus.mjs because it is resolution, and corpus metrics are
  // deliberately parse-only.
  const actRel = cites.filter((c) => c.kind === 'act' && c.actSection);
  let actHit = 0;
  const actSeen = new Set();
  for (const c of actRel) {
    const at = await resolveActSection(c.act, c.actSection);
    if (at) { actHit++; actSeen.add(`${at.title}:${at.section}`); }
  }

  // Same question for "section 12306 of Public Law 113-79", which resolves
  // through the same index — the ingester files a Public Law under its own
  // number as readily as under a name. A miss is expected and common: most of a
  // Public Law never enters the Code (appropriations, effective dates,
  // findings), and an uncodified section has no provision to point at.
  const plRel = cites.filter((c) => c.kind === 'publaw' && c.actSection);
  let plHit = 0;
  const plSeen = new Set();
  for (const c of plRel) {
    const at = await resolveActSection({ enactedAs: `Pub. L. ${c.congress}-${c.law}` }, c.actSection);
    if (at) { plHit++; plSeen.add(`${at.title}:${at.section}`); }
  }

  const badOffsets = cites.filter((c) => text.slice(c.start, c.end) !== c.text);

  console.log(`\n${b(relative(ROOT, path).replace(/\\/g, '/'))}  ${dim(`${(raw.length / 1024).toFixed(0)} KB${pages ? `, ${pages} pages` : ''}`)}`);
  console.log(`  sections            ${bill.sections.length}${bill.meta.shortTitle ? dim(`  (${bill.meta.shortTitle})`) : ''}`);
  console.log(`  citations           ${cites.length}  ${dim(JSON.stringify(byKind))}`);
  console.log(`  amendments          ${ams.length}  ${dim(`${ams.filter((a) => a.target).length} with a resolved target`)}`);
  console.log(`  navigation steps    ${steps}`);
  console.log(`  in-place refs       ${refs}`);
  console.log(`  relative addresses  ${relative_.length}  ${dim('composed from context')}`);
  console.log(`  inert refs          ${inertAfter}  ${dim(`of ${inertBefore} internal refs; ${inertBefore - inertAfter} resolved`)}`);
  const split = internalSplit(bill, text, cites, expanded);
  console.log(
    `  internal refs by fate  ${dim(
      `composed ${split.composed} · in bill ${split.inBill} · in its own block ${split.inBlock} · ` +
        `points out of the block ${split.headAbove} · declined ${split.declined} · unresolved ${split.unresolved}`
    )}`
  );
  console.log(`  USC lookups         ${hit} hit, ${missSection} missing section, ${missSubsection} missing subsection  ${dim(`(${seen.size} distinct)`)}`);
  if (plRel.length) {
    console.log(`  Pub. L. section     ${plHit}/${plRel.length} mapped to the Code  ${dim(`(${plSeen.size} distinct provisions)`)}`);
  }
  if (actRel.length) {
    console.log(`  Act-relative cites  ${actHit}/${actRel.length} mapped to the Code  ${dim(`(${actSeen.size} distinct provisions)`)}`);
  }
  if (badOffsets.length) console.log(`  \x1b[31moffsets broken      ${badOffsets.length}\x1b[0m`);

  if (process.argv.includes('--misses')) {
    for (const m of [...new Set(misses)].slice(0, 40)) console.log(`    ${dim('·')} ${m}`);
  }

  return {
    path, sections: bill.sections.length, citations: cites.length, byKind,
    amendments: ams.length, targeted: ams.filter((a) => a.target).length,
    steps, refs, relative: relative_.length, inertBefore, inertAfter,
    uscHit: hit, uscMissSection: missSection, uscMissSubsection: missSubsection,
    badOffsets: badOffsets.length, internal: split,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const paths = args.length
    ? args.map((a) => (existsSync(a) ? a : join(ROOT, a)))
    : readdirSync(join(ROOT, 'samples'))
        .filter((f) => /\.(txt|pdf)$/i.test(f))
        .sort()
        .map((f) => join(ROOT, 'samples', f));

  for (const p of paths) {
    if (!existsSync(p)) { console.log(`\n${basename(p)} — missing, skipped`); continue; }
    await report(p);
  }
  console.log();
}
