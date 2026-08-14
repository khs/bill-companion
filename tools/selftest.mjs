// Logic self-test for the parsing/resolution modules.
//
// Run with:  bun tools/selftest.mjs      (or: node tools/selftest.mjs)
//
// Covers the pure modules — citation extraction, the subsection tree, bill
// structure — plus a live eCFR round trip. The DOM renderers aren't exercised
// here; they need a browser.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node's ESM loader rejects a bare Windows path ("Received protocol 'c:'");
// bun accepts one. Go through a file:// URL so the tools run under both.
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { extractCitations, extractAmendments, subsectionLadder, expandRelativeRefs } =
  await imp('app/parse/citations.js');
const { buildTree, findNode, pathChain } = await imp('app/resolve/provision-tree.js');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');
const { findAct } = await imp('app/resolve/popular-names.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
/**
 * Is this shard present? Asked of the BUNDLES, not of a per-file path.
 *
 * These guards used to be existsSync on "data/usc/t42/s4332.json". Bundling the
 * shards deleted those paths, so every guard went false and 192 selftest checks
 * plus 31 render checks stopped running — silently, reported as a pass. A suite
 * that can skip a third of itself without saying so is worse than one that fails,
 * which is why the totals are asserted below.
 */
/**
 * One shard, read out of the bundles the way the app reads it.
 *
 * A test that opened "data/plaw/116-6/manifest.json" directly broke the moment
 * the shards were bundled — and would keep breaking every time the layout moves.
 * Read it the way the app does.
 */
function readShard(group, stem) {
  const idx = JSON.parse(readFileSync(join(ROOT, `${group}.idx.json`), 'utf8'));
  const [part, off, len] = idx.at[stem];
  const dir = group.replace(/[^/]*$/, '');
  const buf = readFileSync(join(ROOT, dir, idx.parts[part]));
  return JSON.parse(buf.subarray(off, off + len).toString('utf8'));
}

function haveShard(group, stem) {
  const idx = join(ROOT, `${group}.idx.json`);
  if (!existsSync(idx)) return false;
  const at = JSON.parse(readFileSync(idx, 'utf8')).at || {};
  return Boolean(at[stem]);
}

function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

// ---------------------------------------------------------------- citations
section('citation extraction');
{
  const t = 'Section 1861(s)(2) of the Social Security Act (42 U.S.C. 1395x(s)(2)) is amended by striking "widget" and inserting "gadget".';
  const cs = extractCitations(t);
  const usc = cs.find((c) => c.kind === 'usc');
  ok('finds a USC cite', !!usc);
  eq('  title', usc?.title, '42');
  eq('  section', usc?.section, '1395x');
  eq('  subsection', usc?.subsection, '(s)(2)');
  ok('finds the Act name', cs.some((c) => c.kind === 'act' && c.act.name === 'Social Security Act'));
  ok('offsets land on the cite', t.slice(usc.start, usc.end).startsWith('42 U.S.C.'),
     JSON.stringify(t.slice(usc.start, usc.end)));
}
{
  const variants = [
    ['42 U.S.C. 7401', '42', '7401', ''],
    ['42 USC § 7401', '42', '7401', ''],
    ['26 U.S.C. §§ 501', '26', '501', ''],
    ['15 U.S.C. 78a et seq.', '15', '78a', ''],
    ['42 U.S.C. 1395x(s)(2)(B)', '42', '1395x', '(s)(2)(B)'],
    // govinfo wraps long citations at the hyphen; stopping at "80a" would point
    // the reader at a section that does not exist.
    ['15 U.S.C. 80a-\n                3(a)', '15', '80a-3', '(a)'],
  ];
  for (const [text, ti, se, sub] of variants) {
    const c = extractCitations(text).find((x) => x.kind === 'usc');
    ok(`parses "${text}"`, c && c.title === ti && c.section === se && c.subsection === sub,
       c ? `got ${c.title}/${c.section}/${c.subsection}` : 'no match');
  }
}
{
  const cases = [
    ['40 CFR 60.1', '40', '60', '60.1'],
    ['40 C.F.R. § 60.1(a)', '40', '60', '60.1'],
    ['45 C.F.R. part 160', '45', '160', ''],
    ['21 CFR 1308.11', '21', '1308', '1308.11'],
  ];
  for (const [text, ti, part, sec] of cases) {
    const c = extractCitations(text).find((x) => x.kind === 'cfr');
    ok(`parses "${text}"`, c && c.title === ti && c.part === part && c.section === sec,
       c ? `got title=${c.title} part=${c.part} section=${c.section}` : 'no match');
  }
}
{
  const c = extractCitations('as added by Public Law 117-58 and Pub. L. No. 116-136');
  eq('finds both public laws', c.filter((x) => x.kind === 'publaw').length, 2);
  const s = extractCitations('117 Stat. 1234').find((x) => x.kind === 'stat');
  ok('finds Statutes at Large', s && s.volume === '117' && s.page === '1234');
}
{
  // Overlap resolution: the USC cite inside the parenthetical must win over the
  // weaker Act-name match if they collide.
  const t = 'the Clean Air Act (42 U.S.C. 7401 et seq.)';
  const cs = extractCitations(t);
  const kinds = cs.map((c) => c.kind).sort();
  ok('keeps both act and usc when disjoint', kinds.includes('usc') && kinds.includes('act'), kinds.join(','));
  for (let i = 1; i < cs.length; i++) ok('  no overlapping spans', cs[i].start >= cs[i - 1].end);
}
eq('ladder', subsectionLadder('(s)(2)(B)').join('|'), '|(s)|(s)(2)|(s)(2)(B)');

// --------------------------------------------------------------- amendments
section('amendatory instructions');
{
  const t = 'SEC. 2. FIX.\n\nSection 1861(s)(2) of the Social Security Act (42 U.S.C. 1395x(s)(2)) is amended by striking "widget" and inserting "gadget".';
  const cs = extractCitations(t);
  const as = extractAmendments(t, cs);
  eq('finds one amendment', as.length, 1);
  eq('  target is the USC cite', as[0]?.target?.kind, 'usc');
  eq('  target section', as[0]?.target?.section, '1395x');
  const ops = as[0]?.ops || [];
  ok('  captures strike', ops.some((o) => o.type === 'strike' && o.text === 'widget'), JSON.stringify(ops));
  ok('  captures insert', ops.some((o) => o.type === 'insert' && o.text === 'gadget'), JSON.stringify(ops));
}
{
  // govinfo plain text quotes with the typewriter convention ``like this''.
  const t = "Section 4 of the Widget Act (15 U.S.C. 2601) is amended by striking ``old text'' and inserting ``new text''.";
  const ops = extractAmendments(t, extractCitations(t))[0]?.ops || [];
  ok('handles ``...\'\' quotes: strike', ops.some((o) => o.type === 'strike' && o.text === 'old text'),
     JSON.stringify(ops));
  ok('handles ``...\'\' quotes: insert', ops.some((o) => o.type === 'insert' && o.text === 'new text'),
     JSON.stringify(ops));
}
{
  const t = 'Section 4 of the Widget Act (15 U.S.C. 2601) is amended by striking “curly” and inserting “quotes”.';
  const ops = extractAmendments(t, extractCitations(t))[0]?.ops || [];
  ok('handles curly quotes', ops.some((o) => o.type === 'strike' && o.text === 'curly'), JSON.stringify(ops));
}
{
  // A strike with no quoted operand must not steal the insert's text.
  const t = "Section 4 of the Widget Act (15 U.S.C. 2601) is amended by striking paragraph (3) and inserting ``replacement''.";
  const ops = extractAmendments(t, extractCitations(t))[0]?.ops || [];
  ok('bare strike does not steal the insert operand',
     !ops.some((o) => o.type === 'strike' && o.text === 'replacement'), JSON.stringify(ops));
  ok('  but the insert is still captured',
     ops.some((o) => o.type === 'insert' && o.text === 'replacement'), JSON.stringify(ops));
}
{
  // An apostrophe inside quoted text must not close the string early.
  const t = "Section 4 of the Widget Act (15 U.S.C. 2601) is amended by striking ``the Nation’s policy''.";
  const ops = extractAmendments(t, extractCitations(t))[0]?.ops || [];
  ok('curly apostrophe does not close a quote',
     ops.some((o) => o.type === 'strike' && o.text.includes('policy')), JSON.stringify(ops));
}
{
  const t = 'Section 801(a)(2)(A) of title 5, United States Code, is amended.';
  const c = extractCitations(t).find((x) => x.kind === 'usc');
  ok('parses "of title N, United States Code"',
     c && c.title === '5' && c.section === '801' && c.subsection === '(a)(2)(A)',
     c ? `${c.title}/${c.section}/${c.subsection}` : 'no match');
}
{
  const t = 'Section 4 of the Widget Act (15 U.S.C. 2601) is amended by adding at the end the following new subsection.';
  const as = extractAmendments(t, extractCitations(t));
  ok('detects add-at-end', as[0]?.ops.some((o) => o.type === 'add-at-end'));
}
{
  const t = 'Section 9 of the Gadget Act (15 U.S.C. 2609) is repealed.';
  const as = extractAmendments(t, extractCitations(t));
  ok('detects repeal', as[0]?.ops.some((o) => o.type === 'repeal'), JSON.stringify(as[0]?.ops));
}
{
  const t = 'Section 3 (15 U.S.C. 2603) is amended by redesignating subsection (b) as subsection (c).';
  const as = extractAmendments(t, extractCitations(t));
  ok('detects redesignation', as[0]?.ops.some((o) => o.type === 'redesignate'), JSON.stringify(as[0]?.ops));
}
{
  // A run-in heading butts the target straight up against ".--", with no space
  // for a sentence boundary to appear in. This is the ordinary shape in modern
  // bills, and going unmatched hid most of what a bill was doing.
  const t = "(a) Registration.--Section 5330 of title 31, United States Code, is amended by striking ``money'' and inserting ``digital''.";
  const as = extractAmendments(t, extractCitations(t));
  eq('run-in heading still yields an amendment', as.length, 1);
  eq('  target section', as[0]?.target?.section, '5330');
}
{
  // A whole Act is a legitimate target — it is how a bill *adds* a section
  // rather than editing one.
  const t = 'The Securities Act of 1933 (15 U.S.C. 77a et seq.) is amended by inserting after section 4A (15 U.S.C. 77d-1) the following:';
  const as = extractAmendments(t, extractCitations(t));
  eq('Act-level amendment is found', as.length, 1);
  ok('  keeps the Act as the unit', /Securities Act of 1933/.test(as[0]?.unit || ''), as[0]?.unit);
}
{
  // The span between target and verb must not cross a run-in heading: doing so
  // paired "is amended" with a citation from the sentence before and reported
  // the wrong provision as the one being changed.
  const t = "See section 4(g) of the Widget Act (15 U.S.C. 78ddd(g)). (b) Authority.--Section 28 of the Securities Act of 1933 (15 U.S.C. 77z-3) is amended by striking ``a''.";
  const as = extractAmendments(t, extractCitations(t));
  eq('one amendment, not a straddle', as.length, 1);
  eq('  anchors on the nearer target', as[0]?.target?.section, '77z-3');
}

// ------------------------------------------------- relative navigation refs
section('relative navigation inside amendments');
{
  // Real shape from a live bill: nested instructions that address the target by
  // position. "clause (iv)" is only meaningful composed with "paragraph (3)(B)"
  // above it and the amendment's own target above that.
  const t =
    'Section 40007(a) of the Widget Act (49 U.S.C. 44504(a)) is amended—\n' +
    '    (1) in paragraph (3)(B)—\n' +
    "        (A) in clause (iv), by inserting ``and sustainable aviation fuel'' after ``diesel-equivalent fuel'';\n" +
    "        (B) in clause (v), by striking ``old'';\n" +
    '    (2) in paragraph (4), by adding at the end the following:\n';

  const raw = extractCitations(t);
  const ams = extractAmendments(t, raw);
  eq('finds the amendment', ams.length, 1);

  const steps = ams[0]?.steps || [];
  eq('finds every navigation step', steps.length, 4);
  eq('  paragraph (3)(B) composes onto the target path', steps[0]?.path, '(a)(3)(B)');
  eq('  clause (iv) nests under it', steps[1]?.path, '(a)(3)(B)(iv)');
  eq('  clause (v) is a sibling, not a child', steps[2]?.path, '(a)(3)(B)(v)');
  eq('  paragraph (4) pops back to the outer level', steps[3]?.path, '(a)(4)');

  const cites = expandRelativeRefs(raw, ams);
  const rel = cites.filter((c) => c.relative);
  eq('every step becomes a citation', rel.length, 4);
  eq('  they inherit the target title', rel[0].title, '49');
  eq('  and the target section', rel[0].section, '44504');
  ok('  they are resolvable kinds', rel.every((c) => c.kind === 'usc'));
  ok('  offsets land on the reference text',
     rel.every((c) => t.slice(c.start, c.end) === c.text), JSON.stringify(rel.map((c) => c.text)));
  ok('  the chip text is the reference itself', rel[0].text.startsWith('paragraph (3)(B)'), rel[0].text);

  // The whole point: these must no longer be inert "internal" refs.
  const inert = cites.filter((c) => c.kind === 'internal' && /paragraph|clause/i.test(c.text));
  eq('no inert internal refs remain over those spans', inert.length, 0);
}
{
  // Outline styles vary; depth must come from the outline's own ordering.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    '    (a) in subsection (b)—\n' +
    '        (1) in paragraph (2)—\n' +
    "            (A) in subparagraph (C), by striking ``x'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  const paths = (ams[0]?.steps || []).map((s) => s.path);
  eq('(a)/(1)/(A) outline nests correctly', paths.join(' '), '(b) (b)(2) (b)(2)(C)');
}
{
  // A division heading ends the section above it.
  //
  // Only a following SECTION used to close one, so the last section of every
  // division ran on through the heading that ended it. Pub. L. 117-58 § 905
  // finished with "…may be cited as the ``Infrastructure Investments and Jobs
  // Appropriations Act''. DIVISION K-- MINORITY BUSINESS DEVELOPMENT" and the
  // pane showed that to the reader as part of § 905. 352 of the 19,612 section
  // entries in data/plaw, and no metric could see it — a section's `end` is not
  // counted by anything, which is why it survived. Found by looking at the pane.
  const t =
    '                   DIVISION A--FIRST DIVISION\n\n' +
    'SEC. 101. LAST SECTION OF THE DIVISION.\n' +
    '    This is the operative text of section 101.\n\n' +
    '                   DIVISION B--SECOND DIVISION\n\n' +
    'SEC. 201. FIRST SECTION OF THE NEXT.\n' +
    '    This is the operative text of section 201.\n';
  const bill = parseBill(t);
  const s101 = bill.sections.find((s) => s.num === '101');
  const body = t.slice(s101.start, s101.end);
  ok('a section ends where the next division begins', !/DIVISION B/.test(body),
     JSON.stringify(body.slice(-70)));
  ok('  keeping its own text whole', /operative text of section 101/.test(body), body);
  // And the section after the heading is unaffected — the close must not also
  // swallow the division it ends at.
  eq('  and both divisions are still seen', bill.divisions.length, 2);
  eq('  and both sections', bill.sections.length, 2);
  // A table of contents legitimately LISTS division headings, and the inToc
  // guard means those are not real divisions — so it must not be split there.
  // What follows each one here is another LISTING ("Sec. 101. …" flush left,
  // sentence case), not a real body, which is exactly what realBodyFollows()
  // asks. Get that wrong and the table is cut into pieces at every division it
  // names.
  const toc =
    'SEC. 2. TABLE OF CONTENTS.\n' +
    '    The table of contents for this Act is as follows:\n' +
    'Sec. 1. Short title.\n\n' +
    '                   DIVISION A--LIMIT FEDERAL SPENDING\n\n' +
    'Sec. 101. Discretionary spending limits.\n' +
    'Sec. 102. Special adjustments.\n\n' +
    '                   DIVISION B--SAVE TAXPAYER DOLLARS\n\n' +
    'Sec. 201. Rescission of unobligated funds.\n';
  const tb = parseBill(toc);
  const s2 = tb.sections.find((s) => s.num === '2');
  const tocBody = toc.slice(s2.start, s2.end);
  ok('a table of contents still lists the divisions it names',
     /DIVISION A/.test(tocBody) && /DIVISION B/.test(tocBody),
     JSON.stringify(tocBody.slice(0, 90)));
  eq('  and none of them is read as a real division', tb.divisions.length, 0);

  // …but a bill that merely MENTIONS a table of contents is not opening one.
  // A clerical amendment in the middle of the Consolidated Appropriations Act,
  // 2020 set `inToc` and nothing ever cleared it — `realBodyFollows` says no in
  // an appropriations division, where the next non-caps line is a lowercase
  // account heading — so RE_SECTION_LOOSE was gated off for the remaining
  // 684 KB and 338 of that bill's 897 sections vanished. Worse than missing:
  // sectionAt() then answered for a paragraph with a section 205 KB earlier,
  // so every "section N of this Act" in that stretch resolved against it.
  //
  // No phrasing test can separate the two — the announce wraps the measure, so
  // its head is all one line carries, and the clerical amendment wraps onto a
  // line beginning with the identical words. What separates them is what comes
  // next: a table is a listing.
  const clerical = parseBill(
    'SEC. 1. SHORT TITLE.\n' +
    '    This Act may be cited as the ``Test Act\'\'.\n' +
    'SEC. 2. AMENDMENT.\n' +
    '    Section 4 of that Act is amended, and (2) in\n' +
    'the table of contents of that Act, by striking the part heading for\n' +
    'part B of title IV and inserting the following:\n' +
    '\n' +
    '    Sec. 101. Notwithstanding any other provision of law, funds are\n' +
    'appropriated for salaries.\n'
  );
  ok('a clerical amendment does not open a table of contents',
     clerical.sections.some((s) => s.num === '101'),
     JSON.stringify(clerical.sections.map((s) => s.num)));
  // The control, and it must stay: the same phrase followed by real entries
  // still opens the table, or this trades 338 sections for a bill whose whole
  // contents listing is read as sections.
  const announced = parseBill(
    'SEC. 1. SHORT TITLE.\n' +
    '    This Act may be cited as the ``Test Act\'\'.\n' +
    'SEC. 2. TABLE OF CONTENTS.\n' +
    '    The table of contents for this Act is as follows:\n' +
    'Sec. 1. Short title.\n' +
    'Sec. 2. Table of contents.\n' +
    '    Sec. 101. Notwithstanding any other provision of law, funds are\n' +
    'appropriated for salaries.\n'
  );
  ok('  while a real announcement still does',
     !announced.sections.some((s) => s.num === '101'),
     JSON.stringify(announced.sections.map((s) => s.num)));
}
{
  // ---- (cc) is the alphabet past (z), not two hundred ----------------------
  //
  // markerDepth() tested /^[ivxlc]{2,}$/ before /^[a-z]{2}$/, so (cc), (ll) and
  // (vv) read as roman numerals at clause depth. An added block led by (dd) was
  // therefore scoped one level too shallow and drawn INSIDE item (cc) of
  // 42 U.S.C. 1395w-102(b)(4)(C)(iii)(I), where the shard has them as siblings.
  //
  // The discrimination is data, not taste: over all 705,678 shipped Code nodes
  // (cc) appears 639 times, 594 of them at item depth and once as a clause,
  // while (ii) is a clause 30,903 times of 32,809 — so i and x keep the roman
  // reading and must not be touched.
  const { markerDepth } = await imp('app/resolve/internal.js');
  eq('(cc) is an item, not roman two hundred', markerDepth('(cc)'), 5);
  eq('(ll) is an item — it is not a roman numeral at all', markerDepth('(ll)'), 5);
  eq('(vv) likewise', markerDepth('(vv)'), 5);
  eq('(CC) is a subitem', markerDepth('(CC)'), 6);
  // The genuinely ambiguous ones, which the data says to leave alone.
  eq('(ii) stays a clause', markerDepth('(ii)'), 3);
  eq('(II) stays a subclause', markerDepth('(II)'), 4);
  eq('(xx) stays a clause', markerDepth('(xx)'), 3);
  eq('(iv) stays a clause — a mixed form is unambiguous', markerDepth('(iv)'), 3);
  // A single letter is not a run, and (c) and (v) must keep their own readings.
  eq('(c) is still a subsection', markerDepth('(c)'), 0);
  eq('(v) is still a clause', markerDepth('(v)'), 3);
  // A run of THREE is the alphabet overflowing a second time — 42 U.S.C. 1395x
  // numbers its SUBSECTIONS (a)…(z), (aa)…(zz), (aaa)…(mmm) — so it can sit at
  // any depth and moving it would be a different guess, not a better one. It
  // falls through to the default, which is where it has always fallen.
  eq('(mmm) is left where it was', markerDepth('(mmm)'), 2);
}
{
  // "Section 55301 of title 46 … is redesignated as section 55123 of such
  // title" says exactly what it does, and the pane said nothing at all: `verb`
  // recorded "redesignated", no op was ever emitted, and attachEffect() returns
  // early on `!ops.length`. 13 of the corpus's 17, all silent.
  const t = 'Section 55301 of title 46, United States Code, is redesignated as section 55123 of such title.\n';
  const ams = extractAmendments(t, extractCitations(t));
  const rd = (ams[0]?.ops || []).filter((o) => o.type === 'redesignate');
  eq('a whole-section redesignation produces an operation', rd.length, 1);
  eq('  naming what it was', rd[0]?.from, 'Section 55301');
  eq('  and what it becomes', rd[0]?.to, 'section 55123');
  // No span: nothing in the bill is being marked, and a span that did not
  // round-trip to op.text would break the badOpOffsets invariant for nothing.
  eq('  and claiming no span in the bill', rd[0]?.start, undefined);

  // The destination keeps a subsection and a dashed number, because dropping
  // either names a different provision. Both are real: "redesignated as section
  // 2534(a) of title 14" and "as section 399V-1".
  const t2 = 'Section 3 of the Act (33 U.S.C. 773), is redesignated as section 2534(a) of title 14, United States Code.\n';
  const r2 = (extractAmendments(t2, extractCitations(t2))[0]?.ops || [])
    .find((o) => o.type === 'redesignate');
  eq('a redesignation into a subsection keeps it', r2?.to, 'section 2534(a)');
  const t3 = 'Section 399W of the Public Health Service Act is redesignated as section 399V-1.\n';
  const r3 = (extractAmendments(t3, extractCitations(t3))[0]?.ops || [])
    .find((o) => o.type === 'redesignate');
  eq('  and a dashed section number survives', r3?.to, 'section 399V-1');

  // "is transferred to section X" is a different operation and is declined
  // rather than guessed at — 4 of the 17 are this shape.
  const t4 = 'Subsection (a) of section 2305 of title 10, United States Code, is transferred to section 3241 and redesignated as subsection (b).\n';
  const r4 = (extractAmendments(t4, extractCitations(t4))[0]?.ops || [])
    .filter((o) => o.type === 'redesignate' && o.start == null);
  eq('a transfer is not read as a plain redesignation', r4.length, 0);
}
{
  // A new provision is longer than a phrase, and the operand budget deleted it.
  //
  // Verbatim from the Fiscal Responsibility Act, whose whole substantive change
  // this is — the discretionary caps for fiscal years 2024 and 2025. The block
  // is 430 characters; RE_INSERT allowed 400, and the overflow did not truncate
  // the operand, it failed the match, so the instruction reported ONE operation
  // (a three-character strike) and said nothing about the caps at all.
  const head =
    'Section 251(c) of the Balanced Budget and \nEmergency Deficit Control Act of 1985 (2 U.S.C. 901(c)) is amended--\n' +
    "        (1) in paragraph (7)(B), by striking ``and'' at the end; and\n" +
    '        (2) by inserting after paragraph (8) the following:\n';
  const block =
    '        ``(9) for fiscal year 2024--\n' +
    '            ``(A) for the revised security category, $886,349,000,000 \n        in new budget authority; and\n' +
    '            ``(B) for the revised nonsecurity category; \n        $703,651,000,000 in new budget authority; and\n' +
    '        ``(10) for fiscal year 2025--\n' +
    '            ``(A) for the revised security category, $895,212,000,000 \n        in new budget authority; and\n' +
    "            ``(B) for the revised nonsecurity category; \n        $710,688,000,000 in new budget authority;''.\n";
  const t = head + block;
  const ams = extractAmendments(t, extractCitations(t));
  const ins = (ams[0]?.ops || []).filter((o) => o.type === 'insert');
  eq('an over-budget anchored insert is read whole', ins.length, 1);
  ok('  and carries the block, not the first 400 characters of it',
     ins[0] && ins[0].text.length > 400 && /fiscal year 2025/.test(ins[0].text),
     String(ins[0] && ins[0].text.length));
  eq('  anchored to the unit the bill named', ins[0]?.unitAnchor, '(8)');
  eq('  and placed after it, among its siblings', ins[0]?.scope, '(c)(8)');
  eq('    structurally, not woven into a sentence', ins[0]?.placement, 'after-unit');
  // The offset must still round-trip to the text, or the bill pane marks the
  // wrong run — the badOpOffsets invariant, which a block reader could break.
  eq('  the span round-trips to the language it adds',
     t.slice(ins[0].start, ins[0].end), ins[0].text);
  // A short block is still the generic scan's, and must not be read twice.
  const short =
    'Section 251(c) of the Act (2 U.S.C. 901(c)) is amended by inserting after \n' +
    "paragraph (8) the following: ``(9) for fiscal year 2024, $1.00.''.\n";
  const sAms = extractAmendments(short, extractCitations(short));
  eq('a block inside the budget yields exactly one op',
     (sAms[0]?.ops || []).filter((o) => o.type === 'insert').length, 1);

  // The same budget on the GENERIC scan, where the failure is not a missing op
  // but a WRONG one. The lazy gap tries the first opener, cannot reach the
  // closer within 400 characters, backtracks, and succeeds from a LATER opener
  // — so the span begins in the middle of the new language. Verbatim from
  // H.R. 1892: the panel quoted the new law starting at "(1) the qualified
  // solar electric property expenditures", dropping "the sum of the applicable
  // percentages of" and so reading as 100% of the expenditures.
  // Sized to reproduce the backtrack rather than the total failure: the whole
  // block is 421 characters, so the first opener cannot reach the closer, and
  // the SECOND one can. Before the fix this recorded 368 characters beginning
  // "(1) the qualified…".
  const gen =
    "Section 25D(a) is amended by striking ``the sum of--'' and all that " +
    'follows and inserting ``the sum of the applicable percentages of--\n' +
    '        ``(1) the qualified solar electric property expenditures,\n' +
    '        ``(2) the qualified solar water heating property expenditures,\n' +
    '        ``(3) the qualified fuel cell property expenditures,\n' +
    '        ``(4) the qualified small wind energy property expenditures,\n' +
    '        ``(5) the qualified geothermal heat pump property expenditures,\n' +
    "    which are paid or incurred during such year.''.\n";
  const gIns = (extractAmendments(gen, extractCitations(gen))[0]?.ops || [])
    .filter((o) => o.type === 'insert');
  eq('an over-budget generic insert yields one op', gIns.length, 1);
  ok('  and begins at the first opener after the verb',
     gIns[0] && /^the sum of the/.test(gIns[0].text),
     JSON.stringify(gIns[0] && gIns[0].text.slice(0, 50)));
  eq('  its span still round-trips', gen.slice(gIns[0].start, gIns[0].end), gIns[0].text);
  // And the negative: an ordinary short operand is untouched by any of this.
  const plain = "Section 3 is amended by inserting ``and jets'' after ``planes''.\n";
  const pIns = (extractAmendments(plain, extractCitations(plain))[0]?.ops || [])
    .filter((o) => o.type === 'insert');
  eq('a short operand is read as itself', pIns[0] && pIns[0].text, 'and jets');
}
{
  // The instruction's own head is an address, and everything below it composes
  // against that address. Verbatim from H.R. 3633, which writes the SAME
  // provision out in full four lines earlier — "Section 2(a)(36) of the
  // Investment Company Act of 1940 (15 U.S.C. 80a-2(a)(36))" — so the right
  // answer is not in doubt.
  //
  // The parenthetical here carries no subsection, and the base path was taken
  // from the parenthetical alone. So "(a)" was dropped and paragraph (36)
  // composed as bare "(36)", which addresses nothing in 80a-2 and quietly took
  // every operation under it with it.
  const t =
    'Section 2(a) of the Investment Company Act of 1940 (15 U.S.C. 80a-2) is amended--\n' +
    "    (1) in paragraph (36), by striking ``old'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('the head supplies the base path when the cite has no subsection',
     ams[0]?.steps?.[0]?.path, '(a)(36)');
  eq('  and the operation is scoped to it',
     ams[0]?.ops?.find((o) => o.type === 'strike')?.scope, '(a)(36)');

  // The codified subsection still wins where the citation states one, because
  // the two numberings really do diverge: 12 U.S.C. 375 IS section 22(d) of the
  // Federal Reserve Act, so the Act's own "(d)" names nothing in the section.
  const t2 =
    'Section 22(d)(3) of the Federal Reserve Act (12 U.S.C. 375(9)) is amended--\n' +
    "    (1) in paragraph (1), by striking ``old'';\n";
  const ams2 = extractAmendments(t2, extractCitations(t2));
  eq('the codified subsection wins over the Act-relative one',
     ams2[0]?.steps?.[0]?.path, '(9)(1)');
}
{
  // An instruction that never navigates still states where it is working, and
  // the operation belongs there. "Subsection (g) of section 6695" searched the
  // WHOLE of section 6695 — every subsection the instruction had just said it
  // was not talking about. 813 operations across the corpus.
  const t = "Subsection (g) of section 6695 is amended by striking ``old''.\n";
  const ams = extractAmendments(t, extractCitations(t));
  const op = ams[0]?.ops?.find((o) => o.type === 'strike');
  eq('an instruction with no navigation still scopes to its own head', op?.scope, '(g)');
  ok('  and the scope is marked as coming from the head', op?.scopeFromHead === true,
     String(op?.scopeFromHead));

  // The unit named FIRST is the innermost, so its marker goes on the END of the
  // section's own path — the same rule the unit-phrase citation follows.
  // "Subparagraph (B) of section 280F(d)(7)" is 280F(d)(7)(B), and it was being
  // composed as 280F(B)(d)(7). 208 amendments across the corpus.
  const t2 = "Subparagraph (B) of section 280F(d)(7) is amended by striking ``old''.\n";
  const ams2 = extractAmendments(t2, extractCitations(t2));
  eq('the inner unit goes on the end of the path, not the front',
     ams2[0]?.subsection, '(d)(7)(B)');
}
{
  // …and the head's path is used where it EXTENDS the parenthetical's rather
  // than diverging from it. The codified subsection wins outright (above), which
  // dropped the inner unit whenever the parenthetical stated anything at all:
  // "Paragraph (3) of section 3111(f) is amended by striking ``the credit''"
  // scoped to (f) and struck those words in the chapeau of § 3111, a provision
  // the instruction had just said it was not talking about. 222 heads extend the
  // parenthetical against 22 that genuinely diverge.
  const ext =
    'Subparagraph (B) of section 280F(d)(7) of the Internal Revenue Code of 1986\n' +
    "(26 U.S.C. 280F(d)(7)) is amended by striking ``old''.\n";
  const a1 = extractAmendments(ext, extractCitations(ext))[0];
  eq('the head extends the parenthetical, so the longer path is the scope',
     a1?.ops?.find((o) => o.type === 'strike')?.scope, '(d)(7)(B)');

  // Both guards, and each was wrong first. A DIVERGENT head is still refused —
  // 12 U.S.C. 375 IS section 22(d) of the Federal Reserve Act, so the Act's own
  // (d) names nothing in the codified section.
  const div =
    "Section 22(d) of the Federal Reserve Act (12 U.S.C. 375(9)) is amended by striking ``old''.\n";
  const a2 = extractAmendments(div, extractCitations(div))[0];
  eq('a divergent head loses to the parenthetical',
     a2?.ops?.find((o) => o.type === 'strike')?.scope, '(9)');

  // …and so is the mirror case, where the PARENTHETICAL is the longer of the
  // two. The prefix test is directional on purpose: only the head may extend.
  const rev =
    "Section 472(c) of the Social Security Act (42 U.S.C. 672(c)(1)) is amended by striking ``old''.\n";
  const a3 = extractAmendments(rev, extractCitations(rev))[0];
  eq('a longer parenthetical is not shortened to the head',
     a3?.ops?.find((o) => o.type === 'strike')?.scope, '(c)(1)');

  // The steps below the head compose against the longer path too, which is the
  // half that moves what the reader is shown.
  const nav =
    'Paragraph (2) of section 72(p) of the Internal Revenue Code of 1986 (26 U.S.C.\n' +
    "72(p)) is amended--\n    (1) in subparagraph (A), by striking ``old'';\n";
  const a4 = extractAmendments(nav, extractCitations(nav))[0];
  eq('a navigation step composes onto the head-extended base', a4?.steps?.[0]?.path, '(p)(2)(A)');
}
{
  // An anchor the walk has already reached must not be appended to itself.
  // Verbatim from H.R. 2 — the walk ends at clause (i) and the insert anchors on
  // clause (i), so there is nothing to truncate and nothing to add.
  //
  // Two separate faults produced 16 U.S.C. 3839aa-1(6)(B)(i)(i), a level nothing
  // has. Both are about reading a depth off a marker whose style is ambiguous:
  // pathLevels() gave (i) its INDEX (2) where a path starting at paragraph level
  // puts it at 3, and scopeUnitInserts() truncates by the anchor's STYLE depth,
  // which then disagreed with it. Found by auditing what item 49's rule MOVED
  // rather than what it fixed.
  const t =
    'Section 1240A of the Food Security Act of 1985 (16 U.S.C. 3839aa-1) is\n' +
    'amended--\n' +
    '    (1) in paragraph (6)--\n' +
    '        (A) in subparagraph (B)--\n' +
    '            (i) in clause (i), by inserting after clause (i) the following:\n' +
    "        ``(ii) planning for resource-conserving crop rotations.'';\n";
  const am = extractAmendments(t, extractCitations(t))[0];
  const ins = am?.ops?.find((o) => o.placement === 'after-unit');
  eq('an anchor the walk already reached is not appended twice', ins?.scope, '(6)(B)(i)');

  // The depth of an ambiguous marker inside a path is one deeper than the level
  // BEFORE it, not its index — a path is contiguous but need not start at
  // subsection level.
  const t2 =
    'Section 4042(a)(6) of title 18, United States Code, is amended--\n' +
    '    (1) in clause (i), by inserting after clause (i) the following:\n' +
    "        ``(ii) a second thing.'';\n";
  const am2 = extractAmendments(t2, extractCitations(t2))[0];
  const ins2 = am2?.ops?.find((o) => o.placement === 'after-unit');
  eq('  and the same holds for a path rooted at a paragraph', ins2?.scope, '(a)(6)(i)');
}
{
  // A heading rewrite renames a provision; it does not replace a word of its
  // text. Read from the INSTRUCTION, because 11 of the 46 blocks are a bare
  // caption carrying no "SEC. N." and no "PART X--" — no test of the block's
  // shape can see those.
  const head =
    'Section 908 of title 37, United States Code, is amended--\n' +
    '    (1) Section heading.--The heading of such section is amended to read as\n' +
    "follows:\n        ``Sec. 908. Reserves and retired members: acceptance of employment.''.\n";
  const a = extractAmendments(head, extractCitations(head))[0];
  const rep = a?.ops?.find((o) => o.type === 'replace');
  ok('a heading rewrite is flagged as one', rep?.headingOnly === true, JSON.stringify(rep));

  // A bare caption, which is the half no block-shape guard can reach.
  const bare =
    'Section 118 of title 10, United States Code, is amended--\n' +
    '    (1) by amending the section heading to read as follows:\n' +
    "        ``Materiel readiness metrics and objectives for major weapon systems''.\n";
  const b = extractAmendments(bare, extractCitations(bare))[0];
  ok('  including one with no section head in the block at all',
     b?.ops?.find((o) => o.type === 'replace')?.headingOnly === true);

  // The sentence boundary is load-bearing: a heading amended in an EARLIER
  // sentence must not silence the rewrite that follows it.
  const apart =
    'Section 100 of title 5, United States Code, is amended by amending the\n' +
    'heading. Subsection (a) of such section is amended to read as follows:\n' +
    "        ``(a) The Director shall report annually.''.\n";
  const c = extractAmendments(apart, extractCitations(apart))[0];
  ok('  and a heading amended in a previous sentence does not silence this one',
     c?.ops?.find((o) => o.type === 'replace')?.headingOnly !== true);

  // An ordinary rewrite is untouched.
  const plain = "Paragraph (2) of section 72(p) is amended to read as follows:\n``(2) New text.''.\n";
  const d = extractAmendments(plain, extractCitations(plain))[0];
  ok('  while an ordinary provision rewrite is not flagged',
     d?.ops?.find((o) => o.type === 'replace')?.headingOnly !== true);
}
{
  // Stepping back UP the hierarchy. A subsection cannot live inside a
  // subparagraph, so a later "subsection (c)" must truncate the running path,
  // not extend it. Appending blindly produced 5 U.S.C. 801(a)(2)(A)(c).
  const t =
    'Section 801(a)(2)(A) of title 5, United States Code, is amended—\n' +
    "    (1) in clause (i), by striking ``x'';\n" +
    "    (2) in subsection (c), by striking ``y'';\n" +
    "    (3) in paragraph (4), by striking ``z'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  const paths = (ams[0]?.steps || []).map((s) => s.path);
  eq('clause descends from the target path', paths[0], '(a)(2)(A)(i)');
  eq('subsection resets to the top level', paths[1], '(c)');
  eq('paragraph attaches under that subsection', paths[2], '(c)(4)');
}
{
  // Depth comes from the unit word, not the bill's own outline numbering, so a
  // flat run of sibling steps must not accumulate.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    "    (1) in paragraph (1), by striking ``a'';\n" +
    "    (2) in paragraph (2), by striking ``b'';\n" +
    "    (3) in paragraph (3), by striking ``c'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('sibling steps stay siblings',
     (ams[0]?.steps || []).map((s) => s.path).join(' '), '(1) (2) (3)');
}
{
  // Inside-out drafting order: the phrase states its own ancestors after itself.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    "    (1) in subparagraph (C) of paragraph (2) of subsection (a), by striking ``x'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('"X of Y of Z" composes outermost-first', (ams[0]?.steps || [])[0]?.path, '(a)(2)(C)');
}
{
  // A multi-level path in one phrase is a descent, not a list.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    "    (1) in subsection (a)(2)(C), by striking ``x'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('a bare multi-marker path stays whole', (ams[0]?.steps || [])[0]?.path, '(a)(2)(C)');
}
{
  // Lists and ranges name several provisions; dropping all but the first hides
  // most of what the instruction touches.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    "    (1) in subparagraphs (A) and (B), by striking ``x'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('a list yields one address per item',
     [...(ams[0]?.steps || []), ...(ams[0]?.refs || [])].map((s) => s.path).join(' '),
     '(A) (B)');
  // …but only the FIRST is a step. `scopeOps()` binds an op to the last step
  // before it, so a list put the op on its last member — "in subsections (a)
  // through (i), by striking ``X'' each place it appears" scoped to (i), nine
  // subsections named and the one marked furthest from the cursor the same
  // line had just set. 93 across the corpus. The rest are addresses worth a
  // chip and nothing more, which is what a ref is.
  eq('  but only the first of them steers the walk',
     (ams[0]?.steps || []).map((s) => s.path).join(' '), '(A)');
  eq('  and the rest are plain references',
     (ams[0]?.refs || []).map((s) => s.path).join(' '), '(B)');
  // Their paths stay on the step, because the bill named all of them and an
  // operation scoped to one of nine subsections marks one of nine. `scope`
  // stays the first — every other consumer reads it as a string — and `scopes`
  // carries the list for redline.js, which is the one that can use it.
  eq('  and the step remembers the members it named',
     ((ams[0]?.steps || [])[0] || {}).also?.join(' '), '(B)');
  eq('  which reaches the operations as a list',
     (ams[0]?.ops || []).map((o) => (o.scopes || [o.scope]).join('+')).join(' '), '(A)+(B)');
  eq('    with scope still the first member, for every other consumer',
     (ams[0]?.ops || []).map((o) => o.scope).join(' '), '(A)');
}
{
  // The user's case: clause references that are operands or positions, not
  // descents. They must resolve against the cursor without moving it.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    '    (2) in subsection (b)(3)—\n' +
    '        (A) in subparagraph (A)—\n' +
    '            (i) by indenting the margins of clauses (i) through (iii) appropriately;\n' +
    '            (ii) by redesignating clauses (ii) and (iii) as clauses (iii) and (iv), respectively; and\n' +
    '            (iii) by inserting after clause (i) the following:\n';
  const ams = extractAmendments(t, extractCitations(t));
  const steps = ams[0]?.steps || [];
  const refs = ams[0]?.refs || [];

  eq('navigation descends to the subparagraph',
     steps.map((s) => s.path).join(' '), '(b)(3) (b)(3)(A)');
  ok('clause references resolve under it',
     refs.some((r) => r.path === '(b)(3)(A)(i)'), JSON.stringify(refs.map((r) => r.path)));
  ok('  and the range end too',
     refs.some((r) => r.path === '(b)(3)(A)(iii)'), JSON.stringify(refs.map((r) => r.path)));
  ok('references never move the cursor',
     steps.every((s) => s.path.startsWith('(b)(3)')), JSON.stringify(steps.map((s) => s.path)));

  const rel = expandRelativeRefs(extractCitations(t), ams).filter((c) => c.relative);
  ok('clause (i) becomes a resolvable citation',
     rel.some((c) => c.subsection === '(b)(3)(A)(i)' && c.section === '2605'),
     JSON.stringify(rel.map((c) => c.subsection)));

  // The CFR branch of the same code. expandRelativeRefs admits `cfr` targets as
  // well as `usc` ones — `t.kind !== 'usc' && t.kind !== 'cfr'` — and every test
  // until now used a U.S. Code target, so half that condition had never run.
  //
  // Driven from a synthetic amendment rather than from bill text, because there
  // is no bill text that reaches it: across the 34 MB corpus exactly one
  // "is amended" has a CFR reference anywhere near it, and that one is an
  // Organic Foods Production Act instruction that merely mentions a regulation.
  // Bills amend statutes; agencies amend regulations. The branch is kept
  // because a citation to a reg is perfectly resolvable and costs one clause —
  // but it is exercised here, not pretended into a fixture.
  const cfrTarget = {
    kind: 'cfr', title: '40', part: '60', section: '60.13', subsection: '',
    text: '40 CFR 60.13',
  };
  const relC = expandRelativeRefs(
    [{ kind: 'internal', id: 'i0', start: 0, end: 5, text: 'dummy' }],
    [{
      id: 'a0', target: cfrTarget,
      steps: [{ text: 'paragraph (2)', start: 100, end: 113, path: '(e)(2)', unit: 'paragraph', markers: ['(2)'] }],
      refs: [],
    }]
  ).filter((c) => c.relative);
  eq('a relative address composes against a CFR target', relC.length, 1);
  eq('  keeping the CFR kind', relC[0].kind, 'cfr');
  eq('  its title, not a U.S. Code one', relC[0].title, '40');
  eq('  its section', relC[0].section, '60.13');
  eq('  and the composed path', relC[0].subsection, '(e)(2)');
  ok('  with a relative id, like every composed address',
     String(relC[0].id).startsWith('r'), String(relC[0].id));
  ok('  marked as derived rather than written down', relC[0].relative === true);
}
{
  // ---- navigation into a different SECTION --------------------------------
  //
  // "in section 293 (42 U.S.C. 293)--" is a step, and UNIT_WORDS has no
  // "section" — a section is not a level within a provision — so RE_NAV could
  // not fire and every later address composed onto the amendment's own target.
  // 276 composed addresses across the corpus named the wrong section, and 289
  // operations were scoped to a path in a provision the pane never shows.
  const secNav = (body) => {
    const t = normalizeText(
      'The Widget Act (15 U.S.C. 2601 et seq.) is amended--\n' + body
    );
    const ams = extractAmendments(t, extractCitations(t));
    return {
      ops: ams[0].ops,
      rel: expandRelativeRefs(extractCitations(t), ams).filter((c) => c.relative),
    };
  };

  const moved = secNav(
    '    (1) in section 4 (15 U.S.C. 2603)--\n' +
    "        (A) in subsection (a), by striking ``old'';\n"
  );
  const ma = moved.rel.find((c) => c.subsection === '(a)');
  ok('a step into another section retargets the addresses after it',
     ma && ma.section === '2603', JSON.stringify(moved.rel.map((c) => `${c.section}${c.subsection}`)));
  eq('  and says so, rather than looking written down', ma && ma.viaSection, '15 U.S.C. 2603');
  // The whole point of the operation half: the pane resolves the TARGET and
  // draws every op on it, so a strike scoped to (a) of another section went
  // looking for those words in 2601(a) — a real provision, about something
  // else. Every one of the 13 marks this withdrew was in the Act's own first
  // section, which the instruction does not mention.
  eq('  the operation is refused, naming the section it belongs to',
     moved.ops.find((o) => o.type === 'strike').otherSection, '15 U.S.C. 2603');

  // A note is not the section it is printed under — item 14's rule, arriving in
  // a new place. 22 of the corpus's 215 such phrases write one.
  const note = secNav(
    '    (1) in section 4 (15 U.S.C. 2603 note)--\n' +
    "        (A) in subsection (a), by striking ``old'';\n"
  );
  // Bounded on both sides: "every address stayed put" is vacuously true of no
  // addresses at all, which is how a fixture comes to cover nothing.
  ok('a note parenthetical does not move the walk',
     note.rel.length > 0 && note.rel.every((c) => c.section === '2601'),
     JSON.stringify(note.rel.map((c) => `${c.section}${c.subsection}`)));
  ok('  and its operation stays where it was',
     !note.ops.some((o) => o.otherSection),
     JSON.stringify(note.ops.map((o) => o.otherSection)));

  // It must OPEN a sub-instruction. A bare mention — "as defined in section 4
  // (15 U.S.C. 2603) of that Act" — is 293 further sites across the corpus and
  // most are not navigation at all.
  const mention = secNav(
    "    (1) in subsection (b), by striking ``a term defined in section 4 " +
    "(15 U.S.C. 2603) of the Act'';\n"
  );
  ok('a mention of a section is not navigation',
     mention.ops.some((o) => o.type === 'strike') && !mention.ops.some((o) => o.otherSection),
     JSON.stringify(mention.ops.map((o) => `${o.type}:${o.otherSection}`)));

  // The codified path in the parenthetical RESETS the cursor, so a following
  // step composes under it.
  const under = secNav(
    '    (1) in section 4 (15 U.S.C. 2603(a))--\n' +
    "        (A) in paragraph (2), by striking ``old'';\n"
  );
  eq('  the codified path resets the cursor',
     under.ops.find((o) => o.type === 'strike').scope, '(a)(2)');

  // Where the section named IS the target, nothing has moved and nothing may be
  // refused. 10 of the corpus's 215 phrases spell out an address the head had
  // already given.
  const same = normalizeText(
    'Section 4 of the Widget Act (15 U.S.C. 2603) is amended--\n' +
    '    (1) in section 4 (15 U.S.C. 2603)--\n' +
    "        (A) in subsection (a), by striking ``old'';\n"
  );
  const sameOps = extractAmendments(same, extractCitations(same))[0].ops;
  ok('a step back into the target section is not refused',
     sameOps.some((o) => o.type === 'strike') && !sameOps.some((o) => o.otherSection),
     JSON.stringify(sameOps.map((o) => o.otherSection)));
}
{
  // ---- an instruction stops at the end of its own bill section -------------
  //
  // The body was bounded at the next amendment head or 2,500 characters,
  // whichever came first, and never at the bill's own section heading. A
  // section whose first amendment sits a paragraph below its heading therefore
  // leaves the previous body running straight through into it: the Inflation
  // Reduction Act's SEC. 13101 ran 543 characters into SEC. 13102 and composed
  // seven chips about 26 U.S.C. 48 onto 26 U.S.C. 45, where (c)(1)(D) reads
  // "geothermal energy," rather than the linear-generator definition the bill
  // is talking about. Both sections exist, which is what makes this the worst
  // category rather than a blank.
  const t = normalizeText(
    'SEC. 101. FIRST.\n' +
    '    Section 2 of the Widget Act (15 U.S.C. 2601) is amended in subsection (a) ' +
    "by striking ``old''.\n" +
    '\n' +
    'SEC. 102. SECOND.\n' +
    "    (a) In general.--The following are each amended by striking ``x'':\n" +
    '        (1) Subsection (b)(3).\n' +
    "        (2) Paragraph (c)(4), by striking ``y''.\n"
  );
  const bill = parseBill(t);
  const cites = extractCitations(t);
  const loose = extractAmendments(t, cites, bill.divisions);
  const tight = extractAmendments(t, cites, bill.divisions, bill.sections);
  const edge = bill.sections.find((s) => s.num === '101').end;
  ok('without the sections the body runs past the section heading',
     loose[0].end > edge, `${loose[0].end} vs ${edge}`);
  eq('with them it stops at the heading', tight[0].end, edge);
  // Bounded on both sides. "Nothing past the edge" is vacuously true of an
  // instruction that reached nothing at all, so assert the loose parse really
  // did compose the wrong addresses and the tight one really does compose the
  // right one.
  const rel = (ams) =>
    expandRelativeRefs(cites, ams).filter((c) => c.relative).map((c) => c.subsection);
  ok('  and the addresses from the next section go with it',
     rel(loose).includes('(b)(3)') && !rel(tight).includes('(b)(3)'),
     `${JSON.stringify(rel(loose))} -> ${JSON.stringify(rel(tight))}`);
  ok('  while its own address is untouched',
     rel(tight).length > 0 && tight[0].ops.some((o) => o.scope === '(a)'),
     JSON.stringify(tight[0].ops.map((o) => `${o.type}:${o.scope}`)));
  // A head that sits in no parsed section keeps the old, looser bound. That is
  // the trap the measurement had to work around: parseBill misses a run-in
  // appropriations head written as a bare "Sec. 401." line, and attributing by
  // position rather than containment overcounts wherever it does.
  const noSecs = extractAmendments(t, cites, bill.divisions, []);
  eq('a bill with no parsed sections is bounded as before', noSecs[0].end, loose[0].end);
}
{
  // ---- …and the budget counts TEXT, not source ----------------------------
  //
  // A bill hard-wraps at ~72 columns and INDENTS its continuation lines, so a
  // sub-instruction nested four deep carries 24 spaces on every line and a
  // budget in source characters bought half as much of it as of a flush one —
  // backwards, since the deeply nested instruction is the one with the most
  // sub-parts. The corpus holds the House-passed CLARITY Act in both a typeset
  // print and govinfo plain text, and they disagreed: 8 redesignations from the
  // print against 6 from the text, 74 inserts against 72.
  //
  // Here the two typographies are written out directly, which is that
  // differential in miniature: whatever the parser makes of one it must make of
  // the other. Note the govinfo quote convention lives in DOUBLE-quoted JS
  // strings — in a single-quoted one the '' closes the literal early, and in a
  // template literal the `` closes the template.
  const subs = (indent, n) =>
    Array.from({ length: n }, (_, i) =>
      indent + '(' + (i + 1) + ') in paragraph (' + (i + 1) +
      "), by striking ``old" + i + "'' and inserting ``new" + i + "'';"
    ).join('\n');
  const head = 'SEC. 1. TEST.\n    Section 2 of the Widget Act (15 U.S.C. 2601) is amended--\n';
  const mk = (indent, n) => {
    const t2 = normalizeText(head + subs(indent, n) + '\n');
    const b2 = parseBill(t2);
    return extractAmendments(t2, extractCitations(t2), b2.divisions, b2.sections);
  };
  // 35 pairs: ~2,240 characters flush and ~2,800 indented, so the old budget
  // reached the end of one and not of the other.
  const flush = mk('', 35);
  const deep = mk('                ', 35);
  eq('the flush instruction parses every sub-instruction', opCounts(flush).strike, 35);
  eq('  and the same instruction indented parses identically',
     JSON.stringify(opCounts(deep)), JSON.stringify(opCounts(flush)));
}
{
  // ---- …and it never stops between a strike and its replacement -----------
  //
  // Wherever the bound falls it falls inside some sub-instruction, and
  // "by striking ``X'' and inserting ``Y''" is one act. Cut between its halves,
  // the strike is drawn with nothing beside it: 33 U.S.C. 3705 took 22
  // strikethroughs through a word the bill is KEEPING — the law already reads
  // "ocean acidification and coastal acidification" — because the budget landed
  // between "each place it appears" and "and inserting". Blank beats wrong, and
  // half a substitution is the wrong half.
  // "each place it appears" between the two halves is what widens the gap
  // enough for the bound to land in it — which is exactly how the real case
  // was written. Without the phrase the cut falls outside the pair and the
  // fixture cannot fail at the thing it is here to cover.
  const subs = Array.from({ length: 40 }, (_, i) =>
    '                (' + (i + 1) + ') in paragraph (' + (i + 1) +
    "), by striking ``alpha" + i + "'' each place it appears and inserting ``beta" + i + "'';"
  ).join('\n');
  const t2 = normalizeText(
    'SEC. 1. TEST.\n    Section 2 of the Widget Act (15 U.S.C. 2601) is amended--\n' + subs + '\n'
  );
  const b2 = parseBill(t2);
  const ams = extractAmendments(t2, extractCitations(t2), b2.divisions, b2.sections);
  const ops = ams[0].ops;
  const strikes = ops.filter((o) => o.type === 'strike').length;
  const inserts = ops.filter((o) => o.type === 'insert').length;
  // Bounded on both sides: the budget must really have truncated this, or the
  // equality below is satisfied by an instruction that was never cut at all.
  ok('the budget truncates a 40-pair instruction', strikes < 40, `${strikes} strikes`);
  eq('  and leaves no strike without the insert that replaces it', strikes, inserts);
}
{
  // ---- …and at the next instruction, even one nothing can target -----------
  //
  // The three bounds above are the next RE_AMEND_HEAD match, 2,500 characters
  // and the bill section. A bill writes plenty of instruction heads none of
  // them recognises, and the previous instruction then claims what they
  // introduce: 26 U.S.C. 72(t)(8) was shown paragraph (13) of section 402 as
  // language this bill adds to it, because the SECOND "adding at the end"
  // phrase inside the body window belonged to the next sentence.
  const t = normalizeText(
    'SEC. 101. BOTH.\n' +
    '    (1) Paragraph (8) of section 72(t) is amended by adding at the end the ' +
    "following new subparagraph:\n``(F) Mine.--This is the first block.''.\n" +
    '        (2) Subsection (c) of such section, as amended by this Act, is further ' +
    "amended by adding at the end the following new paragraph:\n" +
    "``(13) Theirs.--This is the second block.''.\n"
  );
  const bill = parseBill(t);
  const ams = extractAmendments(t, extractCitations(t), bill.divisions, bill.sections);
  const blocks = ams[0].ops.filter((o) => o.type === 'add-at-end').map((o) => String(o.text).slice(0, 12));
  eq('an instruction reads its own added block and no other', blocks.join(' | '), '(F) Mine.--T');

  // …and two shapes the head pattern could not cross, both of which left the
  // previous instruction claiming the next one's block. The first is this
  // item's own docstring example as the bill actually writes it — with a RUN-IN
  // HEADING, whose full stop `[^.;]{0,200}?` cannot pass.
  const heads = (second) => {
    const t2 = normalizeText(
      'SEC. 101. BOTH.\n' +
      '    (1) Paragraph (8) of section 72(t) is amended by adding at the end the ' +
      "following new subparagraph:\n``(F) Mine.--This is the first block.''.\n" +
      `        ${second}\n` +
      "``(13) Theirs.--This is the second block.''.\n"
    );
    const b2 = parseBill(t2);
    return extractAmendments(t2, extractCitations(t2), b2.divisions, b2.sections)[0]
      .ops.filter((o) => o.type === 'add-at-end').map((o) => String(o.text).slice(0, 12)).join(' | ');
  };
  eq('a run-in heading does not hide the next instruction',
     heads('(2) Qualified plans.--Subsection (c) of section 402, as amended by this ' +
           'Act, is further amended by adding at the end the following new paragraph:'),
     '(F) Mine.--T');
  eq('  nor does a participial verb chain',
     heads('(2) Section 402 of such title is transferred to chapter 322, redesignated ' +
           'as section 4231, and amended by adding at the end the following new paragraph:'),
     '(F) Mine.--T');
  // …but an anaphor with no address of its own CONTINUES the same provision, and
  // cutting there strands its operations for good. Measured: the widening
  // without this test is 21 right and 13 wrong; with it, 18 and 1.
  eq('  while "such section" with no address of its own does not cut',
     heads('Such section is further amended by adding at the end the following new paragraph:'),
     '(F) Mine.--T | (13) Theirs.');
  // The bound must be the sentence, not the block: everything the FIRST
  // instruction writes still belongs to it.
  ok('  and its own block is whole',
     ams[0].ops.some((o) => String(o.text || '').includes('the first block')),
     JSON.stringify(ams[0].ops.map((o) => o.type)));
  // Inside quoted new law the same words are not a head. Inserted law says
  // "is amended" constantly, and cutting there would end an instruction in the
  // middle of the block it is adding.
  const q = normalizeText(
    'SEC. 101. ONE.\n' +
    '    Section 3 of the Widget Act (15 U.S.C. 2603) is amended by adding at the ' +
    'end the following:\n' +
    '``(d) Rule.--The Secretary shall act. Such provision is amended as the ' +
    'Secretary directs.\n' +
    "``(e) Other.--The rest of the block.''.\n"
  );
  const qbill = parseBill(q);
  const qa = extractAmendments(q, extractCitations(q), qbill.divisions, qbill.sections);
  const quoted = q.indexOf('Such provision is amended');
  ok('a head inside quoted new law does not end the instruction',
     qa[0].end > quoted, `end ${qa[0].end} vs ${quoted}`);
  ok('  so the block is still read whole',
     qa[0].ops.some((o) => String(o.text || '').includes('The rest of the block')),
     JSON.stringify(qa[0].ops.map((o) => `${o.type}:${String(o.text || '').slice(0, 24)}`)));
}
{
  // A cross-reference inside quoted text must not hijack the cursor.
  const t =
    'Section 5 of the Widget Act (15 U.S.C. 2605) is amended—\n' +
    '    (1) in paragraph (7)—\n' +
    "        (A) by inserting ``a projection described in subparagraph (A) of this title'' after ``x'';\n" +
    "        (B) by striking ``y'';\n" +
    '    (2) in paragraph (8), by striking ``z\'\';\n';
  const ams = extractAmendments(t, extractCitations(t));
  const steps = (ams[0]?.steps || []).map((s) => s.path);
  eq('quoted cross-reference does not become navigation', steps.join(' '), '(7) (8)');
}
{
  // The full nested pattern, verbatim in shape from a real bill. Quoted operands
  // must carry absolute offsets so the bill pane can paint the diff.
  const t =
    'Section 40007(a) of the Widget Act (49 U.S.C. 44504(a)) is amended—\n' +
    '    (1) in paragraph (3)(B)—\n' +
    '        (A) in clause (iv), by inserting “and sustainable aviation fuel” after “diesel-equivalent fuel”;\n' +
    '        (B) by redesignating clauses (v) through (vii) as clauses (vi) through (viii), respectively; and\n' +
    '        (C) by inserting after clause (iv) the following:\n' +
    '“(v) biofuel, including sustainable aviation fuel, produced from an intermediate ingredient or feedstock;”; and\n';

  const ams = extractAmendments(t, extractCitations(t));
  const ops = ams[0]?.ops || [];

  const ins = ops.filter((o) => o.type === 'insert');
  ok('captures the inserted phrase',
     ins.some((o) => o.text === 'and sustainable aviation fuel'), JSON.stringify(ins.map((o) => o.text)));
  ok('captures the inserted new clause',
     ins.some((o) => o.text.startsWith('(v) biofuel')), JSON.stringify(ins.map((o) => o.text.slice(0, 20))));
  ok('detects the redesignation', ops.some((o) => o.type === 'redesignate'));

  // Offsets must round-trip, or the bill pane paints the wrong run of text.
  const located = ops.filter((o) => o.start != null);
  ok('quoted operands carry offsets', located.length >= 2, `${located.length} located`);
  ok('  offsets round-trip against the source',
     located.every((o) => t.slice(o.start, o.end) === o.text),
     JSON.stringify(located.map((o) => [o.text.slice(0, 18), t.slice(o.start, o.end).slice(0, 18)])));

  // Navigation still works around the operands.
  eq('navigation reaches the clause',
     (ams[0]?.steps || []).map((s) => s.path).join(' '), '(a)(3)(B) (a)(3)(B)(iv)');
  const refs = ams[0]?.refs || [];
  ok('redesignated clauses resolve', refs.some((r) => r.path === '(a)(3)(B)(v)'),
     JSON.stringify(refs.map((r) => r.path)));
}
{
  // IRC section numbers ARE Code section numbers; other Acts' are not.
  const t = 'section 45K(c)(3) of the Internal Revenue Code of 1986';
  const c = extractCitations(t).find((x) => x.kind === 'usc');
  ok('IRC section resolves into title 26',
     c && c.title === '26' && c.section === '45K' && c.subsection === '(c)(3)',
     c ? `${c.title}/${c.section}${c.subsection}` : 'no usc match');
  ok('  and supersedes the bare Act-name chip',
     !extractCitations(t).some((x) => x.kind === 'act'));
}
{
  // The guard: an Act whose numbering diverges must NOT be resolved this way.
  const t = 'section 1861(s)(2) of the Social Security Act';
  const c = extractCitations(t).find((x) => x.kind === 'usc');
  ok('non-aligned Act is not resolved to a fabricated section', !c,
     c ? `wrongly produced ${c.title}/${c.section}` : '');
}
{
  // "by striking paragraph (3)" is an operand, not a place to descend into.
  const t = 'Section 5 of the Widget Act (15 U.S.C. 2605) is amended by striking paragraph (3).\n';
  const ams = extractAmendments(t, extractCitations(t));
  eq('a struck operand is not treated as navigation', (ams[0]?.steps || []).length, 0);
}
{
  // No resolvable target means no fabricated addresses.
  const t = "Section 12 of the Mystery Act is amended—\n    (1) in paragraph (2), by striking ``x'';\n";
  const raw = extractCitations(t);
  const ams = extractAmendments(t, raw);
  const cites = expandRelativeRefs(raw, ams);
  eq('unresolvable target yields no relative citations', cites.filter((c) => c.relative).length, 0);
}

