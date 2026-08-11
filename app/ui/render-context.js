// Right pane: the provision a citation points at, shown in context.
//
// The organising idea is the *ladder*. A cite like 42 U.S.C. 1395x(s)(2)(B) names
// a leaf, but reading it alone is useless — the meaning lives in the lead-in text
// of (s) and (2) above it. So we render the chain of ancestors down to the target,
// and expose the ladder as controls that widen the view one sub-level at a time.

import { findNode, pathChain, flattenText } from '../resolve/provision-tree.js';
import { parseProvision } from '../parse/outline.js';
import { createRedline } from './redline.js';

export function renderContext(res, handlers) {
  const root = document.createElement('div');
  if (res.error)   return errorCard(root, res);
  if (res.missing) return missingCard(root, res, handlers);
  if (res.plaw)    return plawCard(root, res, handlers);
  if (res.external || res.internal) return externalCard(root, res);

  // The redline lives for exactly one render pass. Marks are applied to the law
  // as the provision is walked, in document order, and the same object is
  // threaded through every node so a struck phrase is struck once rather than
  // everywhere it happens to occur. Rebuilt on each call because the pane
  // re-renders whenever the scope changes.
  // The whole provision goes in too, so the redliner can tell whether this
  // amendment has already been applied to the law we hold before it draws
  // anything. See createRedline().
  // BOTH renderings, and the difference between them is a heading. The Code
  // stores a node's heading apart from its body, so flattenText writes
  // "(d) It shall not be in order…" where a bill writes "(d) Enforcement of
  // Discretionary Spending Limits.--It shall not be in order…". Whether the
  // bill's own language carries the heading cuts both ways — some headings are
  // enacted and some are supplied editorially by the OLRC — so neither
  // rendering alone is the provision. createRedline() asks all of them.
  if (res.effect) {
    const whole = res.tree
      ? [
          [res.lead || '', ...res.tree.map(flattenText)].join('\n'),
          [res.lead || '', ...res.tree.map(subtreeText)].join('\n'),
        ]
      : res.sections
      ? res.sections.map((s) => s.paragraphs.join('\n')).join('\n')
      : '';
    // Every path in the tree, so an operation addressed to a level this
    // provision does not have can be widened to one it does instead of matching
    // nothing and vanishing. Collected here because this is the only place that
    // knows both the ops and the shape of what is about to be rendered.
    const paths = new Set();
    const collect = (n) => { paths.add(String(n.path || '')); (n.children || []).forEach(collect); };
    (res.tree || []).forEach(collect);
    res.effect.redline = createRedline(res.effect.ops, whole, paths.size ? paths : null);
  }

  head(root, res);
  // The instruction named no Act at all and the target was synthesised from the
  // text around it — a declared "Amendment of 1986 Code", the last title the
  // bill named, or the provision the previous instruction was amending. Every
  // one of those is a good inference and none of them is something the reader
  // can see in the sentence they clicked, so it is said before the provision
  // rather than after it. Above `relative`, which is a derivation from an
  // address the bill DID write out and so is the weaker caveat of the two.
  if (res.implied) {
    root.appendChild(
      card(
        'Supplied by context — not named here',
        `This instruction does not write out what it amends. Supplied by context: ` +
          `${res.implied}. That is an inference from the surrounding text, not ` +
          `something this sentence states.`,
        'warn'
      )
    );
  }
  if (res.relative) {
    // The bill never wrote this address out — it said "in clause (iv)" and left
    // the reader to carry down the enclosing instruction's target. Show the
    // derivation so the jump is auditable rather than magic.
    //
    // The inserted-law wording is a different claim and has to read as one. The
    // reader is looking at words that are not law yet, and the reference in them
    // points at the section they are being written INTO — which is why it can be
    // composed at all, and why it is not simply "the enclosing instruction's
    // target carried down".
    root.appendChild(
      card(
        'Read in context',
        res.relative.insertedLaw
          ? `“${res.relative.unit} ${res.relative.markers}” is inside language this bill is adding to ` +
            `${res.relative.via}. New law refers to the section it joins, so this points at ` +
            `${res.citation} — not at anything in the bill.`
          : `The bill says “${res.relative.unit} ${res.relative.markers}”, inside an instruction ` +
            `amending ${res.relative.via}. That resolves to ${res.citation}.`,
        ''
      )
    );
  }
  if (res.relative && res.relative.range) {
    // A range is not a list. "Notwithstanding subsections (b) through (i)" names
    // eight subsections, and answering with (b) under a heading that says (b)
    // alone is the `et seq.` fault one level down — a confident answer to a
    // question the citation did not ask. Unlike `et seq.`, the end is written in
    // the bill, so this says where the range stops instead of refusing.
    const r = res.relative.range;
    const unit = res.relative.unit || 'provision';
    const here = res.relative.markers === r.to ? 'ends' : 'begins';
    root.appendChild(
      card(
        'The bill named a range',
        `The bill says “${escapeText(unit)}s ${escapeText(r.from)} through ${escapeText(r.to)}” — every ` +
          `${escapeText(unit)} from one to the other, not just the two it writes down. This is where the ` +
          `range ${here}; the ${escapeText(unit)}s between are named only by implication, so they are not ` +
          `shown here.`,
        'warn'
      )
    );
  }
  if (res.viaActSection) {
    // The bill wrote an Act-relative number and the pane is showing a Code
    // section with a different one. That is the correct answer and it looks
    // wrong, so the derivation is shown rather than asserted — and it names the
    // source credit it came from, which is checkable against the section itself.
    const v = res.viaActSection;
    // "the" belongs in front of an Act's NAME and nowhere else. This path also
    // serves a Public Law cited by number, where `act` is the synthesised
    // "Pub. L. 116-93" — so the card read: the bill says "section 111 of the
    // Pub. L. 116-93". A definite article is not worth a wrong sentence on
    // every one of them.
    const named = !/^(?:Pub\. L\.|ch\.|\d)/i.test(v.act);
    const of = named ? `the ${v.act}` : v.act;
    root.appendChild(
      card(
        'Read in context',
        `The bill says “section ${v.actSection} of ${of}”. That Act's own section ` +
          `numbers are not the ones the Code uses, so ${v.act} § ${v.actSection} is ` +
          `${v.codified} — taken from the source credit the Code prints on that section ` +
          `(${v.enactedAs}).`,
        ''
      )
    );
  }
  if (res.actTitle) {
    // A title of an Act is a RANGE, so the useful answer is which sections are
    // in it — the same answer a division of a Public Law gets. The first is
    // rendered below as the provision; these are the rest, so the reader can see
    // the shape of what was cited without leaving the pane.
    const t = res.actTitle;
    const c = document.createElement('div');
    c.className = 'card';
    const h = document.createElement('h4');
    h.textContent = `${t.act}, title ${t.title} — ${t.sections.length} sections in the Code`;
    c.appendChild(h);
    const p = document.createElement('p');
    p.textContent =
      `The bill cites a title of an Act, which names a range rather than one provision. ` +
      `These are the sections the Code credits to ${t.act} title ${t.title}, taken from the ` +
      `source credit each one carries (${t.enactedAs}). The first is shown below.`;
    c.appendChild(p);
    const list = document.createElement('div');
    list.className = 'links';
    for (const s of t.sections.slice(0, 200)) {
      const el = document.createElement('span');
      el.className = 'crumb';
      el.textContent = `${s.title} U.S.C. ${s.section}`;
      list.appendChild(el);
    }
    c.appendChild(list);
    if (t.sections.length > 200) {
      const more = document.createElement('p');
      more.className = 'dim';
      more.textContent = `…and ${t.sections.length - 200} more.`;
      c.appendChild(more);
    }
    root.appendChild(c);
  }
  if (res.crumbs && res.crumbs.length) root.appendChild(crumbs(res.crumbs, res, handlers));
  if (res.also && res.also.length) root.appendChild(alternates(res, handlers));
  if (res.offsetNote) root.appendChild(card('Numbering caveat', res.offsetNote, 'warn'));
  // The Act is known by name and by nothing else. Saying so beats showing a
  // provision from an unrelated statute under "shown below is its first
  // section" — see the note in index.js.
  if (res.actNoHead) {
    root.appendChild(
      card(
        'Whole Act',
        `This names the whole law, not a single provision, and no one section of ` +
          `the U.S. Code is its head. ` +
          (res.range ? res.range.text : 'The name covers more than one Public Law.'),
        'warn',
        res.range ? res.range.link : null
      )
    );
  }
  if (res.isActStart) {
    root.appendChild(
      card(
        'Whole Act',
        `This looks like the entire law, not a single provision. Shown below is its ` +
          `first section.` + (res.range ? ` ${res.range.text}` : ''),
        '',
        res.range ? res.range.link : null
      )
    );
  }
  // "15 U.S.C. 2601 et seq." is the Toxic Substances Control Act, not § 2601.
  // The bill named a RANGE and the pane answered with one section — silently,
  // under a heading that named it alone. 2,620 citations across 28 corpus bills.
  //
  // Nothing here knows where the range stops; that is not a fact the citation
  // carries, and it is the same limit markRangeAdditions() declines on. So the
  // card states exactly what IS known — where the range begins, and that this is
  // its first section — and the crumb above it links to the chapter the section
  // sits in, which is the level a reader wanting the rest of the range actually
  // wants. Naming the chapter as though it WERE the range would be a guess.
  else if (res.isRangeStart) {
    // The CHAPTER, not the deepest crumb. An Act codified as a block is
    // normally one chapter — TSCA is chapter 53 of title 15 — where the deepest
    // level is a subchapter, which is a slice of the range rather than the range.
    // Falls back to the outermost linkable crumb where there is no chapter,
    // which is the title: wider than the range and honest about being so, and
    // the card never claims either one IS the range.
    const linkable = (res.crumbs || []).filter((c) => c.href);
    const chapter = linkable.find((c) => c.type === 'chapter') || linkable[0];
    root.appendChild(
      card(
        'A range, not one section',
        `The bill cited "${res.citation}" — that section and the ones following it, ` +
          `which is usually a whole Act. Shown below is the section the range starts ` +
          `at; nothing in the citation says where it ends.`,
        '',
        // `short` is the shard's own `num`, which ends in the separator that
        // introduces the heading — "CHAPTER 17A—". Fine inside a crumb where the
        // heading follows it; in a sentence it trails off mid-dash.
        chapter
          ? {
              label: `Read ${String(chapter.short || chapter.label).replace(/[\s—–-]+$/, '')}`,
              href: chapter.href,
            }
          : null
      )
    );
  }

  // --- U.S. Code shape: a parsed subsection tree we can navigate -----------
  if (res.tree) {
    if (res.runIn) {
      root.appendChild(
        card(
          'Read through a run-in level',
          `The bill cites ${escapeText(res.citedPath)}. This section writes ` +
            `${escapeText(res.runIn)} into its opening text rather than as a separate ` +
            `subsection, so the provision below is shown as ${escapeText(res.focusPath)}.`,
          ''
        )
      );
    }
    if (res.headLevel) {
      // A level was dropped to get here, so the pane says which and why. The
      // reader clicked a chip composed against "Section 311(d) of the …Act" and
      // is being shown 2 U.S.C. 4532(3); without this the two simply disagree
      // and the pane looks like it lost a level.
      root.appendChild(
        card(
          'One level dropped — the Act’s own numbering',
          `The instruction names ${escapeText(res.headLevel)} of the Act it amends, but the Code ` +
            `section this resolves to IS that ${escapeText(res.headLevel)} — it has no such level ` +
            `inside it. Shown at ${escapeText(res.focusPath)} instead, which is where the Code ` +
            `keeps this provision.`,
          ''
        )
      );
    }
    if (res.stub) {
      // No text at all: the section has been repealed, omitted, or moved. The
      // reason IS the answer, and where the Code names the successor it is the
      // most useful thing on the page — 42 U.S.C. 10601 is a bare "Transferred"
      // whose own note says it is now 34 U.S.C. 20101, where the provision the
      // bill cited is alive with its subparagraphs intact.
      const c = document.createElement('div');
      c.className = 'card warn';
      const h = document.createElement('h4');
      h.textContent = res.moved ? 'Moved — this section is now somewhere else' : 'No text here';
      c.appendChild(h);
      const p = document.createElement('p');
      p.textContent = res.moved
        ? `The Code prints nothing at ${res.citation} but “${res.stub}”, and says the provision was ` +
          `renumbered into ${res.moved.citation}. The bill cited the old number, so that is what is ` +
          `shown above; the text is under the new one.`
        : `The Code prints nothing at ${res.citation} but “${res.stub}”. A bill that amends it was ` +
          `written against law that has since been repealed or omitted, so there is no current text ` +
          `to show against.`;
      c.appendChild(p);
      if (res.moved) {
        const row = document.createElement('div');
        row.className = 'links';
        const a = document.createElement('a');
        a.href = res.moved.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${res.moved.citation} on Cornell LII`;
        row.appendChild(a);
        c.appendChild(row);
      }
      root.appendChild(c);
    }
    // …and not the ordinary "the bill is adding it" caveat, which is false twice
    // over about a section that has simply moved.
    if (res.focusMissing && !res.stub) {
      root.appendChild(
        card(
          'Subsection not present',
          `The bill cites ${escapeText(res.focusPath)}, but the current text of this ` +
            `section has no such subsection. That usually means the bill is adding it — ` +
            `or that the law has been edited since the bill was written, and the ` +
            `subsection it names has been renumbered or repealed.`,
          'warn'
        )
      );
    }
    const scope = handlers.scopePath ?? defaultScope(res);
    root.appendChild(ladder(res, scope, handlers));
    root.appendChild(provision(res, scope));
  }

  // --- CFR shape: one or more flat sections --------------------------------
  if (res.sections) {
    // Capped because a CFR part can run to hundreds of sections and rendering
    // all of them is slow and unreadable. It always said so; what it did not do
    // was offer any way to see the rest, which made the cap a dead end for
    // anyone who actually wanted section 51 of 200.
    const all = handlers.showAllSections || res.sections.length <= LIST_CAP;
    for (const s of all ? res.sections : res.sections.slice(0, LIST_CAP)) {
      root.appendChild(cfrSection(s, s === res.focus, res));
    }
    if (!all) {
      root.appendChild(
        truncatedCard(`Showing the first ${LIST_CAP} of ${res.sections.length} sections in this part.`,
                      res.sections.length, handlers)
      );
    }
  }

  if (res.effect) root.appendChild(effect(res.effect, handlers));
  if (res.sourceCredit) root.appendChild(sourceCredit(res.sourceCredit));
  if (res.notes && res.notes.length) root.appendChild(notesCard(res.notes));
  if (res.links && res.links.length) root.appendChild(links(res.links));
  if (res.asOf) {
    const d = document.createElement('div');
    d.className = 'asof';
    d.textContent = `${res.source} · current as of ${res.asOf}`;
    root.appendChild(d);
  }
  return root;
}

// ---------------------------------------------------------------- pieces

function head(root, res) {
  const h = document.createElement('h3');
  h.className = 'ctx-title';
  h.textContent = res.actName || res.citation;
  root.appendChild(h);
  if (res.heading || res.actName) {
    const s = document.createElement('p');
    s.className = 'ctx-sub';
    s.textContent = res.actName ? res.citation + (res.heading ? ` — ${res.heading}` : '') : res.heading;
    root.appendChild(s);
  }
}

/**
 * More than one section of the Code carries this number.
 *
 * Seven times in 60,436, two different Public Laws each added a section and the
 * OLRC prints both — two "§ 3598" in title 5, a combined range "§§ 2891, 2892"
 * in title 10. A citation to the number alone cannot say which is meant, and
 * the app used to show whichever the ingester wrote second with nothing on
 * screen to suggest the other existed.
 *
 * Named by their source credits, because that is the thing that actually tells
 * them apart — they share a number and often a subject.
 */
function alternates(res, handlers) {
  const c = document.createElement('div');
  c.className = 'card warn';
  const h = document.createElement('h4');
  h.textContent = 'This number is used more than once';
  c.appendChild(h);
  const p = document.createElement('p');
  p.textContent =
    `The Code has ${res.also.length + 1} sections numbered ${res.citation.replace(/^\d+ U\.S\.C\. /, '')}` +
    `, added by different Public Laws. The citation does not say which is meant.`;
  c.appendChild(p);
  const row = document.createElement('div');
  row.className = 'links';
  res.also.forEach((a, i) => {
    const el = document.createElement('span');
    el.className = 'crumb clickable';
    el.textContent = a.heading || a.sourceCredit || `alternative ${i + 1}`;
    el.title = a.sourceCredit || '';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    const go = () => handlers && handlers.onAlternate && handlers.onAlternate(i);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    row.appendChild(el);
  });
  c.appendChild(row);
  return c;
}

function crumbs(list, res, handlers) {
  const wrap = document.createElement('nav');
  wrap.className = 'crumbs';
  list.forEach((c, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      wrap.appendChild(sep);
    }
    // The part level is the one worth zooming out to for a CFR section, and
    // that one is handled IN the app — so it stays a span with a click handler
    // and must not become an outbound link.
    const inApp = handlers.onCrumb && c.type === 'part' && res.source === 'eCFR';
    // Every other level goes out to the Code, where the reader can actually read
    // the chapter this section sits in. The crumbs have always carried the USLM
    // identifier and rendered as inert grey text: the reader could see that
    // 7 U.S.C. 2011 is in chapter 51 and could do nothing with it. This app has
    // no whole-chapter view to offer, so "expand out" means out.
    const el = document.createElement(!inApp && c.href ? 'a' : 'span');
    el.className = 'crumb';
    el.textContent = c.label || c.short;
    if (inApp) {
      el.classList.add('clickable');
      el.title = 'Show the whole part';
      el.addEventListener('click', () => handlers.onCrumb(c));
    } else if (c.href) {
      el.classList.add('clickable');
      el.href = c.href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.title = `Read ${c.label || c.short} on the U.S. Code`;
    }
    wrap.appendChild(el);
  });
  return wrap;
}

/** Default view: the parent of the cited subsection, so siblings are visible. */
/**
 * How much of the section to open on arrival.
 *
 * The parent of the cited provision, because a subsection read without its
 * lead-in is usually meaningless — that is the whole idea of the ladder.
 *
 * But the parent of a top-level subsection is the entire section, and some
 * sections are enormous: 42 U.S.C. 603 is 86 KB across 323 nodes, so citing
 * "section 403(c) of the Social Security Act" opened all of it and left the
 * reader to find (c) themselves. Where the parent is that big, open the cited
 * provision itself instead; the ladder is one click away and the crumb above
 * says where it sits.
 *
 * Measured in characters of rendered text rather than node count, because that
 * is what the reader has to scroll past — 30 nodes of one line each is nothing,
 * and 3 nodes of a thousand words is not.
 */
const SCOPE_BUDGET = 6000;

function defaultScope(res) {
  const p = res.focusPath || '';
  const parts = p.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  const parent = parts.slice(0, -1).join('');
  if (!p || !res.tree) return parent;
  const under = parent ? findNode(res.tree, parent) : null;
  const size = parent
    ? (under ? flattenText(under).length : 0)
    : (res.lead || '').length + res.tree.reduce((n, x) => n + flattenText(x).length, 0);
  return size > SCOPE_BUDGET ? p : parent;
}

function ladder(res, scope, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'ladder';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = 'level';
  wrap.appendChild(lbl);

  const rungs = res.focusPath
    ? (res.focusPath.match(/\([A-Za-z0-9]{1,8}\)/g) || []).reduce(
        (acc, m) => [...acc, (acc[acc.length - 1] || '') + m],
        ['']
      )
    : [''];

  // The section number is read off the result, not re-derived from the display
  // citation. It used to be `citation.split(' ').pop()`, which is the section
  // number only while the citation ends in one — the moment "15 U.S.C. 2601 et
  // seq." carried its range into the heading, every one of those rungs read
  // "§ seq.". A display string is for display; the number is data, and the
  // resolver has it.
  const sectionLabel = res.section != null
    ? `§ ${res.section}`
    : `§ ${String(res.citation || '').split(' ').pop().replace(/\(.*/, '')}`;

  for (const path of rungs) {
    const b = document.createElement('button');
    b.textContent = path === '' ? sectionLabel : path;
    b.title = path === '' ? 'Whole section' : `Scope to ${path}`;
    if (path === scope) b.classList.add('on');
    b.addEventListener('click', () => handlers.onScope(path));
    wrap.appendChild(b);
  }
  return wrap;
}

function provision(res, scope) {
  const box = document.createElement('div');
  box.className = 'prov';

  const nodes = scope ? (findNode(res.tree, scope)?.children ?? res.tree) : res.tree;
  const scopeNode = scope ? findNode(res.tree, scope) : null;

  const red = res.effect ? res.effect.redline : null;

  // A rewrite of the WHOLE section has no node to mark — the section itself is
  // not one — so it is stated at the top of the provision instead. "Section 45Q
  // is amended to read as follows: ``SEC. 45Q. CREDIT FOR CARBON OXIDE
  // SEQUESTRATION.…''" replaces everything below, and marking one subsection
  // would say something narrower than the bill does. 134 across the corpus.
  const wholeRewrite = red && red.wholeSectionRewrite ? red.wholeSectionRewrite() : null;
  if (wholeRewrite) {
    const c = document.createElement('div');
    c.className = 'card warn';
    const h = document.createElement('h4');
    h.textContent = wholeRewrite.inLaw
      ? 'Already reads this way — this is the rewrite the bill makes'
      : 'This bill rewrites this section in full';
    c.appendChild(h);
    const p = document.createElement('p');
    p.textContent = wholeRewrite.inLaw
      ? 'Everything below is the text this bill substituted for the section that was here.'
      : 'The bill replaces this section end to end. What follows is the section as it stands; the replacement is listed under the amendment below.';
    c.appendChild(p);
    box.appendChild(c);
  }

  // The section's own lead-in sits above every subsection, so it goes first and
  // outside the ancestor ladder. Undivided sections carry all of their text
  // here and would otherwise render as a blank pane.
  if (res.lead) {
    const p = document.createElement('div');
    p.className = 'node lead-in';
    const body = document.createElement('span');
    body.className = 'body';
    appendMarked(body, res.lead, red, '');
    p.appendChild(body);
    box.appendChild(p);
  }

  // Show the lead-in text of every ancestor above the scope — this is the
  // "going up sub-levels" payload; a subsection is meaningless without it.
  const above = scope ? pathChain(res.tree, scope) : [];
  for (const a of above) {
    const p = document.createElement('div');
    p.className = 'node on-path';
    // The cited provision can render here rather than through nodeEl: when the
    // scope IS the focus, the focus heads the ancestor ladder and its children
    // are the body. It still needs the anchor, or the pane has nothing to
    // scroll to.
    if (a.path === res.focusPath && !document.getElementById('ctx-focus')) p.id = 'ctx-focus';
    const body = document.createElement('span');
    body.className = 'body';
    const mk = document.createElement('span');
    mk.className = 'marker';
    mk.textContent = a.marker;
    body.appendChild(mk);
    if (a.heading) {
      const hd = document.createElement('span');
      hd.className = 'nodehead';
      hd.textContent = a.heading;
      body.appendChild(hd);
    }
    // An ancestor with neither lead-in nor heading is a bare container; the
    // ellipsis keeps the ladder visible rather than rendering an empty row.
    appendMarked(body, a.text || (a.heading ? '' : '…'), red, a.path);
    p.appendChild(body);
    box.appendChild(p);
  }

  const container = above.length ? indent(box) : box;
  for (const n of nodes) container.appendChild(nodeEl(n, res.focusPath, red));
  if (scopeNode && !nodes.length && scopeNode.text) {
    // A leaf scope renders its own text and nothing else — and it is the most
    // likely thing to be under an amendment, so it must be redlined too.
    appendMarked(container, scopeNode.text, red, scopeNode.path);
  }
  // A new subsection is a sibling of (a)–(e), so it follows the whole provision
  // rather than any node within it. Same for an addition whose scope the walk
  // never narrowed — it goes where the instruction's target ends.
  appendAdditions(container, red, '');
  return box;
}

function indent(parent) {
  const d = document.createElement('div');
  d.className = 'kids';
  parent.appendChild(d);
  return d;
}

/**
 * A node and everything under it, as the bill would have written it.
 *
 * The heading goes back inline with its `.--` separator, because that is how a
 * bill writes a provision and how the block being compared against it reads —
 * the Code stores the two apart. Worth only a point or so on the match either
 * way, which is worth knowing: the heading was written down as the obstacle to
 * telling an enacted rewrite from a pending one and it never was.
 */
export function subtreeText(node) {
  const parts = [];
  const walk = (n) => {
    parts.push(`${n.marker || ''} ${n.heading ? `${n.heading}.--` : ''}${n.text || ''}`.trim());
    (n.children || []).forEach(walk);
  };
  walk(node);
  return parts.join('\n');
}

function nodeEl(node, focusPath, red) {
  const el = document.createElement('div');
  el.className = 'node';
  if (focusPath) {
    // The id the pane scrolls to. Only the focused node gets one, and only
    // once — nodeEl runs for every node in the tree.
    if (node.path === focusPath && !document.getElementById('ctx-focus')) el.id = 'ctx-focus';
    if (node.path === focusPath) el.classList.add('focus');
    else if (focusPath.startsWith(node.path)) el.classList.add('on-path');
    else if (!node.path.startsWith(focusPath)) el.classList.add('dimmed');
  }
  const body = document.createElement('span');
  body.className = 'body';
  if (node.marker) {
    const mk = document.createElement('span');
    mk.className = 'marker';
    mk.textContent = node.marker;
    body.appendChild(mk);
  }
  // USLM carries a separate <heading> for many subsections ("Findings",
  // "Definitions"). It's the fastest way to orient in a long section, so it
  // leads the body rather than being dropped.
  if (node.heading) {
    const hd = document.createElement('span');
    hd.className = 'nodehead';
    hd.textContent = node.heading;
    body.appendChild(hd);
  }
  // A provision this bill adds that the law already contains. There is nothing
  // to draw into it — drawing it would show the provision twice, once coloured
  // as new — but leaving it unmarked is why an enacted bill looked like it did
  // nothing: the reader sees the provision and has no way to tell it apart from
  // law that predates it.
  //
  // The label says what is KNOWN and stops short of WHY. "Added by this bill"
  // is an attribution, and nothing here establishes it: the evidence is only
  // that the law contains the language. On an enacted bill the inference is
  // usually sound; on a pending one it is false by construction, and nothing
  // here can tell the two apart. Measured on a seeded sample of 14 introduced
  // and reported bills — 13 marks, every one attributing a provision to a bill
  // that never passed. 40 U.S.C. 15301(a)(5), "The Mid-Atlantic Regional
  // Commission", is in the Code and S. 3891 of the 118th Congress is not the
  // law that put it there. The comment fifteen lines below already refuses to
  // colour a whole-provision rewrite for exactly this reason; this is the same
  // refusal, one claim smaller.
  if (red && red.appliedNodePaths && red.appliedNodePaths().has(node.path)) {
    el.classList.add('was-added');
    el.title = 'Already in the law — this is the language the bill adds here';
  }
  // …and a provision this bill rewrites from end to end. Deliberately a mark and
  // not a diff: for a pending bill the text below is what the provision says
  // today and for an enacted one it is what the bill made it say, and nothing
  // here can tell those apart reliably enough to colour a whole provision either
  // way. The panel prints the new language beside it. See replacedAt().
  // The node's OWN subtree is the haystack, not the whole provision: the
  // question is whether this passage reads the new way, and asking the section
  // answers a laxer one. See replacedAt().
  const rep = red && red.replacedAt ? red.replacedAt(node.path, subtreeText(node)) : null;
  if (rep) {
    el.classList.add('replaced');
    if (rep.inLaw) el.classList.add('in-force');
    el.title = rep.inLaw
      ? 'Already reads this way — this is the rewrite the bill makes'
      : 'This bill rewrites this provision in full';
  }
  appendMarked(body, node.text, red, node.path);
  el.appendChild(body);
  if (node.children.length) {
    const kids = document.createElement('div');
    kids.className = 'kids';
    for (const c of node.children) kids.appendChild(nodeEl(c, focusPath, red));
    el.appendChild(kids);
  }
  // "by adding at the end the following" — after the last child, which is where
  // the bill puts it. Done here rather than inside appendMarked because a new
  // subparagraph (D) follows (A), (B) and (C); woven into the parent's own text
  // it would sit above them, ahead of the siblings it is written to follow.
  appendAdditions(el, red, node.path);
  return el;
}

/**
 * New provisions this amendment adds at the end of `path`.
 *
 * Rendered as whole nodes in the insertion colour rather than as a run of
 * inserted words, because that is what they are: language that does not replace
 * or interrupt anything, but follows the last provision at this level.
 */
function appendAdditions(parent, red, path) {
  if (!red || !red.additionsAt) return;
  for (const op of red.additionsAt(path)) {
    const d = document.createElement('div');
    d.className = 'node added';
    const s = document.createElement('span');
    s.className = 'ins';
    s.title = 'Language this bill adds at the end';
    // The block is quoted and wrapped to the bill's measure, and it opens each
    // of its paragraphs with a quote mark that belongs to the bill's
    // typesetting, not to the law being written. Strip those and keep the line
    // structure, which is the outline of the new provision.
    s.textContent = String(op.text)
      .split('\n')
      .map((l) => l.replace(/^\s*(?:``|‘‘|["“])/, '').trimEnd())
      .join('\n')
      .trim();
    d.appendChild(s);
    parent.appendChild(d);
  }
}

/**
 * Append a passage of the law, with the amendment's marks in place.
 *
 * Without an amendment in hand this is a plain text node — the overwhelmingly
 * common case, and it must stay cheap.
 */
function appendMarked(parent, text, red, path) {
  if (!red || !text) {
    parent.appendChild(document.createTextNode(text || ''));
    return;
  }
  for (const seg of red.apply(text, path || '')) {
    if (seg.type === 'keep') {
      parent.appendChild(document.createTextNode(seg.text));
      continue;
    }
    const s = document.createElement('span');
    // Three claims, not two. `was` is language the bill inserted that the law
    // already contains — the amendment has happened — so it is coloured as the
    // bill's work but must not read as a pending change the way `ins` does.
    s.className = seg.type === 'ins' ? 'ins' : seg.type === 'was' ? 'was-ins' : 'del';
    s.title =
      seg.type === 'ins'
        ? 'Language this bill inserts'
        : seg.type === 'was'
        ? 'Already in the law — this is the language the bill adds here'
        : 'Language this bill strikes';
    s.textContent = seg.text;
    parent.appendChild(s);
  }
}

/**
 * How many entries a list in this pane shows before it offers the rest.
 *
 * A CFR part can run to hundreds of sections and a Public Law to over a
 * thousand, and rendering them all is slow and unreadable — the Consolidated
 * Appropriations Act, 2018's contents came to 200 chips and 5,660 pixels, some
 * forty-six screens of them, sitting between the reader and the "Read elsewhere"
 * links below. Found by looking at it; nothing linkedom can check, because a
 * height is layout.
 */
const LIST_CAP = 40;

/**
 * "Showing the first N of M", with a control that shows the rest.
 *
 * A cap that cannot be lifted is a dead end for anyone who wanted entry 51 of
 * 200, which is why this exists at all — see TODO 8. Shared by the CFR part view
 * and the Public Law contents, because a reader meeting one has met the other.
 */
function truncatedCard(message, total, handlers) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = 'Truncated';
  c.appendChild(h);
  const p = document.createElement('p');
  p.textContent = message;
  c.appendChild(p);
  if (handlers.onShowAll) {
    const row = document.createElement('div');
    row.className = 'links';
    const b = document.createElement('span');
    b.className = 'crumb clickable';
    b.textContent = `Show all ${total}`;
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    const go = () => handlers.onShowAll();
    b.addEventListener('click', go);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    row.appendChild(b);
    c.appendChild(row);
  }
  return c;
}

function cfrSection(s, isFocus, res) {
  const wrap = document.createElement('div');
  wrap.className = 'prov';
  const h = document.createElement('div');
  h.className = 'sechead';
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = `§ ${s.number}`;
  h.appendChild(n);
  h.appendChild(document.createTextNode(s.heading));
  if (isFocus) h.id = 'ctx-focus';
  wrap.appendChild(h);
  const red = isFocus && res.effect ? res.effect.redline : null;
  for (const node of s.tree.length ? s.tree : []) wrap.appendChild(nodeEl(node, isFocus ? res.focusPath : '', red));
  if (!s.tree.length) {
    for (const p of s.paragraphs) {
      const d = document.createElement('div');
      d.className = 'node';
      appendMarked(d, p, red, '');
      wrap.appendChild(d);
    }
  }
  return wrap;
}

/** Amendment preview: does the struck language actually appear in current text? */
/**
 * The scope that makes an addition visible.
 *
 * An op scoped to "(a)(3)" is drawn by the node whose own path is "(a)(3)",
 * and that node is only laid out by nodeEl() when the pane is scoped to its
 * parent — scope "(a)". Scoping straight to "(a)(3)" renders its *children*
 * and puts the node itself in the ancestor ladder, which draws no additions.
 *
 * Returns null when there is nothing to widen to, so the caller offers no
 * control rather than one that changes nothing.
 */
function widenTarget(scope) {
  const marks = String(scope || '').match(/\([A-Za-z0-9]{1,8}\)/g);
  if (!marks || !marks.length) return null;
  return marks.slice(0, -1).join('');
}

function effect(eff, handlers) {
  const c = document.createElement('div');
  c.className = 'card effect';
  const h = document.createElement('h4');
  h.textContent = 'What this amendment does';
  c.appendChild(h);

  for (const op of eff.ops) {
    const row = document.createElement('div');
    row.className = 'op-row';
    const kind = document.createElement('span');
    const k = op.type === 'strike' ? 'strike' : op.type === 'insert' ? 'insert' : 'other';
    kind.className = `op-kind ${k}`;
    kind.textContent = op.type;
    row.appendChild(kind);

    const t = document.createElement('span');
    t.className = `op-text${op.type === 'strike' ? ' struck' : op.type === 'insert' ? ' added' : ''}`;
    // Quoted operands wrap to the bill's measure; the line break is typesetting,
    // not language, and left in it opens a gap across the panel.
    const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    if (op.type === 'redesignate') t.textContent = `${flat(op.from)} → ${flat(op.to)}`;
    else if (op.type === 'add-at-end') {
      // The language itself, where the block could be delimited. A long added
      // provision is drawn in full above; here it only has to be recognisable,
      // and the opening words are what identify it.
      t.className = 'op-text added';
      const words = flat(op.text);
      t.textContent = words
        ? `at the end: “${words.length > 120 ? `${words.slice(0, 120)}…` : words}”`
        : 'adds new language at the end';
    } else if (op.type === 'replace') {
      // The whole provision, rewritten. The opening words are what let a reader
      // recognise it against the text above; the rest is on screen already if
      // the bill is enacted, and is what the provision will say if it is not.
      t.className = 'op-text added';
      const words = flat(op.text);
      t.textContent = `rewritten to read: “${words.length > 140 ? `${words.slice(0, 140)}…` : words}”`;
    } else if (op.type === 'repeal') t.textContent = 'the provision is repealed in full';
    else t.textContent = `“${flat(op.text)}”`;
    row.appendChild(t);

    // Whether the change is drawn into the law above, or only listed here. An
    // operation the redline could not place is the one the reader most needs
    // flagged — it is the case where the panel and the provision disagree.
    const shown = eff.redline ? eff.redline.placed().some((p) => p.start === op.start) : false;
    // The instruction stepped into a different section to make this change —
    // "in section 293 (42 U.S.C. 293)--" — so it is not a change to the
    // provision on screen at all, and drawing it here marked words the bill
    // never mentions. Asked before `shown`, because a refusal that reads as a
    // placement is the worst of the three outcomes — and before `lost`, because
    // an address naming nothing in THIS provision is unsurprising when the bill
    // was addressing a different one, and reporting the level would send the
    // reader hunting for a drafting error that is not there.
    const away = eff.redline && eff.redline.elsewhere
      ? eff.redline.elsewhere().find((p) => p.start === op.start)
      : null;
    if (away) {
      const f = document.createElement('span');
      f.className = 'notfound';
      f.textContent = `⚠ this change is to ${away.otherSection}, not to the provision shown`;
      row.appendChild(f);
      c.appendChild(row);
      continue;
    }
    // The bill names a level this provision does not have. Almost always the
    // bill's own slip — the Fiscal Responsibility Act cites "7 U.S.C.
    // 2015(6)(o)(3)" for 2015(o)(3) — and it is the one outcome the reader most
    // needs told, because the instruction plainly changes something and the
    // page would otherwise be silent about it.
    const lost = eff.redline && eff.redline.lostScope
      ? eff.redline.lostScope().find((p) => p.start === op.start)
      : null;
    if (lost) {
      const f = document.createElement('span');
      f.className = 'notfound';
      f.textContent = `⚠ the bill addresses ${lost.scopeLost}, which is not in this provision`;
      row.appendChild(f);
      c.appendChild(row);
      continue;
    }
    if (shown) {
      const f = document.createElement('span');
      f.className = 'found';
      // "Shown above" and "already in force" are both true of an enacted
      // insertion, and only the second tells the reader that the words in front
      // of them are law rather than a proposal.
      const enacted = eff.redline && eff.redline.enactedInserts
        ? eff.redline.enactedInserts().some((p) => p.start === op.start)
        : false;
      f.textContent = enacted
        ? '✓ already in the law — marked above'
        : op.type === 'strike'
        ? '✓ struck above'
        : op.type === 'replace'
        // No coloured text is drawn for a replacement — the provision is marked
        // as rewritten — so "shown above" would send the reader looking for
        // green that is not there. Same trap the `rangeSkip` note describes.
        // And whether the rewrite has already happened is the fact that decides
        // what the reader is looking at: the provision as it stands, or the
        // provision as this bill made it.
        ? (op.inLaw
            ? '✓ the provision above already reads as the rewrite'
            : '✓ the provision is marked above')
        : '✓ shown above';
      row.appendChild(f);
    } else if (op.type === 'strike') {
      const f = document.createElement('span');
      // "Not found" and "already gone" look identical to a matcher and mean
      // opposite things to a reader. Where the rest of this amendment is
      // already in the law, language it strikes being absent is the amendment
      // having *worked*, and flagging it warns about the one thing that went
      // right.
      const enacted =
        eff.redline &&
        ((eff.redline.appliedAdditions && eff.redline.appliedAdditions().length > 0) ||
          (eff.redline.isStale && eff.redline.isStale()));
      if (op.found) { f.className = 'found'; f.textContent = '✓ found in current text'; }
      else if (enacted) { f.className = 'found'; f.textContent = '✓ already struck from the law'; }
      else { f.className = 'notfound'; f.textContent = '⚠ not found verbatim'; }
      row.appendChild(f);
    } else if (op.type === 'insert' && op.placement !== 'after-unit') {
      // Two different reasons, and saying the wrong one is worse than saying
      // nothing: the bill may not have stated a position at all, or it may have
      // stated one whose anchor text is no longer in the provision.
      const f = document.createElement('span');
      f.className = 'notfound';
      f.textContent =
        op.replaces != null || op.anchor ? '⚠ anchor text not found' : '⚠ position not stated';
      row.appendChild(f);
    } else if (op.type === 'replace') {
      // A replacement matched NONE of the arms above, so it printed its language
      // and then said nothing at all about whether the reader would find it —
      // no status, and none of the widen control an addition gets. 119 of them
      // in the default view.
      const f = document.createElement('span');
      if (op.headingOnly) {
        // Refused, and the honest sentence is available from the same
        // instruction that refused it. The bill renames the provision; it does
        // not touch a word of its text, and a card claiming a 5,808-character
        // section was "replaced end to end" over a 95-character caption is the
        // worst kind of wrong this pane can be.
        f.className = 'found';
        f.textContent = '✓ rewrites this provision’s heading, not its text';
      } else if (op.newSection) {
        // Refused, and for the reason the reader needs: the quoted block is a
        // whole section (or a PART heading), which cannot be the text of a
        // subparagraph whatever instruction it was read out of. Saying
        // "rewrites (a)(2)(B), which is not shown here" would blame the pane
        // for a block that does not belong to this provision at all.
        f.className = 'notfound';
        f.textContent = '⚠ the language quoted here is a whole section, not part of this provision';
      } else {
        f.className = 'notfound';
        f.textContent = op.scope
          ? `⚠ rewrites ${op.scope}, which is not shown here`
          : '⚠ the provision it rewrites is not shown here';
      }
      row.appendChild(f);
      c.appendChild(row);
      continue;
    } else if (op.type === 'add-at-end' || op.placement === 'after-unit') {
      // Three reasons an addition isn't drawn, and they mean opposite things.
      // Already in the law is the bill having *succeeded*; the reader should not
      // go hunting for green text, nor conclude the change was missed.
      const applied = eff.redline ? eff.redline.appliedAdditions() : [];
      const f = document.createElement('span');
      if (op.rangeEnd) {
        // Not a failure to place it — a refusal. The bill cited the Act as a
        // range and adds at the end of the Act; this pane holds the one section
        // the range begins at, which is where the addition used to be drawn.
        f.className = 'notfound';
        f.textContent = '⚠ added at the end of the Act, not of this section';
        row.appendChild(f);
        c.appendChild(row);
        continue;
      }
      if (op.newSection) {
        // The same refusal, reached from the block's own first line rather than
        // from the target: "SEC. 45S." is a whole new section of the law, and a
        // section is never part of another section. It used to be drawn inside
        // whatever subsection the instruction had walked to.
        f.className = 'notfound';
        f.textContent = '⚠ adds a whole new section, not part of this one';
        row.appendChild(f);
        c.appendChild(row);
        continue;
      }
      if (applied.some((p) => p.start === op.start)) {
        f.className = 'found';
        f.textContent = '✓ already in the law as it stands';
      } else if (!op.text) {
        f.className = 'notfound';
        f.textContent = '⚠ added language not delimited';
      } else {
        f.className = 'notfound';
        f.textContent = '⚠ the provision it follows is not shown';
        row.appendChild(f);
        // Not a dead end. The addition knows exactly which provision it
        // follows; the pane is simply scoped somewhere else. Widening to that
        // provision's PARENT is what draws it — the scope node itself renders
        // through the ancestor ladder, which lays out no children and so never
        // asks additionsAt() for anything.
        const widen = widenTarget(op.scope);
        if (widen !== null && handlers && handlers.onScope) {
          const b = document.createElement('span');
          b.className = 'crumb clickable';
          b.textContent = op.scope ? `Show ${op.scope}` : 'Show the whole section';
          b.setAttribute('role', 'button');
          b.tabIndex = 0;
          const go = () => handlers.onScope(widen);
          b.addEventListener('click', go);
          b.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
          });
          row.appendChild(b);
        }
        c.appendChild(row);
        continue;
      }
      row.appendChild(f);
    }
    c.appendChild(row);
  }

  const stranded = eff.redline ? eff.redline.unplaced().filter((o) => o.type === 'insert') : [];
  if (stranded.length) {
    const anchored = stranded.filter((o) => o.replaces != null || o.anchor).length;
    const loose = stranded.length - anchored;
    const parts = [];
    if (loose) {
      parts.push(
        `${loose === 1 ? 'One gives' : `${loose} give`} the new language without saying where it goes ` +
          `(a position described in words rather than quoted)`
      );
    }
    if (anchored) {
      parts.push(
        `${anchored === 1 ? 'one names' : `${anchored} name`} a position whose text isn't in the provision ` +
          `as it now stands — usually because the law has been amended since, or because the instruction ` +
          `targets a different subsection than the one shown`
      );
    }
    const p = document.createElement('p');
    p.className = 'dim';
    p.style.marginTop = '8px';
    p.textContent =
      `${stranded.length === 1 ? 'One insertion is' : `${stranded.length} insertions are`} listed above but ` +
      `not drawn into the text: ${parts.join('; and ')}.`;
    c.appendChild(p);
  }

  // `unmatched` only asks whether every operand is present in the provision, so
  // it is true of an ENACTED amendment by definition — the struck words are
  // gone, which is the amendment having worked. Printing the caveat anyway put
  // "usually means the amendment targets a different subsection than the one
  // shown" directly beneath "✓ already struck from the law" and "✓ already in
  // the law as it stands", contradicting both ticks the reader had just read and
  // casting doubt on the one thing that went right.
  //
  // Suppressed on the same evidence those ticks are drawn from, so the three can
  // never disagree.
  const enacted =
    eff.redline &&
    ((eff.redline.appliedAdditions && eff.redline.appliedAdditions().length > 0) ||
      (eff.redline.isStale && eff.redline.isStale()));
  if (eff.unmatched && !enacted) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.style.marginTop = '8px';
    p.textContent =
      'Struck language not found verbatim usually means the amendment targets a ' +
      'different subsection than the one shown, or the text has since changed.';
    c.appendChild(p);
  }
  return c;
}

