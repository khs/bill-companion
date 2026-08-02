// Public Law text, as enacted.
//
// The complement to data/usc/acts/, not a replacement for it. That index maps a
// Public Law's own section numbers onto the Code and answers with *current* law
// — the section as it stands today, amendments and all. It can only answer for
// sections that were codified, and most of a Public Law never is: across the
// regression corpus, 507 citations name a section of a Public Law and only 174
// of them are in the Code. The other 333 are appropriations lines, effective
// dates, findings and savings clauses that exist nowhere but the law itself.
//
// This is where those live. Ten laws, sharded per section by
// tools/ingest_plaw.mjs, chosen by citation frequency across the corpus.
//
// The order of preference in app/resolve/index.js is deliberate: the Code first
// where it can answer, because a reader asking about a provision almost always
// wants the law as it stands rather than as it was passed. This text is never
// updated — it is a snapshot of the day it was enacted — and the pane says so.

import { PLAW } from './data-base.js';

const manifestCache = { p: null };
const sectionCache = new Map();

/** Same rule as slug() in usc.js and act-sections.js. Keep all three in step. */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '_');

const lawId = (congress, law) => `${congress}-${law}`;

/**
 * Which Public Laws are available locally.
 *
 * A failed fetch is not cached, for the reason spelled out at length in usc.js:
 * one dropped request would otherwise turn every Public Law into an outbound
 * link for the life of the page, with no retry when the server came back. A 404
 * *is* cached, because "no laws are ingested here" is a real answer.
 */
export function loadPlawManifest() {
  if (manifestCache.p) return manifestCache.p;
  manifestCache.p = fetch(`${PLAW}/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      manifestCache.p = null;
      return null;
    });
  return manifestCache.p;
}

/** Is this law one of the ones we hold? Cheap: one manifest, cached. */
export async function havePlaw(congress, law) {
  const m = await loadPlawManifest();
  if (!m || !Array.isArray(m.laws)) return false;
  return m.laws.some((l) => l.id === lawId(congress, law));
}

/** The law's own manifest — name, counts, and its table of contents. */
export function loadPlawIndex(congress, law) {
  const key = `i:${lawId(congress, law)}`;
  if (sectionCache.has(key)) return sectionCache.get(key);
  const p = fetch(`${PLAW}/${lawId(congress, law)}/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      sectionCache.delete(key);
      return null;
    });
  sectionCache.set(key, p);
  return p;
}

/**
 * One section of one law.
 *
 * Returns every section carrying that number, not one of them. A Public Law
 * numbers its sections per division, so "section 101 of Public Law 116-6" names
 * six different provisions — one in each of divisions A, C, D, E, F and G — and
 * the citation alone does not say which. Handing back the first would be a
 * confident answer to a question nobody can answer from the text; the pane
 * shows them all and lets the reader pick, which is what the ambiguity
 * actually looks like.
 */
export function loadPlawSection(congress, law, section) {
  const key = `s:${lawId(congress, law)}/${slug(section)}`;
  if (sectionCache.has(key)) return sectionCache.get(key);
  const p = fetch(`${PLAW}/${lawId(congress, law)}/s${slug(section)}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      sectionCache.delete(key);
      return null;
    });
  sectionCache.set(key, p);
  return p;
}

/**
 * Resolve a Public Law citation against the local text.
 *
 * @returns {Promise<object|null>} null whenever this cannot answer — the law is
 *   not held, or it holds no section by that number — so the caller falls
 *   through to the outbound link exactly as before.
 */
export async function resolvePlaw(congress, law, section) {
  if (!(await havePlaw(congress, law))) return null;
  const index = await loadPlawIndex(congress, law);
  if (!index) return null;

  if (!section) {
    // A law named without a section names the whole Act, not a provision. Same
    // rule the named-Act path follows: give the reader its contents rather than
    // guessing which of 659 sections was meant.
    return {
      source: 'Public Law (as enacted)',
      citation: `Pub. L. ${lawId(congress, law)}`,
      plaw: { ...index, entries: null },
      asEnacted: true,
    };
  }

  const shard = await loadPlawSection(congress, law, section);
  if (!shard || !shard.entries || !shard.entries.length) return null;
  return {
    source: 'Public Law (as enacted)',
    citation: `Pub. L. ${lawId(congress, law)} § ${section}`,
    plaw: { ...index, toc: null, number: section, entries: shard.entries },
    asEnacted: true,
  };
}