// --------------------------------------------------------------------- tree
section('subsection tree');
{
  const paras = [
    '(a) In general.—The Secretary shall—',
    '(1) do the first thing;',
    '(2) do the second thing, which includes—',
    '(A) an alpha item;',
    '(B) a bravo item; and',
    '(3) do the third thing.',
    '(b) Exception.—This does not apply.',
  ];
  const tree = buildTree(paras);
  eq('top level count', tree.length, 2);
  eq('  (a) children', tree[0].children.length, 3);
  eq('  (a)(2) children', tree[0].children[1].children.length, 2);
  eq('  deep path', tree[0].children[1].children[0].path, '(a)(2)(A)');
  ok('findNode works', findNode(tree, '(a)(2)(B)')?.text.includes('bravo'));
  eq('pathChain length', pathChain(tree, '(a)(2)(B)').length, 3);
}
{
  // The (h)->(i) letter run must not be misread as roman numeral one.
  const tree = buildTree(['(g) seven;', '(h) eight;', '(i) nine;']);
  eq('(i) after (h) stays a top-level letter', tree.length, 3);
}
{
  // A roman (i) opening under an (A) run must nest, not become a sibling letter.
  const tree = buildTree(['(A) alpha—', '(i) romanone;', '(ii) romantwo;']);
  eq('(i) under (A) nests', tree[0].children.length, 2);
}

// --------------------------------------------------------------- popular names
section('popular names');
ok('Clean Air Act', findAct('Clean Air Act')?.title === '42');
ok('CERCLA alias', findAct('CERCLA')?.section === '9601');
ok('SSA carries a numbering caveat', !!findAct('Social Security Act')?.offsetNote);
ok('National AI Initiative Act', findAct('National Artificial Intelligence Initiative Act of 2020')?.section === '9401');
ok('  and its short alias', findAct('National AI Initiative Act')?.title === '15');
ok('  and it carries a numbering caveat', !!findAct('National AI Initiative Act')?.offsetNote);

// ---------------------------------------------------------- line endings
section('CRLF handling');
{
  // Regression: a trailing \r is a line terminator in JS regex, so it silently
  // killed every `$`-anchored heading match until text was normalised on entry.
  const crlf = 'SEC. 2. TABLE OF CONTENTS.\r\n\r\nSection 4 of the Widget Act (15 U.S.C. 2603) is amended by striking "a".\r\n';
  const HEAD = /^\s*(SECTION|SEC\.)\s+(\d+[A-Za-z]*)\.\s*(.*)$/;

  // The renderer splits on '\n' alone (it must, to keep offsets 1:1 with the
  // source). On un-normalised text that leaves a trailing \r, which defeats the
  // `$` anchor and silently renders no headings at all.
  ok('un-normalised: \\n-split leaves CR that breaks $ anchors',
     !crlf.split('\n').some((l) => HEAD.test(l)));

  const norm = normalizeText(crlf);
  ok('normalised: \\n-split matches the heading',
     norm.split('\n').some((l) => HEAD.test(l)));
  ok('normalizeText strips CR', !norm.includes('\r'));
  const fixed = parseBill(norm);
  eq('normalised text finds the section', fixed.sections.length, 1);
  eq('  heading survives', fixed.sections[0].heading, 'TABLE OF CONTENTS');
  const as = extractAmendments(norm, extractCitations(norm));
  eq('normalised text finds the amendment', as.length, 1);
  eq('lone CR is normalised too', normalizeText('a\rb'), 'a\nb');
}

// ------------------------------------------------------------ share links
section('share links');
{
  const { encodeBill, decodeBill, readSharedBill } = await imp('app/share.js');
  const sharedSamplePath = join(ROOT, 'samples/sample-bill.txt');

  const sample = 'SEC. 2. FIX.\n\nSection 4 of the Widget Act (15 U.S.C. 2601) is amended by striking “a”.\n';
  const payload = await encodeBill(sample);
  eq('round-trips exactly', await decodeBill(payload), sample);
  ok('payload is URL-safe', /^[A-Za-z0-9\-_]+$/.test(payload), payload.slice(0, 40));

  // Unicode must survive: bills are full of curly quotes and em dashes.
  const uni = 'Section 1 is amended by striking “—” and inserting ‘’ — § 45K(c)(3).';
  eq('round-trips unicode', await decodeBill(await encodeBill(uni)), uni);

  eq('reads a bill out of a hash', await readSharedBill(`#t=${payload}`), sample);
  eq('ignores a hash with no bill', await readSharedBill('#other=1'), null);
  eq('ignores an empty hash', await readSharedBill(''), null);

  if (existsSync(sharedSamplePath)) {
    const real = normalizeText(readFileSync(sharedSamplePath, 'utf8'));
    const enc = await encodeBill(real);
    eq('round-trips a real bill', await decodeBill(enc), real);
    // Compression is the difference between a shareable link and an unusable one.
    ok('compresses substantially', enc.length < real.length * 0.5,
       `${real.length} chars -> ${enc.length} payload`);
    console.log(`  · ${(real.length / 1024).toFixed(0)} KB bill -> ${(enc.length / 1024).toFixed(0)} KB link payload`);
  }

  let threw = false;
  try { await decodeBill('qNOTVALID'); } catch { threw = true; }
  ok('rejects an unrecognised payload', threw);
}