/**
 * The Code's provenance line, read rather than dumped.
 *
 * A source credit is one long parenthetical naming the act that enacted the
 * section and then every act that has amended it since, separated by
 * semicolons. On a heavily-amended provision that is a wall: 42 U.S.C. 603
 * carries 2,660 characters in 33 clauses, and printed as one paragraph it is
 * genuinely unreadable — a reader who scrolls into the middle of it sees
 * ")(A), (B), (2)(V), June 18, 2008, 122 Stat. 1664" and cannot tell what it is
 * supposed to mean.
 *
 * The information is worth keeping; the presentation was not. Two facts carry
 * almost all of the value — what enacted this provision, and when it was last
 * touched — so those are stated in words, and the other thirty-one clauses go
 * behind a count for anyone tracing a particular amendment.
 */
function sourceCredit(credit) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = 'Where this provision comes from';
  c.appendChild(h);

  const parsed = parseCredit(credit);
  const p = document.createElement('p');
  p.textContent = parsed.summary;
  c.appendChild(p);

  if (parsed.amendments.length) {
    const row = document.createElement('div');
    row.className = 'links';
    const b = document.createElement('span');
    b.className = 'crumb clickable';
    b.textContent = `All ${parsed.amendments.length} amendments`;
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    const list = document.createElement('div');
    list.className = 'credit-list';
    list.hidden = true;
    for (const a of parsed.amendments) {
      const li = document.createElement('div');
      li.textContent = a;
      list.appendChild(li);
    }
    const toggle = () => {
      list.hidden = !list.hidden;
      b.textContent = list.hidden ? `All ${parsed.amendments.length} amendments` : 'Hide amendments';
    };
    b.addEventListener('click', toggle);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    row.appendChild(b);
    c.appendChild(row);
    c.appendChild(list);
  }
  return c;
}

