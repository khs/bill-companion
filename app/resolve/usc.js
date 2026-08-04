// U.S. Code resolution against pre-ingested static shards.
//
// Unlike the CFR, there is no CORS-open API for the U.S. Code — uscode.house.gov
// serves bulk XML with no CORS headers and govinfo requires a key. So the Code
// is ingested ahead of time by tools/ingest_usc.py into one JSON file per
// section, which makes a lookup a single static GET with no index to load first.
//
// Titles that haven't been ingested are not an error state: we still render the
// citation with working outbound links and tell the user how to add the title.

import { buildTree, findNode, pathChain } from './provision-tree.js';
import { DATA, isLocalCheckout } from './data-base.js';

let manifestPromise = null;
const sectionCache = new Map();

/**
 * Which titles are available locally. Written by the ingest script.
 *
 * A *failed* load is never cached. Caching the rejection meant one dropped
 * request — the dev server not running yet, a reload mid-flight — permanently
 * downgraded the page to "no title has been ingested", for every title, and it
 * stayed that way after the server came back because nothing ever retried. A
 * 404 is cached, because that is a real answer: no data has been ingested.
 */
export function manifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${DATA}/manifest.json`)
      .then((r) => (r.ok ? r.json() : { titles: {} }))
      .catch(() => {
        manifestPromise = null;
        // Distinguished from a real empty manifest so the pane can say the index
        // couldn't be reached rather than accusing the user of not ingesting it.
        return { titles: {}, unreachable: true };
      });
  }
  return manifestPromise;
}

/**
 * Section numbers appear as 300f, 1395x, 2000a-1 — normalise for a filename.
 *
 * Every non-alphanumeric character collapses to `_`, and the dash is the reason
 * why. The OLRC's USLM writes dashed section numbers with an EN DASH — "77z–3",
 * U+2013 — while every bill in the wild cites the same section with an ASCII
 * hyphen, "77z-3". Keeping `-` as a legal filename character made those two
 * spellings slug differently, so the shard written as `s77z_3.json` was looked
 * up as `s77z-3.json` and 404'd. That silently took out ~7,000 sections, and
 * disproportionately the securities ones (77z-3, 78o-11, 80a-3, 80b-2 …) where
 * dashed numbering is the norm. Must stay in step with slug() in
 * tools/ingest_usc.py, which writes the files this reads.
 */
function slug(section) {
  return String(section).toLowerCase().replace(/[^a-z0-9]/g, '_');
}

async function loadSection(title, section) {
  const key = `${title}/${slug(section)}`;
  if (sectionCache.has(key)) return sectionCache.get(key);
  const p = fetch(`${DATA}/t${title}/s${slug(section)}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      // Same reasoning as manifest(): a 404 is an answer worth remembering, a
      // transport failure is not, and caching it makes the section permanently
      // unresolvable for the life of the page.
      sectionCache.delete(key);
      return null;
    });
  sectionCache.set(key, p);
  return p;
}

/**
 * @param {{title:string, section:string, subsection:string}} cite
 */
