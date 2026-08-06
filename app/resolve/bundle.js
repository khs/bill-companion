// One small GET per shard, out of a few large files.
//
// The ingested data used to be one file per section: 60,436 U.S. Code sections,
// 14,496 Public Law sections and 2,733 Act indexes, 77,665 files in all. That is
// the right shape for a lookup — a single static GET, with no index of the whole
// Code to load first — and the wrong shape for a deploy. GitHub Pages publishes a
// branch by packaging the entire tree, `data/` accounted for 77,667 of the repo's
// 77,744 files, and it changed in 9 of the project's 68 commits against `app/`'s
// 58. So almost every push re-uploaded tens of thousands of unchanged 5 KB files,
// and the deploy started timing out.
//
// `tools/bundle.mjs` collapses each directory of shards into a few parts plus a
// byte-offset index. This reads one shard back out of them with an HTTP Range
// request, so the bytes crossing the wire are the same bytes as before and the
// lookup contract is unchanged. Confirmed against the live site before any of
// this was built: GitHub Pages answers `206 Partial Content` and advertises
// `Accept-Ranges: bytes`.
//
// The one new cost is the group index, fetched once per group and memoised — and
// only for groups something actually asks about. A bill that cites nothing in
// title 42 never fetches title 42's index.

const indexes = new Map();

/**
 * A group's index: `{ parts: [...], at: { stem: [part, offset, length] } }`.
 *
 * A failed load is never cached, for the reason spelled out in usc.js: one
 * dropped request would otherwise make every section in the group permanently
 * unresolvable for the life of the page, with no retry when the server came
 * back. A 404 IS cached, because "this group is not published here" is a real
 * answer.
 */
function groupIndex(group) {
  if (indexes.has(group)) return indexes.get(group);
  const p = fetch(`${group}.idx.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      indexes.delete(group);
      return null;
    });
  indexes.set(group, p);
  return p;
}

/**
 * One shard, by the stem a per-file layout would have used.
 *
 * `group` is the path the shard directory used to be — "data/usc/t42",
 * "data/plaw/116-6" — and `stem` the filename without `.json`, so every call
 * site is a one-line swap from the fetch it replaces and the key is mechanical
 * rather than a second naming scheme to keep in step.
 *
 * Returns null exactly where the old fetch returned null: no index, no entry,
 * or the part missing. A transport failure throws, so the caller's own catch
 * still decides whether to forget the promise.
 */
export async function loadBundled(group, stem) {
  const idx = await groupIndex(group);
  if (!idx || !idx.at) return null;
  const entry = idx.at[stem];
  if (!entry) return null;
  const [part, offset, length] = entry;
  const name = idx.parts && idx.parts[part];
  if (!name) return null;
  // The parts sit beside the index, which sits beside where the directory was.
  const url = `${group.replace(/[^/]*$/, '')}${name}`;
  const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  // A server that does not honour Range answers 200 with the WHOLE part, and
  // there is no reason to make correctness depend on it — Python's
  // SimpleHTTPRequestHandler is one such server, and it is what serves this
  // locally. Slice by BYTE offset rather than trusting the body to be the range
  // that was asked for. Bytes, not characters: a shard is UTF-8 and the Code is
  // full of EN DASHes and section signs.
  const bytes = buf.length === length ? buf : buf.subarray(offset, offset + length);
  return JSON.parse(new TextDecoder().decode(bytes));
}
