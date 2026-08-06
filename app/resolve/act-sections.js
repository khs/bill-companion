// Act section numbers -> Code section numbers.
//
// An Act's own numbering is usually not the Code's. Social Security Act § 1861
// is 42 U.S.C. 1395x; PHSA § 330 is 42 U.S.C. 254b; Commodity Exchange Act § 4
// is 7 U.S.C. 6. Bills cite the Act number constantly — it is how the drafters
// think about the statute — so without a mapping "Section 1861 of the Social
// Security Act" could only resolve to the head of the Act, and the provision the
// bill is actually changing was unreachable.
//
// There is no arithmetic here and no offset: the relationship is a lookup table,
// because Congress codifies sections wherever they fit. What makes the table
// obtainable is that the Code states it itself. Every section carries a USLM
// <sourceCredit> whose first clause names the enacting Act and the number that
// Act gave the section:
//
//   42 U.S.C. 1395x -> "(Aug. 14, 1935, ch. 531, title XVIII, § 1861, as added …)"
//
// tools/ingest_usc.py inverts those credits into data/usc/acts/<slug>.json while
// it walks the Code, so this is a single static GET like everything else, with
// no index to load first.
//
// The table is only consulted for Acts carrying `enactedAs` in popular-names.js.
// That gate is deliberate: the index covers thousands of Acts, but a name has to
// be tied to an enacting credit by hand and checked before a citation is allowed
// to resolve through it.

import { DATA } from './data-base.js';
import { loadBundled } from './bundle.js';

const ACTS = `${DATA}/acts`;

const cache = new Map();

/**
 * Filename for an Act key.
 *
 * Runs of punctuation collapse to a single `_`, which is what lets the EN DASH
 * the Code uses ("Pub. L. 89–10") and the ASCII hyphen everyone else writes
 * reach the same file. Must stay in step with act_slug() in
 * tools/ingest_usc.py, which writes the files this reads — the same standing
 * hazard as slug() in usc.js.
 */
export function actSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * The Act-section table for one Act, or null if it was never indexed.
 *
 * A failed load is not cached, for the reason spelled out in usc.js: one dropped
 * request would otherwise make the Act permanently unresolvable for the life of
 * the page, with no retry when the server came back. A 404 is cached, because
 * "this Act is not in the index" is a real answer.
 */
export function loadActIndex(enactedAs) {
  const key = actSlug(enactedAs);
  if (!key) return Promise.resolve(null);
  if (cache.has(key)) return cache.get(key);
  const p = loadBundled(ACTS, key)
    .catch(() => {
      cache.delete(key);
      return null;
    });
  cache.set(key, p);
  return p;
}

/**
 * Where does "section <actSection> of <Act>" live in the Code?
 *
 * @returns {Promise<{title:string, section:string}|null>}
 *
 * Null is a real and common answer, and is always preferred to a guess: the Act
 * may not be indexed, the section may have been repealed out of the Code, or two
 * Code sections may both have claimed it — the ingester tombstones that last case
 * rather than picking one, because a citation pointing at a real but unrelated
 * provision is the worst output this app has.
 */
/**
 * Which Code sections make up "title V of the Housing Act of 1949"?
 *
 * A title of an Act is a range, the way a division of a Public Law is, and the
 * credit states it in the same breath as the section number:
 *
 *   42 U.S.C. 1471 -> "(July 15, 1949, ch. 338, title V, § 501, 63 Stat. 432; …)"
 *
 * so this is the same lookup in the same derived data, and rests on the same
 * claim — that it only ever repeats what the Code says about itself. 857 Acts
 * carry a title index, over 2,222 titles.
 *
 * Roman numerals are how Acts number their titles and how the credits spell
 * them, so no conversion is wanted; the citation is matched as written and
 * upper-cased. A miss is a real answer: the Act may have no titles, or a title
 * may be entirely uncodified.
 *
 * @returns {Promise<string[]|null>} "42:1471"-style entries in the Act's own
 *   section order, or null.
 */
export async function resolveActTitle(act, actTitle) {
  if (!act || !act.enactedAs || !actTitle) return null;
  const index = await loadActIndex(act.enactedAs);
  if (!index || !index.titles) return null;
  const hit = index.titles[String(actTitle).toUpperCase()];
  return hit && hit.length ? hit : null;
}

export async function resolveActSection(act, actSection) {
  if (!act || !act.enactedAs || !actSection) return null;
  const index = await loadActIndex(act.enactedAs);
  if (!index || !index.sections) return null;
  // Bills write "section 1861" and the credits write "1861"; a trailing period
  // or a subsection in the citation has already been split off by the caller.
  const hit = index.sections[String(actSection)];
  if (!hit) return null;
  const at = hit.indexOf(':');
  if (at < 0) return null;
  return { title: hit.slice(0, at), section: hit.slice(at + 1) };
}
