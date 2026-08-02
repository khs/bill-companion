// Applying an amendment to the text of the law, so the change can be read as a
// redline rather than as a list of instructions.
//
// The bill says «by striking ``widget'' and inserting ``gadget''». That is
// perfectly precise and almost unreadable: to know what the law will say you
// have to find "widget" in the provision yourself and do the substitution in
// your head. Marking it in the *provision* — widget struck through in red,
// gadget in green beside it — is the whole point of showing the two panes
// together.
//
// Two things make this harder than a string replace.
//
// First, the bill and the U.S. Code never spell the same passage identically:
// the bill quotes with ``…'' or ‘‘…’’, the Code shard has curly doubles, and a
// PDF bill wraps its operand across a line so the phrase carries a newline the
// Code does not have. So matching happens on a folded copy of both — and because
// the mark has to land on the *original* characters, the fold carries an index
// back to them.
//
// Second, an insertion has no text of its own to attach to. Where it goes comes
// from the connective the bill used ("and inserting", "after ``Y''"), captured
// by placeOps() in app/parse/citations.js.

/**
 * Fold a passage onto the common ground the two sources share, keeping a map
 * back to the original offsets.
 *
 * Quote convention, case and whitespace runs are all normalised away — the same
 * fold main.js uses to decide whether struck language is present at all, except
 * that this one can say *where*.
 */
export function fold(s) {
  let norm = '';
  const from = [];
  const to = [];
  let i = 0;
  let lastWasSpace = false;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === '``' || two === "''" || two === '‘‘' || two === '’’') {
      norm += '"'; from.push(i); to.push(i + 2); i += 2; lastWasSpace = false; continue;
    }
    const c = s[i];
    if (/\s/.test(c)) {
      // A run of whitespace folds to one space, mapped over the whole run so a
      // mark that ends on it covers the line break rather than half of it.
      const start = i;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (!lastWasSpace) { norm += ' '; from.push(start); to.push(i); lastWasSpace = true; }
      else { to[to.length - 1] = i; }
      continue;
    }
    lastWasSpace = false;
    norm += c === '“' || c === '”' ? '"' : c.toLowerCase();
    from.push(i); to.push(i + 1); i++;
  }
  return { norm, from, to };
}

/**
 * Every occurrence of `needle` in a folded passage, as original-offset ranges.
 *
 * Whole words only. Bills strike very short operands constantly — "and", "or",
 * a lone semicolon — and a plain substring search struck the "or" inside "for"
 * and the "and" inside "understanding", drawing a line through the middle of a
 * word the amendment never mentions. The boundary is only required at an end
 * that is itself a word character, so punctuation operands still match.
 */
function occurrences(folded, needle) {
  const n = fold(needle).norm.trim();
  const out = [];
  if (!n) return out;
  const openWord = /\w/.test(n[0]);
  const closeWord = /\w/.test(n[n.length - 1]);
  let at = folded.norm.indexOf(n);
  while (at >= 0) {
    const before = at > 0 ? folded.norm[at - 1] : '';
    const after = folded.norm[at + n.length] || '';
    if (!(openWord && /\w/.test(before)) && !(closeWord && /\w/.test(after))) {
      out.push({ start: folded.from[at], end: folded.to[at + n.length - 1] });
    }
    at = folded.norm.indexOf(n, at + 1);
  }
  return out;
}

/**
 * A redliner for one amendment, applied across the provision in document order.
 *
 * Stateful on purpose. A struck phrase is struck once, in the first node that
 * contains it — statutory language does repeat, and marking every match would
 * report an amendment as touching provisions it never mentions. `each place it
 * appears` is the exception the bill states explicitly, and only then are all
 * matches marked.
 *
 * @param {Array} ops  the amendment's ops, already carrying placement metadata
 */