export async function resolveUsc(cite) {
  const { title, section, subsection } = cite;
  const [mf, data] = await Promise.all([manifest(), loadSection(title, section)]);
  const ingested = Boolean(mf.titles && mf.titles[String(title)]);
  const links = uscLinks(cite);

  if (!data) {
    return {
      source: 'U.S. Code',
      citation: `${title} U.S.C. ${section}${subsection}${cite.etSeq ? ' et seq.' : ''}`,
      // Set here too: whether the bill named a range is a fact about the
      // CITATION, not about whether we happen to hold the section it starts at.
      // Only the missing-section card renders in this branch, but a flag that is
      // true on one path and undefined on the other is the kind of divergence
      // that makes a later consumer work in testing and not in the app.
      isRangeStart: Boolean(cite.etSeq),
      missing: true,
      // Three different failures, three different fixes. Conflating the first
      // with the second sent someone looking for missing data that was sitting
      // on disk the whole time: the dev server was simply not running, so the
      // index never loaded and every title looked un-ingested.
      // Three different failures, three different fixes — and the fix depends on
      // who is reading. A visitor to a deployed page has no checkout to ingest
      // into and no server to start, so a shell command is not a remedy, it is
      // noise that reads like the site is broken. They still get the outbound
      // links, which are the actual way forward for them.
      reason: mf.unreachable
        ? isLocalCheckout()
          ? `Couldn't load the U.S. Code index at ${DATA}/manifest.json, so nothing can be resolved locally. The shards are fetched over HTTP — this is what it looks like when the dev server isn't running, or when index.html was opened as a file:// URL.`
          : `Couldn't load the U.S. Code index at ${DATA}/manifest.json. The site is there but its copy of the Code isn't answering, so nothing can be resolved locally right now.`
        : ingested
        ? `Title ${title} is ingested, but section ${section} isn't in it. The citation may be to a section that was repealed, renumbered, or never existed.`
        : isLocalCheckout()
        ? `Title ${title} of the U.S. Code hasn't been ingested yet.`
        : `This copy of the site doesn't include Title ${title} of the U.S. Code.`,
      remedy: !isLocalCheckout()
        ? null
        : mf.unreachable
        ? 'python tools/serve.py'
        : ingested
        ? null
        : `python tools/ingest_usc.py --titles ${title}`,
      links,
    };
  }

  const tree = data.tree && data.tree.length ? data.tree : buildTree(data.paragraphs || []);

  // The path the bill cited, and the path the tree actually uses. Usually the
  // same; see runInLevels() for when they aren't.
  let focusPath = subsection;
  let focusNode = subsection ? findNode(tree, subsection) : null;
  let runIn = null;
  let headLevel = null;
  if (subsection && !focusNode) {
    const found = runInLevels(tree, data.lead || '', subsection);
    if (found) {
      focusPath = found.path;
      focusNode = found.node;
      runIn = found.dropped;
    }
  }
  if (subsection && !focusNode) {
    const found = dropHeadLevel(tree, cite);
    if (found) {
      focusPath = found.path;
      focusNode = found.node;
      headLevel = found.marker;
    }
  }
  const chain = focusPath ? pathChain(tree, focusPath) : [];

  return {
    source: 'U.S. Code',
    asOf: data.releasePoint || mf.releasePoint || null,
    // "15 U.S.C. 2601 et seq." is a RANGE, and the heading is the first thing
    // the reader reads. Printing it as a bare "15 U.S.C. 2601" over the text of
    // § 2601 alone says the bill cited that section — which it did not; it cited
    // the Toxic Substances Control Act. 2,620 citations across 28 corpus bills
    // are this shape. Carrying "et seq." into the heading costs nothing and is
    // the difference between showing a section and claiming one.
    citation: `${title} U.S.C. ${section}${subsection}${cite.etSeq ? ' et seq.' : ''}`,
    // Carried as data beside the display string, so nothing downstream has to
    // parse the one to get the other. The level ladder used to take the last
    // word of `citation` as the section number, which held right up until the
    // citation ended in something else.
    title: String(title),
    section: String(section),
    // The pane says what a range is and what it is showing; see rangeStartCard().
    isRangeStart: Boolean(cite.etSeq),
    heading: data.heading || '',
    // The section's flush lead-in text, above any subsection. For a section that
    // was never subdivided this is the entire operative provision — 15 U.S.C.
    // 77z-3 ("General exemptive authority") is one flush paragraph and nothing
    // else. Dropping it rendered roughly a quarter of all sections as an empty
    // pane and hid their text from the struck-language check.
    lead: data.lead || '',
    crumbs: (data.ancestors || []).map((a) => ({
      type: a.type,
      label: a.heading ? `${a.num} ${a.heading}`.trim() : a.num,
      short: a.num,
      identifier: a.identifier,
      href: crumbHref(a.identifier),
    })),
    tree,
    notes: data.notes || [],
    sourceCredit: data.sourceCredit || '',
    // The subsection the bill pointed at, plus every level above it. This is the
    // "go up sub-levels" payload the context pane renders as a breadcrumb.
    // The tree's own spelling of the path, because this is what node
    // highlighting compares against. `citedPath` keeps what the bill wrote.
    focusPath: focusPath || '',
    citedPath: subsection || '',
    // Set when the two differ: the levels that live in the lead rather than in
    // the tree, so the pane can explain the gap instead of hiding it.
    runIn,
    // …and when the level that had to go was an Act's own subsection, carried
    // down from an instruction head onto a section that is that subsection.
    headLevel,
    focusNode,
    focusChain: chain,
    // A subsection was cited but isn't in the text we have — usually means the
    // bill is *adding* it, which is worth saying out loud rather than 404ing.
    focusMissing: Boolean(subsection && !focusNode),
    // The Code contains seven section numbers claimed by two different Public
    // Laws — two "§ 3598"s in title 5, and so on. One shard per number used to
    // mean the second one written simply replaced the first, and the pane
    // showed whichever came later in the XML with nothing to say the other
    // existed. Both are now in the shard; this is the rest of them, so the pane
    // can say so and let the reader read the other one.
    also: (data.also || []).map((a) => ({
      heading: a.heading || '',
      lead: a.lead || '',
      tree: a.tree && a.tree.length ? a.tree : buildTree(a.paragraphs || []),
      notes: a.notes || [],
      sourceCredit: a.sourceCredit || '',
      crumbs: (a.ancestors || []).map((c) => ({
        type: c.type,
        label: c.heading ? `${c.num} ${c.heading}`.trim() : c.num,
        short: c.num,
        identifier: c.identifier,
        href: crumbHref(c.identifier),
      })),
    })),
    links,
  };
}