/** A date at the end of a credit clause: "Aug. 22, 1996". */
const RE_CREDIT_DATE = /([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/g;
const RE_CREDIT_LAW = /(Pub\. L\. \d+[–—-]\d+|[A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4},\s+ch\.\s+\d+[A-Za-z]?)/;

/**
 * Split a credit into the act that enacted the provision and the acts that
 * amended it.
 *
 * Only the first clause is the enacting one — the same rule the Act index is
 * built on, and for the same reason: what follows a semicolon is a later
 * amending act, and reading those as the origin attributes a section to
 * whichever law last touched it.
 */
function parseCredit(credit) {
  const body = String(credit || '').trim().replace(/^\(/, '').replace(/\)$/, '');
  const clauses = body.split(';').map((s) => s.trim()).filter(Boolean);
  if (!clauses.length) return { summary: String(credit || ''), amendments: [] };

  const first = clauses[0];
  const enacted = (RE_CREDIT_LAW.exec(first) || [])[1];
  // "§ 2[7]" is the Code's way of writing the Act's own section 7 inside
  // section 2 of the enacting law. The bracketed number is the one a reader
  // recognises — it is what the Act calls itself and what a bill cites.
  const secm = /§+\s*([0-9][0-9A-Za-z.\-–—]*)(?:\[([^\]]+)\])?/.exec(first);
  const sec = secm ? secm[2] || secm[1] : undefined;
  const added = /as added\s+(Pub\. L\. \d+[–—-]\d+)/.exec(first);

  const amendments = clauses.slice(1).map((s) => s.replace(/^amended\s+/, ''));
  const last = amendments[amendments.length - 1] || '';
  const lastLaw = (RE_CREDIT_LAW.exec(last) || [])[1];
  const dates = last.match(RE_CREDIT_DATE);
  const lastDate = dates ? dates[dates.length - 1] : null;

  const parts = [];
  if (enacted) parts.push(`Enacted by ${enacted}${sec ? `, § ${sec}` : ''}`);
  else parts.push(first);
  if (added) parts.push(`added by ${added[1]}`);
  if (amendments.length === 1) {
    parts.push(`amended once${lastLaw ? ` by ${lastLaw}` : ''}${lastDate ? ` (${lastDate})` : ''}`);
  } else if (amendments.length > 1) {
    parts.push(
      `amended ${amendments.length} times, most recently${lastLaw ? ` by ${lastLaw}` : ''}` +
        `${lastDate ? ` (${lastDate})` : ''}`
    );
  }
  return { summary: `${parts.join('; ')}.`, amendments };
}

/**
 * USLM's `topic` attribute, for the notes that have no heading of their own.
 *
 * These are XML identifiers, and they were being printed at the reader
 * verbatim: "effectiveDateOfAmendment: Amendment by Pub. L. 113-128…",
 * "referencesInText: …", "historicalAndRevision: …". A label is supposed to
 * tell someone what they are looking at, and a camelCase attribute name tells
 * them what schema it came out of.
 *
 * Only a fallback. A note's own <heading> is better than any of these — it says
 * "Effective Date of 2014 Amendment" where the topic says
 * "effectiveDateOfAmendment" — so it wins whenever there is one.
 */
const NOTE_TOPICS = {
  amendments: 'Amendments',
  changeOfName: 'Change of name',
  codification: 'Codification',
  editorialNotes: 'Editorial note',
  effectiveDate: 'Effective date',
  effectiveDateOfAmendment: 'Effective date of amendment',
  execDoc: 'Executive document',
  executiveOrder: 'Executive order',
  historicalAndRevision: 'Historical and revision notes',
  miscellaneous: 'Note',
  priorProvisions: 'Prior provisions',
  prospectiveAmendment: 'Prospective amendment',
  referencesInText: 'References in text',
  removalDescription: 'Removal',
  repeals: 'Repeals',
  savings: 'Savings provision',
  shortTitle: 'Short title',
  shortTitleOfAmendment: 'Short title of amendment',
  statutoryNotes: 'Statutory note',
  transferOfFunctions: 'Transfer of functions',
};

/** Last resort: split a camelCase identifier into words. */
function humanTopic(topic) {
  const t = String(topic || '').trim();
  if (!t || t === 'note') return 'Note';
  if (NOTE_TOPICS[t]) return NOTE_TOPICS[t];
  const words = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function notesCard(notes) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = `Notes (${notes.length})`;
  c.appendChild(h);
  for (const n of notes.slice(0, 6)) {
    if (typeof n === 'string') {
      const p = document.createElement('p');
      p.textContent = n;
      c.appendChild(p);
      continue;
    }
    const wrap = document.createElement('div');
    wrap.className = 'note';
    const label = document.createElement('span');
    label.className = 'notehead';
    // The note's own heading first: it is written for a reader and is specific
    // to this note ("Effective Date of 2014 Amendment"), where the topic is a
    // category shared by thousands.
    label.textContent = n.heading || humanTopic(n.topic);
    wrap.appendChild(label);
    const p = document.createElement('p');
    p.textContent = n.text || '';
    wrap.appendChild(p);
    c.appendChild(wrap);
  }
  return c;
}

function links(list) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = 'Read elsewhere';
  c.appendChild(h);
  const row = document.createElement('div');
  row.className = 'links';
  for (const l of list) {
    const a = document.createElement('a');
    a.href = l.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = l.label;
    row.appendChild(a);
  }
  c.appendChild(row);
  return c;
}