export function createRedline(ops, fullText) {
  // An insert placed structurally belongs to `additions` and to nothing else.
  // It used to be in both lists as two separate objects: the additions copy was
  // handled and the work copy was never marked done, so unplaced() reported a
  // stranded insertion for one that had in fact been dealt with — and the panel
  // told the reader "not drawn into the text" about language that was already
  // in the law.
  const structural = (o) => o.type === 'add-at-end' || (o.type === 'insert' && o.placement === 'after-unit');
  const work = (ops || [])
    .filter((o) => (o.type === 'strike' || o.type === 'insert') && typeof o.text === 'string')
    .filter((o) => !structural(o))
    .map((o) => ({ ...o, done: false }));

  // Additions are placed structurally rather than woven into a run of text.
  //
  // "by adding at the end the following: ``(D) …''" puts a whole new provision
  // *after the last child* of the one it names — new subparagraph (D) follows
  // (A), (B) and (C). apply() works inside one passage at a time and cannot see
  // where a subtree ends, so weaving it in would land the new language directly
  // after paragraph (3)'s lead-in sentence and before the subparagraphs it is
  // supposed to follow. The renderer asks for these once it has finished a
  // node's children instead; see additionsAt().
  //
  // "by inserting after subparagraph (C) the following" joins the same list.
  // It is an insert by verb but a new provision by shape, and it was reaching
  // apply() with nothing to anchor to — no quoted phrase, no paired strike —
  // so it drew nothing at all. Scoped to (C) itself by scopeUnitInserts(), it
  // lands after (C)'s subtree, which is where the bill puts it.
  const additions = (ops || [])
    .filter((o) => typeof o.text === 'string' && structural(o))
    // `inLaw` is decided here rather than inside additionsAt(), because whether
    // the law already contains this language has nothing to do with which node
    // the renderer happens to be laying out when it asks. Deciding it lazily
    // made appliedNodePaths() depend on walk order, which is the kind of thing
    // that works until a tree is shaped differently.
    .map((o) => ({ ...o, done: false, inLaw: alreadyIn(fullText, o.text) }));

  // Has this amendment already happened?
  //
  // The Code we hold is current, so an *enacted* bill has usually already been
  // applied to it — its struck language is gone and its inserted language is
  // there. Drawing the insertions anyway produced "for the 2018 crop year,
  // {+for the 2018 crop year,+} all of the producers": the same words twice,
  // one of them coloured as a change.
  //
  // An amendment that strikes something is a claim about what the provision
  // currently says. When not one of its strikes can be found, that claim is
  // false, the provision has moved on, and its insertions are being anchored to
  // text that no longer means what the drafter meant. Draw nothing and say so.
  const strikes = work.filter((o) => o.type === 'strike');
  const stale =
    typeof fullText === 'string' &&
    strikes.length > 0 &&
    !strikes.some((o) => occurrences(fold(fullText), o.text).length);

  // Where each strike landed, keyed by its offset in the bill, so an insert that
  // replaces it can be placed immediately after.
  const struckAt = new Map();

  /**
   * @param {string} text  a passage of the provision
   * @param {string} path  that passage's own path, e.g. "(d)(2)(A)"
   *
   * An operation carries the path the instruction had navigated to when it was
   * written, and applies only there or below. Without that, "in subparagraph
   * (A), by striking ``or'' at the end" searched the whole section and struck an
   * "or" three subsections away.
   */
  function apply(text, path = '') {
    if (!text || !work.length) return [{ type: 'keep', text: text || '' }];
    // An op normally applies at its own scope or anywhere below it. "In the
    // matter preceding subparagraph (A)" is the exception: it names the
    // parent's own text and excludes the subparagraphs, so a strike scoped
    // there must not be allowed to land inside (A) — which is exactly the text
    // the instruction identifies itself by staying out of.
    const inScope = (op) =>
      !op.scope || (op.exact ? String(path) === op.scope : String(path).startsWith(op.scope));
    const folded = fold(text);
    const dels = [];
    const inss = [];

    for (const op of work) {
      if (op.done || op.type !== 'strike' || !inScope(op)) continue;
      const hits = occurrences(folded, op.text);
      if (!hits.length) continue;
      // "each place it appears" is the bill saying so outright. Otherwise one
      // occurrence is struck: "by striking ``and'' at the end" means the last
      // one, and everything else means the first. Getting this wrong on a
      // one-word operand puts the strike in a different sentence entirely.
      //
      // "at the end" is also a claim that can be checked, and checking it is
      // what stops a stale match. The Code we hold is current, so an enacted
      // bill's strike has usually already happened: asked to strike "or" at the
      // end of a subparagraph that no longer ends in "or", taking the last
      // occurrence found "a socially disadvantaged farmer [or] rancher" in the
      // middle of the sentence and drew a line through it. If nothing but
      // punctuation follows the match, it really is at the end; otherwise the
      // language is gone and the honest answer is to mark nothing.
      let chosen;
      if (op.all) chosen = hits;
      else if (op.atEnd) {
        const last = hits[hits.length - 1];
        if (!/^[\s;.,:]*$/.test(text.slice(last.end))) continue;
        chosen = [last];
      } else chosen = [hits[0]];
      for (const h of chosen) dels.push({ ...h, op });
      op.done = true;
      struckAt.set(op.start, chosen[chosen.length - 1]);
    }

    for (const op of work) {
      if (op.done || op.type !== 'insert' || !inScope(op) || stale) continue;
      // Placed structurally, by additionsAt(). Weaving it in here too would
      // draw the same new provision twice.
      if (op.placement === 'after-unit') continue;
      if (op.replaces != null) {
        const where = struckAt.get(op.replaces);
        // Only in the same passage the strike landed in; otherwise wait, the
        // provision may continue in a later node.
        if (where && dels.some((d) => d.start === where.start)) {
          inss.push({ at: where.end, text: op.text, op });
          op.done = true;
        }
        continue;
      }
      if (op.anchor) {
        const hit = occurrences(folded, op.anchor)[0];
        if (hit) {
          const at = op.relation === 'before' ? hit.start : hit.end;
          if (alreadyThere(text, at, op.text)) continue;
          inss.push({ at, text: op.text, op });
          op.done = true;
        }
      }
    }

    return segments(text, dels, inss);
  }

  /**
   * New language this amendment adds at the end of the provision at `path`.
   *
   * Called by the renderer after it has laid out that node's children, so the
   * addition falls where the bill puts it — after the last existing sibling.
   *
   * Subject to the same "has this already happened?" discipline as everything
   * else here. The Code we hold is current, so an enacted bill's addition is
   * usually already in it, and drawing it again would show the provision twice
   * with one copy coloured as new. An amendment whose strikes cannot be found is
   * stale in full and adds nothing either.
   */
  function additionsAt(path) {
    const out = [];
    for (const op of additions) {
      if (op.done || (op.scope || '') !== (path || '')) continue;
      op.done = true;
      // `inLaw` is asked FIRST. Both flags say "this has already happened", but
      // one is evidence about this very language and the other is an inference
      // from the amendment's strikes. Where they agree the order is immaterial;
      // where a strike's operand simply is not in the provision, checking
      // staleness first reported an addition the law demonstrably contains as
      // one that could not be placed.
      if (op.inLaw) { op.applied = true; continue; }
      if (stale) { op.staleSkip = true; continue; }
      out.push(op);
    }
    return out;
  }

  /**
   * The provisions an already-enacted addition put into the law, by path.
   *
   * When the Code already contains the added language there is nothing to draw
   * — drawing it would show the provision twice, once coloured as new. But
   * "nothing to draw" is not the same as "nothing to say": the reader is
   * looking at a bill, and the provisions it created are right there on screen,
   * indistinguishable from law that predates it. These are the paths of those
   * provisions, so the pane can mark them as this bill's work.
   *
   * The added block's own leading markers give the numbers — the same signal
   * scopeAdditions() reads for depth. An add-at-end op is scoped to the parent,
   * so its children hang directly off it; an after-unit op is scoped to the
   * sibling it follows, so they hang off that sibling's parent.
   */
  function appliedNodePaths() {
    const out = new Set();
    for (const op of additions) {
      if (!op.inLaw || typeof op.scope !== 'string') continue;
      const base =
        op.placement === 'after-unit'
          ? op.scope.replace(/\([A-Za-z0-9]{1,8}\)$/, '')
          : op.scope;
      for (const line of String(op.text).split('\n')) {
        const m = line.match(/^\s*(?:``|‘‘|["“])?\s*(\([A-Za-z0-9]{1,8}\))/);
        if (m) out.add(base + m[1]);
      }
    }
    return out;
  }

  return {
    apply,
    additionsAt,
    appliedNodePaths,
    isStale: () => stale,
    /** Ops that never found a home, for the panel to report honestly. */
    unplaced: () => work.filter((o) => !o.done),
    // Drawn into the law, which is not the same as dealt with: an addition the
    // law already contains is marked done and deliberately not drawn, and
    // reporting it as "shown above" would send the reader looking for green text
    // that isn't there.
    placed: () => [...work, ...additions.filter((o) => !o.applied && !o.staleSkip)].filter((o) => o.done),
    /** Additions whose scope names a provision that isn't in the tree shown. */
    unplacedAdditions: () => additions.filter((o) => !o.done),
    /** Additions the law already contains — the bill has been enacted. */
    appliedAdditions: () => additions.filter((o) => o.applied),
  };
}

/**
 * Is this added language already in the provision?
 *
 * The counterpart to alreadyThere() for a whole added block. An addition has no
 * anchor text to test, so the test is the language itself: if the opening of the
 * new provision is already in the law, the bill has been enacted and applied and
 * there is nothing to draw. Compared on the fold, because the bill quotes the
 * block and wraps it to its own measure while the Code does neither.
 *
 * The first 80 folded characters are enough to identify a provision and short
 * enough to survive later amendment of its tail; below 24 there is not enough to
 * be sure, and a false positive here silently hides real new law.
 */
function alreadyIn(fullText, added) {
  if (typeof fullText !== 'string' || !fullText) return false;
  const needle = fold(added).norm.trim().slice(0, 80).trim();
  if (needle.length < 24) return false;
  return fold(fullText).norm.includes(needle);
}

/**
 * Are these words already sitting at the point they would be inserted?
 *
 * The narrower companion to the staleness check above: an amendment with no
 * strikes at all cannot be tested that way, but an insertion whose language is
 * already immediately before or after the anchor has plainly been applied
 * already. Checked on the folded text, so quoting and line wrapping don't hide
 * the match.
 */
function alreadyThere(text, at, insertText) {
  const needle = fold(insertText).norm.trim().replace(/^[\s;.,:]+|[\s;.,:]+$/g, '');
  if (needle.length < 4) return false;
  const span = needle.length + 40;
  const after = fold(text.slice(at, at + span)).norm.replace(/^[\s;.,:]+/, '');
  const before = fold(text.slice(Math.max(0, at - span), at)).norm.replace(/[\s;.,:]+$/, '');
  return after.startsWith(needle) || before.endsWith(needle);
}

/** Weave deletions and insertions into a flat run of segments. */
function segments(text, dels, inss) {
  dels.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const d of dels) {
    if (kept.length && d.start < kept[kept.length - 1].end) continue; // overlapping marks
    kept.push(d);
  }
  inss.sort((a, b) => a.at - b.at);

  const out = [];
  let cursor = 0;
  let di = 0;
  let ii = 0;
  const push = (type, t) => { if (t) out.push({ type, text: t }); };

  while (di < kept.length || ii < inss.length) {
    const d = kept[di];
    const n = inss[ii];
    if (d && (!n || d.start <= n.at)) {
      push('keep', text.slice(cursor, d.start));
      push('del', text.slice(d.start, d.end));
      cursor = d.end;
      di++;
    } else {
      if (n.at > cursor) push('keep', text.slice(cursor, n.at));
      // The operand crosses from the bill's typesetting into the law's. A quoted
      // phrase in a bill is wrapped to the measure — "and sustainable \n
      // aviation fuel" — and that line break is layout, not language. Collapsed
      // to single spaces so the inserted words read as a phrase where they now
      // sit, rather than opening a gap the width of the bill's left margin.
      push('ins', n.text.replace(/\s+/g, ' '));
      cursor = Math.max(cursor, n.at);
      ii++;
    }
  }
  push('keep', text.slice(cursor));
  return out.length ? out : [{ type: 'keep', text }];
}
