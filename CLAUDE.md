# Bill Companion — working notes

Handoff notes for whoever picks this up. `README.md` describes what the app does
and is written for a user; this file is for changing it. Read both.

---

## Run / test / ingest

```bash
python tools/serve.py                    # http://localhost:8000  (NOT file://)
bun tools/selftest.mjs                   # 248 checks, no dependencies
bun tools/rendertest.mjs                 # 132 checks, needs `bun add -d linkedom`
bun tools/corpus.mjs                     # 30 real bills, diffed against a baseline
bun tools/impact.mjs                     # not a test — prints what one bill parses to
python tools/ingest_usc.py --titles all  # ~11 min; skips titles already present
```

On a machine that has never run this, four of the above are prerequisites rather
than commands you reach for — see **Notes for future Claude** below.

Three different jobs, and they are not interchangeable:

- **selftest / rendertest** assert fixed numbers about the four fixtures in
  `samples/`. These must pass.
- **`tools/corpus.mjs`** runs thirty real bills — including several too large to
  ship — and diffs every metric against `corpus/baseline.json`. Its question is
  "did that change do anything I didn't intend?", across bills nobody wrote
  assertions for. Most parser changes should move nothing here. When something
  does move, *explain it before* `--update`; the fixes in the last pass were
  each accounted for to the unit (`+8 amendments = 2 instructions × 4 listed
  provisions`) before the baseline was touched. `bun tools/corpus.mjs fetch`
  downloads the bills; `bun tools/corpus.mjs <id>` prints one in detail.
  `corpus/files/` is gitignored and `serve.py` 404s `/corpus/`, so none of it
  reaches the site.
- **`tools/impact.mjs`** is the impact script: one bill, everything about it,
  including U.S. Code resolution (which corpus deliberately excludes, since
  those numbers move whenever the Code is re-ingested). `--misses` lists what
  didn't resolve.

`tools/measure.mjs` holds the metric definitions the last two share. Keep it that
way — a metric that means something slightly different in two reports is worse
than no metric.

- `bun` lives at `C:\Users\kelle\.bun\bin\bun.exe`. **Node is not installed** —
  don't reach for `npm`/`node`.
- Python 3.13 is on PATH.
- The app itself has **zero runtime dependencies**. `linkedom` is dev-only, for
  the DOM tests. Keep it that way — no build step is a feature here.
- Not a git repo. `data/usc/` (~300 MB), `corpus/files/` (33 MB) and
  `node_modules/` are gitignored — see "Notes for future Claude" below.

**State:** U.S. Code fully ingested — 53 titles (1–52 and 54; title 53 is
reserved and does not exist), 60,436 sections, release point `119-102`. CFR is
fetched live from eCFR and is deliberately *not* ingested.

The count was 60,809 before the note-quoting bug below was fixed; 366 of those
were not sections of the Code at all. If you re-ingest and the number climbs back
toward 60,809, `is_code_section()` has been weakened.

---

## Notes for future Claude

Written on the move from Keller's laptop to his desktop, 2026-08-01. If you are
reading this on a fresh machine, start here.

### Four things are not in the repo

They are gitignored because they are large and regenerable, and **nothing works
without them**. In this order:

```bash
bun add -d linkedom                      # dev-only; rendertest.mjs needs a DOM
python tools/ingest_usc.py --titles all  # ~11 min, ~300 MB, 53 titles / 60,436 sections
bun tools/corpus.mjs fetch               # 26 bills, 33 MB, into corpus/files/
python tools/serve.py                    # must be RUNNING; shards are fetched over HTTP
```

The ingest is the long one and the app is useless without it — every citation
resolves to "couldn't load the U.S. Code index". Release point `119-102`; if the
ingester picks up a newer one the corpus baseline still holds, because corpus
metrics are deliberately parse-only and never touch resolution.

The four bills in `samples/` **are** tracked and are the fixtures selftest and
rendertest assert against; the other 26 corpus bills are fetched.

### Verifying the move actually worked

```bash
bun tools/selftest.mjs      # all 248 checks passed
bun tools/rendertest.mjs    # all 132 render checks passed
bun tools/corpus.mjs        # no deviation from baseline across 30 bills
```

That third line is the real check. `corpus/baseline.json` is tracked, so a clean
run after a fresh ingest and fetch proves the new machine produces byte-identical
parses of 35 MB of real bills — not merely that the code runs. If it deviates,
diff before assuming the move is at fault: the same command reports which metric
moved on which bill.