/**
 * Drop an Act's own subsection from an address composed against a Code section
 * that IS that subsection.
 *
 * The head of an instruction states an address in its first six words, and where
 * the parenthetical carries no codified subsection that head is the only address
 * there is — see the note on `base` in extractAmendments. Usually it is right.
 * Sometimes the Act's numbering and the Code's have already been reconciled by
 * the codifier, and then it is not:
 *
 *   Section 311(d) of the Legislative Branch Appropriations Act, 1988
 *     (2 U.S.C. 4532) is amended— (1) in paragraph (1) …
 *   2 U.S.C. 4532 credit: "(Pub. L. 100–202, § 101(i) [title III, § 311(d)], …)"
 *
 * The codified section IS § 311(d), so 4532's top level is the paragraphs
 * (1)–(4) and there is no (d) in it, by construction, ever. Every reference in
 * that instruction composed one level too deep and the pane answered each with
 * "the current text of this section has no such subsection… the bill is adding
 * it, or it has been repealed" — both false, about a paragraph sitting a few
 * lines up in the same pane, which this very bill inserts. Same family as
 * 12 U.S.C. 375 = Federal Reserve Act § 22(d), already tracked.
 *
 * `reScope()` has repaired the OPERATIONS of these instructions since the head
 * address was first read; the citation the reader clicks had no equivalent
 * check, so the redline drew in the right place while the address above it named
 * nothing. 50 across the corpus.
 *
 * Two guards, and both are needed. Only an address COMPOSED from the head is
 * eligible — a bill that writes "12 U.S.C. 5701(b)(1)" out in full has said what
 * it means, and if that is wrong it is the drafter's error to show, not ours to
 * paper over. And the dropped marker must be absent from the section's own top
 * level: "clause (i)" composed onto 26 U.S.C. 168(k) dies because (k) has no
 * clause (i), not because (k) is wrong — and 168 does have a subsection (i), so
 * dropping the (k) would answer with a different provision. 15 of the 65
 * addresses whose tail happens to resolve are that shape.
 */
function dropHeadLevel(tree, cite) {
  if (!cite.subFromHead) return null;
  const marks = String(cite.subsection || '').match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  if (marks.length < 2) return null;
  if (tree.some((n) => n.path === marks[0])) return null;
  const path = marks.slice(1).join('');
  const node = findNode(tree, path);
  return node ? { path, node, marker: marks[0] } : null;
}

/**
 * Recover a citation whose upper levels are written into the section's lead.
 *
 * Not every level of a section is a node. Where a paragraph's text runs on into
 * its own subparagraphs, the OLRC leaves it in the lead and structures only what
 * follows — 42 U.S.C. 4332 is the standard example:
 *
 *   lead: "The Congress authorizes and directs that, to the fullest extent
 *          possible: (1) the policies … shall be interpreted … and (2) all
 *          agencies of the Federal Government shall—"
 *   tree: (A) (B) (C) … (L)
 *
 * So a bill citing 4332(2)(C) — the environmental impact statement, and about
 * the most litigated provision in the Code — found no node and was told the
 * subsection did not exist. Stating that a provision isn't in the law is far
 * worse than saying nothing, and the reader has no way to tell it is wrong.
 *
 * Both conditions must hold before the citation is rewritten: every dropped
 * marker appears literally in the lead, AND what remains resolves to a real
 * node. That is what keeps this away from the ordinary case — a bill *adding* a
 * subsection still has nothing in the lead to match, so it is still reported
 * missing, correctly. Measured over the amendatory corpus, this recovers the
 * run-in citations and leaves the genuinely-absent ones alone.
 */
