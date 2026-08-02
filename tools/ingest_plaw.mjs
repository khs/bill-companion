#!/usr/bin/env node
//
// Public Law text, sharded per section.
//
//   node tools/ingest_plaw.mjs              # every law in LAWS, skipping those present
//   node tools/ingest_plaw.mjs 113-79       # just that one
//   node tools/ingest_plaw.mjs --force      # re-shard even if already there
//
// Why this exists, given that data/usc/acts/ already maps a Public Law's own
// section numbers onto the Code: because most of a Public Law never reaches the
// Code at all. Across the regression corpus, 507 citations name a section of a
// Public Law and only 174 of them are codified — the other 333 are
// appropriations lines, effective dates, findings and savings clauses, which
// have no Code section to point at and never will. The index cannot answer
// those. The enacted text is the only thing that can.
//
// So the two mechanisms are complements, and the resolver prefers the index:
// a codified section is *current* law, and this text is the law as enacted and
// never updated. See app/resolve/plaw.js.
//
// Sharding per section matters. These laws run to 7.8 MB; making a reader
// download the Consolidated Appropriations Act, 2021 to see one subsection of
// it would be worse than the outbound link this replaces. Same shape as
// data/usc: one static JSON per section, fetched on demand, no index to load.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node's ESM loader rejects a bare Windows path; see the note in impact.mjs.
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const OUT = join(ROOT, 'data/plaw');

// The twenty-five most-cited Public Laws across the 27 bills in the regression
// corpus, with their citation counts. Regenerate the ranking with:
//
//   walk every bill, extractCitations, count kind === 'publaw' by congress-law
//
// Worth knowing before adding more: this is a long tail, and it does not have a
// knee. Ten laws cover 24% of the corpus's 3,307 Public Law citations,
// twenty-five cover 37%, and there are 602 distinct laws — the return is close
// to linear the whole way down, so there is no threshold to reach for. Add a
// law when a sample leans on one, the way popular-names.js grew.
// `data/usc/acts/` is the broad mechanism, covering 1,737 laws; this is the
// deep one.
// `name` is a label for the console and the manifest, nothing resolves through
// it, and it is checked against what the law calls itself — see nameCheck()
// below. Rank and count are the derivation, kept so the next person can see
// where the cut fell rather than guessing.
const LAWS = [
  { id: '116-260', cites: 133, name: 'Consolidated Appropriations Act, 2021' },
  { id: '115-232', cites: 121, name: 'John S. McCain National Defense Authorization Act for Fiscal Year 2019' },
  { id: '116-92', cites: 118, name: 'National Defense Authorization Act for Fiscal Year 2020' },
  { id: '117-2', cites: 83, name: 'American Rescue Plan Act of 2021' },
  { id: '115-141', cites: 74, name: 'Consolidated Appropriations Act, 2018' },
  { id: '114-94', cites: 73, name: 'Fixing America’s Surface Transportation Act' },
  { id: '116-94', cites: 62, name: 'Further Consolidated Appropriations Act, 2020' },
  { id: '116-136', cites: 48, name: 'CARES Act' },
  { id: '116-6', cites: 42, name: 'Consolidated Appropriations Act, 2019' },
  { id: '117-103', cites: 42, name: 'Consolidated Appropriations Act, 2022' },
  // 11–25.
  { id: '115-31', cites: 39, name: 'Consolidated Appropriations Act, 2017' },
  { id: '115-91', cites: 39, name: 'National Defense Authorization Act for Fiscal Year 2018' },
  { id: '116-283', cites: 36, name: 'William M. (Mac) Thornberry National Defense Authorization Act for Fiscal Year 2021' },
  { id: '117-58', cites: 31, name: 'Infrastructure Investment and Jobs Act' },
  { id: '115-334', cites: 30, name: 'Agriculture Improvement Act of 2018' },
  { id: '113-79', cites: 29, name: 'Agricultural Act of 2014' },
  { id: '112-141', cites: 28, name: 'Moving Ahead for Progress in the 21st Century Act' },
  { id: '114-113', cites: 27, name: 'Consolidated Appropriations Act, 2016' },
  { id: '113-235', cites: 27, name: 'Consolidated and Further Continuing Appropriations Act, 2015' },
  { id: '111-148', cites: 27, name: 'Patient Protection and Affordable Care Act' },
  { id: '113-76', cites: 26, name: 'Consolidated Appropriations Act, 2014' },
  { id: '114-322', cites: 25, name: 'Water Infrastructure Improvements for the Nation Act' },
  { id: '114-328', cites: 25, name: 'National Defense Authorization Act for Fiscal Year 2017' },
  { id: '110-246', cites: 24, name: 'Food, Conservation, and Energy Act of 2008' },
  { id: '116-127', cites: 22, name: 'Families First Coronavirus Response Act' },
];

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/** Same rule as slug() in app/resolve/usc.js, and it must stay that way. */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '_');