// --------------------------------------------------------------- real bill
section('real bill end-to-end');
const samplePath = join(ROOT, 'samples/sample-bill.txt');
if (existsSync(samplePath)) {
  const text = normalizeText(readFileSync(samplePath, 'utf8'));
  const bill = parseBill(text);
  const cs = extractCitations(text);
  const as = extractAmendments(text, cs);

  ok('parses bill sections', bill.sections.length > 5, `${bill.sections.length} sections`);
  ok('detects a short title', !!bill.meta.shortTitle, JSON.stringify(bill.meta));
  ok('finds many citations', cs.length > 30, `${cs.length} citations`);
  ok('finds amendments', as.length > 0, `${as.length} amendments`);
  ok('most amendments resolve a target', as.filter((a) => a.target).length >= as.length / 2,
     `${as.filter((a) => a.target).length}/${as.length} resolved`);

  // ---- where a section sits ---------------------------------------------
  // A bill restarts its title numbering inside every division, so the innermost
  // label alone names three different places in this bill. Section 123 reported
  // "TITLE III—BUDGET ENFORCEMENT IN THE SENATE" with no way to tell which of
  // divisions A, B or C it belonged to.
  const s123 = bill.sections.find((s) => s.num === '123');
  eq('sec. 123 sits two units deep', s123.ancestors.length, 2);
  eq('  outermost is the division', s123.ancestors[0].label, 'DIVISION A');
  eq('  and its heading has no leading hyphen', s123.ancestors[0].heading, 'LIMIT FEDERAL SPENDING');
  eq('  innermost is the title', s123.ancestors[1].label, 'TITLE III');
  eq('  which is not the same TITLE III as division B\'s',
     bill.sections.find((s) => s.num === '261').ancestors[0].label, 'DIVISION B');
  eq('a section above any division has no ancestors',
     bill.sections.find((s) => s.num === '1').ancestors.length, 0);
  // Every ancestor chain must be a real nesting, outermost first.
  const misnested = bill.sections.filter((s) =>
    s.ancestors.some((a, i) => i > 0 && a.label.split(/\s+/)[0] === s.ancestors[i - 1].label.split(/\s+/)[0])
  );
  eq('no section repeats a unit kind in its chain', misnested.length, 0);

  // ---- appropriations headings, set in sentence case ---------------------
  // Division B, title I of this Act is 73 rescission sections written
  // "Sec. 1.  Each rescission made by this title …". RE_SECTION is
  // case-sensitive — which is what stops a table of contents producing a
  // phantom section per line — so the whole title was invisible: the jump menu
  // ran from Sec. 124 straight to Sec. 251, and Sec. 124's span swallowed all
  // 73 of them.
  const rescissions = bill.sections.filter((s) => s.runIn);
  eq('finds the sentence-case appropriations sections', rescissions.length, 81);
  ok('  all of them inside division B',
     rescissions.every((s) => s.ancestors[0] && s.ancestors[0].label === 'DIVISION B'),
     [...new Set(rescissions.map((s) => s.ancestors[0]?.label))].join(','));
  ok('  and they are marked run-in, not given a heading they do not have',
     bill.sections.filter((s) => !s.runIn).length === 39,
     `${bill.sections.filter((s) => !s.runIn).length} caps sections`);
  // The table of contents lists "Sec. 101. Discretionary spending limits." in
  // the same shape. It is flush left where a real heading is indented, and none
  // of its entries may become a section.
  const tocEnd = text.indexOf('DIVISION A--LIMIT FEDERAL SPENDING', 200);
  eq('no section is taken from the table of contents',
     bill.sections.filter((s) => s.start < tocEnd && s.runIn).length, 0);
  // Section 124 must now end where section 124 ends.
  const s124 = bill.sections.find((s) => s.num === '124');
  ok('the section above them no longer swallows them',
     s124.end - s124.start < 1200, `${s124.end - s124.start} chars`);

  // ---- a label on a line of its own --------------------------------------
  // An appropriations act centres "TITLE I", leaves a blank line, then centres
  // the heading. RE_DIVISION needs a separator on the same line, so it matched
  // none of them: 44 titles in H.J. Res. 31, and everything under them hanging
  // off a title nobody could see.
  {
    const tb = normalizeText(
      'SECTION 1. SHORT TITLE.\n' +
      "This Act may be cited as the ``Bare Label Act''.\n\n" +
      '  DIVISION A--DEPARTMENT OF EXAMPLE APPROPRIATIONS ACT\n\n' +
      '                                TITLE I\n\n' +
      '            DEPARTMENTAL MANAGEMENT, OPERATIONS, AND OVERSIGHT\n\n' +
      '                     Office of the Secretary\n\n' +
      '    Sec. 101.  Not later than 30 days after enactment, the Secretary\n' +
      'shall submit a report.\n\n' +
      '                               TITLE II\n\n' +
      '               SECURITY, ENFORCEMENT, AND INVESTIGATIONS\n\n' +
      '    Sec. 201.  None of the funds may be used for anything.\n'
    );
    const bb = parseBill(tb);
    eq('a bare TITLE label is recognised',
       bb.divisions.filter((d) => /^TITLE/.test(d.label)).length, 2);
    eq('  with the heading from the line below',
       (bb.divisions.find((d) => d.label === 'TITLE I') || {}).heading,
       'DEPARTMENTAL MANAGEMENT, OPERATIONS, AND OVERSIGHT');
    eq('  and the second one is its own, not borrowed',
       (bb.divisions.find((d) => d.label === 'TITLE II') || {}).heading,
       'SECURITY, ENFORCEMENT, AND INVESTIGATIONS');
    // The point of all of it: the sections underneath know where they are.
    const s101 = bb.sections.find((s) => s.num === '101');
    eq('a section under a bare title sits two units deep', s101.ancestors.length, 2);
    eq('  under its division', s101.ancestors[0].label, 'DIVISION A');
    eq('  and its title', s101.ancestors[1].label, 'TITLE I');
    eq('a later section moves to the next title',
       bb.sections.find((s) => s.num === '201').ancestors[1].label, 'TITLE II');
    // The account heading between the title and the section is not a division.
    ok('an account heading is not read as a unit',
       !bb.divisions.some((d) => /Office of the Secretary/i.test(d.heading)),
       bb.divisions.map((d) => d.heading).join(' | '));
  }

  // ---- headings that ran past the measure --------------------------------
  // "SEC. 271. TERMINATION … ON FEDERAL STUDENT" / "LOANS; RESUMPTION …" was
  // cut at the line break, so the jump menu named a different provision than
  // the one the section is about.
  eq('a wrapped section heading is rejoined',
     bill.sections.find((s) => s.num === '271').heading,
     'TERMINATION OF SUSPENSION OF PAYMENTS ON FEDERAL STUDENT LOANS; ' +
     'RESUMPTION OF ACCRUAL OF INTEREST AND COLLECTIONS');
  eq('a wrapped division heading is rejoined',
     (bill.divisions.find((d) => d.label === 'TITLE IV') || {}).heading,
     'TERMINATION OF SUSPENSION OF PAYMENTS ON FEDERAL STUDENT LOANS; ' +
     'RESUMPTION OF ACCRUAL OF INTEREST AND COLLECTIONS');
  // Joining reads following lines but must never consume them: the section body
  // still starts where it always did, and every citation offset is unmoved.
  ok('rejoining a heading does not move the section body',
     text.slice(bill.sections.find((s) => s.num === '271').start).startsWith('    SEC. 271.'),
     JSON.stringify(text.slice(bill.sections.find((s) => s.num === '271').start, 40)));
  // A heading that already ends in a period must not absorb anything.
  eq('a complete heading is left alone',
     bill.sections.find((s) => s.num === '101').heading, 'DISCRETIONARY SPENDING LIMITS');

  // No citation span may overlap another, or rendering splices badly.
  const sorted = cs.slice().sort((a, b) => a.start - b.start);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) overlaps++;
  eq('no overlapping citation spans', overlaps, 0);

  // Offsets must round-trip against the source text.
  const bad = cs.filter((c) => text.slice(c.start, c.end) !== c.text);
  eq('all offsets round-trip', bad.length, 0);

  console.log(`  · ${bill.sections.length} sections, ${cs.length} citations, ${as.length} amendments`);
  const byKind = {};
  for (const c of cs) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  console.log(`  · by kind: ${JSON.stringify(byKind)}`);
} else {
  console.log('  (samples/sample-bill.txt missing — skipped)');
}

// ------------------------------------------------------------ PDF extraction
// The text path was covered and the PDF path was not, which is how a bill whose
// line-number gutter sits at x=133 rather than near the paper's edge got read
// with every number still glued to its line — and so with no section headings
// at all. The fixture is a sponsor's XML draft (H.R. 9925), which is the layout
// that broke: right-aligned numbers, indented text block, odd-integer baselines.
section('PDF extraction');
const pdfPath = join(ROOT, 'samples/hr9925-frontier-act-119th.pdf');
if (existsSync(pdfPath)) {
  // pdf.js probes for a couple of browser globals before it will run.
  globalThis.DOMMatrix ??= class { constructor() {} };
  const { pdfToText } = await imp('app/parse/pdf.js');

  const buf = new Uint8Array(readFileSync(pdfPath)).buffer;
  const { text: raw, pages } = await pdfToText(buf);

  eq('reads every page', pages, 74);

  // The gutter must go. Two lines of this bill genuinely begin with a number
  // ("...of section 2 encompass...", "...or 90 days after..."), so allow a few
  // rather than demanding zero — but 25 per page would mean nothing was stripped.
  const leadingNumbers = raw.split('\n').filter((l) => /^\d{1,2} /.test(l)).length;
  ok('strips the line-number gutter', leadingNumbers <= 4, `${leadingNumbers} lines still start with a number`);
  ok('keeps numbers that are real text', raw.includes('of section\n2 encompass') || raw.includes('section 2 encompass'),
     'a genuine leading number was stripped as gutter');

  // Every glyph of this line shares one baseline (y=707); bucketing on a rounded
  // Y split it in two and produced "(1) A" / "CCEPTABLE LEVELS OF CATASTROPHIC".
  ok('keeps one baseline as one line', raw.includes('(1) ACCEPTABLE LEVELS OF CATASTROPHIC'),
     'a single baseline was split across rows');

  // With the gutter gone, a word hyphenated across lines rejoins.
  ok('rejoins hyphenated words', raw.includes('Frontier Risk Oversight'), 'Over-/sight did not rejoin');

  const text = normalizeText(raw);
  const bill = parseBill(text);
  const cs = extractCitations(text);
  const as = extractAmendments(text, cs);

  eq('finds every section', bill.sections.length, 9);
  ok('section headings survive', bill.sections.some((s) => s.heading.startsWith('RELATIONSHIP TO STATE LAWS')),
     bill.sections.map((s) => s.num).join(','));
  // The bill names itself twice — "...and Reporting Act'' or the ``FRONTIER
  // Act''" — and the first name is the one taken. Asserted exactly, because the
  // loose /FRONTIER Act/ this replaces passed only by accident: the capture ran
  // straight through the closing quote and returned both names and the line
  // wrap between them as a single 130-character "title".
  eq('finds the short title', bill.meta.shortTitle,
     'Frontier Risk Oversight, National Transparency, Independent Evaluation, and Reporting Act');
  ok('  and it carries no quote marks or line wrap', !/[`'"“”‘’\n]/.test(bill.meta.shortTitle || ''),
     JSON.stringify(bill.meta.shortTitle));

  // A citation may wrap across a line break ("section 553\nof title 5"); it still
  // has to be recognised and still has to point at the right place.
  const uscCites = cs.filter((c) => c.kind === 'usc');
  ok('finds the U.S. Code cites', uscCites.length >= 4, `${uscCites.length} usc cites`);
  for (const [ti, se] of [['5', '552'], ['5', '553'], ['5', '704'], ['15', '9401']]) {
    ok(`  resolves ${ti} U.S.C. ${se}`, uscCites.some((c) => c.title === ti && c.section === se));
  }

  ok('names the Act it borrows definitions from',
     cs.some((c) => c.kind === 'act' && /National Artificial Intelligence Initiative Act/.test(c.act.name)));

  // A freestanding Act: it enacts new law rather than amending existing law, so
  // zero amendments is the right answer, not a parser giving up.
  eq('reports no amendments in a freestanding Act', as.length, 0);
  ok('  and the text really has none', !/\bis amended\b/i.test(text));

  const bad = cs.filter((c) => text.slice(c.start, c.end) !== c.text);
  eq('all offsets round-trip', bad.length, 0);

  const byKind = {};
  for (const c of cs) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  console.log(`  · ${pages} pages, ${bill.sections.length} sections, ${cs.length} citations`);
  console.log(`  · by kind: ${JSON.stringify(byKind)}`);
} else {
  console.log('  (samples/hr9925-frontier-act-119th.pdf missing — skipped)');
}

// --------------------------------------------------- resolving the target
// An amendment with no target reports, in the UI, that the bill changes nothing
// identifiable. Across the twenty-bill corpus that was true of a thousand
// instructions, in three families — none of them actually ambiguous.
section('resolving the target');
{
  const p = (t, divs) => {
    const n = normalizeText(t);
    const b = parseBill(n);
    return extractAmendments(n, extractCitations(n), divs ?? b.divisions);
  };

  // 1. A Public Law names its target perfectly well.
  const pl = p('SEC. 2. X.\nSection 1201 of Public Law 103-434 (108 Stat. 4550) is amended by striking ``old\'\'.\n');
  eq('a Public Law target resolves', pl[0].target?.kind, 'publaw');
  eq('  to the right law', `${pl[0].target.congress}-${pl[0].target.law}`, '103-434');
  // A real code cite still wins over it.
  const both = p('SEC. 2. X.\nSection 4 of the Widget Act (15 U.S.C. 2601; Public Law 94-469) is amended by striking ``old\'\'.\n');
  eq('  but a U.S. Code cite still wins', both[0].target?.kind, 'usc');

  // 2. The 1986 Code declaration, scoped to its division.
  const irc = p(
    'DIVISION T--SECURE 2.0\n\nSEC. 1. AMENDMENT OF 1986 CODE.\n' +
    'Except as otherwise expressly provided, whenever in this division an amendment is expressed in terms of ' +
    'an amendment to a section, the reference shall be considered to be made to a section of the Internal Revenue Code of 1986.\n' +
    'SEC. 2. CREDIT.\nSection 45E(e) is amended by adding at the end the following.\n'
  );
  const ircAm = irc.find((a) => a.section === '45E');
  eq('a bare section under the 1986 Code declaration resolves', ircAm?.target?.title, '26');
  eq('  to that section of title 26', ircAm.target.section, '45E');
  ok('  and is marked as implied', /Internal Revenue Code/.test(ircAm.target.implied || ''), ircAm.target.implied);

  // Scoped: the same bare section in a LATER division must not become tax law.
  const scoped = p(
    'DIVISION T--SECURE 2.0\n\nSEC. 1. AMENDMENT OF 1986 CODE.\n' +
    'Except as otherwise expressly provided, whenever in this division an amendment is expressed in terms of ' +
    'an amendment to a section, the reference shall be considered to be made to a section of the Internal Revenue Code of 1986.\n' +
    'SEC. 2. CREDIT.\nSection 45E(e) is amended by adding at the end the following.\n' +
    '\nDIVISION U--SOMETHING ELSE\n\nSEC. 3. OTHER.\nSection 45E(e) is amended by striking ``x\'\'.\n'
  );
  const inNext = scoped.filter((a) => a.section === '45E');
  eq('two instructions, one per division', inNext.length, 2);
  eq('  the one inside the division resolves', inNext[0].target?.title, '26');
  eq('  the one outside it does not', inNext[1].target, null);

  // A bill declares this once per unit, and a tax bill has several. Reading only
  // the first left the whole second half of the Inflation Reduction Act — every
  // energy credit in it — resolving to nothing, which is why that bill alone sat
  // at 41% targeted while every other bill in the corpus was above 78%.
  const twice = p(
    'TITLE I--FINANCE\n\nSubtitle A--Deficit Reduction\n\nSECTION 10001. AMENDMENT OF 1986 CODE.\n' +
    'Except as otherwise expressly provided, whenever in this subtitle an amendment is expressed in terms of ' +
    'an amendment to a section, the reference shall be considered to be made to a section of the Internal Revenue Code of 1986.\n' +
    'SEC. 10002. A.\nSection 45(b)(4)(A) is amended by striking ``x\'\'.\n' +
    '\nSubtitle D--Energy Security\n\nSEC. 13001. AMENDMENT OF 1986 CODE.\n' +
    'Except as otherwise expressly provided, whenever in this subtitle an amendment is expressed in terms of ' +
    'an amendment to a section, the reference shall be considered to be made to a section of the Internal Revenue Code of 1986.\n' +
    'SEC. 13002. B.\nSection 48(a)(5) is amended by striking ``y\'\'.\n'
  );
  eq('a second declaration governs its own subtitle',
     twice.find((a) => a.section === '48')?.target?.title, '26');
  eq('  and the first still governs its own',
     twice.find((a) => a.section === '45')?.target?.title, '26');

  // 3. "of such title" carries the last title the bill named.
  const such = p(
    'SEC. 2. X.\nSection 2358 of title 10, United States Code, is amended by striking ``a\'\'.\n' +
    'SEC. 3. Y.\nSection 9203 of such title is amended by striking ``b\'\'.\n'
  );
  const carried = such.find((a) => a.section === '9203');
  eq('"of such title" carries the title', carried?.target?.title, '10');
  eq('  onto its own section number', carried.target.section, '9203');

  // A chapter number must NEVER be carried as a section number: 10 U.S.C. 9
  // exists and has nothing to do with chapter 9.
  const chap = p(
    'SEC. 2. X.\nSection 2358 of title 10, United States Code, is amended by striking ``a\'\'.\n' +
    'SEC. 3. Y.\nChapter 9 of such title is amended by adding at the end the following.\n'
  );
  const chapAm = chap.find((a) => /^[Cc]hapter$/.test(a.unit) && a.section === '9');
  ok('a chapter is not carried as a section', !chapAm || !chapAm.target,
     JSON.stringify(chapAm?.target && [chapAm.target.title, chapAm.target.section]));

  // 4. Head forms that were invisible.
  const anal = p('SEC. 2. X.\nThe table of sections at the beginning of chapter 1407 of title 10, United States Code, is amended by adding at the end the following.\n');
  eq('"table of sections at the beginning of" is an instruction', anal.length, 1);
  const sub = p('SEC. 2. X.\nSubtitle A of title XXII of the Homeland Security Act of 2002 (6 U.S.C. 651 et seq.) is amended by adding at the end the following.\n');
  eq('a lettered subtitle is an instruction', sub.length, 1);
  eq('  and resolves through its parenthetical cite', sub[0].target?.section, '651');
}

// ------------------------------------------------------- operand placement
// Knowing *what* a bill inserts is only half an amendment. Without knowing
// where, the new language can be listed but never drawn into the law, and the
// reader is left to do the substitution in their head — which is the thing the
// two panes exist to avoid. See placeOps() in app/parse/citations.js.
section('operand placement');
{
  const p = (t) => extractAmendments(normalizeText(t), extractCitations(normalizeText(t)))[0].ops;

  const repl = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``old\'\' and inserting ``new\'\'.\n');
  const strike = repl.find((o) => o.type === 'strike');
  const insert = repl.find((o) => o.type === 'insert');
  eq('a replacement pairs the insert to the strike', insert.replaces, strike.start);

  // The pairing is bounded. Two adjacent but unrelated instructions must not be
  // read as one replacement, or the pane shows a substitution nobody wrote.
  const apart = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``old\'\' in the first place it appears, ' +
    'and the Secretary shall thereafter review every provision of law relating to widgets, gadgets and sprockets ' +
    'before inserting ``new\'\' anywhere else.\n'
  );
  eq('an unrelated later insert is not paired',
     apart.find((o) => o.type === 'insert').replaces, undefined);

  const anchored = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by inserting ``and jets\'\' after ``planes\'\'.\n');
  const ai = anchored.find((o) => o.type === 'insert');
  eq('an "after" anchor is captured', ai.relation, 'after');
  eq('  with its anchor text', ai.anchor, 'planes');

  const before = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by inserting ``small \'\' before ``planes\'\'.\n');
  eq('a "before" anchor is captured', before.find((o) => o.type === 'insert').relation, 'before');

  // ---- the anchor written BEFORE the language it places ------------------
  // "by inserting after ``X'' the following: ``Y''" is as common as the other
  // order and is not a variant of it: here the FIRST quoted string is the
  // anchor. The generic insert scan takes the first quoted string after the
  // verb, so it read the anchor as the inserted text — not a missing answer but
  // a wrong one, drawing language already in the law as language the bill adds,
  // while the panel reported "position not stated" about the one thing it knew.
  const first = p(
    'Section 801(a)(2)(A) of title 5, United States Code, is amended by inserting after ' +
    '``compliance with procedural steps required by paragraph (1)(B)\'\' the following: ' +
    '``and the requirements of section 802\'\'.\n'
  );
  const fi = first.filter((o) => o.type === 'insert');
  eq('an anchor-first insert yields ONE insert', fi.length, 1);
  eq('  whose text is the language being added', fi[0].text, 'and the requirements of section 802');
  eq('  anchored after the existing phrase', fi[0].relation, 'after');
  eq('  which is the anchor, not the addition', fi[0].anchor,
     'compliance with procedural steps required by paragraph (1)(B)');
  ok('  and its offsets point at the added language, not the anchor',
     fi[0].start != null && fi[0].end - fi[0].start === fi[0].text.length,
     `${fi[0].start}..${fi[0].end}`);

  const beforeFirst = p(
    'Section 3 of the Widget Act (15 U.S.C. 2601) is amended by inserting before ' +
    '``the Secretary shall\'\' the following: ``subject to subsection (c),\'\'.\n'
  );
  const bf = beforeFirst.find((o) => o.type === 'insert');
  eq('the same in the "before" direction', bf.relation, 'before');
  eq('  with the language added', bf.text, 'subject to subsection (c),');

  const immediately = p(
    'Section 3 of the Widget Act (15 U.S.C. 2601) is amended by inserting immediately after ' +
    '``alpha\'\' the following: ``beta\'\'.\n'
  );
  eq('"immediately after" reads the same', immediately.find((o) => o.type === 'insert').text, 'beta');

  // The gap between anchor and language is tempered against both verbs. Without
  // that, an anchor could reach past its own instruction and pair with the next
  // one's operand — reporting language the bill REMOVES as language it adds.
  const spill = p(
    'Section 3 of the Widget Act (15 U.S.C. 2601) is amended-- (1) by inserting after ``alpha\'\'; and ' +
    '(2) by striking ``gamma\'\' and inserting ``delta\'\'.\n'
  );
  ok('an anchor does not reach across another instruction',
     !spill.some((o) => o.type === 'insert' && o.anchor === 'alpha' && o.text === 'gamma'),
     JSON.stringify(spill.map((o) => `${o.type}:${o.text}`)));

  // ---- the mark NAMED instead of quoted ----------------------------------
  // A bill that names the mark it removes usually names the mark it puts back,
  // and RE_INSERT wants a quoted operand — so there was no insert op at all. The
  // strike drew and nothing replaced it: a redline showing language removed from
  // the statute book with nothing in its place, which states something the bill
  // does not. 234 across the corpus, in 20 of the 30 bills.
  const named = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking the period ' +
    'at the end of paragraph (2) and inserting a semicolon.\n'
  );
  const ns = named.find((o) => o.type === 'strike');
  const ni = named.find((o) => o.type === 'insert');
  eq('a named mark is struck by operand, not by phrase', ns.operand, '.');
  ok('  and the strike span is the phrase the bill wrote',
     ns.text.startsWith('striking the period at the end'), ns.text);
  eq('a named mark is inserted by operand too', ni.operand, ';');
  eq('  paired to the strike it replaces', ni.replaces, ns.start);
  // The phrase says WHICH paragraph, and the tail used to be consumed and
  // thrown away on the reasoning that "the step machinery has already scoped
  // the op". It has not: an instruction of this shape normally never navigates,
  // so the op sat on the head's address and `atEnd` took the last position in
  // the first child ending in the mark. 71 marks across the corpus landed on a
  // real provision, and all 71 were outside the one the bill named.
  eq('the unit the phrase names becomes the scope', ns.scope, '(2)');
  ok('  and it is a claim, so a level the Code lacks falls back', ns.scopeFromPhrase);
  // Composed the way scopeReplacements() composes a stated address: the markers
  // replace the walked path from the unit word's own depth down, so a walk into
  // (c) gives (c)(2) and never (c) plus a paragraph of (c) plus (2).
  const walked = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended in subsection (c) by striking ' +
    'the period at the end of paragraph (2) and inserting a semicolon.\n'
  );
  eq('  over a walk, it replaces from the unit\'s own depth',
     walked.find((o) => o.type === 'strike').scope, '(c)(2)');
  // A named unit with no number of its own — "at the end of such paragraph" —
  // states nothing to compose, and the walk stands.
  const vague = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended in paragraph (4) by striking ' +
    'the period at the end of such paragraph and inserting a semicolon.\n'
  );
  eq('  and a unit with no number leaves the walk alone',
     vague.find((o) => o.type === 'strike').scope, '(4)');

  // The QUOTED form says it too, and it is the same defect. 26 U.S.C. 25C(f)
  // writes the two side by side, and the pane struck the "and" closing
  // paragraph (2) for an instruction that names paragraph (1) — the Code now
  // reads (1) …, (2) …, and (3) …, so the "and" this bill removed from (1) is
  // gone and `atEnd` took the last one under the walk.
  const quotedEnd = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``and\'\' ' +
    'at the end of paragraph (1).\n'
  );
  eq('a quoted strike reads the unit after "at the end" too',
     quotedEnd.find((o) => o.type === 'strike').scope, '(1)');
  // "at the end" with nothing after it still means the end of the walk, which
  // is the case this flag was added for and must not change.
  const bareEnd = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended in paragraph (4) by striking ' +
    '``and\'\' at the end.\n'
  );
  const be = bareEnd.find((o) => o.type === 'strike');
  ok('  and a bare "at the end" still means the walk', be.atEnd && be.scope === '(4)',
     `${be.atEnd} ${be.scope}`);

  // The pairing has to cross a closing quote, because the strike replaced is
  // often the quoted kind. RE_REPLACES cannot see this pairing at all: a named
  // insert's span starts at the VERB, so the gap in front of it holds no
  // "inserting" for that pattern to find.
  const mixed = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``, and\'\' and inserting a period.\n'
  );
  const mi = mixed.find((o) => o.type === 'insert' && o.operand);
  eq('a named insert pairs with a QUOTED strike', mi.operand, '.');
  eq('  naming that strike', mi.replaces, mixed.find((o) => o.type === 'strike').start);

  // The named phrase is CLAIMED, so the generic scan cannot read across it.
  // RE_INSERT reaches 120 characters for a quote opener and is tempered only
  // against "strik", so here it matched the FIRST verb and captured the block
  // belonging to the SECOND — then, being a global scan, advanced past that
  // second verb entirely, so the real insertion got no op of its own.
  const swallow = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking the period at the end ' +
    'of paragraph (15) and inserting a comma, and by inserting after paragraph (15) the following ' +
    'new paragraph: ``(16) the amount includible in gross income.\'\'.\n'
  );
  const swIns = swallow.filter((o) => o.type === 'insert');
  ok('a named insert does not swallow the next block',
     !swIns.some((o) => o.operand && String(o.text).includes('includible')),
     JSON.stringify(swIns.map((o) => `${o.operand || '-'}|${String(o.text).slice(0, 40)}`)));
  ok('  and that block still gets an op of its own',
     swIns.some((o) => !o.operand && String(o.text).includes('the amount includible in gross income')),
     JSON.stringify(swIns.map((o) => String(o.text).slice(0, 40))));

  // "by inserting a comma after ``State plan''" — the quoted phrase is the
  // ANCHOR. The generic scan reported "State plan", language already sitting in
  // the law, as the language being inserted. 3 of these in the corpus.
  const anch = p(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended in subparagraph (G) ' +
    'by inserting a comma after ``State plan\'\'.\n'
  );
  const an = anch.find((o) => o.type === 'insert');
  eq('a named insert takes its anchor from what follows', an.anchor, 'State plan');
  eq('  and inserts the mark, not the anchor', an.operand, ',');

  // badOpOffsets: a named op's span must slice back to its own text, or the bill
  // pane marks a run of characters the op does not describe.
  const rtT = normalizeText(
    'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking the period ' +
    'at the end and inserting a semicolon.\n'
  );
  const rtOps = extractAmendments(rtT, extractCitations(rtT))[0].ops.filter((o) => o.operand);
  eq('both named ops are produced', rtOps.length, 2);
  ok('  and every named op offset round-trips',
     rtOps.every((o) => rtT.slice(o.start, o.end) === o.text),
     JSON.stringify(rtOps.map((o) => [o.text, rtT.slice(o.start, o.end)])));

  // ---- "at the end" of a RANGE ------------------------------------------
  // "et seq." names the Act, and the resolver answers with the section it
  // begins at. An addition then has nothing to scope it, so it landed at that
  // section's root and a whole new SECTION OF THE ACT was drawn inside the
  // Act's first section, coloured as an insertion. 184 across the corpus, 131
  // of them opening "SEC. N." outright.
  const rangeAdd = p(
    'The National Environmental Policy Act of 1969 (42 U.S.C. 4321 et seq.) is amended ' +
    'by adding at the end the following:\n``SEC. 106. PROCEDURE FOR DETERMINATION.\n' +
    '``(a) In general.\'\'.\n'
  );
  const ra = rangeAdd.find((o) => o.type === 'add-at-end');
  ok('an addition to an "et seq." range is marked', ra && ra.rangeEnd === true,
     JSON.stringify(rangeAdd.map((o) => `${o.type}:${o.rangeEnd}`)));

  // The control, and the reason the flag is on the TARGET rather than on the
  // words "et seq.": the same instruction against a section cited outright is
  // placed exactly as before.
  const plainAdd = p(
    'Section 4321 of title 42, United States Code, is amended by adding at the end ' +
    'the following:\n``(d) New subsection.\'\'.\n'
  );
  const pa = plainAdd.find((o) => o.type === 'add-at-end');
  ok('  and one to a section cited outright is not', pa && !pa.rangeEnd,
     JSON.stringify(plainAdd.map((o) => `${o.type}:${o.rangeEnd}`)));

  // Only additions. A strike names language and is checked against the text, so
  // it declines on its own; an addition is placed structurally and never is.
  const rangeStrike = p(
    'The Widget Act (15 U.S.C. 2601 et seq.) is amended by striking ``old\'\' and inserting ``new\'\'.\n'
  );
  ok('  and a strike on the same target is left alone',
     rangeStrike.filter((o) => o.rangeEnd).length === 0,
     JSON.stringify(rangeStrike.map((o) => `${o.type}:${o.rangeEnd}`)));

  // A new SECTION is never part of another section, at any depth. The same
  // refusal as the range end, reached from the block's own first line instead of
  // from the target — and needed because the two arrive separately: 17 of these
  // across the corpus had a specific section as their target and were drawn
  // inside whatever subsection the instruction had walked to. "SEC. 45S. …"
  // scoped to (d) put a whole new Code section inside 26 U.S.C. 145(d).
  const secAdd = p(
    'Paragraph (4) of section 145(d) of title 26, United States Code, is amended ' +
    'by adding at the end the following:\n``SEC. 45S. EMPLOYER CREDIT.\n' +
    '``(a) In general.\'\'.\n'
  );
  const sa = secAdd.find((o) => o.type === 'add-at-end');
  ok('an addition that IS a whole new section is marked', sa && sa.newSection === true,
     JSON.stringify(secAdd.map((o) => `${o.type}:${o.newSection}`)));
  // The negative that keeps it narrow, and it is load-bearing: a bill amends a
  // table of sections by adding an ITEM, written in mixed case — "Sec. 45S." —
  // and that is a line of text inside the table, not a new section. 223 of these
  // across the corpus, and the matcher is case-sensitive so none is flagged.
  const itemAdd = p(
    'The table of sections for subchapter A is amended by adding at the end the ' +
    'following:\n``Sec. 45S. Employer credit.\'\'.\n'
  );
  ok('  while a table-of-sections item is not',
     itemAdd.filter((o) => o.newSection).length === 0,
     JSON.stringify(itemAdd.map((o) => `${o.type}:${o.newSection}`)));
  // And an ordinary subsection addition keeps being placed.
  ok('  nor is an ordinary added subsection', pa && !pa.newSection,
     JSON.stringify(plainAdd.map((o) => `${o.type}:${o.newSection}`)));

  const each = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``fee\'\' each place it appears and inserting ``charge\'\'.\n');
  ok('"each place it appears" marks the strike', each.find((o) => o.type === 'strike').all === true);
  ok('  and still pairs the replacement', each.find((o) => o.type === 'insert').replaces != null);

  // …and it is read in sixty characters of TEXT, not of source. The phrase is
  // regularly written after the INSERT that replaces the struck words, and a
  // bill wraps at 72 columns and indents its continuation lines — so a fixed
  // slice of the raw string saw a different amount of the sentence at every
  // nesting depth. hr1892 writes exactly this at 12 spaces and the phrase fell
  // outside the window; the same sentence at 4 was read. 4 across the corpus.
  {
    const depths = [0, 4, 8, 12, 16, 20, 24];
    const read = (n) => {
      const ops = p(
        'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking\n' +
        "``$10,000'' and inserting ``$20,000''\n" + ' '.repeat(n) + 'each place it appears.\n'
      );
      const s = ops.find((o) => o.type === 'strike');
      return s ? Boolean(s.all) : false;
    };
    ok('  at every continuation indent, not just the shallow ones',
       depths.every(read), JSON.stringify(depths.map((n) => `${n}:${read(n)}`)));
  }

  const atEnd = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``and\'\' at the end.\n');
  ok('"at the end" marks the strike', atEnd.find((o) => o.type === 'strike').atEnd === true);

  // "by striking ``fee'' in paragraph (3)" — the scope stated AFTER the
  // operand. The same fact "at the end of paragraph (N)" states, written as an
  // ordinary prepositional phrase; 134 operations across the corpus, and
  // without it the op keeps the walk's scope and searches the whole provision.
  {
    const scoped = (phrase) =>
      p(`Section 2 of the Widget Act (15 U.S.C. 2601) is amended ${phrase}\n`)
        .filter((o) => o.type === 'strike' || o.type === 'insert')
        .map((o) => `${o.type}:${o.scope ?? ''}`);
    eq('a scope stated after the operand is read',
       JSON.stringify(scoped("in subsection (c) by striking ``fee'' in paragraph (3).")),
       JSON.stringify(['strike:(c)(3)']));
    // …and reaches the other half of the pair, in both writing orders.
    eq('  and travels to the operand it replaces',
       JSON.stringify(scoped("by striking ``fee'' and inserting ``charge'' in paragraph (3).")),
       JSON.stringify(['strike:(3)', 'insert:(3)']));
    // Written the other way round the phrase sits in the pairing's own gap, so
    // RE_REPLACES has to admit it — the same rule item 88 hit with "in the
    // heading". Without that the insert is unpaired, reaches apply() with
    // neither a paired strike nor an anchor, and draws nothing at all.
    eq('  written the other way round, the pair still travels together',
       JSON.stringify(scoped("by striking ``fee'' in paragraph (3) and inserting ``charge''.")),
       JSON.stringify(['strike:(3)', 'insert:(3)']));
    eq('  and the heading phrase in the same gap keeps the pair',
       JSON.stringify(
         p("Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking " +
           "``fee'' in the heading and inserting ``charge''.\n")
           .filter((o) => o.type === 'strike' || o.type === 'insert')
           .map((o) => `${o.type}:${o.headingOnly ? 'heading' : '?'}`)),
       JSON.stringify(['strike:heading', 'insert:heading']));
    // A list names every member. `scope` stays the first, because reScope() and
    // every panel message read it as a string.
    const list = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by ' +
      "striking ``fee'' each place it appears in paragraphs (1) and (4).\n")
      .filter((o) => o.type === 'strike');
    eq('  a list scopes to every member',
       JSON.stringify([list[0].scope, list[0].scopes]), JSON.stringify(['(1)', ['(1)', '(4)']]));
    // The three exclusions, each of which was a wrong answer before it was
    // added: the next sub-instruction, the next operand, and somebody else's
    // address. Each must leave the op on the scope the walk reached.
    eq('  the next sub-instruction is not a scope',
       JSON.stringify(scoped("in subsection (c) by striking ``fee'', and (2) in paragraph (3).")),
       JSON.stringify(['strike:(c)']));
    eq('  nor a scope named inside the next operand',
       JSON.stringify(scoped("in subsection (c) by striking ``fee'' and inserting " +
         "``the levy described in paragraph (3)''.")),
       JSON.stringify(['strike:(c)', 'insert:(c)']));
    eq('  nor one belonging to another section',
       JSON.stringify(scoped("in subsection (c) by striking ``fee'' in paragraph (3) of section 9.")),
       JSON.stringify(['strike:(c)']));
  }

  // "in the first sentence, by striking ``2018''" — a bill scopes an operation
  // to a SENTENCE as readily as to a paragraph. 550 phrases across the corpus
  // and 326 operations scoped by one; without it the op keeps whatever scope the
  // walk reached and the strike takes the first occurrence anywhere under it.
  {
    const sent = (phrase) =>
      p(`Section 2 of the Widget Act (15 U.S.C. 2601) is amended ${phrase}
`)
        .filter((o) => o.type === 'strike' || o.type === 'insert');
    const nth = (ops) => ops.map((o) => o.sentence);
    eq('a sentence-scoped strike carries the ordinal',
       JSON.stringify(nth(sent("in the first sentence by striking ``fee''."))), JSON.stringify([1]));
    eq('  and the pairing carries it to the replacement',
       JSON.stringify(nth(sent("in the third sentence, by striking ``fee'' and inserting ``charge''."))),
       JSON.stringify([3, 3]));
    // Written AFTER the operand, which the pairing cannot reach: a gap holding
    // "in the last sentence" is not one RE_REPLACES admits.
    eq('  and reads it written after the operand',
       JSON.stringify(nth(sent("by striking ``fee'' in the last sentence and inserting ``charge''."))),
       JSON.stringify([-1, -1]));
    // The negative that keeps it narrow: a sub-instruction past the semicolon is
    // a different operation and must not inherit the ordinal.
    const two = sent(
      "in the first sentence, by striking ``fee''; and by striking ``levy''."
    );
    eq('  while an operation past the semicolon is untouched',
       JSON.stringify(nth(two)), JSON.stringify([1, undefined]));
    eq('  and a plain amendment carries none',
       JSON.stringify(nth(sent("by striking ``fee''."))), JSON.stringify([undefined]));
  }

  // A HEADING is not the provision's text. The Code stores the two apart, so an
  // operand aimed at a heading can only ever match in the body — 501 ops across
  // the corpus sit behind one of these phrases and 112 drew a mark there.
  {
    const head = (phrase) =>
      p(`Section 2 of the Widget Act (15 U.S.C. 2601) is amended-- (1) ${phrase}\n`);
    const both = (ops) => ops.filter((o) => o.headingOnly).length;
    const a = head("in the subsection heading, by striking ``Fees'' and inserting ``Charges''.");
    eq('a heading amendment flags both halves', both(a), 2, JSON.stringify(a.map((o) => `${o.type}:${o.headingOnly}`)));
    // The phrase may sit BETWEEN the two operands, in which case only the insert
    // is behind it — so the flag has to travel back along the pair as well.
    const b = head("by striking ``Fees'' in the heading and inserting ``Charges''.");
    eq('  including when the phrase sits between them', both(b), 2,
       JSON.stringify(b.map((o) => `${o.type}:${o.headingOnly}`)));
    eq('  and it reads the unit the phrase names',
       both(head("in the heading of paragraph (4), by striking ``Fees'' and inserting ``Charges''.")), 2);
    // The negative, and it is what keeps this narrow: a sub-instruction after a
    // semicolon is a different operation and must not inherit the flag.
    const c = head(
      "in the section heading, by striking ``Fees'' and inserting ``Charges''; and (2) by " +
      "striking ``widget'' and inserting ``gadget''."
    );
    eq('  while an operation past the semicolon is untouched', both(c), 2,
       JSON.stringify(c.map((o) => `${o.type}:${JSON.stringify(o.text)}:${o.headingOnly}`)));
    eq('  and a plain amendment flags nothing',
       both(head("by striking ``Fees'' and inserting ``Charges''.")), 0);
  }

  // "…and all that follows" — the bill removes a RUN and the strike scan reads
  // only where it starts. 523 phrases across the corpus, 383 of them directly
  // after a parsed strike, and every one drew a mark far smaller than the change
  // the bill makes. Four endpoints, and they are not interchangeable.
  {
    const run = (tail) =>
      p(`Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking \`\`$1.50 per acre'' and all that follows ${tail}\n`)
        .find((o) => o.type === 'strike');
    const quoted = run("through ``the period at the end'' and inserting ``$3 per acre''.");
    eq('a run stated at both ends carries its endpoint', quoted.runTo, 'the period at the end');
    ok('  and is not confused with "to the end"', !quoted.runToEnd && !quoted.runUnknown);

    const punct = run("through the period at the end and inserting ``$3 per acre''.");
    ok('"through the period at the end" runs to the end of the passage',
       punct.runToEnd === true && !punct.runTo, JSON.stringify(punct));
    ok('  and so does a bare "all that follows"', run("and inserting ``$3''.").runToEnd === true);
    // "through the end of the subsection" is the same endpoint spelled longer —
    // the unit it names sits at or above the passage the operand is found in.
    ok('  and so does "through the end of the subsection"',
       run("through the end of the subsection and inserting ``$3''.").runToEnd === true);

    // The refusal, and it is the half that costs something: the mark drawn today
    // on the opening phrase is withdrawn with it, because a strikethrough over
    // "$1.50 per acre" alone claims the bill removes those words and no others.
    const named = run("through subparagraph (E) and inserting ``$3''.");
    ok('a run ending at a whole sibling provision is refused',
       named.runUnknown === true && !named.runTo && !named.runToEnd, JSON.stringify(named));
    ok('  as is one ending at a sentence',
       run('through the second sentence.').runUnknown === true);

    // The pairing. RE_REPLACES reads the gap between the two operands, and a run
    // puts its whole endpoint phrase in there — so without RE_RUN_REPLACES the
    // insert is unpaired, apply() has neither a strike nor an anchor to place it
    // against, and nothing is drawn or tested. 15 U.S.C. 1681u(b) reads the
    // amended way today and had 362 characters of the PATRIOT Act's own inserted
    // language struck through as a pending deletion.
    const paired = p(
      'Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ' +
      "``$1.50 per acre'' and all that follows through the period at the end and " +
      "inserting the following: ``$3 per acre per year''.\n"
    );
    const ins = paired.find((o) => o.type === 'insert');
    const str = paired.find((o) => o.type === 'strike');
    ok('  a run\'s insert is paired across the endpoint phrase',
       ins && str && ins.replaces === str.start,
       JSON.stringify(paired.map((o) => `${o.type}:${o.text}:${o.replaces}`)));
  }

  // A quoted operand may not run past the start of the next one. The SOURCE can
  // be malformed: govinfo's rendition of Pub. L. 107-56 writes the USA PATRIOT
  // Act's §814(c) with two backticks and one apostrophe, so the scan for a
  // closer walks past the whole next sub-instruction and takes the one
  // belonging to its operand. 148 characters of instruction were reported to
  // the reader as language struck from 18 U.S.C. 1030(c)(2)(A).
  //
  // No test of the operand's CONTENT separates this, and that was measured: of
  // 7,886 quoted strike operands three contain a quote opener and three an
  // amendatory verb, and four of those six are legitimate. The overlap is what
  // is exact — one pair in 22,874 ops.
  {
    const bad = p(
      'Section 1030 of title 18, United States Code, is amended--\n' +
      "        (A) in subparagraph (A), by striking ``and' at the end;\n" +
      "        (B) in subparagraph (B), by inserting ``or an attempt'' after \n" +
      "    ``subsection (a)(2),''.\n"
    );
    const spans = bad.filter((o) => o.start != null).sort((x, y) => x.start - y.start);
    const overlaps = spans.filter((o, i) => i && o.start < spans[i - 1].end);
    eq('an operand running past the next one is dropped, not reported', overlaps.length, 0,
       JSON.stringify(bad.map((o) => `${o.type}:${JSON.stringify(o.text).slice(0, 40)}`)));
    // The correctly-delimited insert survives: dropping it too would lose the
    // language the bill actually adds.
    ok('  and its correctly delimited neighbour survives',
       bad.some((o) => o.type === 'insert' && o.text === 'or an attempt'),
       JSON.stringify(bad.map((o) => `${o.type}:${o.text}`)));
    // …and the same instruction written correctly keeps both.
    const good = p(
      'Section 1030 of title 18, United States Code, is amended--\n' +
      "        (A) in subparagraph (A), by striking ``and'' at the end;\n" +
      "        (B) in subparagraph (B), by inserting ``or an attempt'' after \n" +
      "    ``subsection (a)(2),''.\n"
    );
    eq('  while the well-formed source keeps its strike',
       good.filter((o) => o.type === 'strike' && o.text === 'and').length, 1,
       JSON.stringify(good.map((o) => `${o.type}:${o.text}`)));
  }

  // Every quote convention, everywhere — the tracked invariant, asserted where
  // it had been broken. `extractSteps` skips a line of quoted inserted law, and
  // the run was closed by an ALTERNATION over three conventions of four. The
  // missing one is the STRAIGHT double, where the same character opens and
  // closes: a `"` line opened a run that could never end, so every later line
  // was skipped as inserted law and every later operation kept the first walk's
  // scope — a different provision, not a blank. hr2 re-spelled that way fell
  // from 898 navigation steps to 436. No shipped fixture uses them; a paste
  // from a web page or a word processor does.
  //
  // Written from the pair table rather than four literals, because the govinfo
  // convention is two backticks and two apostrophes and BOTH halves are string
  // delimiters somewhere. Asserted as an identity across the four, which is
  // stronger than four separate expectations and cannot drift apart.
  {
    const SHAPE =
      'SEC. 2. TEST.\n' +
      '    Section 2 of the Widget Act (15 U.S.C. 2601) is amended--\n' +
      '        (1) in subsection (c)(2), by adding at the end the following:\n' +
      '@O@(D) a contract of sale of a digital commodity.@C@; and\n' +
      '        (2) in subsection (b), by striking @O@fee@C@ and inserting @O@charge@C@.\n';
    const read = ([o, c]) => {
      const t = normalizeText(SHAPE.split('@O@').join(o).split('@C@').join(c));
      const a = extractAmendments(t, extractCitations(t))[0];
      return `${(a.steps || []).length}|${a.ops.map((x) => x.scope ?? '-').join(',')}`;
    };
    const pairs = [['``', "''"], ['‘‘', '’’'], ['“', '”'], ['"', '"']];
    const got = pairs.map(read);
    eq('all four quote conventions parse the same instruction alike',
       new Set(got).size, 1, JSON.stringify(got));
    // …and to the right answer, or agreeing on a wrong one would satisfy it.
    eq('  and the second sub-instruction scopes to its own subsection',
       got[0], '2|(b),(b),(c)(2)');
  }

  // Against real bills: most inserts should get a position, or the redline is
  // mostly empty and the feature does not earn its place.
  if (existsSync(samplePath)) {
    const real = normalizeText(readFileSync(samplePath, 'utf8'));
    const ops = extractAmendments(real, extractCitations(real)).flatMap((a) => a.ops);
    const ins = ops.filter((o) => o.type === 'insert');
    const placed = ins.filter((o) => o.replaces != null || o.anchor);
    ok('most insertions in a real bill get a position', placed.length >= ins.length * 0.6,
       `${placed.length}/${ins.length}`);
    console.log(`  · sample bill: ${placed.length}/${ins.length} insertions positioned`);
  }
}

