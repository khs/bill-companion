// Headless render test for the DOM code (bill pane + context pane).
//
//   bun add -d linkedom      # one-time; the app itself has no dependencies
//   bun tools/rendertest.mjs
//
// Skips cleanly if linkedom isn't installed. tools/selftest.mjs covers the pure
// parsing/resolution logic and needs no dependencies at all.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

let parseHTML;
try {
  ({ parseHTML } = await import('linkedom'));
} catch {
  console.log('linkedom not installed — skipping render tests.');
  console.log('  install with:  bun add -d linkedom   (or npm i -D linkedom)');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const failures = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(`${n}${d ? ` — ${d}` : ''}`); } };
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** Where two strings first diverge, with a little context either side. */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: rendered ${JSON.stringify(a.slice(i - 40, i + 40))} vs source ${JSON.stringify(b.slice(i - 40, i + 40))}`;
}

// --- install a DOM ---------------------------------------------------------
const { window, document } = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8'));
globalThis.window = window;
globalThis.document = document;
globalThis.DOMParser = window.DOMParser;
// main.js builds the jump menu with `new Option(...)`. linkedom has no usable
// Option constructor, so back it with a real <option> element — a plain object
// would blow up inside appendChild rather than testing anything.
globalThis.Option = function Option(text, value) {
  const o = document.createElement('option');
  o.textContent = text;
  o.value = value ?? text;
  return o;
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
// linkedom has no CSSOM, so document.styleSheets is empty and the export would
// inline nothing. Report the real stylesheet the way a browser does, so the
// "it carries its own styling" check is testing the builder rather than the
// harness.
Object.defineProperty(document, 'styleSheets', {
  configurable: true,
  value: [{ cssRules: [{ cssText: readFileSync(join(ROOT, 'app/ui/style.css'), 'utf8') }] }],
});
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

section('CSS / markup contract');
{
  // linkedom does no cascade, so this class of bug is invisible to render tests.
  // Check it structurally instead: any element the app toggles via the `hidden`
  // attribute is broken if an author rule sets `display` on one of its classes,
  // because author origin beats the UA sheet's [hidden] rule at any specificity.
  // The paste modal shipped exactly this way — permanently on screen, Parse dead.
  const css = readFileSync(join(ROOT, 'app/ui/style.css'), 'utf8');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  const override = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/i.test(css);
  ok('stylesheet forces [hidden] to win over author display rules', override);

  // Report which elements depend on that rule, so removing it fails loudly.
  const classesWithDisplay = new Set();
  for (const m of css.matchAll(/\.([A-Za-z][\w-]*)[^{,]*\{([^}]*)\}/g)) {
    if (/(^|;)\s*display\s*:/.test(m[2])) classesWithDisplay.add(m[1]);
  }
  const atRisk = [];
  for (const el of html.matchAll(/<[a-z]+[^>]*\bhidden\b[^>]*>/gi)) {
    const cls = (el[0].match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
    const hit = cls.filter((c) => classesWithDisplay.has(c));
    if (hit.length) atRisk.push(hit.join('.'));
  }
  ok('hidden elements with display rules are covered by the override',
     atRisk.length === 0 || override, `at risk: ${atRisk.join(', ')}`);
  if (atRisk.length) console.log(`  · relies on the [hidden] override: ${atRisk.join(', ')}`);

  // Every class the app toggles at runtime must be styled, for the same reason:
  // linkedom has no cascade, so a class that exists in the markup and nowhere in
  // the stylesheet passes every render test while doing nothing on screen. The
  // internal-reference highlight is exactly that shape — main.js adds
  // `jump-target` and the entire visible effect is one CSS rule.
  const styled = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  const toggled = new Map();
  for (const f of ['app/main.js', 'app/ui/render-bill.js', 'app/ui/render-context.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/classList\.(?:add|toggle)\(\s*['"]([A-Za-z][\w-]*)['"]/g)) {
      toggled.set(m[1], f);
    }
    // `classList.add` was only ever half of it. Most of this app's classes are
    // set by assigning `className` outright, and those were exempt from the
    // check for no reason other than the pattern it was written with — an
    // unstyled one is just as invisible, and just as dead on screen. Template
    // literals contribute their static head ("cite cite-${kind}" gives "cite"),
    // which is the part a stylesheet can be expected to name.
    for (const m of src.matchAll(/\.className\s*=\s*(['"`])([^'"`$]*)/g)) {
      // A token ending in "-" is the severed head of an interpolation
      // ("cite cite-${c.kind}"), not a class anyone can write a rule for.
      for (const c of m[2].trim().split(/\s+/)) {
        if (/^[A-Za-z][\w-]*[A-Za-z0-9]$/.test(c) || /^[A-Za-z]$/.test(c)) toggled.set(c, f);
      }
    }
  }
  const unstyled = [...toggled].filter(([c]) => !styled.has(c));
  ok('every class the app toggles is styled', unstyled.length === 0,
     unstyled.map(([c, f]) => `${c} (${f})`).join(', '));
  ok('  and the set is non-trivial', toggled.size >= 10, `${toggled.size} classes`);
  ok('  including the internal-reference highlight', styled.has('jump-target') && toggled.has('jump-target'),
     'jump-target is not both toggled and styled');
  // The guess mark is the one class where losing the rule loses the meaning
  // rather than the decoration: an unstyled jump-guess renders identically to a
  // certain match, which is the exact confusion it exists to prevent.
  ok('  and the guess mark, which must not look like a match',
     styled.has('jump-guess') && toggled.has('jump-guess'),
     'jump-guess is not both toggled and styled');
}

section('DOM wiring');
// Every id main.js looks up must exist in index.html, or the app dies on load.
const IDS = ['file', 'paste-btn', 'sample-btn', 'sample-menu', 'bill-body', 'ctx-body', 'ctx-src', 'ctx-back',
  'status', 'billmeta', 'meta-desig', 'meta-short', 'jump', 'only-amend', 'split', 'gutter',
  'theme-btn', 'paste-modal', 'paste-area', 'paste-ok', 'paste-cancel',
  'full-btn', 'about-btn', 'about-modal', 'about-ok', 'embed-snippet', 'embed-copy'];
eq('all main.js element ids exist in index.html',
   IDS.filter((id) => !document.getElementById(id)).join(',') || 'none', 'none');

// --- bill pane -------------------------------------------------------------
section('bill renderer');
const { parseBill, normalizeText } = await imp('app/parse/bill.js');
const { extractCitations, extractAmendments } = await imp('app/parse/citations.js');
const { renderBill } = await imp('app/ui/render-bill.js');

