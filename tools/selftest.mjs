// Logic self-test for the parsing/resolution modules.
//
// Run with:  bun tools/selftest.mjs      (or: node tools/selftest.mjs)
//
// Covers the pure modules — citation extraction, the subsection tree, bill
// structure — plus a live eCFR round trip. The DOM renderers aren't exercised
// here; they need a browser.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { extractCitations, extractAmendments, subsectionLadder, expandRelativeRefs } =
  await import(join(ROOT, 'app/parse/citations.js'));
const { buildTree, findNode, pathChain } = await import(join(ROOT, 'app/resolve/provision-tree.js'));
const { parseBill, normalizeText } = await import(join(ROOT, 'app/parse/bill.js'));
const { findAct } = await import(join(ROOT, 'app/resolve/popular-names.js'));

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
     (ams[0]?.steps || []).map((s) => s.path).join(' '), '(A) (B)');
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
  const { encodeBill, decodeBill, readSharedBill } = await import(join(ROOT, 'app/share.js'));
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
  const { pdfToText } = await import(join(ROOT, 'app/parse/pdf.js'));

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

  const each = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``fee\'\' each place it appears and inserting ``charge\'\'.\n');
  ok('"each place it appears" marks the strike', each.find((o) => o.type === 'strike').all === true);
  ok('  and still pairs the replacement', each.find((o) => o.type === 'insert').replaces != null);

  const atEnd = p('Section 2 of the Widget Act (15 U.S.C. 2601) is amended by striking ``and\'\' at the end.\n');
  ok('"at the end" marks the strike', atEnd.find((o) => o.type === 'strike').atEnd === true);

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
  const { amendmentFor } = await import(join(ROOT, 'app/parse/citations.js'));
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
  const { createRedline } = await import(join(ROOT, 'app/ui/redline.js'));
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