// ------------------------------------------------ reaching the redline
// The regression this exists for: the redline was drawn only when the "▸ amends"
// tag was clicked. Clicking the composed address "clause (iv)" — the likeliest
// click of all, since that is the clause you want to see the effect on —
// resolved the provision and drew nothing. Reported from a screenshot of the
// Farm to Fly Act, whose whole operative content is one anchored insertion.
section('reaching the redline');
{
  const { amendmentFor } = await imp('app/parse/citations.js');
  const t = normalizeText(
    'SEC. 2. SUSTAINABLE AVIATION FUEL.\n' +
    'Section 9001 of the Farm Security and Rural Investment Act of 2002 (7 U.S.C. 8101) is amended—\n' +
    '    (1) in paragraph (3)(B)—\n' +
    '        (A) in clause (iv), by inserting “and sustainable aviation fuel” after “diesel-equivalent fuel”;\n'
  );
  const raw = extractCitations(t);
  const ams = extractAmendments(t, raw);
  const cites = expandRelativeRefs(raw, ams);
  eq('one instruction', ams.length, 1);

  const clause = cites.find((c) => c.relative && /clause \(iv\)/.test(c.text));
  ok('the composed address exists', Boolean(clause), cites.filter((c) => c.relative).map((c) => c.text).join('|'));
  eq('  and resolves through the target', `${clause.title} ${clause.section}${clause.subsection}`, '7 8101(3)(B)(iv)');
  eq('clicking it reaches the amendment', amendmentFor(clause, ams)?.id, ams[0].id);

  // The instruction's own target citation reaches it too.
  eq('clicking the target reaches it', amendmentFor(ams[0].target, ams)?.id, ams[0].id);

  // But an unrelated citation must not. Attaching an effect to a cross-reference
  // that merely sits inside quoted inserted text would head a provision the bill
  // never changes with "What this amendment does".
  const stray = { id: 'cX', kind: 'usc', title: '42', section: '7401', subsection: '' };
  eq('an unrelated citation reaches nothing', amendmentFor(stray, ams), null);

  // And the effect, once reached, actually marks the law — in the clause the
  // instruction navigated to, and nowhere else.
  const { createRedline } = await imp('app/ui/redline.js');
  const law = '(iv) diesel-equivalent fuel derived from renewable biomass, including vegetable oil and animal fat;';
  const ins = ams[0].ops.find((o) => o.type === 'insert');
  eq('the operation is bound to the clause the instruction walked to', ins.scope, '(3)(B)(iv)');

  const segs = createRedline(ams[0].ops).apply(law, '(3)(B)(iv)');
  eq('the insertion lands after its anchor',
     segs.map((s) => (s.type === 'keep' ? s.text : `[${s.type}]`)).join(''),
     '(iv) diesel-equivalent fuel[ins] derived from renewable biomass, including vegetable oil and animal fat;');
  eq('  with the inserted words',
     segs.find((s) => s.type === 'ins')?.text, 'and sustainable aviation fuel');

  // The same passage, rendered as some *other* clause, must take no marks —
  // this is what stops "in subparagraph (A), by striking ``or'' at the end"
  // drawing a strikethrough three subsections away.
  const elsewhere = createRedline(ams[0].ops).apply(law, '(3)(B)(vi)');
  eq('  and nothing is drawn outside that scope', elsewhere.filter((s) => s.type !== 'keep').length, 0);
}

// ------------------------------------------- the Code respells what bills write
// The same words, set by two different hands. A bill hard-wraps at 72 columns,
// writes a nested quote with singles and a number with a hyphen; the Code closes
// the wrap, prints curly doubles and an en dash, and renumbers every
// cross-reference into its own scheme. Nothing in the sentence says which of the
// two spellings is on screen, so the strict test answers "not there" and the app
// draws the identical sentence a second time in the insertion colour — 55 of 484
// green inserts, the top of the list holding every word already.
section('the Code respells what bills write');
{
  const { fold, createRedline } = await imp('app/ui/redline.js');
  const f = (s) => fold(s).norm;

  eq('a hyphen the measure broke a word across closes up',
     f('wildlife-\n            vehicle collisions'), f('wildlife-vehicle collisions'));
  eq('  but a suspended hyphen keeps its space',
     f('pre-\n            and post-award'), 'pre- and post-award');
  eq('a nested single quote is the Code\'s double',
     f('(referred to in this section as the `Secretary\')'),
     f('(referred to in this section as the “Secretary”)'));
  eq('a hyphen between digits is the Code\'s en dash',
     f('Public Law 115-282'), f('Public Law 115–282'));
  eq('  and between letters it is left alone', f('PAY-AS-YOU-GO'), 'pay-as-you-go');

  // The substance. The bill names the Social Security Act's own § 1861; the Code
  // prints 42 U.S.C. 1395x and tags it "of this title". The subsection path
  // survives the translation and the number does not, which is what makes this
  // safe to match loosely: the path is compared exactly, so a reference to some
  // other provision cannot satisfy it.
  const enacted =
    'or, in the case of services described in subparagraph (C), a physician, ' +
    'a nurse practitioner or clinical nurse specialist (as those terms are ' +
    'defined in section 1395x(aa)(5) of this title) who is working in ' +
    'accordance with State law, who is enrolled under this part;';
  const nurse = {
    id: 'o1', type: 'insert', start: 0, end: 1, anchor: 'a physician', relation: 'after',
    text: ', a nurse practitioner or clinical nurse specialist (as those terms are ' +
          'defined in section 1861(aa)(5)) who is working in accordance with State law',
  };
  const drawn = createRedline([nurse]).apply(enacted, '');
  eq('language the Code respelled is marked as already in force',
     drawn.filter((s) => s.type === 'was').length, 1);
  eq('  and not drawn a second time as a pending insertion',
     drawn.filter((s) => s.type === 'ins').length, 0);
  ok('  the mark carries the LAW\'s spelling of the reference',
     /section 1395x\(aa\)\(5\) of this title/.test(drawn.find((s) => s.type === 'was')?.text || ''),
     drawn.find((s) => s.type === 'was')?.text);

  // The OLRC's other two interpolations. A footnote reference is set as a bare
  // numeral in the flow of the sentence and a Code translation is bracketed after
  // an Act reference; `itertext()` cannot tell either from a word, so both arrive
  // inside the language the bill wrote and hide an otherwise exact match.
  const footnoted =
    'civil money penalties of not more than $25,000 for each determination under ' +
    'paragraph (1), except with respect to a determination under subparagraph (E),1 ' +
    'an assessment of not more than the amount claimed by such plan or plan sponsor ' +
    'based upon the misrepresentation or falsified information involved, and';
  const penalty = {
    id: 'o2', type: 'insert', start: 0, end: 1, anchor: 'paragraph (1)', relation: 'after',
    text: ', except with respect to a determination under subparagraph (E), an assessment of ' +
          'not more than the amount claimed by such plan or plan sponsor based upon the ' +
          'misrepresentation or falsified information involved',
  };
  const footed = createRedline([penalty]).apply(footnoted, '');
  eq('a footnote numeral in the flow of the sentence does not hide the match',
     footed.filter((s) => s.type === 'was').length, 1);
  eq('  and the sentence is not drawn a second time', footed.filter((s) => s.type === 'ins').length, 0);

  // An option may ADMIT a numeral the bill did not write. It may never excuse one
  // it did — a rewrite that changes a figure is the commonest rewrite there is.
  const rate = 'the tax imposed under this section shall be not more than 7 percent of the amount involved';
  const changed = {
    id: 'o3', type: 'insert', start: 0, end: 1, anchor: 'this section', relation: 'after',
    text: ' shall be not more than 5 percent of the amount involved',
  };
  eq('a substituted figure is still a change, not a match',
     createRedline([changed]).apply(rate, '').filter((s) => s.type === 'was').length, 0);

  // GPO opens every paragraph of a multi-paragraph operand with a quote mark.
  // Those are structure, not words — the law has none of them — so an operand
  // spanning two paragraphs could never be found.
  const lawPara =
    'The amount is equal to— (I) for a year preceding 2024, the greater of the ' +
    'amount described in clause (ii) or 5 percent.';
  const block = {
    id: 'b1', type: 'insert', start: 0, end: 1, anchor: 'The amount', relation: 'after',
    text: ' is equal to--\n``(I) for a year preceding 2024, the greater of the ' +
          'amount described in clause (ii) or 5 percent',
  };
  eq('a multi-paragraph operand is found past its own quote openers',
     createRedline([block]).apply(lawPara, '').filter((s) => s.type === 'was').length, 1);

  // A punctuation strike AT THE END whose replacement now sits at the end. Once
  // the amendment has been made the period is gone, so the strike cannot land
  // and nothing else can see that this has plainly happened.
  const item = '(2) $10,000,000 for each of fiscal years 2014 through 2018; and';
  const known = new Set(['', '(e)', '(e)(1)', '(e)(2)']);
  const repunct = (scope) => [
    { id: 's9', type: 'strike', start: 10, end: 11, scope: '(e)(2)', atEnd: true,
      operand: '.', text: 'striking the period at the end' },
    { id: 'i9', type: 'insert', start: 12, end: 13, scope, replaces: 10, text: '; and' },
  ];
  const repunctuated = createRedline(repunct('(e)(2)'), undefined, known).apply(item, '(e)(2)');
  eq('a punctuation strike whose replacement already ends the passage is in force',
     repunctuated.filter((s) => s.type === 'was').length, 1);
  eq('  and neither half is drawn as a pending change',
     repunctuated.filter((s) => s.type === 'del' || s.type === 'ins').length, 0);
  // …and only in the passage the STRIKE names. Every item in a list ends with
  // the same connective, so an ancestor scope would mark the first sibling — the
  // one paragraph the instruction is not talking about.
  eq('  and not in a sibling that happens to end the same way',
     createRedline(repunct('(e)'), undefined, known).apply(item, '(e)(1)')
       .filter((s) => s.type === 'was').length, 0);

  // …but NOT where the renumbering IS the amendment. Both sides abstract to the
  // same thing, so a change nobody has made would report itself made.
  const renum =
    'The Secretary shall make payment to the eligible home infusion therapy ' +
    'supplier described in section 1234 of this title for each item furnished.';
  const ops = [
    { id: 's1', type: 'strike', start: 0, end: 1,
      text: 'payment to the eligible home infusion therapy supplier described in section 1234' },
    { id: 'i1', type: 'insert', start: 2, end: 3, replaces: 0,
      text: 'payment to the eligible home infusion therapy supplier described in section 5678' },
  ];
  const renumbered = createRedline(ops).apply(renum, '');
  eq('an amendment that only renumbers a reference is still pending',
     renumbered.filter((s) => s.type === 'was').length, 0);
  eq('  so the strike and its replacement are both drawn',
     renumbered.filter((s) => s.type === 'del').length + renumbered.filter((s) => s.type === 'ins').length, 2);

  // …and the BLOCK-addition side of the same rule. `alreadyIn()` compares an
  // exact 80-character prefix and was never given any of this, so every
  // respelling above defeated it: 418 green block additions were being drawn
  // into provisions that already contain them.
  const listLaw =
    'The following are excluded: (35) tobacco cessation counselling; and ' +
    '(36) vaccines described in section 1396d(a)(13)(B) of this title and the ' +
    'administration of such vaccines, subject to the requirements of this subsection; and';
  const addOp = (t) => ({ id: 'z1', type: 'add-at-end', start: 0, end: 1, scope: '', text: t });
  eq('a block addition the Code respells is recognised as already in the law',
     createRedline([addOp(
       '(36) vaccines described in section 1905(a)(13)(B) and the administration of ' +
       'such vaccines, subject to the requirements of this subsection.'
     )], [listLaw]).appliedAdditions().length, 1);
  eq('  and one the law does not contain is still an addition',
     createRedline([addOp(
       '(37) hearing aids described in section 1905(a)(29) and the fitting of such ' +
       'devices, subject to the requirements of this subsection.'
     )], [listLaw]).appliedAdditions().length, 0);
}

