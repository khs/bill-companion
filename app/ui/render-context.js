// Right pane: the provision a citation points at, shown in context.
//
// The organising idea is the *ladder*. A cite like 42 U.S.C. 1395x(s)(2)(B) names
// a leaf, but reading it alone is useless — the meaning lives in the lead-in text
// of (s) and (2) above it. So we render the chain of ancestors down to the target,
// and expose the ladder as controls that widen the view one sub-level at a time.

import { findNode, pathChain, flattenText } from '../resolve/provision-tree.js';
import { createRedline } from './redline.js';

export function renderContext(res, handlers) {
  const root = document.createElement('div');
  if (res.error)   return errorCard(root, res);
  if (res.missing) return missingCard(root, res, handlers);
  if (res.external || res.internal) return externalCard(root, res);

  // The redline lives for exactly one render pass. Marks are applied to the law
  // as the provision is walked, in document order, and the same object is
  // threaded through every node so a struck phrase is struck once rather than
  // everywhere it happens to occur. Rebuilt on each call because the pane
  // re-renders whenever the scope changes.
  // The whole provision goes in too, so the redliner can tell whether this
  // amendment has already been applied to the law we hold before it draws
  // anything. See createRedline().
  if (res.effect) {
    const whole = res.tree
      ? [res.lead || '', ...res.tree.map(flattenText)].join('\n')
      : res.sections
      ? res.sections.map((s) => s.paragraphs.join('\n')).join('\n')
      : '';
    res.effect.redline = createRedline(res.effect.ops, whole);
  }

  head(root, res);
  if (res.relative) {
    // The bill never wrote this address out — it said "in clause (iv)" and left
    // the reader to carry down the enclosing instruction's target. Show the
    // derivation so the jump is auditable rather than magic.
    root.appendChild(
      card(
        'Read in context',
        `The bill says “${res.relative.unit} ${res.relative.markers}”, inside an instruction ` +
          `amending ${res.relative.via}. That resolves to ${res.citation}.`,
        ''
      )
    );
  }
  if (res.viaActSection) {
    // The bill wrote an Act-relative number and the pane is showing a Code
    // section with a different one. That is the correct answer and it looks
    // wrong, so the derivation is shown rather than asserted — and it names the
    // source credit it came from, which is checkable against the section itself.
    const v = res.viaActSection;
    root.appendChild(
      card(
        'Read in context',
        `The bill says “section ${v.actSection} of the ${v.act}”. That Act's own section ` +
          `numbers are not the ones the Code uses, so ${v.act} § ${v.actSection} is ` +
          `${v.codified} — taken from the source credit the Code prints on that section ` +
          `(${v.enactedAs}).`,
        ''
      )
    );
  }
  if (res.crumbs && res.crumbs.length) root.appendChild(crumbs(res.crumbs, res, handlers));
  if (res.offsetNote) root.appendChild(card('Numbering caveat', res.offsetNote, 'warn'));
  if (res.isActStart) {
    root.appendChild(
      card(
        'Whole Act',
        `This names an Act, not a single provision. Showing its first codified section` +
          (res.range ? ` — the Act runs to ${escapeText(res.range)}.` : '.'),
        ''
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
    if (res.focusMissing) {
      root.appendChild(
        card(
          'Subsection not present',
          `The bill cites ${escapeText(res.focusPath)}, but the current text of this ` +
            `section has no such subsection. That usually means the bill is adding it.`,
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
    for (const s of res.sections.slice(0, 40)) {
      root.appendChild(cfrSection(s, s === res.focus, res));
    }
    if (res.sections.length > 40) {
      root.appendChild(card('Truncated', `Showing the first 40 of ${res.sections.length} sections in this part.`, ''));
    }
  }

  if (res.effect) root.appendChild(effect(res.effect));
  if (res.sourceCredit) root.appendChild(card('Source credit', res.sourceCredit, ''));
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
    const el = document.createElement('span');
    el.className = 'crumb';
    el.textContent = c.label || c.short;
    // The part level is the one worth zooming out to for a CFR section.
    if (handlers.onCrumb && c.type === 'part' && res.source === 'eCFR') {
      el.classList.add('clickable');
      el.title = 'Show the whole part';
      el.addEventListener('click', () => handlers.onCrumb(c));
    }
    wrap.appendChild(el);
  });
  return wrap;
}

/** Default view: the parent of the cited subsection, so siblings are visible. */
function defaultScope(res) {
  const p = res.focusPath || '';
  const parts = p.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
  return parts.slice(0, -1).join('');
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

  for (const path of rungs) {
    const b = document.createElement('button');
    b.textContent = path === '' ? `§ ${res.citation.split(' ').pop().replace(/\(.*/, '')}` : path;
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

function nodeEl(node, focusPath, red) {
  const el = document.createElement('div');
  el.className = 'node';
  if (focusPath) {
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
    s.className = seg.type === 'ins' ? 'ins' : 'del';
    s.title = seg.type === 'ins' ? 'Language this bill inserts' : 'Language this bill strikes';
    s.textContent = seg.text;
    parent.appendChild(s);
  }
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
function effect(eff) {
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
    } else if (op.type === 'repeal') t.textContent = 'the provision is repealed in full';
    else t.textContent = `“${flat(op.text)}”`;
    row.appendChild(t);

    // Whether the change is drawn into the law above, or only listed here. An
    // operation the redline could not place is the one the reader most needs
    // flagged — it is the case where the panel and the provision disagree.
    const shown = eff.redline ? eff.redline.placed().some((p) => p.start === op.start) : false;
    if (shown) {
      const f = document.createElement('span');
      f.className = 'found';
      f.textContent = op.type === 'strike' ? '✓ struck above' : '✓ shown above';
      row.appendChild(f);
    } else if (op.type === 'strike') {
      const f = document.createElement('span');
      if (op.found) { f.className = 'found'; f.textContent = '✓ found in current text'; }
      else { f.className = 'notfound'; f.textContent = '⚠ not found verbatim'; }
      row.appendChild(f);
    } else if (op.type === 'insert') {
      // Two different reasons, and saying the wrong one is worse than saying
      // nothing: the bill may not have stated a position at all, or it may have
      // stated one whose anchor text is no longer in the provision.
      const f = document.createElement('span');
      f.className = 'notfound';
      f.textContent =
        op.replaces != null || op.anchor ? '⚠ anchor text not found' : '⚠ position not stated';
      row.appendChild(f);
    } else if (op.type === 'add-at-end') {
      // Three reasons an addition isn't drawn, and they mean opposite things.
      // Already in the law is the bill having *succeeded*; the reader should not
      // go hunting for green text, nor conclude the change was missed.
      const applied = eff.redline ? eff.redline.appliedAdditions() : [];
      const f = document.createElement('span');
      if (applied.some((p) => p.start === op.start)) {
        f.className = 'found';
        f.textContent = '✓ already in the law as it stands';
      } else if (!op.text) {
        f.className = 'notfound';
        f.textContent = '⚠ added language not delimited';
      } else {
        f.className = 'notfound';
        f.textContent = '⚠ the provision it follows is not shown';
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

  if (eff.unmatched) {
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

function notesCard(notes) {
  const c = document.createElement('div');
  c.className = 'card';
  const h = document.createElement('h4');
  h.textContent = `Notes (${notes.length})`;
  c.appendChild(h);
  for (const n of notes.slice(0, 6)) {
    const p = document.createElement('p');
    p.textContent = typeof n === 'string' ? n : `${n.topic || 'note'}: ${n.text || ''}`;
    c.appendChild(p);
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

function card(title, body, cls) {
  const c = document.createElement('div');
  c.className = `card ${cls}`.trim();
  const h = document.createElement('h4');
  h.textContent = title;
  c.appendChild(h);
  const p = document.createElement('p');
  p.textContent = body;
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

function externalCard(root, res) {
  head(root, res);
  // An internal reference that was found in the bill has been scrolled to and
  // marked in the left pane, so the pane's job is to say what was matched and
  // how confident that is — not to restate the words that were clicked.
  if (res.target) {
    root.appendChild(
      card(
        'Shown in the bill',
        `Highlighted ${res.target.label}${
          res.target.section ? ` in Sec. ${res.target.section.num}` : ''
        }. ${res.target.why}`,
        res.target.ambiguous ? 'warn' : ''
      )
    );
  } else if (res.note) {
    root.appendChild(card('Note', res.note, ''));
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