/**
 * @param {object} [link] optional {label, href}, appended INSIDE the note's own
 *   sentence rather than in the "Read elsewhere" row below it. A note that ends
 *   "here's the link" has to be followed by the link, not by a paragraph break
 *   and a heading.
 */
function card(title, body, cls, link) {
  const c = document.createElement('div');
  c.className = `card ${cls}`.trim();
  const h = document.createElement('h4');
  h.textContent = title;
  c.appendChild(h);
  const p = document.createElement('p');
  p.textContent = body;
  if (link) {
    p.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = link.label;
    p.appendChild(a);
  }
  c.appendChild(p);
  return c;
}

function missingCard(root, res, handlers) {
  head(root, res);
  const c = document.createElement('div');
  c.className = 'card warn';
  const h = document.createElement('h4');
  h.textContent = 'Not available locally';
  c.appendChild(h);
  const p = document.createElement('p');
  p.textContent = res.reason;
  c.appendChild(p);
  if (res.remedy) {
    const p2 = document.createElement('p');
    p2.textContent = 'Ingest it with:';
    c.appendChild(p2);
    const code = document.createElement('div');
    code.className = 'remedy';
    code.textContent = res.remedy;
    c.appendChild(code);
  }
  root.appendChild(c);
  if (res.links) root.appendChild(links(res.links));
  void handlers;
  return root;
}