// ------------------------------------------------- internal cross-references
// The commonest citation kind in a modern bill — 162 of the 164 internal refs
// in the CLARITY Act's House print are the bare "clause (ii)" form — and until
// now clicking one produced a sentence restating what had been clicked. They
// resolve inside the bill, so the answer is to go and show the provision.
section('internal cross-references');
{
  const { locateInternal } = await imp('app/resolve/internal.js');

  // The shape that decides the algorithm. Two sibling subparagraphs, each with
  // its own (i)/(ii), quoted as inserted law — so the markers sit behind quote
  // marks and, as in a PDF, carry no indentation to nest by.
  const t = normalizeText(
    'SEC. 2. DEFINITIONS.\n' +
    'Section 1a of the Commodity Exchange Act is amended by adding at the end the following:\n' +
    "``(A) ASSOCIATED PERSON OF A BROKER.--\n" +
    "``(i) IN GENERAL.--Except as provided in clause (ii), the term means a partner.\n" +
    "``(ii) EXCLUSION.--The term 'associated person of a broker' does not include a clerk.\n" +
    "``(B) ASSOCIATED PERSON OF A DEALER.--\n" +
    "``(i) IN GENERAL.--Except as provided in clause (ii), the term means an officer.\n" +
    "``(ii) EXCLUSION.--The term 'associated person of a dealer' does not include a janitor.\n"
  );
  const bill = parseBill(t);
  const cs = extractCitations(t);
  const refs = cs.filter((c) => c.kind === 'internal' && c.subsection === '(ii)');
  eq('finds both "clause (ii)" references', refs.length, 2);

  // Each must find the (ii) under ITS OWN parent. Picking the nearest match
  // instead sends the second one backwards into subparagraph (A) — it looks
  // reasonable, and it is wrong, because a reference points forward as often as
  // back and the nearest sibling is routinely somebody else's.
  const first = locateInternal(bill, refs[0]);
  const second = locateInternal(bill, refs[1]);
  ok('the reference in (A) finds (A)(ii)', t.slice(first.start, first.start + 60).includes('broker'),
     JSON.stringify(t.slice(first.start, first.start + 60)));
  ok('the reference in (B) finds (B)(ii)', t.slice(second.start, second.start + 60).includes('dealer'),
     JSON.stringify(t.slice(second.start, second.start + 60)));
  ok('  and they are different provisions', first.start !== second.start, `both at ${first.start}`);
  ok('  each unambiguous inside its own parent', !first.ambiguous && !second.ambiguous,
     `${first.why} / ${second.why}`);
  ok('  and neither is a guess', !first.guess && !second.guess, `${first.guess} / ${second.guess}`);

  // ---- a guess is flagged as one ----------------------------------------
  // Where nothing at the referenced level exists inside the enclosing
  // provision, the match comes from outside the scope the reference governs.
  // That is a different degree of doubt from "several candidates in the right
  // parent", and collapsing the two into one flag undersells the worse of them:
  // 1,581 references across the corpus resolve this way. The user's call is to
  // keep guessing and say so, so the pane heads the card "Best guess — may be
  // the wrong provision" and the bill marks the paragraph `jump-guess`.
  const strayText = normalizeText(
    'SEC. 4. RULES.\n' +
    '(a) FIRST.--\n' +
    '    (1) alpha.\n' +
    '    (2) beta.\n' +
    '(b) SECOND.--\n' +
    '    The Secretary shall act under clause (vii) as required.\n'
  );
  const strayBill = parseBill(strayText);
  const stray = extractCitations(strayText)
    .find((c) => c.kind === 'internal' && c.subsection === '(vii)');
  const strayLoc = stray && locateInternal(strayBill, stray);
  eq('a reference with nothing at its level in the parent declines or guesses',
     strayLoc ? Boolean(strayLoc.guess) : 'declined', 'declined');

  // The same shape, but with a (vii) elsewhere in the section to be found.
  const guessText = normalizeText(
    'SEC. 4. RULES.\n' +
    '(a) FIRST.--\n' +
    '    (vii) the seventh clause.\n' +
    '(b) SECOND.--\n' +
    '    The Secretary shall act under clause (vii) as required.\n'
  );
  const guessBill = parseBill(guessText);
  const gref = extractCitations(guessText)
    .find((c) => c.kind === 'internal' && c.subsection === '(vii)');
  const gloc = gref && locateInternal(guessBill, gref);
  eq('a match found outside the enclosing provision is marked a guess',
     gloc && gloc.guess, true);
  eq('  and ambiguous with it', gloc && gloc.ambiguous, true);
  ok('  saying so in words, not only in a flag',
     /no \(vii\) inside the enclosing provision at all/i.test(gloc.why), gloc.why);
  // Nearest-match would have chosen the (ii) above the second reference.
  ok('  the second did not jump backwards', second.start > refs[1].start,
     `ref at ${refs[1].start}, target at ${second.start}`);

  // A path descends: "(B)(ii)" must land on (ii) inside (B), not on any (ii).
  const t2 = normalizeText(
    'SEC. 3. RULES.\n' +
    "``(A) FIRST.--\n``(ii) alpha provision.\n" +
    "``(B) SECOND.--\n``(ii) beta provision.\n" +
    'The Secretary shall apply subparagraph (B)(ii) in all cases.\n'
  );
  const b2 = parseBill(t2);
  const path = extractCitations(t2).find((c) => c.kind === 'internal' && c.subsection === '(B)(ii)');
  const hit = locateInternal(b2, path);
  ok('a two-marker path descends into the right parent',
     t2.slice(hit.start, hit.start + 30).includes('beta'),
     JSON.stringify(t2.slice(hit.start, hit.start + 30)));

  // "section 4 of this Act" names a section of the bill outright.
  const t3 = normalizeText('SECTION 1. SHORT TITLE.\nThis is section one.\nSEC. 4. FUNDING.\nAs described in section 4 of this Act, funds are provided.\n');
  const b3 = parseBill(t3);
  const actRef = extractCitations(t3).find((c) => c.kind === 'internal' && c.scope === 'act');
  const s4 = locateInternal(b3, actRef);
  eq('"section 4 of this Act" finds that bill section', s4 && s4.section.num, '4');
  ok('  and labels it', /FUNDING/.test(s4.label), s4.label);

  // ---- a section number is not unique, on the resolving side --------------
  // Every division of an appropriations act restarts its numbering, so H.J.
  // Res. 31 has six Sec. 505s and taking the first by number answered from
  // division A for a reference written in division C. 81 across the corpus,
  // none of them hedged — the pane said a flat "Section 505 of this bill."
  // The bills state the rule themselves: "any reference to ``this Act''
  // contained in any division of this Act shall be treated as referring only
  // to the provisions of that division."
  const omni = normalizeText(
    'DIVISION A--FIRST\n\nSEC. 101. ALPHA.\nThe alpha provision.\n\n' +
    'SEC. 505. AVAILABILITY.\nDivision A money rules.\n\n' +
    'DIVISION C--THIRD\n\nSEC. 505. LIMITATION.\nDivision C money rules.\n\n' +
    'SEC. 720. REFERENCE.\nSubject to section 505 of this Act, funds are provided.\n'
  );
  const ob = parseBill(omni);
  const oref = extractCitations(omni).filter((c) => c.kind === 'internal' && c.section === '505').pop();
  const oloc = locateInternal(ob, oref);
  ok('"section N of this Act" resolves inside its own division',
     oloc && /LIMITATION/.test(oloc.label), oloc && oloc.label);
  // A bill with no divisions must be unaffected: first-by-number is all there is.
  const flatBill = normalizeText(
    'SECTION 1. SHORT TITLE.\nOne.\n\nSEC. 505. ONLY.\nThe only 505.\n\n' +
    'SEC. 9. REF.\nSubject to section 505 of this Act, funds are provided.\n'
  );
  const fb = parseBill(flatBill);
  const fref = extractCitations(flatBill).find((c) => c.kind === 'internal' && c.section === '505');
  ok('  and a bill with no divisions is unaffected',
     /ONLY/.test(locateInternal(fb, fref).label), locateInternal(fb, fref).label);

  // ---- a unit phrase that names its own section is not internal -----------
  // "Subsection (g) of section 6695 is amended" — RE_INTERNAL matched the head
  // unit and had no lookahead, so "of section 6695" was discarded and the bare
  // "(g)" was hunted down somewhere in the bill. 1,460 across the corpus, 616
  // answered with no hedge at all. The address is external and the amendment
  // head already reads it; the chip was purely a wrong answer.
  const unitOf = normalizeText(
    'SEC. 2. X.\n(g) Something else entirely.\nSubsection (g) of section 6695 is amended to read as follows.\n'
  );
  eq('a unit phrase naming its own section is not an internal reference',
     extractCitations(unitOf).filter((c) => c.kind === 'internal' && c.subsection === '(g)').length, 0);
  // Except where the bill says the section is its own, which IS an address
  // inside the bill and is ownRef rather than dropped.
  const ownSec = normalizeText(
    'SECTION 1. SHORT TITLE.\nOne.\n\nSEC. 503. RULES.\n(a) The first rule.\n(b) The second.\n\n' +
    'SEC. 9. REF.\nNotwithstanding subsection (a) of section 503 of this Act, funds are provided.\n'
  );
  const ob2 = parseBill(ownSec);
  const ownRef = extractCitations(ownSec)
    .find((c) => c.kind === 'internal' && c.refType === 'section' && c.section === '503');
  eq('  but "of section N of this Act" composes into one address',
     ownRef && ownRef.subsection, '(a)');
  ok('  spanning the whole phrase',
     ownRef && /^subsection \(a\) of section 503 of this Act$/.test(ownRef.text),
     JSON.stringify(ownRef && ownRef.text));
  const cloc = ownRef && locateInternal(ob2, ownRef);
  ok('  and landing on that subsection',
     cloc && /first rule/.test(ownSec.slice(cloc.start, cloc.start + 40)),
     JSON.stringify(cloc && ownSec.slice(cloc.start, cloc.start + 40)));

  // New law refers to itself. A paragraph the bill is adding says "For purposes
  // of subparagraph (A)", meaning subparagraph (A) OF THE PARAGRAPH BEING ADDED
  // — which does not exist in the Code yet. Composed against the instruction's
  // target it became 7 U.S.C. 8101(3)(A): a real provision, about something
  // else. Reported from the Farm to Fly Act, whose inserted definition does this
  // twice. The reference must stay internal and resolve inside the bill.
  const inserted = normalizeText(
    'SEC. 3. DEFINITIONS.\n' +
    'Section 9001 of the Farm Security and Rural Investment Act of 2002 (7 U.S.C. 8101) is amended--\n' +
    '    (1) in paragraph (3)(B), by striking ``a\'\'; and\n' +
    '    (2) by adding at the end the following:\n' +
    '            ``(18) Sustainable aviation fuel.--\n' +
    '                    ``(A) In general.--The term means liquid fuel which--\n' +
    '                            ``(iv) has been certified in accordance \n' +
    '                        with subparagraph (B)(iii) as having a \n' +
    '                        reduction of at least 50 percent.\n' +
    '                    ``(B) Other definitions.--For purposes of \n' +
    '                subparagraph (A):\n' +
    '                            ``(iii) Lifecycle greenhouse gas.--The term means x.\'\'.\n'
  );
  const ib = parseBill(inserted);
  const ic = extractCitations(inserted);
  const ia = extractAmendments(inserted, ic, ib.divisions);
  const ix = expandRelativeRefs(ic, ia);
  const composed = ix.filter((c) => c.relative).map((c) => `${c.section}${c.subsection}`);
  ok('a reference inside inserted law is not composed into the Code',
     !composed.includes('8101(3)(A)') && !composed.includes('8101(3)(B)(iii)'),
     JSON.stringify(composed));
  // …and the instruction's own navigation still is.
  ok('  while the instruction\'s own navigation still is', composed.includes('8101(3)(B)'),
     JSON.stringify(composed));
  // …and it lands on the right place in the quoted block.
  const selfRef = ix.find((c) => c.kind === 'internal' && /subparagraph \(A\)/.test(c.text));
  const where = selfRef && locateInternal(ib, selfRef);
  ok('  it resolves to the subparagraph in the inserted block',
     where && /In general/.test(inserted.slice(where.start, where.start + 40)),
     JSON.stringify(where && inserted.slice(where.start, where.start + 40)));

  // A reference to something that isn't in the bill must return nothing, so the
  // pane can say so instead of highlighting an unrelated paragraph.
  const t4 = normalizeText('SEC. 5. X.\nAs provided in section 99 of this Act, nothing happens.\n');
  const b4 = parseBill(t4);
  const gone = extractCitations(t4).find((c) => c.kind === 'internal' && c.scope === 'act');
  eq('a reference to a missing section resolves to nothing', locateInternal(b4, gone), null);

  // ---- "Subsection (c) of such section is amended" -----------------------
  // RE_AMEND_HEAD needs "section <number>", and here the number is exactly what
  // has been elided. 130 instructions in the NDAA alone were not seen at all —
  // not mis-targeted, invisible — and their operations sat outside any parsed
  // amendment, which is where the corpus's `uncoveredVerbs` count came from.
  {
    const ts = normalizeText(
      'SEC. 123. FOO.\n' +
      "    (a) In General.--Section 2401 of title 10, United States Code, is amended by striking ``old'' and inserting ``new''.\n" +
      "    (b) Conforming.--Subsection (c) of such section is amended by striking ``red''.\n" +
      "    (c) More.--Paragraph (2) of such subsection is amended by striking ``x''.\n"
    );
    const as = extractAmendments(ts, extractCitations(ts));
    eq('all three instructions are seen', as.length, 3);
    eq('  "of such section" takes the previous target\'s section',
       `${as[1].target.title} USC ${as[1].target.section}${as[1].target.subsection}`, '10 USC 2401(c)');
    // "such section" REPLACES the sub-path; "such subsection" descends into it.
    // Getting that backwards composes (c)(2) as (2), or as (c)(c)(2).
    eq('  "of such subsection" descends into it',
       `${as[2].target.title} USC ${as[2].target.section}${as[2].target.subsection}`, '10 USC 2401(c)(2)');
    ok('  and says the target was carried, not written',
       /carried from the instruction/.test(as[1].target.implied || ''), as[1].target.implied);

    // An instruction in between breaks the chain. "such" means the instruction
    // immediately before; reaching past one that named something else attaches
    // a real amendment to a section the bill was no longer talking about.
    const tb = normalizeText(
      'SEC. 123. FOO.\n' +
      "    (a) Section 2401 of title 10, United States Code, is amended by striking ``old''.\n" +
      "    (b) The Clean Air Act is amended by striking ``smog''.\n" +
      "    (c) Subsection (c) of such section is amended by striking ``red''.\n"
    );
    const ab = extractAmendments(tb, extractCitations(tb));
    const last = ab[ab.length - 1];
    ok('an intervening instruction breaks the chain',
       !last.target || !/carried from the instruction/.test(last.target.implied || ''),
       JSON.stringify(last.target && last.target.implied));

    // "10 U.S.C. 1580 note" is not section 1580 — a note is uncodified law
    // printed beneath it. Composing a subsection onto that spreads a wrong
    // answer to every instruction that refers back.
    const tn = normalizeText(
      'SEC. 123. FOO.\n' +
      "    (a) Section 235(a) of the National Defense Authorization Act for Fiscal Year 2020 (10 U.S.C. 1580 note) is amended by striking ``old''.\n" +
      "    (b) Subsection (b) of such section is amended by striking ``red''.\n"
    );
    const an = extractAmendments(tn, extractCitations(tn));
    const noteCite = extractCitations(tn).find((c) => c.kind === 'usc');
    eq('a "U.S.C. N note" citation is flagged as a note', noteCite.note, true);
    ok('  and cannot be carried forward by "such"',
       !an[an.length - 1].target ||
         !/carried from the instruction/.test(an[an.length - 1].target.implied || ''),
       JSON.stringify(an[an.length - 1].target && an[an.length - 1].target.implied));
    // A plain citation must not be flagged.
    const plainCite = extractCitations(
      normalizeText('SEC. 2. X.\nSection 2401 of title 10, United States Code, is amended.\n')
    ).find((c) => c.kind === 'usc');
    eq('an ordinary U.S.C. citation is not a note', plainCite.note, false);
  }

  // ---- "section N of Public Law X-Y" -------------------------------------
  // A Public Law used to be an outbound link and nothing else. But the Code's
  // source credits file a law under its own number just as readily as under a
  // name — "Pub. L. 113–79, title XII, § 12306" is 7 U.S.C. 1632c — and the
  // ingester already wrote 1,737 of them into data/usc/acts/. Nothing had to be
  // downloaded; the index was on disk the whole time.
  if (haveShard('data/usc/acts', 'pub_l_113_79')) {
    // The shards are static files on disk here, not behind a server; the
    // resolver fetches them by relative URL. Same shim as the USC block below.
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
    const { resolve } = await imp('app/resolve/index.js');
    const t = normalizeText(
      'SEC. 2. X.\nOf that amount, $4,000,000 shall be available for the purposes of ' +
      'section 12306 of Public Law 113-79, and section 4 of Public Law 116-6 applies.\n'
    );
    const pubs = extractCitations(t).filter((c) => c.kind === 'publaw');
    eq('finds both Public Law citations', pubs.length, 2);
    // The span must cover the section too, or the chip says "Public Law 113-79"
    // while resolving to a specific provision of it.
    ok('the citation spans "section N of Public Law X-Y"',
       pubs[0].text.startsWith('section 12306 of'), JSON.stringify(pubs[0].text));
    eq('  and carries the Act-relative number', pubs[0].actSection, '12306');

    const hit = await resolve(pubs[0]);
    eq('a codified section resolves to the Code', hit.citation, '7 U.S.C. 1632c');
    eq('  and says how it got there', hit.viaActSection.codified, '7 U.S.C. 1632c');
    ok('  landing on the right provision', /Acer access/i.test(hit.heading || ''),
       JSON.stringify(hit.heading));

    // Most of a Public Law is never codified. Section 4 of the Consolidated
    // Appropriations Act, 2019 is an appropriations provision with no Code
    // section to point at, and inventing one would be worse than the link.
    // ---- and where the Code cannot answer, the law's own text -------------
    // Most of a Public Law is never codified: 507 citations across the corpus
    // name a section and only 174 are in the Code. The other 333 are
    // appropriations lines, effective dates and savings clauses that exist
    // nowhere but the law itself, which is what data/plaw holds.
    if (haveShard('data/plaw/116-6', 'manifest')) {
      // Section 4 of the Consolidated Appropriations Act, 2019 is a statement
      // of appropriations. There is no Code section and never will be.
      const enacted = await resolve(pubs[1]);
      eq('an uncodified section falls back to the enacted text',
         enacted.source, 'Public Law (as enacted)');
      eq('  naming the law and the section', enacted.citation, 'Pub. L. 116-6 § 4');
      ok('  and carrying its real text',
         /STATEMENT OF APPROPRIATIONS/i.test(enacted.plaw.entries[0].text),
         JSON.stringify(enacted.plaw.entries[0].text.slice(0, 80)));

      // A section number is not unique in a Public Law. Every division of an
      // appropriations act restarts at 101, and the citation does not say
      // which was meant — so all of them are returned rather than the first.
      const many = extractCitations(
        normalizeText('SEC. 2. X.\nFunds under section 101 of Public Law 116-6 shall be used.\n')
      ).find((c) => c.kind === 'publaw');
      const multi = await resolve(many);
      eq('a repeated section number returns every one of them',
         multi.plaw.entries.length, 6);
      ok('  each under its own division',
         new Set(multi.plaw.entries.map((e) => e.ancestors[0])).size === 6,
         multi.plaw.entries.map((e) => e.ancestors[0]).join(' | '));

      // A law named with no section names the whole Act, not a provision.
      const whole = extractCitations(
        normalizeText('SEC. 2. X.\nNothing in Public Law 116-136 applies here.\n')
      ).find((c) => c.kind === 'publaw');
      const law = await resolve(whole);
      eq('a bare Public Law gives its contents', law.plaw.entries, null);
      ok('  which is its whole table of contents', law.plaw.toc.length === law.plaw.total,
         `${law.plaw.toc.length} of ${law.plaw.total}`);

      // A section that does not exist is still a link. No guessing.
      const nope = extractCitations(
        normalizeText('SEC. 2. X.\nUnder section 9999 of Public Law 116-6 nothing happens.\n')
      ).find((c) => c.kind === 'publaw');
      eq('a section the law does not have still declines', (await resolve(nope)).external, true);

      // The editorial apparatus govinfo wraps around a Public Law must not
      // survive into the text: "SEC. 3. <<NOTE: 1 USC 1 note.>>  REFERENCES TO
      // ACT." is a heading with a citation wedged through it.
      const idx = readShard('data/plaw/116-6', 'manifest');
      ok('no <<NOTE:>> marker survives ingest', !JSON.stringify(idx).includes('<<NOTE'));
      eq('  and the heading it was inside is clean',
         idx.toc.find((t) => t.num === '3').heading, 'REFERENCES TO ACT');
    }
  // ---- Acts wired to the source-credit index ------------------------------
  // 157 of the 185 popular names carry `enactedAs`, against 4 originally. None
  // was typed: for each entry the ingested Act index was searched for the one
  // act whose sections include that entry's own head, keeping at least 80% of
  // its mappings inside the entry's title. Landmarks, because they are
  // checkable by anyone: these are the provisions these section numbers are
  // famous for.
  {
    const { resolveActSection } = await imp('app/resolve/act-sections.js');
    const { POPULAR_NAMES } = await imp('app/resolve/popular-names.js');
    // 178 rather than 180: three harvested entries took the sentence in front
    // of the name with them and were removed, two of them trimmed into one
    // clean SIPA entry. See the containment check below.
    ok('the table has grown past 178 names', POPULAR_NAMES.length >= 178, `${POPULAR_NAMES.length}`);
    ok('  and most of them resolve their own section numbers',
       POPULAR_NAMES.filter((a) => a.enactedAs).length >= 150,
       `${POPULAR_NAMES.filter((a) => a.enactedAs).length} with enactedAs`);
    // Every entry must have a name and a pattern, or it matches text and then
    // resolves to nothing. An ANCHOR is optional and must be all-or-nothing: a
    // name that covers twenty Public Laws has no first section to stand behind,
    // and recording one made the pane print an unrelated provision under
    // "shown below is its first section". Half an anchor is still malformed.
    const malformed = POPULAR_NAMES.filter(
      (a) => !a.name || !a.pattern || Boolean(a.title) !== Boolean(a.section)
    );
    eq('  every entry carries name and pattern, and a whole anchor or none',
       malformed.length, 0, JSON.stringify(malformed.map((a) => a.name)));
    // The ones that deliberately have none, so the count cannot drift silently.
    eq('  three entries name a law with no single head',
       POPULAR_NAMES.filter((a) => !a.title).map((a) => a.name).sort().join(' | '),
       'Inflation Reduction Act of 2022 | Infrastructure Investment and Jobs Act | ' +
         'National Defense Authorization Act');
    // A harvested name can run into the sentence around it, and the tell is
    // that the name ENDS with another entry's name behind a connective or a
    // sentence break: "Bankruptcy Code or the Securities Investor Protection
    // Act of 1970", "Securities Exchange Act of 1934.--The Securities Exchange
    // Act of 1934". The chip then opens on words that are not the Act's name,
    // and where the break was a section heading it drew body text inside the
    // .sec-head. Legitimate containment is the other way round — a longer name
    // with the shorter as a PREFIX ("… Act" / "… Act of 1975"), or a real
    // qualifier ("Richard B. Russell National School Lunch Act"), neither of
    // which puts a connective in front of the contained name.
    const RUN_ON = /(?:^|[\s.,;:-])(?:or|and|the|a|an|of|in|to|by|for|under|The)\s+$|(?:--|[—–])\s*\w*\s*$/;
    const runOn = POPULAR_NAMES.filter((a) =>
      POPULAR_NAMES.some(
        (b) => b !== a && b.name.length > 15 && a.name.endsWith(b.name) &&
               RUN_ON.test(a.name.slice(0, a.name.length - b.name.length))
      )
    );
    eq('  and no name runs on from the sentence in front of it',
       runOn.length, 0, JSON.stringify(runOn.map((a) => a.name)));

    // A pattern is spliced into a \b…\b match, so a capturing group inside one
    // would shift every later group in the composed regexes.
    const capturing = POPULAR_NAMES.filter((a) => /\((?!\?)/.test(a.pattern));
    eq('  and no pattern introduces a capturing group', capturing.length, 0);

    const LANDMARKS = [
      // Added 2026-08-03 and derived, not typed — each was cross-checked against
      // the Code's own credit after the bills' parentheticals disagreed. In every
      // one of those the bill had cited the Act's head, an et seq. range, or a
      // FORMER section number, and the derivation was right.
      ['Federal Deposit Insurance Act', '15', '12', '1825'],   // credit is "§ 2[15]"
      ['Federal Insecticide, Fungicide, and Rodenticide Act', '3', '7', '136a'],
      ['Gramm-Leach-Bliley Act', '502', '15', '6802'],         // privacy notices
      ['Fair Credit Reporting Act', '624', '15', '1681s-3'],   // affiliate sharing
      ['Surface Mining Control and Reclamation Act of 1977', '410', '30', '1240'],
      ['Federal Power Act', '215', '16', '824o'],              // reliability standards
      ['Omnibus Crime Control and Safe Streets Act of 1968', '302', '34', '10132'],
      ['Family and Medical Leave Act of 1993', '102', '29', '2612'],  // leave entitlement
      ['Clean Water Act', '404', '33', '1344'],           // dredge-and-fill permits
      ['Endangered Species Act of 1973', '7', '16', '1536'],   // interagency consultation
      ['National Environmental Policy Act of 1969', '102', '42', '4332'], // the EIS
      ['Americans with Disabilities Act of 1990', '3', '42', '12102'],
      ['Rehabilitation Act of 1973', '504', '29', '794'],
      ['National Labor Relations Act', '7', '29', '157'],
      ['Balanced Budget and Emergency Deficit Control Act of 1985', '251', '2', '901'],
    ];
    // The Code spells a dashed section number with an EN DASH ("1681s–3") and
    // everyone else writes an ASCII hyphen. slug() exists to make the two reach
    // the same shard, so the assertion absorbs the difference the same way —
    // encoding one spelling here would fail on a correct answer.
    const sameSection = (a, b) => a.replace(/[–—]/g, '-') === b.replace(/[–—]/g, '-');
    for (const [name, sec, t, s] of LANDMARKS) {
      const act = POPULAR_NAMES.find((e) => e.name === name);
      const at = act && (await resolveActSection(act, sec));
      const got = at ? `${at.title} U.S.C. ${at.section}` : String(at);
      ok(`${name} § ${sec} is ${t} U.S.C. ${s}`, sameSection(got, `${t} U.S.C. ${s}`), got);
    }

    // ---- a title of an Act is a range, and the credits say which ----------
    // This was written off as unresolvable — the Act index maps an Act's
    // SECTIONS onto the Code and appeared to know nothing about its titles. It
    // knows: the credit states the title in the same breath as the section,
    // "(July 15, 1949, ch. 338, title V, § 501, …)", so the ingester inverts
    // both. 857 Acts carry a title index over 2,222 titles; 697 citations across
    // the corpus, 690 of which now reach the title's sections instead of the
    // head of the Act.
    //
    // Landmarks, because they are the only check worth running here — these are
    // the titles these numbers are famous for, and anyone can verify them.
    const { resolveActTitle } = await imp('app/resolve/act-sections.js');
    for (const [name, t, wantTitle, wantSec] of [
      ['Social Security Act', 'XVIII', '42', '1395'],   // Medicare
      ['Social Security Act', 'XIX', '42', '1396'],     // Medicaid
      ['Social Security Act', 'II', '42', '401'],       // old-age insurance
      ['Clean Air Act', 'V', '42', '7661'],             // operating permits
      ['Clean Air Act', 'II', '42', '7521'],            // mobile sources
      ['Higher Education Act of 1965', 'IV', '20', '1070'],  // student aid
      ['Elementary and Secondary Education Act of 1965', 'I', '20', '6301'],
    ]) {
      const act = POPULAR_NAMES.find((e) => e.name === name);
      const got = act && (await resolveActTitle(act, t));
      eq(`${name} title ${t} begins at`, got && got[0], `${wantTitle}:${wantSec}`);
    }
    // A title that does not exist is a decline, not a guess.
    eq('a title the Act does not have declines',
       await resolveActTitle(POPULAR_NAMES.find((e) => e.name === 'Clean Air Act'), 'XCIX'), null);

    // The citation spans the title, and resolves to the range rather than the
    // head of the Act.
    const titleCite = extractCitations(
      normalizeText('SEC. 2. X.\nUnder title V of the Clean Air Act, permits are required.\n')
    ).find((c) => c.kind === 'act');
    eq('a title citation spans the title', titleCite && titleCite.text, 'title V of the Clean Air Act');
    eq('  carrying the title', titleCite && titleCite.actTitle, 'V');
    const titleRes = await resolve(titleCite);
    ok('  and resolving to that title\'s sections',
       titleRes.actTitle && titleRes.actTitle.sections.length === 7,
       JSON.stringify(titleRes.actTitle && titleRes.actTitle.sections.length));
    eq('  not to the head of the Act', Boolean(titleRes.isActStart), false);

    // A named section beats a named title, the same rule a named division
    // follows: answering with the title's contents hands back a list when the
    // citation named one of them.
    const secInTitle = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 501 of title V of the Clean Air Act, permits apply.\n')
    ).find((c) => c.kind === 'act');
    eq('a named section beats a named title', secInTitle && secInTitle.actSection, '501');
    eq('  resolving to the section', (await resolve(secInTitle)).citation, '42 U.S.C. 7661');

    // ---- the subdivision chain --------------------------------------------
    // "section 2118(a) of title II of division A of Public Law 116-136".
    // Congress walks down as many levels as it needs, and matching only the
    // bare "division X of" form lost the citation ENTIRELY rather than
    // partially: with the chain unmatched the whole pattern failed and only
    // "Public Law 116-136" survived, taking the section number with it. 489
    // citations carry a chain; 135 of them are not the plain division form.
    for (const [phrase, want] of [
      ['section 2118(a) of title II of division A of Public Law 116-136', '15 U.S.C. 9034(a)'],
      ['section 4003(b) of division A of Public Law 116-136', '15 U.S.C. 9042(b)'],
      ['section 2118(a) of title II of division A of the CARES Act', '15 U.S.C. 9034(a)'],
    ]) {
      const c = extractCitations(normalizeText(`SEC. 2. X.\nFunds under ${phrase} are available.\n`))
        .find((x) => x.kind === 'publaw' || x.kind === 'act');
      ok(`"${phrase.slice(0, 46)}…" spans the whole phrase`, c && c.text === phrase,
         JSON.stringify(c && c.text));
      eq('  and reads the division out of the chain', c && c.division, 'A');
      eq('  resolving to the provision', (await resolve(c)).citation, want);
    }
    // The credit says "div. A, title II, § 2118", so the division guard had a
    // division to agree with — which is what makes this resolution trustworthy
    // rather than a lucky hit on a repeated number.
    const chained = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 2118(a) of title II of division A of Public Law 116-136.\n')
    ).find((x) => x.kind === 'publaw');
    ok('  landing on the provision the credit names',
       /fraud prevention/i.test((await resolve(chained)).heading || ''),
       (await resolve(chained)).heading);

    // A section and a division together: the section is the specific one.
    // Answering with the division's contents hands back a list of hundreds
    // when the citation named one of them.
    const both = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 5001 of division A of the CARES Act.\n')
    ).find((x) => x.kind === 'act');
    const bothRes = await resolve(both);
    eq('a named section beats a named division', bothRes.citation, 'Pub. L. 116-136 § 5001');
    ok('  and it is the section, not the division listing',
       bothRes.plaw && Array.isArray(bothRes.plaw.entries), JSON.stringify(!!bothRes.plaw));
    // A division with no section still gives the division.
    const divOnly = extractCitations(
      normalizeText('SEC. 2. X.\nUnder division A of the CARES Act.\n')
    ).find((x) => x.kind === 'act');
    const divOnlyRes = await resolve(divOnly);
    eq('a division with no section still gives the division',
       divOnlyRes.citation, 'Pub. L. 116-136, division A');

    // ---- the chain narrows a division-only citation ------------------------
    // With no section number the chain IS the address, and it used to be
    // discarded — worse, the levels below the division sat outside the match,
    // so the chip began after them. Division A of the CARES Act is 186
    // sections; subtitle A of its title II is 16.
    const deep = extractCitations(
      normalizeText('SEC. 2. X.\nUnder subtitle A of title II of division A of the CARES Act.\n')
    ).find((x) => x.kind === 'act');
    eq('a division citation spans the levels below it too',
       deep && deep.text, 'subtitle A of title II of division A of the CARES Act');
    ok('  carrying the whole path, outermost first',
       deep && JSON.stringify(deep.where) === '["DIVISION A","TITLE II","SUBTITLE A"]',
       JSON.stringify(deep && deep.where));
    const deepRes = await resolve(deep);
    eq('  and answering with that subtitle', deepRes.citation,
       'Pub. L. 116-136, division A, title II, subtitle A');
    ok('  which is a fraction of the division',
       deepRes.plaw.toc.length === 16 && divOnlyRes.plaw.toc.length === 186,
       `${deepRes.plaw.toc.length} of ${divOnlyRes.plaw.toc.length}`);

    // ---- the division picks between repeated section numbers ---------------
    // Pub. L. 116-260 has four sections numbered 702, one each in divisions A,
    // E, N and FF. Naming the division settles it — and the pane used to report
    // "the citation does not say which" about a citation that said which.
    const amb = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 702 of Public Law 116-260 nothing changes.\n')
    ).find((x) => x.kind === 'publaw');
    const ambRes = await resolve(amb);
    eq('a bare section number keeps every candidate', ambRes.plaw.entries.length, 4);
    eq('  and reports no narrowing', ambRes.plaw.narrowedBy, null);
    const picked = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 702 of division N of Public Law 116-260 nothing changes.\n')
    ).find((x) => x.kind === 'publaw');
    const pickedRes = await resolve(picked);
    eq('  naming the division leaves one', pickedRes.plaw.entries.length, 1);
    eq('  out of the four', pickedRes.plaw.of, 4);
    eq('  saying which narrowed it', pickedRes.plaw.narrowedBy, 'DIVISION N');
    ok('  and it is that division\'s section',
       /^DIVISION N\b/.test(pickedRes.plaw.entries[0].ancestors[0]),
       pickedRes.plaw.entries[0].ancestors[0]);

    // A division the law does not have is dropped, not obeyed: showing every
    // candidate with the ambiguity stated is honest, showing none would turn a
    // resolvable citation into a dead link on the strength of a bad guess.
    const badDiv = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 702 of division Q of Public Law 116-260 nothing changes.\n')
    ).find((x) => x.kind === 'publaw');
    const badRes = await resolve(badDiv);
    eq('a division that matches nothing falls back to all of them',
       badRes.plaw.entries.length, 4);
    eq('  and does not claim to have narrowed', badRes.plaw.narrowedBy, null);

    // ---- a division of a Public Law, with no section ----------------------
    // "division E of Public Law 110-161" is an address in its own right, and the
    // named-Act path already answered the same shape for "division J of the
    // Infrastructure Investment and Jobs Act". 153 across the corpus kept only
    // the bare law and answered with all of it.
    const plDiv = extractCitations(
      normalizeText('SEC. 2. X.\nAmounts under division N of Public Law 116-260 remain available.\n')
    ).filter((x) => x.kind === 'publaw').sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    eq('a division of a Public Law spans the division too', plDiv && plDiv.text,
       'division N of Public Law 116-260');
    const plDivRes = await resolve(plDiv);
    eq('  answering with that division', plDivRes.citation, 'Pub. L. 116-260, division N');
    const bareLaw = extractCitations(
      normalizeText('SEC. 2. X.\nAmounts under Public Law 116-260 remain available.\n')
    ).find((x) => x.kind === 'publaw');
    ok('  where the bare law still gives the whole law',
       (await resolve(bareLaw)).plaw.total > plDivRes.plaw.total * 5,
       `${(await resolve(bareLaw)).plaw.total} vs ${plDivRes.plaw.total}`);
    // The chain narrows it further, exactly as it does with a section number.
    const plChain = extractCitations(
      normalizeText('SEC. 2. X.\nUnder title VII of division N of Public Law 116-260, funds apply.\n')
    ).filter((x) => x.kind === 'publaw').sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    ok('  and a chain above it narrows further',
       (await resolve(plChain)).plaw.total < plDivRes.plaw.total,
       `${(await resolve(plChain)).plaw.total} vs ${plDivRes.plaw.total}`);

    // ---- the subsection stated in prose, the section in the parenthetical --
    // "subsection (h) of section 502 of the Housing Act of 1949 (42 U.S.C. 1472)"
    // arrives as two halves of one address, and the pane opened the whole
    // section — the complaint that produced defaultScope(). 43 across the corpus.
    const prose = extractCitations(normalizeText(
      'SEC. 2. X.\nIn carrying out subsection (h) of section 502 of the Housing Act ' +
      'of 1949 (42 U.S.C. 1472), the Secretary shall act.\n'
    )).find((x) => x.kind === 'usc');
    eq('a subsection stated in prose reaches the Code citation',
       prose && `${prose.title} U.S.C. ${prose.section}${prose.subsection}`, '42 U.S.C. 1472(h)');
    eq('  and records where it came from', prose && prose.subFromProse, true);
    ok('  spanning the whole address', prose && /^subsection \(h\) of section 502/.test(prose.text),
       JSON.stringify(prose && prose.text));
    // The alternation is consumed, not captured: nothing says which was meant.
    const altSub = extractCitations(normalizeText(
      'SEC. 2. X.\nsubsection (b) or (j) of section 505 of the Federal Food, Drug, and ' +
      'Cosmetic Act (21 U.S.C. 355) applies.\n'
    )).find((x) => x.kind === 'usc');
    eq('  an alternation keeps the first subsection only', altSub && altSub.subsection, '(b)');
    // It must not reach across a second section reference to a parenthetical
    // that belongs to that one — the same theft the name guard prevents.
    const across2 = extractCitations(normalizeText(
      'SEC. 2. X.\nsubsection (a) of section 3 of the Foo Act, as applied by section 9 ' +
      'of the Bar Act (42 U.S.C. 1234), applies.\n'
    )).find((x) => x.kind === 'usc');
    eq('  and never across an intervening section reference',
       across2 && across2.subsection, '');

    // ---- the parenthetical address ----------------------------------------
    // "Section 252 of the Military Construction … Act, 2018 (division J of
    // Public Law 115-141)" names a DIVISION's own short title, so the name
    // itself is unlookupable — but the bill has already done the mapping and
    // written the letter down. 173 of these across the corpus, of which the
    // parser previously read the bare "Public Law 115-141" and dropped the
    // section number, the division, and the link between them.
    const paren = extractCitations(normalizeText(
      'SEC. 2. X.\nSection 252 of the Military Construction, Veterans Affairs, and ' +
      'Related Agencies Appropriations Act, 2018 (division J of Public Law 115-141) is amended.\n'
    )).find((x) => x.kind === 'publaw');
    eq('a parenthetical address gives the section', paren && paren.actSection, '252');
    eq('  and the division beside it', paren && paren.division, 'J');
    ok('  and the short title the bill used',
       /^Military Construction/.test(paren && paren.shortTitle || ''),
       JSON.stringify(paren && paren.shortTitle));
    const parenRes = await resolve(paren);
    ok('  resolving inside that division',
       parenRes.plaw && /^DIVISION J\b/.test(parenRes.plaw.entries[0].ancestors[0]),
       JSON.stringify(parenRes.citation));

    // The guard that keeps this from being worse than useless. A parenthetical
    // belongs to the name in FRONT of it, so anything intervening belongs to
    // something else — and left ungated this read PHSA § 313 as a section of
    // Pub. L. 116-260: a real law, a real number, the wrong statute.
    const across = normalizeText(
      'SEC. 2. X.\nsection 313 of the Public Health Service Act, as amended by section 311 ' +
      'of division BB of the Consolidated Appropriations Act, 2021 (Public Law 116-260), applies.\n'
    );
    const stolen = extractCitations(across)
      .filter((x) => x.kind === 'publaw' && x.actSection === '313');
    eq('a parenthetical is not stolen across an intervening citation', stolen.length, 0);

    // The same theft with no second "section" in it, from the sample bill —
    // two references joined by a bare preposition. The tell is the subdivision
    // word: "division" opens a new address, and the slot a chain may occupy is
    // in FRONT of a name, never inside it. Ungated this filed section 251(b) of
    // the Balanced Budget and Emergency Deficit Control Act under the
    // Infrastructure Investment and Jobs Act.
    const twoRefs = normalizeText(
      'SEC. 2. X.\namounts designated by the Congress as an emergency requirement pursuant to ' +
      'section 251(b) of the Balanced Budget and Emergency Deficit Control Act of 1985 in ' +
      'division J of the Infrastructure Investment and Jobs Act (Public Law 117-58); and\n'
    );
    const glued = extractCitations(twoRefs)
      .filter((x) => x.kind === 'publaw' && x.actSection === '251');
    eq('a subdivision word inside the name blocks the match', glued.length, 0);
    ok('  leaving the two references separate',
       extractCitations(twoRefs).some((x) => x.kind === 'act' && x.actSection === '251' &&
         /Balanced Budget/.test(x.act.name)) &&
       extractCitations(twoRefs).some((x) => x.kind === 'act' && x.division === 'J' &&
         /Infrastructure/.test(x.act.name)),
       extractCitations(twoRefs).map((x) => `${x.kind}:${x.text.slice(0, 46)}`).join(' | '));
    ok('  and the Public Health Service Act still resolves as itself',
       extractCitations(across).some((x) => x.kind === 'act' && x.actSection === '313' &&
         /Public Health Service/.test(x.act.name)),
       extractCitations(across).map((x) => `${x.kind}:${x.text.slice(0, 40)}`).join(' | '));

    // ---- only the enacting clause names the division -----------------------
    // 42 U.S.C. 15883 is credited "(Pub. L. 109–58, title II, § 247, as added
    // Pub. L. 117–58, div. D, …)". The only division there belongs to the law
    // that ADDED the section, not to the one being cited — the same "first
    // clause only" rule the Act index is built on. Reading the whole string
    // found "div. D", disagreed with a citation naming no division, and
    // declined a provision it had correctly identified.
    const added = extractCitations(normalizeText(
      'SEC. 2. X.\nAs authorized under section 247 of the Energy Policy Act of 2005 ' +
      '(Public Law 109-58; 119 Stat. 674), funds are available.\n'
    )).find((x) => x.kind === 'publaw' && x.actSection === '247');
    eq('a division in an "as added" clause is not the cited law\'s',
       (await resolve(added)).citation, '42 U.S.C. 15883');

    // ---- a note must not evict the address that spans it -------------------
    // "Section 8301 of the Agricultural Act of 2014 (16 U.S.C. 1642 note; Public
    // Law 113-79)" — the note is a `usc` and so outranked the whole address,
    // reducing it to 16 U.S.C. 1642: the one provision the note rule says it is
    // not. 102 across the corpus, every one of them a note.
    const noteFirst = extractCitations(normalizeText(
      'SEC. 2. X.\nSection 8301 of the Agricultural Act of 2014 (16 U.S.C. 1642 note; ' +
      'Public Law 113-79) is amended.\n'
    ));
    const composite = noteFirst.find((x) => x.kind === 'publaw' && x.actSection === '8301');
    ok('a note does not evict the address spanning it', Boolean(composite),
       noteFirst.map((x) => `${x.kind}:${x.text.slice(0, 40)}`).join(' | '));
    eq('  which carries the law beside the note', composite && `${composite.congress}-${composite.law}`,
       '113-79');
    eq('  and no bare section citation survives inside it',
       noteFirst.filter((x) => x.kind === 'usc').length, 0);
    // A note cited on its own is untouched — it still outranks an Act name, and
    // it is still flagged so the amendment chain skips it.
    const loneNote = extractCitations(
      normalizeText('SEC. 2. X.\nFunds under 10 U.S.C. 1580 note are available.\n')
    ).find((x) => x.kind === 'usc');
    eq('a note cited alone is still a citation', Boolean(loneNote), true);
    eq('  and is still flagged as a note', loneNote && loneNote.note, true);

    // A richer citation must never resolve to LESS than its parts. Where the
    // section is uncodified and the law is not one of the 25 held, the Act name
    // the bill wrote down is still an answer — the start of the Act, which is
    // what this phrase gave before the parenthetical was read at all. Falling to
    // the bare Public Law link instead would punish the citation for being more
    // specific.
    const uncodified = extractCitations(normalizeText(
      'SEC. 2. X.\nUnder section 6015 of the Farm Security and Rural Investment Act ' +
      'of 2002 (Public Law 107-171) funds are available.\n'
    )).filter((x) => x.kind === 'publaw').sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    const uncRes = await resolve(uncodified);
    eq('an unresolvable section falls back to the Act it named',
       uncRes.actName, 'Farm Security and Rural Investment Act of 2002');
    eq('  labelled as the start of the Act, not as the provision',
       uncRes.isActStart, true);

    // ---- a short title names a division, and the law says so itself --------
    // "Section 532 of the Department of Homeland Security Appropriations Act,
    // 2018 (Public Law 115-141)" writes no division letter, and that Act IS
    // division F. The law prints the mapping on the division heading, so no
    // table has to be authored. 10 citations across the corpus narrow to
    // exactly one this way. This is the half of the division problem the
    // written-out form could not reach.
    const byTitle = extractCitations(normalizeText(
      'SEC. 2. X.\nUnder section 532 of the Department of Homeland Security ' +
      'Appropriations Act, 2018 (Public Law 115-141) funds are available.\n'
    )).filter((x) => x.kind === 'publaw').sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    const btRes = await resolve(byTitle);
    eq('a division short title narrows a repeated section number',
       btRes.plaw.entries.length, 1);
    eq('  out of the three the law holds', btRes.plaw.of, 3);
    ok('  landing in the division the title names',
       /^DIVISION F\b/.test(btRes.plaw.entries[0].ancestors[0]),
       btRes.plaw.entries[0].ancestors[0]);
    ok('  and it is the DHS provision, not Commerce/Justice',
       /Secretary of Homeland Security/.test(btRes.plaw.entries[0].text),
       String(btRes.plaw.entries[0].text).replace(/s+/g, " ").slice(0, 90));
    // The memo must not serve this answer to a citation that named no division.
    // Same family as `actSection`, `division` and `where` before it: a key
    // missing a field is indistinguishable from a resolver bug.
    const bare141 = extractCitations(
      normalizeText('SEC. 2. X.\nUnder section 532 of Public Law 115-141 funds are available.\n')
    ).find((x) => x.kind === 'publaw');
    eq('  and a bare citation to the same section still shows all of them',
       (await resolve(bare141)).plaw.entries.length, 3);

    // ---- the bracketed credit form --------------------------------------
    // "(Pub. L. 85-536, § 2[7], July 18, 1958, 72 Stat. 387)". The Small
    // Business Act *is* section 2 of that law, so the OLRC writes the Act's own
    // section 7 as "§ 2[7]". Reading the outer number filed every SBA section
    // under "2", where they all collided and were dropped as ambiguous — the
    // Act had no index at all, and "section 7(a) of the Small Business Act"
    // could only reach the head of the Act.
    const sba = POPULAR_NAMES.find((e) => e.name === 'Small Business Act');
    ok('the Small Business Act is wired to its credit', !!sba.enactedAs, String(sba.enactedAs));
    for (const [sec, want] of [['2', '15 U.S.C. 631'], ['7', '15 U.S.C. 636'], ['8', '15 U.S.C. 637']]) {
      const at = await resolveActSection(sba, sec);
      eq(`  SBA § ${sec}`, at && `${at.title} U.S.C. ${at.section}`, want);
    }
    // The same form in another Act, so this is not one special case.
    const fdia = POPULAR_NAMES.find((e) => e.name === 'Federal Deposit Insurance Act');
    if (fdia && fdia.enactedAs) {
      const at = await resolveActSection(fdia, '3');
      eq('  FDIA § 3 (same bracketed form)', at && `${at.title} U.S.C. ${at.section}`, '12 U.S.C. 1813');
    }

    // ---- a section cited with alternative subsections ---------------------
    // "section 7(a) or (b) of the Small Business Act" put the alternation
    // between the number and the "of the …" the pattern needs, so the whole
    // citation was missed and only the bare Act name survived.
    for (const phrase of [
      'section 7(a) of the Small Business Act',
      'section 7(a) or (b) of the Small Business Act',
      'section 7(a), (b), or (m) of the Small Business Act',
      'section 7(a)(36)(A) of the Small Business Act',
    ]) {
      const c = extractCitations(normalizeText(`SEC. 2. X.\nFunds under ${phrase} are available.\n`))
        .find((x) => x.kind === 'act');
      ok(`"${phrase}" spans the whole phrase`, c && c.text === phrase, JSON.stringify(c && c.text));
      eq('  and carries section 7', c && c.actSection, '7');
      const r = await resolve(c);
      ok('  resolving into 15 U.S.C. 636',
         /^15 U\.S\.C\. 636/.test(r.citation || ''), r.citation);
    }
    // The alternation is consumed, not interpreted: the address is the first
    // subsection, because nothing in the text says which alternative was meant.
    const alt = extractCitations(
      normalizeText('SEC. 2. X.\nFunds under section 7(a) or (b) of the Small Business Act.\n')
    ).find((x) => x.kind === 'act');
    eq('an alternation resolves to the subsection in hand', (await resolve(alt)).citation,
       '15 U.S.C. 636(a)');

    // The user's case, both halves of it. "section 251(b) of the Balanced
    // Budget and Emergency Deficit Control Act of 1985 in division J of the
    // Infrastructure Investment and Jobs Act" resolved neither: the section
    // number was dropped and the division was dropped, leaving two citations
    // that both pointed at the head of an Act.
    const t2 = normalizeText(
      'SEC. 2. X.\n' +
      '    Amounts designated pursuant to section 251(b) of the Balanced Budget and      Emergency\n' +
      'Deficit Control Act of 1985 in division J of the      Infrastructure Investment and Jobs Act\n' +
      'shall be available.\n'
    );
    const cs2 = extractCitations(t2);
    const bb = cs2.find((c) => c.kind === 'act' && /Balanced Budget/.test(c.act.name));
    // The span must cover the section, or the chip reads "the Act" while
    // resolving to one provision of it.
    ok('the citation spans "section 251(b) of the …"', /^section 251\(b\) of/.test(bb.text), bb.text);
    eq('  carrying the Act-relative number', bb.actSection, '251');
    const bbRes = await resolve(bb);
    eq('  which resolves through the credit', bbRes.citation, '2 U.S.C. 901(b)');
    ok('  to the right provision', /discretionary spending limits/i.test(bbRes.heading || ''),
       bbRes.heading);

    const iija = cs2.find((c) => c.kind === 'act' && /Infrastructure/.test(c.act.name));
    eq('a division of an Act is captured', iija.division, 'J');
    ok('  and spans the whole phrase', /^division J of/.test(iija.text), iija.text);
    const divRes = await resolve(iija);
    eq('  resolving to that division of the Public Law',
       divRes.citation, 'Pub. L. 117-58, division J');
    eq('  with only that division\'s sections', divRes.plaw.toc.length, 19);
    ok('  and every one of them in division J',
       divRes.plaw.toc.every((x) => /^DIVISION J\b/.test(x.where || '')),
       [...new Set(divRes.plaw.toc.map((x) => x.where))].join(' | '));

    // An Act codified out of many laws has no single Public Law, so naming a
    // division of it resolves to nothing rather than to some other law's.
    const caa = extractCitations(
      normalizeText('SEC. 2. X.\nAs provided in division B of the Clean Air Act.\n')
    ).find((c) => c.kind === 'act');
    ok('an Act with no single Public Law has no division to give',
       !caa || !(await resolve(caa)).plaw,
       'a division was invented for an Act assembled from many laws');
  }

  // ---- a note is not the section it sits under ---------------------------
  // "Section 602(b)(3)(F) of the Afghan Allies Protection Act of 2009 (8 U.S.C.
  // 1101 note)" targeted 8 U.S.C. 1101 — the INA's *Definitions* section — and
  // then composed every navigation step against it: "clause (i)" became
  // 8 U.S.C. 1101(i), a real provision about something else entirely. 319
  // amendments targeted a note this way, carrying 764 composed addresses.
  {
    const tnote = normalizeText(
      'SEC. 2. X.\n' +
      'Section 602(b)(3) of the Afghan Allies Protection Act of 2009 (8 U.S.C. 1101 note; ' +
      "Public Law 111-8) is amended--\n    (1) in clause (i), by striking ``old'' and inserting ``new''.\n"
    );
    const cn = extractCitations(tnote);
    const an = extractAmendments(tnote, cn);
    ok('the note citation is not the target',
       !an[0].target || !an[0].target.note, JSON.stringify(an[0].target && an[0].target.text));
    eq('  the Public Law beside it is', an[0].target && an[0].target.kind, 'publaw');
    eq('  carrying the section the instruction named', an[0].target && an[0].target.actSection, '602');
    // And nothing composes against the note's section any more.
    const rel = expandRelativeRefs(cn, an).filter((c) => c.relative);
    ok('no address is composed onto the note\'s section',
       !rel.some((c) => c.kind === 'usc' && c.section === '1101'),
       JSON.stringify(rel.map((c) => `${c.kind} ${c.section}${c.subsection}`)));

    // An omnibus restarts its numbering in every division, so the section
    // number alone is not an address. The Code prints the division in its
    // credit, and where the two disagree this declines rather than guessing.
    const amb = extractCitations(
      normalizeText('SEC. 2. X.\nSection 110 of Public Law 114-113 is amended.\n')
    ).find((c) => c.kind === 'publaw');
    const ambRes = await resolve(amb);
    ok('a division-ambiguous Public Law section does not resolve to the Code',
       !ambRes.viaActSection,
       JSON.stringify(ambRes.viaActSection && ambRes.viaActSection.codified));
    // Naming the division is what makes it an address.
    const named = extractCitations(
      normalizeText('SEC. 2. X.\nSection 110 of division N of Public Law 114-113 is amended.\n')
    ).find((c) => c.kind === 'publaw');
    eq('  and naming the division is captured', named.division, 'N');
    const namedRes = await resolve(named);
    eq('  which lets it resolve', namedRes.viaActSection && namedRes.viaActSection.codified,
       '6 U.S.C. 1509');
  }

    globalThis.fetch = realFetch;
  }

  // ---- markers manufactured by the 72-column wrap ------------------------
  // A reference broken across the measure leaves its marker at a line head,
  // shaped exactly like a real outline marker. The phantom becomes a sibling of
  // the real one and, being nearer, steals every later reference to it. 1,093
  // of these across the 23 plain-text corpus bills; the corpus itself cannot
  // see them, because its metrics are parse-only and this is resolution.
  const t5 = normalizeText(
    'SEC. 123. LIMITATION ON ADVANCE APPROPRIATIONS.\n' +
    '    (a) Point of Order.--\n' +
    '        (1) In general.--Except as provided in paragraph (2), it shall not\n' +
    '    be in order in the Senate to consider any bill.\n' +
    '        (2) Exceptions.--Advance appropriations may be provided.\n' +
    '        (3) Waiver.--In the Senate, paragraph (1) may be waived only by an\n' +
    '    affirmative vote of three-fifths of the Members.\n' +
    '        (4) Form of point of order.--A point of order under paragraph \n' +
    '    (1) may be raised by a Senator as provided in section 313(e).\n'
  );
  const b5 = parseBill(t5);
  const p1 = extractCitations(t5)
    .filter((c) => c.kind === 'internal' && /paragraph\s+\(1\)/.test(c.text));
  eq('finds both "paragraph (1)" references', p1.length, 2);
  // Both mean paragraph (a)(1), "In general" — the one in (3) because that is
  // what it says, and the one in (4) because it is the wrapped one itself.
  for (const [i, r] of p1.entries()) {
    const at = locateInternal(b5, r);
    ok(`  reference ${i + 1} lands on the real (1), not the wrapped tail`,
       at && /^\(1\) In general/.test(t5.slice(at.start, at.start + 20)),
       JSON.stringify(at && t5.slice(at.start, at.start + 30)));
    ok(`  reference ${i + 1} is not reported ambiguous`, at && !at.ambiguous,
       JSON.stringify(at && at.why));
  }

  // The second tell, and the one the trailing-unit test cannot see: the break
  // may fall at a LIST separator or a range word instead of the unit word, so
  // the line above ends in "and", "or" or "through" — which is exactly how a
  // line that ends a thought looks. What separates them is the tail: a real
  // outline marker introduces its own text and is never followed by the rest of
  // somebody's address. 118 across the corpus, every one read, none a provision.
  const t5b = normalizeText(
    'SEC. 4. TREATMENT.\n' +
    '    (a) In general.--An activity shall not be treated as a trade or\n' +
    '    business under paragraph (5) or\n' +
    '    (6) of section 469(c) of the Internal Revenue Code of 1986.\n' +
    '    (b) Rule.--The Secretary shall prescribe regulations.\n'
  );
  {
    // Asserted through outline(), which is what both consumers ask — a citation
    // fixture cannot reach this, because item 20 correctly drops "paragraph (5)
    // or (6) of section 469(c)" as a phrase naming its own section, so there is
    // no internal citation left to locate. The phantom still splits the
    // paragraph in the left pane and still steals later references in a bill
    // where the same shape is written without the tail.
    const { outline } = await imp('app/resolve/internal.js');
    const heads = outline(t5b, 0, t5b.length).map((n) => n.marker);
    ok('a marker followed by "of section" is not an outline marker',
       !heads.includes('(6)'), JSON.stringify(heads));
    ok('  and the real markers around it survive',
       heads.includes('(a)') && heads.includes('(b)'), JSON.stringify(heads));
  }
  // And the negative, or the tell would be swallowing real markers: the same
  // marker introducing its own text is untouched.
  const t5c = normalizeText(
    'SEC. 4. TREATMENT.\n' +
    '    (a) In general.--The following apply, and\n' +
    '    (6) of the amounts described in subsection (b) shall be paid.\n' +
    '    (b) Rule.--Regulations apply. See paragraph (6) for details.\n'
  );
  {
    const { isWrappedMarkerLine } = await imp('app/parse/outline.js');
    ok('  a marker followed by "of the amounts" is left alone',
       !isWrappedMarkerLine('    (a) In general.--The following apply, and',
                            '    (6) of the amounts described in subsection (b) shall be paid.'));
    ok('  and one followed by "of subsection" is not',
       isWrappedMarkerLine('    described in paragraphs (3) and',
                           '    (4) of subsection (b) of section 9.'));
  }

  // The one shape that must survive the guard: a run-in heading is a real
  // marker even where the line above happens to end in a unit word. Exactly one
  // case in the 1,093 — H.R. 2617 writes "(a) Definitions.--In this section"
  // with the colon dropped, and "(1) Federal land.--" under it is real.
  const t6 = normalizeText(
    'SEC. 301. GILT EDGE MINE CONVEYANCE.\n' +
    '    (a) Definitions.--In this section\n' +
    "        (1) Federal land.--The term ``Federal land'' means the land.\n" +
    "        (2) Map.--The term ``Map'' means the map.\n" +
    '    (b) Conveyance.--As described in paragraph (1), the Secretary shall act.\n'
  );
  const b6 = parseBill(t6);
  const fl = extractCitations(t6)
    .find((c) => c.kind === 'internal' && /paragraph \(1\)/.test(c.text));
  const flAt = fl && locateInternal(b6, fl);
  ok('a run-in heading is still a real outline marker',
     flAt && /Federal land/.test(t6.slice(flAt.start, flAt.start + 40)),
     JSON.stringify(flAt && t6.slice(flAt.start, flAt.start + 40)));

  // And against the bill this was found in. Section 123 of the Fiscal
  // Responsibility Act has four "paragraph (1)" references; two of them meant
  // (a)(1) "In general" and pointed into the middle of a sentence in (4).
  if (existsSync(samplePath)) {
    const fra = normalizeText(readFileSync(samplePath, 'utf8'));
    const fb = parseBill(fra);
    const s123 = fb.sections.find((s) => s.num === '123');
    const inSec = extractCitations(fra).filter(
      (c) => c.kind === 'internal' && c.start >= s123.start && c.start < s123.end
    );
    const hits = inSec.map((c) => locateInternal(fb, c)).filter(Boolean);
    eq('FRA sec. 123: every internal reference resolves', hits.length, inSec.length);
    eq('  and none of them is ambiguous', hits.filter((h) => h.ambiguous).length, 0);
    const ones = inSec.filter((c) => /paragraph\s+\(1\)/.test(c.text));
    eq('  it has three "paragraph (1)" references', ones.length, 3);
    ok('  all three reach (a)(1) "In general"',
       ones.every((c) => /^\(1\) In general/.test(fra.slice(locateInternal(fb, c).start, locateInternal(fb, c).start + 16))),
       ones.map((c) => JSON.stringify(fra.slice(locateInternal(fb, c).start, locateInternal(fb, c).start + 16))).join(' '));
  }

  // Against the real bills: this has to work at scale, not just on fixtures.
  if (existsSync(samplePath)) {
    const real = normalizeText(readFileSync(samplePath, 'utf8'));
    const rb = parseBill(real);
    const rc = extractCitations(real).filter((c) => c.kind === 'internal');
    const hits = rc.map((c) => locateInternal(rb, c)).filter(Boolean);
    // Exact, and expected to move when the locator improves — that is the point
    // of tracking it. The rest are references out to the U.S. Code rather than
    // into the bill, which correctly resolve to nothing.
    //
    // 74 until division B's appropriations sections became visible. One
    // reference — "under paragraph (2) of subsection (b) of such section" —
    // used to sit in a SEC. 124 whose span ran 24,869 characters because the 73
    // sentence-case sections after it were invisible, and it found an unrelated
    // "(2)" belonging to a different appropriations section. It now sits in its
    // own 364-character section, which contains no (2), and declines. A
    // reference out to another Act should resolve to nothing.
    //
    // 73 again once a run-in marker pair became visible: a drafter opens a
    // subparagraph and its first clause on one line, "(A)(i) under 18 years of
    // age", and the outline matcher required whitespace after the marker so it
    // saw NEITHER. 887 such pairs across the corpus.
    //
    // 73 until a unit phrase naming its own section stopped being read as an
    // internal reference. The one lost is the heading "Paragraph (2) of Section
    // 102.--Section 102(2) of the National Environmental Policy Act…", where
    // "Paragraph (2)" alone had been pointing at an unrelated "(2) in
    // subparagraph (B), by striking ``insure''" several sections away. The
    // address the sentence actually states is NEPA § 102(2), and the
    // act-relative matcher has it. 1,460 of these across the corpus, 616 of them
    // answered with no hedge at all.
    //
    // 71 once a reference inside quoted inserted law stopped being answered
    // with a marker from outside that law. Both losses were wrong answers and
    // both are now composed into the Code addresses they actually name — see
    // "references inside quoted inserted law" below, which asserts the other
    // half. Assert both directions or a change that merely broke the locator
    // would pass this.
    eq('locates the internal refs it can', hits.length, 71);
    ok('  which is most of them', hits.length >= rc.length * 0.75, `${hits.length}/${rc.length}`);

    // Every target must land on an outline marker, or on the head of the bill
    // section when the reference named a whole section.
    const bad = hits.filter(
      (r) => real[r.start] !== '(' && !(r.section && r.start === r.section.start)
    );
    eq('  every target lands on a marker or a section head', bad.length, 0);
    console.log(`  · sample bill: ${hits.length}/${rc.length} internal refs located`);
  }

  // An appropriations section opens its first subsection on the same line as its
  // own number, so that marker is not at a line head and outline() could not see
  // it. Every reference to it declined — with a note saying the provision "lives
  // in the U.S. Code rather than in the bill text", about a subsection three
  // lines above. 410 references across the corpus.
  const runInBill =
    'SEC. 1. SHORT TITLE.\n\n    This Act may be cited as the ``Test Act\'\'.\n\n' +
    '    Sec. 20605. (a) The Federal share of assistance provided under section 407\n' +
    'of the Stafford Act shall be 90 percent of the eligible costs.\n' +
    '    (b) The Federal share provided by subsection (a) shall apply to assistance\n' +
    'provided before, on, or after the date of enactment of this Act.\n';
  {
    const t = normalizeText(runInBill);
    const b = parseBill(t);
    const cite = extractCitations(t).find((c) => c.kind === 'internal' && /subsection \(a\)/.test(c.text));
    ok('a run-in section\'s first subsection is a citation', Boolean(cite), '');
    const at = cite ? locateInternal(b, cite) : null;
    ok('  and it locates the (a) that opens the run-in section',
       Boolean(at) && t.slice(at.start, at.start + 3) === '(a)' && at.start < cite.start,
       JSON.stringify(at));
    // …and it is the one on the "Sec. 20605." line, not some later (a).
    ok('  namely the one on the section head line',
       Boolean(at) && t.slice(0, at.start).endsWith('Sec. 20605. '),
       at ? JSON.stringify(t.slice(Math.max(0, at.start - 24), at.start)) : 'no hit');
  }

  // …but a run-in marker must never displace an answer that already exists: it
  // is a candidate of last resort, because it was invisible until now.
  {
    const t = normalizeText(
      'SEC. 1. SHORT TITLE.\n\n    This Act may be cited as the ``Test Act\'\'.\n\n' +
      '    Sec. 30. (a) In General.--Title II is amended by inserting the following:\n' +
      '``SEC. 213A. (a) Enforceability.--No affidavit may be accepted.\'\'.\n' +
      '    (b) Effective Date.--The amendment made by subsection (a) shall apply\n' +
      'to affidavits executed after the date of enactment.\n'
    );
    const b = parseBill(t);
    const cite = extractCitations(t).find(
      (c) => c.kind === 'internal' && /subsection \(a\)/.test(c.text) && c.start > t.indexOf('Effective Date')
    );
    const at = cite ? locateInternal(b, cite) : null;
    ok('  a quoted new section\'s run-in (a) does not steal the bill\'s own',
       Boolean(at) && at.start < t.indexOf('``SEC. 213A.'),
       `${at && at.start} vs block at ${t.indexOf('``SEC. 213A.')}`);
  }
}

