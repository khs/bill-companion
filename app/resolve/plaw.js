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
// This is where those live. Twenty-five laws, sharded per section by
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
 * A structural label, reduced to the level it names.
 *
 * The two records disagree about spelling and both are right. A section shard
 * stores the heading the law itself prints — "DIVISION N—ADDITIONAL CORONAVIRUS
 * RESPONSE AND RELIEF", "Subtitle A—Nutrition" — while the table of contents
 * stores the bare label the ingester cut off the front of it. Everything after
 * the separator is the unit's *name*, which no citation writes; only the level
 * and its letter are addressable, so that is all this keeps.
 */
function unitLabel(s) {
  return String(s || '')
    .split(/\s*(?:--|[—–])\s*/)[0]
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Does this provision sit at or below the path the citation named?
 *
 * A prefix test, not equality: "division N" is satisfied by
 * DIVISION N › TITLE VII › Subtitle A, and so is "subtitle A of title VII of
 * division N". A citation naming more levels than the provision has cannot be
 * about it.
 */
/** "DIVISION A" -> "division A". The unit word is prose; the letter is a name. */
function pretty(label) {
  const at = String(label).lastIndexOf(' ');
  return at < 0 ? label : `${label.slice(0, at).toLowerCase()}${label.slice(at)}`;
}

function underPath(ancestors, want) {
  if (!want || !want.length) return true;
  const have = (ancestors || []).map(unitLabel);
  return want.length <= have.length && want.every((w, i) => have[i] === unitLabel(w));
}

/**
 * Resolve a Public Law citation against the local text.
 *
 * `where` is the structural path the citation named, outermost first, and it is
 * the other half of the address whenever the law is an omnibus: Pub. L. 116-260
 * has four sections numbered 702, one each in divisions A, E, N and FF, so
 * "section 702(a) of division N" is unambiguous and used to be answered with all
 * four and a note saying the citation did not say which. It said which.
 *
 * A path matching nothing is dropped rather than obeyed. Either the citation or
 * our reading of the law's structure is wrong, and showing every candidate with
 * the ambiguity stated is the honest answer to that; showing none would turn a
 * resolvable citation into a dead link on the strength of a guess.
 *
 * @returns {Promise<object|null>} null whenever this cannot answer — the law is
 *   not held, or it holds no section by that number — so the caller falls
 *   through to the outbound link exactly as before.
 */
/**
 * The division a short title names, where the law's own headings say so.
 *
 * "Section 532 of the Department of Homeland Security Appropriations Act, 2018
 * (Public Law 115-141)" names its division without writing the letter: that Act
 * IS division F, and the law prints the mapping on the division itself —
 * `DIVISION F—DEPARTMENT OF HOMELAND SECURITY APPROPRIATIONS ACT, 2018`. So the
 * short title the bill used is an exact substring of the heading, and no table
 * of division short titles has to be authored or maintained. This is the half of
 * the division problem that could not be closed by reading the citation alone.
 *
 * Only an unambiguous hit counts. Two divisions answering to one title means the
 * title does not settle it, and the reader gets every candidate as before —
 * which is the same rule the written-out division follows.
 */
function narrowByTitle(entries, shortTitle) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(shortTitle);
  if (want.length < 12) return null;
  const hit = entries.filter((e) => norm((e.ancestors || [])[0] || '').includes(want));
  return hit.length === 1 ? hit : null;
}

export async function resolvePlaw(congress, law, section, where, shortTitle) {
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

  const all = shard.entries;
  let narrowed = where ? all.filter((e) => underPath(e.ancestors, where)) : [];
  let by = narrowed.length && narrowed.length < all.length ? where.join(' › ') : null;
  // What the citation gets suffixed with — the outermost level only, since that
  // is the one that decides which of several same-numbered sections is meant.
  let label = by ? pretty(where[0]) : null;

  // The written-out path first, because it is the citation saying so outright.
  // Only where it said nothing does the short title get a turn.
  if (!by && all.length > 1 && shortTitle) {
    const byTitle = narrowByTitle(all, shortTitle);
    if (byTitle) {
      narrowed = byTitle;
      const heading = (byTitle[0].ancestors || [])[0] || '';
      by = heading || shortTitle;
      label = heading ? pretty(unitLabel(heading)) : null;
    }
  }
  const entries = narrowed.length ? narrowed : all;

  return {
    source: 'Public Law (as enacted)',
    citation:
      `Pub. L. ${lawId(congress, law)}` +
      (label ? `, ${label}` : '') +
      ` § ${section}`,
    plaw: { ...index, toc: null, number: section, entries, narrowedBy: by, of: all.length },
    asEnacted: true,
  };
}

/**
 * One subdivision of a Public Law we hold: its contents, not a provision.
 *
 * "Division J of the Infrastructure Investment and Jobs Act" names 19 sections
 * out of that law's 630, and the useful answer is which 19 — the same answer a
 * bare Public Law gets, narrowed to what the citation actually named.
 *
 * `where` is the whole path and not just the division, because a citation with
 * no section number has nothing *but* the path to narrow it: "Subtitle A of
 * title II of division A of the CARES Act" is 16 sections where division A is
 * 90, and answering with division A hands back the other 74 as though they had
 * been cited.
 */
export async function resolvePlawDivision(congress, law, where) {
  if (!where || !where.length || !(await havePlaw(congress, law))) return null;
  const index = await loadPlawIndex(congress, law);
  if (!index || !Array.isArray(index.toc)) return null;
  const toc = index.toc.filter((t) => underPath(String(t.where || '').split(' > '), where));
  if (!toc.length) return null;
  return {
    source: 'Public Law (as enacted)',
    // Outermost first, the way the law is built — the reverse of the order the
    // citation writes it, and the order the contents below are in.
    citation: `Pub. L. ${lawId(congress, law)}, ${where.map(pretty).join(', ')}`,
    plaw: { ...index, toc, entries: null, total: toc.length },
    asEnacted: true,
  };
}