/**
 * A Public Law, from the text we hold rather than the Code.
 *
 * Two shapes: a whole law, which gets its table of contents, and a section,
 * which gets its text. A section number is not unique in a Public Law — every
 * division of an appropriations act restarts at 101, so "section 101 of Public
 * Law 116-6" names six different provisions — so `entries` is a list and all of
 * them are shown, each under the division it belongs to. Picking one would be a
 * confident answer to a question the citation does not settle.
 */
/**
 * One section of a Public Law, with its outline drawn.
 *
 * `data/plaw` stores a section as the law prints it — hard-wrapped at 72
 * columns, indented by depth, one string — and putting that string in one
 * element rendered Pub. L. 117-2 § 2001 as 14,852 characters of solid text. The
 * Code's sections arrive from USLM already nested, so `nodeEl` has always had a
 * tree to draw; `parseProvision` gives a Public Law the same one, off the only
 * structure its text carries. The wrap's line breaks and indents go with it —
 * see joinLines() — because they are an artifact of the measure and not the
 * drafter's typography.
 */
function provisionBox(e, withNumber, hideAncestors) {
  const box = document.createElement('div');
  box.className = 'prov';
  if (!hideAncestors && e.ancestors && e.ancestors.length) {
    const where = document.createElement('p');
    where.className = 'ctx-sub';
    where.textContent = e.ancestors.join('  ›  ');
    box.appendChild(where);
  }
  // The section head — "SEC. 4. STATEMENT OF APPROPRIATIONS." — is stripped from
  // the text by parseProvision because it is the entry's own heading, so it has
  // to be drawn or it is simply lost.
  //
  // Except on a run-in section, where the heading IS the provision's first
  // sentence: an appropriations act writes "Sec. 505. Except as otherwise
  // provided…" with no heading to have, and printing it above the text would
  // show the same words twice.
  if (!e.runIn && (e.heading || (withNumber && e.num))) {
    const h = document.createElement('p');
    h.className = 'sec-head';
    h.textContent = `${withNumber && e.num ? `Sec. ${e.num}. ` : ''}${e.heading || ''}`.trim();
    box.appendChild(h);
  }
  const nodes = parseProvision(e.text);
  if (nodes.length) for (const n of nodes) box.appendChild(nodeEl(n, null, null));
  else {
    const body = document.createElement('div');
    body.className = 'node';
    const span = document.createElement('span');
    span.className = 'body';
    span.textContent = e.text;
    body.appendChild(span);
    box.appendChild(body);
  }
  return box;
}