// "note" is four characters and the window was eight, so a 72-column wrap
// between the section number and the word defeated the flag — and with it BOTH
// guards that depend on it: item 14 (a note is skipped in the target chain) and
// item 27 (a note ranks below an address that spans it).
section('a note suffix that wrapped is still a note');
{
  const wrapped = normalizeText(
    'SEC. 1. SHORT TITLE.\n\nSEC. 2. REPEAL.\n' +
    '    Section 6020 of the FAST Act (23 U.S.C. 503\n' +
    '            note; Public Law 114-94) is repealed.\n'
  );
  const cs = extractCitations(wrapped);
  const usc = cs.find((c) => c.kind === 'usc' && c.section === '503');
  ok('the flag survives the wrap', Boolean(usc) && usc.note === true,
     usc ? String(usc.note) : 'no 23 U.S.C. 503 citation');
  // …so the bill repeals an uncodified section of the FAST Act, not the live
  // FHWA research programme at 23 U.S.C. 503.
  const am = extractAmendments(wrapped, cs)[0];
  ok('  so the note is not taken as the amendment target',
     Boolean(am) && Boolean(am.target) && am.target.kind !== 'usc',
     am && am.target ? `${am.target.kind} ${am.target.title || ''} ${am.target.section || ''}` : 'no target');
  // Only whitespace may sit in the window, which is what makes widening it safe.
  const notANote = normalizeText('SEC. 1. X.\n    See 23 U.S.C. 503 and the note thereto.\n');
  const other = extractCitations(notANote).find((c) => c.kind === 'usc');
  eq('  and a "note" behind other words is not one', Boolean(other && other.note), false);
}

// Item 66's guard, which was tested against the line-local overlay probe and so
// leaked whenever the 72-column wrap put the reference at the head of a line.
section('a bill talking about its own subdivisions');
{
  const compose = (body) => {
    const t = normalizeText(
      'SEC. 1. SHORT TITLE.\n\nSEC. 2. X.\n' +
      '    (a) In General.--Section 172 of the Internal Revenue Code of 1986\n' +
      '(26 U.S.C. 172) is amended by striking the second sentence.\n' + body
    );
    const raw = extractCitations(t);
    return expandRelativeRefs(raw, extractAmendments(t, raw)).filter((c) => c.relative);
  };
  // One line: caught. Wrapped: the probe starts at the reference's own line, so
  // "made by" is not in the window and the guard never fired.
  eq('an effective-date clause is not a Code address',
     compose('    (b) Effective Date.--The amendment made by subsection (a) shall apply.\n').length, 0);
  eq('  and still is not when the phrase wraps',
     compose('    (b) Effective Date.--The amendment made by\nsubsection (a) shall apply.\n').length, 0);
  // The participle forms are the same formula. "as redesignated by paragraph (1)"
  // names a paragraph of the BILL, not of title 26 — while the "In subparagraph
  // (C)" beside it is real navigation and must still compose, so this asserts
  // the one reference rather than the count.
  const both = compose(
    '    (b) Conforming.--In subparagraph (C), as redesignated by paragraph (1), by\nstriking the heading.\n'
  );
  eq('  nor is "as redesignated by paragraph (1)"',
     both.filter((c) => /paragraph \(1\)/i.test(c.text)).length, 0);
  ok('  though the navigation beside it still composes',
     both.some((c) => /subparagraph \(C\)/i.test(c.text)), both.map((c) => c.text).join(' | '));
  // …but a bare reference with no such phrase in front of it still composes, or
  // the guard would be swallowing the feature it guards.
  ok('  while a plain reference still composes',
     compose('    (b) More.--In subsection (b), by striking the first sentence.\n').length > 0, '');
}

// "by inserting before the period at the end the following:" states the
// position in WORDS. Nothing read it, so the op reached the redline with neither
// a paired strike nor an anchor, fell through both branches and drew nothing —
// and the panel said "⚠ position not stated" about a bill that states it.
section('a position stated in words');
{
  const O = '``';
  const C = "''";
  const { createRedline } = await imp('app/ui/redline.js');
  const mk = (phrase) => {
    const t = normalizeText(
      'SEC. 1. SHORT TITLE.\n\nSEC. 2. X.\n' +
      '    Section 5312(c)(1)(A) of title 31, United States Code, is amended by\n' +
      `${phrase}\n${O}and any digital commodity exchange registered under this Act${C}.\n`
    );
    return (extractAmendments(t, extractCitations(t))[0]?.ops || []).find((o) => o.type === 'insert');
  };
  eq('the punctuation the bill names is captured',
     mk('inserting before the period at the end the following:')?.endInsert?.punct, '.');
  eq('  in the trailing spelling too',
     mk('inserting the following before the semicolon:')?.endInsert?.punct, ';');
  eq('  and a bare "at the end" names no punctuation',
     mk('inserting at the end the following:')?.endInsert?.punct, null);

  // Placed immediately before the trailing punctuation of the passage the
  // instruction names — and NOT where that punctuation is absent, which means
  // the provision has been amended since and the position cannot be trusted.
  const op = { id: 'p1', type: 'insert', start: 0, end: 1, scope: '(c)(1)(A)',
               text: 'and any digital commodity exchange', endInsert: { punct: '.' } };
  const law = 'a futures commission merchant registered under the Commodity Exchange Act.';
  const segs = createRedline([op], undefined, new Set(['', '(c)(1)(A)'])).apply(law, '(c)(1)(A)');
  eq('the language lands before the final period',
     segs.map((s) => (s.type === 'keep' ? s.text : `[${s.type}]`)).join(''),
     'a futures commission merchant registered under the Commodity Exchange Act[ins].');
  eq('  and nothing is drawn where that punctuation is gone',
     createRedline([op], undefined, new Set(['', '(c)(1)(A)']))
       .apply('a futures commission merchant registered under the Act;', '(c)(1)(A)')
       .filter((s) => s.type !== 'keep').length, 0);
  // …and not in a sibling that happens to end the same way, which is item 100's
  // lesson: every item in a list closes with the same punctuation.
  eq('  nor in a sibling of the passage the bill names',
     createRedline([{ ...op, scope: '(c)(1)' }], undefined, new Set(['', '(c)(1)', '(c)(1)(B)']))
       .apply(law, '(c)(1)(B)').filter((s) => s.type !== 'keep').length, 0);
}

// A whole-provision replacement has TWO spellings and `quotedRefs()` scanned
// one. 274 of the 4,584 declined cross-references sat inside the other, and all
// 274 were that shape — the asymmetry is the tell.
section('both spellings of a whole-provision replacement');
{
  const O = '``';
  const C = "''";
  const mk = (phrase) =>
    'SEC. 1. SHORT TITLE.\n\n' +
    'SEC. 2. AMENDMENT.\n' +
    `    Section 1860D-43 of the Social Security Act (42 U.S.C. 1395w-153) is\n` +
    `amended ${phrase}\n` +
    `${O}(b) Effective Date.--Subsection (a) shall apply to covered part D drugs\n` +
    `dispensed on or after January 1, 2011.${C}.\n`;
  for (const [name, phrase] of [
    ['to read as follows', 'to read as follows:'],
    ['striking and inserting', 'by striking subsection (b) and inserting the following:'],
  ]) {
    const t = normalizeText(mk(phrase));
    const raw = extractCitations(t);
    const ams = extractAmendments(t, raw);
    const composed = expandRelativeRefs(raw, ams).find(
      (c) => c.relative && /Subsection \(a\)/i.test(c.text)
    );
    ok(`${name}: the block's cross-reference composes`,
       Boolean(composed) && `${composed.title}:${composed.section}${composed.subsection}` === '42:1395w-153(a)',
       composed ? `${composed.title}:${composed.section}${composed.subsection}` : 'not composed');
  }

  // …and the same phrase states the provision it replaces, inside itself. The
  // unit and marker path were consumed in non-capturing groups, so the scope
  // came from the walk — wherever the PREVIOUS sub-instruction stopped.
  const stated = normalizeText(
    'SEC. 1. SHORT TITLE.\n\nSEC. 2. X.\n' +
    '    Section 3021 of the Social Security Act (42 U.S.C. 1315a) is amended--\n' +
    '        (1) in paragraph (a)(2)(B), by striking ' + O + '8 conditions' + C +
    ' and inserting ' + O + '10 conditions' + C + '; and\n' +
    '        (2) by striking subsection (c)(1)(B) and inserting the following:\n' +
    O + '(B) Expansion.--The Secretary may expand the duration and scope.' + C + '.\n'
  );
  const repOp = (extractAmendments(stated, extractCitations(stated))[0]?.ops || [])
    .find((o) => o.type === 'replace');
  ok('the phrase\'s own address beats the walk', repOp && repOp.scope === '(c)(1)(B)',
     repOp ? String(repOp.scope) : 'no replace op');

  // …but only where it AGREES with the block's own leading marker. The phrase
  // names what is STRUCK, and the block is not always numbered the same: strike
  // paragraph (2), insert a block that opens (3), and the law reads it at (3).
  const disagree = normalizeText(
    'SEC. 1. SHORT TITLE.\n\nSEC. 2. X.\n' +
    '    Section 4.9 of the Farm Credit Act of 1971 (12 U.S.C. 2160) is amended--\n' +
    '        (A) in subsection (d)--\n' +
    '            (i) by striking paragraph (2) and inserting the following:\n' +
    O + '(3) Representation of board.--The Corporation shall not have representation.' + C + '.\n'
  );
  const repOp2 = (extractAmendments(disagree, extractCitations(disagree))[0]?.ops || [])
    .find((o) => o.type === 'replace');
  ok('  and the block\'s own marker wins where they disagree',
     repOp2 && repOp2.scope === '(d)(3)', repOp2 ? String(repOp2.scope) : 'no replace op');
}