const samplePath = join(ROOT, 'samples/sample-bill.txt');
if (existsSync(samplePath)) {
  const text = normalizeText(readFileSync(samplePath, 'utf8'));
  const bill = parseBill(text);
  const cites = extractCitations(text);
  const amends = extractAmendments(text, cites);

  let clicked = null;
  const el = renderBill(bill, cites, amends, (c) => { clicked = c; }, () => {});
  const chips = el.querySelectorAll('.cite');

  eq('renders one chip per citation', chips.length, cites.length);
  // Every parsed section must render its heading. A loose ">5" hid a heading
  // silently losing its class (and its #sec-N jump anchor) when the following
  // line got merged into it to keep a straddling citation intact.
  eq('renders a heading for every parsed section',
     el.querySelectorAll('.sec-head').length, bill.sections.length);

  // ---- whitespace the measure put there, and whitespace the drafter did ---
  // A bill hard-wraps at ~72 columns AND indents its continuation lines, so a
  // phrase broken across the measure carries both: "the Balanced Budget and
  // \n      Emergency Deficit Control Act". Replacing only the newline left six
  // stray spaces through the middle of a phrase, and `white-space: pre-wrap`
  // rendered them faithfully, because they really are in the source.
  {
    // Wrapped exactly the way govinfo wraps: the break comes first, the next
    // line's indentation after it. Both halves of the run have to go, and the
    // indent is what makes the run long enough to be unmissable.
    const tw = normalizeText(
      'SEC. 9. WHITESPACE.\n' +
      '    Amounts under section 251(b) of the Balanced Budget and\n' +
      '      Emergency Deficit Control Act of 1985 shall be available:  Provided,\n' +
      'That the Small\n' +
      '              Business Administration shall report.\n'
    );
    const bw = parseBill(tw);
    const cw = extractCitations(tw);
    const ew = renderBill(bw, cw, extractAmendments(tw, cw, bw.divisions), () => {}, () => {});
    const body = [...ew.querySelectorAll('p')].map((q) => q.textContent).join(' ');

    ok('a phrase broken across the measure reads as one phrase',
       /Balanced Budget and Emergency Deficit Control Act/.test(body), JSON.stringify(body.slice(0, 130)));
    ok('  including where the next line is deeply indented',
       /the Small Business Administration/.test(body), JSON.stringify(body.slice(-90)));
    // Not a blanket collapse. govinfo double-spaces after a colon, and that is
    // the drafter's typography rather than an artifact of the measure.
    ok('a double space the drafter wrote is left alone',
       /available:  Provided/.test(body), JSON.stringify(body.slice(0, 200)));
    // The paragraph's own indent carries the outline level.
    const first = [...ew.querySelectorAll('p')].find((q) => /Amounts under/.test(q.textContent));
    ok('  and the paragraph keeps its own leading indent',
       /^ {4}Amounts under/.test(first.textContent), JSON.stringify(first.textContent.slice(0, 24)));
    // The chip is the thing the reader clicks; a run inside it is unmissable.
    const chip = [...ew.querySelectorAll('.cite')].find((c) => /Balanced Budget/.test(c.textContent));
    ok('a citation chip carries no run of spaces', chip && !/ {2}/.test(chip.textContent),
       JSON.stringify(chip && chip.textContent));
  }

  // ---- where each section sits ------------------------------------------
  // Every section under a division carries its chain; the three above the
  // first division carry nothing, because there is nothing to carry.
  const withWhere = el.querySelectorAll('.sec-where').length;
  eq('a breadcrumb for every section inside a division', withWhere,
     bill.sections.filter((s) => s.ancestors.length).length);
  const w123 = el.querySelector('#sec-123 .sec-where');
  ok('the breadcrumb names the division as well as the title',
     w123 && /DIVISION A/.test(w123.textContent) && /TITLE III/.test(w123.textContent),
     JSON.stringify(w123 && w123.textContent));
  // It lives INSIDE the heading paragraph, so #sec-N still scrolls to
  // something containing it and the amendments-only filter keeps the two
  // together — `.billtext.filtered p:not(.has-amend):not(.sec-head)` would
  // otherwise hide a breadcrumb that had been made a sibling.
  ok('the breadcrumb is inside the heading it belongs to',
     w123 && w123.parentElement === el.querySelector('#sec-123'),
     'a sibling breadcrumb is hidden by the amendments-only filter');

  // ---- headings that ran past the measure --------------------------------
  // The tail of a wrapped heading belongs to the heading. Rendered as its own
  // paragraph it became a caps-locked orphan line of body text, and the pane
  // showed "SEC. 271. TERMINATION … ON FEDERAL STUDENT" with "LOANS; …"
  // stranded underneath in a different style.
  const h271 = el.querySelector('#sec-271');
  ok('a wrapped heading renders as one paragraph',
     h271 && /FEDERAL STUDENT LOANS; RESUMPTION/.test(h271.textContent.replace(/\s+/g, ' ')),
     JSON.stringify(h271 && h271.textContent.replace(/\s+/g, ' ').slice(0, 90)));
  // The trap that guards it: RE_HEAD is `$`-anchored with no `m` flag, so
  // matching it against the whole merged paragraph fails and the heading
  // silently loses its class and its jump anchor rather than erroring.
  ok('  and keeps its class and its #sec-N anchor',
     h271 && h271.className.includes('sec-head'), JSON.stringify(h271 && h271.className));
  // Exact equality, not a range. ">0" once waved through a first-overlap bug
  // that rendered a single block for eleven amendments, and the ">= n-1" that
  // replaced it was slack left over from two amendments sharing a paragraph —
  // where the renderer finds only the first and the second silently loses its
  // block. Every amendment now begins at an outline marker or a heading, both of
  // which open a paragraph, so parity is a property the renderer actually has:
  // measured exact on all five sample bills, including the two carrying
  // distributed amendments. If this drops by one, an amendment has gone
  // invisible — which is precisely the bug the loose bound was hiding.
  const blocks = el.querySelectorAll('.amend').length;
  eq('renders exactly one block per amendment', blocks, amends.length);
  // Each amendment must own at most one wrapper — no double-wrapping.
  eq('no paragraph is wrapped twice', el.querySelectorAll('.amend .amend').length, 0);

  // Rendered text must track the source: proof that offset splicing neither
  // dropped nor duplicated any of the bill.
  //
  // Exact, not a 5% length ratio. The ratio was measuring UI chrome as much as
  // correctness — the amendment tags, the op chips and now the section
  // breadcrumbs are all text the bill does not contain — so it had slack for
  // roughly 5,000 characters of real loss, and it broke the moment a bill grew
  // enough breadcrumbs rather than when anything went wrong. Strip the chrome
  // and the remainder is the bill, character for character.
  // Paragraphs are joined with a space, because the blank line between two of
  // them is a boundary rather than content and so is not rendered into either.
  // Under \s+ collapsing that space is a no-op wherever the source already had
  // one — which is all but 15 of 557 boundaries in this bill, and exactly the
  // slack a length ratio could never distinguish from real loss.
  const clone = el.cloneNode(true);
  for (const chrome of clone.querySelectorAll('.sec-where, .amend-tag, .amend-ops')) chrome.remove();
  const rendered = [...clone.querySelectorAll('p')]
    .map((p) => p.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const source = text.replace(/\s+/g, ' ').trim();
  eq('rendered text preserves the source exactly', rendered.length, source.length);
  ok('  and character for character', rendered === source,
     rendered === source ? '' : firstDiff(rendered, source));

  // No citation may be rendered twice. A citation straddling a line break used
  // to be emitted once on each side of the paragraph split — two half-chips
  // ("paragraph " + " (1)") for one citation, both of them clickable.
  const cids = [...chips].map((c) => c.dataset.cid);
  eq('every citation renders exactly once', cids.length, new Set(cids).size);

  const badChips = [...chips].filter((c, i) =>
    c.textContent.replace(/\s+/g, ' ') !== cites[i].text.replace(/\s+/g, ' '));
  eq('chip text matches its citation', badChips.length, 0);

  // A line that opens a quotation is a block of statute the bill is inserting,
  // and it has to start its own paragraph rather than running on from the
  // instruction above it. Only the double-quote styles were listed as paragraph
  // openers, so in a govinfo plain-text bill — which quotes ``like this'' — none
  // of them did: 209 inserted blocks were glued to the preceding paragraph.
  // Asserted as an exact identity against the source rather than a floor.
  const quotedParas = [...el.querySelectorAll('p')]
    .filter((p) => /^\s*(?:``|‘‘|["“])/.test(p.textContent)).length;
  const quotedLines = text.split('\n').filter((l) => /^\s*(?:``|‘‘|["“])/.test(l)).length;
  ok('the sample really does contain quoted blocks', quotedLines > 100, `${quotedLines} lines`);
  eq('every quoted block starts its own paragraph', quotedParas, quotedLines);

  // Every paragraph publishes its span in the source. An internal
  // cross-reference resolves to an offset, not to an element, so this is the
  // only thing that lets a click on "subparagraph (C)" find the paragraph to
  // highlight. Ranges must tile the text in order and never overlap, or a
  // reference lands in the wrong paragraph or in none.
  const spans = [...el.querySelectorAll('p[data-start]')].map((p) => [+p.dataset.start, +p.dataset.end]);
  eq('every paragraph carries its source span', spans.length, el.querySelectorAll('p').length);
  ok('spans are well formed', spans.every(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s),
     JSON.stringify(spans.slice(0, 3)));
  ok('spans do not overlap and run in order',
     spans.every(([s], i) => i === 0 || s >= spans[i - 1][1] || s >= spans[i - 1][0]),
     'paragraph spans out of order');
  // The end-to-end property: every located internal reference must fall inside
  // exactly one rendered paragraph, which is what main.js relies on to scroll.
  const { locateInternal } = await imp('app/resolve/internal.js');
  const internals = cites.filter((c) => c.kind === 'internal');
  const targets = internals.map((c) => locateInternal(bill, c)).filter(Boolean);
  const homeless = targets.filter((t) => !spans.some(([s, e]) => t.start >= s && t.start < e));
  ok('the sample really exercises this', targets.length > 20, `${targets.length} located`);
  eq('every located reference lands in a rendered paragraph', homeless.length, 0);

  chips[0].dispatchEvent(new window.Event('click'));
  ok('clicking a chip fires the handler', clicked !== null);

  console.log(`  · ${chips.length} chips, ${el.querySelectorAll('.sec-head').length} headings, ` +
              `${el.querySelectorAll('.amend').length} amendment blocks`);
} else {
  console.log('  (samples/sample-bill.txt missing — skipped)');
}

// --- redline ---------------------------------------------------------------
// The diff belongs on the LAW, not on the bill. Marking the bill's own quoted
// operands said only "the bill quotes this phrase", which the quote marks
// already said, and it painted language being *removed from the statute book*
// in the colour of something being added to the page. These tests assert the
// diff is drawn into the provision in the right-hand pane, and that the bill
// pane no longer carries it.
section('redline on the current law');
{
  const { renderContext: rc } = await imp('app/ui/render-context.js');

  // Every quote convention, because the source decides which one appears and a
  // convention the operand matcher cannot see yields an empty redline — which
  // is exactly how the PDF path stayed broken while the text path looked fine.
  const styles = [
    ['GPO PDF (‘‘...’’)', '‘‘', '’’'],
    ["govinfo text (``...'')", '``', "''"],
    ['curly doubles (“...”)', '“', '”'],
    ['straight ("...")', '"', '"'],
  ];
  const LAW = 'The Secretary shall promote the use of diesel-equivalent fuel in aviation.';

  for (const [label, qo, qc] of styles) {
    const t =
      `Section 40007(a) of the Widget Act (49 U.S.C. 44504(a)) is amended by striking ` +
      `${qo}diesel-equivalent fuel${qc} and inserting ${qo}sustainable aviation fuel${qc}.\n`;
    const ams = extractAmendments(t, extractCitations(t));
    eq(`${label}: reads the instruction`, ams.length, 1);

    const res = {
      source: 'U.S. Code', citation: '49 U.S.C. 44504(a)', links: [],
      tree: [{ marker: '(a)', path: '(a)', heading: '', text: LAW, children: [] }],
      focusPath: '', effect: { ops: ams[0].ops, unmatched: false },
    };
    const el = rc(res, { onScope: () => {} });
    const del = [...el.querySelectorAll('.prov .del')];
    const ins = [...el.querySelectorAll('.prov .ins')];

    eq(`${label}: strikes the old words in the law`, del.map((n) => n.textContent).join('|'),
       'diesel-equivalent fuel');
    eq(`${label}: inserts the new words in their place`, ins.map((n) => n.textContent).join('|'),
       'sustainable aviation fuel');

    // Order is the point of a redline: the replacement reads where the struck
    // phrase stood, not appended somewhere after the sentence.
    const marked = el.querySelector('.prov').textContent;
    ok(`${label}: the new text sits where the old text was`,
       /use of diesel-equivalent fuelsustainable aviation fuel in aviation/.test(marked.replace(/\s+/g, ' ')),
       marked.replace(/\s+/g, ' '));

    // The law either side of the change must survive intact and unduplicated.
    const count = (h, n) => h.split(n).length - 1;
    eq(`${label}: the surrounding law is not duplicated`, count(marked, 'The Secretary shall promote'), 1);
    eq(`${label}: nor is the tail`, count(marked, 'in aviation.'), 1);
    ok(`${label}: no nested marks`, el.querySelectorAll('.ins .ins, .del .del, .ins .del, .del .ins').length === 0);
  }
}
{
  // The bill pane must carry no diff at all now.
  const t =
    'Section 40007(a) of the Widget Act (49 U.S.C. 44504(a)) is amended by striking ' +
    '``diesel-equivalent fuel\'\' and inserting ``sustainable aviation fuel\'\'.\n';
  const bill = parseBill(t);
  const raw = extractCitations(t);
  const ams = extractAmendments(t, raw);
  const { expandRelativeRefs } = await imp('app/parse/citations.js');
  const el = renderBill(bill, expandRelativeRefs(raw, ams), ams, () => {}, () => {});
  eq('the bill pane carries no diff marks', el.querySelectorAll('.ins, .del').length, 0);
  // …but the bill's own text is still all there, quotes and all.
  const rendered = el.textContent.replace(/\s+/g, ' ');
  const count = (h, n) => h.split(n).length - 1;
  for (const phrase of ['diesel-equivalent fuel', 'sustainable aviation fuel']) {
    eq(`"${phrase}" still renders exactly once in the bill`, count(rendered, phrase),
       count(t.replace(/\s+/g, ' '), phrase));
  }
  // The target citation appears twice on purpose — once in the bill's own text
  // and once in the block's "▸ amends …" tag, which is chrome, not duplication.
  eq('the amendment tag names the target', count(rendered, '49 U.S.C. 44504(a)'), 2);
  ok('and the amendment block is still drawn', el.querySelectorAll('.amend').length === 1,
     `${el.querySelectorAll('.amend').length} blocks`);
}
// A target the bill never wrote down must not read like one it did.
//
// `implied` has been set on every synthesised target since they were built —
// 1,239 of them across the corpus — and carried the reason with it, in prose
// meant for a reader. Nothing anywhere read the field, so the pane named a
// provision the instruction does not mention and gave no sign it had inferred
// anything. This is the tag where the reader meets that claim.
{
  const t =
    'DIVISION T--SECURE 2.0\n\nSEC. 1. AMENDMENT OF 1986 CODE.\n' +
    'Except as otherwise expressly provided, whenever in this division an amendment is expressed in terms of ' +
    'an amendment to a section, the reference shall be considered to be made to a section of the ' +
    'Internal Revenue Code of 1986.\n' +
    'SEC. 2. CREDIT.\nSection 45E(e) is amended by striking ``old\'\'.\n';
  const bill = parseBill(t);
  const cs = extractCitations(t);
  const ams = extractAmendments(t, cs, bill.divisions);
  const el = renderBill(bill, cs, ams, () => {}, () => {});
  const badge = el.querySelector('.amend-tag .amend-implied');
  ok('an inferred target is marked in the bill pane', !!badge,
     el.querySelector('.amend-tag') ? el.querySelector('.amend-tag').textContent : 'no tag');
  // Read through optional access: where the badge is missing the check above has
  // already failed, and throwing here would abort every check after it.
  eq('  reading as a qualifier, not part of the address', badge?.textContent, 'from context');
  ok('  and saying where the Act came from',
     /Internal Revenue Code of 1986/.test(badge?.title || ''), badge?.title);

  // The control that makes the assertion mean something: a target the bill DOES
  // write out carries no badge at all.
  const t2 = 'SEC. 2. X.\nSection 4 of the Widget Act (15 U.S.C. 2601) is amended by striking ``old\'\'.\n';
  const b2 = parseBill(t2);
  const c2 = extractCitations(t2);
  const e2 = renderBill(b2, c2, extractAmendments(t2, c2, b2.divisions), () => {}, () => {});
  eq('  and a target the bill states carries none', e2.querySelectorAll('.amend-implied').length, 0);
}
{
  // Placement rules, each of which changes where the mark lands.
  const { createRedline } = await imp('app/ui/redline.js');
  const seg = (ops, law) => createRedline(ops).apply(law);
  const show = (segs) => segs.map((s) => (s.type === 'keep' ? s.text : `[${s.type}:${s.text}]`)).join('');

  // Whole words only. "or" must not match inside "for" — bills strike one-word
  // operands constantly, and a substring match draws a line through the middle
  // of a word the amendment never mentions.
  eq('a short operand does not match inside a word',
     show(seg([{ type: 'strike', text: 'or', start: 1, end: 3 }], 'eligible for lottery or gambling')),
     'eligible for lottery [del:or] gambling');

  // "at the end" takes the last occurrence, not the first.
  eq('"at the end" strikes the last occurrence',
     show(seg([{ type: 'strike', text: 'and', start: 1, end: 4, atEnd: true }], 'apples and pears; and')),
     'apples and pears; [del:and]');
  eq('without it, the first',
     show(seg([{ type: 'strike', text: 'and', start: 1, end: 4 }], 'apples and pears; and')),
     'apples [del:and] pears; and');

  // "each place it appears" marks every one.
  eq('"each place it appears" strikes them all',
     show(seg([{ type: 'strike', text: 'fee', start: 1, end: 4, all: true }], 'the fee or the fee')),
     'the [del:fee] or the [del:fee]');

  // An anchored insertion goes beside the anchor, which is not struck.
  eq('an "after" anchor places the insertion',
     show(seg([{ type: 'insert', text: ' and jets', start: 1, end: 9, relation: 'after', anchor: 'planes' }],
              'for planes only')),
     'for planes[ins: and jets] only');
  eq('a "before" anchor places it ahead',
     show(seg([{ type: 'insert', text: 'small ', start: 1, end: 7, relation: 'before', anchor: 'planes' }],
              'for planes only')),
     'for [ins:small ]planes only');

  // Quote conventions and line wrapping differ between the bill and the Code.
  // A PDF operand carries the line break the Code text does not have.
  eq('an operand wrapped across a line still matches',
     show(seg([{ type: 'strike', text: 'diesel-equivalent\nfuel', start: 1, end: 22 }],
              'use of diesel-equivalent fuel here')),
     'use of [del:diesel-equivalent fuel] here');
  eq('and a differing quote convention folds together',
     show(seg([{ type: 'strike', text: "the ``fee''", start: 1, end: 12 }], 'pay the “fee” now')),
     'pay [del:the “fee”] now');

  // Nothing found: no marks, and the op is reported as unplaced rather than
  // being drawn somewhere plausible-looking.
  const r = createRedline([{ type: 'strike', text: 'absent phrase', start: 1, end: 14 }]);
  eq('an absent phrase leaves the law untouched', show(r.apply('unrelated text')), 'unrelated text');
  eq('  and is reported unplaced', r.unplaced().length, 1);

  // "at the end" is a claim about position, and it is checked. The Code we hold
  // is current, so an enacted bill's strike has usually already happened —
  // asked to strike "or" at the end of a list that no longer ends in "or",
  // taking the last match drew a line through "farmer [or] rancher" mid-sentence.
  eq('"at the end" declines a match that is not at the end',
     show(seg([{ type: 'strike', text: 'or', start: 1, end: 3, atEnd: true }],
              'a socially disadvantaged farmer or rancher (as defined in section 2003(e));')),
     'a socially disadvantaged farmer or rancher (as defined in section 2003(e));');
  eq('  but takes one that is',
     show(seg([{ type: 'strike', text: 'or', start: 1, end: 3, atEnd: true }], 'apples; or')),
     'apples; [del:or]');

  // The bill NAMES its operand instead of quoting it: "by striking the period at
  // the end and inserting ``; or''". The span in the bill is the PHRASE — that is
  // what the reader clicked and what `text` must slice back to, per the
  // badOpOffsets invariant — and the mark it names travels as `operand`. What has
  // to be found in the LAW is the mark.
  //
  // Every other case here passes the operand as `text`, so this path had no
  // coverage at all — and it drew nothing whatsoever. The operand substitution sat
  // in redline's `additions` chain, which a strike can never enter, so apply()
  // searched the law for the words "striking the period at the end". 446 strikes
  // and 343 paired inserts across the corpus, every count green, nothing drawn.
  const punctOps = [
    { type: 'strike', text: 'striking the period at the end', operand: '.', atEnd: true, start: 10, end: 40 },
    { type: 'insert', text: '; or', start: 50, end: 54, replaces: 10 },
  ];
  eq('a named punctuation operand is struck in the law',
     show(seg(punctOps, 'consult with the Administrator.')),
     'consult with the Administrator[del:.][ins:; or]');
  // The sharp half: before the fix this struck the phrase itself, because the
  // phrase is what apply() was searching for.
  eq('  and the phrase naming it is never searched for',
     show(seg([{ type: 'strike', text: 'striking the period at the end', operand: '.',
                atEnd: true, start: 10, end: 40 }],
              'a clause mentioning striking the period at the end')),
     'a clause mentioning striking the period at the end');

  // The mirror, and the half that did not exist: the bill names the mark it
  // INSERTS. Same split — `text` is the phrase, `operand` is the mark — so what
  // goes into the law is the mark, not the words "inserting a semicolon".
  eq('a named insert puts its mark into the law',
     show(seg([{ type: 'strike', text: 'striking the period at the end', operand: '.',
                atEnd: true, start: 10, end: 40 },
               { type: 'insert', text: 'inserting a semicolon', operand: ';',
                start: 45, end: 66, replaces: 10 }],
              'consult with the Administrator.')),
     'consult with the Administrator[del:.][ins:;]');

  // A named insert anchored to a quoted phrase: the phrase stays, the mark lands
  // beside it. Drawing the anchor as the insertion is the failure this replaces.
  eq('a named insert anchors without striking the anchor',
     show(seg([{ type: 'insert', text: 'inserting a comma', operand: ',',
                relation: 'after', anchor: 'State plan', start: 10, end: 27 }],
              'under the State plan and any waiver')),
     'under the State plan[ins:,] and any waiver');

  // An operation applies only in the provision the instruction navigated to.
  const scoped = [{ type: 'strike', text: 'or', start: 1, end: 3, atEnd: true, scope: '(d)(2)(A)' }];
  eq('a scoped op marks its own provision', show(createRedline(scoped).apply('apples; or', '(d)(2)(A)')),
     'apples; [del:or]');
  eq('  and a descendant of it', show(createRedline(scoped).apply('apples; or', '(d)(2)(A)(i)')),
     'apples; [del:or]');
  eq('  but not a sibling', show(createRedline(scoped).apply('apples; or', '(d)(2)(B)')), 'apples; or');
  eq('  nor the section lead', show(createRedline(scoped).apply('apples; or', '')), 'apples; or');

  // An amendment whose strikes all miss is an amendment that has already been
  // applied to the law we hold. Its insertions must not be drawn — anchored to
  // text that has moved on, they duplicated language already present:
  // "for the 2018 crop year, {+for the 2018 crop year,+} all of the producers".
  const staleOps = [
    { type: 'strike', text: 'language that is long gone', start: 1, end: 27 },
    { type: 'insert', text: 'brand new words', start: 30, end: 45, relation: 'after', anchor: 'the Secretary' },
  ];
  const law = 'the Secretary shall do the thing.';
  eq('a stale amendment draws nothing', show(createRedline(staleOps, law).apply(law)), law);
  ok('  and reports both operations unplaced', createRedline(staleOps, law).unplaced().length === 2);
  // Without the provision text there is nothing to judge staleness against, so
  // the insertion still places — the caller decides how much it knows.
  ok('  while an unjudged redline still places it',
     show(createRedline(staleOps).apply(law)).includes('[ins:brand new words]'));

  // Even with no strikes to test, an insertion whose words already sit at the
  // anchor has plainly been applied already — so they are marked as this bill's
  // work rather than drawn a second time. Three states, not two: `ins` is a
  // change the bill would make, `was` is one it already made, and drawing the
  // first here produced "for the 2018 crop year, {+for the 2018 crop year,+}".
  const enactedOps = [{ type: 'insert', text: 'for the 2018 crop year,', start: 1, end: 24,
                        relation: 'after', anchor: 'In the case of acres,' }];
  const enactedLaw = 'In the case of acres, for the 2018 crop year, all producers may elect.';
  eq('an insertion already present is marked, not drawn again',
     show(seg(enactedOps, enactedLaw)),
     'In the case of acres, [was:for the 2018 crop year,] all producers may elect.');
  // The words appear once. That was the whole point of the original guard and
  // it still holds — the mark is over the law's own text, not a copy of it.
  eq('  and the language still appears exactly once',
     enactedLaw.split('for the 2018 crop year,').length - 1, 1);
  {
    const r = createRedline(enactedOps, enactedLaw);
    r.apply(enactedLaw);
    eq('  reported as enacted rather than stranded', r.enactedInserts().length, 1);
    eq('  and not left unplaced', r.unplaced().length, 0);
  }

  // The unanchored half: where every strike is already gone AND the inserted
  // language is here, both halves of the amendment have happened. There is no
  // anchor doing positional work, so this one carries a length floor.
  const goneStrike = { type: 'strike', text: 'language that is long gone', start: 1, end: 27 };
  const longIns = { type: 'insert', text: 'a substantially longer replacement phrase', start: 30, end: 71,
                    replaces: 1 };
  const lawB = 'the Secretary shall apply a substantially longer replacement phrase here.';
  // Staleness is judged against the whole provision, so it has to be passed —
  // `seg()` deliberately builds a redline that knows no law at all.
  const judged = (ops, law) => show(createRedline(ops, law).apply(law));
  eq('a stale amendment marks language that is already in force',
     judged([goneStrike, longIns], lawB),
     'the Secretary shall apply [was:a substantially longer replacement phrase] here.');
  // Below the floor a match is a coincidence of common phrasing, not evidence.
  eq('  but a short operand is not evidence on its own',
     judged([goneStrike, { type: 'insert', text: '; or', start: 30, end: 34, replaces: 1 }],
            'apples; or pears'),
     'apples; or pears');

  // Staleness is judged only on strikes that could go MISSING. A bill strikes
  // ".", ";" and "or" constantly and those occur throughout every provision, so
  // finding one says nothing — yet any strike being found held the whole
  // amendment open. One period kept 157 amendments "pending" across the corpus.
  // 7 U.S.C. 2015(o)(6) is the shape of it: it reads the way the Fiscal
  // Responsibility Act wrote it, and every insertion was withheld because two of
  // seven strikes were punctuation that trivially matched.
  const punctStale = [
    goneStrike,                                                   // real, and gone
    { type: 'strike', text: '.', operand: '.', start: 60, end: 61 },   // always present
    longIns,
  ];
  // The period is still struck — it really is there, and striking it is a real
  // pending change. What it no longer does is vouch for the whole amendment.
  eq('a punctuation strike does not hold an amendment open',
     judged(punctStale, lawB),
     'the Secretary shall apply [was:a substantially longer replacement phrase] here[del:.]');
  // And where the ONLY strike is punctuation there is no evidence either way,
  // so the previous answer stands rather than being called stale on an empty set.
  eq('  and where every strike is punctuation, nothing is inferred',
     judged([{ type: 'strike', text: '.', operand: '.', start: 60, end: 61 },
             { type: 'insert', text: 'wholly new language here', start: 70, end: 94,
               relation: 'after', anchor: 'the Secretary' }],
            'the Secretary shall act.'),
     'the Secretary[ins:wholly new language here] shall act[del:.]');

  // ---- an address the provision does not have ----------------------------
  // `inScope` asks whether a node's path STARTS WITH the op's scope, so a scope
  // naming a level that does not exist matches nothing and every operation
  // under it silently vanishes. 1,285 across the corpus.
  const tree = new Set(['(a)', '(a)(1)', '(o)', '(o)(6)', '(o)(6)(E)']);
  const lawC = 'apples; or pears';
  const scopedRed = (ops) => createRedline(ops, lawC, tree);

  const tooDeep = scopedRed([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(a)(1)(Z)' }]);
  eq('an address one level too deep is widened', tooDeep.widenedScope().length, 1);
  eq('  to the deepest level the provision actually has', tooDeep.widenedScope()[0].scope, '(a)(1)');
  eq('  and it draws there', show(tooDeep.apply(lawC, '(a)(1)')), '[del:apples]; or pears');

  // The Fiscal Responsibility Act writes "7 U.S.C. 2015(6)(o)(3)" for
  // 2015(o)(3) -- the Act's own section number duplicated into the U.S.C.
  // parenthetical -- and cites the same provision correctly thirty lines later.
  // The transposition is visible and correcting it would still be a guess.
  const transposed = scopedRed([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(6)(o)(E)' }]);
  eq('a transposed address survives nowhere', transposed.lostScope().length, 1);
  eq('  keeping what the bill wrote, for the pane to report',
     transposed.lostScope()[0].scopeLost, '(6)(o)(E)');
  // THE guard: never shortened to nothing. Falling back to the whole provision
  // would let a one-word operand land in a sentence the bill never mentions,
  // which is the hazard `scope` exists to prevent.
  eq('  and is drawn nowhere, not across the whole provision',
     show(transposed.apply(lawC, '')), lawC);
  eq('  nor at any node of it', show(transposed.apply(lawC, '(o)(6)(E)')), lawC);

  // An address that IS in the provision is left exactly alone, and without a
  // tree to check against nothing is reconciled at all.
  const fine = scopedRed([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(o)(6)' }]);
  eq('a good address is untouched', fine.widenedScope().length + fine.lostScope().length, 0);
  eq('  and still draws', show(fine.apply(lawC, '(o)(6)')), '[del:apples]; or pears');
  const untold = createRedline([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(z)(9)' }], lawC);
  eq('with no tree given, no address is reconciled', untold.lostScope().length, 0);

  // A LEADING marker can be the spurious one, which is the shard bug seen from
  // the reading side: 42 U.S.C. 4332 ships with (A)–(L) at top level and NEPA's
  // own "(2) all agencies … shall—" flattened into the lead, so the correct
  // address (2)(A) matches nothing while (A) sits right there.
  const promoted = new Set(['(A)', '(B)', '(C)', '(C)(i)']);
  const headless = createRedline(
    [{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(2)(A)' }], lawC, promoted);
  eq('a spurious LEADING marker is dropped', headless.widenedScope().length, 1);
  eq('  leaving the address the provision actually has', headless.widenedScope()[0].scope, '(A)');
  eq('  and it draws there', show(headless.apply(lawC, '(A)')), '[del:apples]; or pears');
  // Still a test and never a guess: the remainder has to be a real path, so the
  // transposition above is not quietly relocated by this second pass either.
  eq('  while a transposition still survives nowhere',
     scopedRed([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(6)(o)(E)' }]).lostScope().length,
     1);

  // A scope taken from the instruction's own HEAD, naming nothing here.
  //
  // "Section 22(d) of the Federal Reserve Act (12 U.S.C. 375) is amended" — the
  // Act's subsection (d) IS the codified section, so 375 has no (d) and never
  // will. 41 of the 306 head addresses that resolve are this shape. This is the
  // one case where shortening to nothing is right, because the whole provision
  // is where the operation was applied before the head was read at all;
  // declaring it lost would withdraw a mark the reader can see today.
  const fromHead = createRedline(
    [{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(d)', scopeFromHead: true }],
    lawC, tree);
  eq('a head address the Code flattened away falls back to the whole provision',
     fromHead.lostScope().length, 0);
  eq('  and draws there', show(fromHead.apply(lawC, '')), '[del:apples]; or pears');
  // The exemption is for the head and nothing else: a navigation step naming a
  // level that does not exist is genuinely unaccounted for, and widening it to
  // the whole section is how a one-word operand lands in a sentence the
  // instruction never mentions.
  const fromNav = scopedRed([{ type: 'strike', text: 'apples', start: 1, end: 7, scope: '(d)' }]);
  eq('  while the same address from a navigation step stays lost',
     fromNav.lostScope().length, 1);
  eq('  and draws nowhere', show(fromNav.apply(lawC, '')), lawC);

  // ---- the same text, written two ways -----------------------------------
  // govinfo writes the em dash as two hyphens and the Code writes a real one, so
  // a block differing in one character out of eighty matched nothing. This is
  // the quote convention's exact twin and was missed for as long as it existed:
  // the Fiscal Responsibility Act's new spending caps are IN 2 U.S.C. 901(c),
  // and without this the pane draws them in the insertion colour beside the
  // identical paragraphs already there.
  //
  // Asserted through the reader-facing consequence — an addition the law already
  // contains is reported as in force and is NOT drawn — rather than through
  // fold() directly, because that is where the bug did its damage.
  const lawDash = '(9) for fiscal year 2024—\n(A) for the revised security category, $886,349,000,000 in new budget authority; and';
  const billBlock =
    '(9) for fiscal year 2024--\n            ``(A) for the revised security category, $886,349,000,000 \n        in new budget authority; and';
  const enactedAdd = createRedline(
    [{ type: 'insert', placement: 'after-unit', text: billBlock, start: 0, end: billBlock.length, scope: '(8)' }],
    lawDash, new Set(['(8)', '(9)']));
  eq('a block the law already holds is recognised across the dash conventions',
     enactedAdd.appliedAdditions().length, 1);
  eq('  and is not drawn again', enactedAdd.additionsAt('(8)').length, 0);
  // Both halves are load-bearing, and each fails alone. The dash is one; the
  // block's own paragraph openers are the other — GPO opens EVERY paragraph of a
  // multi-paragraph addition with a quote mark and the Code has none of them, so
  // `fold` turned each into a `"` the law could never match.
  const noOpeners = createRedline(
    [{ type: 'insert', placement: 'after-unit', text: billBlock.replace(/``/g, ''), start: 0, end: 10, scope: '(8)' }],
    lawDash, new Set(['(8)', '(9)']));
  eq('  openers or no openers, the same block is recognised',
     noOpeners.appliedAdditions().length, 1);
  // And the guard still declines where the law does NOT contain it: this is the
  // test that the two normalisations widened the match rather than blunting it.
  const notThere = createRedline(
    [{ type: 'insert', placement: 'after-unit', text: billBlock, start: 0, end: billBlock.length, scope: '(8)' }],
    '(9) for fiscal year 2031—\n(A) for the revised security category, $12 in new budget authority.',
    new Set(['(8)', '(9)']));
  eq('  a block the law does NOT hold is still drawn as new',
     notThere.appliedAdditions().length, 0);
  eq('    and is placed', notThere.additionsAt('(8)').length, 1);
}

// --- additions at the end --------------------------------------------------
// "by adding at the end the following" is the commonest way a bill creates new
// law, and for a long time it captured no text at all: the op recorded that an
// addition happened and nothing about what was added, so there was nothing to
// draw. These assert the language is read out of the bill AND lands beside the
// right siblings — the two halves are separately wrong in ways counts can't see.
// --- Act-relative derivation --------------------------------------------
// The pane is showing "42 U.S.C. 1395x" for a bill that said "section 1861 of
// the Social Security Act". That is the right answer and it looks like the wrong
// one, so the derivation has to be on screen — and it has to cite the source
// credit it came from, so a reader can check it against the section itself.
section('Act-relative derivation');
{
  const { renderContext: rc } = await imp('app/ui/render-context.js');
  const base = {
    source: 'U.S. Code', citation: '42 U.S.C. 1395x(s)(2)', links: [],
    tree: [{ marker: '(s)', path: '(s)', heading: '', text: 'The term “medical services” means—', children: [] }],
    focusPath: '',
  };
  const el = rc({
    ...base,
    viaActSection: {
      act: 'Social Security Act', actSection: '1861',
      enactedAs: 'Aug. 14, 1935, ch. 531', codified: '42 U.S.C. 1395x',
    },
  }, { onScope: () => {} });
  const txt = el.textContent.replace(/\s+/g, ' ');
  ok('names what the bill actually wrote', /section 1861 of the Social Security Act/.test(txt), txt.slice(0, 200));
  ok('  and where that is codified', /42 U\.S\.C\. 1395x/.test(txt), txt.slice(0, 200));
  ok('  and the credit it was taken from', /Aug\. 14, 1935, ch\. 531/.test(txt), txt.slice(0, 200));
  ok('  without a numbering caveat, the gap being closed',
     !/Numbering caveat/.test(txt), txt.slice(0, 200));

  // ---- a target supplied by context --------------------------------------
  // The pane's job here is to say the instruction named nothing, and where the
  // Act came from instead. Ahead of the provision, because a caveat read after
  // the text it qualifies has already failed.
  {
    const imp2 = rc({ ...base, implied: 'Internal Revenue Code of 1986' }, { onScope: () => {} });
    const itxt = imp2.textContent.replace(/\s+/g, ' ');
    ok('an inferred target is declared in the pane', /Supplied by context/.test(itxt), itxt.slice(0, 200));
    ok('  naming where it came from', /Internal Revenue Code of 1986/.test(itxt), itxt.slice(0, 200));
    ok('  and saying the sentence does not state it',
       /not\s+something this sentence states/.test(itxt), itxt.slice(0, 300));
    ok('  marked as a caution rather than a statement',
       !!imp2.querySelector('.card.warn'), imp2.innerHTML.slice(0, 200));
    // Before the provision, not after it.
    const cards = [...imp2.querySelectorAll('.card, .prov')];
    ok('  and drawn ahead of the provision itself',
       cards.findIndex((n) => /Supplied by context/.test(n.textContent)) <
         cards.findIndex((n) => n.classList.contains('prov')),
       cards.map((n) => n.className).join(' | '));

    const plain = rc({ ...base }, { onScope: () => {} });
    ok('  and a stated target says none of it',
       !/Supplied by context/.test(plain.textContent), plain.textContent.slice(0, 150));
  }

  // ---- a CFR part longer than the cap ------------------------------------
  // The cap exists because a part can run to hundreds of sections. It always
  // said it was truncating; it just gave the reader nowhere to go from there.
  {
    const many = Array.from({ length: 90 }, (_, i) => ({
      number: `60.${i + 1}`, heading: `Section ${i + 1}`, tree: [], paragraphs: [`Text of ${i + 1}.`],
    }));
    let asked = false;
    const capped = rc(
      { source: 'CFR', citation: '40 CFR part 60', links: [], sections: many },
      { onScope: () => {}, onShowAll: () => { asked = true; } }
    );
    eq('a long CFR part is capped', capped.querySelectorAll('.prov').length, 40);
    ok('  and says how much it is hiding', /Showing the first 40 of 90/.test(capped.textContent),
       capped.textContent.slice(0, 160));
    const more = [...capped.querySelectorAll('.crumb.clickable')].find((e) => /Show all 90/.test(e.textContent));
    ok('  with a way to see the rest', !!more, 'no show-all control');
    more.dispatchEvent(new window.Event('click'));
    ok('  which asks for it', asked);

    const full = rc(
      { source: 'CFR', citation: '40 CFR part 60', links: [], sections: many },
      { onScope: () => {}, showAllSections: true, onShowAll: () => {} }
    );
    ok('once shown, nothing is truncated', !/Showing the first/.test(full.textContent),
       full.textContent.slice(0, 120));
    // A part inside the cap must not offer a control that does nothing.
    const small = rc(
      { source: 'CFR', citation: '40 CFR part 60', links: [], sections: many.slice(0, 5) },
      { onScope: () => {}, onShowAll: () => {} }
    );
    ok('a short part says nothing about truncation', !/Showing the first/.test(small.textContent),
       small.textContent.slice(0, 120));
  }

  // ---- a citation into an enormous section --------------------------------
  // The pane opens the cited provision's PARENT, so it reads in context. For a
  // top-level subsection the parent is the whole section — and 42 U.S.C. 603 is
  // 58,000 characters across 323 nodes, so "section 403(c) of the Social
  // Security Act" opened all of it and left the reader to find (c).
  {
    const big = (n) => ({
      marker: `(${n})`, path: `(${n})`, heading: '', text: 'x'.repeat(9000), children: [],
    });
    const res = {
      source: 'U.S. Code', citation: '42 U.S.C. 603(c)', links: [], lead: '',
      tree: [big('a'), big('b'), { marker: '(c)', path: '(c)', heading: '', text: 'the cited text', children: [] }],
      focusPath: '(c)', citedPath: '(c)',
    };
    const el = rc(res, { onScope: () => {} });
    const prov = [...el.querySelectorAll('.prov')].reduce((n, p) => n + p.textContent.length, 0);
    ok('a citation into a huge section does not open all of it', prov < 4000, `${prov} characters`);
    ok('  but does show the provision cited', /the cited text/.test(el.textContent),
       el.textContent.slice(0, 120));
    ok('  with an anchor for the pane to scroll to', !!el.querySelector('#ctx-focus'));
    eq('  and exactly one of them', el.querySelectorAll('#ctx-focus').length, 1);

    // A section small enough to read whole is still shown whole — the point is
    // the budget, not a blanket rule.
    const small = {
      source: 'U.S. Code', citation: '42 U.S.C. 7401(a)', links: [], lead: '',
      tree: [
        { marker: '(a)', path: '(a)', heading: '', text: 'findings', children: [] },
        { marker: '(b)', path: '(b)', heading: '', text: 'purposes', children: [] },
      ],
      focusPath: '(a)', citedPath: '(a)',
    };
    ok('a small section is still shown whole', /purposes/.test(rc(small, { onScope: () => {} }).textContent));
  }

  // ---- the source credit --------------------------------------------------
  // 42 U.S.C. 603 carries 2,660 characters of provenance in 33 clauses. Printed
  // as one paragraph it is unreadable: scrolling into the middle of it shows
  // ")(A), (B), (2)(V), June 18, 2008, 122 Stat. 1664" and nothing about what
  // that is supposed to mean.
  {
    const credit =
      '(Aug. 14, 1935, ch. 531, title IV, § 403, as added Pub. L. 104–193, title I, ' +
      '§ 103(a)(1), Aug. 22, 1996, 110 Stat. 2115; amended Pub. L. 104–327, § 1(b), ' +
      'Oct. 19, 1996, 110 Stat. 4002; Pub. L. 110–275, title III, § 301(b), July 15, 2008, ' +
      '122 Stat. 2594; Pub. L. 117–2, title IX, § 9201, Mar. 11, 2021, 135 Stat. 124.)';
    const el = rc(
      { source: 'U.S. Code', citation: '42 U.S.C. 603', links: [], tree: [], sourceCredit: credit },
      { onScope: () => {} }
    );
    const cardEl = [...el.querySelectorAll('.card')].find((x) =>
      /comes from/.test(x.querySelector('h4')?.textContent || '')
    );
    ok('the credit is summarised, not dumped', !!cardEl, 'no credit card');
    const summary = cardEl.querySelector('p').textContent;
    ok('  naming what enacted it', /Aug\. 14, 1935, ch\. 531/.test(summary), summary);
    ok('  and the law that added this section', /added by Pub\. L\. 104–193/.test(summary), summary);
    ok('  and how often it has been amended', /amended 3 times/.test(summary), summary);
    ok('  and when it was last touched', /Pub\. L\. 117–2 \(Mar\. 11, 2021\)/.test(summary), summary);
    ok('  in one sentence, not 2,660 characters', summary.length < 200, `${summary.length} chars`);

    // The rest is kept, behind a count, for anyone tracing one amendment.
    const list = cardEl.querySelector('.credit-list');
    eq('every amending act is still there', list.children.length, 3);
    eq('  hidden until asked for', list.hidden, true);
    const btn = cardEl.querySelector('.crumb.clickable');
    eq('  behind a control that says how many', btn.textContent, 'All 3 amendments');
    btn.dispatchEvent(new window.Event('click'));
    eq('  which reveals them', list.hidden, false);
    ok('  and offers to hide them again', /Hide/.test(btn.textContent), btn.textContent);
    // Only the FIRST clause is the enacting one; the rest are amendments.
    ok('the enacting clause is not listed as an amendment',
       !list.textContent.includes('as added'), list.textContent.slice(0, 90));
  }

  // ---- "et seq." names a range, and the pane has to say so ---------------
  // "15 U.S.C. 2601 et seq." is the Toxic Substances Control Act, not § 2601.
  // The pane answered with one section under a heading naming it alone — 2,620
  // citations across 28 corpus bills, every one a confident answer to a question
  // the citation did not ask.
  {
    const crumbs = [
      { type: 'title', label: 'Title 15— COMMERCE', short: 'Title 15—', href: 'https://www.law.cornell.edu/uscode/text/15' },
      { type: 'chapter', label: 'CHAPTER 53— TOXIC SUBSTANCES', short: 'CHAPTER 53—', href: 'https://www.law.cornell.edu/uscode/text/15/chapter-53' },
      { type: 'subchapter', label: 'SUBCHAPTER I', short: 'SUBCHAPTER I—', href: 'https://www.law.cornell.edu/uscode/text/15/chapter-53/subchapter-I' },
    ];
    const rangeRes = {
      source: 'U.S. Code', citation: '15 U.S.C. 2601 et seq.', isRangeStart: true, links: [],
      heading: 'Findings, policy, and intent', lead: 'The Congress finds…', tree: [], notes: [],
      sourceCredit: '', crumbs,
    };
    const el = rc(rangeRes, { onScope: () => {} });
    const cardEl = [...el.querySelectorAll('.card')].find((x) => /A range, not one section/i.test(x.textContent));
    ok('a range citation says it is a range', Boolean(cardEl), el.textContent.slice(0, 160));
    const txt = cardEl.textContent.replace(/\s+/g, ' ');
    ok('  quoting what the bill actually wrote', /15 U\.S\.C\. 2601 et seq\./.test(txt), txt);
    ok('  and saying this is where it starts', /section the range starts at/.test(txt), txt);
    // The limit, stated rather than papered over: nothing knows where a range
    // ends, which is the same refusal markRangeAdditions() makes.
    ok('  and admitting it does not know where it ends',
       /nothing in the citation says where it ends/i.test(txt), txt);
    // The level ladder took the LAST WORD of the display citation as the section
    // number, so the moment "et seq." reached the heading every rung read
    // "§ seq.". Caught by looking at the screen, not by any assertion.
    const rungs = [...rc({ ...rangeRes, section: '2601', focusPath: '' }, { onScope: () => {} })
      .querySelectorAll('.ladder button')].map((b) => b.textContent);
    ok('the level ladder shows the section number, not the last word of the citation',
       rungs.includes('§ 2601'), JSON.stringify(rungs));
    // The CHAPTER, not the deepest crumb: an Act codified as a block is normally
    // one chapter, where the subchapter is a slice of the range.
    const a = cardEl.querySelector('a');
    eq('  offering the chapter as the way out',
       a && a.getAttribute('href'), 'https://www.law.cornell.edu/uscode/text/15/chapter-53');
    // The shard's `num` ends in the separator that introduces the heading, so a
    // label taken raw trails off mid-dash: "Read CHAPTER 53—".
    eq('    labelled without the crumb\'s trailing separator', a && a.textContent, 'Read CHAPTER 53');

    // A plain section must gain none of this.
    const plainEl = rc({ ...rangeRes, citation: '15 U.S.C. 2601', isRangeStart: false }, { onScope: () => {} });
    eq('an ordinary section says nothing about ranges',
       [...plainEl.querySelectorAll('.card')].filter((x) => /A range, not one section/i.test(x.textContent)).length, 0);
  }
  {
    // THE cache hazard, which this codebase has paid for four times before.
    // "15 U.S.C. 2601" and "15 U.S.C. 2601 et seq." agree on kind, title,
    // section and subsection and differ only in `etSeq` — so without it in the
    // key the first of the two clicked answers for BOTH, silently, in whichever
    // direction the reader happened to click first.
    const { resolve } = await imp('app/resolve/index.js');
    const bare = { id: 'c1', kind: 'usc', title: '15', section: '2601', subsection: '' };
    const range = { id: 'c2', kind: 'usc', title: '15', section: '2601', subsection: '', etSeq: true };
    const first = await resolve(bare);
    const second = await resolve(range);
    eq('a bare section resolves as itself', first.citation, '15 U.S.C. 2601');
    eq('  and the et seq. cite is not served its cached answer',
       second.citation, '15 U.S.C. 2601 et seq.');
    ok('  nor its range flag', second.isRangeStart === true && !first.isRangeStart,
       `${first.isRangeStart} / ${second.isRangeStart}`);
    // And the other way round, since a memo is order-dependent by nature.
    const rangeFirst = await resolve({ ...range, id: 'c3', section: '2602' });
    const bareAfter = await resolve({ ...bare, id: 'c4', section: '2602' });
    eq('the same holds when the range is clicked first',
       `${rangeFirst.citation} | ${bareAfter.citation}`, '15 U.S.C. 2602 et seq. | 15 U.S.C. 2602');
  }

  // ---- the crumbs are a way out, not a caption ---------------------------
  // They have always carried the USLM identifier and rendered as inert grey
  // text: the reader could SEE that 7 U.S.C. 2011 sits in chapter 51 of title 7
  // and could do nothing with it. This app has no whole-chapter view, so the
  // honest "expand out" is out to the Code.
  {
    const { crumbHref } = await imp('app/resolve/usc.js');
    // Every level checked live against law.cornell.edu; the transform is
    // mechanical because Cornell mirrors the USLM hierarchy exactly.
    eq('a title crumb links to the title',
       crumbHref('/us/usc/t7'), 'https://www.law.cornell.edu/uscode/text/7');
    eq('a chapter crumb links to the chapter',
       crumbHref('/us/usc/t7/ch51'), 'https://www.law.cornell.edu/uscode/text/7/chapter-51');
    eq('  nested through subchapter and part',
       crumbHref('/us/usc/t42/ch7/schIV/ptA'),
       'https://www.law.cornell.edu/uscode/text/42/chapter-7/subchapter-IV/part-A');
    eq('  and subtitle, division, subdivision',
       crumbHref('/us/usc/t54/stIII/dA/sd2'),
       'https://www.law.cornell.edu/uscode/text/54/subtitle-III/division-A/subdivision-2');
    // THE parsing trap. `spt` takes a LOWERCASE roman number with no separator,
    // so a pattern anchored on [A-Z0-9] drops every one — and `spt` must be
    // tried before `st`, or "sptiii" reads as a subtitle.
    eq('  a lowercase-roman subpart is not mistaken for a subtitle',
       crumbHref('/us/usc/t42/ch6A/schII/ptD/sptiii'),
       'https://www.law.cornell.edu/uscode/text/42/chapter-6A/subchapter-II/part-D/subpart-iii');
    // The EN DASH, in the same role it plays for slug(): USLM writes
    // "subchapter III–A" with one and the URL wants an ASCII hyphen. Left out,
    // this declined 1,583 of the Code's 200,675 crumbs — silently, which is what
    // makes a safe default expensive rather than free.
    eq('an en-dashed subchapter is normalised, not declined',
       crumbHref('/us/usc/t42/ch6A/schIII–A'),
       'https://www.law.cornell.edu/uscode/text/42/chapter-6A/subchapter-III-A');
    // Safety: an unknown level is declined outright rather than guessed into a
    // path, because a 404 wearing this app's confidence is worse than grey text.
    eq('an unrecognised level declines', crumbHref('/us/usc/t7/zz9'), null);
    eq('  as does a non-USC identifier', crumbHref('/us/cfr/t40/s60.13'), null);
    eq('  and a missing one', crumbHref(null), null);

    const linked = rc({
      source: 'U.S. Code', citation: '7 U.S.C. 2011', links: [], heading: 'Congressional declaration',
      lead: 'It is declared…', tree: [], notes: [], sourceCredit: '',
      crumbs: [
        { type: 'title', label: 'Title 7— AGRICULTURE', short: 'Title 7—', href: crumbHref('/us/usc/t7') },
        { type: 'chapter', label: 'CHAPTER 51— SNAP', short: 'CHAPTER 51—', href: crumbHref('/us/usc/t7/ch51') },
      ],
    }, { onScope: () => {} });
    const anchors = [...linked.querySelectorAll('.crumbs a.crumb')];
    eq('both crumbs render as links', anchors.length, 2);
    eq('  the chapter one to the chapter',
       anchors[1].getAttribute('href'), 'https://www.law.cornell.edu/uscode/text/7/chapter-51');
    eq('  opening away from the reading, opener severed',
       anchors[1].getAttribute('rel'), 'noopener noreferrer');
    ok('  and carrying the affordance class the stylesheet hangs hover off',
       anchors[1].classList.contains('clickable'), anchors[1].className);
    // A crumb with no link must stay a span, or an <a href=""> reloads the app
    // and throws the reader's reading away.
    const inert = rc({
      source: 'U.S. Code', citation: '7 U.S.C. 2011', links: [], heading: 'x',
      lead: '', tree: [], notes: [], sourceCredit: '',
      crumbs: [{ type: 'title', label: 'Title 7', short: 'Title 7', href: null }],
    }, { onScope: () => {} });
    eq('an unlinkable crumb stays plain text', inert.querySelectorAll('.crumbs a').length, 0);
    eq('  and is still shown', inert.querySelectorAll('.crumbs .crumb').length, 1);
  }

  // ---- two sections, one number ------------------------------------------
  // The pane has to say so, and has to let the reader read the other one.
  // Named by heading and credit, because a bare "alternative 2" tells nobody
  // which of two provisions sharing a number they are about to open.
  {
    let swapped = null;
    const dupRes = {
      source: 'U.S. Code', citation: '5 U.S.C. 5757', links: [],
      heading: 'Payment of expenses to obtain professional credentials',
      lead: 'An agency may use appropriated funds…', tree: [], notes: [],
      sourceCredit: '(Added Pub. L. 107-107, div. A, title XI, § 1112(a).)',
      also: [{
        heading: 'Extended assignment incentive',
        lead: 'The head of an Executive agency may pay…', tree: [], notes: [],
        sourceCredit: '(Added Pub. L. 107-273, div. A, title II, § 207(a)(1).)',
        crumbs: [],
      }],
    };
    const dupEl = rc(dupRes, { onScope: () => {}, onAlternate: (i) => { swapped = i; } });
    const dtxt = dupEl.textContent.replace(/\s+/g, ' ');
    ok('a shared section number is announced', /used more than once/.test(dtxt), dtxt.slice(0, 140));
    ok('  saying how many there are', /2 sections numbered 5757/.test(dtxt), dtxt.slice(0, 200));
    const alt = [...dupEl.querySelectorAll('.card.warn .crumb.clickable')];
    eq('  with the other one offered', alt.length, 1);
    eq('  named by its heading', alt[0].textContent, 'Extended assignment incentive');
    ok('  and its credit on hover', /107-273/.test(alt[0].getAttribute('title') || ''),
       alt[0].getAttribute('title'));
    alt[0].dispatchEvent(new window.Event('click'));
    eq('  clicking it asks to swap', swapped, 0);

    // A section with one meaning must not grow a card.
    const plain = rc({ ...dupRes, also: [] }, { onScope: () => {} });
    ok('an ordinary section says nothing about alternatives',
       !/used more than once/.test(plain.textContent), plain.textContent.slice(0, 120));
  }

  // The unresolved case must still warn, and must not claim a derivation.
  const un = rc({
    ...base, citation: 'Social Security Act', isActStart: true,
    offsetNote: 'SSA section numbers do NOT match their 42 U.S.C. numbers.',
  }, { onScope: () => {} });
  const utxt = un.textContent.replace(/\s+/g, ' ');
  ok('an unresolved Act cite still carries the caveat', /Numbering caveat/.test(utxt), utxt.slice(0, 160));
  ok('  and claims no derivation', !/taken from the source credit/.test(utxt), utxt.slice(0, 160));

  // ---- the "Whole Act" card says where the Act sits ----------------------
  // `range` is overloaded across 182 entries and used to be printed raw after
  // "the Act runs to", which said something different for each shape and
  // something untrue for two of them. resolve() shapes it into a sentence now,
  // so these assert the sentence rather than the field.
  // The card itself, not the whole pane — the provision renders after it, so
  // matching the pane's tail would assert about the statute rather than the copy.
  const wholeAct = (range) => {
    const root = rc({ ...base, citation: 'Widget Act', isActStart: true, range }, { onScope: () => {} });
    const el = [...root.querySelectorAll('.card')].find((x) => /Whole Act/i.test(x.textContent));
    if (!el) return { text: '(no Whole Act card)', href: null, rel: null };
    const a = el.querySelector('a');
    return {
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      href: a ? a.getAttribute('href') : null,
      rel: a ? a.getAttribute('rel') : null,
    };
  };

  const seq = wholeAct({
    text: 'The Act is codified throughout 42 U.S.C. 7401 et seq.',
    link: { label: 'Open 42 U.S.C. 7401', href: 'https://www.law.cornell.edu/uscode/text/42/7401' },
  });
  ok('the Whole Act card names the title, not a bare section number',
     /throughout 42 U\.S\.C\. 7401 et seq\./.test(seq.text), seq.text.slice(0, 200));
  ok('  and says plainly that this is the entire law',
     /entire law, not a single provision/.test(seq.text), seq.text.slice(0, 200));
  ok('  with no doubled full stop after "et seq."', !/et seq\.\./.test(seq.text), seq.text.slice(0, 200));
  eq('  and the link opens the section the range starts at',
     seq.href, 'https://www.law.cornell.edu/uscode/text/42/7401');

  // THE one that was misread. "title 26 generally" means the Internal Revenue
  // Code is classified TO title 26 — not that it HAS 26 titles. "throughout" is
  // the word that carries it: a destination the Act reaches reads as a count,
  // a body of law it pervades does not.
  const irc = wholeAct({
    text: 'The Act is codified throughout title 26.',
    link: { label: 'Browse title 26', href: 'https://www.law.cornell.edu/uscode/text/26' },
  });
  ok('an Act codified as a whole title says "throughout"',
     /codified throughout title 26\./.test(irc.text), irc.text.slice(0, 200));
  ok('  and never claims the Act HAS that many titles',
     !/\b26 titles\b/.test(irc.text), irc.text.slice(0, 200));
  eq('  and the link browses the title itself',
     irc.href, 'https://www.law.cornell.edu/uscode/text/26');
  // A link out of this pane opens away from the reading, and must not hand the
  // opener a live reference back to it.
  eq('    opening in a new tab, with the opener severed', irc.rel, 'noopener noreferrer');

  // A shape with nothing useful to say says nothing, rather than trailing an
  // orphan phrase or an empty link off the end of the sentence.
  const bare = wholeAct(null);
  ok('an Act with no usable range adds no dangling phrase',
     /first section\.$/.test(bare.text), JSON.stringify(bare.text.slice(-90)));
  eq('  and no dangling link', bare.href, null);
}

section('additions at the end');
{
  const { renderContext: rc } = await imp('app/ui/render-context.js');

  // The shape from the CLARITY Act, which is where this was found. The bill's
  // own "(C)" is a list marker for the third sub-instruction, not a step into
  // subparagraph (C) — the new subparagraph (D) is (C)'s sibling.
  const t =
    'Section 4c(a) of the Widget Act (7 U.S.C. 6c(a)) is amended—\n' +
    '    (1) in paragraph (3)—\n' +
    "        (A) in subparagraph (B), by striking ``or'' at the end;\n" +
    "        (B) in subparagraph (C), by striking the period and inserting ``; or''; and\n" +
    '        (C) by adding at the end the following:\n' +
    "``(D) a contract of sale of a digital commodity.'';\n";
  const ams = extractAmendments(t, extractCitations(t));
  eq('reads the instruction', ams.length, 1);
  const adds = ams[0].ops.filter((o) => o.type === 'add-at-end');
  eq('  one addition', adds.length, 1);
  eq('  carrying the added language', adds[0].text, 'a contract of sale of a digital commodity.'
     .replace(/^/, '(D) '));
  eq('  scoped to the paragraph, not the subparagraph walked to', adds[0].scope, '(a)(3)');

  const law = () => [{
    marker: '(a)', path: '(a)', heading: '', text: 'It shall be unlawful—',
    children: [{
      marker: '(3)', path: '(a)(3)', heading: '', text: 'to conduct—',
      children: [
        { marker: '(A)', path: '(a)(3)(A)', heading: '', text: 'a transaction;', children: [] },
        { marker: '(B)', path: '(a)(3)(B)', heading: '', text: 'an option; or', children: [] },
        { marker: '(C)', path: '(a)(3)(C)', heading: '', text: 'a swap.', children: [] },
      ],
    }],
  }];

  const res = {
    source: 'U.S. Code', citation: '7 U.S.C. 6c(a)', links: [],
    tree: law(), focusPath: '', effect: { ops: ams[0].ops, unmatched: false },
  };
  const el = rc(res, { onScope: () => {} });

  const added = [...el.querySelectorAll('.node.added')];
  eq('the addition is drawn into the law', added.length, 1);
  eq('  as new language, in the insertion colour', added[0].querySelectorAll('.ins').length, 1);
  eq('  reading as the bill wrote it, without the quote mark',
     added[0].textContent.trim(), '(D) a contract of sale of a digital commodity.');

  // THE guard. The addition's parent must be paragraph (3) — the level whose
  // children (A), (B) and (C) the new (D) joins. Scoped to the last step the
  // instruction wrote, it was drawn inside subparagraph (C) instead, one level
  // too deep, with every count still green.
  const ownMarker = (node) => {
    const m = node.querySelector(':scope > .body > .marker');
    return m ? m.textContent : '';
  };
  eq('  under paragraph (3), whose siblings it joins', ownMarker(added[0].parentElement), '(3)');

  // The SAME instruction re-punctuates (C) so that (D) can follow it: "in
  // subparagraph (C), by striking the period and inserting ``; or''". The
  // position is not stated in words, and until that idiom was read this drew
  // nothing — "a swap." stood unchanged while the bill plainly changed it, and
  // the addition below arrived after a sentence still ending in a full stop.
  const subC = [...el.querySelectorAll('.node')].find(
    (n) => (n.querySelector(':scope > .body > .marker') || {}).textContent === '(C)'
  );
  eq('the period at the end of (C) is struck', subC.querySelectorAll('.del').length, 1);
  eq('  and the replacement drawn beside it', subC.querySelector('.ins').textContent, '; or');

  // Order, independently of structure: it follows the last existing sibling
  // rather than the parent's own lead-in sentence.
  const flat = el.querySelector('.prov').textContent.replace(/\s+/g, ' ');
  ok('  after the last existing subparagraph',
     /a swap\.; or\s*\(D\) a contract of sale/.test(flat), flat);
  ok('  and not before them', !/to conduct—\s*\(D\)/.test(flat), flat);

  // ---- an addition at the end of a RANGE ---------------------------------
  // The bill cites the Act ("42 U.S.C. 4321 et seq.") and adds a new SECTION at
  // the end of it. The resolver answers with the section the range begins at,
  // the addition has nothing to scope it, and it was drawn at that section's
  // root — a whole new section of NEPA rendered inside NEPA's first section, in
  // the insertion colour. The refusal is the fix; the panel says where it goes.
  {
    const rangeRes = {
      source: 'U.S. Code', citation: '42 U.S.C. 4321', links: [],
      tree: [{ marker: '', path: '', heading: '', text: 'The purposes of this chapter are:', children: [] }],
      focusPath: '',
      effect: {
        ops: [{
          type: 'add-at-end', rangeEnd: true, scope: '',
          text: 'SEC. 106. PROCEDURE FOR DETERMINATION OF LEVEL OF REVIEW.',
          start: 500, end: 556,
        }],
        unmatched: false,
      },
    };
    const rel = rc(rangeRes, { onScope: () => {} });
    eq('a range addition is not drawn into the first section',
       rel.querySelectorAll('.node.added').length, 0);
    const rtxt = rel.textContent.replace(/\s+/g, ' ');
    ok('  and the panel says where it actually goes',
       /at the end of the Act, not of this section/.test(rtxt), rtxt.slice(0, 300));
    ok('  while still naming the language being added',
       /SEC\. 106\./.test(rtxt), rtxt.slice(0, 300));

    // The control: without the flag the same op is drawn, so the assertion above
    // is about the refusal and not about some unrelated failure to render.
    const drawn = rc(
      { ...rangeRes, effect: { ops: [{ ...rangeRes.effect.ops[0], rangeEnd: false }], unmatched: false } },
      { onScope: () => {} }
    );
    eq('  and without the flag it is drawn as before',
       drawn.querySelectorAll('.node.added').length, 1);
  }

  // ---- "by inserting after subparagraph (B) the following" ---------------
  // Same structural job as add-at-end, written with a different verb, and it
  // was drawing NOTHING. apply() only places an insert that either replaces a
  // strike or anchors to a quoted phrase; this has neither, so it fell through
  // both branches and vanished. 312 ops across the corpus.
  {
    const ti =
      'Section 4c(a) of the Widget Act (7 U.S.C. 6c(a)) is amended—\n' +
      '    (1) in paragraph (3)—\n' +
      "        (A) in subparagraph (C), by striking ``or'' at the end; and\n" +
      '        (B) by inserting after subparagraph (A) the following new subparagraph:\n' +
      "``(B) an option;'';\n";
    const ai = extractAmendments(ti, extractCitations(ti));
    const ins = ai[0].ops.filter((o) => o.placement === 'after-unit');
    eq('an insert anchored to a unit is recognised', ins.length, 1);
    // Scoped to the ANCHOR, not to the level the walk stopped at and not to the
    // anchor's parent: the renderer draws additions after each node's children,
    // so scoping to (a)(3)(A) is what puts the new (B) after (A) rather than
    // after the last subparagraph or inside (A).
    eq('  scoped to the provision it follows', ins[0].scope, '(a)(3)(A)');

    const lawI = () => [{
      marker: '(a)', path: '(a)', heading: '', text: 'It shall be unlawful—',
      children: [{
        marker: '(3)', path: '(a)(3)', heading: '', text: 'to conduct—',
        children: [
          { marker: '(A)', path: '(a)(3)(A)', heading: '', text: 'a transaction; or', children: [] },
          { marker: '(C)', path: '(a)(3)(C)', heading: '', text: 'a swap.', children: [] },
        ],
      }],
    }];
    const eli = rc(
      { source: 'U.S. Code', citation: '7 U.S.C. 6c(a)', links: [], tree: lawI(), focusPath: '',
        effect: { ops: ai[0].ops, unmatched: false } },
      { onScope: () => {} }
    );
    const addedI = [...eli.querySelectorAll('.node.added')];
    eq('the new subparagraph is drawn', addedI.length, 1);
    eq('  reading as the bill wrote it', addedI[0].textContent.trim(), '(B) an option;');
    // Between (A) and (C), which is the whole point of anchoring to a unit.
    const flatI = eli.querySelector('.prov').textContent.replace(/\s+/g, ' ');
    ok('  after the provision it names', /a transaction; or\s*\(B\) an option;/.test(flatI), flatI);
    ok('  and before the next one', /\(B\) an option;\s*\(C\)\s*a swap\./.test(flatI), flatI);
    // It must not ALSO be woven in by apply(), which would draw it twice.
    eq('  and drawn exactly once',
       (flatI.match(/\(B\) an option;/g) || []).length, 1);
  }

  // ---- "in the matter preceding subparagraph (A)" ------------------------
  // The phrase names the parent's own lead-in text and excludes the children by
  // name. Scoping to the parent is only half of it: apply() tests
  // `path.startsWith(op.scope)`, so without the exact flag the strike also
  // reaches inside (A) — the one place the instruction says not to touch.
  {
    const tm =
      'Section 1905 of title 18, United States Code, is amended--\n' +
      '    (1) in subsection (d)(2), in the matter preceding subparagraph (A), ' +
      "by striking ``covered'' and inserting ``eligible''.\n";
    const am = extractAmendments(tm, extractCitations(tm));
    const strike = am[0].ops.find((o) => o.type === 'strike');
    eq('the strike is scoped to the parent', strike.scope, '(d)(2)');
    eq('  and marked exact', strike.exact, true);

    // The word appears in BOTH the parent's lead and inside (A). Only the lead
    // may be marked.
    const lawM = [{
      marker: '(d)', path: '(d)', heading: '', text: 'Exceptions.',
      children: [{
        marker: '(2)', path: '(d)(2)', heading: '',
        text: 'A covered disclosure is one that—',
        children: [
          { marker: '(A)', path: '(d)(2)(A)', heading: '', text: 'is made to a covered person; and', children: [] },
          { marker: '(B)', path: '(d)(2)(B)', heading: '', text: 'is in writing.', children: [] },
        ],
      }],
    }];
    const elM = rc(
      { source: 'U.S. Code', citation: '18 U.S.C. 1905', links: [], tree: lawM, focusPath: '',
        effect: { ops: am[0].ops, unmatched: false } },
      { onScope: () => {} }
    );
    const dels = [...elM.querySelectorAll('.del')];
    eq('the strike is drawn exactly once', dels.length, 1);
    // Which node it landed in is the assertion that matters — and it has to be
    // asked of each node's OWN body. Nodes nest, so the parent's textContent
    // includes every subparagraph beneath it and "did a node containing this
    // text get a mark?" answers yes for the parent no matter where the mark is.
    const ownBody = (n) => n.querySelector(':scope > .body');
    const marked = [...elM.querySelectorAll('.node')].filter((n) => ownBody(n)?.querySelector('.del'));
    eq('exactly one node carries the strike', marked.length, 1);
    ok('  and it is the parent, in its own lead-in text',
       /disclosure is one that/.test(ownBody(marked[0]).textContent),
       ownBody(marked[0]).textContent);
    ok('  not the subparagraph the phrase excludes by name',
       !/is made to a covered person/.test(ownBody(marked[0]).textContent),
       ownBody(marked[0]).textContent);
  }

  // ---- an addition the law already contains ------------------------------
  // The whole point of this pane is inline visibility, and an enacted bill was
  // getting none: its additions are already in the Code, so nothing is drawn —
  // correctly, since drawing them would show the provision twice — and the
  // panel then reported "⚠ position not stated" and "not drawn into the text"
  // about language sitting on screen. Two bugs behind one symptom: the op lived
  // in both `work` and `additions` as separate objects, so unplaced() counted
  // the copy nobody handled; and the panel had no branch for a structurally
  // placed insert, so it fell through to the "no position" message.
  {
    const te =
      'Section 251(b)(2)(B)(i) of the Balanced Budget and Emergency Deficit Control Act of 1985 is amended--\n' +
      "    (A) in subclause (IX), by striking ``and'' at the end;\n" +
      '    (B) by inserting after subclause (X) the following:\n' +
      "``(XI) for fiscal year 2024, $1,578,000,000 in additional new budget authority.'';\n";
    const ae = extractAmendments(te, extractCitations(te));
    // The law as it stands already contains it — this bill is enacted.
    const lawE = [{
      marker: '(b)', path: '(b)', heading: '', text: 'Adjustments.',
      children: [{
        marker: '(2)', path: '(b)(2)', heading: '', text: '',
        children: [{
          marker: '(B)', path: '(b)(2)(B)', heading: '', text: '',
          children: [{
            marker: '(i)', path: '(b)(2)(B)(i)', heading: '', text: 'the amounts are—',
            children: [
              { marker: '(IX)', path: '(b)(2)(B)(i)(IX)', heading: '', text: 'for fiscal year 2020, $1,309,000,000 in additional new budget authority;', children: [] },
              { marker: '(X)', path: '(b)(2)(B)(i)(X)', heading: '', text: 'for fiscal year 2021, $1,302,000,000 in additional new budget authority;', children: [] },
              { marker: '(XI)', path: '(b)(2)(B)(i)(XI)', heading: '', text: 'for fiscal year 2024, $1,578,000,000 in additional new budget authority.', children: [] },
            ],
          }],
        }],
      }],
    }];
    const elE = rc(
      { source: 'U.S. Code', citation: '2 U.S.C. 901(b)(2)(B)(i)', links: [], tree: lawE,
        focusPath: '(b)(2)(B)(i)', effect: { ops: ae[0].ops, unmatched: false } },
      { onScope: () => {} }
    );
    const txtE = elE.textContent.replace(/\s+/g, ' ');

    // Nothing drawn: the provision would otherwise appear twice.
    eq('an already-enacted addition is not drawn again', elE.querySelectorAll('.node.added').length, 0);
    // But the provision it created is marked, which is the thing that was
    // missing — an enacted bill looked like it had done nothing at all.
    const wasAdded = [...elE.querySelectorAll('.node.was-added')];
    eq('  the provision it created is marked in the law', wasAdded.length, 1);
    ok('  and it is the right one',
       /for fiscal year 2024/.test(wasAdded[0].textContent), wasAdded[0].textContent.slice(0, 60));
    ok('  labelled as this bill\'s work', /already in force/i.test(wasAdded[0].getAttribute('title') || ''),
       wasAdded[0].getAttribute('title'));

    // And the panel says so, positively, in both rows.
    ok('the panel reports the addition as done', /already in the law as it stands/.test(txtE), txtE.slice(-260));
    ok('  and the strike as done, not as a failure',
       /already struck from the law/.test(txtE) && !/not found verbatim/.test(txtE), txtE.slice(-260));
    ok('  with no "position not stated"', !/position not stated/.test(txtE), txtE.slice(-260));
    ok('  and no claim that something was left undrawn',
       !/not drawn into the text/.test(txtE), txtE.slice(-260));
  }

  // ---- an addition whose provision is off screen -------------------------
  // Scoped to (a)(3) while the pane shows (b), the addition draws nothing. The
  // panel said so, honestly, and then left the reader with nowhere to go.
  {
    const wideLaw = () => [
      {
        marker: '(a)', path: '(a)', heading: '', text: 'It shall be unlawful—',
        children: [{
          marker: '(3)', path: '(a)(3)', heading: '', text: 'to conduct—',
          children: [{ marker: '(A)', path: '(a)(3)(A)', heading: '', text: 'a transaction;', children: [] }],
        }],
      },
      { marker: '(b)', path: '(b)', heading: '', text: 'Nothing here.', children: [] },
    ];
    const tw =
      'Section 4c(a) of the Widget Act (7 U.S.C. 6c(a)) is amended—\n' +
      '    (1) in paragraph (3), by adding at the end the following:\n' +
      "``(B) an option.'';\n";
    const aw = extractAmendments(tw, extractCitations(tw));
    let asked = null;
    // Scoped to (b): the addition belongs to (a)(3), which is not laid out.
    const away = rc(
      { source: 'U.S. Code', citation: '7 U.S.C. 6c', links: [], tree: wideLaw(), focusPath: '',
        effect: { ops: aw[0].ops, unmatched: false } },
      { scopePath: '(b)', onScope: (p) => { asked = p; } }
    );
    eq('an addition outside the shown scope is not drawn',
       away.querySelectorAll('.node.added').length, 0);
    ok('  and the panel says why', /the provision it follows is not shown/.test(away.textContent),
       away.textContent.slice(-200));
    const show = [...away.querySelectorAll('.crumb.clickable')].find((e) => /^Show \(a\)\(3\)$/.test(e.textContent));
    ok('  offering the provision it needs', !!show,
       [...away.querySelectorAll('.crumb.clickable')].map((e) => e.textContent).join(' | '));
    show.dispatchEvent(new window.Event('click'));
    // (a), not (a)(3): a node draws its own additions only when its PARENT is
    // the scope — scoping to (a)(3) renders its children and puts (a)(3) itself
    // in the ancestor ladder, which asks additionsAt() for nothing.
    eq('  widening to the parent, which is what draws it', asked, '(a)');

    const shown = rc(
      { source: 'U.S. Code', citation: '7 U.S.C. 6c', links: [], tree: wideLaw(), focusPath: '',
        effect: { ops: extractAmendments(tw, extractCitations(tw))[0].ops, unmatched: false } },
      { scopePath: asked, onScope: () => {} }
    );
    eq('  and at that scope it really is drawn', shown.querySelectorAll('.node.added').length, 1);
    ok('  reading as the bill wrote it',
       /\(B\) an option\./.test(shown.querySelector('.node.added').textContent),
       shown.querySelector('.node.added').textContent);
  }

  // A new subsection is a sibling of (a), so it follows the whole provision.
  const t2 =
    'Section 5330 of title 31, United States Code, is amended by adding at the end the following:\n' +
    "``(f) Registration of Kiosk Locations.--The Secretary shall require operators to register.'';\n";
  const ams2 = extractAmendments(t2, extractCitations(t2));
  const add2 = ams2[0].ops.filter((o) => o.type === 'add-at-end');
  eq('a new subsection is read too', add2.length, 1);
  ok('  and is scoped to the section, not into it', !add2[0].scope, String(add2[0].scope));
  const el2 = rc({
    source: 'U.S. Code', citation: '31 U.S.C. 5330', links: [],
    tree: law(), focusPath: '', effect: { ops: ams2[0].ops, unmatched: false },
  }, { onScope: () => {} });
  eq('  drawn once', el2.querySelectorAll('.node.added').length, 1);
  ok('  at the end of the whole provision',
     /a swap\.\s*\(f\) Registration of Kiosk Locations/.test(
       el2.querySelector('.prov').textContent.replace(/\s+/g, ' ')),
     el2.querySelector('.prov').textContent.replace(/\s+/g, ' '));

  // The enacted-bill case. The Code we hold is current, so this addition is
  // usually already in it; drawing it again shows the provision twice with one
  // copy coloured as new. Same tree, but the law already contains (D).
  const enacted = law();
  enacted[0].children[0].children.push({
    marker: '(D)', path: '(a)(3)(D)', heading: '',
    text: 'a contract of sale of a digital commodity.', children: [],
  });
  const el3 = rc({
    source: 'U.S. Code', citation: '7 U.S.C. 6c(a)', links: [],
    tree: enacted, focusPath: '', effect: { ops: ams[0].ops, unmatched: false },
  }, { onScope: () => {} });
  eq('an addition the law already contains is not drawn again',
     el3.querySelectorAll('.node.added').length, 0);
  const flat3 = el3.querySelector('.prov').textContent.replace(/\s+/g, ' ');
  eq('  so the provision reads once, not twice',
     flat3.split('a contract of sale of a digital commodity.').length - 1, 1);
  ok('  and the panel says so rather than staying silent',
     /already in the law/.test(el3.textContent), el3.textContent.slice(0, 200));
}

section('context renderer');
const { renderContext } = await imp('app/ui/render-context.js');
const { findNode, pathChain } = await imp('app/resolve/provision-tree.js');

const secPath = join(ROOT, 'data/usc/t42/s7401.json');
if (existsSync(secPath)) {
  const d = JSON.parse(readFileSync(secPath, 'utf8'));
  const focusPath = '(a)(1)';
  const res = {
    source: 'U.S. Code', citation: '42 U.S.C. 7401(a)(1)', heading: d.heading, asOf: d.releasePoint,
    crumbs: d.ancestors.map((a) => ({ type: a.type, label: `${a.num} ${a.heading}`.trim(), short: a.num })),
    tree: d.tree, notes: d.notes, sourceCredit: d.sourceCredit,
    focusPath, focusNode: findNode(d.tree, focusPath), focusChain: pathChain(d.tree, focusPath),
    focusMissing: false, links: [{ label: 'Cornell LII', href: 'https://example.invalid' }],
  };

  let scoped = null;
  const el = renderContext(res, { scopePath: null, onScope: (p) => { scoped = p; } });

  ok('renders a title', el.querySelector('.ctx-title')?.textContent.includes('7401'));
  ok('renders ancestry crumbs', el.querySelectorAll('.crumbs .crumb').length >= 2);
  ok('renders the sub-level ladder', el.querySelectorAll('.ladder button').length >= 3);
  ok('highlights the focused subsection', !!el.querySelector('.node.focus'));
  ok('shows ancestor lead-in text', !!el.querySelector('.node.on-path'));
  ok('renders outbound links', el.querySelectorAll('.links a').length >= 1);
  ok('shows the as-of date', el.querySelector('.asof')?.textContent.includes(d.releasePoint));

  el.querySelectorAll('.ladder button')[0].dispatchEvent(new window.Event('click'));
  ok('ladder rung fires onScope', scoped !== null);

  const wide = renderContext({ ...res }, { scopePath: '', onScope: () => {} });
  ok('whole-section view renders every top-level subsection',
     wide.querySelectorAll(':scope > .prov > .node').length >= d.tree.length);
} else {
  console.log('  (42 U.S.C. 7401 not ingested — skipped)');
}

// --- resolvers (real module code, not just the raw APIs) -------------------
section('resolvers');
{
  // usc.js fetches relative paths ('data/usc/...'), which have no meaning
  // outside a browser. Serve those from disk and let real URLs through.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === 'string' && !/^https?:/.test(url)) {
      const f = join(ROOT, url);
      if (!existsSync(f)) return { ok: false, status: 404, json: async () => null, text: async () => '' };
      const body = readFileSync(f, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    }
    return realFetch(url, init);
  };

  const { resolve } = await imp('app/resolve/index.js');

  const usc = await resolve({ kind: 'usc', title: '42', section: '7401', subsection: '(a)(1)', text: '42 U.S.C. 7401(a)(1)' });
  ok('resolveUsc loads a shard', !usc.missing && !usc.error, usc.reason || usc.error);
  ok('  builds a tree', (usc.tree || []).length > 0);
  ok('  locates the focus node', !!usc.focusNode, `focusPath=${usc.focusPath}`);
  ok('  builds the focus chain', (usc.focusChain || []).length === 2, `${usc.focusChain?.length}`);
  ok('  carries ancestry crumbs', (usc.crumbs || []).length >= 2);

  const gone = await resolve({ kind: 'usc', title: '99', section: '1', subsection: '', text: '99 U.S.C. 1' });
  ok('un-ingested title reports missing', gone.missing === true);
  ok('  suggests the ingest command', (gone.remedy || '').includes('--titles 99'), gone.remedy);
  ok('  and still gives outbound links', (gone.links || []).length > 0, `${(gone.links || []).length}`);

  const act = await resolve({ kind: 'act', act: { name: 'Clean Air Act', pattern: '', title: '42', section: '7401', range: '7401 et seq.' }, text: 'Clean Air Act' });
  ok('act name resolves to its first section', act.isActStart === true && !act.missing);

  // A Public Law can only ever be an outbound link — govinfo and congress.gov
  // both refuse cross-origin browser requests — so the note has to hand the
  // reader the link rather than explain a CORS policy at them. It ends by
  // promising one, which makes the link part of the sentence: rendered into the
  // note's own <p>, not left to the "Read elsewhere" row underneath.
  const pl = await resolve({ kind: 'publaw', congress: '118', law: '5', text: 'Public Law 118-5' });
  eq('a Public Law says what it can do, not what it cannot', pl.note,
     "Unfortunately, Public Laws don't play nice with our scraper: here's the link");
  ok('  and carries an inline link to that law', !!pl.noteLink && /govinfo\.gov\/link\/plaw\/118\/public\/5/.test(pl.noteLink.href),
     JSON.stringify(pl.noteLink));
  const plEl = renderContext(pl, {});
  const noteP = [...plEl.querySelectorAll('.card p')].find((p) => /don't play nice/.test(p.textContent));
  ok('  the link renders INSIDE the note paragraph', !!noteP && !!noteP.querySelector('a'),
     noteP ? noteP.innerHTML : 'no note paragraph');
  ok('  pointing at the law itself', noteP?.querySelector('a')?.href.includes('/plaw/118/public/5'),
     noteP?.querySelector('a')?.href);
  // The alternatives are still offered separately.
  ok('  and the other sources are still listed', (pl.links || []).length === 3, `${(pl.links || []).length}`);

  // ---- and the laws we hold locally --------------------------------------
  if (existsSync(join(ROOT, 'data/plaw/116-6/manifest.json'))) {
    const enacted = await resolve({ kind: 'publaw', congress: '116', law: '6', actSection: '4', text: 'section 4 of Public Law 116-6' });
    const el = renderContext(enacted, {});
    ok('an uncodified section renders its enacted text',
       /STATEMENT OF APPROPRIATIONS/i.test(el.textContent), el.textContent.slice(0, 90));
    // The reader has to know this is history. The text is a snapshot of the day
    // the law passed and is never updated — where the Code could answer, it
    // already did, so reaching this pane means nobody has.
    ok('  under an "As enacted" warning',
       [...el.querySelectorAll('.card.warn h4')].some((h) => /As enacted/.test(h.textContent)),
       [...el.querySelectorAll('h4')].map((h) => h.textContent).join(' | '));

    // ---- a Public Law section renders its OUTLINE, not a wall of text ------
    // data/plaw stores a section as the law prints it: hard-wrapped at 72
    // columns, indented by depth, one string. In one element that is 14,852
    // characters of Pub. L. 117-2 § 2001 with no visible structure. The Code's
    // sections arrive from USLM already nested and have always had a tree to
    // draw; parseProvision gives a Public Law the same one.
    if (existsSync(join(ROOT, 'data/plaw/117-2/manifest.json'))) {
      const arp = await resolve({ kind: 'publaw', congress: '117', law: '2', actSection: '2001',
                                  text: 'section 2001 of Public Law 117-2' });
      const el2 = renderContext(arp, {});
      const nodes = el2.querySelectorAll('.prov .node');
      ok('a Public Law section renders as an outline', nodes.length >= 20, `${nodes.length} nodes`);
      ok('  with markers drawn', el2.querySelectorAll('.prov .marker').length >= 20,
         `${el2.querySelectorAll('.prov .marker').length} markers`);
      ok('  and nested levels', el2.querySelectorAll('.prov .kids').length >= 3,
         `${el2.querySelectorAll('.prov .kids').length} nested groups`);
      // The 72-column wrap must not survive into the rendered text: a phrase
      // broken across the measure carries the newline AND the continuation
      // indent, which renders as a run of spaces through a sentence.
      const body = [...el2.querySelectorAll('.prov .body')].map((n) => n.textContent).join(' ');
      ok('  the wrap indent is gone from mid-sentence', !/\S {3,}\S/.test(body),
         JSON.stringify((body.match(/\S {3,}\S/) || [''])[0]));
      ok('  and the Statutes page furniture with it', !/\[\[Page/.test(body),
         JSON.stringify((body.match(/\[\[Page[^\]]*\]\]/) || [''])[0]));
      // The section head is stripped from the text because it is the entry's
      // own heading, so it has to be drawn or it is simply lost.
      ok('  the heading survives as a heading',
         /ELEMENTARY AND SECONDARY SCHOOL EMERGENCY RELIEF FUND/.test(el2.textContent),
         el2.textContent.slice(0, 100));
    }

    // ---- a named subdivision shows its PROVISIONS, not a list of headings --
    // "title IV of division M of Public Law 116-260" was answered with a row of
    // chips reading "Sec. 401. …", which is the table of contents of something
    // the reader still cannot see.
    if (existsSync(join(ROOT, 'data/plaw/116-260/manifest.json'))) {
      const div = await resolve({ kind: 'publaw', congress: '116', law: '260',
                                  division: 'M', where: ['DIVISION M', 'TITLE IV'],
                                  text: 'title IV of division M of Public Law 116-260' });
      eq('a subdivision citation reaches the level it names',
         div.citation, 'Pub. L. 116-260, division M, title IV');
      ok('  and renders provisions rather than a listing',
         (div.plaw.provisions || []).length > 0, `${(div.plaw.provisions || []).length}`);
      ok('  far fewer than the whole law', div.plaw.total < 100, `${div.plaw.total} sections`);
      eq('  nothing was dropped from the path', div.plaw.droppedLevels, null);
      const dEl = renderContext(div, {});
      ok('  the provisions carry real text',
         /Amounts made available in this Act/.test(dEl.textContent), dEl.textContent.slice(0, 140));
      ok('  with the shared heading drawn once',
         [...dEl.querySelectorAll('.ctx-sub')].filter((n) => /DIVISION M/.test(n.textContent)).length === 1,
         `${[...dEl.querySelectorAll('.ctx-sub')].filter((n) => /DIVISION M/.test(n.textContent)).length} copies`);

      // Where the law's text genuinely does not record the level named, the path
      // is shortened from the inside out until something matches, rather than
      // falling through to all 2,092 sections of the law. A level that cannot
      // exist proves the fallback without depending on stale data to supply it.
      const deep = await resolve({ kind: 'publaw', congress: '116', law: '260',
                                   division: 'M', where: ['DIVISION M', 'TITLE IV', 'SUBTITLE Z'],
                                   text: 'subtitle Z of title IV of division M of Public Law 116-260' });
      eq('an unrecorded level falls back to the nearest one that exists',
         deep.citation, 'Pub. L. 116-260, division M, title IV');
      ok('  reporting what it could not place', (deep.plaw.droppedLevels || []).join() === 'subtitle Z',
         JSON.stringify(deep.plaw.droppedLevels));
      const deepEl = renderContext(deep, {});
      ok('  and saying so in the pane', /Showing a wider level/.test(deepEl.textContent),
         deepEl.textContent.slice(0, 140));
      ok('  naming what was asked for', /subtitle Z/.test(deepEl.textContent), 'no mention of subtitle Z');
    }

    const many = await resolve({ kind: 'publaw', congress: '116', law: '6', actSection: '101', text: 'section 101 of Public Law 116-6' });
    const manyEl = renderContext(many, {});
    eq('every section sharing a number is rendered',
       manyEl.querySelectorAll('.prov').length, 6);
    ok('  and the ambiguity is stated, not hidden',
       /More than one/.test(manyEl.textContent) && /6 sections numbered 101/.test(manyEl.textContent),
       manyEl.textContent.slice(0, 160));
    ok('  each labelled with the division it is in',
       [...manyEl.querySelectorAll('.prov .ctx-sub')].length === 6,
       `${manyEl.querySelectorAll('.prov .ctx-sub').length} labels`);

    const whole = await resolve({ kind: 'publaw', congress: '116', law: '136', text: 'Public Law 116-136' });
    const wholeEl = renderContext(whole, {});
    ok('a bare Public Law renders its contents',
       /Contents — 286 sections/.test(wholeEl.textContent),
       [...wholeEl.querySelectorAll('h4')].map((h) => h.textContent).join(' | '));
  }

  // Live eCFR through the real resolver: XML parse, section split, ancestry.
  try {
    const cfr = await resolve({ kind: 'cfr', title: '40', part: '60', section: '60.1', subsection: '', text: '40 CFR 60.1' });
    ok('resolveCfr fetches and parses', !cfr.error, cfr.error);
    ok('  extracts a focus section', !!cfr.focus && cfr.focus.number === '60.1', cfr.focus?.number);
    ok('  section has paragraphs', (cfr.focus?.paragraphs || []).length > 0);
    ok('  builds ancestry crumbs', (cfr.crumbs || []).length >= 3, `${cfr.crumbs?.length}`);
    ok('  reports an as-of date', !!cfr.asOf);
  } catch (err) {
    ok('resolveCfr works', false, err.message);
  }

  globalThis.fetch = realFetch;
}

// --- notes -----------------------------------------------------------------
section('notes');
{
  const { renderContext: rcn } = await imp('app/ui/render-context.js');
  // Two faults, both of which made the notes unreadable. The label was USLM's
  // `topic` attribute printed raw — "effectiveDateOfAmendment: …" — and the
  // note's own heading was flattened into the front of its body with no
  // separator, so it arrived as "References in TextSection 603(a)(5)(K)…".
  const el = rcn(
    {
      source: 'U.S. Code', citation: '42 U.S.C. 603', links: [], tree: [],
      notes: [
        { topic: 'referencesInText', heading: 'References in Text', text: 'Section 603(a)(5)(K) of this title, referred to in…' },
        { topic: 'effectiveDateOfAmendment', heading: 'Effective Date of 2014 Amendment', text: 'Amendment by Pub. L. 113–128 effective…' },
        { topic: 'historicalAndRevision', heading: '', text: 'Based on title 5, U.S.C., 1964 ed.' },
        { topic: 'someNewTopicUslmInvented', heading: '', text: 'body of it' },
      ],
    },
    { onScope: () => {} }
  );
  const heads = [...el.querySelectorAll('.notehead')].map((h) => h.textContent);
  eq('every note gets a label', heads.length, 4);
  eq('  the note\'s own heading when it has one', heads[0], 'References in Text');
  ok('  which is the specific one, not the category',
     heads[1] === 'Effective Date of 2014 Amendment', heads[1]);
  eq('  a readable name for the topic when it has not', heads[2], 'Historical and revision notes');
  // An unknown topic must not fall back to raw camelCase.
  eq('  and an unmapped topic is still split into words', heads[3], 'Some new topic uslm invented');
  ok('no label is a raw camelCase identifier',
     !heads.some((h) => /^[a-z]+[A-Z]/.test(h)), heads.join(' | '));
  // The heading leads in its own element; the body does not repeat it. Asked of
  // the <p> rather than the note's textContent, because textContent runs
  // sibling elements together with no separator and would report a glue that
  // the markup does not have — which is a different bug from the one fixed.
  const first = el.querySelector('.note');
  const body = first.querySelector('p').textContent;
  ok('the body does not begin with the heading',
     !body.startsWith('References in Text'), JSON.stringify(body.slice(0, 60)));
  ok('  and the body is still there', /^Section 603\(a\)\(5\)\(K\)/.test(body),
     JSON.stringify(body.slice(0, 60)));
  eq('  with the heading in its own element',
     first.querySelector('.notehead').textContent, 'References in Text');
}

// --- export ----------------------------------------------------------------
section('export');
{
  // The export makes three promises, and each is checkable. It is worth
  // checking them mechanically rather than by reading the builder, because
  // every one of them is broken by adding a single line somewhere else — a
  // web font in the stylesheet, an <img>, a lazily-fetched anything.
  const { buildExport } = await imp('app/export.js');
  const { renderContext: rcx } = await imp('app/ui/render-context.js');

  const t =
    'SECTION 1. SHORT TITLE.\n' +
    "This Act may be cited as the ``Export Test Act''.\n" +
    'SEC. 2. AMENDMENT.\n' +
    "Section 7401 of title 42, United States Code, is amended by striking ``smog''.\n";
  const b = parseBill(normalizeText(t));
  const cs = extractCitations(normalizeText(t));
  const el = renderBill(b, cs, extractAmendments(normalizeText(t), cs), () => {}, () => {});

  const html = await buildExport({
    bill: b,
    citations: cs,
    billEl: el,
    // Stand in for the resolver: what matters here is the shape of the file,
    // not which provision came back.
    resolve: async (c) => ({ source: 'U.S. Code', citation: c.text, links: [], tree: [], lead: 'text of the law' }),
    renderContext: rcx,
  });

  ok('the export is a whole document', /^<!doctype html>/i.test(html), html.slice(0, 40));
  // 1. No requests.
  const refs = [
    ...html.matchAll(/<link\b[^>]*href=["']([^"']+)["']/gi),
    ...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi),
    ...html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi),
  ]
    .map((m) => m[1])
    .filter((u) => !/^data:/i.test(u));
  eq('it references nothing off the page', refs.join(', '), '');
  eq('  no stylesheet url() to fetch', (html.match(/url\((?!['"]?data:)/gi) || []).length, 0);
  eq('  and nothing that could fetch at runtime',
     (html.match(/\bfetch\s*\(|XMLHttpRequest|import\s*\(/g) || []).length, 0);
  // 2. It carries its own styling, or it is not the same view.
  ok('it inlines the stylesheet', /\.billtext/.test(html) && /<style>/.test(html),
     `${html.length} chars`);
  // 3. Every chip either opens something or is visibly inert. A chip that
  //    looks live and does nothing is the failure this guards.
  const doc = parseHTML(html).document;
  const chips = [...doc.querySelectorAll('.cite')];
  ok('it has the bill\'s chips', chips.length > 0, `${chips.length}`);
  eq('  every one of them resolves to a panel or is marked dead',
     chips.filter((c) => !c.hasAttribute('data-ctx') && !c.classList.contains('cite-dead')).length, 0);
  ok('  and the panels are in the file', doc.querySelectorAll('.ctxpanel').length > 0);
  eq('  hidden until one is chosen',
     [...doc.querySelectorAll('.ctxpanel')].filter((p) => !p.hasAttribute('hidden')).length, 0);
  // The bill itself, not a summary of it.
  eq('the bill keeps its sections', doc.querySelectorAll('.sec-head').length, b.sections.length);
  ok('  and its text', /Export Test Act/.test(html), html.slice(0, 90));
  // It says what it is. A snapshot that does not admit to being one invites
  // someone to read stale law as current.
  ok('it says it is a snapshot of a date', /Snapshot taken \d{4}-\d{2}-\d{2}/.test(html),
     (html.match(/Snapshot[^<]*/) || [''])[0]);

  // Pasted text can never become markup: the bill goes in through the DOM.
  const nasty = normalizeText(
    'SECTION 1. SHORT TITLE.\nThis Act may be cited as the ``<script>alert(1)</script> Act\'\'.\n'
  );
  const nb = parseBill(nasty);
  const ncs = extractCitations(nasty);
  const nhtml = await buildExport({
    bill: nb,
    citations: ncs,
    billEl: renderBill(nb, ncs, [], () => {}, () => {}),
    resolve: async () => ({ source: 'x', citation: 'x', links: [], tree: [] }),
    renderContext: rcx,
  });
  ok('a bill cannot inject markup into its own export',
     !/<script>alert\(1\)<\/script>/.test(nhtml), 'raw script tag survived from the bill text');
  ok('  though the words are still there to read, escaped',
     /&lt;script&gt;alert\(1\)/.test(nhtml), 'the text was lost entirely');
}

// --- the paste flow, driven through main.js exactly as a user does it -------
section('paste → parse flow');
try {
  // Importing main.js registers every real listener against our DOM, so this
  // exercises the actual wiring rather than a reimplementation of it.
  globalThis.FileReader = class {};
  globalThis.Event = window.Event;
  // The app reads location to build share links and the embed snippet. linkedom
  // has no navigation, so the harness supplies one — same reason as the two
  // shims above.
  globalThis.location = window.location ?? { href: 'http://localhost:8000/', protocol: 'http:' };
  await imp('app/main.js');

  // The boot diagnostic in index.html treats a missing __bcReady as "the app
  // failed to start". Dropping this flag therefore turns a healthy page into a
  // false error report — which is exactly what happened once.
  ok('main.js sets the boot-ready flag', window.__bcReady === true,
     'index.html will report a false "failed to start" without it');

  const modal = document.getElementById('paste-modal');
  const area = document.getElementById('paste-area');
  const billBody = document.getElementById('bill-body');

  document.getElementById('paste-btn').dispatchEvent(new window.Event('click'));
  eq('Paste text opens the modal', modal.hidden, false);

  area.value = 'SEC. 2. FIX.\n\nSection 407(b)(3) of the Social Security Act ' +
               '(42 U.S.C. 607(b)(3)) is amended by striking ``old\'\' and inserting ``new\'\'.\n';
  document.getElementById('paste-ok').dispatchEvent(new window.Event('click'));

  ok('Parse closes the modal', modal.hidden === true);
  ok('Parse renders the bill', billBody.querySelectorAll('.cite').length > 0,
     `${billBody.querySelectorAll('.cite').length} chips rendered`);
  ok('Parse finds the amendment', billBody.querySelectorAll('.amend').length === 1,
     `${billBody.querySelectorAll('.amend').length} blocks`);
  ok('bill metadata is revealed', document.getElementById('billmeta').hidden === false);
  ok('status reports what was found',
     /citation/.test(document.getElementById('status').textContent),
     JSON.stringify(document.getElementById('status').textContent));

  // ---- the jump menu knows about divisions -------------------------------
  // A flat list is actively misleading in a bill with divisions, because the
  // numbering restarts inside each one: two different "TITLE I"s, and nothing
  // in the menu to say a boundary had been crossed.
  document.getElementById('paste-btn').dispatchEvent(new window.Event('click'));
  area.value =
    'SECTION 1. SHORT TITLE.\n' +
    "This Act may be cited as the ``Divided Test Act''.\n" +
    '\n' +
    'DIVISION A--FIRST DIVISION\n' +
    '\n' +
    'TITLE I--ALPHA\n' +
    '\n' +
    'SEC. 101. ONE.\n' +
    'Body text of section 101.\n' +
    '\n' +
    'DIVISION B--SECOND DIVISION\n' +
    '\n' +
    'TITLE I--BETA\n' +
    '\n' +
    'SEC. 201. TWO.\n' +
    'Body text of section 201.\n';
  document.getElementById('paste-ok').dispatchEvent(new window.Event('click'));

  const jump = document.getElementById('jump');
  const groups = jump.querySelectorAll('optgroup');
  eq('the jump menu groups sections by division', groups.length, 2);
  eq('  the first group names its whole chain',
     groups[0] && groups[0].getAttribute('label'),
     'DIVISION A — FIRST DIVISION  ›  TITLE I — ALPHA');
  eq('  and the second distinguishes the other TITLE I',
     groups[1] && groups[1].getAttribute('label'),
     'DIVISION B — SECOND DIVISION  ›  TITLE I — BETA');
  // Section 1 sits above any division, so it belongs on the select itself —
  // not swept into whichever group happens to come first.
  const direct = [...jump.children].filter((c) => c.tagName === 'OPTION');
  eq('sections above any division stay ungrouped', direct.length, 2); // placeholder + Sec. 1
  ok('  and section 1 is one of them', direct.some((o) => /Sec\. 1\./.test(o.textContent)),
     direct.map((o) => o.textContent).join(' | '));
} catch (err) {
  ok('paste flow runs', false, err.message);
}

// --- embedding & credit ----------------------------------------------------
// main.js has already been imported by the section above, so these assert the
// real listeners rather than a reimplementation of them.
section('embedding & about');
{
  const aboutModal = document.getElementById('about-modal');
  const fullBtn = document.getElementById('full-btn');
  const snippet = document.getElementById('embed-snippet');

  // Not framed in the test harness, so the way out of a frame stays hidden and
  // the page does not claim to be embedded.
  ok('the fullscreen button is hidden when not embedded', fullBtn.hidden === true);
  ok('  and no embed flag is set', document.documentElement.dataset.embed === undefined,
     JSON.stringify(document.documentElement.dataset.embed));

  // The embed snippet is the thing a host actually pastes; it has to be present
  // and correct without anyone clicking anything.
  const code = snippet.textContent;
  ok('an embed snippet is generated', code.length > 40, JSON.stringify(code));
  ok('  it is an iframe', /^<iframe\b/.test(code), code.slice(0, 60));
  // Without this attribute the host's frame refuses the Fullscreen API and the
  // button silently does nothing — which is why it is in the snippet at all.
  ok('  carrying allow="fullscreen"', /allow="fullscreen"/.test(code), code);
  ok('  and a title for screen readers', /title="Bill Companion"/.test(code), code);
  ok('  pointing at this page, with no share payload in it',
     code.includes('src="http') && !code.includes('#t='), code);

  // The about dialog: opens, credits, closes.
  eq('about starts hidden', aboutModal.hidden, true);
  document.getElementById('about-btn').dispatchEvent(new window.Event('click'));
  eq('the about button opens it', aboutModal.hidden, false);
  ok('it credits the author', /Keller Scholl/.test(aboutModal.textContent), aboutModal.textContent.slice(0, 120));
  const credit = aboutModal.querySelector('.credit a');
  ok('  the credit is a link', Boolean(credit) && /Keller Scholl/.test(credit.textContent),
     credit ? credit.outerHTML : 'no link in .credit');
  eq('  to kellerscholl.com', credit?.getAttribute('href'), 'https://kellerscholl.com');
  // Framed, a bare link would navigate the host page's iframe away from the app.
  eq('  opening in a new tab', credit?.getAttribute('target'), '_blank');
  ok('  with rel protecting the opener', /noopener/.test(credit?.getAttribute('rel') || ''),
     credit?.getAttribute('rel'));
  ok('  and says the bill never leaves the browser',
     /Nothing is uploaded/i.test(aboutModal.textContent), aboutModal.textContent.slice(0, 200));
  document.getElementById('about-ok').dispatchEvent(new window.Event('click'));
  eq('the close button closes it', aboutModal.hidden, true);

  // Same hazard as the paste modal: an author `display` rule on .modal beats the
  // UA sheet's [hidden], so the dialog would sit invisibly over the whole page
  // swallowing every click. The contract check above covers it — this asserts
  // the new dialog is actually in that check's scope.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const aboutTag = html.match(/<div class="modal" id="about-modal"[^>]*>/);
  ok('the about dialog is hidden by the attribute, not by a class',
     aboutTag && /\bhidden\b/.test(aboutTag[0]), JSON.stringify(aboutTag && aboutTag[0]));
}

section('fallback states');
{
  const el = renderContext(
    { source: 'U.S. Code', citation: '99 U.S.C. 1', missing: true,
      reason: 'Title 99 has not been ingested.', remedy: 'python tools/ingest_usc.py --titles 99',
      links: [{ label: 'Cornell LII', href: 'https://example.invalid' }] },
    { onScope: () => {} });
  ok('missing title shows the remedy command', el.querySelector('.remedy')?.textContent.includes('ingest_usc'));
  ok('missing title still offers links', el.querySelectorAll('.links a').length >= 1);
}
{
  const el = renderContext({ source: 'error', citation: 'x', error: 'boom', links: [] }, { onScope: () => {} });
  ok('error state renders the message', el.querySelector('.card.err')?.textContent.includes('boom'));
}
{
  // A located internal reference reports what was highlighted. It must NOT fall
  // back to the note, which now only describes failure.
  const el = renderContext(
    { source: 'Internal reference', citation: 'clause (ii)', internal: true,
      note: 'nothing was found', links: [],
      target: { label: 'clause (ii)', why: 'The only (ii) inside the enclosing provision.',
                section: { num: '4', heading: 'DEFINITIONS' }, ambiguous: false } },
    { onScope: () => {} });
  const txt = el.textContent;
  ok('a located internal ref says what it highlighted', /Shown in the bill/.test(txt), txt.slice(0, 120));
  ok('  naming the provision and the section', /clause \(ii\)/.test(txt) && /Sec\. 4/.test(txt), txt);
  ok('  and not the failure note', !/nothing was found/.test(txt), txt);
  ok('  unambiguous matches are not flagged as warnings',
     el.querySelector('.card.warn') === null, 'warn card on an unambiguous match');

  // A guess must not be headed with a statement. "Shown in the bill" over a
  // match taken from outside the scope the reference governs reads as an
  // answer; 1,581 references across the corpus resolve that way, and the user's
  // instruction is to keep guessing and flag it.
  const g = renderContext(
    { source: 'Internal reference', citation: 'clause (vii)', internal: true, links: [],
      target: { label: 'clause (vii)',
                why: 'There is no (vii) inside the enclosing provision at all, so this is the nearest one anywhere in the section.',
                section: { num: '4', heading: 'RULES' }, ambiguous: true, guess: true } },
    { onScope: () => {} });
  const gtxt = g.textContent;
  ok('a guess is headed as a guess', /Best guess/.test(gtxt), gtxt.slice(0, 140));
  ok('  and never as a statement of fact', !/Shown in the bill/.test(gtxt), gtxt.slice(0, 140));
  ok('  warning the provision may be wrong', /may be the wrong provision/.test(gtxt), gtxt.slice(0, 140));
  ok('  and carried as a warn card', g.querySelector('.card.warn') !== null, 'no warn card on a guess');
}
{
  // More than one candidate: still shown, but flagged rather than asserted.
  const el = renderContext(
    { source: 'Internal reference', citation: 'clause (ii)', internal: true, links: [],
      target: { label: 'clause (ii)', why: 'The nearest (ii) inside the enclosing provision, which has 3.',
                section: { num: '9', heading: 'X' }, ambiguous: true } },
    { onScope: () => {} });
  ok('an ambiguous match is flagged', el.querySelector('.card.warn') !== null, el.textContent);
}
{
  // Nothing found: the note is the answer, and it explains rather than restates.
  const { resolve } = await imp('app/resolve/index.js');
  const res = await resolve({ kind: 'internal', text: 'paragraph (7)', scope: 'section', subsection: '(7)' });
  const el = renderContext({ ...res }, { onScope: () => {} });
  ok('an unlocated internal ref explains itself', /nothing to show/.test(el.textContent), el.textContent);
  ok('  and no longer merely restates the citation',
     !/Points at another part of the provision currently being amended/.test(el.textContent),
     el.textContent);

  // …and the OTHER silence. A reference sitting inside language the bill is
  // inserting is not a dangling pointer into the bill; it is new law naming the
  // statute it is being written into, and the instruction around it simply did
  // not give a Code section to read it against. Telling the reader "no (d)
  // appears anywhere in this section of the bill" about a citation that was
  // never about the bill reads as a parser shrug at a perfectly clear sentence.
  const ins = await resolve({
    kind: 'internal', text: 'subsection (d)', scope: 'section', subsection: '(d)',
    inserted: { start: 0, end: 100 },
  });
  const insEl = renderContext({ ...ins }, { onScope: () => {} });
  ok('a reference inside inserted law says which silence this is',
     /language the bill is inserting/.test(insEl.textContent), insEl.textContent);
  ok('  and does not blame the bill for having no such provision',
     !/anywhere in this section of the bill/.test(insEl.textContent), insEl.textContent);
}
{
  // The composed half: the same reference where the instruction DID name a
  // section. The card has to read as what it is — new language pointing at the
  // law it joins — and not as the ordinary "carried down from the enclosing
  // instruction", which is a different derivation and a weaker claim.
  const el = renderContext(
    { source: 'U.S. Code', citation: '26 U.S.C. 1(d)', tree: [], focusPath: '(d)',
      relative: { unit: 'subsection', markers: '(d)', via: 'Section 1', path: '(d)', insertedLaw: true },
      links: [] },
    { onScope: () => {} });
  const t = el.textContent;
  ok('an address composed out of inserted law says so', /language this bill is adding/.test(t), t.slice(0, 200));
  ok('  naming the section the new law joins', /Section 1/.test(t), t.slice(0, 200));
  ok('  and saying it points at the Code, not the bill', /not at anything in the bill/.test(t), t.slice(0, 200));

  const ord = renderContext(
    { source: 'U.S. Code', citation: '26 U.S.C. 1(d)', tree: [], focusPath: '(d)',
      relative: { unit: 'clause', markers: '(iv)', via: 'Section 1', path: '(d)' }, links: [] },
    { onScope: () => {} });
  ok('  while an ordinary composed address keeps its own wording',
     /inside an instruction amending/.test(ord.textContent) &&
       !/language this bill is adding/.test(ord.textContent),
     ord.textContent.slice(0, 200));
}
{
  // A section that is no longer there. 910 citations across the corpus land on
  // one; the pane used to show a one-word heading over a blank body, and where a
  // subsection had been cited it added "which usually means the bill is adding
  // it" — false twice over about a provision that has simply moved.
  const moved = renderContext(
    { source: 'U.S. Code', citation: '42 U.S.C. 10601(d)(3)', tree: [], focusPath: '(d)(3)',
      focusMissing: true, stub: 'Transferred',
      moved: { title: '34', section: '20101', citation: '34 U.S.C. 20101',
               href: 'https://www.law.cornell.edu/uscode/text/34/20101' },
      links: [] },
    { onScope: () => {} });
  const mt = moved.textContent;
  ok('a moved section says it moved', /Moved/.test(mt), mt.slice(0, 200));
  ok('  naming the successor', /34 U\.S\.C\. 20101/.test(mt), mt.slice(0, 260));
  ok('  and offering a way to it',
     [...moved.querySelectorAll('a')].some((a) => /uscode\/text\/34\/20101/.test(a.href)),
     [...moved.querySelectorAll('a')].map((a) => a.href).join(' '));
  ok('  while suppressing the "bill is adding it" caveat',
     !/usually means the bill is adding it/.test(mt), mt.slice(0, 400));

  const repealed = renderContext(
    { source: 'U.S. Code', citation: '26 U.S.C. 71', tree: [], focusPath: '',
      stub: 'Repealed. Pub. L. 115–97, § 11051(b)(1)(B)', moved: null, links: [] },
    { onScope: () => {} });
  ok('a repealed section says there is no text', /No text here/.test(repealed.textContent),
     repealed.textContent.slice(0, 200));
  ok('  quoting the reason the Code gives', /Repealed\. Pub\. L\. 115/.test(repealed.textContent),
     repealed.textContent.slice(0, 240));
  ok('  and inventing no successor', !/renumbered into/.test(repealed.textContent),
     repealed.textContent.slice(0, 240));

  // A live section keeps the ordinary caveat.
  const live = renderContext(
    { source: 'U.S. Code', citation: '26 U.S.C. 168(k)(9)', tree: [{ path: '(k)', heading: 'x', children: [] }],
      focusPath: '(k)(9)', focusMissing: true, stub: null, moved: null, links: [] },
    { onScope: () => {} });
  ok('a live section still gets the ordinary missing-subsection caveat',
     /usually means the bill is adding it/.test(live.textContent), live.textContent.slice(0, 300));
}
{
  // A range is not a list. "Notwithstanding subsections (b) through (i)" names
  // eight subsections, and the pane used to answer with (b) under a heading
  // saying (b) alone — the `et seq.` fault one level down. 913 citations across
  // the corpus carry a range. Unlike `et seq.` the end is written in the bill, so
  // the card states where the range stops rather than refusing to say.
  const at = (markers) =>
    renderContext(
      { source: 'U.S. Code', citation: `26 U.S.C. 1${markers}`, tree: [], focusPath: markers,
        relative: { unit: 'subsection', markers, via: 'Section 1', path: markers,
                    range: { from: '(b)', to: '(i)' } }, links: [] },
      { onScope: () => {} }
    );
  const first = at('(b)').textContent;
  ok('a range says it is a range', /named a range/.test(first), first.slice(0, 200));
  ok('  naming both ends', /\(b\) through \(i\)/.test(first), first.slice(0, 220));
  ok('  and saying this is where it begins', /range begins/.test(first), first.slice(0, 260));
  ok('  flagged as a caveat, not a statement', at('(b)').querySelector('.card.warn') !== null,
     'no warn card on a range');
  ok('  while the other end says it ends there', /range ends/.test(at('(i)').textContent),
     at('(i)').textContent.slice(0, 260));

  // A plain composed address must not grow the caveat.
  const plain = renderContext(
    { source: 'U.S. Code', citation: '26 U.S.C. 1(b)', tree: [], focusPath: '(b)',
      relative: { unit: 'subsection', markers: '(b)', via: 'Section 1', path: '(b)' }, links: [] },
    { onScope: () => {} });
  ok('  and a single address says nothing about ranges',
     !/named a range/.test(plain.textContent), plain.textContent.slice(0, 160));
}
{
  // A level dropped because the Code section IS the Act's subsection. The pane
  // has to say which level went and why, or the address above the provision and
  // the provision below it simply disagree and it reads as a lost level.
  const el = renderContext(
    { source: 'U.S. Code', citation: '2 U.S.C. 4532(d)(3)', tree: [], focusPath: '(3)',
      headLevel: '(d)', links: [] },
    { onScope: () => {} });
  const t = el.textContent;
  ok('a dropped Act level is stated, not silent', /One level dropped/.test(t), t.slice(0, 200));
  ok('  naming the level that went', /\(d\)/.test(t), t.slice(0, 200));
  ok('  and where it is shown instead', /\(3\)/.test(t), t.slice(0, 200));
  ok('  and it is not dressed as a warning', el.querySelector('.card.warn') === null,
     'warn card on a successful repair');
}
{
  const el = renderContext(
    { source: 'U.S. Code', citation: '42 U.S.C. 7401', tree: [], focusPath: '',
      effect: { ops: [{ type: 'strike', text: 'widget', found: true }, { type: 'insert', text: 'gadget' }],
                unmatched: false }, links: [] },
    { onScope: () => {} });
  eq('effect panel renders each op', el.querySelectorAll('.effect .op-row').length, 2);
  ok('effect marks found strike text', el.querySelector('.effect .found') !== null);
}

console.log(`\n${'─'.repeat(52)}`);
if (fail) {
  console.log(`\x1b[31m${fail} failed\x1b[0m, ${pass} passed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\x1b[32mall ${pass} render checks passed\x1b[0m`);