function tocCard(plaw, title, entries) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = title;
  c.appendChild(h);
  const list = document.createElement('div');
  list.className = 'links';
  for (const t of entries.slice(0, 200)) {
    const s = document.createElement('span');
    s.className = 'crumb';
    s.textContent = `Sec. ${t.num}. ${t.heading}`.slice(0, 90);
    list.appendChild(s);
  }
  c.appendChild(list);
  if (entries.length > 200) {
    const more = document.createElement('p');
    more.className = 'dim';
    more.textContent = `…and ${entries.length - 200} more.`;
    c.appendChild(more);
  }
  void plaw;
  return c;
}

function plawCard(root, res, handlers) {
  head(root, res);

  // This text is a snapshot of the day the law passed and is never updated.
  // Where the Code could have answered it already has — index.js prefers it —
  // so reaching here means either the section was never codified or it was
  // codified somewhere the credits do not say. Either way the reader has to
  // know they are looking at history.
  const warn = document.createElement('div');
  warn.className = 'card warn';
  const wh = document.createElement('h4');
  wh.textContent = 'As enacted';
  warn.appendChild(wh);
  const wp = document.createElement('p');
  wp.textContent =
    `${res.plaw.name || res.plaw.law} as it was passed. This is not updated for later ` +
    `amendments — where a section of this law was codified, the U.S. Code is shown instead.`;
  warn.appendChild(wp);
  root.appendChild(warn);

  if (res.plaw.entries && res.plaw.entries.length) {
    // Two different messages, and telling them apart is the whole point. A law
    // numbers its sections per division, so several provisions share a number —
    // but a citation that names the division has *resolved* that, and reporting
    // it as ambiguous discards the half of the address the drafter supplied.
    if (res.plaw.narrowedBy) {
      root.appendChild(
        card(
          'Narrowed by the citation',
          `This law has ${res.plaw.of} sections numbered ${res.plaw.number}. The citation ` +
            `names ${res.plaw.narrowedBy}, which leaves ` +
            `${res.plaw.entries.length === 1 ? 'the one below' : `the ${res.plaw.entries.length} below`}.`
        )
      );
    } else if (res.plaw.entries.length > 1) {
      root.appendChild(
        card(
          'More than one',
          `This law has ${res.plaw.entries.length} sections numbered ${res.plaw.number} — ` +
            `one in each of the divisions below. The citation does not say which.`,
          'warn'
        )
      );
    }
    for (const e of res.plaw.entries) root.appendChild(provisionBox(e));
  } else if (res.plaw.provisions && res.plaw.provisions.length) {
    if (res.plaw.droppedLevels) {
      root.appendChild(
        card(
          'Showing a wider level',
          `The citation names ${res.plaw.askedFor}, and this law's text does not record ` +
            `${res.plaw.droppedLevels.join(' or ')} as a level of its own. Everything below is ` +
            `${res.plaw.citation.replace(/^Pub\. L\. [\d-]+,\s*/, '')}, which contains what was cited — ` +
            `${res.plaw.total} sections rather than the whole law.`,
          'warn'
        )
      );
    }
    // A subdivision the citation named — "title IV of division M of Public Law
    // 116-260". Listing the section headings answered a question nobody asked:
    // the reader named a range in order to READ it, and a row of chips saying
    // "Sec. 401. Definitions." is the table of contents of something they still
    // cannot see. These are the provisions themselves.
    // The subdivision heading is the same on every one of them, so it is drawn
    // once above rather than repeated over twenty sections.
    const shared = (res.plaw.provisions[0].ancestors || []).join('  ›  ');
    if (shared) {
      const w = document.createElement('p');
      w.className = 'ctx-sub';
      w.textContent = shared;
      root.appendChild(w);
    }
    for (const e of res.plaw.provisions) root.appendChild(provisionBox(e, true, true));
    if (res.plaw.more) {
      root.appendChild(
        card(
          'Not all of it',
          `This subdivision has ${res.plaw.total} sections; the first ` +
            `${res.plaw.provisions.length} are shown. The rest are listed below.`,
          'warn'
        )
      );
      root.appendChild(tocCard(res.plaw, `The remaining ${res.plaw.total - res.plaw.provisions.length} sections`,
                               res.plaw.toc.slice(res.plaw.provisions.length)));
    }
  } else if (res.plaw.toc && res.plaw.toc.length) {
    // A law named without a section. Its contents, not a guess at which of them
    // was meant.
    const c = document.createElement('div');
    c.className = 'card';
    const h = document.createElement('h4');
    h.textContent = `Contents — ${res.plaw.total} sections`;
    c.appendChild(h);
    // Capped for the same reason the CFR part view is, and it was not: 1,254
    // sections yielded 200 inert chips running 5,660 pixels down the pane, so a
    // reader who clicked a bare "Public Law 115-141" had forty-six screens of
    // them to scroll past before reaching the links that would actually take
    // them somewhere. The old note ("…and 1054 more") was honest about the
    // truncation and silent about the length.
    const shown = handlers.showAllSections ? res.plaw.toc : res.plaw.toc.slice(0, LIST_CAP);
    const list = document.createElement('div');
    list.className = 'links';
    for (const t of shown) {
      const s = document.createElement('span');
      s.className = 'crumb';
      s.textContent = `Sec. ${t.num}. ${t.heading}`.slice(0, 90);
      list.appendChild(s);
    }
    c.appendChild(list);
    let trunc = null;
    if (shown.length < res.plaw.toc.length) {
      // A sibling of the contents card, not a child of it: a card inside a card
      // reads as a nested panel and the "Show all" control belongs beside the
      // list it lifts the cap on, exactly as it does for a CFR part.
      trunc = truncatedCard(
        `Showing the first ${shown.length} of ${res.plaw.total} sections in this law.`,
        res.plaw.toc.length, handlers
      );
    } else if (res.plaw.toc.length < res.plaw.total) {
      // Every entry we hold, but the law has more than the shards recorded.
      const more = document.createElement('p');
      more.className = 'dim';
      more.textContent = `…and ${res.plaw.total - res.plaw.toc.length} more.`;
      c.appendChild(more);
    }
    root.appendChild(c);
    if (trunc) root.appendChild(trunc);
  }

  if (res.links && res.links.length) root.appendChild(links(res.links));
  void handlers;
  return root;
}