function runInLevels(tree, lead, subsection) {
  const parts = subsection.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  for (let d = 1; d < parts.length; d++) {
    const dropped = parts.slice(0, d);
    if (!dropped.every((mk) => lead.includes(mk))) continue;
    const rest = parts.slice(d).join('');
    const node = findNode(tree, rest);
    if (node) return { path: rest, node, dropped: dropped.join('') };
  }
  return null;
}

// The USLM identifier's own vocabulary for the levels above a section, and the
// word Cornell spells each one with. Both sides are fixed by the source rather
// than chosen here: the left is what the OLRC writes in `<... identifier>`, the
// right is what law.cornell.edu puts in a path.
//
// Order matters, and it is prefix order, not alphabetical: `spt` must be tried
// before `st` and `sch` before `ch`, or "sptA" parses as a subtitle. The number
// after the prefix runs to the end of the segment and is NOT restricted to
// uppercase — `/us/usc/t42/ch6A/schII/ptD/sptiii` is subpart iii, and a pattern
// anchored on `[A-Z0-9]` silently drops every one of those.
const USLM_LEVELS = [
  ['sch', 'subchapter'],
  ['spt', 'subpart'],
  ['sd', 'subdivision'],
  ['st', 'subtitle'],
  ['ch', 'chapter'],
  ['pt', 'part'],
  ['d', 'division'],
];

/**
 * A link to the level a crumb names — the chapter a section sits in, the
 * subtitle above that — built from the identifier the shard already carries.
 *
 * The crumbs have always held `/us/usc/t7/ch51` and the pane rendered them as
 * inert grey text, so the reader could SEE that the section sits in chapter 51
 * of title 7 and could do nothing with it. This is precision the data already
 * had; only the anchor was missing.
 *
 * Cornell mirrors the USLM hierarchy exactly, so the transform is mechanical and
 * every level checked resolves — title, chapter, subchapter, part, subpart,
 * subtitle, division and subdivision, nested to four deep.
 *
 * A segment whose prefix is not in the table returns null and the crumb stays
 * text. That is the whole safety of this: a guessed path would send the reader
 * to a 404 wearing the app's confidence, and an unlinked crumb costs them
 * nothing they had before.
 */
export function crumbHref(identifier) {
  // The EN DASH again, and in the same role it plays for slug(): USLM writes
  // "subchapter III–A" with one and every URL wants an ASCII hyphen. Left out,
  // this declined 1,583 of the Code's 200,675 crumbs — every one of them a real
  // subchapter with a real page behind it — and declined them silently, which is
  // the failure mode that makes a safe default expensive rather than free.
  const id = String(identifier || '').replace(/[–—]/g, '-');
  const m = /^\/us\/usc\/t([0-9]+[A-Za-z]?)((?:\/[A-Za-z]+[A-Za-z0-9-]*)*)$/.exec(id);
  if (!m) return null;
  const [, title, rest] = m;
  const segs = rest ? rest.slice(1).split('/') : [];
  const out = [];
  for (const seg of segs) {
    const hit = USLM_LEVELS.find(([p]) => seg.startsWith(p) && seg.length > p.length);
    if (!hit) return null;
    out.push(`${hit[1]}-${seg.slice(hit[0].length)}`);
  }
  return `https://www.law.cornell.edu/uscode/text/${title}${out.length ? `/${out.join('/')}` : ''}`;
}

export function uscLinks(cite) {
  const { title, section } = cite;
  return [
    {
      label: 'Cornell LII',
      href: `https://www.law.cornell.edu/uscode/text/${title}/${section}`,
    },
    {
      label: 'OLRC (uscode.house.gov)',
      href: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${title}-section${section}&num=0&edition=prelim`,
    },
    {
      label: 'govinfo',
      href: `https://www.govinfo.gov/link/uscode/${title}/${section}`,
    },
  ];
}