// --------------------------------- references inside quoted inserted law
// A bill's own sentences and the statute it is writing are the same characters
// in the same file. Telling them apart decides where a cross-reference points,
// and getting it wrong produced this project's worst output — a real provision,
// confidently named, about something else entirely.
section('references inside quoted inserted law');
{
  const { quotedBlocks, quotedBlockAt } = await imp('app/parse/outline.js');
  const { locateInternal } = await imp('app/resolve/internal.js');
  const { resolve } = await imp('app/resolve/index.js');

  // The govinfo convention, built rather than spelled inline: `` and '' are
  // string delimiters in this file too, and a fixture writing them literally
  // closes the JS literal early. See the note in CLAUDE.md.
  const OPEN = '``';
  const CLOSE = "''";
  const Q = (s) => OPEN + s + CLOSE;
  /**
   * A multi-paragraph block, the way GPO actually sets one: every paragraph
   * opens with a quote mark and the block closes exactly once, at the end.
   *
   * Worth building rather than eyeballing — a fixture that closed each line
   * separately would be four one-line blocks, which is a different document and
   * quietly stops testing anything about block boundaries at all.
   */
  const QB = (indents, lines) =>
    lines.map((s, i) => `${indents[i]}${OPEN}${s}${i === lines.length - 1 ? `${CLOSE}.` : ''}`).join('\n');

  // --- where a block begins and ends -------------------------------------
  {
    const t = normalizeText(
      'SEC. 2. AMENDMENT.\n' +
      '    Section 1 is amended by adding at the end the following:\n' +
      `    ${Q('(j) New subsection.--The rule in subsection (d) applies.')}.\n` +
      '    (b) Effective Date.--This takes effect today.\n'
    );
    const blocks = quotedBlocks(t);
    eq('one quoted block in a one-block bill', blocks.length, 1);
    ok('  it opens at the quote mark', t.startsWith('``', blocks[0].start), JSON.stringify(t.slice(blocks[0].start, blocks[0].start + 8)));
    ok('  and closes at the matching closer', /'{2}$/.test(t.slice(blocks[0].start, blocks[0].end)),
       JSON.stringify(t.slice(blocks[0].end - 8, blocks[0].end)));
    ok('  the bill sentence after it is outside', !quotedBlockAt(t, t.indexOf('Effective Date')));
    ok('  and the instruction before it is outside', !quotedBlockAt(t, t.indexOf('is amended')));
  }
  {
    // A nested single-quoted defined term is not a closer — both single
    // conventions take two characters to close, which is why a lone apostrophe
    // in "the Nation's" cannot end a block either.
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 is amended by adding at the end the following:\n' +
      `    ${Q("(j) Rules.--The term `covered entity' means an entity.")}.\n` +
      `    ${Q('(k) More.--Applies to paragraph (2).')}.\n`
    );
    const blocks = quotedBlocks(t);
    eq('a single-quoted term does not close a block', blocks.length, 2);
    ok('  the first block keeps its whole definition',
       /covered entity/.test(t.slice(blocks[0].start, blocks[0].end)),
       t.slice(blocks[0].start, blocks[0].end));
  }

  {
    // The opener need not begin the line. A drafter as often writes the
    // introducing phrase and the first line of the new law together, and
    // readAddedBlock() on the op side has never required a line head — so the
    // two spellings of "where new law begins" disagreed and the reference was
    // answered from the bill's own drafting instruction.
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 408A(e)(1) is amended--\n' +
      '        (A) by striking the period at the end of subparagraph (B); and\n' +
      `        (C) by adding at the end the following: ${Q('The Secretary may waive subparagraph (A) if the applicant shows cause.')}.\n`
    );
    const blocks = quotedBlocks(t);
    eq('an opener behind "the following:" opens a block', blocks.length, 1);
    ok('  and the reference inside it is bounded',
       !!quotedBlockAt(t, t.indexOf('subparagraph (A) if')));
    ok('  while the drafting instruction above stays outside',
       !quotedBlockAt(t, t.indexOf('by striking the period')));
    // The guard: only behind the phrase that introduces new law. A strike's
    // operand is a quotation too, and claiming every mid-line quote would bound
    // thousands of references on nothing.
    const t2 = normalizeText(
      'SEC. 2. X.\n' +
      `    Section 5 is amended by striking ${Q('under subparagraph (A)')} and inserting ${Q('under subparagraph (B)')}.\n`
    );
    eq('  a mid-line operand does not', quotedBlocks(t2).length, 0);
  }

  // --- a quotation is not always a BLOCK of new law -----------------------
  //
  // A bill hard-wraps at 72 columns, so the operand of a strike lands at a line
  // head whenever the instruction breaks in front of it. Both are quotations
  // from the statute and both bound a reference the same way, but calling a
  // struck phrase "language the bill is inserting" says the opposite of what the
  // bill does. 366 of the corpus's quoted-law references sit in a phrase.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended in\n' +
      'subsection (a)(3) by striking\n' +
      `    ${Q('subparagraph (B) or (D)')} and inserting ${Q('subparagraph (A) or (C)')}.\n`
    );
    const blocks = quotedBlocks(t);
    ok('a wrapped strike operand is read as a phrase, not a block',
       blocks.length >= 1 && blocks[0].phrase === true,
       JSON.stringify(blocks.slice(0, 2)));
    const b = extractCitations(t).find((c) => c.kind === 'internal' && /subparagraph \(B\)/.test(c.text));
    ok('  and a reference in it is still bounded by it', b && b.inserted && b.inserted.phrase === true,
       JSON.stringify(b && b.inserted));
    const res = await resolve(b);
    ok('  with the pane calling it a phrase the bill quotes',
       /phrase the bill quotes from the statute/.test(res.note), res.note);
    ok('  and never "language the bill is inserting"',
       !/language the bill is inserting/.test(res.note), res.note);
  }
  {
    // …and the block form keeps its own wording. Same shape, an outline marker
    // at the head of a line inside the quotation, which is the whole difference.
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 9999 of title 7 is amended by adding at the end the following:\n' +
      QB(['    ', '    '], ['(z) Rules.--As provided in paragraph (44), the term applies.', 'It does.']) + '\n'
    );
    const blocks = quotedBlocks(t);
    ok('a block of new law is not a phrase', blocks.length === 1 && !blocks[0].phrase,
       JSON.stringify(blocks));
    const p = extractCitations(t).find((c) => c.kind === 'internal' && /paragraph \(44\)/.test(c.text));
    const res = await resolve(p);
    ok('  and the pane says the bill is inserting it',
       /language the bill is inserting/.test(res.note), res.note);
  }

  // --- "amended to read as follows" replaces a whole provision -------------
  //
  // 447 of the 628 references that provably point out of the block they sit in
  // were in one of these, and it was the largest single reason the composition
  // pass could not see a block at all: a whole-provision replacement emits no
  // operation, so there was nothing carrying the quoted text.
  {
    const t = normalizeText(
      'SEC. 2. MODIFICATION OF RATES.\n' +
      '    (a) In General.--Section 1(f)(2)(A) of the Internal Revenue Code of 1986\n' +
      'is amended to read as follows:\n' +
      QB(['    ', '    '],
         ['(A) except as provided in paragraph (8), by increasing the minimum',
          'and maximum dollar amounts, and']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    const p8 = rel.find((c) => /paragraph \(8\)/.test(c.text));
    ok('a replacement block\'s cross-reference is composed', Boolean(p8),
       rel.map((c) => `${c.text} -> ${c.subsection}`).join(' | '));
    // The block IS (f)(2)(A), so its parent is (f)(2) and a paragraph-level
    // reference truncates to (f) — never (f)(2)(8), which would be a paragraph
    // nested inside a paragraph.
    eq('  at the level the reference names', p8 && `${p8.title}:${p8.section}${p8.subsection}`, '26:1(f)(8)');
  }
  {
    // …and the base is the provision the instruction WALKED to, not the head's.
    // 102 of 445 of these blocks open with a marker that does not match the
    // head's last one, and every one sampled was a walk.
    const t = normalizeText(
      'SEC. 3. WALKED.\n' +
      '    Section 47(c) of the Internal Revenue Code of 1986 is amended--\n' +
      '        (1) in paragraph (1)--\n' +
      '            (A) in subparagraph (B), by amending clause (iii) to read as\n' +
      '        follows:\n' +
      QB(['    '], ['(iii) as described in subparagraph (D), the amount applies.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    const d = rel.find((c) => /subparagraph \(D\)/.test(c.text));
    ok('a replacement written inside a walk uses the walked path', Boolean(d),
       rel.map((c) => `${c.text} -> ${c.subsection}`).join(' | '));
    eq('  so the reference is (c)(1)(D)', d && `${d.title}:${d.section}${d.subsection}`, '26:47(c)(1)(D)');
    ok('  and not the head-derived (c)(D)', !d || d.subsection !== '(c)(D)', d && d.subsection);
  }

  // --- a range is not a list ----------------------------------------------
  {
    const t = normalizeText(
      'SEC. 4. RANGE.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(['    ', '    '],
         ['(k) Override.--Notwithstanding subsections (b) through (i), the rate',
          'shall be 10 percent.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('a range gives an address for each end it names', rel.length, 2);
    const from = rel.find((c) => c.subsection === '(b)');
    ok('  the first carrying the range', from && from.relRange &&
       from.relRange.from === '(b)' && from.relRange.to === '(i)',
       JSON.stringify(from && from.relRange));
    ok('  and so does the last', rel.every((c) => c.relRange && c.relRange.to === '(i)'),
       JSON.stringify(rel.map((c) => [c.subsection, c.relRange])));
    // A LIST is not a range: "and" names exactly what it writes down.
    const t2 = normalizeText(
      'SEC. 5. LIST.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(['    '], ['(k) Override.--Notwithstanding subsections (b) and (i), it applies.']) + '\n'
    );
    const c2 = extractCitations(t2);
    const rel2 = expandRelativeRefs(c2, extractAmendments(t2, c2)).filter((c) => c.insertedLaw);
    eq('  a list still gives one address per member', rel2.length, 2);
    ok('  and claims no range', rel2.every((c) => !c.relRange),
       JSON.stringify(rel2.map((c) => [c.subsection, c.relRange])));
  }

  // --- a reference inside a quoted OPERAND is not an address --------------
  //
  // "by striking ``paragraph (3)''" quotes the words; it does not refer to the
  // paragraph. That exclusion was computed per line against a two-line overlay,
  // which fails whenever the operand OPENS on an earlier line than the reference
  // inside it — the probe carries no opener, so the first quote characters it
  // meets are the closer and every span it computes is shifted by one quotation.
  //
  // 635 across the corpus, and every one of them spans a line break; not one
  // single-line operand leaked. Each became a confident Code address for words
  // the bill is merely quoting.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 59(j)(2)(B) of the Internal Revenue Code of 1986 is amended by\n' +
      // The operand OPENS here and closes on the next line — the whole point.
      // Q() would close it on this line and test nothing.
      `striking ${OPEN}for \`1992' in\n` +
      `    subparagraph (B)${CLOSE} and inserting ${Q("for `2016' in subparagraph (A)(ii)")}.\n`
    );
    const cites = extractCitations(t);
    const ams = extractAmendments(t, cites);
    const rel = expandRelativeRefs(cites, ams).filter((c) => c.relative);
    ok('a reference inside a wrapped quoted operand is not composed',
       !rel.some((c) => /subparagraph \(B\)/.test(c.text)),
       rel.map((c) => `${c.text.replace(/\s+/g, ' ')} -> ${c.title}:${c.section}${c.subsection}`).join(' | '));
    ok('  nor is the one in the replacement operand',
       !rel.some((c) => /subparagraph \(A\)\(ii\)/.test(c.text)),
       rel.map((c) => c.text.replace(/\s+/g, ' ')).join(' | '));
    // …and the instruction is still read: the target and the strike survive.
    const am = ams.find((a) => a.target && a.target.section === '59');
    ok('  while the instruction itself is still parsed', Boolean(am),
       ams.map((a) => a.target && a.target.section).join(','));
    ok('  with its strike operand intact',
       am && (am.ops || []).some((o) => o.type === 'strike' && /1992/.test(o.text || '')),
       JSON.stringify(am && (am.ops || []).map((o) => [o.type, (o.text || '').slice(0, 20)])));
  }

  // --- the boundary is what stops a wrong answer --------------------------
  //
  // The shape from the Tax Cuts and Jobs Act, reduced. The bill's own SEC. 2(d)
  // is a line-head "(d)" and the reference sits in new law being written into
  // 26 U.S.C. 1, so the only (d) the old search could find was the bill's.
  {
    const t = normalizeText(
      'SEC. 2. MODIFICATION OF RATES.\n' +
      '    (a) In General.--Section 1 of the Internal Revenue Code of 1986 is\n' +
      'amended by adding at the end the following new subsection:\n' +
      QB(
        ['    ', '        ', '            ', '        ', '        '],
        [
          '(j) Modifications.--',
          '(2) Rate tables.--',
          '(D) Married individuals filing separate returns.--The',
          'following table shall be applied in lieu of the table contained',
          'in subsection (d):',
        ]
      ) + '\n' +
      '    (d) Effective Date.--The amendments made by this section apply now.\n'
    );
    const b = parseBill(t);
    const cites = extractCitations(t);
    const d = cites.find((c) => c.kind === 'internal' && /subsection \(d\)/.test(c.text));
    ok('the reference is flagged as sitting in inserted law', d && Boolean(d.inserted),
       JSON.stringify(d && d.text));
    eq('  and is no longer answered from the bill', locateInternal(b, d), null);
    // …and the old behaviour is asserted too, so a change that merely stopped
    // finding markers at all cannot pass this pair.
    const oldWay = locateInternal(b, { ...d, inserted: null });
    ok('  where without the boundary it found the bill\'s own (d)',
       oldWay && oldWay.start > t.indexOf('Effective Date') - 8,
       JSON.stringify(oldWay && t.slice(oldWay.start, oldWay.start + 24)));

    // The note has to say which silence this is.
    const res = await resolve(d);
    ok('  the pane says it points into the law being amended',
       /language the bill is inserting/.test(res.note), res.note);
    ok('  and no longer claims the bill has no such provision',
       !/anywhere in this section of the bill/.test(res.note), res.note);

    // …and the address itself is composed.
    const ams = extractAmendments(t, cites);
    const rel = expandRelativeRefs(cites, ams).filter((c) => c.insertedLaw);
    const one = rel.find((c) => /subsection \(d\)/.test(c.text));
    ok('the reference is composed against the section being amended', Boolean(one),
       rel.map((c) => c.text).join(' | '));
    eq('  to the right title', one && one.title, '26');
    eq('  the right section', one && one.section, '1');
    eq('  and the right subsection', one && one.subsection, '(d)');
  }

  // --- new law referring to ITSELF is left alone --------------------------
  //
  // Asked before the composition, so self-reference never reaches it. This is
  // the guard the whole exercise rests on: a block adding several siblings at
  // once contains its own (D), (E) and (F).
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 8101 of title 7 is amended by adding at the end the following:\n' +
      QB(['    ', '    '], ['(D) First.--A thing described in subparagraph (E).', '(E) Second.--Another thing.']) + '\n'
    );
    const b = parseBill(t);
    const cites = extractCitations(t);
    const e = cites.find((c) => c.kind === 'internal' && /subparagraph \(E\)/.test(c.text));
    const at = e && locateInternal(b, e);
    ok('a reference to a sibling inside the block still resolves', Boolean(at),
       JSON.stringify(e && e.text));
    ok('  and lands inside that same block',
       at && at.start > e.inserted.start && at.start < e.inserted.end,
       JSON.stringify(at && t.slice(at.start, at.start + 20)));
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('  and is not composed into a Code address', rel.length, 0);
  }

  // --- a block's OWN opening marker is inside it ---------------------------
  //
  // The commonest reference there is in inserted law: a provision referring back
  // to the one that opens the block it sits in. A block begins mid-line, at its
  // quote opener, and its first marker is two characters later — while the
  // line-head pattern is anchored `(?:^|\n)` with no `m` flag, so starting the
  // scan AT the block start put the engine past the only newline that could
  // begin a match. Every marker-opening block in H.R. 1892 — 185 of 185 — had
  // its own first marker invisible, so these references declined, and the
  // composition pass read the same self-reference as pointing OUT to the Code.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1395x of title 42 is amended by adding at the end the following:\n' +
      QB(['    ', '    '],
         ['(A) In general.--The Secretary shall act.',
          '(B) Exception.--Subparagraph (A) shall not apply to a hospital.']) + '\n'
    );
    const b = parseBill(t);
    const cites = extractCitations(t);
    const a = cites.find((c) => c.kind === 'internal' && /Subparagraph \(A\)/i.test(c.text));
    const at = a && locateInternal(b, a);
    ok('a reference to the marker that OPENS the block resolves', Boolean(at),
       JSON.stringify(a && a.text));
    ok('  landing on that opening marker', at && /^\(A\) In general/.test(t.slice(at.start, at.start + 16)),
       JSON.stringify(at && t.slice(at.start, at.start + 24)));
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('  and it is NOT composed out to the Code', rel.length, 0);
  }
  {
    // …and the boundary still holds: the bill's own sub-instruction marker at
    // the head of the line the block opens on stays outside it.
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1395x of title 42 is amended--\n' +
      `        (3) by adding at the end ${OPEN}(B) Exception.--Subparagraph (A)\n` +
      `    shall not apply.${CLOSE}.\n`
    );
    const b = parseBill(t);
    const a = extractCitations(t).find((c) => c.kind === 'internal' && /Subparagraph \(A\)/i.test(c.text));
    eq('the bill\'s own marker on the opening line stays outside the block',
       locateInternal(b, a), null);
  }

  // --- the shape the standing rule exists to refuse ------------------------
  //
  // "For purposes of subparagraph (A)", in a PARAGRAPH the bill is adding, means
  // subparagraph (A) of that new paragraph. Composed against the target it
  // became 7 U.S.C. 8101(3)(A) — a real provision about something else, and
  // roughly 40% of all composed addresses when this was last let through. The
  // gap test refuses it: (A) sits at subparagraph depth over a base that stops
  // above the block, so depth 1 is empty and nothing may be assumed for it.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 8101 of title 7 is amended by adding at the end the following:\n' +
      QB(['    ', '    '], ['(3) Digital commodity.--For purposes of subparagraph (A), the', 'term applies.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('a reference deeper than the block it sits in is refused', rel.length, 0);
  }

  // --- a phrase that names its own section is not relative to anything -----
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(
        ['    ', '    '],
        ['(j) Rules.--Treated as a single employer under subsection (b), (c),', '(m), or (o) of section 414 shall apply.']
      ) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    // MARKER_LIST cannot take ", or (o)" — its separator is a comma OR the word,
    // never both — so the list stops at (m) and the "of section 414" that says
    // whose subsections these are sits just past the end of the match.
    eq('a list broken by ", or" still sees the section it names', rel.length, 0);
  }

  // --- a bare "of" is not an address --------------------------------------
  //
  // "of" is the commonest preposition in English and statutory prose is made of
  // it, so testing for one refused 110 references that were relative to the
  // block after all. "of this subsection" names the very provision the block is
  // joining, which is exactly what blockRefs composes against.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Subsection (b) of section 164 of the Internal Revenue Code of 1986 is\n' +
      'amended by adding at the end the following:\n' +
      QB(['    ', '    '],
         ['(6) Limitation.--The aggregate amount taken into account under',
          'paragraph (5) of this subsection shall not exceed $10,000.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('"of this subsection" is the block\'s own ancestry, and composes', rel.length, 1);
    eq('  and it reaches 26 U.S.C. 164(b)(5)',
       rel[0] && `${rel[0].title}:${rel[0].section}${rel[0].subsection}`, '26:164(b)(5)');
  }
  // …while the forms that really do open an address stay refused. Both of these
  // were the reason the guard existed, and neither may be lost to narrowing it.
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(['    ', '    '], ['(j) Rules.--The amount described in subsection (b) of section 6033',
                            'shall apply.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('"of section N" still names somebody else\'s numbering', rel.length, 0);
  }
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(['    ', '    '], ['(j) Rules.--The amount described in paragraph (2) thereof shall',
                            'apply for the year.']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('"thereof" still names the provision just mentioned', rel.length, 0);
  }
  // The same anaphor arriving as a PREFIX. refContinues() reads the tail — "of
  // such subsection" — and nothing read the head, so "such paragraph (16)" was
  // composed relative to the block: new SSA 2107(e)(1)(J) writes "Paragraphs (5)
  // and (16) of section 1902(e) … and the State has elected to apply such
  // paragraph (16)", where the first is refused for its tail and the second
  // named the same provision and reached 42 U.S.C. 1397gg(e)(16) instead of
  // 1396a(e)(16).
  {
    const t = normalizeText(
      'SEC. 2. X.\n' +
      '    Section 1 of the Internal Revenue Code of 1986 is amended by adding at\n' +
      'the end the following:\n' +
      QB(['    ', '    '], ['(j) Rules.--The amount described in paragraph (5) of section 219(g)',
                            'shall be reduced under such paragraph (5).']) + '\n'
    );
    const cites = extractCitations(t);
    const rel = expandRelativeRefs(cites, extractAmendments(t, cites)).filter((c) => c.insertedLaw);
    eq('an anaphoric "such <unit> (N)" points back, not at the block', rel.length, 0);
  }

  // --- the Oxford comma, and the two guards extending a list needs -----------
  //
  // MARKER_LIST's separator was a comma OR the word, never both, so ", and (3)"
  // stopped a list dead and took the "of subsection (a)" after it — both the
  // third member and the half of the address that says whose paragraphs these
  // are. 464 references across the corpus.
  const blk = (l1, l2) => normalizeText(
    'SEC. 2. X.\n' +
    '    Section 1396d of the Social Security Act (42 U.S.C. 1396d) is amended by\n' +
    'adding at the end the following:\n' +
    `    ${'``'}(kk) Rules.--${l1}\n    ${l2}''.\n`
  );
  const paths = (t) => {
    const cites = extractCitations(t);
    const ams = extractAmendments(t, cites);
    return ams.flatMap((a) => [...(a.steps || []), ...(a.refs || [])]).map((s) => s.path);
  };
  eq('a list closed with an Oxford comma keeps its last member and its parent',
     JSON.stringify(paths(blk('An amount described in paragraphs (1), (2), and (3) of',
                              'subsection (a) shall apply.'))),
     JSON.stringify(['(a)(1)', '(a)(2)', '(a)(3)']));

  // Guard 1: siblings share a numbering style, so an uppercase letter cannot
  // follow two digits in one list. This is what catches the mixed-style thefts
  // the wider separator lets in — "subparagraph (B), and (2) in the flush
  // sentence at the end".
  eq('  a member drawn from another numbering style is dropped',
     JSON.stringify(paths(blk('An amount described in paragraphs (1), (2), and (B) of',
                              'subsection (a) shall apply.'))),
     JSON.stringify(['(a)(1)', '(a)(2)']));

  // …but a DOUBLED letter is the same style as a single one: an alphabet that
  // runs past (z) continues (aa), (bb). 42 U.S.C. 1396d really does have
  // "subsection (y), (z), (aa), or (ii) of section 1905", and separating the two
  // truncated that list at (z).
  eq('  a doubled letter is a sibling of a single one, not a style break',
     JSON.stringify(paths(blk('An amount increased under subsections (y), (z), (aa),',
                              'and (ii) shall apply.'))),
     JSON.stringify(['(y)', '(z)', '(aa)', '(ii)']));

  // Guard 2: the thing after ", and" may be the next SUB-INSTRUCTION rather than
  // the next member, and the two-line overlay probe presents it as adjacent, so
  // no character class can see it. Both markers here are uppercase letters, so
  // the style guard cannot either — what separates them is that a list member is
  // followed by more list and a sub-instruction by what it instructs.
  {
    const t = normalizeText(
      'Section 1234 of title 42, United States Code, is amended--\n' +
      "        (A) by striking subparagraph (B), and\n" +
      '        (C) by redesignating subparagraph (D) as subparagraph (E).\n'
    );
    const got = paths(t);
    eq('  a sub-instruction marker after ", and" is not absorbed as a member',
       JSON.stringify(got), JSON.stringify(['(B)', '(D)', '(E)']));
  }

  // --- against the real bill ----------------------------------------------
  if (existsSync(samplePath)) {
    const real = normalizeText(readFileSync(samplePath, 'utf8'));
    const cites = extractCitations(real);
    const rel = expandRelativeRefs(cites, extractAmendments(real, cites)).filter((c) => c.insertedLaw);
    eq('FRA: four references inside inserted law are composed', rel.length, 4);
    // The two the locator stopped answering, now answered properly. 7 U.S.C.
    // 2015(o)(4) is "Waiver" and the sentence says "waivers granted under
    // paragraph (4)"; (o)(6) is "Exemptions", which is what the block joins.
    const p4 = rel.find((c) => /paragraph \(4\)/.test(c.text));
    eq('  "paragraph (4)" is 7 U.S.C. 2015(o)(4)',
       p4 && `${p4.title}:${p4.section}${p4.subsection}`, '7:2015(o)(4)');
    const sc = rel.find((c) => /subparagraph \(C\)/.test(c.text));
    eq('  "subparagraph (C)" is 7 U.S.C. 2015(o)(6)(C)',
       sc && `${sc.title}:${sc.section}${sc.subsection}`, '7:2015(o)(6)(C)');
    ok('  and every one of them round-trips to its own span',
       rel.every((c) => real.slice(c.start, c.end) === c.text),
       rel.map((c) => JSON.stringify(c.text)).join(' '));
    console.log(`  · sample bill: ${rel.length} references composed out of inserted law`);
  }
}

// ------------------------------------------------------------- CLARITY Act
// The largest and most structurally complex bills present, and for a long time
// the only ones no test touched — which is where the bugs were. Two paths, both
// of the same bill:
//
//   the Senate substitute      plain text, 464 KB, a mostly freestanding rewrite
//   the House-passed print     a typeset GPO PDF, 258 pages, densely amendatory
//
// The PDF fixture that existed before this one, the FRONTIER Act, is
// freestanding and amends nothing, so nothing had ever exercised an amendment
// read out of a PDF. That gap hid a total failure: GPO typesets quotations as
// ‘‘like this’’ and the operand matchers knew only ``like this'' and "like
// this", so not one struck or inserted phrase was extracted from any PDF bill
// and the diff preview came up empty on every one of them.
section('CLARITY Act (H.R. 3633)');

/**
 * Every "is amended" in the text must fall inside some parsed amendment.
 *
 * A distributed instruction writes its verb once, in a head sentence that sits
 * above the list of provisions it applies to, and each resulting amendment is
 * anchored on its own list item further down. `viaInstruction` points back at
 * that head, so the verb still counts as covered — by four amendments at once.
 *
 * IMPORTED, not re-spelled. This file kept its own copy for the life of the
 * project, and the two drifted the moment measure.mjs learned that "is FURTHER
 * amended" is an amendatory verb: the corpus reported 435 more of them and this
 * suite could not see one, so a fixture full of them would have asserted zero
 * uncovered and been right about nothing. That is the standing rule about a
 * metric meaning something slightly different in two reports, broken in the one
 * place nobody looks — the test.
 */
const { uncoveredAmendVerbs } = await imp('tools/measure.mjs');

function opCounts(ams) {
  const by = {};
  for (const a of ams) for (const o of a.ops) by[o.type] = (by[o.type] || 0) + 1;
  return by;
}

const substitutePath = join(ROOT, 'samples/hr3633rs-clarity-act-senate-substitute.txt');
if (existsSync(substitutePath)) {
  const text = normalizeText(readFileSync(substitutePath, 'utf8'));
  const bill = parseBill(text);
  const cs = extractCitations(text);
  const ams = extractAmendments(text, cs);

  eq('substitute: finds every section', bill.sections.length, 63);

  // The bill's own table of contents lists all nine titles in lines identical to
  // the real headings. Counted as divisions they doubled the list, and the last
  // phantom stuck to the sections after the table — putting SEC. 2, which sits
  // above title I, under "TITLE IX—OTHER MATTERS".
  eq('substitute: counts each division once', bill.divisions.length, 9);
  eq('  the table of contents adds none', bill.divisions.filter((d) => d.label === 'TITLE I').length, 1);
  eq('  a section above title I has no division',
     (bill.sections.find((s) => s.num === '2') || {}).division, null);
  // The stray hyphen this used to assert was the separator bug: govinfo writes
  // "TITLE I--RESPONSIBLE …", and a separator class matching one character left
  // the other on the front of the heading.
  eq('  and the first section under title I does',
     (bill.sections.find((s) => s.num === '101') || {}).division,
     'TITLE I—RESPONSIBLE SECURITIES INNOVATION');

  // Quoted, and wrapped across a line — "``Digital Asset \nMarket Clarity Act''"
  // — so it arrived with the quote marks and the line break still in it.
  eq('substitute: reads the short title', bill.meta.shortTitle, 'Digital Asset Market Clarity Act');

  // Bounded on both sides: the count matching the number of amendatory verbs in
  // the source is the real assertion, and `uncovered` is what makes it one.
  eq('substitute: finds every amendment', ams.length, 20);
  eq('  every amendatory verb is inside one', uncoveredAmendVerbs(text, ams), 0);
  eq('  and all but the two structural targets resolve', ams.filter((a) => a.target).length, 18);

  // 16 strikes, not 14: the two extra are "by striking the period at the end and
  // inserting ``; or''", where the strike names the mark instead of quoting it.
  // Both were previously invisible, which left their inserts unplaced — 320 of
  // the corpus's 2,431 unplaced inserts are this one shape.
  //
  // 30 inserts, not 28: two "by inserting after <unit> (N) the following:" blocks
  // run past the 400-character operand budget RE_INSERT used to impose, and that
  // budget did not truncate them — the closer was unreachable, so the match
  // failed and no op existed at all. Read by readAddedBlock() now, the same way
  // "adding at the end the following" has been since 2026-08-01.
  //
  // 33, not 30, for the other half of that same budget. Where an opener sits
  // inside the lazy gap the engine re-matches from a later one and records a
  // fragment (item 77); where there is nothing behind it to fall back to, the
  // match fails silently and no op exists. Two of the three new ones insert a
  // whole new SECTION into the Securities Act and the Exchange Act — 969 and
  // 10,490 characters — after an anchor RE_INSERT_AFTER_UNIT cannot read,
  // because "section" is not one of the levels within a provision.
  // +2 inserts when the body budget started counting TEXT rather than source:
  // "Section 741 of title 11, United States Code, is amended--" writes seven
  // sub-instructions (A) through (G) and its last two sat past 2,500 raw
  // characters only because the wrap indents them. Both were read against the
  // bill: (F) inserts the definition of `digital commodity' after paragraph (5)
  // and (G) inserts ", ancillary asset positions, and digital commodities
  // positions" in paragraph (8). Neither reaches "(b) Extent of Customer
  // Claims", the next subsection of the bill's own section.
  eq('substitute: extracts the operations', JSON.stringify(opCounts(ams)),
     JSON.stringify({ strike: 16, insert: 35, 'add-at-end': 10, redesignate: 4 }));
  // Counted against the source rather than asserted at: five quoted insert
  // operands in this bill run past the 400-character budget, and all five now
  // have an op whose span round-trips. Two were already read by the after-unit
  // block reader; the three above are what this adds.
  {
    const big = ams.flatMap((a) => a.ops).filter((o) => o.type === 'insert' && o.start != null && o.end - o.start > 400);
    eq('  quoted insert operands over the 400-character budget', big.length, 5);
    eq('    every one of them round-trips',
       big.filter((o) => text.slice(o.start, o.end) !== o.text).length, 0);
  }

  // Counted against the source, not asserted at. Every "adding at the end the
  // following" in this bill falls inside a parsed amendment, so the op count is
  // the phrase count — and one instruction (§ 5330) writes two of them, which is
  // what a single boolean per instruction used to collapse into one.
  {
    const phrases = text.match(/adding\s+at\s+the\s+end\s+the\s+following/gi) || [];
    const adds = ams.flatMap((a) => a.ops.filter((o) => o.type === 'add-at-end'));
    eq('substitute: one addition per phrase in the source', adds.length, phrases.length);
    eq('  every one carries the language it adds', adds.filter((o) => o.text).length, adds.length);
    eq('  and every offset round-trips',
       adds.filter((o) => text.slice(o.start, o.end) !== o.text).length, 0);

    // The lawyer's check, as an assertion. "in subsection (d)— (A) in paragraph
    // (1)(A), by inserting…; and (B) by adding at the end the following: ``(3)
    // Digital asset…''" adds a new *paragraph* (3). Its siblings are the other
    // paragraphs of subsection (d), so it belongs at the end of (d) — not inside
    // paragraph (1)(A), which is merely where the walk had got to.
    const a5330 = ams.find((a) => a.section === '5330');
    const its = a5330 ? a5330.ops.filter((o) => o.type === 'add-at-end') : [];
    eq('  § 5330 adds in two places', its.length, 2);
    eq('    the new paragraph (3) lands in subsection (d)', its[0] && its[0].scope, '(d)');
    ok('    and it is paragraph (3)', /^\(3\) Digital asset/.test(its[0] ? its[0].text : ''),
       JSON.stringify((its[0] || {}).text || '').slice(0, 60));
    // A new subsection (f) is a sibling of (a)–(e): end of the section itself.
    ok('    the new subsection (f) lands at section level', !its[1] || !its[1].scope,
       String((its[1] || {}).scope));
  }

  // 23, not 22: one "in the matter preceding …" moved from refs to steps when
  // that phrase started scoping operations instead of sitting inert. The two
  // counts move together and in opposite directions — across the corpus, every
  // bill's refs fell by exactly what its steps gained.
  //
  // 25, not 23, for the same reason again: two more of that phrase were broken
  // across the 72-column measure ("in the \n   matter following subparagraph
  // (L)") and every pattern here ran against one physical line, so they matched
  // nothing and their "(L)" sat inert. Steps +2, refs -2, the same trade.
  //
  // 28, not 25, for a different reason: a step into another SECTION is a step,
  // and this bill writes three — "in section 9(a) (15 U.S.C. 78fff-3(a))--",
  // "in section 10(g) (15 U.S.C. 78fff-4(g)), by", "in section 16 (15 U.S.C.
  // 78lll)--", all of them SIPA provisions the instruction walks into from an
  // et seq. target. Unlike the two above this trades nothing: they carry
  // `noCite`, because the bill has written the address out and composing a chip
  // for it would displace the real one.
  // 29, not 28: sub-instruction (G) above navigates to "paragraph (8)".
  eq('substitute: composes the navigation steps', ams.reduce((n, a) => n + a.steps.length, 0), 29);
  eq('  three of which step into another section and compose no chip of their own',
     ams.reduce((n, a) => n + a.steps.filter((s) => s.noCite).length, 0), 3);
  // 29, not 34. Five unit phrases sit inside quoted law the bill is *inserting*
  // — "…identified in clauses (i) through (vi) of subparagraph (A) of this
  // paragraph" says outright that it means the new provision — and composing
  // those against the instruction's target addressed existing law that has
  // nothing to do with them. They stay internal, where locateInternal finds them
  // a few lines up in the quoted block.
  //
  // 25, not 27: the last two were the marker INSIDE a navigation phrase that
  // wrapped the measure — "in paragraph (10), as so redesignated, in the \n
  // matter following subparagraph (L)". Pass 1 claims the phrase so pass 2 skips
  // the marker in it, but claims were kept per line and probe-relative, and the
  // "(L)" is matched on the NEXT line's iteration, by which time the claim is
  // gone. So the phrase both scoped the operation AND pointed the reader at (L)
  // — the one provision it identifies itself by staying outside of.
  eq('  and the in-place references', ams.reduce((n, a) => n + a.refs.length, 0), 27);
  eq('  into relative addresses', expandRelativeRefs(cs, ams).filter((c) => c.relative).length, 50);
  // The invariant behind those two, asserted rather than counted: a navigation
  // phrase absorbs the markers inside it, however the line happens to break.
  {
    const overlap = ams.flatMap((a) =>
      a.refs.filter((r) => a.steps.some((s) => r.start < s.end && r.end > s.start))
    );
    eq('  no reference sits inside a navigation phrase', overlap.length, 0);
  }

  // Named targets, not just counts — a step composed onto the wrong subtree
  // still counts. Section 18 of the Securities Act of 1933 is 15 U.S.C. 77r.
  const s18 = ams.find((a) => a.section === '18' && !a.subsection);
  ok('substitute: Securities Act § 18 resolves to 15 U.S.C. 77r',
     s18 && s18.target && s18.target.title === '15' && s18.target.section === '77r',
     JSON.stringify(s18 && s18.target && [s18.target.title, s18.target.section]));
  eq('  with all seven of its steps', s18 ? s18.steps.length : -1, 7);
  ok('  and they stay inside subsection (b)',
     s18 ? s18.steps.every((st) => st.path.startsWith('(b)')) : false,
     JSON.stringify(s18 && s18.steps.map((st) => st.path)));

  // The substitute reaches into the Bankruptcy Code, which no other fixture does.
  eq('substitute: amends title 11 in five places',
     ams.filter((a) => a.target && a.target.title === '11').length, 5);

  const badSub = cs.filter((c) => text.slice(c.start, c.end) !== c.text);
  eq('substitute: all offsets round-trip', badSub.length, 0);
  const sortedSub = cs.slice().sort((a, b) => a.start - b.start);
  let overlapSub = 0;
  for (let i = 1; i < sortedSub.length; i++) if (sortedSub[i].start < sortedSub[i - 1].end) overlapSub++;
  eq('substitute: no overlapping citation spans', overlapSub, 0);

  console.log(`  · substitute: ${bill.sections.length} sections, ${cs.length} citations, ${ams.length} amendments`);
} else {
  console.log('  (samples/hr3633rs-clarity-act-senate-substitute.txt missing — skipped)');
}