/**
 * Does the name in LAWS match what the law calls itself?
 *
 * The entries above are typed by hand from a citation-frequency ranking, and a
 * wrong one is the kind of error nothing else would ever surface — the id is
 * what resolves, so a mislabelled law would sit in the manifest looking
 * authoritative and be wrong only where a human read it. The law states its own
 * short title in section 1, which parseBill already extracts, so the check is
 * free. Compared loosely: the short title is "Consolidated Appropriations Act,
 * 2019" where a name may carry an alternate ("CARES Act"), and either is fine
 * as long as they are recognisably the same Act.
 */
function nameCheck(name, shortTitle) {
  if (!shortTitle) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(name);
  const b = norm(shortTitle);
  if (a === b || a.includes(b) || b.includes(a)) return null;
  // An acronym short title ("CARES Act") against a spelled-out name, or the
  // reverse. Accept when the significant words of the shorter appear in the
  // longer, which is what "recognisably the same Act" amounts to here.
  const words = (s) => s.split(' ').filter((w) => w.length > 3 && w !== 'act');
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  const hits = words(short).filter((w) => long.includes(w)).length;
  if (words(short).length && hits / words(short).length >= 0.6) return null;
  return shortTitle;
}

const srcUrl = (congress, law) =>
  `https://www.govinfo.gov/content/pkg/PLAW-${congress}publ${law}/html/PLAW-${congress}publ${law}.htm`;

/**
 * Drop the editorial markers the PLAW rendition carries and the enrolled bill
 * does not.
 *
 * govinfo annotates a Public Law with the Statutes at Large and Code cites for
 * each note it generated, written inline as `<<NOTE: 1 USC 1 note.>>` — 107 of
 * them in the Consolidated Appropriations Act, 2019. They arrive as entities
 * (`&lt;&lt;NOTE:`), so tag-stripping does not touch them and they only become
 * text once unwrapPre decodes. They land in the worst possible places:
 *
 *     SEC. 3. <<NOTE: 1 USC 1 note.>>  REFERENCES TO ACT.
 *     DIVISION A—DEPARTMENT <<NOTE: …Appropriations Act, 2019.>> OF HOMELAND …
 *
 * which is a section heading and a division heading with apparatus wedged
 * through the middle of each. Stripped here rather than in unwrapPre because
 * this is an artifact of *this* rendition: the enrolled bills in corpus/files
 * contain zero, so widening the shared helper would risk the corpus baseline to
 * fix a problem it does not have.
 *
 * Removed before parseBill, so the text that is parsed and the text that is
 * stored are the same string and no offset can disagree.
 */
function stripNoteMarkers(text) {
  return text.replace(/[ \t]*<<NOTE:[\s\S]*?>>[ \t]*/g, ' ');
}