function externalCard(root, res) {
  head(root, res);
  // An internal reference that was found in the bill has been scrolled to and
  // marked in the left pane, so the pane's job is to say what was matched and
  // how confident that is — not to restate the words that were clicked.
  if (res.target) {
    // Three headings, not two. "Shown in the bill" is a statement and must not
    // be made over a guess: where nothing at the referenced level exists inside
    // the enclosing provision, the match came from outside the scope the
    // reference governs and the reader has to be told that before they read it
    // as the answer. The highlight in the left pane is marked to match.
    root.appendChild(
      card(
        res.target.guess ? 'Best guess — may be the wrong provision' : 'Shown in the bill',
        `Highlighted ${res.target.label}${
          res.target.section ? ` in Sec. ${res.target.section.num}` : ''
        }. ${res.target.why}`,
        res.target.ambiguous ? 'warn' : ''
      )
    );
  } else if (res.note) {
    root.appendChild(card('Note', res.note, '', res.noteLink));
  }
  if (res.links && res.links.length) root.appendChild(links(res.links));
  return root;
}

function errorCard(root, res) {
  head(root, res);
  root.appendChild(card('Could not load', res.error, 'err'));
  if (res.links && res.links.length) root.appendChild(links(res.links));
  return root;
}

function escapeText(s) { return String(s); }

export { flattenText };