### What in this file is about the old machine

Paths and tooling were the laptop's — `bun` at `C:\Users\kelle\.bun\bin\bun.exe`,
the project under `C:\Users\kelle\Documents\code\bill-companion`, Python 3.13 on
PATH. Re-derive rather than assume.

**Re-test the Chrome gotcha below before repeating it.** On the laptop the agent
tooling could not reach localhost, which is why the note says no one has ever
seen this UI render except Keller. If Chrome reaches localhost on the desktop,
that unblocks visual verification — the single largest hole in this project, and
the source of both of the bugs screenshots have caught so far.

### How Keller works, learned the slow way

- **Fix, don't just report.** "Identify errors" has consistently meant "and fix
  the clear ones". Deliver the whole thing, then say what you left and why.
- **Explain every corpus deviation before `--update`.** Account for it to the
  unit — `+8 amendments = 2 instructions × 4 listed provisions` — and check the
  composition, not just the total. A number that moves by the amount you expected
  for a reason you didn't is still a bug.
- **Counts are not enough, and this is the big one.** Every metric stayed green
  while a strikethrough was being drawn on the wrong subsection. The findings
  that mattered came from reading a *referrer* beside its *referent* and asking
  whether a lawyer would agree. Keller asks for this directly ("sanity-check N
  identifications"); do it unprompted too.
- **Wrong beats blank, and blank beats wrong.** A confidently incorrect provision
  is the worst output this app has. Several guards exist only to decline —
  `atEnd` must really be at the end, a chapter number is never a section number,
  ambiguity inside a table of contents keeps you in the table. Prefer showing
  nothing and saying why.
- **Screenshots find what tests can't.** Twice a screenshot exposed something no
  assertion could have: the diff on the wrong pane, and the redline unreachable
  from a citation chip. Ask for one after any UI change.

### Where things stand

The parser is in good shape against 30 real bills, 35 MB, ~5,400 amendments at
88% targeted and 3.0% of amendatory verbs unaccounted for. The open items below
are ranked; items 1–3 are the substantive ones. The largest known *functional*
gap is not in that list because it is a feature rather than a defect: **`by
adding at the end the following:` captures no text at all** (2,205 occurrences →
1,713 ops → 0 carrying the added language), so the commonest way a bill creates
new law is invisible in the redline. That is the first thing to build.

---

## Environment gotchas (all cost real time already)

- **Chrome cannot reach localhost from the agent tooling here.** `navigate` +
  `screenshot` returns "Frame is showing error page" while `curl` and PowerShell
  both get 200, and the server log shows *zero* requests from Chrome. Don't
  re-litigate this. Verify rendering with `tools/rendertest.mjs` (linkedom) and
  ask the user for anything genuinely visual. **No one has ever seen this UI
  render except the user** — say so rather than implying otherwise.
- **PowerShell mangles quotes in `python -c "..."`.** Write a script file to
  `$CLAUDE_JOB_DIR/tmp` and run that.
- **`/tmp` in the Bash tool is invisible to native Windows Python.** Different
  filesystems; use the job tmp dir for anything crossing between them.
- PowerShell intermittently fails with `Starting the CLR failed with HRESULT
  80004005`. Transient — retry, or use the Bash tool.
- `tools/serve.py` reconfigures stdout to UTF-8 because a cp1252 console cannot
  encode the `→` in its banner and the server dies before it listens. Don't
  remove that.

---

## Invariants that keep getting broken

Each of these is here because violating it shipped a bug.

**Offsets are sacred.** `normalizeText()` runs exactly once, at ingest, and every
parser and renderer works on that same string. The bill renderer replaces `\n`
with a single `' '` — same character count — so citation offsets stay 1:1 with
the source and no remapping table is needed. Never introduce a transform that
changes length between extraction and rendering.

**`[hidden] { display: none !important }` must stay in `style.css`.** Author
rules like `.modal { display: grid }` beat the UA stylesheet's `[hidden]` at any
specificity, so without it `modal.hidden = true` does nothing and the paste
dialog sits invisibly over the whole page killing every click.

**`window.top` is always defined in a browser; its absence means "not a
browser".** The embed check is `window.self !== window.top`, guarded by
`if (!window.top) return false`. Without that guard a headless DOM — linkedom,
in `rendertest.mjs` — compares an object against `undefined`, reports every page
as embedded, and the whole embed path silently inverts. A cross-origin parent
throws instead, and the throw *is* the answer: still a parent.

**`window.__bcReady = true` must be the last statement in `main.js`.** The boot
diagnostic in `index.html` reads it; if it goes missing, a perfectly healthy page
reports "The app failed to start".

**One chip per citation.** `renderRange()` returns a consumed cursor, and a
citation overrunning a range is drawn *whole* with the caller skipping past it.
Clipping instead emits two half-chips for one citation.

**Paragraph boundaries are decided by text shape only.** Bending them to keep a
straddling citation intact silently cost section headings their `#sec-N` anchors
(`RE_HEAD` is `$`-anchored, so a merged multi-line paragraph stops matching).

**`slug()` must agree between `app/resolve/usc.js` and `tools/ingest_usc.py`.**
USLM writes dashed sections with an EN DASH (`77z–3`); bills cite them with an
ASCII hyphen. Both collapse every non-alphanumeric to `_`. Diverging here 404s
thousands of sections silently.

**`RE_AMEND_HEAD` is case-sensitive on purpose.** Bills write `Section 254 of the
… Act is amended` for targets but `SEC. 102.` for their own headings; an `i` flag
conflates them and anchors amendments to the wrong provision.

**Wrap before quantifying.** `` `${MARKER}+` `` applies `+` to the trailing
escaped paren. Use `` `(?:${MARKER})+` ``.

**Every quote convention, everywhere.** Four are in play: `` ``…'' `` (govinfo
plain text), `‘‘…’’` (GPO typeset PDFs — doubled *singles*), `"…"`, and `“…”`.
Any matcher that touches quoted language needs all of them. `QO`/`QC` in
`citations.js` knew two, which meant **zero** struck or inserted operands were
extracted from any PDF bill; `RE_PARA_START` in `render-bill.js` knew two, which
glued every inserted block onto the paragraph above it. A lone `’` stays a
non-delimiter — it is usually an apostrophe — so both single conventions take two
characters to open or close.

**A table of contents lists divisions in lines identical to the real headings.**
Both match `RE_DIVISION`, so every bill with one produced its divisions twice and
the last phantom stuck to the sections that follow the table. `parseBill` tracks
whether it is inside the table and asks whether the bill's *real body* follows —
a positive test, so ambiguity keeps it in the table. The scan steps over blank
lines, nested listings, and all-caps lines, because a typeset heading wraps
(`TITLE I—DEFINITIONS; RULE-` / `MAKING; EXPEDITED REG-` / `ISTRATION`) and page
furniture (`•HR 3633 EH1S`) sits in the same gap.

**Lazy tails inside a captured unit match their minimum.** `RE_AMEND_HEAD_UNIT`
captured `(?:\s+of\s+${AMEND_MIDDLE}{3,90}?)?` inside the group that becomes the
amendment's label, so the UI showed "Title I of the" and "Subchapter II of cha".
Leave the tail to the `middle` group — it covers the same span, so the head still
reaches the parenthetical U.S.C. cite that resolves the target — or make it
greedy where the phrase *is* the label, as for the table-of-sections form.

**Only a section with a `/us/usc/tN/s…` identifier is a section of the Code.**
Statutory notes reproduce whole sections of the Acts they describe, using the
same USLM `<section>` element, and a note attached above section level closes at
section depth 0 — so the depth guard never saw them. Quoted sections are numbered
from 1, so they landed on the filenames the title's own low-numbered sections use
and overwrote them. `t35/s1.json` held § 1 of the Patents for Humanity Program
Improvement Act, captioned with the Code's own part and chapter, presented as
35 U.S.C. § 1. 366 phantom sections, 245 of them on top of real law. The
identifier is the only reliable discriminator; a quoted "SEC. 1. SHORT TITLE." is
otherwise structurally identical to a real § 1.

**The manifest counts files, not writes.** It counted writes, so duplicate slugs
made it permanently disagree with the directory — which is exactly the signal
that would have exposed the above years earlier. `manifest.sections` must equal
`len(os.listdir(data/usc/tN))` for every title; if it doesn't, something is
overwriting something.

**A failed fetch is never cached.** `manifest()` and `loadSection()` memoise
their promises, and caching a *rejection* meant one dropped request — the dev
server not up yet — downgraded the page to "no title has been ingested", for
every title, permanently, with no retry even after the server came back. A 404 is
cached, because that is a real answer. A transport failure is not.

**The green/red diff belongs on the law, not on the bill.** It used to mark the
bill's own quoted operands in the left pane, which said only "the bill quotes
this phrase" — something the quote marks already said — and painted language
being *removed from the statute book* in the colour of something being added to
the page in front of you. `app/ui/redline.js` applies the ops to the provision in
the right pane instead. Don't reintroduce marks in `render-bill.js`.

**An amendment with no target reports that the bill changes nothing.** Across the
corpus that was true of a thousand instructions, in four families, none of them
actually ambiguous — and all four are now resolved in `extractAmendments`:

- a **Public Law** named as the target was not eligible to *be* one (only
  usc/cfr/act were), so "Section 1201 of Public Law 103-434 is amended" resolved
  to nothing. It is the last resort, after a real code cite;
- the **"Amendment of 1986 Code"** declaration, which licenses a whole tax
  division to write "Section 403(b) is amended" with no Act named. Scoped to the
  unit it names and read *every* time it appears — a bill declares it once per
  subtitle, and reading only the first left half the Inflation Reduction Act
  unresolved (41% targeted, against 78–100% for every other bill);
- **"of such title"**, which is how a title-10 bill avoids writing "of title 10,
  United States Code" three hundred times. The referent is the last U.S. Code
  citation before it;
- head forms nothing matched: **"The table of sections at the beginning of"**,
  and **lettered subtitles** — `[IVXLC0-9]` admits a letter only by the accident
  of I, V, X, L and C being roman digits, so Subtitle A, B, D … matched nothing.

Synthesised targets carry `implied` so the pane can say the Act was supplied by
context rather than written down. Two guards are load-bearing: only where the
instruction names no Act at all, and **sections only** — "Chapter 9 of such
title" synthesised as 10 U.S.C. § 9 points at a real, unrelated provision, which
is worse than the blank it replaces.

**A feature reachable from one control is unreachable.** The redline was
attached only when `onAmend` fired — the `▸ amends …` tag. Clicking a chip, which
is what readers actually do, and above all the composed address `clause (iv)`
pressed *because* they want to see what happens to clause (iv), resolved the
provision correctly and drew nothing on it. `amendmentFor()` in `citations.js`
now links a citation back to its instruction via `viaAmendment` or by being that
instruction's target. Whenever a feature depends on `opts` being threaded from
one call site, check every other way the user can arrive.

**An operation belongs to the provision its instruction walked to.** An
instruction is a walk — `in subsection (d)` → `in paragraph (2)` → `in
subparagraph (A), by striking ``or'' at the end` — and `scopeOps` binds each op
to the path of the last step written before it. Applied to the whole target
instead, that strike searched the entire section and drew a strikethrough
through subsection (e), a sentence the bill never mentions. The steps were
parsed and available the whole time; nothing was asking them. `apply(text, path)`
takes the path of the passage being drawn, and an op applies only at its own
scope or below.

**Assume the amendment may already have happened.** The Code is current, so an
*enacted* bill has usually been applied to it: the struck language is gone and
the inserted language is there. Drawing it anyway produced "for the 2018 crop
year, {+for the 2018 crop year,+} all of the producers" — the same words twice,
one of them coloured as a change. Three guards, each checking a claim the bill
itself makes: `at the end` must actually be at the end of the passage; an
insertion whose words already sit at the anchor is not drawn; and an amendment
none of whose strikes can be found is stale in full, so its insertions are
withheld too. Expect the redline to cover ~75% of a pending bill's amendments
and ~20% of an enacted one's — that gap is the feature working, not failing.

**A redline matches on folded text and marks whole words.** The bill and the
Code never spell a passage identically — ``…'' vs ‘‘…'' vs curly doubles, and a
PDF operand carries a line break the Code text does not — so `fold()` normalises
quotes, case and whitespace runs while keeping an index back to the original
offsets, which is what lets the mark land on real characters. Matching is
word-bounded: bills strike operands as short as `or`, and a plain `indexOf`
struck the "or" inside "for". One occurrence is marked, not all — `each place it
appears` and `at the end` are the two cases where the bill says otherwise, and
`at the end` takes the *last* match.

**An internal cross-reference is scoped to its parent, not to the nearest
match.** `locateInternal` finds where "clause (ii)" points by walking back to the
nearest line-start marker *shallower* than the reference and searching only
inside that span. Choosing the nearest matching marker instead is the obvious
implementation and is wrong in exactly the interesting cases: in `(B) ASSOCIATED
PERSON OF A DEALER — (i) IN GENERAL. Except as provided in clause (ii)`, the
nearest `(ii)` belongs to the *broker* subparagraph above and the one meant is
below. Direction is not a tiebreak either — references point forward about as
often as back. Depth comes from marker *style* (`(a)` `(1)` `(A)` `(i)` `(I)`
`(aa)` `(AA)`), because indentation does not survive PDF extraction; and the
quote openers must be in the line-head pattern, since the markers that matter are
inside quoted inserted law.

**Subsection depth comes from the unit word, not the outline.** `subsection` <
`paragraph` < `subparagraph` < `clause`. Each step *replaces* the running path
from its own depth down, so a later `subsection (c)` truncates rather than
appending (`801(c)`, never `801(a)(2)(A)(c)`). Levels carry semantic depth
explicitly, because position and depth diverge when a bill skips a level.

**Navigation vs reference.** `in X —` moves the cursor; `after clause (i)` /
`by redesignating clauses (ii) and (iii)` resolve against it without moving it.
Navigation is only recognised at an instruction head (`isInstructionPosition`) —
otherwise a cross-reference inside quoted *inserted* text reparents everything
after it.

**Nothing inside quoted inserted law is an instruction or a Code address.** That
guard used to be `isInstructionPosition` alone, which covers navigation and not
references — so half the rule was missing. New law refers to itself constantly,
and every one of those was composed against the enclosing instruction's target:
"For purposes of subparagraph (A)", in a paragraph the bill is *adding*, became
7 U.S.C. 8101(3)(A) — a real provision about something else. Corpus-wide it was
roughly 40% of all composed addresses. `isInstructionPosition` missed navigation
too, wherever a quoted line put a reference after a dash: ``` ``(3) Definition of
exit.--In paragraph (2), the term `exit' ``` read as a navigation step and
reparented every address after it.

The state is per-line and sticky, because GPO opens each quoted *paragraph* with
a quote mark and closes only at the end of the whole block — the reference that
exposed this sat on a continuation line carrying no quote mark at all. Left
unresolved, these stay `internal`, and `locateInternal` finds them where they
really are: a few lines up, inside the same quoted block.

**`resolve()` memoises by citation.** Shallow-copy before attaching `effect` or
`relative`, or one instruction's amendment preview leaks onto an unrelated click.

**`sectionsMatchCode` belongs to the IRC and nothing else.** IRC § 45K really is
26 U.S.C. 45K. SSA § 1861 is 42 U.S.C. 1395x — a wrong section is worse than no
section.

---

## Testing discipline

Weak assertions have hidden more bugs here than missing tests:

- `blocks > 0` let one amendment block stand in for eleven. Bound counts on
  **both** sides.
- `headings > 5` let a heading silently lose its class. Assert exact equality
  against `bill.sections.length`.
- Length-ratio checks measure UI chrome, not correctness. Count occurrences of
  distinctive phrases instead.
- The impact script (`amendments / steps / inert refs resolved`) caught two wrong
  *outputs* that passed every unit test. Re-measure after touching extraction.
- A fixture that doesn't exercise a feature is not coverage of that path. The
  only PDF fixture was a *freestanding* Act, so "the PDF path is tested" was true
  and meaningless: no test had ever read an amendment out of a PDF, and none
  could — every quoted operand was being dropped. Ask what a fixture *cannot*
  fail at.
- Count the source, then assert against it. `20 amendments` is only meaningful
  next to `20 amendatory verbs in the text, 0 outside any parsed amendment`; the
  same shape caught the missing whole-title targets and the doubled divisions.

`tools/rendertest.mjs` also runs a **CSS/markup contract** check, because
linkedom has no cascade and that whole class of bug is otherwise invisible.

---

## TODO / open items

1. **"Subsection (c) of such section is amended" is unseen** — 57 instructions,
   almost all in the NDAA. No section number appears at all: both the section and
   the title have to come from context, and the nearest preceding citation is
   often a *quoted operand* ("…inserting ``section 3401''.") rather than the
   provision meant, so carrying it forward would attribute the change to the
   wrong section. Doing this properly means carrying the enclosing instruction's
   own target rather than the nearest citation.
2. **A tail of one-off amendatory phrasings is still unseen.** 173 across the
   twenty-bill corpus — 3.0% of all amendatory verbs, and 110 of them in the
   NDAA alone. Shapes with no shared structure: "the Act entitled ``An Act to
   render immune from seizure…'' (22 U.S.C. 2459; 79 Stat. 985)", "The heading of
   such section", "The sixth sentence of section 7(m) of title 4", "Subpart A of
   part IX of subtitle C of title I of Public Law 115-97". To find them again:
   walk every `is amended` not inside a parsed amendment, take the ~70 characters
   before it, normalise digits and markers to `N`/`(X)`, and cluster — every
   systematic cause has stood out immediately as a double-digit count. What is
   left is genuinely long-tail, and each further fix risks the middle running
   somewhere it shouldn't.
3. **Appropriations acts lose almost all their sections.** `RE_SECTION` is
   case-sensitive, which is what stops a table of contents from producing a
   phantom section for every line it lists — but appropriations bills write
   their *real* headings in the same sentence case, "Sec. 101. Notwithstanding
   any other provision…". H.J. Res. 31 (Consolidated Appropriations Act, 2019)
   yields 11 sections from 1.5 MB, against 505 sentence-case headings in the
   text. Everything keyed to sections degrades there: the jump menu, the `#sec-N`
   anchors, and which section an amendment is attributed to. Distinguishing the
   two needs the same trick `parseBill` already uses for divisions — ask whether
   the bill's real body follows — rather than case alone.
4. **`in the matter preceding subparagraph (A)`** still falls through to the
   inert internal-ref note. It names a position between provisions, not a
   subtree; resolving it to the neighbour would be subtly wrong.
5. **Relative refs are only exercised against USC targets.** `expandRelativeRefs`
   accepts CFR targets too, but nothing tests that path.
6. **Seven section numbers in the Code are duplicates.** Two different Public
   Laws each added a "§ 3598", and one section is a combined range ("§§ 2891,
   2892"). One shard per number means the second wins: 5 U.S.C. 3598 and 5757,
   10 U.S.C. 130g and 2892, 28 U.S.C. 1932, 38 U.S.C. 1167, 40 U.S.C. 3318. The
   ingester now logs each one and records them under `duplicates` in the
   manifest, so the loss is known rather than silent, but the resolver still
   shows only one of the two. Fixing it properly means a shard format that holds
   a list.
7. **Hyphenated headings stay broken** (`CAT-` + `ASTROPHIC`). Documented in
   README as a known limit — body text rejoins, headings can't, because the
   lowercase-continuation signal is gone in all-caps.
8. **CFR part views cap at 40 sections**, silently beyond that.
9. **Popular names cover ~46 Acts**, not the full OLRC table. The Commodity
   Exchange Act was missing until the CLARITY Act pass, where it was the single
   most-cited Act in the bill — 52 cites resolving to nothing. When a sample
   leans on an Act, check the table first.
10. **Share links are long** — 117 KB bill → 35 KB URL. Fine in a doc or ticket,
   wraps in chat/mail. Shorter would need a backend, which is a different product.
11. **No visual verification has ever happened.** Colours, spacing, dark mode, the
   green/red diff — all unconfirmed by anyone but the user.

---

## Layout

```
index.html            UI + boot diagnostic (classic script, runs when modules fail)
embed-example.html    host page for trying the iframe embed; not part of the app
app/main.js           wiring; ingest() is the single entry point for bill text
app/share.js          fragment-encoded share links (deflate + base64url)
app/parse/            pdf.js · bill.js · citations.js   (extraction)
app/resolve/          cfr.js (live eCFR) · usc.js (local shards) ·
                      internal.js (refs within the bill) · provision-tree.js ·
                      popular-names.js · index.js (dispatch)
app/ui/               render-bill.js · render-context.js · redline.js · style.css
tools/                ingest_usc.py · serve.py · selftest.mjs · rendertest.mjs ·
                      measure.mjs (shared metrics) · impact.mjs · corpus.mjs
corpus/               corpus.json + baseline.json (tracked) · files/ (not)
data/usc/             generated shards, one JSON per section; gitignored
```

Citation kinds: `usc` `cfr` `publaw` `stat` `act` `internal`. Relative addresses
are `usc`/`cfr` with `relative: true` and ids prefixed `r`.