async function shard(entry, { unwrapPre, parseBill, normalizeText }) {
  const [congress, law] = entry.id.split('-');
  const dir = join(OUT, entry.id);
  const url = srcUrl(congress, law);

  const res = await fetch(url, { headers: { 'User-Agent': 'bill-companion-plaw/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = stripNoteMarkers(normalizeText(unwrapPre(await res.text())));
  const bill = parseBill(text);
  if (!bill.sections.length) throw new Error('parsed to zero sections');

  // A Public Law numbers its sections per division, so "Sec. 101" is not
  // unique — the Consolidated Appropriations Act, 2019 has several. One file
  // per NUMBER holding every section with that number, rather than one file per
  // section with the later ones silently overwriting the earlier: that is the
  // shard-format fix TODO 6 still wants for the Code itself, and there was no
  // reason to repeat the mistake here.
  const byNumber = new Map();
  for (const s of bill.sections) {
    if (!byNumber.has(s.num)) byNumber.set(s.num, []);
    byNumber.get(s.num).push({
      heading: s.heading,
      runIn: !!s.runIn,
      ancestors: s.ancestors.map((a) => `${a.label}—${a.heading}`),
      text: text.slice(s.start, s.end).replace(/\s+$/, ''),
    });
  }

  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const [num, entries] of byNumber) {
    writeFileSync(
      join(dir, `s${slug(num)}.json`),
      JSON.stringify({ law: `Pub. L. ${entry.id}`, number: num, entries })
    );
  }

  // The table of contents the pane shows for a bare "Public Law 116-6", which
  // names a whole law rather than a provision. Headings only — the text stays
  // in the shards, or this file would be the law all over again.
  const toc = bill.sections.map((s) => ({
    num: s.num,
    heading: s.heading.slice(0, 120),
    where: s.ancestors.map((a) => a.label).join(' > '),
  }));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      law: `Pub. L. ${entry.id}`,
      congress,
      number: law,
      name: entry.name,
      shortTitle: bill.meta.shortTitle || null,
      sections: byNumber.size,
      total: bill.sections.length,
      source: url,
      toc,
    })
  );

  // Files, not writes — the same invariant the Code's manifest has, and for the
  // same reason: a count of writes cannot disagree with the directory, so it
  // cannot report a collision either.
  const onDisk = readdirSync(dir).filter((f) => f !== 'manifest.json').length;
  if (onDisk !== byNumber.size) throw new Error(`manifest says ${byNumber.size}, disk has ${onDisk}`);

  return {
    sections: byNumber.size,
    total: bill.sections.length,
    shortTitle: bill.meta.shortTitle,
    mismatch: nameCheck(entry.name, bill.meta.shortTitle),
  };
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('-'));

const { unwrapPre } = await imp('tools/measure.mjs');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');

mkdirSync(OUT, { recursive: true });
const wanted = only.length ? LAWS.filter((l) => only.includes(l.id)) : LAWS;
if (!wanted.length) {
  console.error(`no such law in LAWS: ${only.join(', ')}`);
  process.exit(1);
}

const done = [];
const mismatches = [];
for (const entry of wanted) {
  const dir = join(OUT, entry.id);
  if (!force && existsSync(join(dir, 'manifest.json'))) {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    console.log(`${b(entry.id)} ${dim(`already sharded — ${m.sections} sections`)}`);
    done.push({ ...entry, sections: m.sections, total: m.total });
    continue;
  }
  process.stdout.write(`${b(entry.id)} ${dim(entry.name)} … `);
  try {
    const r = await shard(entry, { unwrapPre, parseBill, normalizeText });
    console.log(`${r.sections} section numbers, ${r.total} sections`);
    if (r.mismatch) {
      console.log(`      ${red('name mismatch')} — LAWS says ${JSON.stringify(entry.name)},`);
      console.log(`      the law says ${JSON.stringify(r.mismatch)}`);
      mismatches.push(`${entry.id}: ${entry.name} != ${r.mismatch}`);
    }
    done.push({ ...entry, sections: r.sections, total: r.total });
  } catch (err) {
    console.log(red(`failed: ${err.message}`));
  }
}

// The index the app reads to decide whether a Public Law is available locally
// at all. Without it every citation would cost a 404 to find out.
const existing = existsSync(join(OUT, 'manifest.json'))
  ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')).laws || []
  : [];
const merged = new Map(existing.map((l) => [l.id, l]));
for (const d of done) merged.set(d.id, { id: d.id, name: d.name, sections: d.sections, total: d.total });
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ laws: [...merged.values()].sort((x, y) => x.id.localeCompare(y.id)) }, null, 1)
);

console.log(`\n${b(`${merged.size} law(s)`)} in data/plaw/manifest.json`);
