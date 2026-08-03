#!/usr/bin/env bun
//
// The regression corpus: a range of real bills, run end to end, and diffed
// against a recorded baseline.
//
//   bun tools/corpus.mjs fetch      # download the remote bills (once)
//   bun tools/corpus.mjs            # run them all, report deviations
//   bun tools/corpus.mjs <id>       # one bill, in detail
//   bun tools/corpus.mjs --update   # accept current numbers as the baseline
//
// Why this exists separately from selftest.mjs: the test suite asserts fixed
// numbers about four fixtures that ship with the app. This holds a larger set of
// real bills, too big and too numerous to ship, and its job is to answer "did
// that change do anything I didn't intend?" — across bills nobody wrote
// assertions for. Most parser changes should move nothing here at all.
//
// corpus/files/ IS tracked, and serve.py serves it. That reversed a deliberate
// earlier decision: refusing it locally was meant to make the dev server show
// exactly what a deploy shows, on the premise that nothing in the app links to
// the bills — and samples/library.json now does. A deploy serves whatever is in
// the repo, so refusing them locally had stopped making the two agree and
// started hiding a broken link from the only person who runs this locally. The
// bills are U.S. Government works and not copyrighted. If it ever needs
// reversing, move the corpus out of the published tree rather than re-ignoring
// it: an ignored corpus is one a fresh machine silently runs zero bills against.
// corpus/corpus.json and corpus/baseline.json are the shared definition.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBill, measure, INVARIANTS } from './measure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'corpus');
const FILES = join(DIR, 'files');
const MANIFEST = join(DIR, 'corpus.json');
const BASELINE = join(DIR, 'baseline.json');

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

/** Where a bill's text lives once it is available locally. */
function pathOf(bill) {
  if (bill.local) return join(ROOT, bill.local);
  const ext = (bill.url.match(/\.(pdf|htm|html|txt)(?:$|\?)/i) || [, 'htm'])[1];
  return join(FILES, `${bill.id}.${ext}`);
}

async function fetchAll() {
  mkdirSync(FILES, { recursive: true });
  for (const bill of manifest.bills) {
    if (bill.local) continue;
    const dest = pathOf(bill);
    if (existsSync(dest) && !flag('--force')) {
      console.log(`  ${dim('have')} ${bill.id}`);
      continue;
    }
    process.stdout.write(`  ${bill.id} … `);
    try {
      const r = await fetch(bill.url, { headers: { 'User-Agent': 'bill-companion-corpus/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      writeFileSync(dest, buf);
      console.log(green(`${(buf.length / 1024).toFixed(0)} KB`));
    } catch (err) {
      console.log(red(`failed — ${err.message}`));
    }
  }
}

/** Flatten nested count objects so they can be diffed key by key. */
function flatten(m, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

async function runAll() {
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const only = args.find((a) => !a.startsWith('-') && a !== 'fetch' && a !== 'run');
  const bills = only ? manifest.bills.filter((x) => x.id === only) : manifest.bills;
  if (only && !bills.length) {
    console.log(red(`no bill with id "${only}"`));
    console.log(`known ids: ${manifest.bills.map((x) => x.id).join(', ')}`);
    return 1;
  }

  const fresh = {};
  let missing = 0;
  let deviations = 0;
  let violations = 0;
  let unbaselined = 0;

  for (const bill of bills) {
    const path = pathOf(bill);
    if (!existsSync(path)) {
      console.log(`\n${b(bill.id)}  ${red('not downloaded')} ${dim('— run: bun tools/corpus.mjs fetch')}`);
      missing++;
      continue;
    }

    const { text, pages } = await loadBill(path);
    const { metrics, shortTitle, ams } = measure(text);
    if (pages) metrics.pages = pages;
    fresh[bill.id] = metrics;

    const flatNew = flatten(metrics);
    const flatOld = baseline[bill.id] ? flatten(baseline[bill.id]) : null;

    console.log(`\n${b(bill.id)}  ${dim(bill.name)}`);
    console.log(`  ${dim(shortTitle || '(no short title)')}`);
    console.log(
      `  ${metrics.sections} sections · ${metrics.citations} citations · ${metrics.amendments} amendments` +
        `${metrics.distributed ? ` (${metrics.distributed} distributed)` : ''} · ${metrics.opSpans} diff spans`
    );

    for (const key of INVARIANTS) {
      if (metrics[key]) {
        console.log(`  ${red(`✗ ${key} = ${metrics[key]}`)} ${dim('— this is a bug, not a new baseline')}`);
        violations++;
      }
    }

    if (!flatOld) {
      console.log(`  ${yellow('no baseline yet')}`);
      unbaselined++;
      continue;
    }
    const keys = [...new Set([...Object.keys(flatOld), ...Object.keys(flatNew)])].sort();
    const moved = keys.filter((k) => flatOld[k] !== flatNew[k]);
    if (!moved.length) {
      console.log(`  ${green('matches baseline')}`);
    } else {
      deviations += moved.length;
      for (const k of moved) {
        const from = flatOld[k] ?? 0;
        const to = flatNew[k] ?? 0;
        const delta = typeof from === 'number' && typeof to === 'number' ? ` (${to > from ? '+' : ''}${to - from})` : '';
        console.log(`  ${yellow('~')} ${k}: ${from} → ${to}${delta}`);
      }
    }

    if (only) detail(ams);
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (flag('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...fresh }, null, 1)}\n`);
    console.log(`baseline updated for ${Object.keys(fresh).length} bill(s)`);
    return 0;
  }
  if (missing) console.log(`${missing} bill(s) not downloaded — bun tools/corpus.mjs fetch`);
  if (violations) {
    console.log(red(`${violations} invariant violation(s)`));
    return 1;
  }
  if (deviations) {
    console.log(yellow(`${deviations} metric(s) moved`) + dim(' — explain each one, then --update to accept'));
    return 1;
  }
  if (unbaselined) {
    console.log(yellow(`${unbaselined} bill(s) have no baseline`) + dim(' — record one with --update'));
    return 1;
  }
  console.log(green(`no deviation from baseline across ${bills.length - missing} bill(s)`));
  return 0;
}

/** Per-bill detail, for reading rather than diffing. */
function detail(ams) {
  console.log(`  ${dim('amendments:')}`);
  for (const a of ams.slice(0, 40)) {
    const tgt = a.target ? a.target.text.replace(/\s+/g, ' ') : '(no target)';
    const ops = a.ops.map((o) => o.type).join(',') || '—';
    console.log(`    ${a.distributed ? '·' : ' '} ${`${a.unit} ${a.section}${a.subsection}`.padEnd(30).slice(0, 30)} → ${tgt.padEnd(34).slice(0, 34)} ${dim(ops)}`);
  }
  if (ams.length > 40) console.log(`    ${dim(`… and ${ams.length - 40} more`)}`);
}

if (args[0] === 'fetch') {
  await fetchAll();
} else {
  process.exit(await runAll());
}
