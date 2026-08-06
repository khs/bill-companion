#!/usr/bin/env node
//
// Collapse the ingested shards into a few large parts plus a byte-offset index,
// so the deploy moves ~190 files instead of 77,744.
//
//   node tools/bundle.mjs            # build every group, verify, report
//   node tools/bundle.mjs --verify   # verify existing bundles, build nothing
//
// WHY. GitHub Pages deploys a branch by packaging the whole tree, and the tree is
// 410 MB across 77,744 files of which 77,667 are ingested data. `data/` changed in
// 9 of the project's 68 commits and `app/` in 58, so most pushes re-upload tens of
// thousands of unchanged 5 KB files — which is the pathological case for artifact
// packaging, and it is what started timing out.
//
// WHAT IT PRESERVES. The lookup contract, exactly: one small GET per section, with
// no index of the whole Code to load first. A section is fetched with an HTTP Range
// request against its title's part, so the transfer is the same bytes it always
// was. Verified on the live site before building any of this — GitHub Pages answers
// `206 Partial Content` with `Accept-Ranges: bytes`.
//
// The only new cost is one small index per group, fetched once and memoised, and
// only for groups actually cited. Title 42's index is the largest at ~8,500
// entries; a bill that cites nothing in title 42 never asks for it.
//
// PARTS ARE SPLIT AT 40 MB. Not a guess about performance: GitHub warns at 50 MB
// per file and refuses at 100, and title 42's sections come to 54 MB. Splitting is
// free because the index names the part, so nothing downstream has to know how many
// there are.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PART = 40 * 1024 * 1024;

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * Every directory of shards that becomes one index plus its parts.
 *
 * `dir` is the directory of shard files, `base` the name the index and parts are
 * written under, beside that directory rather than inside it — so a group's
 * bundle survives deleting the directory, which is the whole point.
 */
function groups() {
  const out = [];
  const usc = join(ROOT, 'data/usc');
  if (existsSync(usc)) {
    for (const d of readdirSync(usc).sort()) {
      const p = join(usc, d);
      if (!statSync(p).isDirectory()) continue;
      // `acts` is a flat directory of Act -> Code-section indexes, 2,733 of them,
      // and bundles exactly like a title.
      out.push({ dir: p, base: join(usc, `${d}`), name: `usc/${d}` });
    }
  }
  const plaw = join(ROOT, 'data/plaw');
  if (existsSync(plaw)) {
    for (const d of readdirSync(plaw).sort()) {
      const p = join(plaw, d);
      if (!statSync(p).isDirectory()) continue;
      out.push({ dir: p, base: join(plaw, `${d}`), name: `plaw/${d}` });
    }
  }
  return out;
}

/** The shard files of a group, keyed by the stem a fetch would ask for. */
function shards(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ key: f.slice(0, -5), file: join(dir, f) }));
}

function build(g) {
  const files = shards(g.dir);
  if (!files.length) return null;
  const parts = [];
  const at = {};
  let buf = [];
  let size = 0;

  const flush = () => {
    if (!buf.length) return;
    const name = `${g.base.split(/[\\/]/).pop()}.${parts.length}.jsonl`;
    writeFileSync(`${g.base}.${parts.length}.jsonl`, Buffer.concat(buf));
    parts.push(name);
    buf = [];
    size = 0;
  };

  for (const { key, file } of files) {
    const bytes = readFileSync(file);
    // A part boundary never splits a shard, so an entry is always one Range.
    if (size && size + bytes.length + 1 > MAX_PART) flush();
    at[key] = [parts.length, size, bytes.length];
    buf.push(bytes, Buffer.from('\n'));
    size += bytes.length + 1;
  }
  flush();

  // `manifest.json` rides along inside the bundle like any other shard, so a
  // group is one index plus its parts and nothing else.
  writeFileSync(`${g.base}.idx.json`, JSON.stringify({ parts, at }));
  return { parts, count: files.length };
}

/**
 * Byte-for-byte, every entry against the file it came from.
 *
 * The whole scheme rests on an offset being right, and an offset that is wrong by
 * one produces JSON that still parses about half the time — so this compares
 * buffers rather than parsed objects, and compares all of them rather than a
 * sample.
 */
function verify(g) {
  const idxFile = `${g.base}.idx.json`;
  if (!existsSync(idxFile)) return { ok: false, why: 'no index' };
  const idx = JSON.parse(readFileSync(idxFile, 'utf8'));
  const parts = idx.parts.map((p) => readFileSync(join(dirname(g.base), p)));
  let n = 0;
  for (const { key, file } of shards(g.dir)) {
    const e = idx.at[key];
    if (!e) return { ok: false, why: `missing entry for ${key}` };
    const [pi, off, len] = e;
    if (!parts[pi]) return { ok: false, why: `entry ${key} names part ${pi}, which does not exist` };
    const slice = parts[pi].subarray(off, off + len);
    if (!slice.equals(readFileSync(file))) return { ok: false, why: `bytes differ for ${key}` };
    JSON.parse(slice.toString('utf8')); // throws if the slice is not a whole shard
    n++;
  }
  const extra = Object.keys(idx.at).length - n;
  if (extra) return { ok: false, why: `${extra} index entries have no shard` };
  return { ok: true, n };
}

const verifyOnly = process.argv.includes('--verify');
// Deleting 77,665 files is not something to do by hand next to a build that may
// have failed, so it lives here, behind a flag, and only runs after every group
// has verified byte-for-byte. Note that --verify needs the shards: it compares
// against them. Once they are pruned there is nothing left to compare to, which
// is why verification is part of building rather than a separate step to
// remember.
const prune = process.argv.includes('--prune');
let files = 0;
let bytes = 0;
let shardCount = 0;
let failed = 0;
const built_ = [];

for (const g of groups()) {
  const built = verifyOnly ? null : build(g);
  const v = verify(g);
  if (v.ok) built_.push(g);
  const idx = `${g.base}.idx.json`;
  const parts = JSON.parse(readFileSync(idx, 'utf8')).parts;
  files += 1 + parts.length;
  bytes += statSync(idx).size + parts.reduce((s, p) => s + statSync(join(dirname(g.base), p)).size, 0);
  shardCount += v.ok ? v.n : 0;
  if (!v.ok) { failed++; console.log(`  ${red('✗')} ${g.name}: ${v.why}`); continue; }
  console.log(
    `  ${g.name.padEnd(14)} ${String(v.n).padStart(6)} shards → ${parts.length} part(s) ${dim(
      `${(statSync(idx).size / 1024).toFixed(0)} KB index`
    )}`
  );
}

console.log(`\n${b('bundled')} ${shardCount} shards into ${files} files, ${(bytes / 1048576).toFixed(0)} MB`);
console.log(`${b('verified')} every entry byte-for-byte against its shard${failed ? red(` — ${failed} group(s) FAILED`) : ''}`);
if (failed) process.exit(1);

if (prune) {
  let removed = 0;
  for (const g of built_) {
    for (const { file } of shards(g.dir)) { rmSync(file); removed++; }
    rmSync(g.dir, { recursive: true });
  }
  console.log(`${b('pruned')} ${removed} shard files — the bundles are the data now`);
  console.log(dim('  regenerate with: python tools/ingest_usc.py --titles all && node tools/bundle.mjs --prune'));
}