const clarityPdfPath = join(ROOT, 'samples/hr3633eh-clarity-act-house-passed.pdf');
if (existsSync(clarityPdfPath)) {
  globalThis.DOMMatrix ??= class { constructor() {} };
  const { pdfToText } = await imp('app/parse/pdf.js');
  const { text: raw, pages } = await pdfToText(new Uint8Array(readFileSync(clarityPdfPath)).buffer);
  const text = normalizeText(raw);
  const bill = parseBill(text);
  const cs = extractCitations(text);
  // The four-argument call, because that is the one every real consumer makes.
  // This block passed two for the life of the project and so asserted against a
  // parse the app does not produce: without the sections, the instruction in
  // SEC. 602 reached across the heading of SEC. 603 and claimed the paragraph
  // (19) that section adds to 12 U.S.C. 411 — the over-reach the section bound
  // exists to prevent, asserted as `add-at-end: 27`. Same mistake coverage.mjs
  // has made twice and two measurement scripts once each: a test that calls the
  // parser differently from the app is measuring a parse nobody sees.
  const ams = extractAmendments(text, cs, bill.divisions, bill.sections);

  eq('house print: reads every page', pages, 258);
  eq('house print: finds every section', bill.sections.length, 66);
  eq('house print: counts each division once', bill.divisions.length, 6);

  // A typeset heading wraps and hyphenates mid-word — "TITLE I—DEFINITIONS;
  // RULE- / MAKING; EXPEDITED REG- / ISTRATION" — putting three continuation
  // lines between the division and its first section. Reading one of those as
  // the end of the table of contents lost the real title I entirely.
  ok('  including the one whose heading wraps three lines',
     bill.divisions.some((d) => d.label === 'TITLE I'), bill.divisions.map((d) => d.label).join(','));

  // …and those continuation lines belong to the heading, not to nothing. The
  // hyphens are the source's own soft hyphens and are kept rather than closed
  // up: "REG-ISTRATION" shows a visible seam, but gluing it to "REGISTRATION"
  // means also gluing "PAY-" / "AS-YOU-GO" into a word that does not exist.
  // That is the standing limit in TODO 7; showing half a heading was not.
  eq('  and the heading carries all three lines',
     (bill.divisions.find((d) => d.label === 'TITLE I') || {}).heading,
     'DEFINITIONS; RULE-MAKING; EXPEDITED REG-ISTRATION');
  // Five lines in the body, which is what set the continuation cap.
  eq('  a five-line division heading reaches its last word',
     (bill.divisions.find((d) => d.label === 'TITLE IV') || {}).heading,
     'REGISTRATION FOR DIGITAL COMMODITY INTER-MEDIARIES AT THE ' +
     'COM-MODITY FUTURES TRADING COMMISSION');
  // The continuation is a bare year — "SEC. 101. DEFINITIONS UNDER THE
  // SECURITIES ACT OF" / "1933." — which a "must contain two capitals" guard
  // against page furniture threw away.
  eq('  a heading continued by a bare year is rejoined',
     (bill.sections.find((s) => s.num === '101') || {}).heading,
     'DEFINITIONS UNDER THE SECURITIES ACT OF 1933');
  // Page furniture sits in the same gap and must never be absorbed.
  ok('  no heading swallows the running head',
     !bill.sections.some((s) => /HR 3633|EH1S|^\d+$/.test(s.heading)),
     bill.sections.map((s) => s.heading).filter((h) => /HR 3633|EH1S/.test(h)).join(' | '));

  eq('house print: reads the short title', bill.meta.shortTitle, 'Digital Asset Market Clarity Act of 2025');
  ok('  and stops at the first of the three names it gives itself',
     !/CLARITY Act of 2025|Anti-CBDC/.test(bill.meta.shortTitle || ''), bill.meta.shortTitle);

  // 65, not 63: two of this print's three "is FURTHER amended" instructions are
  // now seen. Both were invisible rather than mis-targeted — the verb pattern
  // required the participle to follow "is" immediately — and one of them adds a
  // whole paragraph (19) to 12 U.S.C. 411.
  eq('house print: finds the amendments', ams.length, 65);
  eq('  all but one resolve a target', ams.filter((a) => a.target).length, 64);
  // The third is left, and this is the counter doing its job rather than
  // failing: "The Securities Act of 1933 (15 U.S.C. 77a et seq.), as amended by
  // section 202, is further amended by inserting after section 4B the
  // following:" names no section of its own, so RE_AMEND_HEAD has nothing to
  // match. It used to be "covered" in the plain-text rendition only, because
  // the 72-column wrap put "section 202" at the head of a line and `^` under
  // the `m` flag took it for an instruction boundary — a targetless instruction
  // carrying the whole of new SEC. 4C, in one rendition and not the other.
  // Blank beats wrong, and an uncovered verb is how the gap stays visible.
  eq('  and the one still outside is the shape nothing can target',
     uncoveredAmendVerbs(text, ams), 1);

  // Two "Each of the following … is amended by …:" instructions, four listed
  // provisions each. Both were invisible: the phrase names no provision, so
  // neither matcher could anchor a target, and eight real changes to eight
  // different statutes went unreported.
  const dist = ams.filter((a) => a.distributed);
  eq('house print: expands distributed instructions', dist.length, 8);
  eq('  from exactly two instructions', new Set(dist.map((a) => a.viaInstruction)).size, 2);
  eq('  each listed provision resolves its own target',
     dist.filter((a) => a.target && a.target.kind === 'usc').length, 8);
  // Four different Acts in the first list — the point of the form is that one
  // instruction reaches provisions that have nothing else in common.
  eq('  and they are four distinct provisions',
     new Set(dist.slice(0, 4).map((a) => `${a.target.title}|${a.target.section}`)).size, 4);
  ok('  every one carries the shared operations',
     dist.every((a) => a.ops.some((o) => o.type === 'strike') && a.ops.some((o) => o.type === 'insert')),
     JSON.stringify(dist.map((a) => a.ops.map((o) => o.type))));

  // THE regression guard. Every one of these operands is delimited by ‘‘ ’’ and
  // every one of them was silently missing.
  //
  // 44 strikes, not 39: the five added are the punctuation idiom with its
  // position left unsaid — "by striking the period and inserting ‘‘; or’’" —
  // every one of them followed immediately by "and inserting", and every one a
  // list being re-punctuated so the next subparagraph can be added after it.
  // They were checked individually, not inferred from the delta.
  //
  // 64 inserts, not 57: seven "inserting after <unit> (N) the following:" blocks
  // longer than RE_INSERT's old 400-character operand budget. A PDF bill is where
  // this hurt most — the typeset measure is narrower, so a block of the same
  // provisions carries more line breaks and crosses the budget sooner.
  // 2 replacements: "by amending paragraph (7) to read as follows: ‘‘(7) DIGITAL
  // ASSET SERVICE PROVIDER.—…" and the same shape on paragraph (3) of section
  // 4(a). Both are whole-provision rewrites of the GENIUS Act, both scoped to the
  // paragraph the block reopens, and both round-trip — checked individually, and
  // they are also the check that this shape is read through the doubled-single
  // quote convention a typeset PDF uses.
  const ops = opCounts(ams);
  eq('house print: extracts ‘‘...’’ operands', JSON.stringify(ops),
     // 8 redesignations, not 6: REDESIG_LIST omitted "subclause", so
     // "redesignating subclauses (III) and (IV) as subclauses (IV) and (V)" —
     // written twice in this print — produced no operation at all, while the
     // identical sentence with "clause" worked. 45 such instructions across 8
     // corpus bills, against 0 produced.
     //
     // 74 inserts, not 64. Every one of the ten is "by inserting after section
     // N the following: ‘‘SEC. …''" — nine of them, plus one "before paragraph
     // (12)" — and each is a whole new section of the Exchange Act or the
     // Commodity Exchange Act, up to 32,716 characters, which the generic
     // scan's 400-character budget could not reach and RE_INSERT_AFTER_UNIT
     // does not claim because a section is not a level within a provision.
     // 26 add-at-ends, not 27 — see the four-argument call above. The 27th was
     // SEC. 603's paragraph (19), claimed by SEC. 602's instruction. Its real
     // owner, "Section 16 of the Federal Reserve Act (12 U.S.C. 411 et seq.),
     // as amended by section 2, is further amended by adding at the end", makes
     // no instruction at all: RE_AMEND_HEAD cannot cross the interposed
     // ", as amended by section N,". 170 heads across the corpus are that shape.
     JSON.stringify({ 'add-at-end': 29, insert: 74, redesignate: 8, strike: 44, replace: 2 }));
  // Counted against the source: 17 quoted insert operands in this print run
  // past the budget, 7 of which the after-unit reader already claimed.
  {
    const big = ams.flatMap((a) => a.ops).filter((o) => o.type === 'insert' && o.start != null && o.end - o.start > 400);
    eq('  quoted insert operands over the 400-character budget', big.length, 17);
    eq('    every one of them round-trips',
       big.filter((o) => text.slice(o.start, o.end) !== o.text).length, 0);
  }

  // Counted against the source. 31 phrases in the bill, 27 of them inside a
  // parsed amendment — the other four sit in the long tail of amendatory
  // phrasings nothing matches yet (TODO 2), not in anything this dropped.
  {
    const phrases = text.match(/adding\s+at\s+the\s+end\s+the\s+following/gi) || [];
    const adds = ams.flatMap((a) => a.ops.filter((o) => o.type === 'add-at-end'));
    eq('house print: phrases in the bill', phrases.length, 31);
    // 26 of the 31, not 27: one of the five unparsed is SEC. 603's, whose head
    // carries an interposed ", as amended by section 2,". It used to be counted
    // here because the two-argument call let SEC. 602 reach across the heading.
    eq('  additions parsed out of them', adds.length, 29);
    eq('  every one carries the language it adds', adds.filter((o) => o.text).length, adds.length);

    // THE scoping guard, and the reason this whole path needed rewriting.
    //
    //   (1) in paragraph (3)—
    //       (B) in subparagraph (C), by striking the period …; and
    //       (C) by adding at the end the following:
    //   ``(D) a contract of sale of a digital commodity.'';
    //
    // The last step written is "in subparagraph (C)". The new subparagraph (D)
    // is its *sibling*, so it goes at the end of paragraph (3); scoping it to
    // (a)(3)(C) drew the new language inside (C). Same shape twice more, one
    // level deeper, where a new clause (iv) follows a step into clause (iii).
    const a4c = ams.find((a) => a.section === '4c');
    const its = a4c ? a4c.ops.filter((o) => o.type === 'add-at-end') : [];
    eq('  § 4c(a) adds in three places', its.length, 3);
    eq('    new subparagraph (D) is a sibling, not a child',
       its.map((o) => o.scope).join(' '), '(a)(3) (a)(4)(A) (a)(4)(B)');
    ok('    and each addition is the clause/subparagraph it says',
       its.every((o) => /^\((D|iv)\) a contract of sale of a digital/.test(o.text)),
       JSON.stringify(its.map((o) => (o.text || '').slice(0, 24))));
  }
  // Counted per amendment above, so a distributed instruction's operand appears
  // once for each provision it changes. Distinct spans are what the bill pane
  // actually marks, and 16 entries collapsing to 4 spans is the whole design.
  const spans = new Set(
    ams.flatMap((a) => a.ops.filter((o) => o.start != null).map((o) => `${o.type}:${o.start}-${o.end}`))
  );
  // 84 + the 27 additions, which now carry the offsets of the language they add
  // and so are spans the bill pane can mark. They used to carry none at all.
  // +5 for the position-unsaid punctuation strikes above: one distinct span
  // each, which is the check that none of them landed on top of an existing op.
  // +7 for the over-budget anchored inserts, and this is the assertion that
  // makes those trustworthy rather than the count: seven new ops producing seven
  // new DISTINCT spans is what proves none of them was read twice — once by the
  // block reader and once by the generic scan that used to own this shape.
  // +2 for the two replacements. Both are NEW spans rather than conversions of
  // an existing insert, and two ops producing two distinct spans is what proves
  // neither block was claimed twice — the same argument the seven above rest on.
  // +10 for the over-budget blocks with no anchor phrase the after-unit reader
  // can read, and this is again the assertion that makes them trustworthy: ten
  // new ops producing ten new DISTINCT spans is what proves none was read twice.
  eq('  which collapse to distinct spans', spans.size, 137);
  const quoted = ams.flatMap((a) => a.ops).filter((o) => o.text);
  ok('  and they are real quoted language', quoted.some((o) => /digital commodity/i.test(o.text)),
     JSON.stringify(quoted.slice(0, 3).map((o) => o.text)));
  // An operand offset that doesn't round-trip mismarks the diff in the bill pane.
  eq('  every operand offset round-trips',
     quoted.filter((o) => text.slice(o.start, o.end) !== o.text).length, 0);

  // "Title I of the Securities Exchange Act of 1934 (15 U.S.C. 78a et seq.) is
  // amended by adding at the end the following" — a whole-title target, which
  // neither matcher could see: there is no "section <number>" to anchor on.
  const titleAm = ams.find((a) => a.unit === 'Title I');
  ok('house print: a whole-title target is found', Boolean(titleAm),
     ams.map((a) => a.unit).join(' | ').slice(0, 120));
  ok('  and resolves through its parenthetical cite to 15 U.S.C. 78a',
     titleAm && titleAm.target && titleAm.target.title === '15' && titleAm.target.section === '78a',
     JSON.stringify(titleAm && titleAm.target && [titleAm.target.title, titleAm.target.section]));

  // The Act this bill is mostly about. It was absent from the popular-name
  // table, so every one of these cites resolved to nothing.
  const cea = cs.filter((c) => c.kind === 'act' && /Commodity Exchange Act/.test(c.act.name));
  ok('house print: the Commodity Exchange Act resolves', cea.length >= 50, `${cea.length} cites`);
  eq('  to 7 U.S.C. 1 et seq.', cea[0] && `${cea[0].act.title} ${cea[0].act.section}`, '7 1');

  const badPdf = cs.filter((c) => text.slice(c.start, c.end) !== c.text);
  eq('house print: all offsets round-trip', badPdf.length, 0);

  console.log(`  · house print: ${pages} pages, ${bill.sections.length} sections, ${cs.length} citations, ${ams.length} amendments`);
  // ------------------------------------------------ the two paths, one bill
  //
  // corpus.json has said for the life of this fixture that the House-passed
  // print and the govinfo plain text of the SAME bill are "the only direct
  // check that the two extraction paths agree on one document", and nothing
  // ever asked them. They did not agree: the text rendition produced 6
  // redesignations against the print's 8 and 72 inserts against 74, because it
  // is 37% longer for the same bill — govinfo indents its continuation lines
  // and a typeset PDF does not — so the body budget bought less of it. Both
  // renditions plainly contain all four missing operations.
  //
  // Asserted as an IDENTITY rather than as numbers, so it keeps its meaning
  // when the parser changes: whatever the two paths produce, they must produce
  // the same. The counts above pin the value; this pins the agreement.
  const clarityTextPath = join(ROOT, 'corpus/files/hr3633-119-eh-text.htm');
  if (existsSync(clarityTextPath)) {
    const html = readFileSync(clarityTextPath, 'utf8');
    const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    const t2 = normalizeText(
      (m ? m[1] : html)
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
    );
    const b2 = parseBill(t2);
    const c2 = extractCitations(t2);
    const a2 = extractAmendments(t2, c2, b2.divisions, b2.sections);
    eq('house print vs plain text: the same bill has the same operations',
       JSON.stringify(opCounts(a2)), JSON.stringify(ops));
    eq('  the same number of instructions', a2.length, ams.length);
    eq('  the same sections', b2.sections.length, bill.sections.length);
    eq('  and the same navigation steps',
       a2.reduce((n, a) => n + a.steps.length, 0),
       ams.reduce((n, a) => n + a.steps.length, 0));
  } else {
    console.log('  (corpus/files/hr3633-119-eh-text.htm missing — differential skipped)');
  }

  console.log(`  · ops: ${JSON.stringify(ops)}`);
} else {
  console.log('  (samples/hr3633eh-clarity-act-house-passed.pdf missing — skipped)');
}

// --------------------------------------------------------------- live eCFR
section('live eCFR API');
try {
  const r = await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json');
  const j = await r.json();
  const t40 = (j.titles || []).find((t) => t.number === 40);
  ok('titles.json reachable', !!t40, 'no title 40');
  if (t40) {
    const date = t40.latest_issue_date;
    const xr = await fetch(`https://www.ecfr.gov/api/versioner/v1/full/${date}/title-40.xml?part=60&section=60.1`);
    const xml = await xr.text();
    ok('section XML fetched', xml.includes('60.1'), `status ${xr.status}`);
    const ar = await fetch(`https://www.ecfr.gov/api/versioner/v1/ancestry/${date}/title-40.json?part=60&section=60.1`);
    const aj = await ar.json();
    ok('ancestry has a chain', (aj.ancestors || []).length >= 3, `${(aj.ancestors || []).length} ancestors`);
  }
} catch (err) {
  ok('eCFR reachable', false, err.message);
}

// --------------------------------------------------------------- local USC
section('ingested USC data');
{
  const mf = join(ROOT, 'data/usc/manifest.json');
  if (existsSync(mf)) {
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    const titles = Object.keys(m.titles || {});
    ok('manifest lists titles', titles.length > 0, JSON.stringify(titles));
    console.log(`  · ingested titles: ${titles.sort((a, b) => a - b).join(', ')}`);
    if (haveShard('data/usc/t1', 's112b')) {
      const d = readShard('data/usc/t1', 's112b');
      ok('section has a tree', d.tree.length > 0);
      ok('tree nests deeply', findNode(d.tree, '(k)(5)(A)(ii)(I)') !== null, 'deep path missing');
      ok('section has ancestors', d.ancestors.length > 0);
    }

    // Dashed section numbers, and undivided sections, through the real resolver.
    // Both were silent failures: USLM spells "77z-3" with an EN DASH so the
    // shard is written s77z_3.json, while a bill cites the ASCII "77z-3"; and a
    // section with no subsections keeps all its text in `lead`, which the
    // resolver used to drop on the floor.
    if (haveShard('data/usc/t15', 's77z_3')) {
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
      const { resolveUsc } = await imp('app/resolve/usc.js');

      // Seven section numbers in the Code are claimed by two different Public
      // Laws. One shard per number meant the second one written replaced the
      // first, and the pane showed whichever came later in the XML with nothing
      // to say the other existed — and these are not near-duplicates:
      // 5 U.S.C. 5757 is "Payment of expenses to obtain professional
      // credentials" AND "Extended assignment incentive", two unrelated
      // provisions that happen to share a number.
      const dup = await resolveUsc({ title: '5', section: '5757', subsection: '' });
      eq('a duplicated section number keeps both', (dup.also || []).length, 1);
      ok('  and they are different provisions',
         dup.heading && dup.also[0].heading && dup.heading !== dup.also[0].heading,
         `${dup.heading} / ${dup.also[0] && dup.also[0].heading}`);
      ok('  each with its own source credit',
         /Pub\. L\./.test(dup.sourceCredit) && /Pub\. L\./.test(dup.also[0].sourceCredit),
         `${dup.sourceCredit} | ${dup.also[0].sourceCredit}`);
      ok('  and the alternative carries readable text',
         (dup.also[0].tree || []).length > 0 || Boolean(dup.also[0].lead),
         'alternative has neither tree nor lead');
      // The ordinary case must not grow the key.
      const single = await resolveUsc({ title: '7', section: '1632c', subsection: '' });
      eq('a section with one meaning has no alternatives', (single.also || []).length, 0);

      const dashed = await resolveUsc({ title: '15', section: '77z-3', subsection: '' });
      ok('ASCII-hyphen cite resolves to the en-dash shard', !dashed.missing, dashed.reason);
      ok('undivided section still carries its text', Boolean(dashed.lead), 'lead empty');
      ok('  and that text is the operative language',
         /by rule or regulation/i.test(dashed.lead || ''), 'lead-in missing');

      // A level that lives in the lead rather than the tree. NEPA § 102(2)(C) —
      // the environmental impact statement — is written as "…(2) all agencies …
      // shall—" followed by an (A)–(L) list, so the tree has no "(2)" node and
      // the citation was answered with "this section has no such subsection".
      // Being told a provision is absent is worse than being told nothing.
      if (haveShard('data/usc/t42', 's4332')) {
        const eis = await resolveUsc({ title: '42', section: '4332', subsection: '(2)(C)' });
        ok('a run-in level does not defeat the lookup', !eis.focusMissing, eis.reason || 'focusMissing');
        eq('  the dropped level is named', eis.runIn, '(2)');
        eq('  and the tree path is used for the focus', eis.focusPath, '(C)');
        eq('  while the cited path is kept', eis.citedPath, '(2)(C)');
        ok('  the provision really is the EIS requirement',
           /detailed statement/i.test(eis.focusNode?.text || ''),
           JSON.stringify((eis.focusNode?.text || '').slice(0, 80)));
        // Depth below the run-in level still composes.
        const clause = await resolveUsc({ title: '42', section: '4332', subsection: '(2)(C)(i)' });
        eq('  and a deeper path resolves too', clause.focusPath, '(C)(i)');

        // The guard: this must not rescue a subsection that genuinely is not
        // there, which is the ordinary case when a bill is adding one.
        const absent = await resolveUsc({ title: '42', section: '4332', subsection: '(9)(Z)' });
        ok('an absent subsection is still reported absent', absent.focusMissing, JSON.stringify(absent.runIn));
        eq('  with no run-in claimed', absent.runIn, null);
      }

      // An Act's own subsection carried onto a Code section that IS that
      // subsection. 2 U.S.C. 4532 is credited "Pub. L. 100-202, § 101(i)
      // [title III, § 311(d)]", so its top level is the paragraphs (1)-(4) and
      // there is no (d) in it and never will be. Every reference in the
      // instruction "Section 311(d) of the Legislative Branch Appropriations
      // Act, 1988 (2 U.S.C. 4532) is amended" composed one level too deep, and
      // the pane told the reader the provision had been repealed or was being
      // added — about a paragraph sitting a few lines up in the same pane.
      if (haveShard('data/usc/t2', 's4532')) {
        const fixed = await resolveUsc({ title: '2', section: '4532', subsection: '(d)(3)', subFromHead: '(d)' });
        ok('a head-carried Act subsection is dropped when the section IS it',
           !fixed.focusMissing, JSON.stringify(fixed.focusPath));
        eq('  the dropped level is named', fixed.headLevel, '(d)');
        eq('  and the focus is the paragraph itself', fixed.focusPath, '(3)');
        ok('  which is the pay-relationship paragraph this bill inserts',
           /pay relationship described in this paragraph/i.test(fixed.focusNode?.text || ''),
           JSON.stringify((fixed.focusNode?.text || '').slice(0, 80)));

        // Only for an address COMPOSED from the head. A bill that writes the
        // subsection out in full has said what it means, and if that is wrong it
        // is the drafter's error to show rather than ours to paper over.
        const written = await resolveUsc({ title: '2', section: '4532', subsection: '(d)(3)' });
        ok('  a written-out address is not repaired', written.focusMissing, JSON.stringify(written.focusPath));
        eq('  and claims no dropped level', written.headLevel, null);
      }

      // A section that is no longer there, and where the Code says it went.
      // 9,547 of the shipped shards are empty — "Transferred", "Omitted",
      // "Repealed. Pub. L. …" — and 910 citations across the corpus land on one.
      // The pane used to render a one-word heading over a blank body.
      if (haveShard('data/usc/t42', 's10601')) {
        const moved = await resolveUsc({ title: '42', section: '10601', subsection: '(d)(3)' });
        eq('a transferred section is reported as a stub', moved.stub, 'Transferred');
        ok('  with the successor the Code names', moved.moved && moved.moved.citation === '34 U.S.C. 20101',
           JSON.stringify(moved.moved));
        // And the successor really does hold the provision that was cited: the
        // PATRIOT Act's 42 U.S.C. 10601(d)(3) is alive at 34 U.S.C. 20101(d)(3).
        const succ = await resolveUsc({ title: '34', section: '20101', subsection: '(d)(3)' });
        ok('  which really holds the cited provision', !succ.focusMissing && !succ.stub,
           JSON.stringify([succ.stub, succ.focusMissing]));
        ok('  and is not itself a stub', /Crime Victims Fund/.test(succ.heading || ''), succ.heading);
      }
      if (haveShard('data/usc/t26', 's71')) {
        // Repealed with nowhere to go — the reason is the whole answer, and
        // claiming a successor would be inventing one.
        const rep = await resolveUsc({ title: '26', section: '71', subsection: '' });
        ok('a repealed section is a stub too', /^Repealed\./.test(rep.stub || ''), rep.stub);
        eq('  and names no successor', rep.moved, null);
      }
      // The guard: a section WITH text has not moved, whatever its notes say
      // about some renumbering long ago.
      {
        const live = await resolveUsc({ title: '26', section: '1', subsection: '(d)' });
        eq('a section with text is never a stub', live.stub, null);
        eq('  and never claims to have moved', live.moved, null);
      }

      // The guard that keeps this narrow: the dropped marker must be absent from
      // the section's own top level. "clause (i)" composed onto 26 U.S.C. 168(k)
      // dies because (k) has no clause (i) — and 168 DOES have a subsection (i),
      // so dropping the (k) would answer with a different provision entirely.
      if (haveShard('data/usc/t26', 's168')) {
        const keep = await resolveUsc({ title: '26', section: '168', subsection: '(k)(i)', subFromHead: '(k)' });
        eq('a leading marker the section really has is kept', keep.headLevel, null);
        ok('  so the address stays missing rather than moving', keep.focusMissing, JSON.stringify(keep.focusPath));
      }
      globalThis.fetch = realFetch;
    }
  } else {
    console.log('  (no data/usc/manifest.json — run tools/ingest_usc.py)');
  }
}

// ----------------------------------------------------- deployment shape
// The site is served from this repo by GitHub Pages, which puts a project site
// at https://user.github.io/<repo>/. Two things follow, and both are silent
// failures rather than loud ones.
section('deployment shape');
{
  // ---- the library menu -------------------------------------------------
  // Every entry is a button that fetches a file. An entry naming a file that is
  // not there is a menu item that does nothing, and the manifest is generated —
  // so this is checking the generator and the repo agree, not proofreading a
  // hand-written list.
  const lib = JSON.parse(readFileSync(join(ROOT, 'samples/library.json'), 'utf8'));
  ok('the library offers several bills', lib.length >= 8, `${lib.length}`);
  const missing = lib.filter((e) => !existsSync(join(ROOT, e.file)));
  eq('  every entry has its file in the repo', missing.map((e) => e.file).join(', '), '');
  const wrongSize = lib.filter((e) => statSync(join(ROOT, e.file)).size !== e.bytes);
  eq('  and the recorded size matches the file', wrongSize.map((e) => e.id).join(', '), '');
  ok('  paths are relative, like every other fetch',
     lib.every((e) => !e.file.startsWith('/') && !/^https?:/.test(e.file)),
     lib.map((e) => e.file).filter((f) => f.startsWith('/')).join(', '));
  ok('  each is named and described', lib.every((e) => e.name && e.note),
     lib.filter((e) => !e.name || !e.note).map((e) => e.id).join(', '));

  // ---- every entry says WHEN --------------------------------------------
  // Derived, not typed: an enrolled bill prints its own session in words
  // ("…the third day of January, two thousand and twenty"), and a session runs
  // inside one calendar year, so that is the year the Act was passed. A bill
  // that is still pending has no such preamble and no enactment year at all —
  // it takes the year its Congress convened, which is what the names of pending
  // bills use anyway ("Farm to Fly Act of 2025", 119th Congress).
  const noYear = lib.filter((e) => !/\b(?:1[89]\d\d|20\d\d)\b/.test(e.name));
  eq('every library entry carries a year', noYear.map((e) => e.name).join(', '), '');
  ok('  and none shows it twice',
     lib.every((e) => (e.name.match(/\b(?:1[89]\d\d|20\d\d)\b/g) || []).length === 1),
     lib.filter((e) => (e.name.match(/\b(?:1[89]\d\d|20\d\d)\b/g) || []).length !== 1)
        .map((e) => e.name).join(', '));
  ok('  never as two adjacent parentheticals',
     !lib.some((e) => /\)\s*\(\d{4}\)$/.test(e.name)),
     lib.filter((e) => /\)\s*\(\d{4}\)$/.test(e.name)).map((e) => e.name).join(', '));
  // Landmarks, because a derived year is only worth having if it is right.
  // These are the dates these Acts are known by.
  for (const [id, year] of [
    ['hr3162-107-enr', 2001],   // USA PATRIOT Act, 26 Oct 2001
    ['hr3590-111-enr', 2010],   // ACA, 23 Mar 2010
    ['hr1-115-enr', 2017],      // Tax Cuts and Jobs Act, 22 Dec 2017
    ['hr748-116-enr', 2020],    // CARES Act, 27 Mar 2020
    ['s2938-117-enr', 2022],    // Bipartisan Safer Communities Act, 25 Jun 2022
    ['hr3633-119-rs-substitute', 2025], // pending: the 119th Congress convened 2025
  ]) {
    const e = lib.find((x) => x.id === id);
    eq(`  ${e ? e.name.replace(/\s*\(.*$/, '') : id} is ${year}`, e && e.year, year);
  }
  // A name that already carries its year is left alone rather than doubled.
  const already = lib.find((e) => e.id === 'hr5376-117-enr');
  eq('  a name with its own year is untouched', already.name, 'Inflation Reduction Act of 2022');
  // The point of the menu is range: one 117 KB bill was a poor answer to "what
  // does this do?" when the repo holds an appropriations act with 660 sections.
  ok('  spanning small to large', lib[0].bytes < 50_000 && lib[lib.length - 1].bytes > 1_000_000,
     `${lib[0].bytes} … ${lib[lib.length - 1].bytes}`);
  ok('  sorted so the smallest is first',
     lib.every((e, i) => i === 0 || lib[i - 1].bytes <= e.bytes), 'not ascending by size');
  // The local server must serve what a deploy serves. It used to refuse
  // /corpus/, which was right while nothing linked there and is wrong now that
  // the menu does — a 404 locally and a working link deployed is the disagreement
  // the block existed to prevent, pointing the other way.
  const serve = readFileSync(join(ROOT, 'tools/serve.py'), 'utf8');
  const fromCorpus = lib.filter((e) => e.file.startsWith('corpus/'));
  ok('  the library draws on the corpus', fromCorpus.length > 0, `${fromCorpus.length}`);
  ok('  and the dev server no longer refuses it', /BLOCKED\s*=\s*\(\s*\)/.test(serve),
     (serve.match(/BLOCKED\s*=\s*\([^)]*\)/) || [''])[0]);

  const { DATA, isLocalCheckout } = await imp('app/resolve/data-base.js');

  // A leading slash would resolve against the ACCOUNT root, not the repo, and
  // 404 all 63,000 shards on a project site while working perfectly locally.
  eq('the data base is relative', DATA, 'data/usc');
  ok('  with no leading slash', !DATA.startsWith('/'), DATA);
  ok('  and no host', !/^https?:/.test(DATA), DATA);

  // No `location` means a headless DOM, i.e. the tests, i.e. a checkout — the
  // same shape as the window.top guard: the missing global IS the answer.
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
  ok('no location reads as a checkout', isLocalCheckout());
  const setHost = (hostname, protocol = 'https:') =>
    Object.defineProperty(globalThis, 'location', {
      value: { hostname, protocol }, configurable: true, writable: true,
    });
  setHost('localhost', 'http:');
  ok('localhost is a checkout', isLocalCheckout());
  setHost('127.0.0.1', 'http:');
  ok('127.0.0.1 is a checkout', isLocalCheckout());
  setHost('example.github.io');
  ok('a real host is not', !isLocalCheckout());

  // On a deployed page, "run this Python command" is not a remedy — the reader
  // has no checkout and no terminal. They keep the outbound links, which are
  // the thing that actually helps them.
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
  const { resolveUsc } = await imp('app/resolve/usc.js');
  const away = await resolveUsc({ title: '99', section: '1', subsection: '' });
  eq('a deployed page offers no shell command', away.remedy, null);
  ok('  nor names one in the reason', !/python|tools\//.test(away.reason || ''), away.reason);
  ok('  but still says what is missing', /Title 99/.test(away.reason || ''), away.reason);
  ok('  and still links out', (away.links || []).length > 0, `${(away.links || []).length}`);
  globalThis.fetch = realFetch;

  if (saved) Object.defineProperty(globalThis, 'location', saved);
  else delete globalThis.location;
  ok('location restored for later tests', isLocalCheckout());
}

// ------------------------------------------- Act section -> Code section
// An Act's own numbering is not the Code's, and bills cite the Act's. The
// mapping is not arithmetic and cannot be guessed; it is inverted out of the
// source credit the Code prints on every section. These check the two halves
// separately, because either can be right while the other is wrong: extraction
// must carry the Act-relative number, and resolution must land on the section
// the OLRC actually codified it as.
section('Act section → Code section');
{
  const acts = join(ROOT, 'data/usc/acts');

  // Extraction needs no data at all.
  const t = 'Section 1861(s)(2)(B) of the Social Security Act is amended.';
  const cs = extractCitations(t);
  eq('the Act-relative cite is one citation', cs.length, 1);
  eq('  of kind act, not usc', cs[0].kind, 'act');
  eq('  carrying the Act section', cs[0].actSection, '1861');
  eq('  and the subsection', cs[0].subsection, '(s)(2)(B)');
  eq('  spanning the whole phrase', cs[0].text, 'Section 1861(s)(2)(B) of the Social Security Act');
  // The bare Act-name match is inside this one and must not survive beside it,
  // or the bill pane draws two chips over one citation.
  ok('  and it replaces the bare Act-name chip', !cs.some((c) => c.text === 'Social Security Act'),
     JSON.stringify(cs.map((c) => c.text)));

  // A whole-Act mention keeps its old meaning.
  const whole = extractCitations('The Social Security Act is amended.');
  eq('a bare Act name is still the whole Act', whole[0] && whole[0].actSection, undefined);

  if (haveShard('data/usc/acts', 'aug_14_1935_ch_531')) {
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
    const { resolveActSection, actSlug } = await imp('app/resolve/act-sections.js');
    const { findAct } = await imp('app/resolve/popular-names.js');

    // The slug has to agree with act_slug() in the ingester or every lookup
    // 404s silently — the same standing hazard as slug() for section shards.
    eq('slug collapses punctuation runs', actSlug('Aug. 14, 1935, ch. 531'), 'aug_14_1935_ch_531');
    eq('  and an EN DASH reaches the same file as a hyphen',
       actSlug('Pub. L. 89–10'), actSlug('Pub. L. 89-10'));

    // The four Acts the README used to list as unresolvable. Each answer is
    // checkable against the OLRC by hand, which is the point of choosing them.
    const known = [
      ['Social Security Act', '1861', '42', '1395x'],
      ['Social Security Act', '1862', '42', '1395y'],
      ['Social Security Act', '401', '42', '601'],
      ['Public Health Service Act', '330', '42', '254b'],
      ['Immigration and Nationality Act', '212', '8', '1182'],
      ['Commodity Exchange Act', '4', '7', '6'],
      ['Commodity Exchange Act', '5', '7', '7'],
    ];
    for (const [name, sec, title, code] of known) {
      const at = await resolveActSection(findAct(name), sec);
      eq(`${name} § ${sec} → ${title} U.S.C. ${code}`,
         at ? `${at.title} ${at.section}` : 'null', `${title} ${code}`);
    }

    // Blank beats wrong, in three shapes.
    eq('an unindexed Act resolves to nothing',
       await resolveActSection({ name: 'X', enactedAs: 'Jan. 1, 1900, ch. 1' }, '1'), null);
    eq('an Act with no enactedAs is never looked up',
       await resolveActSection({ name: 'Clean Air Act' }, '111'), null);
    eq('a section the Act never had resolves to nothing',
       await resolveActSection(findAct('Social Security Act'), '99999'), null);

    // End to end, through the dispatcher the UI actually calls.
    const { resolve } = await imp('app/resolve/index.js');
    const res = await resolve(extractCitations(
      'Section 1861(s)(2)(B) of the Social Security Act is amended.')[0]);
    eq('the dispatcher lands on the codified section', res.citation, '42 U.S.C. 1395x(s)(2)(B)');
    ok('  and shows its derivation rather than asserting it',
       res.viaActSection && res.viaActSection.codified === '42 U.S.C. 1395x',
       JSON.stringify(res.viaActSection));
    ok('  with no numbering caveat, the gap being closed', !res.offsetNote, res.offsetNote);
    ok('  and the real provision is there',
       /physician/i.test(JSON.stringify(res.focusNode || '')), res.reason || 'no focus node');

    // THE cache guard. Both citations are kind `act` on the same Act with no
    // `section` of their own, so before actSection joined the key the second was
    // served the first one's provision straight out of the memo.
    const a = await resolve(extractCitations('Section 1861 of the Social Security Act.')[0]);
    const b = await resolve(extractCitations('Section 1862 of the Social Security Act.')[0]);
    eq('two sections of one Act do not share a cache entry',
       `${a.citation} | ${b.citation}`, '42 U.S.C. 1395x | 42 U.S.C. 1395y');

    // The manifest counts FILES, not writes — the same rule the section count
    // follows, and for the same reason. It caught a real one: the rebuild after
    // the "formerly § N" fix left ten Act files behind from the older parser,
    // and a stale mapping is indistinguishable from a current one at lookup time.
    const mf = JSON.parse(readFileSync(join(ROOT, 'data/usc/manifest.json'), 'utf8'));
    // The manifest is now checked against the BUNDLE's index rather than a
    // directory listing, which is the same invariant read off what the app
    // actually loads. `_conflicts` is apparatus, not an Act.
    const bundled = Object.keys(
      JSON.parse(readFileSync(join(ROOT, 'data/usc/acts.idx.json'), 'utf8')).at
    ).filter((k) => !k.startsWith('_'));
    eq('manifest.acts equals the number of Act entries', mf.acts, bundled.length);

    const idx = readShard('data/usc/acts', 'aug_14_1935_ch_531');
    console.log(`  · ${bundled.length} Acts indexed; Social Security Act: ${Object.keys(idx.sections).length} sections mapped`);
    globalThis.fetch = realFetch;
  } else {
    console.log('  (no data/usc/acts.idx.json — run tools/ingest_usc.py --acts-only && node tools/bundle.mjs)');
  }
}

// A skipped block is reported as a pass, so the absence of the data is asserted
// rather than left to whoever notices the total moved. Bundling the shards turned
// eleven guards false at once and quietly stopped 192 selftest checks and 31
// render checks from running; nothing failed, and the suite said so.
ok('the ingested Code is present, so the data-dependent checks above really ran',
   haveShard('data/usc/t42', 's7401') && haveShard('data/usc/acts', 'aug_14_1935_ch_531'),
   'data/usc/*.idx.json missing — run: python tools/ingest_usc.py --titles all && node tools/bundle.mjs --prune');

// ------------------------------------------------------------------- report
console.log(`\n${'─'.repeat(52)}`);
if (fail) {
  console.log(`\x1b[31m${fail} failed\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
}
