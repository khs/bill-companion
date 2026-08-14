#!/usr/bin/env node
//
// Bills that are NOT law, drawn at random by bill number.
//
//   node tools/pending.mjs fetch [seed] [n]   # download a fresh draw
//   node tools/pending.mjs                    # what the sample parses to
//
// Why this exists as a second sample.
//
// 28 of the corpus's 30 runs are enrolled — bills that passed — and the app's
// most delicate machinery is precisely the part that tells an amendment which
// has already been made from one that has not. "Already in the law", "already
// struck", the staleness inference, `.node.was-added`: every one of those is a
// claim about a bill that became law, and the corpus can barely produce a
// counter-example. A guard that fired on every bill in the world would look
// perfect there.
//
// This was recognised twice (items 84 and 98), a sample was built twice, and
// both times it lived in a scratch directory and evaporated with the session —
// so the check had to be rebuilt from nothing to be run again. It is tracked
// now, for exactly the reason `corpus/files/` is: an untracked sample is one a
// fresh machine silently runs zero bills against.
//
// The draw is by BILL NUMBER and seeded, which is the point rather than a
// convenience. A hand-picked set is a draw on what I expect bills to look like;
// a random number is a draw on what Congress actually writes. Enacted versions
// are excluded by construction — no `enr`, no public law — because a bill that
// passed is what the corpus already has.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const DIR = join(ROOT, 'pending');
const FILES = join(DIR, 'files');
const MANIFEST = join(DIR, 'pending.json');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// Every stage a bill reaches WITHOUT becoming law. `enr` is deliberately absent.
const VERSIONS = ['ih', 'is', 'rh', 'rs', 'eh', 'es', 'pcs', 'rfs', 'rfh', 'cph', 'cps'];
const CONGRESSES = [118, 119];
const CHAMBERS = ['hr', 's'];
// Substance is amendatory DENSITY, not size. Nearly every bill Congress files
// is under 40 KB — a random probe of six 119th-Congress introduced bills found
// them at 2 to 12 KB — so a size floor alone rejects 99% of the population and
// turns the draw into a sample of omnibuses. A bill has to amend several things
// to exercise any of this; that is the test.
const MIN_BYTES = 12 * 1024;
const MIN_VERBS = 4;

async function fetchDraw(seed, want) {
  mkdirSync(FILES, { recursive: true });
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const kept = [];
  const tried = new Set();
  let numbers = 0;
  let attempts = 0;
  // The bill NUMBER is the random draw; the version is then tried in order
  // until one exists. Drawing both independently is what a first cut did and it
  // returned 3 bills from 600 requests — most bills never get past `ih`, so
  // nearly every (number, version) pair is a 404 and the sample is really a
  // draw on which bills happen to reach a late stage.
  while (kept.length < want && numbers < 900) {
    numbers++;
    const congress = pick(CONGRESSES);
    const chamber = pick(CHAMBERS);
    const num = 1 + Math.floor(rnd() * (chamber === 'hr' ? 9000 : 4000));
    for (const version of VERSIONS) {
      const id = `${congress}${chamber}${num}${version}`;
      if (tried.has(id)) continue;
      tried.add(id);
      attempts++;
      const url = `https://www.govinfo.gov/content/pkg/BILLS-${id}/html/BILLS-${id}.htm`;
      let body;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'bill-companion-pending/1.0' } });
        if (!r.ok) continue;
        body = await r.text();
      } catch {
        continue;
      }
      if (body.length < MIN_BYTES) break; // this bill exists but is too small
      // It has to amend SEVERAL things, or it exercises none of this. Note the
      // qualifier: "is further amended" is an amendatory verb (item 112), and a
      // filter that could not see one would quietly skew the sample away from
      // exactly the bills that shape hardest.
      const verbs = (body.match(/\b(?:is|are)\s+(?:further\s+|each\s+|hereby\s+)?amended\b/gi) || []).length;
      if (verbs < MIN_VERBS) break;
      writeFileSync(join(FILES, `${id}.htm`), body);
      kept.push({ id, url, bytes: body.length });
      console.log(`  ${dim(String(kept.length).padStart(2))} ${id.padEnd(12)} ${(body.length / 1024).toFixed(0)} KB`);
      break; // one version per bill — two stages of one bill is one sample
    }
  }
  writeFileSync(
    MANIFEST,
    JSON.stringify({ seed, drawn: kept.length, attempts, bills: kept }, null, 1) + '\n'
  );
  console.log(`\n${kept.length} bills from ${attempts} tries, seed ${seed} -> pending/`);
}

const args = process.argv.slice(2);
if (args[0] === 'fetch') {
  await fetchDraw(Number(args[1] || 20260813), Number(args[2] || 20));
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.log('no sample yet — run: node tools/pending.mjs fetch');
  process.exit(1);
}

const { measure, unwrapPre } = await imp('tools/measure.mjs');
const man = JSON.parse(readFileSync(MANIFEST, 'utf8'));
console.log(bold(`${man.bills.length} pending bills`) + dim(`  seed ${man.seed}`) + '\n');
const tot = {};
for (const b of man.bills) {
  const p = join(FILES, `${b.id}.htm`);
  if (!existsSync(p)) {
    console.log(`  ${b.id}  ${dim('not downloaded')}`);
    continue;
  }
  const m = measure(unwrapPre(readFileSync(p, 'utf8'))).metrics;
  for (const k of ['citations', 'amendments', 'targeted', 'opSpans', 'uncoveredVerbs', 'overlaps', 'badOffsets', 'badOpOffsets'])
    tot[k] = (tot[k] || 0) + (m[k] || 0);
  console.log(
    `  ${b.id.padEnd(12)} ${String(m.citations).padStart(5)} cites  ${String(m.amendments).padStart(4)} amendments  ` +
      `${String(m.targeted).padStart(4)} targeted  ${String(m.opSpans).padStart(4)} ops` +
      (m.overlaps + m.badOffsets + m.badOpOffsets ? `  \x1b[31mINVARIANT\x1b[0m` : '')
  );
}
console.log('\n' + bold('total') + '  ' + Object.entries(tot).map(([k, v]) => `${k} ${v}`).join(' · '));
// The three that are always a bug when non-zero, whatever the sample.
const bad = tot.overlaps + tot.badOffsets + tot.badOpOffsets;
console.log(bad ? `\n\x1b[31m${bad} invariant violation(s)\x1b[0m` : '\n\x1b[32mno invariant violated\x1b[0m');
process.exit(bad ? 1 : 0);
