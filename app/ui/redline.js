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
 * Quote convention, DASH convention, case and whitespace runs are all normalised
 * away — the same fold main.js uses to decide whether struck language is present
 * at all, except that this one can say *where*.
 *
 * The dash is the quote convention's exact twin, and was missed for as long as
 * this existed. govinfo writes the em dash as two hyphens and the Code writes a
 * real one, so the Fiscal Responsibility Act's new spending caps —
 *
 *   bill:  ``(9) for fiscal year 2024--
 *   law:     (9) for fiscal year 2024—
 *
 * — differ in one character out of eighty and matched nothing. That is the same
 * text, and alreadyIn() has to be able to say so: without it an addition the law
 * demonstrably contains is drawn in the insertion colour beside the identical
 * paragraph already there, which is the duplication every guard here exists to
 * prevent. The em dash is canonical because the ASCII hyphen must stay distinct
 * — "REG-ISTRATION" and "PAY-AS-YOU-GO" carry real hyphens, and folding those
 * together would match across words the drafter kept apart.
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
    // Two hyphens are one em dash, and take two characters of the original the
    // same way a doubled quote mark does.
    if (two === '--') {
      norm += '—'; from.push(i); to.push(i + 2); i += 2; lastWasSpace = false; continue;
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
    // The en dash joins the em dash: USLM prints both, and a bill writing either
    // means the same separator. The ASCII hyphen is deliberately left alone.
    norm +=
      c === '“' || c === '”' ? '"' : c === '–' || c === '—' ? '—' : c.toLowerCase();
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
// How much inserted language has to be present before "these words are here"
// counts as evidence that this bill put them here. `alreadyIn` uses the same
// floor for block additions and for the same reason: below it, a match is a
// coincidence of common statutory phrasing rather than a fingerprint. Only the
// unanchored case is subject to it — an anchor is positional proof on its own.
const ENACTED_MIN = 24;

/**
 * An operation scoped to a path the provision does not have.
 *
 * `inScope` asks whether the node's path starts with the op's scope, so a scope
 * naming a level that does not exist matches NOTHING and every operation under
 * it silently vanishes — no mark, no message, nothing for the reader to notice.
 * 496 across the corpus.
 *
 * The cause is mostly US, and that was worth measuring rather than assuming.
 * A bill CAN write a bad address — the Fiscal Responsibility Act cites "7 U.S.C.
 * 2015(6)(o)(3)" for 2015(o)(3), duplicating the Act's own section number into
 * the parenthetical, and cites the same provision correctly thirty lines later —
 * but that is one citation, not the pattern. Classified across the corpus:
 *
 *    46  dropping the leading marker gives a real path
 *   413  every marker exists in the tree, but not in that order or nesting
 *   199  the leading marker is nowhere in the provision at all
 *
 * and 658 of the 675 are plain U.S.C. cites rather than Act-relative ones, so
 * this is not the Act-numbering hazard either. Two of our own faults are
 * confirmed behind it: a shard whose tree is missing a level — 42 U.S.C. 4332
 * has (A)–(H) at top level, with NEPA's own "(2) all agencies … shall" gone, so
 * the correct address (2)(A) cannot match — and scope composition dropping a
 * level, which is how "section 2(a)(36)" reached 15 U.S.C. 80a-2 as bare (36).
 *
 * So this is a symptom to REPORT and a signal to follow, not a bill to blame.
 * Reporting it is still right: the alternative is drawing nothing and saying
 * nothing, which is how it stayed invisible. Following it is what found TODO 35:
 * the instruction's own head was never consulted at all, so 813 operations that
 * never navigate were searching whole sections. The count above is now 1,233,
 * of which only 280 survive nowhere. See TODO 34 and TODO 35.
 *
 * Shortened from the inside out until something matches, which is exactly what
 * `resolvePlawDivision` does with a Public Law subdivision, and for the same
 * reason: narrow and honest beats wide and silent. Two rules keep it honest —
 *
 *   - it never shortens a NAVIGATION scope to nothing. Falling back to the whole
 *     section would let a one-word operand land in a sentence the instruction
 *     never mentions, which is the hazard `scope` exists to prevent. An address
 *     that survives nowhere is recorded as lost and drawn nowhere.
 *     The single exemption is `scopeFromHead` — see the note at the bottom of
 *     this function. It is not a softening of this rule but its complement: the
 *     whole provision is where such an op applied before the head was read at
 *     all, so shortening to nothing restores the previous answer rather than
 *     widening past a claim the instruction made.
 *   - it never REORDERS. (6)(o)(E) against a provision holding (o)(6)(E) is a
 *     transposition anyone can see, and correcting it would be a guess about
 *     what the drafter meant.
 */
function reScope(ops, knownPaths) {
  const paths = [...knownPaths];
  const exists = (s) => paths.some((p) => String(p).startsWith(s));
  return ops.map((o) => {
    const scope = String(o.scope || '');
    if (!scope || exists(scope)) return o;
    const marks = scope.match(/\([A-Za-z0-9]{1,8}\)/g) || [];
    for (let i = marks.length - 1; i > 0; i--) {
      const shorter = marks.slice(0, i).join('');
      if (exists(shorter)) return { ...o, scope: shorter, scopeWidened: scope };
    }
    // Nothing shallower matched, so try dropping markers off the FRONT instead.
    //
    // A level the CODE ITSELF does not mark up. 42 U.S.C. 4332's USLM puts
    // NEPA's "(1) the policies … and (2) all agencies … shall—" inline in the
    // <chapeau> and hangs the (A)–(L) <subparagraph> elements straight off the
    // section — there is no (2) element in the source at all. So the shard is
    // faithful, the citation "(2)(A)" is correct, and neither can be fixed:
    // what is left is to notice that the tail names a real provision. 17
    // sections Code-wide are shaped this way (checked, of 35,054).
    //
    // Safe because it is still a test, never a guess: the remainder has to be a
    // real path. The Fiscal Responsibility Act's transposed (6)(o)(E) offers
    // (o)(E), which is a prefix of nothing in 7 U.S.C. 2015, so it stays lost
    // rather than being quietly relocated.
    for (let i = 1; i < marks.length; i++) {
      const tail = marks.slice(i).join('');
      if (exists(tail)) return { ...o, scope: tail, scopeWidened: scope };
    }
    // A scope taken from the instruction's own head, naming nothing here.
    //
    // This is the ONE case where shortening to nothing is right, and the reason
    // is that the whole provision is where the op was applied before the head
    // was read at all. "Section 22(d) of the Federal Reserve Act (12 U.S.C. 375)
    // is amended" — the Act's subsection (d) IS the codified section, so 375 has
    // no (d) and never will. 41 of the 306 head addresses that resolve are this
    // shape. Declaring them lost would withdraw marks the reader can see today
    // in order to fix a level that was never wrong.
    //
    // A navigation step is not eligible: "in paragraph (14)" of a provision with
    // no (14) is unaccounted for, and widening it to the whole section is how a
    // one-word operand lands in a sentence the instruction never mentions.
    if (o.scopeFromHead) return { ...o, scope: '', scopeWidened: scope };
    return { ...o, scopeLost: scope };
  });
}

/**
 * @param {Array}  ops        the amendment's ops, already carrying placement
 * @param {string} fullText   the whole provision, for the already-happened tests
 * @param {Set}    knownPaths every path in the tree being rendered, so an op
 *                            addressed to a level that does not exist can be
 *                            widened to one that does rather than disappearing
 */
export function createRedline(ops, fullText, knownPaths) {
  // An insert placed structurally belongs to `additions` and to nothing else.
  // It used to be in both lists as two separate objects: the additions copy was
  // handled and the work copy was never marked done, so unplaced() reported a
  // stranded insertion for one that had in fact been dealt with — and the panel
  // told the reader "not drawn into the text" about language that was already
  // in the law.
  const structural = (o) => o.type === 'add-at-end' || (o.type === 'insert' && o.placement === 'after-unit');

  // `operand` is set where the bill NAMES what it operates on instead of quoting
  // it — "by striking the period at the end", "and inserting a semicolon". The
  // span in the bill is the phrase the reader clicked, so that is what `text`
  // holds; what has to be found in — or added to — the LAW is the mark itself.
  //
  // Substituted HERE, before the split, and that placement is the whole point.
  // This map used to sit in the `additions` chain alone, where an operand-bearing
  // op can never arrive: structural() admits only `add-at-end` and after-unit
  // inserts, and every op carrying `operand` is a plain strike or insert. So it
  // was dead code in the one list that could not use it, and missing from the one
  // that could. Every synthesised punctuation strike matched the PHRASE against
  // the law's text, found nothing, and drew nothing — and its paired insert went
  // with it, because `replaces` pointed at a strike that never reached struckAt.
  // 446 strikes and 343 paired inserts across the corpus, every count green and
  // not one pixel drawn.
  const named = (ops || []).map((o) => (o.operand ? { ...o, text: o.operand } : o));
  // Addresses are reconciled against the tree BEFORE anything is split or
  // measured, so `work`, `additions` and `stale` all reason about the same
  // scopes the renderer will ask with.
  const scoped = knownPaths ? reScope(named, knownPaths) : named;

  const work = scoped
    .filter((o) => (o.type === 'strike' || o.type === 'insert') && typeof o.text === 'string')
    .filter((o) => !structural(o) && !o.scopeLost)
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
  const additions = scoped
    .filter((o) => typeof o.text === 'string' && structural(o) && !o.scopeLost)
    // `inLaw` is decided here rather than inside additionsAt(), because whether
    // the law already contains this language has nothing to do with which node
    // the renderer happens to be laying out when it asks. Deciding it lazily
    // made appliedNodePaths() depend on walk order, which is the kind of thing
    // that works until a tree is shaped differently.
    .map((o) => ({ ...o, done: false, inLaw: alreadyIn(fullText, o.text) }));

  // Whole-provision replacements. Excluded from `work` and `additions` by their
  // type alone, so they were being dropped silently; they get their own list
  // because they are placed by identity — the provision whose path they name —
  // rather than by matching text or by joining a list. `scopeLost` is honoured
  // for the same reason it is there: an address the provision does not have is
  // reported, not guessed at.
  const replacements = scoped
    .filter((o) => o.type === 'replace' && typeof o.text === 'string' && !o.scopeLost)
    .map((o) => ({ ...o, done: false }));

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
  // ...but only a strike whose operand could go missing is evidence either way.
  //
  // Bills strike ".", ";", "or" and "and" constantly, and those occur
  // throughout every provision — so finding one says nothing about whether this
  // amendment has happened, while ANY strike being found held the whole
  // amendment open. One period kept 157 amendments "pending" across the corpus,
  // and 580 rested on nothing longer than four characters. The Fiscal
  // Responsibility Act's SNAP changes are the shape of it: 7 U.S.C. 2015(o)(6)
  // reads "Subject to subparagraphs (G) through (I)" — the words this bill
  // inserted, in force — and every insertion in that instruction was withheld
  // because two of its seven strikes were punctuation that trivially matched.
  //
  // Four alphanumeric characters is the floor, which is what separates "or",
  // "and" and a lone semicolon from a phrase. Where an amendment strikes
  // nothing else, there is no evidence to reason from and the old answer stands
  // — `evidence.length > 0` keeps that case unchanged rather than calling it
  // stale on an empty set.
  const distinctive = (o) => String(o.text).replace(/[^A-Za-z0-9]/g, '').length >= 4;
  const evidence = work.filter((o) => o.type === 'strike' && distinctive(o));
  const stale =
    typeof fullText === 'string' &&
    evidence.length > 0 &&
    !evidence.some((o) => occurrences(fold(fullText), o.text).length);

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

    /**
     * This language is already in the law, and it is here because of this bill.
     *
     * Marks the words where they now sit instead of drawing them as a pending
     * change. `near` is the position the instruction would have put them, so the
     * occurrence chosen is the one the bill is talking about — statutory
     * language repeats, and the first match is regularly a different sentence.
     */
    const enact = (op, near) => {
      const hits = occurrences(folded, op.text);
      if (!hits.length) return false;
      let hit = hits[0];
      if (near != null) {
        for (const h of hits) {
          if (Math.abs(h.start - near) < Math.abs(hit.start - near)) hit = h;
        }
      } else if (op.atEnd) hit = hits[hits.length - 1];
      dels.push({ ...hit, op, mark: 'was' });
      op.done = true;
      op.enacted = true;
      return true;
    };

    for (const op of work) {
      if (op.done || op.type !== 'insert' || !inScope(op)) continue;
      // Placed structurally, by additionsAt(). Weaving it in here too would
      // draw the same new provision twice.
      if (op.placement === 'after-unit') continue;
      if (op.replaces != null) {
        const where = struckAt.get(op.replaces);
        // Only in the same passage the strike landed in; otherwise wait, the
        // provision may continue in a later node.
        if (where && dels.some((d) => d.start === where.start)) {
          if (!stale) {
            inss.push({ at: where.end, text: op.text, op });
            op.done = true;
          }
          continue;
        }
        // The strike did not land. Where EVERY strike this amendment makes is
        // already gone and this language is already here, both halves of the
        // amendment have plainly happened — so the words are marked as the
        // bill's work rather than withheld. The length floor is `alreadyIn`'s,
        // because there is no anchor here doing the positional work: staleness
        // is evidence about the amendment, not about this spot.
        if (stale && String(op.text).trim().length >= ENACTED_MIN) enact(op, null);
        continue;
      }
      if (op.anchor) {
        const hit = occurrences(folded, op.anchor)[0];
        if (hit) {
          const at = op.relation === 'before' ? hit.start : hit.end;
          // The words already sit against the anchor the instruction names.
          // That is positional proof and needs no length floor — it used to be
          // grounds for drawing nothing at all, which told the reader the
          // anchor could not be found when the truth was the opposite.
          if (alreadyThere(text, at, op.text)) { enact(op, at); continue; }
          if (stale) continue;
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
      // Asked before `inLaw`, and for a stronger reason than the ordering below:
      // this op is not about the provision on screen at all. The bill cited a
      // range ("42 U.S.C. 4321 et seq.") and adds at the end of THAT, so testing
      // whether the language is already in the first section, or drawing it
      // there, both answer a question nobody asked. The panel says where it goes.
      // …and the same for a block that IS a whole new section: it is not about
      // the provision on screen at all, so testing whether its language is
      // already there, or drawing it, both answer a question nobody asked.
      // `rangeSkip` is reused deliberately rather than adding a fourth flag —
      // placed() has to know every "dealt with but not drawn" marker, and each
      // one added separately has broken that the same way.
      if (op.rangeEnd || op.newSection) { op.rangeSkip = true; continue; }
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
   * The provision this bill rewrites from end to end, if it is this one.
   *
   * A whole-provision replacement is not a phrase woven into a passage and not a
   * block joining a list, so neither apply() nor additionsAt() can carry it — and
   * before these ops existed nothing carried it at all: the redline drew nothing
   * and the panel, which returns early on an amendment with no operations, said
   * nothing either. 1,067 across the corpus.
   *
   * What is deliberately NOT done here is a diff. Striking the whole provision
   * and drawing the block after it is the literal truth of a pending bill and
   * exactly wrong for an enacted one, where the Code already reads the new text —
   * that is the duplication every guard in this file exists to prevent, at the
   * scale of a whole provision. So the node is marked and the panel states the
   * new language; the reader compares it against the text in front of them,
   * which is a weaker claim than a diff and one that cannot be wrong.
   *
   * Matched with `===` rather than a prefix: a replacement acts on exactly the
   * provision it names, never on its children, the same way an `exact` scope
   * behaves in inScope().
   */
  function replacedAt(path, provisionText) {
    const op = replacements.find((o) => !o.done && (o.scope || '') === (path || ''));
    if (!op) return null;
    op.done = true;
    // …and whether it has already happened, which is the one thing that makes
    // the mark say something. Decided HERE rather than at construction — the
    // opposite of an addition's `inLaw`, deliberately — because the haystack is
    // different. "Does the law already contain this added language anywhere in
    // the provision?" is the right question for an addition; for a replacement
    // the question is whether THIS node reads the new text, and testing the
    // whole provision answers a laxer one. Measured: against the whole
    // provision, 42 U.S.C. 254b-2(b)(1)(F) reports in force for a rewrite that
    // genuinely differs, because the words turn up elsewhere in the section.
    // The caller has the node; nothing here does.
    if (typeof provisionText === 'string') op.inLaw = rewriteInForce(provisionText, op.text);
    return op;
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
    replacedAt,
    appliedNodePaths,
    isStale: () => stale,
    /** Ops that never found a home, for the panel to report honestly. */
    unplaced: () => work.filter((o) => !o.done),
    // Drawn into the law, which is not the same as dealt with: an addition the
    // law already contains is marked done and deliberately not drawn, and
    // reporting it as "shown above" would send the reader looking for green text
    // that isn't there. `rangeSkip` is the third of these and the same trap —
    // an addition at the end of an Act is marked done by the node that declined
    // it, and calling that "shown above" is the opposite of what was decided.
    // A replacement is "placed" once the node it names has been laid out and
    // marked, which is the whole of what it claims — the provision on screen is
    // the one this bill rewrites. It draws no coloured text, so the panel says
    // "marked above" rather than "shown above"; see effect().
    placed: () =>
      [...work, ...additions.filter((o) => !o.applied && !o.staleSkip && !o.rangeSkip), ...replacements]
        .filter((o) => o.done),
    /** Additions whose scope names a provision that isn't in the tree shown. */
    unplacedAdditions: () => additions.filter((o) => !o.done),
    /** …and replacements whose provision is not in the tree being shown. */
    unplacedReplacements: () => replacements.filter((o) => !o.done),
    /** Every replacement, so a report can split them by `inLaw` after the walk. */
    replacedOps: () => replacements,
    /**
     * A rewrite of the whole section, which has no node to hang a mark on.
     *
     * Marked done so `placed()` counts it — the pane states it at the top of the
     * provision, which is what "dealt with" means for this shape. `inLaw` is
     * judged against the whole provision here and that is the right haystack for
     * once: the claim IS about the whole of it.
     */
    wholeSectionRewrite: () => {
      const op = replacements.find((o) => o.wholeSection);
      if (!op) return null;
      if (!op.done) {
        op.done = true;
        op.inLaw = rewriteInForce(fullText, op.text);
      }
      return op;
    },
    /**
     * Inserts already in the law, marked where they now sit.
     *
     * Read by the panel so it can say "already in force" rather than "shown
     * above": both are true, and only one of them tells the reader that the
     * words in front of them are not a proposal.
     */
    enactedInserts: () => work.filter((o) => o.enacted),
    /**
     * Operations whose address does not exist in this provision at all.
     *
     * Deliberately drawn nowhere — see reScope() — but they are the one outcome
     * the reader most needs told, because the bill plainly says it changes
     * something and the page would otherwise be blank about it.
     */
    lostScope: () => scoped.filter((o) => o.scopeLost),
    /** Operations drawn at a shallower level than the bill addressed. */
    widenedScope: () => scoped.filter((o) => o.scopeWidened),
    /**
     * Additions the law already contains — the bill has been enacted.
     *
     * Asks `inLaw`, not `applied`, and the difference is the whole point.
     * `applied` is set inside additionsAt(), so it exists only once the renderer
     * has laid out the node that addition is scoped to — which makes "has this
     * amendment already happened?" depend on what the reader happens to be
     * looking at. `inLaw` is decided at construction against the whole
     * provision, for exactly the reason stated where it is computed.
     *
     * The Fiscal Responsibility Act is the shape of it. It strikes ``and'' at
     * the end of 2 U.S.C. 901(c)(7)(B) and inserts paragraphs (9) and (10)
     * after paragraph (8); the Code holds both new paragraphs, so the amendment
     * is demonstrably in force. But the insertion is scoped to (c)(8), and a
     * reader who clicked "paragraph (7)(B)" is shown (c)(7) — so additionsAt()
     * was never asked about (c)(8), `applied` was never set, and the one strike
     * is three characters long and so cannot vouch for anything either (see
     * `distinctive`). With both sources empty the panel fell through to
     * "⚠ not found verbatim … usually means the amendment targets a different
     * subsection than the one shown", about a strike whose subsection is
     * exactly the one shown, with the proof sitting in `fullText` unread.
     *
     * A range addition is excluded for the same reason additionsAt() refuses to
     * draw one: it belongs at the end of the Act, so whether this section
     * contains its language is a question about the wrong provision.
     */
    appliedAdditions: () => additions.filter((o) => o.inLaw && !o.rangeEnd && !o.newSection),
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
 *
 * The block's own paragraph openers come off first, and they are the reason this
 * test kept failing on blocks the law plainly contained. GPO opens EVERY
 * paragraph of a multi-paragraph addition with a quote mark and closes only at
 * the very end — so the bill writes
 *
 *   ``(9) for fiscal year 2024--
 *       ``(A) for the revised security category, $886,349,000,000 …
 *
 * where the Code has no quote mark before (A) at all, and `fold` faithfully
 * turns that opener into a `"` that the law can never match. Those marks are the
 * convention's structure, not the provision's words. Only an opener at the head
 * of a line is removed: a quoted term inside the sentence is content, and both
 * single conventions take two characters, so a lone apostrophe is left alone.
 */
/**
 * Does this provision already read the way the bill rewrites it?
 *
 * A whole-provision rewrite needs a different test from `alreadyIn` and the
 * reason is length. `alreadyIn` matches the first 80 folded characters, which
 * identifies a short added block and is exactly wrong here: a rewrite is
 * usually a near-copy of the old provision with one clause changed, so its
 * opening 80 characters match whether or not the change has happened. What
 * separates the two is the whole of it.
 *
 * So: what share of the new text's words does the provision already contain?
 * Measured over the corpus, the populations separate sharply — of 541
 * replacements whose provision resolves, 411 sit at 95% or better and the
 * samples there are exact matches, while the tail below 70% is genuinely
 * different text. There is no middle to speak of.
 *
 * Words of three letters or more, so the statutory scaffolding ("of", "the",
 * "any") cannot carry a match on its own, and at least eight of them, because
 * below that a short provision matches anything of its kind. A false positive
 * here tells the reader a pending rewrite has already happened, which is this
 * app's worst category, so the threshold is set where the measurement put the
 * gap rather than where it would score best.
 */
const REWRITE_MATCH = 0.95;
const REWRITE_MIN_WORDS = 8;
function rewriteInForce(provisionText, block) {
  if (typeof provisionText !== 'string' || !provisionText) return false;
  const words = (s) =>
    fold(String(s).replace(BLOCK_OPENERS, '$1$2')).norm.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const want = words(block);
  if (want.length < REWRITE_MIN_WORDS) return false;
  const have = new Set(words(provisionText));
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  return hit / want.length >= REWRITE_MATCH;
}

const BLOCK_OPENERS = /(^|\n)([ \t]*)(?:``|‘‘|["“])/g;
function alreadyIn(fullText, added) {
  if (typeof fullText !== 'string' || !fullText) return false;
  const needle = fold(String(added).replace(BLOCK_OPENERS, '$1$2')).norm.trim().slice(0, 80).trim();
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
      // `mark` distinguishes language being REMOVED from language this bill
      // already added. Both are spans over text that is on screen, which is why
      // they travel together and share the overlap rule; only the colour and
      // the claim differ.
      push(d.mark || 'del', text.slice(d.start, d.end));
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