// ------------------------------------------------- internal cross-references
// The commonest citation kind in a modern bill — 162 of the 164 internal refs
// in the CLARITY Act's House print are the bare "clause (ii)" form — and until
// now clicking one produced a sentence restating what had been clicked. They
// resolve inside the bill, so the answer is to go and show the provision.
section('internal cross-references');
{
  const { locateInternal } = await import(join(ROOT, 'app/resolve/internal.js'));

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

  // Against the real bills: this has to work at scale, not just on fixtures.
  if (existsSync(samplePath)) {
    const real = normalizeText(readFileSync(samplePath, 'utf8'));
    const rb = parseBill(real);
    const rc = extractCitations(real).filter((c) => c.kind === 'internal');
    const hits = rc.map((c) => locateInternal(rb, c)).filter(Boolean);
    // Exact, and expected to move when the locator improves — that is the point
    // of tracking it. The rest are references out to the U.S. Code rather than
    // into the bill, which correctly resolve to nothing.
    eq('locates the internal refs it can', hits.length, 74);
    ok('  which is most of them', hits.length >= rc.length * 0.75, `${hits.length}/${rc.length}`);

    // Every target must land on an outline marker, or on the head of the bill
    // section when the reference named a whole section.
    const bad = hits.filter(
      (r) => real[r.start] !== '(' && !(r.section && r.start === r.section.start)
    );
    eq('  every target lands on a marker or a section head', bad.length, 0);
    console.log(`  · sample bill: ${hits.length}/${rc.length} internal refs located`);
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
 */
function uncoveredAmendVerbs(text, ams) {
  const re = /\b(is|are)\s+(amended|repealed)\b/g;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    const i = m.index;
    if (!ams.some((a) => i >= (a.viaInstruction ?? a.start) && i <= a.end)) n++;
  }
  return n;
}

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
  eq('  and the first section under title I does',
     (bill.sections.find((s) => s.num === '101') || {}).division,
     'TITLE I—-RESPONSIBLE SECURITIES INNOVATION');

  // Quoted, and wrapped across a line — "``Digital Asset \nMarket Clarity Act''"
  // — so it arrived with the quote marks and the line break still in it.
  eq('substitute: reads the short title', bill.meta.shortTitle, 'Digital Asset Market Clarity Act');

  // Bounded on both sides: the count matching the number of amendatory verbs in
  // the source is the real assertion, and `uncovered` is what makes it one.
  eq('substitute: finds every amendment', ams.length, 20);
  eq('  every amendatory verb is inside one', uncoveredAmendVerbs(text, ams), 0);
  eq('  and all but the two structural targets resolve', ams.filter((a) => a.target).length, 18);

  eq('substitute: extracts the operations', JSON.stringify(opCounts(ams)),
     JSON.stringify({ strike: 14, insert: 28, 'add-at-end': 9, redesignate: 4 }));

  eq('substitute: composes the navigation steps', ams.reduce((n, a) => n + a.steps.length, 0), 22);
  // 30, not 35. Five unit phrases sit inside quoted law the bill is *inserting*
  // — "…identified in clauses (i) through (vi) of subparagraph (A) of this
  // paragraph" says outright that it means the new provision — and composing
  // those against the instruction's target addressed existing law that has
  // nothing to do with them. They stay internal, where locateInternal finds them
  // a few lines up in the quoted block.
  eq('  and the in-place references', ams.reduce((n, a) => n + a.refs.length, 0), 30);
  eq('  into relative addresses', expandRelativeRefs(cs, ams).filter((c) => c.relative).length, 49);

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
  const { pdfToText } = await import(join(ROOT, 'app/parse/pdf.js'));
  const { text: raw, pages } = await pdfToText(new Uint8Array(readFileSync(clarityPdfPath)).buffer);
  const text = normalizeText(raw);
  const bill = parseBill(text);
  const cs = extractCitations(text);
  const ams = extractAmendments(text, cs);

  eq('house print: reads every page', pages, 258);
  eq('house print: finds every section', bill.sections.length, 66);
  eq('house print: counts each division once', bill.divisions.length, 6);

  // A typeset heading wraps and hyphenates mid-word — "TITLE I—DEFINITIONS;
  // RULE- / MAKING; EXPEDITED REG- / ISTRATION" — putting three continuation
  // lines between the division and its first section. Reading one of those as
  // the end of the table of contents lost the real title I entirely.
  ok('  including the one whose heading wraps three lines',
     bill.divisions.some((d) => d.label === 'TITLE I'), bill.divisions.map((d) => d.label).join(','));

  eq('house print: reads the short title', bill.meta.shortTitle, 'Digital Asset Market Clarity Act of 2025');
  ok('  and stops at the first of the three names it gives itself',
     !/CLARITY Act of 2025|Anti-CBDC/.test(bill.meta.shortTitle || ''), bill.meta.shortTitle);

  eq('house print: finds the amendments', ams.length, 63);
  eq('  all but one resolve a target', ams.filter((a) => a.target).length, 62);
  eq('  every amendatory verb is inside one', uncoveredAmendVerbs(text, ams), 0);

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
  const ops = opCounts(ams);
  eq('house print: extracts ‘‘...’’ operands', JSON.stringify(ops),
     JSON.stringify({ 'add-at-end': 24, insert: 57, redesignate: 6, strike: 39 }));
  // Counted per amendment above, so a distributed instruction's operand appears
  // once for each provision it changes. Distinct spans are what the bill pane
  // actually marks, and 16 entries collapsing to 4 spans is the whole design.
  const spans = new Set(
    ams.flatMap((a) => a.ops.filter((o) => o.start != null).map((o) => `${o.type}:${o.start}-${o.end}`))
  );
  eq('  which collapse to distinct spans', spans.size, 84);
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
    const probe = join(ROOT, 'data/usc/t1/s112b.json');
    if (existsSync(probe)) {
      const d = JSON.parse(readFileSync(probe, 'utf8'));
      ok('section has a tree', d.tree.length > 0);
      ok('tree nests deeply', findNode(d.tree, '(k)(5)(A)(ii)(I)') !== null, 'deep path missing');
      ok('section has ancestors', d.ancestors.length > 0);
    }

    // Dashed section numbers, and undivided sections, through the real resolver.
    // Both were silent failures: USLM spells "77z-3" with an EN DASH so the
    // shard is written s77z_3.json, while a bill cites the ASCII "77z-3"; and a
    // section with no subsections keeps all its text in `lead`, which the
    // resolver used to drop on the floor.
    if (existsSync(join(ROOT, 'data/usc/t15/s77z_3.json'))) {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (/^https?:/i.test(u)) return realFetch(u, opts);
        const p = join(ROOT, u);
        if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
        return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')) };
      };
      const { resolveUsc } = await import(join(ROOT, 'app/resolve/usc.js'));
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
      if (existsSync(join(ROOT, 'data/usc/t42/s4332.json'))) {
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
      globalThis.fetch = realFetch;
    }
  } else {
    console.log('  (no data/usc/manifest.json — run tools/ingest_usc.py)');
  }
}

// ------------------------------------------------------------------- report
console.log(`\n${'─'.repeat(52)}`);
if (fail) {
  console.log(`\x1b[31m${fail} failed\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
}
