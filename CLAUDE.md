# Bill Companion — working notes

Handoff notes for whoever picks this up. `README.md` describes what the app does
and is written for a user; this file is for changing it. Read both.

---

## Run / test / ingest

```bash
python tools/serve.py                     # http://localhost:8000  (NOT file://)
node tools/selftest.mjs                   # 645 checks, no dependencies
node tools/rendertest.mjs                 # 405 checks, needs `npm i -D linkedom`
node tools/corpus.mjs                     # 30 real bills, diffed against a baseline
node tools/impact.mjs                     # not a test — prints what one bill parses to
node tools/coverage.mjs                   # not a test — what the redline actually draws
python tools/ingest_usc.py --titles all   # ~5 min; writes per-section shards
node tools/ingest_plaw.mjs                # 26 Public Laws; skips those present
node tools/bundle.mjs --prune             # shards -> 159 bundles, verified, then deleted
```

`bun` should be interchangeable with `node` for all four `.mjs` tools — but only
`node` has been run since the portability fix. See **Which runtime** below.

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
  `corpus/files/` is **tracked**, and `serve.py` no longer refuses `/corpus/`.
  It used to, so the local server would show exactly what a deploy showed —
  sound reasoning whose premise was "nothing in the app links to them", and
  `samples/library.json` now does. A deploy serves whatever is in the repo, so
  refusing them locally stopped making the two agree and started making them
  disagree, in the direction that hides a broken link from the only person who
  runs this locally. That is a deliberate trade for a
  self-contained repo: the bills are U.S. Government works and not copyrighted,
  and nothing in the app links to them. If that ever needs reversing, the fix is
  to move the corpus out of the published tree, not to re-ignore it — an ignored
  corpus is one a fresh machine silently runs zero bills against.
- **`tools/impact.mjs`** is the impact script: one bill, everything about it,
  including U.S. Code resolution (which corpus deliberately excludes, since
  those numbers move whenever the Code is re-ingested). `--misses` lists what
  didn't resolve.

`tools/measure.mjs` holds the metric definitions the last two share. Keep it that
way — a metric that means something slightly different in two reports is worse
than no metric.

### Which runtime

**Re-derive this; it has been different on all three machines so far.** The
laptop had `bun` and no Node; this desktop (`C:\Users\Nemo\…`) has Node 24 and
`npm` and no `bun`. Check before assuming, and don't edit the tools to hard-code
either one.

Node works now, which was not true until 2026-08-01. Its ESM loader rejects a
bare Windows path — `import('C:\…')` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`,
"Received protocol 'c:'" — while bun accepts one. `rendertest.mjs` already went
through `pathToFileURL`; `selftest.mjs`, `impact.mjs` and `measure.mjs` did not,
so three of the four tools ran only under bun while the README claimed "node
works too". They all use the same `imp()` helper now. Keep it that way, and
note that `corpus.mjs` inherits the problem through `measure.mjs` rather than
having any dynamic import of its own.

**The bun path is untested since that change.** A `file://` URL is the portable
form and bun accepts it, so this should be strictly more compatible, not less —
but bun is not installed on this machine and nobody has run it. If you are on a
bun machine, run all four and fix the note rather than trusting it.

- Python 3.13 is on PATH.
- **`npm install` from a subdirectory walks up.** `package.json` is tracked now,
  which is the fix. Before it was, `npm i -D linkedom` here installed into
  `C:\Users\Nemo\package.json` — the user's home directory, next to an unrelated
  dependency of theirs. If it ever goes missing, create it *before* installing.
  It sets `"type": "module"`, which also silences Node's reparse warning on
  every `app/**/*.js`.
- The app itself has **zero runtime dependencies**. `linkedom` is dev-only, for
  the DOM tests. Keep it that way — no build step is a feature here.
- A git repo, on `main`, pushed to `origin` (`github.com/khs/bill-companion`)
  and deployed from the branch to GitHub Pages. **Push by default** — the user
  wants to look at changes live, and there are no users to break. Only
  `node_modules/` is gitignored: the ingested Code and the corpus bills are both
  tracked, because the shards *are* the site. See below.

**State:** U.S. Code fully ingested — 53 titles (1–52 and 54; title 53 is
reserved and does not exist), 60,436 sections, release point `119-102`. CFR is
fetched live from eCFR and is deliberately *not* ingested.

The count was 60,809 before the note-quoting bug below was fixed; 366 of those
were not sections of the Code at all. If you re-ingest and the number climbs back
toward 60,809, `is_code_section()` has been weakened.

---

## Notes for future Claude

Written on the move from Keller's laptop to his desktop, 2026-08-01, and
re-verified the same day on a *second* desktop (`C:\Users\Nemo\Documents\Coding\
bill-companion-main`) — which is where the runtime differences above turned up.
If you are reading this on a fresh machine, start here.

### What a fresh clone still needs

Almost nothing, now that the Code and the corpus are tracked — a clone arrives
with all 159 data bundles and all 26 corpus bills. Two steps remain:

```bash
npm i -D linkedom                        # dev-only; rendertest.mjs needs a DOM
python tools/serve.py                    # must be RUNNING; shards are fetched over HTTP
```

The regeneration commands are for when the *inputs* change — a new release
point, or a new bill in `corpus.json` — not for setting up a machine:

```bash
python tools/ingest_usc.py --titles all  # ~5 min, 322 MB, 53 titles / 60,436 sections
node tools/corpus.mjs fetch              # 26 bills, 34 MB, into corpus/files/
```

The ingest also writes `data/usc/acts/` (2,730 files, 0.7 MB), the Act-section →
Code-section index, by reading every shard's source credit back off disk. That
pass is ~4 min cold and ~12 s warm, and `--acts-only` runs it alone when the
shards are already there — which is what to use after changing how credits are
parsed, since it downloads nothing.

(Or the `bun` equivalents — `bun add -d linkedom`, `bun tools/corpus.mjs fetch`.
Create `package.json` before the npm one; see **Which runtime** above.)

The ingest is the long one and the app is useless without it — every citation
resolves to "couldn't load the U.S. Code index". Release point `119-102`; if the
ingester picks up a newer one the corpus baseline still holds, because corpus
metrics are deliberately parse-only and never touch resolution.

The four bills in `samples/` **are** tracked and are the fixtures selftest and
rendertest assert against; the other 26 corpus bills are fetched.

### Verifying the move actually worked

```bash
node tools/selftest.mjs     # all 534 checks passed
node tools/rendertest.mjs   # all 284 render checks passed
node tools/corpus.mjs       # no deviation from baseline across 30 bills
```

That third line is the real check. `corpus/baseline.json` is tracked, so a clean
run after a fresh ingest and fetch proves the new machine produces byte-identical
parses of 34 MB of real bills — not merely that the code runs. If it deviates,
diff before assuming the move is at fault: the same command reports which metric
moved on which bill. It came up clean first try on this machine, and the ingest
reproduced 60,436 sections at `119-102` exactly, with `manifest.sections ==
len(listdir)` holding for all 53 titles.

### What in this file is about the old machine

Paths and tooling were the laptop's — `bun` at `C:\Users\kelle\.bun\bin\bun.exe`,
the project under `C:\Users\kelle\Documents\code\bill-companion`. **Re-derive
rather than assume**; the third machine matched none of it. Python 3.13 on PATH
is the only part that has held.

**The Chrome gotcha is unresolved, for a new reason.** On the laptop the agent
tooling could not reach localhost. On this machine there is no browser tooling
available at all — no Chrome, Playwright or screenshot tool in the session — so
the question could not even be re-tested. `curl` reaches the server fine (`/`
200, a shard 200, `/corpus/` correctly 404). Visual verification remains the
single largest hole in this project and the source of both of the bugs
screenshots have caught. **No one has still ever seen this UI render except
Keller** — say so rather than implying otherwise.

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

The parser is in good shape against 30 real bills, 34 MB, ~5,400 amendments at
88% targeted and 3.0% of amendatory verbs unaccounted for. The open items below
are ranked; items 1–3 are the substantive ones.

**Structure and cross-references, 2026-08-02.** Prompted by "section 123 of the
Fiscal Responsibility Act doesn't understand where it is or what the context
is", which turned out to be two unrelated bugs meeting in one section. Every
change below is asserted in `selftest.mjs` or `rendertest.mjs` (286 → 328 and
155 → 167 checks); the corpus moved only where noted.

- **Markers manufactured by the 72-column wrap** (`app/parse/outline.js`, new).
  1,093 across the 23 plain-text corpus bills. **1,485 internal references now
  point somewhere else** and 1,115 fewer are flagged ambiguous. 101 references
  stopped resolving at all, and that is the fix working: every one sampled had
  been pointing at the tail of a wrapped phrase — six ACA references to
  "subsection (d)" all landed on the `(d)` in "a subsection\n(d) hospital",
  which is a defined term, not a provision. The same phantom was splitting
  sentences into two paragraphs in the left pane (570 → 566 on the sample bill,
  four boundaries, each one verified by hand).
- **Sections know where they sit.** `ancestors` is a stack now, so section 123
  reports `DIVISION A—LIMIT FEDERAL SPENDING › TITLE III—BUDGET ENFORCEMENT IN
  THE SENATE` instead of a `TITLE III` that could have been any of three. Shown
  as a breadcrumb in the section head and as `<optgroup>`s in the jump menu.
- **Headings are whole.** The `--` separator bug (every plain-text heading began
  with a stray hyphen) and wrapped headings, in both panes.
- **Appropriations sections exist.** +2,139 sections across the corpus, 11 → 659
  on H.J. Res. 31 and 39 → 120 on the sample bill. This is the only change that
  moved the corpus: 11 bills' `sections` plus one `divisions` on H.R. 1865
  (`DIVISION I—EXTENSIONS`, which could never prove itself while
  `realBodyFollows` accepted only caps headings). No bill's citations,
  amendments or diff spans moved at all. Every new section was checked to be an
  indented sentence-case heading and none flush left, per bill, before
  `--update`.

**Public Laws now show text, 2026-08-02.** Two mechanisms, deliberately
complementary — see the invariants for the ordering rule:

- **`data/usc/acts/` already held 1,737 Public Laws.** Nothing had to be
  downloaded; the ingester has been filing sections under `pub_l_<c>_<l>` all
  along and nothing was asking. "Section 12306 of Public Law 113-79" → 7 U.S.C.
  1632c. 174 of 507 sectioned citations, over 79 distinct Code sections.
- **`data/plaw/` holds twenty-five laws in full**, sharded per section number
  by `tools/ingest_plaw.mjs` (106 MB, 14,386 files). This is for the 333 sectioned
  citations the Code cannot reach — appropriations lines, effective dates,
  savings clauses, which were never codified and never will be.

Across the corpus, **1,357 of 3,307 Public Law citations (41%) now show real
text against none before**, and 306 of 507 sectioned ones (60%). The remaining
59% are laws outside the twenty-five, which stay outbound links.

Do not expect a threshold to appear if you add more laws. Ten cover 24% of
citations, twenty-five reach 37%, and there are 602 distinct laws in the corpus
— the return is close to linear the whole way down. Add a law when a sample
leans on one, the way `popular-names.js` grew.

Two things found on the way that were not part of the ask: `lead-in` in
`render-context.js` had been styled nowhere since the pane was written, and the
"rendered text preserves the source" check was a 5% length ratio. Both are
covered in **Testing discipline** below.

**`by adding at the end the following:` now carries its language** (2026-08-01).
This was the largest known functional gap — the commonest way a bill creates new
law, invisible in the redline because the op recorded that an addition happened
and nothing about what was added. Across the corpus: 2,601 → 2,851 ops, of which
**2,850 now carry the added text and 1 declines**, against 0 before. The op count
rose because a single instruction routinely adds in more than one place and a
lone boolean collapsed those into one. What was built:

- `readAddedBlock()` in `citations.js` reads the quoted block, in all four
  conventions, from the *whole bill* rather than the instruction body — an added
  block is regularly longer than `MAX_AMEND_BODY` on its own.
- `scopeAdditions()` puts it beside the right siblings. See the invariant below;
  this was a real bug the counts could not have caught.
- `redline.js` gained `additionsAt(path)` and `render-context.js` draws the new
  provision after the last child of the level it joins, with the same
  already-enacted guard everything else here has.

Still open on this path: an addition is drawn only when the provision it follows
is on screen, and the `.node.added` block has never been *seen* (see the Chrome
note). The two-closer case in the invariant below under-captures 2 blocks in
3,253, and 4 phrases in the House CLARITY print sit outside any parsed
instruction — that is TODO 2, not this.

**Act section numbers now resolve** (2026-08-01), for four Acts. "Section 1861 of
the Social Security Act" opens 42 U.S.C. 1395x rather than the head of the Act.
The README had this listed as an inherent limit and it was not: the mapping is a
lookup table, and the Code states it on every section in `<sourceCredit>`. The
ingester inverts 60,436 credits into `data/usc/acts/` — **2,730 Acts**, of which
four are wired up because each needs its enacting credit bound by hand in
`popular-names.js` and checked: SSA (557 sections), PHSA (1,243), INA (163), CEA
(58). Turning on a fifth is one `enactedAs` field.

Across the corpus, **1,998 of 2,032 act-relative citations (98.3%) now reach a
real provision**, against none before — the ACA alone accounts for 733 of them,
landing on 199 distinct sections. `impact.mjs` prints this per bill as
`Act-relative cites`; it lives there rather than in the corpus because it is
resolution, and corpus metrics are deliberately parse-only.

The corpus did not move at all for this — same citation counts, same kinds, same
`overlaps: 0` and `badOffsets: 0`. The Act-relative citation simply spans more
text and carries `actSection`, and `dedupe()` already preferred the longer match
at equal rank.

Worth knowing before extending it: coverage is 59% of all shards, and the misses
are mostly Acts codified by a single enacting section (all of title 51 is
"Pub. L. 111–314, § 3"), which tombstone as ambiguous and *should*. 295 Act
sections are claimed by two Code sections and are dropped rather than guessed;
`acts/_conflicts.json` lists them.

---

## Environment gotchas (all cost real time already)

- **There is no way to look at this app from the agent tooling.** On the laptop
  Chrome could not reach localhost: `navigate` + `screenshot` returned "Frame is
  showing error page" while `curl` and PowerShell both got 200 and the server log
  showed *zero* requests from Chrome. On the second desktop there is no browser
  tool in the session at all, so that could not even be re-tested. Either way:
  verify rendering with `tools/rendertest.mjs` (linkedom) and ask the user for
  anything genuinely visual. **No one has ever seen this UI render except the
  user** — say so rather than implying otherwise.
- **The govinfo quote convention breaks the host language, not just the
  parser.** ` ``…'' ` is two backticks and two apostrophes, and both halves are
  string delimiters somewhere. Writing a test fixture in a single-quoted JS
  string — `'…by striking ``a''.\n'` — the `''` closes the string early;
  writing a prompt inside a template literal, the ` `` ` closes the template and
  the rest parses as code ("… is not a function"). Both happened on
  2026-08-02, one in `selftest.mjs` and one in a workflow script. Use a
  different example in the literal, or escape it — the convention only has to
  be *exact* where the matcher sees it, never where the source does.
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

**Offsets are sacred — but the rule is about *when*, not about length.**
`normalizeText()` runs exactly once, at ingest, and every parser and renderer
works on that same string. Never transform the text *before* slicing it: an
offset computed against one string and applied to another desynchronises
everything, and that is what this invariant exists to forbid.

Transforming a slice *after* it has been cut is a different act and is safe.
`inline()` in `render-bill.js` does exactly that, and it changes the rendered
length: a bill hard-wraps at ~72 columns and indents its continuation lines, so
a phrase broken across the measure carries both — "the Small\n
Business Administration" — and replacing only the newline left six stray spaces
through the middle of a phrase, which `white-space: pre-wrap` then rendered
faithfully because they really are in the source. 381,517 of 403,948 mid-phrase
runs across the corpus, and a run inside a citation chip on every wrapped cite.
Nothing maps a rendered position back to an offset — paragraph spans travel as
`data-start`/`data-end` attributes, not as character counts — so the slice is
the last safe place to do this, and the only place it is done.

Runs *not* touching a line break are left alone. govinfo double-spaces after a
colon ("available:  Provided"), and a bill's tables are aligned with runs of
spaces; that is the drafter's typography, not an artifact of the measure. The
paragraph's own leading indent survives for the same reason — nothing precedes
it, so no rule fires on it, and it carries the outline level.

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

**A marker at the head of a line may only be there because the line wrapped.**
Bills hard-wrap at about 72 columns, and a cross-reference broken across the
measure leaves its marker looking exactly like an outline marker:

```
    (4) Form of point of order.--A point of order under paragraph
(1) may be raised by a Senator as provided in section 313(e) of the
```

1,093 of these across the 23 plain-text corpus bills. Each is a phantom sibling
of the real marker and, being nearer, steals every later reference to it: in
section 123 of the Fiscal Responsibility Act two references meaning `(a)(1) In
general` landed mid-sentence inside paragraph (4). In the left pane the same
phantom split a sentence in half and dressed the back half up as a new
enumerated provision. The tell is the previous line's last word — a real marker
follows a line that ends a thought (`.`, `--`, `;`, `and`, `or`), a wrapped one
follows the bare unit word that introduces it, with no punctuation, because the
punctuation would have come *after* the marker. `app/parse/outline.js` owns the
test and both `internal.js` and `render-bill.js` ask it; a second spelling would
put resolution and rendering out of step. One exception is load-bearing: a
run-in heading (`(1) Federal land.--The term …`) is real even after a line
ending in a unit word — H.R. 2617 writes "In this section" with the colon
dropped. The corpus cannot see any of this, because its metrics are parse-only
and this is resolution and layout; `tools/selftest.mjs` asserts it directly.

**The ancestor chain is a stack, not a variable.** `parseBill` kept one
`division`, so `TITLE III` overwrote `DIVISION A`. A bill restarts its title
numbering inside every division — the Fiscal Responsibility Act has three
`TITLE I`s and three `TITLE III`s — so the label left behind named three
different places at once and section 123 could not say which. Each unit closes
every unit at its own rank or deeper (`DIVISION` > `TITLE` > `Subtitle` >
`CHAPTER`), and sections carry `ancestors` outermost-first.

**govinfo writes the em dash as `--`.** `DIVISION A--LIMIT FEDERAL SPENDING`,
against a separator class matching one character, left every plain-text bill
with headings reading `-LIMIT FEDERAL SPENDING`. The stray hyphen had been
asserted in selftest, which is how long it had been there. Match the pair before
the singleton.

**A heading that runs past the measure keeps going on the next line.** `SEC. 271.
TERMINATION … ON FEDERAL STUDENT` / `LOANS; RESUMPTION …` was cut at the break,
so the jump menu named a different provision than the section is about, and the
left pane stranded the tail as a caps-locked orphan of body text. A section
heading closes with a period and a division heading closes at the blank line —
that is the difference between the two continuation rules. Only an all-caps line
continues an all-caps heading, and the guard is by *shape* (a bulleted running
head, a bare folio) rather than "has two capitals in it", which threw away the
legitimate continuation `1933.` of `DEFINITIONS UNDER THE SECURITIES ACT OF`.
Continuation lines are read but never consumed, so every offset stays put. The
hyphens a typeset PDF breaks words on are kept, not closed up: `REG-ISTRATION`
shows a seam, but gluing it shut also glues `PAY-` / `AS-YOU-GO` into a word
that does not exist. That is still TODO 7; showing half a heading was not.

**`RE_HEAD` and `RE_DIV` are `$`-anchored with no `m` flag.** Match them against
a paragraph's *first line*, never the whole paragraph — once a heading absorbs
its wrapped tail, matching the merged string fails, and the symptom is not an
error but a section head silently rendered as body text with its `#sec-N` anchor
gone. Better still, don't re-derive: `parseBill` is the authority on what a
section is and `render-bill.js` reads its list.

**An appropriations bill sets its real headings in sentence case, and so does a
table of contents.** `Sec. 101. Notwithstanding any other provision of law…` is
a heading; `Sec. 101. Discretionary spending limits.` is a listing. Case cannot
separate them — which is why matching was case-sensitive and why H.J. Res. 31
yielded 11 sections from 1.5 MB — so **indentation** does: govinfo sets an entry
flush left and indents a real heading with the body it opens. In H.J. Res. 31
that splits 656 candidates into 7 entries and 649 headings with nothing in
between. Three further guards each cost real time: only the abbreviated `Sec.`
form, because a blanket `/i` reads the wrapped tail of "…under\nsection 1931." as
a heading and invented 12 sections in the ACA; only after the body has begun and
outside the table; and `realBodyFollows` must accept a sentence-case heading too,
or an appropriations division can never prove itself and the whole bill stays
"inside the table of contents". These sections are marked `runIn` — the heading
*is* the provision's first sentence, so it must not be uppercased or split off
from the rest of it.

**A section number is not unique.** Every division of an appropriations act
restarts at `Sec. 101`, so `#sec-101` names 259 different paragraphs in the
Consolidated Appropriations Act, 2019 and `getElementById` answers with the
first. The unique id `parseBill` already assigns goes on `data-sec`, which is
what the jump menu targets; `sec-N` is kept for the first of each number so
existing anchors still resolve.

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

**An enacted bill has still done something, and the pane has to show it.**
The guards below stop an already-applied amendment being drawn twice, and they
are right — but "nothing to draw" is not "nothing to say". Reading the Fiscal
Responsibility Act, an instruction that adds two subclauses to 2 U.S.C.
901(b)(2)(B)(i) drew nothing at all and the panel reported
"⚠ position not stated" and "not drawn into the text" about language sitting on
screen a few lines above. The point of the pane is inline visibility; that
delivered the opposite.

Three separate faults behind one symptom, all of them reporting rather than
placement:

- A structurally-placed insert lived in **both** `work` and `additions` as two
  separate objects. The additions copy was handled; the work copy was never
  marked done, so `unplaced()` reported a stranded insertion for one that had
  been dealt with. `work` now excludes them outright.
- The panel had no branch for such an op, so it fell through to the plain
  `insert` message — "position not stated" about an op whose position is the
  one thing it knows.
- A strike whose language is already gone was flagged "⚠ not found verbatim".
  That is the amendment having *worked*, and warning about it warns about the
  one thing that went right.

And the missing half: `appliedNodePaths()` names the provisions an enacted
addition created, from the added block's own leading markers, so `nodeEl` can
mark them `.was-added`. The reader now sees (XI) and (XII) ruled down the side
in the insertion colour, titled "Added by this bill — already in force" —
marked rather than coloured as an insertion, because nothing is being added to
the law on screen. The law reads that way *because* of this bill, which is
exactly what someone reading the bill wants to know.

`inLaw` is computed once, at construction, and asked **before** `stale`. Both
say "this already happened", but one is evidence about this very language and
the other an inference from the amendment's strikes; where a strike's operand
simply is not in the provision, asking staleness first reported an addition the
law demonstrably contains as one that could not be placed.

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

**The parent of a top-level subsection is the whole section, and some sections
are enormous.** The pane opens the cited provision's parent so it reads in
context, which is the point of the ladder — but 42 U.S.C. 603 is 58,000
characters across 323 nodes, so "section 403(c) of the Social Security Act"
opened all of it and left the reader to find (c). `defaultScope()` now measures
the candidate scope and falls back to the cited provision itself past
`SCOPE_BUDGET`: 603(c) renders 5,377 characters instead of 58,101, and
1395x(s)(2) renders 10,670 instead of 196,417. Measured in characters of
rendered text rather than node count, because that is what has to be scrolled
past — thirty one-line nodes are nothing and three thousand-word ones are not.

The pane also scrolls to the cited provision, and **not with
`scrollIntoView()`**: inside a scrollable pane that is implemented as "bring
this into the viewport", which in Firefox and Chrome also scrolls the page
behind it and moves the bill in the other pane. Adding the delta between the
two bounding rectangles moves this container and nothing else, and behaves the
same in all three browsers. The anchor has to be set in *two* places — the
focused node renders through `nodeEl` normally, but through the ancestor ladder
when the scope IS the focus.

**A note's heading is a child element, so `itertext()` eats it.** Every note in
the Code arrived with its heading glued to the front of its body —
"References in Text" + "Section 603(a)(5)(K)…" as
`References in TextSection 603(a)(5)(K)…`, "Amendments" + "2021—" as
`Amendments2021—`. `note_body()` skips the `<heading>` child and the heading is
stored beside the text. Notes with a heading and no body at all are dropped:
those are USLM's group dividers ("Editorial Notes", "Statutory Notes and
Related Subsidiaries"), which say nothing on their own and were consuming slots
among the ten notes kept per section.

**A `topic` attribute is a schema identifier, not a label.** The pane printed
them at the reader verbatim — "effectiveDateOfAmendment: Amendment by Pub. L.
113-128…", "historicalAndRevision: …", "referencesInText: …" — which tells
someone what XML it came out of and nothing about what they are looking at.
`NOTE_TOPICS` names the twenty that occur, `humanTopic()` splits anything else
into words rather than falling back to camelCase, and the note's **own heading
wins whenever it has one**: "Effective Date of 2014 Amendment" is specific to
that note where the topic is a category shared by two thousand others.

**A source credit is a list, and printing it as a paragraph destroys it.**
42 U.S.C. 603 carries 2,660 characters in 33 clauses; 15 U.S.C. 636 carries
7,427. As one block a reader scrolling into the middle sees
")(A), (B), (2)(V), June 18, 2008, 122 Stat. 1664" and has no way to tell what
it is supposed to mean. `parseCredit()` splits on the semicolons the OLRC
already puts there — first clause enacting, the rest amending, the same rule
the Act index is built on — and states the two facts that carry the value:
what enacted the provision, and when it was last touched. The other clauses go
behind a count. Where the enacting section is bracketed (`§ 2[7]`) the summary
shows the Act's own number, because that is what a bill cites.

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
section. The way to reach SSA § 1861 is `enactedAs` and the Act index below, not
by widening this flag: the flag *assumes* an equivalence, the index *looks one
up*, and only one of those can be right about the Social Security Act.

**The Code answers for a Public Law where it can; the law's own text answers
where it cannot, and the two must not be confused.** `data/usc/acts/` gives
*current* law — the section as it stands now, amendments and all — and
`data/plaw/` gives the law as enacted, a snapshot never updated. `index.js`
tries the Code first, because a reader asking about a provision almost always
wants what it says today, and `plawCard` states "As enacted" outright when it
falls through. Reversing that order would quietly serve superseded text to
someone who had no way to tell.

Two things about the shards. **One file per section NUMBER, holding a list** —
every division of an appropriations act restarts at 101, so "section 101 of
Public Law 116-6" names six provisions and one-file-per-section would have five
of them overwrite each other. That is exactly the shard-format problem TODO 6
still wants solved for the Code itself, and there was no reason to repeat it.
The pane shows all six under their divisions and says the citation does not
settle which; picking one would be a confident answer to an unanswerable
question. And **`<<NOTE: …>>` markers must be stripped at ingest**: govinfo
annotates the PLAW rendition with the Statutes at Large and Code cites for every
note it generated, written inline —

```
SEC. 3. <<NOTE: 1 USC 1 note.>>  REFERENCES TO ACT.
DIVISION A—DEPARTMENT <<NOTE: …Appropriations Act, 2019.>> OF HOMELAND SECURITY …
```

— which is apparatus wedged through the middle of a heading. They arrive as
entities, so tag-stripping does not touch them; they only become text once
`unwrapPre` decodes. Stripped in `ingest_plaw.mjs` rather than in `unwrapPre`,
because the enrolled bills in `corpus/files` contain **zero** and widening the
shared helper would put the corpus baseline at risk to fix a problem it does not
have.

**A Public Law's own text needs an outline drawn on it.** `data/plaw` stores a
section as the law prints it — hard-wrapped at 72 columns, indented by depth, one
string — and putting that string in one element rendered Pub. L. 117-2 § 2001 as
14,852 characters of solid text. The Code's sections arrive from USLM already
nested, so `nodeEl` has always had a tree to draw; `parseProvision()` in
`app/parse/outline.js` gives a Public Law the same one, off the only structure its
text carries: the markers at the heads of its lines. It defers to that module's
existing rules rather than restating them — a marker is skipped where
`isWrappedMarkerLine` says it is only there because a reference ran off the
measure, and a RUN of markers on one line opens two provisions.

The wrap's line breaks and indents are dropped with it, which is `inline()` from
`render-bill.js` and safe for the same reason: the slice has already been cut, so
no offset is computed against the result. A run of spaces NOT touching a line
break survives — that is the drafter's typography. Statutes at Large page
furniture (`[[Page 134 STAT. 1923]]`, wedged mid-sentence) goes too; it is the
same apparatus as the `<<NOTE: …>>` markers, and only stripped at render rather
than at ingest because the shipped shards already contain it.

**A named subdivision must show its provisions, not its table of contents.**
"title IV of division M of Public Law 116-260" answered with a row of chips
reading "Sec. 401. …", which is the contents of something the reader still cannot
see. Bounded at `PROVISION_BUDGET` sections — each is a separate GET — with the
rest listed and the cap stated.

**Regenerated data can be stale against the parser that reads it.** The same
report exposed this: the citation parses correctly to `["DIVISION M","TITLE IV"]`
and 116-260's shards recorded only `DIVISION M`, because they were built before
the appropriations-title work of 2026-08-02. The tell is decisive and worth
reusing — Pub. L. 116-6 IS `hjres31-116-enr.htm`, and `parseBill` gives that file
26 nested ancestor paths today while its shard had none. Anything in `data/` that
is produced by `app/parse` is a cache of a parser version, and re-running the
ingester is part of shipping a parser change. `ingest_plaw.mjs --force` fixed it:
1,802 nested paths across the 25 laws.

Meanwhile `resolvePlawDivision` shortens the path from the inside out until
something matches and says which level it dropped, so a level the data cannot
place gives division M's 30 sections rather than the law's 2,092. Narrow and
honest beats wide and silent — the same trade the guess flag makes. Test it with
a level that cannot exist ("subtitle Z of title IV of division M"), never with a
real one: a test that only passes while the data is broken is not a test.

**A Public Law is an Act, and the index already had it.** `data/usc/acts/`
contains 1,737 files named `pub_l_<congress>_<law>.json` — the ingester files a
section under whatever its credit says, and most modern credits say "Pub. L.
113–79, title XII, § 12306" rather than a date and chapter. So "section 12306 of
Public Law 113-79" resolves to 7 U.S.C. 1632c through exactly the machinery
`resolveActSection` already provided, with `enactedAs` synthesised as
`Pub. L. <congress>-<law>`. Nothing is downloaded and nothing was added to the
repo. Across the corpus, 174 of 507 sectioned Public Law citations (34%) reach a
real provision against none before, over 79 distinct Code sections.

The 66% that miss are the point of the design rather than a shortfall: most of a
Public Law never enters the Code at all — appropriations lines, effective dates,
findings — and an uncodified section has no provision to point at. Those fall
through to the link. Do not be tempted to widen this by guessing at a nearby
section; the reason the whole mechanism is trustworthy is that it only ever
repeats what the Code says about itself.

Worth knowing if you extend it: only 322 of the 602 distinct Public Laws cited
across the corpus are indexed at all, because a law with nothing codified never
appears in a source credit. And a *bare* "Public Law 113-79" with no section is
still a link — an Act name on its own names a range, not a provision, the same
rule the named-Act path follows.

**The Act-section index is derived, never authored.** `data/usc/acts/<slug>.json`
maps an Act's own section numbers onto the Code's, and every entry comes from the
`<sourceCredit>` the Code prints on the section itself:

```
42 U.S.C. 1395x  ->  "(Aug. 14, 1935, ch. 531, title XVIII, § 1861, as added …)"
```

Three things about reading those credits are load-bearing, and each is a way to
file a section under the wrong Act:

- **Only the first clause.** What follows a `;` is a later *amending* act. Read
  those and a section lands under whichever law last touched it.
- **Only the `§` before `as added`.** "as added Pub. L. 89–97, title I, § 102(a)"
  is the inserting law's own section number, not the Act-relative one.
- **A clash is dropped, not resolved.** Two Code sections claiming the same Act
  section means a renumbering or an ambiguous credit. The ingester tombstones the
  entry and records it in `acts/_conflicts.json` rather than keeping either —
  picking one would point a citation at a real but unrelated provision.

**A credit can state the Act-relative number four ways, and the bracketed one
is the easy one to miss.** Alongside the three rules above:

```
15 U.S.C. 636  ->  "(Pub. L. 85–536, § 2[7], July 18, 1958, 72 Stat. 387; …)"
12 U.S.C. 1813 ->  "(Sept. 21, 1950, ch. 967, § 2[3], 64 Stat. 873; …)"
```

The Small Business Act *is* section 2 of Pub. L. 85–536, so the OLRC writes the
Act's own section 7 as `§ 2[7]`. Reading the outer number filed every SBA
section under "2", where they all collided and were dropped as ambiguous — so
the Act had no index at all and "section 7(a) of the Small Business Act" could
only reach the head of the Act. 130 sections carry the form. Verified on
provisions anyone can check: SBA § 7 is 15 U.S.C. 636 (the 7(a) loan
programme), SBA § 8 is 15 U.S.C. 637 (the 8(a) programme), FDIA § 3 is
12 U.S.C. 1813 (Definitions). Fixing it also resolved 2 of the 295 conflicts.

**A citation walks down as many levels as it needs, and an unmatched level
costs the whole citation.** "section 2118(a) of title II of division A of
Public Law 116-136" is one address with a chain in the middle of it. Matching
only the bare "division X of" form read 354 of the corpus's 489 chained
citations and lost the other 135 — and lost them *entirely* rather than
partially, because with the chain unmatched the whole pattern failed and only
the bare "Public Law 116-136" survived, taking the section number with it. That
is the failure mode to watch for in any of these matchers: a missing optional
segment does not degrade the match, it deletes it.

`SUBDIV_CHAIN` accepts up to four of title / subtitle / part / subpart /
chapter / subchapter / division, and `divisionOf()` picks the division out of
whatever chain was matched — because the division is the only level that
changes *which* provision is meant, the rest being address rather than
ambiguity. It is shared by the Public Law and named-Act matchers, which had the
same gap.

Two orderings inside the `act` branch are load-bearing, and both were wrong
first. A named **section beats a named division**: "section 5001 of division A
of the CARES Act" gives both, and answering with division A's contents hands
back a list of hundreds when the citation named one of them. And where the Code
index cannot place a section, the Act's own **Public Law text is tried before
the head of the Act** — the reader was being sent to the top of an Act for a
section sitting on disk.

**A section is cited with alternative subsections more often than you would
think.** "section 7(a) or (b) of the Small Business Act" put the alternation
between the number and the "of the …" that `RE_ACT_REL_SECTION` anchors on, so
the entire citation was missed and only the bare Act name survived. The
alternation is consumed but not captured: the section number is what resolves,
and the address keeps the first subsection, because nothing in the text says
which of two alternatives the drafter meant.

**`act_slug()` must agree between `ingest_usc.py` and `act-sections.js`** — the
same standing hazard as `slug()`, and worse, because it collapses *runs* of
punctuation to one `_` where `slug()` maps each character. That is what lets the
EN DASH the Code prints ("Pub. L. 89–10") and the ASCII hyphen everyone writes
reach the same file. Diverging here 404s every Act silently.

**`resolve()`'s cache key must include `actSection`.** "Section 1861 of the
Social Security Act" and "Section 1862 of the Social Security Act" are both kind
`act`, on the same Act, with no `section` of their own — so before `actSection`
joined the key they hashed alike and the second citation was served the first
one's provision straight out of the memo. Same family as the shallow-copy rule
below: a memo keyed on too little is indistinguishable from a resolver bug.

**An addition joins its siblings, not the provision the walk stopped at.**
`scopeOps` binds every op to the last step written before it, which is right for
a strike or an insert — those act *on* the provision walked to. An addition does
not:

```
(1) in paragraph (3)—
    (A) in subparagraph (B), by striking ``or'' at the end;
    (B) in subparagraph (C), by striking the period and inserting ``; or''; and
    (C) by adding at the end the following:
``(D) a contract of sale of a digital commodity.'';
```

The last step written is "in subparagraph (C)", so new subparagraph (D) was
scoped to `(a)(3)(C)` and drawn *inside* (C) — when (D) is plainly (C)'s sibling
and belongs at the end of paragraph (3). The bill's own `(C)` there is a list
marker for the third sub-instruction, which the parser was already right not to
treat as navigation; the walk simply is not the answer. Every count stayed green.
`scopeAdditions()` reads the depth off the added block's *own leading marker* —
the one signal that survives PDF extraction — and truncates the path above it.
An addition with no leading marker (a flush sentence) has no depth signal and is
left where the instruction walked to, which is where a flush sentence goes.

**An added block's first closer is its last.** In every convention bills use, a
multi-paragraph added block opens each paragraph with a quote mark and closes
only once, at the very end — so there are no intermediate closers to step over,
and a nested single-quoted term (`` `covered entity' ``) is not one because both
single conventions take two characters. Measured: correct at 3,251 of 3,253
sites. The two exceptions write each added subparagraph as its own closed quote,
where this stops after the first — short of the whole addition rather than wrong
about it. Note the *pair* matters: `QO`/`QC` are alternations, which is right for
"find any quoted operand" and wrong here, because a block opened with ``` `` ```
must be closed by `''` and not by a curly double appearing inside it.

**An insert's anchor may be written before the language it places.** Both orders
are common and neither is a variant of the other:

```
by inserting ``Y'' after ``X''            <- RE_ANCHORED, read AFTER the operand
by inserting after ``X'' the following: ``Y''   <- RE_INSERT_ANCHOR_FIRST
```

In the second, the first quoted string is the ANCHOR. The generic insert scan
takes the first quoted string after the verb, so it read the anchor as the
inserted text — not a missing answer but a wrong one: "compliance with procedural
steps required by paragraph (1)(B)", language already sitting in 5 U.S.C.
801(a)(2)(A), would have been drawn in green as language the bill adds, while the
language actually being added went unmentioned and the panel said "position not
stated" about the one thing it knew. The anchor-first form is claimed before the
generic scans run, or both match inside it; `placeOps` then leaves an op alone
that already carries `relation` and `anchor`, since re-deriving from what follows
would find the NEXT instruction's connective.

**A strike may NAME its operand instead of quoting it.** "by striking the period
at the end and inserting ``; or''" is the commonest way a bill re-punctuates a
list, and `RE_STRIKE` finds nothing — it is tempered against reaching across
"insert", correctly — so `RE_REPLACES` had no strike to pair the insert with.
**320 of the corpus's 2,431 unplaced inserts were this one shape**; 449
punctuation strikes are now synthesised, 269 of them paired.

The operand is not in the bill, and that collides with the `badOpOffsets`
invariant — an op's span must round-trip to its text, because a span pointing at
text it does not match mis-renders the bill pane. Adding the span with `text: '.'`
broke it on 449 ops across 25 bills. So `text` is the phrase the bill *wrote*
("striking the period at the end"), which is what the reader clicked and what the
span slices to, and the mark it names travels as **`operand`** — which is what
`createRedline` matches against in the law. `occurrences()` already allows a
punctuation operand: it requires a word boundary only at an end that is itself a
word character.

Measured while fixing these, for whoever picks up the rest: **79% of the corpus's
10,106 inserts now carry a placement the redline can use.** Of the 2,164 that do
not, the two large families left are "striking <unit> and inserting the
following:" (TODO 12's open item — a whole-provision replacement) and "the item
relating to section N", which amends a table of sections and is correctly
undrawable, since the item is not in the provision's text at all.

**The gap between the phrase and the block must not cross another instruction.**
`adding at the end the following new subclause:` is followed by an optional unit
word, and in a PDF by page furniture — so the reader crosses everything up to the
next quote opener. In one bill what followed was `(A) in subclause (VI), by
striking ``and'' at the end;`, and the next opener belonged to the *strike*: the
word "and", being removed from the statute book, was reported as the new language
the bill adds. The guard rejects a gap containing `strik|insert|redesignat` —
the verbs that take a quoted operand. Not `amend`, which appears in a gap
legitimately ("the following new section (and amending the table of sections
accordingly):", three real additions a broader guard threw away).

**"Nothing to draw" and "nothing happened" are opposite conclusions, and the
redline now says which.** The guards above are right that an enacted bill's
insertion must not be drawn as a pending change — that produced "for the 2018
crop year, {+for the 2018 crop year,+}". But withholding it silently told the
reader the bill does nothing here, and the panel said "⚠ anchor text not found"
when the anchor had been found and the words were sitting against it. There are
three states, not two: `ins` is a change the bill would make, `was` is one it
already made, and `keep` is everything else. `was` is drawn in the insertion
colour with a dashed underline instead of a fill — the bill's work, not a
proposal — the inline twin of `.node.was-added`.

Two kinds of evidence, and they are corroborated differently:

- **Positional.** The instruction names an anchor, the anchor is in this
  passage, and the words already sit against it (`alreadyThere`). No length
  floor, because position does the work. This was already computed and used only
  to suppress the drawing.
- **Amendment-level.** Every strike the amendment makes is already gone
  (`stale`) and the inserted language is in the passage the op is scoped to.
  Staleness is evidence about the amendment, not about this spot, so it carries
  `ENACTED_MIN` — the same 24-character floor `alreadyIn` uses on block
  additions, and for the same reason: below it a match is common statutory
  phrasing rather than a fingerprint.

`enact()` picks the occurrence NEAREST the position the instruction would have
used, not the first — statutory language repeats, and the first match is
regularly a different sentence. Measured by `tools/coverage.mjs`: inline
operations shown to the reader went **2,256 → 3,613 of 15,240 (15% → 24%)**,
of which 1,388 are these marks. 31 ops moved the other way, from "drawn as
pending" to "already in force", because an op recognised in the first passage
that contains it can no longer be drawn as new in a later one — which is the
duplication these guards exist to prevent, caught one passage earlier.

Left alone deliberately, and measured: 891 where the amendment is stale but the
operand is under the floor, and 1,348 where the language is present but the
amendment is demonstrably still pending, so the match is probably coincidence.
Both would be a false claim that this bill put those words there — the same
family as the et-seq bug below.

**A field the parser sets and no consumer reads is a feature that does not
exist — and every count stays green while it doesn't.** This is the counts-are-
not-enough rule with a name, and it is the single most productive thing to audit
in this codebase. Three found on 2026-08-03, all three documented in this file
as working:

- `operand` — the mark a bill NAMES instead of quoting ("by striking the period
  at the end"). `text` is the phrase the reader clicked, because the
  `badOpOffsets` invariant requires the span to round-trip; `operand` is what has
  to be found in the LAW. The substitution turning one into the other sat in
  `redline.js`'s `additions` chain, which an operand-bearing op can never enter —
  `structural()` admits only `add-at-end` and after-unit inserts, and every
  operand op is a plain strike. Dead code in the one list that could not use it
  and missing from the one that could, so `apply()` searched the law for the
  words "striking the period at the end". **449 strikes and the 346 inserts
  paired to them, not one pixel drawn.** Worse where the phrase happened to occur
  in the provision, which struck those words. And it poisoned `stale`: an
  amendment all of whose strikes carry `operand` was declared stale in full, so
  its *unrelated* inserts and additions were suppressed too — 19 amendments.
- `implied` — set on every synthesised target, carrying the reason in prose meant
  to be read ("title 10, carried from the last title the bill named"). Nothing
  read it, so the pane named a provision the instruction never mentions exactly
  as if the bill had written it out. 1,239 targets.
- `etSeq` — see the next invariant.

The audit that found these enumerated ten such fields; the seven still unread are
TODO 33. When adding a field, grep the consumers before believing the feature
works, and write the test at the level the READER meets it — `rendertest.mjs`
had 284 checks and the redline drew nothing for a whole family of ops, because
every redline case passed the operand as `text` and so could not fail at this.

**`et seq.` names a range, and the end of a range is not the end of the section
it begins at.** "The National Environmental Policy Act of 1969 (42 U.S.C. 4321
et seq.) is amended by adding at the end the following: SEC. 106. …" resolves to
42 U.S.C. 4321, NEPA's own first section, and the addition had no navigation to
scope it — so a whole new SECTION OF THE ACT was drawn inside the Act's first
section, in the insertion colour. 184 across the corpus, 131 opening "SEC. N."
outright. Nothing here knows where the range stops; the Act's last section is not
a fact the citation carries. So `markRangeAdditions()` flags the op and the pane
declines, saying what is added and where it goes. Only additions — a strike names
language and is checked against the text, so it declines on its own, while an
addition is placed structurally and is never checked against anything, which is
exactly why this one went wrong silently.

**Three flags now mean "dealt with but deliberately not drawn", and `placed()`
must know all of them.** `applied` (the law already contains it), `staleSkip`
(the amendment has already happened) and `rangeSkip` (it belongs at the end of
the Act). The node that declines an addition still marks it `done`, so a
`placed()` that forgets one reports "✓ shown above" about an op it just refused
to draw. Each of the three was added separately and each broke this the same way.

**A pairing rule reads a gap, and the gap depends on where the op's span
starts.** `RE_REPLACES` looks for the words "and inserting" between a strike and
the insert that replaces it — which works only because a QUOTED insert's span
starts inside its quotes, leaving the verb behind in the gap. A NAMED insert
("and inserting a semicolon") spans the verb itself, so the gap in front of it
holds only the connective and `RE_REPLACES` silently declines every one.
`RE_PUNCT_REPLACES` is the same test for that shape, and it has to admit a
closing quote too, because the strike being replaced is often the quoted kind.

---

## The export

`app/export.js` writes the reading session as one HTML file. Three promises,
and each is a constraint on how it is built rather than a feature bolted on:

- **It makes no requests.** No `<link>`, no `<script src>`, no fonts, no
  images. The stylesheet is inlined from `document.styleSheets`, the app's
  fonts are system stacks already, and the favicon is a data URI. A
  cross-origin sheet that cannot be read is *skipped* rather than linked —
  losing the styling is better than a file that reaches out when opened.
- **It does not change.** Every citation is resolved at export time and its
  provision baked in. The live app reads the Code as it stands today, which is
  right there and wrong for a record of what a bill said against the law it was
  written to change. The header states the date for that reason.
- **It is the same view.** The app's own markup and stylesheet, so the bill
  reads as it did on screen, chips and amendment blocks intact.

Two implementation notes worth keeping. Contexts are **deduped by the same key
`resolve()` uses**: a bill cites the same provision many times, and rendering
one panel per citation multiplies the file by the repetition rate — 338
citations in the Fiscal Responsibility Act reach 210 distinct provisions, and
the file is 2.45 MB rather than 4 MB. And the bill goes in as `outerHTML` of a
DOM node, never as a template string, so nothing in a pasted bill can be read
as markup; `rendertest.mjs` pastes a bill whose short title is a `<script>` tag
and asserts it survives as text.

Delivered as a Blob and an object URL, not a `data:` URL — Chrome refuses a
`data:` navigation of this size outright and others truncate it — and the URL
is revoked on a timer, because revoking synchronously races the download in
Firefox.

## Testing discipline

Weak assertions have hidden more bugs here than missing tests:

- `blocks > 0` let one amendment block stand in for eleven. Bound counts on
  **both** sides.
- `headings > 5` let a heading silently lose its class. Assert exact equality
  against `bill.sections.length`.
- Length-ratio checks measure UI chrome, not correctness. Count occurrences of
  distinctive phrases instead — or strip the chrome and assert *exactly*. "Rendered
  text preserves the source" was a 5% tolerance, which on the sample bill left
  slack for ~5,000 characters of silent loss and then failed for the honest
  reason that the bill had grown breadcrumbs. Removing `.sec-where`,
  `.amend-tag` and `.amend-ops` and joining the paragraphs with a space (the
  blank line between two of them is a boundary, not content) makes it exact,
  character for character, on a 1.4 MB bill.
- **A contract check only covers the pattern it was written with.** The
  CSS/markup contract asked which classes reach `classList.add`, and most of
  this app's classes are set by assigning `className` outright — 12 classes
  checked out of 54. Widening it found `lead-in`, set on the section lead-in in
  `render-context.js` since the pane was written and styled nowhere.
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

1. **"Subsection (c) of such section is amended" is seen and targeted.**
   (Fixed 2026-08-02.) `RE_AMEND_HEAD` needs "section <number>" and here the
   number is exactly what has been elided, so these were not mis-targeted but
   invisible — 130 instructions in the NDAA alone, their operations sitting
   outside any parsed amendment, which is where most of that bill's
   `uncoveredVerbs` count came from. `RE_AMEND_HEAD_SUCH` reads the shape and
   `impliedSuchUnit()` composes the target.
   The referent is the **previous instruction's own resolved target**, not the
   nearest preceding citation. That distinction is the whole fix: instructions
   quote their operands, and a quoted operand is often a citation
   ("…by striking ``section 3401''."), so the nearest cite regularly belongs to
   text the bill is deleting. Two guards earned their place by being wrong
   first — every instruction updates the referent, including one with an Act
   target or no target, so an intervening instruction *breaks* the chain
   instead of being stepped over; and a citation flagged `note` cannot be
   carried, because "10 U.S.C. 1580 note" is not section 1580.
   Corpus: NDAA amendments 1,387 → 1,517, targeted +61, opSpans +476 (≈3.7 per
   newly-seen instruction), and `uncoveredVerbs` 110 → 32.
2. **The tail of one-off amendatory phrasings is down to 139, and is now
   genuinely a tail.** Was 173 at the start of 2026-08-02, with 110 in the NDAA
   alone. TODO 1 took 78 of those; the appropriations proviso below took 8 more.
   Re-run the clustering the way this note has always prescribed — walk every
   `is amended` not inside a parsed amendment, take the ~70 characters before
   it, normalise digits and markers to `N`/`(X)`, and cluster — and the answer
   now is **134 distinct shapes with a largest cluster of 4**. By the test this
   note itself sets ("every systematic cause has stood out immediately as a
   double-digit count"), there is nothing systematic left in it. Stop looking
   for one; the remaining work here is one phrasing at a time, and each costs
   more risk than it returns.
   The last systematic cause found, for the record: **an appropriations proviso
   chains amendments after a colon that sits in the wrong place.**

   ```
   …is amended by striking ``2023'' and inserting ``2024'': Provided further,
   That section 9(h)(3) of the Richard B. Russell National School Lunch Act
   (42 U.S.C. 1758(h)(3)) is amended in the first sentence by striking …
   ```

   `AMEND_BOUNDARY` accepts `:` — but the colon opens the proviso, and the
   second instruction starts after "That", where no boundary fell. Adding
   `\bThat\s+` found 8 of the 14, each with a real target and real operations.
   Two things checked before accepting it: no op span is claimed by two
   amendments (the preceding instruction's body used to run over these, so the
   risk was double attribution, not just miscounting), and `amendments` moved
   +10 against `uncoveredVerbs` -8 — the two extra being verbs that were
   already inside a previous instruction's over-reaching body and are now heads
   of their own. "That" is trimmed from the head like the punctuation beside
   it, so the instruction starts at its target rather than at the conjunction.
3. **Appropriations acts are navigable.** (Completed 2026-08-02.) Two passes:
   sentence-case section headings earlier in the day, and now the layer between
   a division and its sections. An appropriations act centres the label on a
   line of its own and puts the heading two lines below —

   ```
   TITLE I

       DEPARTMENTAL MANAGEMENT, OPERATIONS, INTELLIGENCE, AND OVERSIGHT
   ```

   — and `RE_DIVISION` needs a separator on the same line, so it matched none
   of them. 44 titles in H.J. Res. 31 alone, with everything beneath them
   hanging off a title nobody could see. `RE_DIVISION_BARE` is anchored
   end-to-end so the line must be the label and nothing else, and
   `headingBelow()` scans at most three lines for it, returning an empty
   heading rather than reaching far enough to borrow the next title's.
   Corpus: divisions +186 across 9 bills (H.J. Res. 31: 8 -> 52), and sections
   +212 on two of them, because a recognised division also clears `inToc` and
   sets `bodyStarted`, which is what lets the sentence-case matcher run in
   regions that were previously gated. Every one checked: 0 flush-left, so none
   is a table-of-contents entry.
   Still open in this family: the *account* headings under a title ("Office of
   the Secretary and Executive Management", "operations and support") are the
   level appropriators actually think in, and they are not units — they carry no
   label, so nothing distinguishes them from a centred phrase. `heading` for a
   run-in section is also still the provision's own first clause, because there
   is no heading to have.
4. **`in the matter preceding subparagraph (A)` scopes its operations.**
   (Fixed 2026-08-02.) 734 occurrences across the corpus, the largest
   navigation shape nothing handled. The old note called it unresolvable
   because it "names a position between provisions"; that was wrong. It names
   the **lead-in text of (A)'s parent** — the words introducing the list (A)
   belongs to — which is exactly addressable. What it is not is a subtree.
   Both halves were needed. `RE_NAV` matches "in <unit>" and here "in" is
   followed by "the", so the phrase was never navigation and pass 2 read the
   "(A)" inside it as a bare reference to the very provision the instruction
   identifies itself by staying out of. And scoping to the parent alone is only
   half a fix, because `apply()` tests `path.startsWith(op.scope)` — so the op
   carries `exact`, and `inScope` compares with `===` for it.
   Three things that were wrong first and are worth keeping:
   - It runs **after** the navigation pass, not before. "in subsection (d)(2),
     in the matter preceding subparagraph (A)" only has a parent to name once
     (d)(2) is in hand, and running first left it with no context and silently
     skipping every one.
   - It needs its own position test. `isInstructionPosition` stops at
     `[.;:]` because a bare reference after a comma is a mention — but the
     comma is how this phrase is normally written. `isMatterPosition` admits
     it and still rejects the open paren, which is doing real work: 167 of the
     932 raw occurrences sit inside a parenthetical ("the requirement described
     in section 1101(a)(15) (in the matter preceding subparagraph (A))") and
     describe a provision rather than instructing anyone to amend it.
   - "preceding" and "following" resolve alike, on purpose. Both are the
     parent's own text; which half is not something the provision tree records.
   Corpus: `steps` +365 and `refs` -365 across 22 bills, each bill's decrease
   equal to its increase — the same phrases, reclassified from inert mentions
   to navigation that scopes something.
5. **The CFR branch of `expandRelativeRefs` is exercised, and is dead in
   practice.** (2026-08-02.) It was untested because it is unreachable from bill
   text: across the 34 MB corpus exactly one "is amended" has a CFR reference
   anywhere near it, and that one is an Organic Foods Production Act instruction
   that merely mentions a regulation. Neither `Section 60.13 of title 40, Code
   of Federal Regulations, is amended` nor `40 CFR 60.13 is amended` produces an
   amendment at all — `RE_CFR` does not know the "section X of title N" form and
   `RE_AMEND_HEAD` does not admit a CFR target. Deliberately left that way:
   bills amend statutes, agencies amend regulations, and adding head forms for
   a shape with no demand is how false positives get in. The branch is now
   driven from a synthetic amendment in `selftest.mjs` so the code is covered
   without a fixture pretending bills do this.
6. **Seven duplicate section numbers now keep both.** (Fixed 2026-08-02.) Two
   different Public Laws each added a "§ 3598"; one shard per number meant the
   second one written replaced the first and the pane showed whichever came
   later in the XML, with nothing on screen to suggest the other existed. These
   are not near-duplicates — 5 U.S.C. 5757 is *both* "Payment of expenses to
   obtain professional credentials" and "Extended assignment incentive",
   28 U.S.C. 1932 is *both* "Judicial Panel on Multidistrict Litigation" and
   "Revocation of earned release credit". Half of each pair was simply gone.
   The later ones ride along under `also`, so 60,429 shards keep their shape and
   only these seven carry the extra key; the pane names them by heading and
   source credit (the only things that tell them apart) and swaps on a click.
   Affected: 5 U.S.C. 3598 and 5757, 10 U.S.C. 130g and 2892, 28 U.S.C. 1932,
   38 U.S.C. 1167, 40 U.S.C. 3318. Re-ingesting those five titles changed
   exactly seven files, which is the check that it was deterministic.
7. **Hyphenated headings stay broken** (`CAT-` + `ASTROPHIC`) — but they are no
   longer *truncated*: a wrapped heading is now rejoined, so H.R. 3633's title I
   reads `DEFINITIONS; RULE-MAKING; EXPEDITED REG-ISTRATION` rather than
   stopping at `RULE-`. Closing the seam is what remains, and it is not obviously
   safe: `PAY-` + `AS-YOU-GO` must keep its hyphen where `REG-` + `ISTRATION`
   must lose it, and nothing in the text says which is which. Documented in
   README as a known limit.
8. **CFR part views still cap at 40 sections, but not silently and not
   finally.** (2026-08-02.) The "silently" in the old note was already wrong —
   it said "Showing the first 40 of N" — but it gave the reader nowhere to go,
   which made the cap a dead end for anyone who wanted section 51 of 200. There
   is a "Show all N" control now, per-citation like the scope. The cap itself
   stays: a part can run to hundreds of sections and rendering them all by
   default is slow and unreadable.
9. **Popular names covered 78 Acts and 64 of them resolved their own section
   numbers**, against 46 Acts and 4 respectively this morning. Both halves were
   *derived*, never typed:
   - the entries, from the `et seq.` parenthetical Congress writes beside the
     name ("the Foreign Assistance Act of 1961 (22 U.S.C. 2151 et seq.)");
   - the `enactedAs` credits, by searching the ingested Act index for the one
     act whose sections include that entry's own head section, keeping at least
     80% of its mappings inside the entry's title, and rejecting anything with
     more than one candidate.
   Verified against landmarks, which is the only check worth running here:
   Clean Water Act § 404 is 33 U.S.C. 1344, NEPA § 102 is 42 U.S.C. 4332, ADA
   § 3 is 42 U.S.C. 12102, Exchange Act § 10 is 15 U.S.C. 78j. And where the
   bill states the U.S.C. cite itself in a parenthetical, the derivation agrees
   with it — three of eight sampled did, none disagreed.
   Corpus effect: Act-relative citations **2,032 -> 5,446**, of which **5,173
   (95%) reach a real provision** over 1,050 distinct Code sections. The corpus
   metrics do not move, for the reason the original Act-relative pass did not
   move them: the citation simply spans more text and `dedupe()` already
   preferred the longer match at equal rank.
   The 14 left without `enactedAs` are the ones the derivation refused —
   several candidates, or too few sections to be sure. Do not fill them in by
   hand without checking a real shard's source credit.
10. **Share links are long** — 117 KB bill → 35 KB URL. Fine in a doc or ticket,
   wraps in chat/mail. Shorter would need a backend, which is a different product.
11. **The agent CAN see this app now, and looking found things at once.**
   (2026-08-03. This item was "No visual verification has ever happened" for
   the whole life of the project.) On this machine Chrome tooling reaches
   `localhost:8000`: `python tools/serve.py` in the background, then navigate and
   screenshot. **Do this after any UI change, and do it before believing a
   metric.** Keller's standing complaint is that every problem he brings has come
   from looking at the rendering, and the first screenshot ever taken proved him
   right inside two minutes — it exposed TODO 35's whole chain (an amendment
   showing one operation where the bill states two, and the pane warning about
   the one thing that had gone right).
   Two mechanical notes, both of which cost time. The `Load a bill` menu is a
   toggle and the agent's clicks outrun it, so drive it from `javascript_tool`
   (click the button, wait, click the item) rather than by coordinate. And ES
   modules are cached hard: `ctrl+shift+r` after every edit, or you will verify
   the previous build and believe it.
   Confirmed by eye and no longer in doubt: `.sec-where` renders small and grey
   above the accent-coloured section head (the opt-out holds), the `↳` on a
   composed citation is legible without shouting, and the redline's green
   insert / struck-through strike read correctly side by side.
   **All four of the things this item listed as unlooked-at have now been looked
   at — see item 56.** Two were sound (`.sec-head.run-in` and the jump menu's
   `<optgroup>`s), dark mode was confirmed by Keller, and the Public Law pane's
   `.links` table of contents was 200 inert chips and 5,660 pixels, which is
   fixed. The pane overflow found on the way was a bug nobody had listed at all.
   Keep the habit rather than the list: go and look after any UI change.
12. **`inserting after subparagraph (C) the following` is placed.** (Fixed
   2026-08-02.) It was worse than "misplaced": an insert reaches `apply()` with
   either a paired strike or a quoted anchor, and this shape has neither, so it
   fell through both branches and drew **nothing at all**. 312 ops across the
   corpus, each one a whole new provision the reader never saw.
   `scopeUnitInserts()` scopes them to the anchor itself and `redline.js` routes
   them to the structural placer, so they land after that provision's subtree —
   the renderer already calls `additionsAt()` for every node once its children
   are laid out, which is exactly the hook needed. Verified structurally rather
   than by count: in 306 of 312 the added block's own marker is the successor of
   the provision it follows ((B)→(C), (19)→(20), (d)→(e)). The corpus cannot see
   any of this — `opSpans` keys on `type:start-end` and none of those changed —
   so `rendertest.mjs` asserts the placement directly.
   Still open in the same family: 2,483 inserts remain undrawn, dominated by
   "striking <unit> and inserting the following:" (1,154 bare + 705 with "the
   following"), where the strike names a unit rather than a quoted phrase so
   `RE_REPLACES` never pairs them. That is a replacement of a whole provision
   and wants its own pass.
13. **An addition whose provision is off screen now offers to go there.**
   (Fixed 2026-08-02.) An op scoped to `(a)(3)` renders nothing while the pane
   shows `(b)`; the panel said so, honestly, and left the reader with nowhere to
   go. There is a "Show (a)(3)" control now.
   The non-obvious part, and the reason to read `widenTarget()` before changing
   it: widening to `(a)(3)` does *not* work. `nodeEl()` asks `additionsAt()` for
   a node once it has laid out that node's children, and scoping to `(a)(3)`
   renders its children while putting `(a)(3)` itself in the ancestor ladder,
   which lays out nothing and asks for nothing. The scope that draws it is the
   PARENT, `(a)`. The render test asserts the whole round trip — that the
   control offers (a)(3), that it widens to (a), and that at (a) the block is
   actually on screen — because asserting only the first would have passed
   against a control that did nothing.
14. **A "U.S.C. N note" citation no longer poses as section N.** (Fixed
   2026-08-02.) A note is uncodified law printed *beneath* a section, and 319
   amendments across the corpus targeted one — showing a real provision that is
   not the one cited. "Section 602(b)(3)(F) of the Afghan Allies Protection Act
   of 2009 (8 U.S.C. 1101 note)" pointed at 8 U.S.C. 1101, the INA's
   *Definitions* section, and then composed every navigation step against it:
   "clause (i)" became 8 U.S.C. 1101(i). **764 composed addresses removed**,
   every one of them a confident answer about the wrong statute.
   Notes are skipped in the target chain and the Public Law beside them is used
   instead, carrying the section number the instruction named, so it resolves
   through the same Act index and local text "section N of Public Law X-Y" uses.
   Corpus: targeted -95, relative -764, nothing else moved.

16. **"Division J of the Infrastructure Investment and Jobs Act" resolves to
   that division.** (Added 2026-08-02.) An omnibus is cited by division, and
   the division is the address — without it the phrase landed on the head of
   the Act, 630 sections from what was meant. `RE_ACT_DIVISION` captures it for
   every popular name, and `publawIdOf()` reads the Public Law off whichever
   field records it (`enactedAs`, else `range`), so an Act assembled from many
   laws — the Clean Air Act, credited "July 14, 1955, ch. 360" — correctly has
   no division to give.
   13 such citations across the corpus, 9 of which name a law `data/plaw`
   holds. The other 4 want laws outside the 25; they fall through to the head
   of the Act as before. Worth knowing before extending: the answer is the
   division's *contents*, not a provision, because a division is a range.

15. **An omnibus Public Law's section numbers are not addresses on their own.**
   Every division restarts the numbering, so "section 110 of Public Law 114-113"
   names one provision in division B and another in division N — and the Act
   index, keyed on the bare number, returns whichever was codified. That is how
   "Section 110(a) of the Department of Commerce Appropriations Act, 2016"
   (division B) resolved to 6 U.S.C. 1509, whose credit reads "div. N, title I,
   § 110". The Code prints the division in the credit, so `divisionAgrees()`
   checks the two and declines where they disagree; the citation matcher now
   captures "of division G of" because that phrase is half the address.
   The division short title case is closed too, and not by mapping titles to
   letters — see item 17. What remains open is a citation that names *only* the
   short title, with no parenthetical at all; there is nothing in the text to
   read, and those still decline.

17. **The division a citation names is now used to look the section up.**
   (Fixed 2026-08-02, from a Haiku spot-check of 355 resolutions.) `division`
   had been captured since item 15 and reached exactly two consumers —
   `resolvePlawDivision()` and `divisionAgrees()`. `resolvePlaw()` had no
   division parameter at all, so the pane showed all four of Pub. L. 116-260's
   sections numbered 702 under the heading *"The citation does not say which."*
   The citation said which. 52 citations across the corpus sit on a multi-entry
   shard the named division would narrow.
   Three things were wrong and each needed its own fix:
   - **The path, not the letter.** A chain is written inside-out — "subtitle A
     of title II of division A" — and `wherePath()` reverses it into the order
     `data/plaw`'s table of contents records, so narrowing is a prefix test.
     With no section number the levels *below* the division are the only thing
     narrowing anything: subtitle A of title II of division A of the CARES Act
     is 16 sections where division A is 186. `RE_ACT_DIVISION` had also *begun
     the match after them*, so the chip covered less text than the citation did.
   - **A path matching nothing is dropped, not obeyed.** 1 of the 52. Either the
     citation or our reading of the law's structure is wrong, and showing every
     candidate with the ambiguity stated is the honest answer to that; showing
     none would turn a resolvable citation into a dead link on a guess.
   - **The panel has two messages now** and telling them apart is the point.
     "Narrowed by the citation" where the drafter supplied the division,
     "More than one … does not say which" only where they did not.

18. **A parenthetical belongs to the name immediately in front of it.**
   (Added 2026-08-02.) "Section 252 of the Military Construction, Veterans
   Affairs, and Related Agencies Appropriations Act, 2018 (division J of Public
   Law 115-141)" is a complete address whose *name* is unlookupable — it is a
   division's own short title. The bill has already done the mapping item 15
   wanted and written the letter down. 173 of these across the corpus, and the
   parser read the bare "Public Law 115-141" and dropped the section number, the
   division, and the fact that the two belong together: a 1,254-section law in
   place of one provision. `RE_PUBLAW_PAREN` reads the whole shape, from either
   side — the chain may sit before the name ("section 702 of division N of the
   Consolidated Appropriations Act, 2021 (Public Law 116-260)") or inside the
   parenthetical.
   **The middle must be a NAME and nothing else, and that is the entire safety
   of this pattern.** Both failures below were live before the guards, and both
   are the worst output this app has — a real law, a real section number, and
   the wrong statute:

   ```
   section 313 of the Public Health Service Act, as amended by section 311
   of division BB of the Consolidated Appropriations Act, 2021 (Pub. L. 116-260)

   …pursuant to section 251(b) of the Balanced Budget and Emergency Deficit
   Control Act of 1985 in division J of the Infrastructure Investment and
   Jobs Act (Public Law 117-58)
   ```

   Two references each time, and the parenthetical is the second one's. The
   first tell is an intervening `section`; the second is a **subdivision word
   inside the name** — "division" opens a new address, and the slot a chain may
   legitimately occupy is in front of a name, never inside it. The second shape
   has no second "section" in it at all, which is why one guard was not enough.
   Also barred: `as amended/added/authorized`, a semicolon, a paren, a paragraph
   break. Every one of these turns a confident answer about the wrong Act back
   into the bare Public Law link the citation had before.
   Two orderings earned their place. The new form is `publaw` (rank 4) and so
   beats the `act` (rank 3) citation inside it — which is right, because it
   carries the division and goes through the same Act index — but **it must
   never resolve to less than its parts.** Where the section is uncodified and
   the law is not one of the 25, the resolver falls back to the Act the bill
   named rather than to the link; without that, three citations went from the
   head of their Act to an outbound link for being *more* specific.
   Corpus: 1,646 citations absorbed into 1,264 richer ones. `byKind.publaw` does
   not move anywhere — each match removes one bare Public Law and adds one
   addressed one — so `citations` falls by exactly `byKind.act`, 382, on all 14
   bills. All 17 displaced Act-with-section citations resolve to the same
   provision as before. The one further move, `refs -1 / steps +1` on the NDAA,
   is an instruction whose target gained a section number: its navigation steps
   were the bare markers `(A)`, `(B)` and are now the addresses `(b)(1)`,
   `(b)(1)(A)`, `(b)(1)(B)`.

19. **`divisionAgrees()` may read only the enacting clause.** (Fixed
   2026-08-02.) The same "only the first clause" rule the Act index is built on,
   broken in the one place that consumes the credit rather than builds it.
   42 U.S.C. 15883 is credited

   ```
   (Pub. L. 109–58, title II, § 247, as added Pub. L. 117–58, div. D, …)
   ```

   and the only division named there belongs to Pub. L. 117-58 — the law that
   *added* the section — not to Pub. L. 109-58, the law being cited. Scanning
   the whole string found "div. D", disagreed with a citation that named no
   division, and declined a provision it had already correctly identified. This
   was a silent decline before item 18 made it reachable, and it will be silent
   again if the cut at `as added` is ever removed.

20. **A unit phrase that names its own section is not an internal reference.**
   (Fixed 2026-08-02, from a second Haiku spot-check — 371 resolutions, 19
   flagged, 11 surviving an adversarial pass.) `RE_INTERNAL` matched
   `(subsection|paragraph|subparagraph|clause) (markers)` with **no lookahead for
   what follows**, so in "Subsection (g) of section 6695 is amended" the head
   unit became a bare internal citation and `of section 6695` — the half of the
   address that says which section — was discarded. `locateInternal` then went
   hunting for a same-shaped marker in the bill and found one.
   **2,010 across the corpus**, 931 of them answered with something in the bill
   and 616 with no hedge at all. Dedupe could not save them: the internal cite's
   span is just the first two words, so it overlaps nothing that outranks it.
   The address is external and the amendment head already reads it —
   `RE_AMEND_HEAD_UNIT` composes the phrase onto the target — so dropping the
   chip leaves the right answer standing and removes the wrong one. Blank beats
   wrong.
   The one form that is **internal** gets composed instead of dropped:
   "subsection (a) of section 503 of this Act" is a complete address pointing
   inside the bill. 13 of those against 1,531 that name someone else's section
   or say nothing, which is why the default is to drop. The unit named first is
   the innermost, so its marker goes on the *end* of the section's own path —
   "Subparagraph (B) of section 1313(a)(6) of this Act" is 1313(a)(6)(B) — and
   the citation spans the whole phrase rather than its first two words.
   Watch the window: the phrase wraps across the 72-column measure ("of \n
   <24 spaces>such section"), so the lookahead reads 80 characters. A 40-char
   window misses the wrapped ones, which is a silent partial fix.

21. **A section number is not unique — on the resolving side too.**
   (Fixed 2026-08-02.) The same invariant already tracked for `#sec-N` anchors,
   broken again in `locateInternal`: `bill.sections.find((s) => s.num === …)`
   takes the first by number, so a "section 505 of this Act" written in division
   C was answered from division A. **81 across the corpus, none of them hedged**
   — the pane said a flat "Section 505 of this bill."
   This is not a heuristic to be tuned. The bills state the rule themselves, in
   their own section 3:

   ```
   any reference to ``this Act'' contained in any division of this Act shall be
   treated as referring only to the provisions of that division.
   ```

   So `sectionByNumber()` prefers a same-number section sharing the citing
   section's outermost ancestor, and falls back to first-by-number — which is
   what a bill with no divisions does on every reference, and must keep doing.

22. **A division's short title is written on the division.** (Added
   2026-08-02, closing the half of item 15 that was left open.) "Section 532 of
   the Department of Homeland Security Appropriations Act, 2018 (Public Law
   115-141)" names its division without writing the letter, because that Act
   *is* division F — and the law prints the mapping on the heading itself:
   `DIVISION F—DEPARTMENT OF HOMELAND SECURITY APPROPRIATIONS ACT, 2018`. The
   short title is an exact substring of the heading, so `narrowByTitle()` is a
   lookup in shipped data and **no table of division short titles has to be
   authored or maintained** — the same reason the Act index is trustworthy.
   10 citations across the corpus narrow to exactly one this way; the three
   reported all sat in Pub. L. 115-141, where §532 has 3 candidates, §534 has 2
   and §505 has 5.
   Two guards. Only an **unambiguous** hit counts — two divisions answering to
   one title means the title does not settle it, and the reader gets every
   candidate as before. And the **written-out path wins**: a citation that names
   the division outright is the citation saying so, and the short title only
   gets a turn where it said nothing.
   `cacheKey` needs `shortTitle` for the fourth time in this file's history. A
   memo keyed on too little is indistinguishable from a resolver bug, and here
   it fails the dangerous way round: without it a bare "section 505 of Public
   Law 115-141" inherits a division nothing in it named.

23. **A line-head marker may be a RUN of markers.** (Fixed 2026-08-02.) A
   drafter opens a subparagraph and its first clause on one line —
   `(B)(i) The President may waive …` — and `outline()` in `internal.js` matched
   a single marker with a whitespace lookahead, so it found **neither**: `(B)`
   fails because the next character is `(`, and `(i)` is not at a line head.
   887 such pairs across the corpus, every one of them a provision invisible to
   `parentSpan` and `walk`.
   **Revealing only the first is worse than revealing neither** — the one-
   character fix of adding `(` to the lookahead makes the parent findable while
   the child it introduces stays missing, so the walk gains a scope to search
   and still cannot find the thing in it. Both markers must be emitted, at their
   own depths and their own offsets. The wrap test asks about the line head, so
   it is the run's *first* marker that answers it.

24. **A phrase wraps, and every pattern here reads one physical line.**
   (Fixed 2026-08-02.) `extractSteps` splits on `\n` and runs `RE_NAV`,
   `RE_NAV_MATTER` and `RE_REF` per line, so "by striking paragraph \n(4)" and
   "in the \n   matter following subparagraph (L)" matched nothing at all —
   1,035 references and 153 navigation steps across the corpus, invisible.
   **The lines are not joined, they are overlaid.** Offsets are the first
   invariant in this file, so the probe replaces the newline with a single
   space — the same one character — and leaves the continuation's own indent
   standing as the spaces it already is. Every index into the probe is therefore
   the same index into the original text. Matches beginning past the physical
   line's end belong to the next iteration and are dropped, so nothing is
   emitted twice. The recorded `text` is sliced from the ORIGINAL string, or a
   wrapped phrase carries spaces where its line break was and `inline()` in
   `render-bill.js` sees nothing to re-wrap.
   Two things to check before touching this, because both were checked here:
   - **The join must not steal a real outline marker.** This is the exact
     hazard `app/parse/outline.js` exists for, seen from the other side. Of 693
     new matches spanning a break, `isWrappedMarker` confirms all 693 as wraps
     and **none** as a real marker — the tell being that a wrapped reference
     follows the bare unit word that introduces it, where a real marker follows
     a line that ended a thought.
   - **182 references disappeared, and that is the fix too.** `quotedSpans` now
     sees a quoted operand that spans the break, so "by striking ``subsection
     (f)(3)(B) shall be applied by \n substituting `2012'…''" no longer leaks
     its reference. Every one of the 182 is inside a quoted operand. Those are
     words being struck, not provisions being referred to.

25. **Two degrees of doubt, and one flag undersells the worse of them.**
   (2026-08-02.) `locateInternal` widens to the whole bill section when nothing
   at the referenced level exists inside the enclosing provision. Several
   candidates *inside the right parent* is a near-miss — the answer is one of
   them. Nothing in the right parent at all means the match came from somewhere
   the reference does not govern, and it is a **guess**: 1,545 across the corpus.
   Keller's call is to keep guessing and say so, so it is said three times over,
   because the eye reaches the highlight before the prose. The result carries
   `guess`, the pane heads the card "Best guess — may be the wrong provision"
   instead of the statement "Shown in the bill", and the paragraph is marked
   `.jump-guess` in the caution colour with a dashed outline rather than the
   focus colour. `jump-guess` is the one class where losing its rule loses the
   *meaning* rather than the decoration — an unstyled guess renders identically
   to a certain match — so `rendertest.mjs` asserts it is both toggled and
   styled, alongside the contract check.

26. **A vague answer is worth auditing, not just a wrong one.** (2026-08-03.)
   The first two spot-check passes sampled *answers* and asked whether they were
   right. The third sampled the **imprecise** ones — head-of-an-Act, whole
   Public Law, guess, decline, whole-section-with-no-subsection, no-target — and
   gave each one the paragraph it sits in plus the paragraphs either side, then
   asked a different question: *is a more precise target stated right here that
   the parser failed to read?* 450 cases, 301 correctly vague, 41 proposals.
   Three shapes were worth building and two were not; each was measured against
   the corpus before anything was written, which is what turned "these three
   look similar" into a number.
   The two rejected are recorded so nobody re-derives them:
   - ~~"title V of the Housing Act of 1949" — 727 occurrences and NOT worth
     building.~~ **This rejection was wrong; see item 31.** The reasoning was
     "the Act index maps an Act's *sections* onto the Code and knows nothing
     about its titles", and that is simply false — the credit names the title
     right beside the section number. Worth remembering as the failure mode of
     this whole exercise: the shape was measured correctly at 727 and then
     dismissed on an assumption about the data that nobody checked. Read a
     credit before concluding it does not say something.
   - **"paragraph (2) thereof" — 78 occurrences, deferred.** "thereof" means the
     section just named, so composing it is right in principle; the risk is that
     the phrase is commonest inside quoted *inserted* law, where it refers to the
     new provision and not the enclosing one. Worth doing with the quoted-block
     state machine, not with a regex.

27. **A note citation must not evict the address that spans it.** (Fixed
   2026-08-03.) The complement to item 14, and a sharper form of it. A note is a
   `usc` citation, so it outranks everything by kind — but it is written *inside*
   a parenthetical belonging to something else:

   ```
   Section 8301 of the Agricultural Act of 2014 (16 U.S.C. 1642 note; Pub. L. 113-79)
   ```

   Ranked normally, "16 U.S.C. 1642" evicts the whole address and the reader is
   shown the provision the note is printed *under* — precisely the confident
   wrong answer item 14 exists to prevent, arriving through `dedupe()` instead of
   through the target chain. `rankOfCite()` drops a note below `publaw` so an
   address spanning it wins, and nothing else changes: a note cited on its own
   still outranks an Act name and is still flagged.
   The flag has to be set **before** `dedupe` as well as after — before, so the
   ranking can see it; after, because `push()` may have moved the citation's
   `end` past a boundary group and testing from the wrong offset reads as working
   while flagging nothing. 102 across the corpus, every one of them a note.

28. **The Public Law is not always first in the parenthetical.** (Fixed
   2026-08-03.) An uncodified section is cited beside the note it is printed
   under — `(16 U.S.C. 1642 note; Public Law 113-79)` — and requiring the law to
   come first read none of them, so 41 kept only the bare law and lost the
   section number that made the citation an address. Exactly one leading clause
   is admitted and only a Code or Statutes cite, because that is the apparatus a
   drafter actually writes there; anything looser would let arbitrary text
   separate a name from a parenthetical it does not own, which is the same theft
   item 18's name guard exists to stop.

29. **"division E of Public Law 110-161" is an address.** (Fixed 2026-08-03.)
   `RE_ACT_DIVISION` read this shape for the 78 named Acts and nothing read it
   for a law cited by number, so 153 across the corpus kept only the bare
   "Public Law 110-161" and answered with all of it — a division of an
   appropriations act against hundreds of sections of one. `resolvePlawDivision`
   already existed; only the matcher and one branch in `index.js` were missing.
   The division is mandatory in the pattern and at least one level is required:
   a chain of titles alone does not change *which* provision is meant, and this
   exists only for the level that does.

30. **A subsection stated in prose belongs to the Code cite beside it.** (Fixed
   2026-08-03.)

   ```
   In carrying out subsection (h) of section 502 of the Housing Act of 1949
   (42 U.S.C. 1472), the Secretary shall act.
   ```

   Two halves of one address, arriving separately: the pane opened the whole of
   42 U.S.C. 1472 for a reader who had asked for (h). The same complaint that
   produced `defaultScope()`, one step earlier in the pipeline — 43 across the
   corpus, with a further 45 that repeat the subsection inside the parenthetical
   and needed nothing.
   Nothing is taken from anywhere to do this: the unit phrase stopped being an
   internal citation under item 20 precisely because it names its own section, so
   this is the address being *assembled* rather than dropped. The alternation in
   "subsection (b) or (j) of section 505" is consumed but not captured — the same
   rule `RE_ACT_REL_SECTION` follows, because nothing in the text says which of
   two the drafter meant — and the middle may not cross a second section
   reference, or the parenthetical belongs to that one instead.

31. **A title of an Act is a range, and the Code says which sections are in it.**
   (Fixed 2026-08-03, after the rejection in item 26 was challenged and turned
   out to be wrong.) The credit states the Act's own title in the same breath as
   its section number:

   ```
   42 U.S.C. 1471 -> (July 15, 1949, ch. 338, title V, § 501, 63 Stat. 432; …)
   42 U.S.C. 7661 -> (July 14, 1955, ch. 360, title V, § 501, as added …)
   ```

   So the ingester inverts both, and "title V of the Clean Air Act" is a lookup
   in the same derived data resting on the same claim as the section index —
   that it only repeats what the Code says about itself. **22,024 credits carry
   a title, 857 Acts get an index, 2,222 titles.** Across the corpus, 697
   citations are captured and **690 reach the title's sections** against none
   before.
   The two reading rules are the section index's rules, and both are ways to file
   a title wrongly:
   - **Only before the first `§`.** "…ch. 531, title XVIII, § 1861, as added Pub.
     L. 89–97, title I, § 102(a)" names two titles and the second belongs to the
     law that *inserted* the section. Reading the last one files Medicare under
     title I.
   - **A division disqualifies it.** "Pub. L. 119–60, div. C, title XXXI"
     restarts its title numbering in every division, so a bare title is not an
     address. Skipped rather than guessed at — the same refusal `divisionAgrees`
     makes on the resolving side.
   A title has no uniqueness to violate the way a section number does, so there
   is no tombstone and no conflicts file; many sections share one. The list is
   sorted by the Act's own section number, because that is the order the Act
   reads in and the reader is being shown a table of contents — a plain string
   sort puts § 12 before § 7.
   A named **section beats a named title**, the same ordering the division
   follows, and the corpus does not move at all: the citation spans more text and
   `dedupe()` already preferred the longer match at equal rank, exactly as when
   Act-relative sections were first added.
   Verified on landmarks, which is the only check worth running here: SSA title
   XVIII is 42 U.S.C. 1395 (Medicare), title XIX is 1396 (Medicaid), title II is
   401 (old-age insurance); CAA title V is 7661 (permits) and title II is 7521
   (mobile sources); HEA title IV is 20 U.S.C. 1070 (student aid); ESEA title I
   is 20 U.S.C. 6301.
   The 7 that still miss are Acts whose title is entirely uncodified.

32. **Popular names: 78 → 185, and 157 resolve their own section numbers.**
   (2026-08-03, closing the gap item 31 identified.) The same derivation TODO 9
   used, run again over the corpus, and **nothing was typed**:
   - the **entries** come from the anchor Congress writes beside a name it is
     introducing — "the Federal Deposit Insurance Act (12 U.S.C. 1811 et seq.)"
     — so name, title and section are all the bills' own words;
   - the **`enactedAs`** credits are searched for in the ingested Act index: the
     one act whose sections include the entry's own head section, keeping ≥80%
     of its mappings inside the entry's title and rejecting anything with more
     than one candidate. 92 of 107 settled; the other 15 are kept without one
     and resolve to the head of the Act, as the earlier undecided entries do.
     A miss costs nothing, a guess would cost a provision.

   **The check that makes 107 unread entries trustworthy is the bills'
   own parentheticals.** Where a bill writes "section 603 of the Fair Credit
   Reporting Act (15 U.S.C. 1681a)" it has stated the answer, so the derivation
   must agree: **693 of 711 do**. Every one of the 18 that did not was read
   against the Code's own credit, and the derivation was right each time —
   the bill had cited the Act's head, an `et seq.` range, a provision
   transferred from title 42 to title 34 in 2017, or a **former** section
   number:

   ```
   FCRA § 624  -> 15 U.S.C. 1681s-3   "(Pub. L. 90–321, title VI, § 624, as added …)"
   the bill says 1681u, which is       "… § 626, formerly § 624 …"
   ```

   That is the "formerly § N" rule the ingester was fixed for, showing up on the
   other side of the table. When re-running this, normalise EN DASH to hyphen
   before comparing or the check reports `15:278g–3` and `15:278g-3` as
   different sections, and exclude `et seq.` parentheticals or it compares a
   section against the Act's range.

   Two filters earn their place. A candidate must **look like a short title** —
   every word capitalised, an acronym, or a small connective — which is what
   rejects "State program funded under part A of title IV of the Social Security
   Act", a phrase the et-seq. pattern otherwise harvests as a name. And the
   **anchor must be a shard that exists**, so a mis-read parenthetical cannot
   introduce an Act pointing at nothing.

   Corpus: `byKind.act` and `citations` both +1,906 and nothing else moved,
   which is the signature of pure addition — no existing citation was displaced.
   Of 1,902 measured, **0 are false positives** (every span contains the words
   of the name it matched), 929 of 975 section citations (95%) reach a real
   provision, 90 of 96 title citations reach a title's sections, and all 107
   Acts are genuinely cited. `targeted` +29.

   Worth knowing before extending: a harvested short title can be a **substring
   of a longer one**. "Department of Agriculture Reorganization Act of 1994" is
   really title II of the "Federal Crop Insurance Reform and Department of
   Agriculture Reorganization Act of 1994", so the chip starts mid-name and
   "section 308" of the combined Act reaches the wrong sub-Act's head. It is
   harmless here only because that entry is one of the 15 with no `enactedAs`,
   so no provision is asserted. Adding the longer name would fix it; adding an
   `enactedAs` to the shorter one without the longer would not.

33. **Seven parser fields are still written and never read.** (2026-08-03.) An
   audit enumerated every field set on ops, citations, amendments and steps and
   grepped every consumer in `app/ui`, `app/resolve`, `main.js`, `export.js` and
   `index.html` — checking destructuring, spreads and computed access, not just
   a raw grep. Ten came back unread; three were fixed the same day (`operand`,
   `implied`, `etSeq` — see the invariant above). Ranked by corpus frequency,
   what remains:
   - `ladder` (40,995 citations + 8,514 amendments) and `bill.sections[].division`
     (9,039 of 9,120 sections) — **not bugs.** The pane re-derives the ladder,
     and `division` is superseded by `ancestors`. Candidates for deletion, not
     for wiring up; both cost a field on every object.
   - `amendment.verb` (8,514) — 8,342 "amended", 155 "repealed", 17
     "redesignated". **13 redesignations produce no ops at all**, so
     `attachEffect` returns early and the reader gets the provision with no
     indication the bill renumbers it: "Section 55301 of title 46 … is
     redesignated as section 55123 of such title" says exactly what it does and
     the pane says nothing. All 13 are in the NDAA. The destination is not
     captured anywhere, so this needs a matcher as well as a consumer.
   - `viaAct` (973 citations, 19 bills) and `subFromProse` (35) — both record how
     an address was ASSEMBLED, which is the same kind of auditability `implied`
     and `relative` now show. `subFromProse` is TODO 30's flag: "In carrying out
     subsection (h) of section 502 of the Housing Act of 1949 (42 U.S.C. 1472)"
     opens 1472(h) rather than all of 1472, and does not say why.
   - `cite.unit` (50 CFR citations) and `distributed`/`viaInstruction` (23
     amendments, 6 instructions, 3 bills). The second is the "Each of the
     following is amended" form — the pane never says this amendment is one of
     several sharing one instruction.
   Also unread and worth its own look: `etSeq` is now consumed for additions but
   the READER is still not told that "15 U.S.C. 2601 et seq." names a range —
   2,093 citations answer with a single section under a heading that names it
   alone.

---

## Layout

```
index.html            UI + boot diagnostic (classic script, runs when modules fail)
embed-example.html    host page for trying the iframe embed; not part of the app
app/main.js           wiring; ingest() is the single entry point for bill text
app/share.js          fragment-encoded share links (deflate + base64url)
app/export.js         one self-contained offline HTML file of the whole reading
app/parse/            pdf.js · bill.js · citations.js · outline.js  (extraction)
app/resolve/          cfr.js (live eCFR) · usc.js (local shards) ·
                      plaw.js (Public Law text) · act-sections.js ·
                      internal.js (refs within the bill) · provision-tree.js ·
                      popular-names.js · data-base.js · index.js (dispatch)
app/ui/               render-bill.js · render-context.js · redline.js · style.css
app/resolve/bundle.js one shard out of a bundle, by HTTP Range
tools/                ingest_usc.py · ingest_plaw.mjs · bundle.mjs · make-library.mjs ·
                      serve.py · selftest.mjs · rendertest.mjs ·
                      measure.mjs (shared metrics) · impact.mjs · corpus.mjs
corpus/               corpus.json + baseline.json · files/ — all tracked
data/usc/             tN.idx.json + tN.N.jsonl — 60,436 sections in 54 parts
data/plaw/            26 Public Laws, same shape; both tracked — the data IS the site
```

Citation kinds: `usc` `cfr` `publaw` `stat` `act` `internal`. Relative addresses
are `usc`/`cfr` with `relative: true` and ids prefixed `r`.

34. **675 operations address a level their provision does not have, and the
   cause is mostly us.** (2026-08-03.) `reScope()` in `redline.js` stops these
   vanishing silently — 610 more widen to a level that exists, 675 survive
   nowhere and are now reported — but the *reason* they exist was asserted
   before it was measured, and the first answer ("mostly drafting errors,
   extrapolated from one real one") was wrong. Classified:

   ```
     46  dropping the leading marker gives a real path
    413  every marker exists in the tree, but not in that order or nesting
    199  the leading marker is nowhere in the provision at all
   ```

   658 of 675 are plain U.S.C. cites, not Act-relative, so the Act-numbering
   hazard is not it either. Two of our own faults are confirmed and each is
   worth its own pass:
   - **The CODE can omit a level the statute plainly has, and that is not our
     bug.** 42 U.S.C. 4332 ships with `(A)`–`(L)` at top level and no `(2)`, so
     the correct address `(2)(A)` matches nothing. I called this an ingest/USLM
     structure bug twice before downloading the XML, and it is neither: the
     OLRC's own markup puts NEPA's "(1) the policies … and (2) all agencies …
     shall—" inline in the `<chapeau>` and hangs the `(A)`–`(L)`
     `<subparagraph>` elements straight off the `<section>`. There is no `(2)`
     element in the source. `build_nodes` reproduces exactly what is there.
     **Do not "fix" the ingester for this** — synthesising the level would make
     our shards disagree with the Code they claim to be. 17 sections of 35,054
     are shaped this way; `reScope()` copes by dropping the leading marker when
     the tail is a real address.
   - **Scope composition can drop a level.** (Fixed 2026-08-03; see item 35,
     which turned out to be the larger half of this whole entry.)

   A bill really can write a bad address — the Fiscal Responsibility Act cites
   "7 U.S.C. 2015(6)(o)(3)" for 2015(o)(3), and cites it correctly thirty lines
   later — but that is one citation, not the pattern. Do not repeat the mistake
   of reading one example and naming the cause.

35. **An instruction states its address in its first six words, and nothing was
   reading it.** (Fixed 2026-08-03, from item 34's second confirmed fault.) The
   named symptom was one step composing short — "section 2(a)(36) of the
   Investment Company Act" reaching 15 U.S.C. 80a-2 as bare `(36)`. Measuring it
   found three faults in the same place, and the third was the big one:

   - **The base path came from the parenthetical alone.** "Section 2(a) of the
     Investment Company Act of 1940 (15 U.S.C. 80a-2) is amended-- (1) in
     paragraph (36)" composed `(36)`, because the cite carries no subsection and
     the head's `(a)` was never consulted. The same bill writes the provision out
     in full four lines earlier, so the right answer was never in doubt. 406
     instructions, 209 navigation steps, 396 already-scoped operations.
   - **An instruction that never navigates was left unscoped entirely.** This is
     the larger half — **813 operations**. "Subsection (g) of section 6695 is
     amended by striking ``X''" has no steps, so the strike carried no scope and
     searched the WHOLE of section 6695: every subsection the instruction had
     just said it was not talking about.
   - **The inner unit was composed on the front of the path, not the end.**
     "Subparagraph (B) of section 280F(d)(7)" is 280F(d)(7)(B), and `innerSub +
     h.subsection` made it 280F(B)(d)(7). 208 amendments. Item 20 already states
     the rule — the unit named first is the innermost — and this was the one
     place that broke it.

   **The codified subsection still wins wherever the citation states one**, and
   that ordering is load-bearing rather than incidental: 12 U.S.C. 375 IS section
   22(d) of the Federal Reserve Act, so the Act's own `(d)` names nothing in the
   codified section. 3,467 of 3,731 agree and all 28 that genuinely differ are
   that shape. The head is consulted only where the parenthetical said nothing.

   The head's address is a **claim, not an assertion**, and the difference is
   what keeps this safe. It exists in the resolved provision for 265 of the 306
   that resolve; the other 41 are the divergence above. Those carry
   `scopeFromHead`, and `reScope()` shortens such a scope to **nothing** — the
   whole provision, which is exactly where the op applied before any of this —
   rather than reporting it lost. That is the one exemption to reScope's "never
   shorten to nothing" rule, and it must stay narrow: a navigation step naming a
   level that does not exist is genuinely unaccounted for, and widening *that*
   to the whole section is the hazard `scope` exists to prevent.

   **Coverage FELL, 25% → 23%, and that is the fix working.** This is the
   counts-are-not-enough rule arriving as a number that moves the wrong way, so
   read the marks before believing the metric. Of 304 marks withdrawn, 246 were
   provably outside the provision the instruction named, and every one of a
   sample read by hand was wrong:

   ```
   Section 11(d) is amended by striking ``the tax imposed by subsection (a)''
     -> was struck in 26 U.S.C. 11(b), the 21 percent corporate rate
   Section 7(a)(3)(A) of the Federal Reserve Act … striking ``$10,000,000,000''
     -> was struck in 289(a)(1)(A)(i), an asset threshold in another clause
   Subsection (b)(4) of such section 9442 … striking ``him''
     -> was struck in 9442(a), a provision about cadet strength
   ```

   Against that, **331 marks moved from outside the cited provision to inside
   it**, and addresses surviving nowhere halved, 618 → 280. The headline
   percentage counts marks drawn and cannot tell a right one from a wrong one;
   `tools/coverage.mjs` is a report and not a score, and this is the case that
   proves it. Additions moved the same way: drawn +33, stranded -74.

   Found on the way, and it is the same bug seen from the other side: **a
   navigation phrase's claim on the markers inside it was kept per line and in
   probe-relative offsets.** A phrase that wraps the 72-column measure — "in the
   \n matter following subparagraph (L)" — is matched on one line's overlay probe
   while the bare "subparagraph (L)" is matched on the NEXT line's iteration, by
   which time the claim list has been thrown away. So the phrase both scoped the
   operation and pointed the reader at (L), the one provision it identifies
   itself by staying outside of. 68 across the corpus. Claims are absolute and
   outlive the line now.

   Corpus, fully accounted: `steps +28` (matter-phrases that only now have a
   parent to name — item 4's rule, "no parent, no matter"), `refs -96` (28
   reclassified plus the 68 absorbed), `relative -63` (67 removed, each
   overlapping a removed ref; 11 added, each on a new step). Nothing else moved
   at all — not citations, amendments, targeted, opSpans or diffSpans.

36. **A new provision is longer than a phrase, and the operand budget was
   deleting it.** (Fixed 2026-08-03. Found by *looking at the screen* — see item
   11 — after Keller pointed out that every problem he brings comes from the
   rendering. It took one screenshot.) The symptom on screen: the Fiscal
   Responsibility Act's § 101 showed a single `strike` chip, and the pane said
   "⚠ not found verbatim … usually means the amendment targets a different
   subsection than the one shown" about a strike whose subsection was exactly the
   one shown. The bill's actual substantive change — the FY2024 and FY2025
   discretionary caps — appeared nowhere. Three faults in a chain, and each one
   alone would have kept the screen wrong:

   - **`RE_INSERT` capped its quoted operand at 400 characters, and the cap did
     not truncate.** The lazy run cannot reach the closer, so the whole match
     fails and NO op is created. Across the corpus 779 "inserting after ⟨unit⟩
     (N) the following" phrases yielded 307 operations; 379 of the 428 missing
     blocks that can be measured run past the cap, at 800 to 3,450 characters
     each. `readAddedBlock()` has read `adding at the end the following` this way
     since 2026-08-01 for exactly this reason; the sibling form never got it.
     **A character budget is the wrong instrument for a block delimited by
     quotes.** Worse than missing: where the block contained a single-quoted term
     (``` `mine land' ```, not a closer), the engine gave up on the first quote
     pair and RE-MATCHED FROM A LATER OPENER, recording a span that began 59
     characters into the new paragraph, mid-definition.
   - **`fold()` knew the four quote conventions and not the dash.** govinfo writes
     the em dash as `--` and the Code writes `—`, so `(9) for fiscal year 2024--`
     and `(9) for fiscal year 2024—` differ in one character out of eighty and
     `alreadyIn()` said no. Fixing only the cap would therefore have made the
     screen WORSE: paragraphs (9) and (10) drawn in the insertion colour beside
     the identical paragraphs already in the law. The ASCII hyphen is left
     distinct on purpose — `REG-ISTRATION` and `PAY-AS-YOU-GO` carry real ones.
   - **A block's own paragraph openers are structure, not words.** GPO opens every
     paragraph of a multi-paragraph addition with a quote mark and closes once at
     the end, so `fold` turned each interior opener into a `"` the Code can never
     match. Stripped in `alreadyIn()`, and only at a line head.

   Two reporting faults fell out of the same screen. `appliedAdditions()` filtered
   on `applied`, which is set inside `additionsAt()` — so "has this amendment
   already happened?" depended on which node the renderer happened to be laying
   out. It asks `inLaw` now, decided at construction against the whole provision,
   which is what the comment where `inLaw` is computed already said it was for.
   And the `unmatched` caveat printed unconditionally: `unmatched` is true of an
   enacted amendment BY DEFINITION, so the sentence sat directly beneath
   "✓ already struck from the law" contradicting it.

   Corpus: `opSpans +393` and **nothing else at all** — no citations, amendments,
   targeted, diffSpans, refs, steps, relative, `overlaps` or `badOpOffsets`.
   Accounted exactly: 394 spans added, 1 replaced. Every one of the 394 is a
   block over the old budget; 383 are placed structurally as `after-unit` and 11
   open with a flush sentence rather than a marker, so they are captured but
   deliberately not placed, per the rule `scopeAdditions()` already follows. The
   1 replaced is the `mine land` span above — same end offset, correct start.
   Checked before `--update`: 0 ops sharing a start, 0 overlapping insert spans,
   0 spans failing the `badOpOffsets` round-trip, and in **371 of 375** the added
   block's leading marker is the anchor's successor ((2)→(3), (F)→(G), (a)→(b)).
   Of the four that are not, two are limits of the checker (roman past XX,
   doubled letters) and two are bills that skip a letter.

   For the reader, which is the number that matters here: **additions 2,687 →
   3,061**, of which **+220 are drawn** and **+108 are correctly marked already
   in force**. Inline coverage barely moves (23%), because this family was never
   in it.

37. **The crumbs are a way out, not a caption.** (2026-08-04, from Keller's
   standing rule: *err towards giving the user more safe precision, while
   showing with the chip structure that they can expand out.*) Every shard has
   carried the USLM identifier on every ancestor since ingest —
   `/us/usc/t7/ch51` — and the pane rendered it as inert grey text. The reader
   could SEE that 7 U.S.C. 2011 sits in chapter 51 of title 7 and could do
   nothing with it. This app has no whole-chapter view, so the honest "expand
   out" is out to the Code.
   `crumbHref()` maps the identifier onto law.cornell.edu, which mirrors the
   USLM hierarchy exactly, so the transform is mechanical rather than inferred.
   **200,675 crumbs Code-wide, 100% linked, 0 declined**, and all 25 distinct
   hierarchy shapes checked live at 200.
   Three things earned their place:
   - **`spt` before `st`, and the number may be LOWERCASE.**
     `/us/usc/t42/ch6A/schII/ptD/sptiii` is subpart iii. A prefix table tried in
     alphabetical order reads it as a subtitle, and a number pattern anchored on
     `[A-Z0-9]` drops every one of them.
   - **The EN DASH, again.** `schIII–A` is a real subchapter with a real page
     behind it, and the URL wants an ASCII hyphen — the same normalisation
     `slug()` does. Left out it declined 1,583 crumbs *silently*, which is what
     makes a safe default expensive rather than free: the last 0.79% was invisible
     until it was counted.
   - **An unrecognised level returns null and the crumb stays a `<span>`.** A
     guessed path is a 404 wearing this app's confidence; grey text costs the
     reader nothing they did not already have. It must stay a `<span>` and not
     become `<a href="">`, which reloads the app and throws the reading away.
   `.crumbs .crumb` gained `text-decoration: none`, because a UA-underlined
   anchor inside a pill reads as a mistake and the hover rule was already the
   affordance. Confirmed by computed style rather than by eye: same background,
   ink, radius and padding as the inert pill, with `cursor: pointer`.

38. **`et seq.` names a range, and the pane now says so.** (2026-08-04.) The
   last of the fields TODO 33 listed as written-and-never-read at the READER.
   "15 U.S.C. 2601 et seq." is the Toxic Substances Control Act; the pane
   answered with § 2601 alone, under a heading printing a bare "15 U.S.C. 2601".
   **2,620 citations across 28 corpus bills** — a confident answer to a question
   the citation did not ask, which is this app's worst category.
   The heading carries "et seq." now, and a card states what is known and
   refuses what is not: where the range begins, that this is its first section,
   and that **nothing in the citation says where it ends**. That is the same
   refusal `markRangeAdditions()` already makes on the drawing side.
   The way out is the CHAPTER crumb, not the deepest one: an Act codified as a
   block is normally one chapter (TSCA is chapter 53 of title 15) where the
   deepest level is a subchapter, which is a slice of the range rather than the
   range. The card never claims either one IS the range.
   **`cacheKey` needed `etSeq`, for the fifth time this pattern has cost
   something.** "15 U.S.C. 2601" and "15 U.S.C. 2601 et seq." agree on kind,
   title, section and subsection, so without it the first of the two clicked
   answered for both — silently, and in whichever direction the reader happened
   to click first. Asserted in both orders, because a memo is order-dependent by
   nature. `isRangeStart` is set on the missing-section branch too: whether the
   bill named a range is a fact about the CITATION, not about whether we hold
   the section it starts at.
   Corpus does not move at all — this is resolution and rendering.

39. **A redesignation says what it does.** (2026-08-04, closing the largest
   half of TODO 33's `amendment.verb`.) "Section 55301 of title 46 … is
   redesignated as section 55123 of such title" states its own destination and
   the pane said nothing whatever: `verb` recorded "redesignated", no op was
   emitted, and `attachEffect()` returns early on `!ops.length`. 13 of the
   corpus's 17.
   Emitted as an ordinary `redesignate` op, because the panel already draws that
   shape as "from → to" — the destination was the only thing missing, so the
   consumer came free. The op carries **no span**: the language is not changing,
   so there is nothing in the bill to mark, and a span that did not round-trip
   would break `badOpOffsets` for nothing.
   Corpus `redesignate +13`, accounted exactly: 17 amendments with the verb, 13
   gained a head-level op, 4 decline and 0 doubled. The 4 are "is transferred to
   section X and redesignated as…", which is a different operation — a transfer
   moves a provision between sections and the destination phrase is not this
   one. Declining is right; guessing at it would name a provision the bill did
   not.

40. **A division heading ends the section above it.** (Fixed 2026-08-04, found
   by LOOKING at the Public Law pane.) `parseBill` closed a section only when
   the next SECTION started, so the last section of every division ran on
   through the heading that ended it:

   ```
   Pub. L. 117-58 § 905
     …This division may be cited as the ``Infrastructure Investments and
     Jobs Appropriations Act''. DIVISION K-- MINORITY BUSINESS DEVELOPMENT
   ```

   — the next division's heading, shown to the reader as part of § 905. 352 of
   the 19,612 section entries in `data/plaw`, 1.79%.
   **No metric could see it, and that is the lesson.** A section's `end` is not
   counted by anything: the corpus does not move by a single number, selftest
   and rendertest both passed, and it had been true for the whole life of the
   project. It took one screenshot.
   `current` is cleared as well as closed, or the next section's own
   `current.end = lineStart` reopens it and pushes the end past the division
   again — the same bug one step later. The table of contents is untouched,
   because what follows a division heading THERE is another listing rather than
   a real body, which `realBodyFollows()` already asks; assert both ways, since
   a fix that cut the table into pieces at every division it names would also
   pass "no section contains a later heading".
   After re-ingesting `data/plaw`: 352 → 1, entry count unchanged at 19,612, so
   the fix only trimmed boundaries. The one left is Pub. L. 116-283 § 8513,
   where the label itself wraps (`TITLE 
LVXXXVI--FEDERAL MARITIME
   COMMISSION`) on a roman numeral the law malforms. Matching a wrapped label
   would risk false positives across every bill to fix one instance.

   Two more from the same sweep, both invisible to every test:
   - **The level ladder read the section number off the LAST WORD of the display
     citation**, so the moment "et seq." reached the heading every rung rendered
     `§ seq.`. A regression shipped an hour earlier, caught by eye rather than
     by assertion. `resolveUsc` carries `title` and `section` as data now — a
     display string is for display.
   - **"The bill says 'section 111 of the Pub. L. 116-93'".** The definite
     article belongs in front of an Act's NAME, and `viaActSection` also serves
     a Public Law cited by number.

41. **A cross-reference inside quoted new law belongs to the statute, not to the
   bill.** (Fixed 2026-08-04, from Keller's screenshot of the Tax Cuts and Jobs
   Act: *"I think anywhere a section is mentioned within a quote"*.) The
   screenshot showed the mild half — a chip reading "subsection (d)" answering
   with a note that no (d) appears anywhere in that section of the bill. The
   sentence it sat in was:

   ```
   Section 1 is amended by adding at the end the following new subsection:
   ``(j) Modifications for Taxable Years 2018 Through 2025.--
       ``(2) Rate tables.--
           ``(D) Married individuals filing separate returns.--The
       following table shall be applied in lieu of the table contained
       in subsection (d):
   ```

   which names 26 U.S.C. 1(d), the very table this one replaces. The severe half
   was one line up and invisible: the identical "subsection (a)" in subparagraph
   (A) *was* answered — with **section 11001(a) of the bill itself**, the
   instruction sentence, under the heading "The only (a) inside the enclosing
   provision". `locateInternal` searched the whole bill SECTION, and a bill's own
   sentences and the law it is writing are the same characters in the same file.
   Across the corpus, on op-delimited blocks alone: **1,336 unhedged wrong
   answers and 379 more marked a guess**, against 1,331 that answered nothing.

   Three parts, and the first is the one that matters:

   - **The block is the boundary.** `quotedBlocks()` in `app/parse/outline.js`
     is the one spelling of where new law begins and ends — pairs, not an
     alternation, so a block opened with two backticks closes on two apostrophes
     and not on a curly double inside it, the same rule `readAddedBlock()` reads
     an addition by. `extractCitations` flags each internal citation that sits in
     one and `locateInternal` may not answer past that edge. It still widens, it
     just widens to the end of the new law rather than to the end of the bill
     section.
   - **Outward references are composed.** `quotedRefs()` reads the block against
     the section it is being written into. 1,965 addresses across the corpus,
     **1,878 of 1,957 (96%) reaching a provision that exists in the Code** —
     measured the way the Act-relative pass is measured. Audited by three
     independent adversarial reads of 45 sampled cases: 44 right, 1 wrong, and
     the one wrong was item 42 below rather than this rule.
   - **The note says which silence it is.** "No (d) appears anywhere in this
     section of the bill" is a parser shrug at a citation that was never about
     the bill. Where the instruction names no Code section, the pane now says the
     reference points into the law being amended and that nothing here can
     identify it.

   This narrows the standing rule that **nothing inside quoted inserted law is a
   Code address**, and the narrowing is the whole correctness argument. Three
   positive tests, each refusing rather than guessing:

   - **The marker is not in the block**, asked first, so new law referring to
     itself never reaches the composition. A block adding (D), (E) and (F) at
     once contains its own siblings.
   - **The composed address has no GAP in its levels.** The block states its own
     depth through its leading marker and everything above comes from the path it
     joins; a reference deeper than the block has nothing to supply the levels
     between. This is exactly what rejects the shape the standing rule was
     written for — "For purposes of subparagraph (A)", in a paragraph the bill is
     ADDING, became 7 U.S.C. 8101(3)(A), a real provision about something else,
     and was ~40% of all composed addresses when last let through. (A) at
     subparagraph depth over a base that stops above it leaves depth 1 empty, and
     it is refused. Asserted directly in `selftest.mjs`.
   - **The phrase does not continue into an address of its own.** "subsection (b)
     of section 6033" and "paragraph (2) thereof" are somebody else's. Watch the
     tail: `MARKER_LIST`'s separator is a comma OR the word, never both, so
     ", or (o)" stops the list dead and "under subsection (b), (c), (m), or (o)
     of section 414" was read as a bare "subsection (b), (c), (m)" with the
     section number sitting just past the match. The gap may also carry a quote
     opener, because GPO opens every quoted paragraph with one and a phrase that
     runs past the measure continues behind it.

   And one guard that is cheap and free: where the marker's own STYLE has an
   unambiguous opinion and the unit word disagrees with it, decline. "paragraph
   (h)(5)" composed 7 U.S.C. 2025(h)(h)(5), the same letter twice. 9 of 2,041,
   every one reaching nothing, and 0 good addresses lost. (i), (v) and (x) get no
   opinion — they are a letter and a numeral at once.

   Corpus, accounted to the unit: `refs` +1,965 and `relative` +1,965 on 25 of
   the 30 runs, **and nothing else moved at all** — not citations, amendments,
   targeted, opSpans, diffSpans, steps, overlaps or badOffsets. 1,957 in the 26
   corpus files, 4 in `samples/sample-bill.txt` and 4 in the CLARITY House-passed
   PDF, which is also the check that this works on the doubled-single quote
   convention. The two deltas are equal on every bill, which is the signature of
   pure addition: each new ref becomes one new relative citation and no existing
   one is displaced. Everything the new addresses displaced is an `internal`
   citation (1,741) — the point of the exercise. 0 spans failing the round-trip
   and 0 pairs of citations sharing a start.

   Worth knowing before extending it: only `add-at-end` and after-unit inserts
   are eligible, because only those carry a scope derived from the block's own
   leading marker, which is what says how deep the new law sits. A block bound
   for the end of an Act (`rangeEnd`, item 33's `etSeq`) is left alone, since
   nothing knows which section it lands in.

42. **The head's address is a claim for CITATIONS too, and only the operations
   were testing it.** (Fixed 2026-08-04, from the adversarial audit of item 41 —
   the one case in 45 the judges caught, and it was not item 41's rule.) Item 35
   established that where the parenthetical carries no codified subsection the
   instruction head is the only address there is, and that the head's claim is
   tested rather than asserted. It is tested for op scopes, by `scopeFromHead`
   and `reScope()`. The citation the reader actually clicks had no equivalent
   check:

   ```
   Section 311(d) of the Legislative Branch Appropriations Act, 1988
     (2 U.S.C. 4532) is amended— (1) in paragraph (1) …
   2 U.S.C. 4532 credit: "(Pub. L. 100–202, § 101(i) [title III, § 311(d)], …)"
   ```

   The codified section IS § 311(d), so 4532's top level is the paragraphs
   (1)–(4) and there is no (d) in it, by construction, ever. Every reference in
   that instruction composed one level too deep, and the pane answered each with
   "the current text of this section has no such subsection — the bill is adding
   it, or it has been renumbered or repealed". Both explanations false, stated
   confidently, about a paragraph sitting a few lines up in the same pane which
   this very bill inserts. Same family as 12 U.S.C. 375 = Federal Reserve Act
   § 22(d), which item 35 already names. 17 across the corpus.

   `dropHeadLevel()` in `app/resolve/usc.js` drops the level, and the pane says
   which and why rather than silently showing a different one. Two guards, both
   needed:

   - **Only an address composed from the head.** `subFromHead` carries the
     head's own subsection through `expandRelativeRefs`. A bill that writes
     "12 U.S.C. 5701(b)(1)" out in full has said what it means, and if that is
     wrong it is the drafter's error to show, not ours to paper over.
   - **The dropped marker must be absent from the section's own top level.**
     "clause (i)" composed onto 26 U.S.C. 168(k) dies because (k) has no clause
     (i), not because (k) is wrong — and 168 *does* have a subsection (i), so
     dropping the (k) answers with a different provision. 15 of the 65 addresses
     whose tail happens to resolve are that shape, and the narrow test refuses
     all 15.

   Not repaired, and deliberately: 250 head-derived addresses still miss. Most
   are a target that is wrong further up — "the State Small Business Credit
   Initiative Act of 2010 (12 U.S.C. 5701 et seq.) … in section 3003 … in
   subsection (b)" composes onto 5701 because the range answers with its first
   section, and dropping the (b) would give 5701(1), a definition. A repair is
   only safe where the level is the one thing wrong.

   `cacheKey` needed `subFromHead`, for the SIXTH time this pattern has cost
   something: the written-out and the composed address agree on title, section
   and subsection and only one of them may be repaired.

43. **Three faults found by spot-checking item 41, two of them mine.** (2026-08-05.
   Keller asked for spot-checks; the answer was 19 right and 11 wrong out of 30
   sampled declines, agreed independently by two lenses, and the 11 were not
   judgement calls.) The lesson is item 41's own: **the population a change
   creates has to be audited as hard as the population it fixes.** Item 41 was
   audited on the addresses it *composed* — 44 of 45 right — and not on the
   answers it *withdrew*, which is where its own regressions were.

   - **A quoted block's own opening marker was invisible.** `outline()` scans
     from `re.lastIndex = from` with a pattern anchored `(?:^|\n)` and no `m`
     flag, so past offset 0 only a literal newline can begin a match. That was
     harmless while every caller passed a section boundary, which is a line
     start. A quoted block is not: it begins mid-line at its quote opener, and
     its first marker sits two characters later —

     ```
     ``(A) In general.--The Secretary shall …
     ``(B) Exception.--Subparagraph (A) shall not apply …
     ```

     — so setting `lastIndex` to the block start put the engine PAST the only
     newline that could match, and (A) could never be found. **185 of H.R. 1892's
     185 marker-opening blocks**: all of them. This is the commonest reference
     there is in inserted law, a provision referring back to the one that opens
     the block it sits in, and item 41 broke every one of them in the same breath
     as it fixed the outward ones. Worse, `quotedRefs` reads the same outline to
     ask "is this marker in the block?", so the same blindness composed 127
     self-references OUT to the Code — the exact failure the standing rule
     exists to prevent, reintroduced by the fix for it.
     The scan starts at the newline ITSELF (not the character after it, which
     cannot match either) and markers beginning before `from` are dropped. That
     second half is what keeps the bounding honest: the bill's own
     sub-instruction marker at the head of the same line — "(3) by adding at the
     end ``(B) …" — stays outside. Checked: 0 blocks leak a marker from before
     themselves.
   - **A block over the runaway guard fragmented into its own paragraphs.**
     `quotedBlocks` skipped a block whose closer is past `MAX_QUOTED` *without
     advancing the cursor*, so every quoted paragraph inside a 95,000-character
     rewrite opened a block of its own and a reference was bounded to one
     paragraph of it — with the answer 40,000 characters away in the same
     provision, unreachable. The cursor moves past it now and nothing is
     claimed, so those fall back to the whole bill section, which is what they
     had before any of this and is honest. A fragment is a boundary this module
     invented. 424 references.
   - **A reference inside a quoted OPERAND was still being composed.** Not mine —
     it predates item 41 — but it is the same sentence Keller reported, seen from
     the composition side. `extractSteps` excludes references inside inline
     quoted operands, and computed that exclusion per line against the two-line
     overlay. It fails whenever the operand OPENS on an earlier line than the
     reference in it: the probe carries no opener, so the first quote characters
     it meets are the CLOSER, every span it computes is shifted by one quotation,
     and the reference falls outside all of them.

     ```
     Section 59(j)(2)(B) is amended by striking ``for `1992' in
     subparagraph (B)'' and inserting ``for `2016' in subparagraph (A)(ii)''
     ```

     "subparagraph (B)" there belongs to section 1(f)(3); the pane answered
     59(j)(2)(B). **635 across the corpus, and every one of the 635 spans a line
     break** — not one single-line operand leaked, which is the signature that
     names the cause. Scanned whole and kept in absolute offsets now, for the
     same reason `quotedRefs` scans a block whole: the pairing question is about
     the quotation, and a quotation does not know where the measure fell.

   And one wording fault, small and flatly false: `quotedBlocks` calls a
   quotation a **phrase** when it carries no line-head marker and is under 400
   characters, because a bill hard-wraps at 72 columns and the operand of a
   strike lands at a line head whenever the instruction breaks in front of it.
   366 of the corpus's quoted-law references sit in one, 62 of them in language
   being STRUCK — where "This sits inside language the bill is inserting" said
   the opposite of what the bill does. Both bound a reference the same way; only
   the sentence differs.

   Corpus: `refs` -751, `relative` -668, `steps` -13, and nothing else. Accounted
   exactly: -624 refs / -541 relative from the operand fix (635 removed, 2
   re-composed at a different path, 633 of 635 provably inside a quotation and
   the other 2 on an amendment with no target at all, so invisible to the
   reader), and a further -127 of each from self-references correctly staying
   internal. Composed inserted-law addresses 1,957 -> 1,830, of which **1,753
   (96%) reach a provision that exists in the Code**, 0 sharing a start and 0
   failing the round-trip. The redline does not move by a single operation:
   `tools/coverage.mjs` reports 3,495 of 15,237 before and after.

   **Left deliberately, with the evidence.** The audit named four more, and each
   is a real gap rather than a bug:

   - **A sibling quoted block of the same bill section.** 6 of the 30 sampled
     declines point at a provision the same bill creates a few instructions
     away — SEC. 602(a) adds IRC 403(b)(17) and SEC. 602(b) cites it. Widening
     to those is right in principle and must be keyed on the amendment's
     resolved TARGET, never on proximity: TCJA 14401 quotes both 59A(a) and
     6038A(a), and proximity alone would answer a 6038A reference with 59A(a).
   - **The decline could name the address it already knows.** Every correct
     decline has a computable statutory answer — the enclosing instruction's
     target plus the reference's own marker path — and says "the provision can't
     be identified from here" instead. What stops it today is the gap rule, which
     is right to refuse a composed ADDRESS; naming the section and letting the
     reader open it is a weaker claim than composing, and probably allowed.
   - **A reference to a level the same instruction is renumbering** cannot be
     matched against pre-amendment text at all. The redesignate op is parsed
     (item 39); nothing asks it.
   - **The counters cannot see any of this.** "1,677 lost" is one number covering
     honest declines, the block-head bug, the fragmentation and the sibling gap.
     All three faults above would have been visible on the first run of a counter
     split four ways, and none of them is visible to selftest, rendertest or the
     corpus baseline — they are resolution, which the corpus is deliberately
     blind to. That is the strongest single suggestion the audit produced.

44. **The counter that would have caught item 43 exists now, and it names the
   next piece of work.** (2026-08-05.) Item 43's own strongest finding was that
   "1,677 lost" was one number covering four different things, which is how three
   separate faults shipped inside one change. `tools/impact.mjs` prints the split:

   ```
   internal refs by fate  composed 27 · in bill 24 · in its own block 28 ·
                          points out of the block 1 · declined 2 · unresolved 2
   ```

   Corpus-wide, over **40,955** bare internal cross-references:

   ```
     composed    11,530   superseded by a real Code address — the best outcome
     inBill      14,470   not in quoted law, found in the bill
     inBlock     10,280   in quoted law, found inside that block
     headAbove      628   in quoted law, NOT found, and the reference names a
                          level SHALLOWER than the block's own root marker
     declined     1,737   in quoted law, not found, nothing more to say
     unresolved   2,310   not in quoted law, not found
   ```

   36,280 of 40,955 (89%) get an answer. `headAbove` is the interesting column
   and the reason it exists: those references **provably** point out of the block
   they sit in — the block cannot contain a level above its own root — so unlike
   `declined` they are not a judgement call. Classified:

   ```
     447  no op delimits the block at all
      82  the block IS eligible and the target IS a Code section
      40  the op is an insert that is not after-unit
      59  the amendment's target is a Public Law, an Act, or absent
   ```

   The 447 are **one shape**, and it is TODO 12's open item seen from the citation
   side: `Section 1(f)(2)(A) is amended to read as follows: ``(A) except as
   provided in paragraph (8) …''`. A whole-provision replacement emits no op that
   carries the block, so `quotedRefs()` never sees it — while the block's address
   is the one thing this shape states with certainty, because the block IS the
   provision the target names. Base path = the target's own path with its last
   marker dropped, no depth inference needed. That is the next piece of work here
   and it is bigger than it looks: capturing these as ops moves the redline too.

   Of the 82, a sample of four was read by hand and three were **correct**
   refusals the classifier is too coarse to see — "subsection (a) or (d) of
   section 437 of the Higher Education Act" continues into its own address, and
   "subparagraph (C) thereof" names the provision just mentioned. Do not treat
   that column as 82 bugs; refine the classifier before believing it.

   `refDepth()` is exported from `app/resolve/internal.js` rather than
   reimplemented in the report, for the reason `measure.mjs` exists: a metric that
   means something slightly different from the code it measures is worse than no
   metric.

45. **"Amended to read as follows" replaces a whole provision, and its
   cross-references now compose.** (2026-08-05, the job item 44's counter named.)
   447 of the 628 references that provably point out of the block they sit in
   were in one shape:

   ```
   Section 1(f)(2)(A) is amended to read as follows:
   ``(A) except as provided in paragraph (8), by increasing the minimum
   and maximum dollar amounts, and''.
   ```

   A whole-provision replacement emits **no operation**, so nothing carried the
   quoted text and `quotedRefs()` could not see it. "paragraph (8)" there is
   26 U.S.C. 1(f)(8), and the Code's own 1(f)(2)(A) reads that sentence back
   verbatim.

   The block is read for its cross-references only. TODO 12 still wants these
   captured as operations so the redline can draw the replacement; that is a
   bigger change and it moves what is on screen. This adds citations and cannot
   move a single mark — `tools/coverage.mjs` reports 3,495 of 15,237 before and
   after, unchanged.

   **The base is the provision the instruction WALKED to, not the head's own
   address**, and that distinction is the whole of it:

   ```
   Section 47(c) is amended--
       (1) in paragraph (1)--
           (A) in subparagraph (B), by amending clause (iii) to read as follows:
   ``(iii) as described in subparagraph (D) …''
   ```

   is a clause of (c)(1)(B), so "subparagraph (D)" is 47(c)(1)(D); reading the
   head would give 47(c)(D). Measured before building: **102 of 445** of these
   blocks open with a marker that does not match the head's last one, and every
   one sampled was a walk. The last step written before the phrase is the answer —
   the same test `scopeOps()` applies to an operation, and for the same reason.
   Nothing new guards this: the three tests item 41 already applies (marker not in
   the block, no gap in the composed levels, the phrase does not continue into an
   address of its own) do the work, which is the sign the rule was the right shape
   to begin with.

   Corpus: `refs +240` and `relative +240` on 15 bills, **nothing else** — and
   **0 removed**, the signature of pure addition. Composed inserted-law addresses
   1,830 -> 2,070, of which 1,968 reach a provision that exists in the Code, 0
   sharing a start and 0 failing the round-trip. The split counter accounts for it
   exactly: `composed +201`, `headAbove -84`, `declined -115`, `inBlock -2` —
   201 references moved from no answer to a real address, and the other 39 new
   citations displaced nothing because `RE_INTERNAL` never made a citation for
   them (plurals and list members).

   Audited by two independent adversarial lenses over 28 sampled cases: **28 right,
   0 wrong, 0 unsure**, verified against the shipped shards rather than from
   memory. In 14 of the 28 the Code text of the referring provision and of the
   referent cite each other verbatim (1(f)(2)(A)↔1(f)(8), 666(a)(1)↔(b),
   45R(d)(3)(B)↔(c)(2)), so the address is confirmed against the statute and not
   merely plausible. Three traps were passed rather than dodged: a block opening
   with a marker RUN ("(5)(A)") took its depth from the run's FIRST marker, giving
   (d)(3) and not (d)(5)(3); a genuine two-step walk composed from the walk where
   the head alone would have produced 24905(B); and every one of the 18 references
   at subsection depth reset to section depth per the unit-word rule, so a deep
   walk never leaked into the path.

   The five new addresses that reach no section at all are 20 U.S.C. 9007 and
   10 U.S.C. 2320 — both **repealed since those bills passed** (the Education
   Sciences Reform Act of 2002 and the title 10 reorganisation of 2021). The
   address is right and the law moved.

   **What the audit says to do next, in its own words:** "28 cases drawn from the
   population the guards ACCEPT tells you the accepts are good and nothing about
   whether the refusals are." That is this file's own withdrawal rule pointed back
   at the person applying it. The next sampler over this family must be stratified
   by the shapes the guards REFUSE — a reference running on into "of section N", a
   reference deeper than the block, a marker the block itself contains, a unit word
   disagreeing with its style — because none of those appeared in 28 cases drawn at
   random from the accepts.

46. **A range is not a list, and the pane now says which it has.** (2026-08-05,
   from the item 45 audit — both lenses raised it independently.) "Notwithstanding
   subsections (b) through (i)" names eight subsections. `MARKER_LIST` takes
   `through` and `to` as separators, so the two ends are already parsed and the
   reader already gets a chip for each — the audit's claim that only the first is
   chipped is **wrong**, measured: of 1,072 range phrases across the corpus, 433
   chip both ends, 10 the first alone and 2 the last.

   What was true is the claim each chip made. A reader clicking "subsections (b)"
   was shown 26 U.S.C. 1(b) under a heading naming (b) alone, with nothing saying
   the sentence reaches (c) through (h) as well — the `et seq.` fault of item 38,
   one level down, and this app's worst category: a confident answer to a question
   the citation did not ask.

   Unlike `et seq.`, **the end is written down**, so this says more rather than
   refusing. `unitPairs()` records a `range` where the separator was `through` or
   `to` and not `and`/`or`/a comma — a list names exactly what it writes and needs
   no caveat — and the card states both ends, which end the reader is looking at,
   and that the provisions between are named only by implication. 913 citations
   across 22 bills carry it, 35 of them inside inserted law.

   Corpus does not move: this is a field on a citation and a card in the pane.
   selftest 628 -> 633, rendertest 381 -> 387, and the render test asserts both
   ends and the negative — a plain composed address must not grow the caveat.

47. **A section that is no longer there says where it went.** (2026-08-05, from
   the item 45 audit.) 9,547 of the 60,436 shipped shards are empty — no tree, no
   lead, a heading reading "Transferred", "Omitted" or "Repealed. Pub. L. …" — and
   **910 citations across the corpus land on one**. The pane rendered those as a
   citation, a one-word heading and a blank body; where a subsection had been cited
   it added "the current text of this section has no such subsection, which usually
   means the bill is adding it", which is false twice over about a provision that
   has simply moved.

   For 170 of the 910 the Code states the successor outright, in its own notes:

   ```
   42 U.S.C. 10601   heading "Transferred"
     Codification: "Section 10601 was editorially reclassified as section 20101
     of Title 34, Crime Control and Law Enforcement."
   ```

   34 U.S.C. 20101 is "Crime Victims Fund" and its (d)(3) is on disk with its
   subparagraphs intact — the provision the USA PATRIOT Act cited in 2001. Reading
   that note is a lookup in what the Code says about itself, the same claim the Act
   index rests on, not a guess.

   The three forms were measured over the shards rather than guessed at: 833
   "editorially reclassified as", 268 "transferred to section", 84 "renumbered
   section". Of the 1,185 stubs that state one, **1,074 destinations have text**,
   63 are themselves a stub (a second hop, not chased), 48 are in a title we have
   not ingested, and **0 parse to a malformed address**.

   Two guards, both by analogy to the ones already here:

   - **Only an EMPTY section qualifies.** One with text has not moved, whatever its
     notes say about a renumbering long ago. This is the whole safety of the rule:
     a live section's notes are full of historical renumberings.
   - **The successor is NAMED, never silently substituted.** The bill cited the old
     number, and swapping the text under the reader would hide the one fact they
     most need. The card says "renumbered into 34 U.S.C. 20101" and offers the
     link; the heading above still reads what the bill wrote.

   And the ordinary "the bill is adding it" caveat is suppressed on a stub, because
   for a repealed or moved section it is not one of the two things it offers.

   Corpus does not move — this is resolution. selftest 633 -> 641, rendertest
   387 -> 395, and the render test asserts the negative too: a live section with a
   genuinely absent subsection must keep the ordinary caveat.

   Worth knowing before extending it: a chain (A moved to B, B moved to C) is
   followed one hop only. 63 of the 1,185 are that shape, and the reader can take
   the second hop themselves from the card.

48. **A new SECTION is never part of another section.** (2026-08-05, found while
   measuring whether the composition pass should extend to blocks with no leading
   marker — the answer was no, and the reason turned out to be a redline bug.)

   ```
   Paragraph (4) of section 145(d) is amended--
       (A) by striking ``of section 47(c)(1)(C)'' each place it appears …
   … [2,500 characters later, a DIFFERENT instruction] …
   ``SEC. 45S. EMPLOYER CREDIT FOR PAID FAMILY AND MEDICAL LEAVE.
   ```

   The body is capped at `MAX_AMEND_BODY` so one instruction cannot swallow the
   next — but `readAddedBlock()` reads FORWARD from a phrase inside that window,
   and the phrase it found belonged to the later instruction. So a whole new Code
   section, thousands of characters of it, was scoped to `(d)` and drawn inside
   26 U.S.C. 145(d) — a bond rule about residential rental projects — in the
   insertion colour, as though this bill put it there. **17 across the corpus**,
   every one a real provision in a place the bill never mentions.

   Marked rather than repaired, because the mis-attribution is not what can be
   checked here: **the block's own first line is.** "SEC. 45S." is a section head,
   and a section is not a child of a subsection whatever instruction the block
   came from. That is the same refusal `markRangeAdditions()` already makes for an
   `et seq.` target, reached from the other side — 125 of the corpus's 186
   section-headed blocks were already declining that way, which is what suggested
   the shape.

   Two things earned their place:

   - **`rangeSkip` is reused rather than a fourth flag added.** The tracked
     invariant says `placed()` must know every "dealt with but deliberately not
     drawn" marker, and each of the three was added separately and broke it the
     same way. The parse-side flag `newSection` carries the *reason* so the panel
     can say something different; the drawing side sees the same skip it already
     knew.
   - **The matcher is case-SENSITIVE, and that is load-bearing.** A bill amends a
     table of sections by adding an ITEM, written "Sec. 45S. Employer credit." —
     a line of text inside a table, not a new section. 223 of those across the
     corpus, and none is flagged. Asserted directly, because a blanket `/i` would
     silently stop drawing all 223.

   Redline: additions drawn 1,773 -> 1,749, the 24 moving to "the provision it
   follows is not shown". Corpus does not move — `opSpans` keys on
   `type:start-end` and no span changed. selftest 641 -> 644, rendertest 395 -> 402.

   Left open, and measured: the mis-attribution itself. `readAddedBlock()` will
   still read a block belonging to a later instruction whenever an "adding at the
   end" phrase falls inside this one's 2,500-character window. This guard catches
   the case where the block is a whole section, which is the one that was visibly
   wrong; a block that is merely a subsection of the wrong provision would still
   be drawn. Bounding the read at the next instruction head is the real fix.

49. **The refusals were audited, and that is where the errors were.** (2026-08-05.)
   Item 45's audit said it in its own words: "28 cases drawn from the population
   the guards ACCEPT tells you the accepts are good and nothing about whether the
   refusals are." Sampling the accepts had found 0 wrong in 73 cases across two
   rounds. A stratified sample of 46 REFUSALS, two lenses, found **21**. The split
   falls almost exactly along guard lines, which is the useful part:

   ```
     inBlock         22 right   2 wrong     reasons about MEANING
     continues       17 right   7 wrong     reasons about MEANING
     gap              4 right  20 wrong     reasons about SHAPE
     styleDisagrees   2 right  18 wrong     reasons about SHAPE
   ```

   **The two guards that reason about meaning are sound — do not weaken them.**
   Every one of those 22 is a case where composing on the walked path would have
   named a real but unrelated provision. The two that reason about shape are
   mostly refusing addresses that were **broken before they arrived**, so the bug
   is upstream and relaxing the guard would be exactly the wrong move.

   Fixed here, both measured first:

   - **An ambiguous marker in a PATH took its depth from its style.** `(i)`, `(v)`
     and `(x)` are a letter and a roman numeral at once, and `markerDepth()` reads
     them as roman — right for a bare cross-reference, wrong inside a path, which
     is contiguous from the top and so answers the question by position. "Subsection
     (i) of section 7448 is amended … by adding at the end ``(2) …''" filtered its
     own subsection away as a clause, `scope` became empty, and the new paragraph
     was drawn at the end of the whole section instead of inside (i). **20 additions
     had their scope emptied and 12 more truncated.** `pathLevels()` takes the
     depth from the position for those six markers only; everything else keeps its
     style, which is what still handles a path the Code has flattened a level out
     of. Redline: additions drawn 1,749 -> 1,759, already in the law 767 -> 782,
     "provision not on screen" 545 -> 520.
   - **A phrase that names its own ancestors is not relative to the block.**
     "subparagraph (B) or (C) of subsection (c)(3)" is a complete address, and the
     self-reference test compared its bare `(B)` against the block's markers — the
     block adding 26 U.S.C. 25C(h) has a (B) and a (C) of its own, so an address
     the phrase had spelled out was refused as new law talking about itself. The
     test is skipped where `unitPairs()` found more than one pair. `refs +172`.

   Corpus: `refs +172` and `relative +172` on 16 bills, nothing else. Composed
   inserted-law addresses 2,070 -> 2,242, of which 2,128 (95%) reach a provision
   that exists, 0 sharing a start and 0 failing the round-trip.

   **A claim in item 41 is wrong and is corrected here.** It says the
   styleDisagrees family is "9 of 2,041, every one of them reaching nothing". The
   audit checked, and 7 U.S.C. 2025(h)(5), 21 U.S.C. 352(f), 343(q)(1)(C),
   343(q)(1)(D), 10 U.S.C. 222a(b)(3) and 12 U.S.C. 5612(c)(2) all exist and are
   what the drafter meant. What reaches nothing is the address the composition
   builds by APPENDING a marker; the drafter wrote a path. And two of them are not
   drafting errors at all but Act nomenclature — FFDCA § 502 calls its lettered
   subdivisions "paragraphs", and § 403(q) calls its paragraphs "subparagraphs",
   the Code's own (q)(1) reading "Except as provided in subparagraphs (3), (4),
   and (5)". Measuring whether an address resolves is not the same as measuring
   whether it is right, and that is how the false claim got written down.

   **Left open, with the evidence.** Two upstream faults the audit named, both
   larger than what is fixed here:

   - **The base path drops a level the instruction head states.** "Paragraph (2)
     of section 72(p) is amended" gives base `(p)`, not `(p)(2)`, because the
     head is consulted only where the parenthetical carries no subsection at all.
     Measured: **222 heads state a path that EXTENDS the parenthetical's, against
     22 that genuinely diverge** — so preferring the longer path where one is a
     prefix of the other is right roughly ten times out of eleven, and item 35's
     divergence rule still protects the 22. This moves op scopes, so it moves the
     redline, and wants its own measured pass.
   - **The tail the `continues` guard detects is discarded.** In 9 of 12 sampled
     cases the tail IS the address — "of section 402(g)(3)", "of section 1111(d)
     of the ESEA (20 U.S.C. 6311(d))" — and refusing to compose is right while
     reaching nothing is not. Resolving against the section the tail names is the
     audit's highest-value suggestion.

50. **The deploy packages the tree, so the tree stopped being 77,744 files.**
   (2026-08-06, from Keller: the Pages deploy timed out.) His instinct was to move
   work off the deploy step and gate it with a checksum. Measured, the premise did
   not hold: `.nojekyll` is set and there are no workflows, so **there is no build
   step of ours at all** — the deploy's entire cost is packaging and uploading 410
   MB across 77,744 files, and a checksum cannot make a transfer smaller.

   What the numbers did say:

   ```
     data/ …………… 77,667 of 77,744 files, changed in  9 of 68 commits
     app/  …………………… 20 files,          changed in 58 of 68 commits
   ```

   So ~85% of pushes re-uploaded tens of thousands of unchanged 5 KB files, which
   is the pathological case for artifact packaging. The lever was file count.

   `tools/bundle.mjs` collapses each directory of shards into a few parts plus a
   byte-offset index; `app/resolve/bundle.js` reads one shard back with an HTTP
   Range request. **77,665 shards → 159 files. The deploy tree is 77,744 → 240.**

   The lookup contract is unchanged, which is the whole point: still one small GET
   per section, still no index of the Code loaded up front, still the same bytes on
   the wire. Verified on the live site BEFORE building any of it — GitHub Pages
   answers `206 Partial Content` and advertises `Accept-Ranges: bytes`. Also
   verified: jsDelivr serves the repo with CORS (the alternative, rejected for
   making a third party load-bearing), Cloudflare Pages caps a deployment at
   20,000 files (worse), and trimming `data/plaw` is only 19% of the count.

   Four things worth knowing before touching it:

   - **Parts split at 40 MB.** Not a performance guess: GitHub warns at 50 MB per
     file and refuses at 100, and title 42's sections come to 54 MB. It is the only
     title that needs two parts. Splitting is free because the index names the part.
   - **The client slices by byte offset even on a 206.** A server that ignores
     Range answers 200 with the whole part, and correctness must not depend on it.
     Bytes, not characters — a part is full of EN DASHes and section signs.
   - **`serve.py` had to learn Range.** `SimpleHTTPRequestHandler` does not
     implement it, so local development would have pulled a 40 MB part per lookup.
     The deployed site was never the slow one.
   - **Verification is part of building, not a later step.** `--prune` deletes
     77,665 files and only runs after every entry has been compared byte-for-byte
     with the shard it came from. Once pruned there is nothing left to compare to.

   **And the fault this nearly shipped with, which is the real lesson.** With the
   shards deleted, selftest went 644 → 452 checks and rendertest 404 → 373. Nothing
   failed. Eleven guards of the form `existsSync('data/usc/t42/s4332.json')` all
   went false at once, so 192 selftest checks and 31 render checks stopped running
   and the suite reported a pass. A suite that can skip a third of itself silently
   is worse than one that fails. The guards read the bundles now, and both tools
   assert the data was present, so the skip can never again be reported as a pass.

51. **A bare "of" is not an address, and testing for one refused 110 references
   that were relative to the block after all.** (2026-08-06, from the item 49
   audit: the `continues` guard was 17 right and 7 wrong out of 24 sampled.)
   `refContinues()` refused any reference followed by `of`, on the reasoning that
   the unit chain a phrase legitimately carries is consumed by `UNIT_PHRASE`
   itself, so anything still beginning with "of" must be somebody else's address.
   "of" is the commonest preposition in English and statutory prose is made of it:

   ```
   ``subparagraph (A) or (B) of the spun-off plan shall continue …''
   ``…the amount described in paragraph (3) of $500,000 …''
   ``…under subsection (b), of the funds of, or an equal value of commodities …''
   ``…the aggregate amount taken into account under paragraph (5) of this
      subsection shall not exceed $10,000 …''
   ```

   None of those continues into an address. The last is the interesting one and it
   is the commonest of the four: **"of this subsection" names the very provision
   the block is joining**, which is exactly what `blockRefs` composes against — so
   it should resolve rather than decline. 26 U.S.C. 164's new (b)(6), the SALT cap,
   refers to "paragraph (5) of this subsection", which is 164(b)(5).

   So the openers are listed rather than assumed, each one a place a reference can
   point that is NOT relative to the enclosing block: `thereof`, `of that|such
   <unit>`, `of section N`, `of title N`, `of the … Act|Code`, `of this
   Act|title|chapter`, and the broken chain `of <unit> (…)` that `MARKER_LIST`
   stops on. Deliberately absent: **`of this <unit>`**, and equally `of this
   section` — those name the reference's own ancestry.

   Of 559 refusals inside quoted blocks, 110 are released and **39 become
   addresses**; the other 71 are declined by the three tests item 41 already
   applies, which is the designed behaviour and a better outcome than the guard's
   (`locateInternal` finds them inside the block). **39 of 39 reach a provision
   that exists**, and the miss counts do not move at all — 12 no-section and 102
   no-path before and after. Read against the Code: 18 U.S.C. 922(d)/(g)/(n) (the
   purchase prohibitions, from the Bipartisan Safer Communities Act),
   42 U.S.C. 1396a(a)(10)(A)(i)(I)–(VII), 7 U.S.C. 2(c)(2)(C)(i),
   26 U.S.C. 402A(c)(4)(D).

   Corpus: `refs +40` and `relative +40` on 13 bills, the two deltas equal on
   every bill and **nothing else moved** — the signature of pure addition, each
   released reference becoming one new relative citation and displacing none.
   `tools/coverage.mjs` reports 3,495 of 15,237 before and after: this adds
   citations and cannot move a mark.

52. **The instruction head's path is used where it EXTENDS the parenthetical's.**
   (2026-08-06, the upstream fault the item 49 audit named — 20 of 24 `gap`
   refusals and 18 of 20 `styleDisagrees` refusals were refusing addresses that
   arrived already broken, and this is why.) Item 35 established that the
   codified subsection wins wherever the parenthetical states one, and that
   ordering is load-bearing: 12 U.S.C. 375 IS section 22(d) of the Federal
   Reserve Act, so the Act's own (d) names nothing in the codified section. But
   "wins outright" threw the head away even when the two agreed:

   ```
   Paragraph (3) of section 3111(f) is amended by striking ``the credit''
     head (f)(3) · parenthetical (f) · scoped to (f)
     -> struck ``the credit'' in the CHAPEAU of § 3111
   Subparagraph (B) of section 280F(d)(7) …    head (d)(7)(B) · paren (d)(7)
   Paragraph (37)(A)(i) of section 7(a) of the Small Business Act (15 U.S.C. 636(a))
     head (a)(37)(A)(i) · paren (a) · steps composed (a)(iv)(IV)(bb), a path with
     a HOLE in it — item 34's largest family, 413 of 675
   ```

   The extension is the inner unit the head names, over a prefix the two already
   agree on, so it is stated in the same numbering the parenthetical is. That is
   what makes preferring it safe where preferring the head outright is not.
   Measured before building: **222 heads extend the parenthetical's path against
   22 that genuinely diverge**, and a directional prefix test excludes all 22 —
   they are item 35's Act-relative shape plus the mirror case, where the
   PARENTHETICAL is the longer of the two and is already right (SSA § 472(c) is
   42 U.S.C. 672(c)(1)).

   **Coverage FELL, 3,495 → 3,463, and that is the fix working** — the second
   time this has happened here, so read the marks before believing the metric.
   The accounting closes exactly: drawn 1,979 → 1,946, of which **32 marks were
   withdrawn and 1 was reclassified from "pending" to "already in force"**; not
   found +28 and withheld +4 are the same 32. And **all 32 of the withdrawn marks
   had landed in the section's own chapeau**, outside the provision the
   instruction names — checked mechanically rather than sampled, by asking of each
   one where the old mark fell and whether that node is inside the new scope. Not
   one was inside.

   Against that, `addresses the provision does not have` fell 1,230 → 1,162 while
   `no such level at all` stayed at **263** — so 68 operations stopped needing to
   be widened at all and none became lost. 413 op scopes changed: 318 where both
   the old and new path exist (the new one deeper and real), 74 where only the new
   one exists, 6 where only the old did — and those 6 are not a regression,
   because `reScope()` shortens from the inside out first and lands them back on
   exactly their old scope, now carrying `scopeWidened` so the pane can say the
   level was not found.

   Corpus: `refs +48` and `relative +48` on 7 bills and nothing else — `opSpans`
   keys on `type:start-end`, so a scope change is invisible to it, which is
   precisely why this needed `coverage.mjs` and the withdrawal audit rather than
   a baseline diff.

53. **Two things measured and deliberately NOT built, with the numbers.** Both
   were on the item 49 audit's list and both fail on measurement rather than on
   taste. Recorded so nobody re-derives them — and so nobody trusts the audit
   over the corpus.

   - **"of section N" must not be composed against the target's title.** The
     audit called reading this tail "the single highest-value change across all
     four guards". Measured, it is the worst thing in this file's vocabulary: a
     confident answer about the wrong statute. 216 such tails; composing
     `<target title> U.S.C. <tail section>` gives **98 hits, 94 sections that do
     not exist, and 24 that exist without the path** — because 83 of the 216 sit
     in title 42, where the numbering in the quoted law is the Social Security
     Act's, not the Code's:

     ```
     ``…the requirements of section 1859 of the Social Security Act …''
        in a block joining 42 U.S.C. 1395w-28   ->  42 U.S.C. 1859, which is
        nothing; the Act's § 1859 IS 1395w-28, and the bill says so
     ``…described in section 1861(iii)(2)) furnished during …''
        ->  42 U.S.C. 1861 EXISTS and is about something else entirely
     ```

     That last shape is the whole objection: not a blank but a real provision,
     wrongly named. `sectionsMatchCode` belongs to the IRC and nothing else, and
     this is that invariant arriving from a new direction. The title-26 subset
     alone is clean — **56 of 60**, and 3 of the 4 misses are tails that name
     their own Act ("of section 437 of the Higher Education Act of 1965") while
     the fourth is 26 U.S.C. 179A, repealed since. So a title-26-only pass is
     available and honest; it is 58 citations, and it wants the `enactedAs` route
     through the Act index rather than a title assumption, because that is the
     mechanism that would also serve the other 158.
   - **The Oxford comma breaks `MARKER_LIST`, and fixing it steals a real outline
     marker.** `MARKER_LIST`'s separator is a comma OR the word, never both, so
     ", and (3)" stops a list dead — which item 41 already documents for ", or
     (o)" without noticing it is general. Admitting `,\s*(?:and|or)` is worth
     **+464 refs**, and it correctly reads "paragraphs (1), (2), and (3) of
     subsection (a)" and "subsections (a), (b), and (c) as subsections (b), (c),
     and (d)". But roughly one in eight of the new matches is a theft:

     ```
         (i) by striking ``(as defined in section 71(b)(2))'' in
     subparagraph (B), and
         (ii) by adding at the end the following new subparagraph:
     ```

     `(ii)` there is the next SUB-INSTRUCTION, and the list absorbs it. Confining
     the separator to one physical line does not help and the reason is worth
     knowing: `extractSteps` matches against the **two-line overlay probe**
     (item 24), which replaces the newline with a single space — so the marker at
     the head of the next line really is adjacent by the time any pattern sees it.
     This is item 24's own warning ("the join must not steal a real outline
     marker") failing in the one direction it was checked and found safe in. The
     guard is `isWrappedMarkerLine` in `app/parse/outline.js`, which already
     answers exactly this question and says `(ii)` is a REAL marker because the
     line above it ends in "and". Wiring that into the list separator is the work;
     it is not a character-class change.

54. **I audited what item 49 fixed and not what it MOVED, and the movement held a
   regression.** (2026-08-06.) Item 49 changed the redline — additions drawn
   1,749 → 1,759, already in the law 767 → 782, provision not on screen 545 → 520
   — and shipped with the improvement counted and the 25 moved additions unread.
   That is this file's own withdrawal rule broken by the entry that restates it,
   and the lesson is narrower than "audit more": **a rule that reads a DEPTH off a
   marker has to be audited against paths that do not start at subsection level.**

   Every addition whose scope item 49 changed, checked against the shipped shards:
   70 where only the NEW scope exists in the provision, 60 where both do (the new
   one deeper and more specific), 5 unresolvable, and **1 that was a real bug**:

   ```
   (1) in paragraph (6)-- (A) in subparagraph (B)-- (i) in clause (i), by
       inserting after clause (i) the following: ``(ii) planning for …''
     -> 16 U.S.C. 3839aa-1(6)(B)(i)(i)
   ```

   Two faults, both of them a depth read off an ambiguous marker:

   - **`pathLevels()` gave the marker its INDEX.** A path is contiguous, so
     position answers where style cannot — but it need not start at subsection
     level. `(6)(B)(i)` states a paragraph, a subparagraph and a clause, at depths
     1, 2 and 3, against indexes 0, 1 and 2. The depth is one deeper than the
     level BEFORE it, which is the same thing said correctly.
   - **`scopeUnitInserts()` truncates by the anchor's STYLE depth**, which then
     disagrees with the depth the path put that very marker at. The walk had
     already stopped AT the anchor, so asking whether the path already ends there
     settles it without reasoning about depth at all — and that is the fix, because
     it cannot be wrong about a case the depth model cannot read.

   Corpus does not move at all: a scope is invisible to `opSpans`, which keys on
   `type:start-end`. Redline: additions drawn 1,759 → 1,760, not on screen 520 →
   519, and `no such level at all` 263 → 262.

   One flagged case is NOT a regression and is worth recording because it looks
   exactly like one. `42 U.S.C. 1395u` scopes an addition to `(h)(V)` — a path
   with a hole where the paragraph should be, because a navigation step composes a
   subparagraph onto a subsection when the bill skips a level. That is item 34's
   413-strong family and it predates all of this; `reScope()` shortens it to
   `(h)`, which is where the addition drew before. The reader sees the same thing.
   **Check reScope before calling a deeper scope a loss** — it shortens from the
   inside out first, which is why the 6 op scopes that "only existed at the old
   level" under item 52 were not lost either.

55. **The Oxford comma, and the two guards that make extending a list safe.**
   (2026-08-06, the second half of item 53, built after the first half's warning
   turned out to name the guard exactly.) `MARKER_LIST`'s separator was a comma OR
   the word, never both, so ", and (3)" stopped a list dead — and took the rest of
   the address with it:

   ```
   ``…the aggregate amount of taxes taken into account under paragraphs (1),
      (2), and (3) of subsection (a) …''
     read as a bare "paragraphs (1), (2)" — the third member AND the
     "of subsection (a)" that says whose paragraphs these are, both lost
   ```

   Item 41 documents this for ", or (o)" and treats it as one shape; it is
   general. **465 references gained, 71 withdrawn, +398 net.**

   The accounting for the 71 is the interesting half, because none of it is a
   loss: **30 are stolen sub-instruction markers** (below) and **41 are references
   that now carry their true parent** — `paragraphs (1), (2), and (3) of
   subsection (d)` used to yield a bare `(1)`, `(2)`, or worse a `(i)(1)` composed
   against whatever the running path happened to be, and now yields `(d)(1)`,
   `(d)(2)`, `(d)(3)`. The old chip is gone because a better one replaced it.

   **Extending a list is not free, and the cost is that the thing after ", and"
   may be the next SUB-INSTRUCTION.** Two guards, and neither alone is enough:

   - **`sameStyle()` — siblings share a numbering style**, because they sit at the
     same level of the same parent. `subparagraph (B), and (2) in the flush
     sentence at the end` mixes an uppercase letter with a digit and cannot be a
     list. The classes INTERSECT rather than being compared against the first, so
     the ambiguous markers do not over-constrain: "clauses (i) and (ii)" keeps
     both, (i) contributing {letter, roman} and (ii) narrowing to {roman}.
     **A doubled letter is the SAME style as a single one** — an alphabet that runs
     past (z) continues (aa), (bb) — so 42 U.S.C. 1396d really does say
     "subsection (y), (z), (aa), or (ii) of section 1905", four subsections, and
     separating them truncated that list at (z). Found in the withdrawal audit,
     not in the addition audit.
   - **`stealsMarker()` — a list member is followed by more list.** The style
     guard cannot see a theft where both markers are uppercase letters:

     ```
         (A) by striking subparagraph (B), and
         (B) by redesignating subparagraph (C) as subparagraph (B); and
     ```

     and no character class can either, because `extractSteps` matches against the
     **two-line overlay probe** (item 24), which replaces the newline with a
     single space — so the next line's marker is genuinely adjacent by the time
     any pattern sees it. This is item 24's own warning ("the join must not steal
     a real outline marker") failing in the one direction it was checked and found
     safe in.
     `isWrappedMarkerLine` is the wrong test here and it is worth knowing why: it
     asks whether the line above ends a thought, and a line ending in "and" ends a
     thought AND continues a list, so it calls both shapes real markers. The
     question that separates them is what FOLLOWS. A member is followed by more
     list or by the phrase's own tail — `(iv) as clauses (i), (ii), and (iii)`,
     `(19), and exempt from tax`, `(13); and`, `(p).` — and a sub-instruction by
     what it instructs: `(B) by inserting`, `(C) in paragraph (3)`, `(3) in the
     case of a partnership`. 16 of 495 new members across the corpus, every one a
     theft, with every genuine wrapped member kept.

   **Only a list MEMBER is eligible.** Applying the guard to the phrase's own
   subject withdrew 181 perfectly good references in one go — the subject is
   regularly a wrapped single reference ("the credit determined under
   subsection\n(a) (after the application of…)"), which sits at a line head and is
   followed by no list at all, and is exactly what the overlay probe exists to
   read. Caught by diffing before believing the total.

   Corpus: `refs +398`, `relative +336`, `steps +11` across 21 bills, and nothing
   else — no citations, amendments, targeted, opSpans, diffSpans, overlaps or
   badOffsets. `refs` and `relative` move by different amounts on purpose: 83 of
   the new references sit on an amendment with no resolved target, so they never
   become relative citations. Redline barely moves and moves the right way: drawn
   1,946 → 1,947, additions drawn 1,760 → 1,761, provision not on screen 519 →
   518, `no such level at all` unchanged at 262.

56. **The four unlooked-at things were looked at, and two of them were broken.**
   (2026-08-06. TODO 11 listed four pieces of layout nobody had ever seen. Keller
   confirmed dark mode; the agent looked at the other three. Both bugs found are
   invisible to every test in this repo, because linkedom has no layout and a
   height is layout.)

   Confirmed sound, and no longer open:

   - **Dark mode.** Keller's own report.
   - **`.sec-head.run-in`.** H.J. Res. 31 renders 649 of its 660 section heads as
     run-in, and the override wins on every one: `text-transform: none`, body ink
     rather than the accent, 16px serif at weight 400. The named risk — 649
     paragraphs rendering as uppercase accent-coloured headings if the override
     lost — is closed, checked by computed style rather than by eye.
   - **`<optgroup>` in the jump menu.** 26 groups over 661 options on the same
     bill, labelled `DIVISION A — … › TITLE I — …`. Native select popups are drawn
     by the OS and cannot be screenshotted, so this is verified as structure; how
     a given platform paints the group labels is still unseen and probably
     unknowable from here.

   **The panes overflowed each other at every narrow viewport.** `.pane-body`
   carries `padding-bottom: 60vh` so the last paragraph can scroll up to the top
   of the reading area — right while a pane IS the viewport. Stacked (≤860px
   wide), each pane is about `(100vh - topbar) / 2`, so a 60vh padding is taller
   than the box holding it, and **padding is the one thing flexbox will not
   shrink**: `min-height: 0` cannot help and neither can `flex-basis`, because a
   border box is never smaller than its own padding. Measured at 536×419: the
   bill's `.pane-body` was 269px inside a 123px `.pane`, `.pane` is
   `overflow: visible`, so the bill's text painted straight over the context pane
   below it — and the whole document grew a 57px scroll, which was that same
   overflow (166 topbar + 41 head + 269 body = 476 against a 419 viewport).

   Container query units are the fix rather than a smaller `vh`, and the reason is
   worth keeping: **the topbar's height changes as its buttons wrap**, so any
   fraction of the viewport is a guess about how much is left — 166px at 536 wide
   against ~51px at 1280. `45cqh` of the pane always fits beside a ~41px pane
   head. Verified at 536×419, 820×760 stacked and 1000×700 side-by-side: page
   overflow 0, neither pane overflowing, and the scroll-past affordance still
   there. Desktop is deliberately untouched — there a pane is full height and 60vh
   has always fitted, which is why nobody saw this.

   **The Public Law contents was 200 inert chips and 5,660 pixels.** A reader
   clicking a bare "Public Law 115-141" got the 1,254-section Consolidated
   Appropriations Act, 2018's table of contents as a wrapping row of `.crumb`
   spans — forty-six screens of them at that pane height, sitting between them and
   the "Read elsewhere" links that would actually take them somewhere. The old
   note ("…and 1054 more") was honest about the truncation and silent about the
   length, which is the same shape as the CFR cap before TODO 8 gave it a way out.
   Capped at `LIST_CAP` (40) with the same "Show all N" control, now shared by
   both lists rather than written twice.

   Two details. The truncation card is a **sibling** of the contents card, not a
   child — a card inside a card reads as a nested panel. And the chips are still
   inert: they name 1,254 sections and none of them is clickable, so this is a
   list and not yet navigation. Making them navigable needs a handler that
   resolves one section of one Public Law, which is a feature rather than a layout
   fix; recorded here rather than done.

   The render test asserts the cap, the message, the sibling relationship and the
   whole round trip — control offered, host asked, every entry listed, control
   gone — because asserting only that the control exists would pass against one
   that did nothing. That is TODO 13's rule, and it is the only part of any of this
   a test can reach. rendertest 405 -> 412; selftest and the corpus do not move.

57. **A whole-provision replacement is an operation now, and the pane says so.**
   (2026-08-08, TODO 12's open item and the job item 44's counter named.) A bill
   rewriting a provision from end to end emitted **no operation at all**:

   ```
   Section 1(f)(2)(A) is amended to read as follows:
   ``(A) except as provided in paragraph (8), by increasing the minimum
   and maximum dollar amounts, and''.

   Paragraph (4) of section 3111(f) is amended by striking paragraph (4)
   and inserting the following: ``(4) …''
   ```

   So the redline drew nothing, and `attachEffect()` returns early on an
   amendment with no ops, so the panel said nothing either — the reader was told
   this bill does nothing here, about one of the largest things a bill can do to
   the statute book. **1,067 across the corpus.**

   Two shapes, one act. Of the 1,067, **896 carried no op and get a new one**;
   the other **171 are CONVERTED** — the second shape's block had been claimed by
   the generic insert scan, which then drew nothing with it, because an insert
   with neither a paired strike nor a quoted anchor falls through both branches
   of `apply()`. Converting rather than adding is what keeps `overlaps` at zero:
   one shape, one op, one span.

   **"the following" is required, and it is the whole distinction.** Without it
   the quoted text is a phrase being substituted rather than a provision being
   rewritten — "by striking paragraph (3) and inserting ``replacement''" replaces
   the paragraph with eleven characters, and the insert machinery has always
   handled it. Making the phrase optional swept those up too, and selftest caught
   it on the first run.

   The scope is the walk plus the block's own leading marker, unless the walk
   already stopped there — the identical rule `scopeUnitInserts()` arrived at for
   an anchor, and it is here for the same reason: it cannot be wrong about a case
   the depth model cannot read. `Section 1(f)(2)(A) … ``(A) …''` stays (f)(2)(A);
   `in subparagraph (B), by amending clause (iii) … ``(iii) …''` becomes
   (c)(1)(B)(iii).

   **What is deliberately NOT built is a diff.** Striking the whole provision and
   drawing the block after it is the literal truth of a *pending* bill and exactly
   wrong for an *enacted* one, where the Code already reads the new text — that is
   the duplication every guard in this file exists to prevent, at the scale of a
   whole provision. Measured before deciding: of 535 replacements whose provision
   resolves, the current text already matches the new block in at least 121, and
   the comparison is unreliable in both directions because the Code stores a
   node's heading apart from its body while the bill's block carries it inline. So
   the node is MARKED and the panel prints the new language; the reader compares
   it against the text in front of them. That is a weaker claim than a diff and
   one that cannot be wrong. `.node.replaced` is a dashed rule in the CAUTION
   colour, not the insertion colour, because which text is on screen depends on
   whether the bill passed and nothing here knows.

   Redline: **735 of 923 replacements mark their provision on screen**, 188 not —
   those name a level the provision does not have, which `reScope()` reports.
   Inline operations 15,237 -> 15,084 and `shown to the reader` **3,464 before and
   after**: not one inline mark was lost, 153 ops merely moved to a bucket of
   their own. `addresses the provision does not have` 1,156 -> 1,356 and `no such
   level at all` 262 -> 279, which is the replacement scopes arriving and being
   reconciled like any other.

   **`tools/coverage.mjs` needed the bucket, and needed it in the walk.** Without
   the bucket the 171 converted inserts fell out of the inline denominator and
   read as an improvement — item 50's silent-skip trap exactly. And with the
   bucket but without `replacedAt()` in coverage's own walk, all 923 reported
   "not on screen" while the pane was marking them: a report that does not make
   the same calls the renderer does measures a rendering nobody sees.

   Corpus, accounted to the unit: `ops.replace +1067`, `ops.insert -169`,
   `opSpans +898`, and **nothing else** — no citations, amendments, targeted,
   diffSpans, refs, steps, relative, overlaps or badOffsets. 1067 = 898 new + 169
   converted, and `opSpans` moves by the new ones alone because a conversion keeps
   its span and only changes the key's type. selftest 659 (the CLARITY PDF gains
   2, both real, both round-tripping, which is also the check that this shape is
   read through the doubled-single quote convention), rendertest 412 -> 420.

   Left open, and it is the interesting half: **the enacted/pending distinction.**
   Telling them apart would let the pane say "rewritten by this bill — already in
   force" against "this bill would rewrite this" and, for a pending bill, draw the
   real diff. What blocks it is the heading, measured above. A comparison that
   folded the Code's heading back into its body before matching is the next step,
   and it wants its own measured pass because it decides what colour a whole
   provision is drawn in.

58. **A rewrite that has already happened says so — and the heading was never
   the obstacle.** (2026-08-08, the half item 57 left open.) Item 57 marked every
   whole-provision replacement with one neutral sentence because it could not
   tell an enacted rewrite from a pending one, and blamed the Code storing a
   node's heading apart from its body while the bill's block carries it inline.

   **That was wrong, and measuring it is what showed it.** Folding the heading
   back in is worth **1.4 percentage points**. What was actually wrong was the
   comparison: item 57 reached for a prefix test, and a rewrite is usually a
   near-copy of the old provision with one clause changed, so its opening 80
   characters match whether or not the change has happened. `alreadyIn()`'s
   80-character prefix — right for a short added block, which it identifies — is
   exactly the wrong instrument here. What separates the two populations is the
   whole of it.

   `rewriteInForce()` asks what share of the new text's words the provision
   already contains. Over the corpus the populations separate sharply and there
   is almost no middle:

   ```
     >= 0.95   411     the samples at this level are exact matches
     0.85-0.95  50
     0.70-0.85  22
     0.50-0.70  22
     <  0.50    36     genuinely different text
   ```

   Words of three letters or more, so statutory scaffolding cannot carry a match
   on its own, and at least eight of them, because below that a short provision
   matches anything of its kind.

   **The haystack is the node, not the provision, and that distinction is the
   whole safety of it.** An addition's `inLaw` is decided once at construction
   against the whole provision, because "does the law contain this language
   anywhere here?" is the right question for an addition. A replacement's is
   decided in `replacedAt()` against the node the caller passes, because the
   question is whether THIS passage reads the new way. Measured against the whole
   provision instead, 42 U.S.C. 254b-2(b)(1)(F) reports in force for a rewrite
   that genuinely differs — "$3,800,000,000 for fiscal year 2018 and
   $4,000,000,000 for fiscal year 2019" against a provision that still reads
   "$3,800,000,000 for fiscal year 2018;" — because the words turn up elsewhere
   in the section. `createRedline` has no access to a single node; the renderer
   does, so the renderer passes it.

   **No "pending" wording was added, deliberately.** Every one of the 541
   replacements whose provision resolves comes from an *enacted* bill — the
   corpus's pending bills amend Acts that reach no Code section — so there is no
   validated example of the negative to hold a claim to. Where the match fails,
   the neutral sentence item 57 wrote is kept, which is exactly today's
   behaviour. Claiming "this bill would rewrite this" would have been wrong on
   all 58 low-overlap cases in the corpus, every one of them from a law that
   passed.

   Redline: **355 of 923 replacements are marked already in force**, ruled in the
   insertion colour and titled so; 380 keep the caution-coloured neutral mark and
   188 name a provision not on screen. Nothing else moves — inline operations,
   `shown to the reader` at 3,464, and the corpus are all unchanged.

   Found on the way, and it is item 48's rule arriving in the new family: **a
   whole CHAPTER, PART or TITLE is never the text of a subsection.** 37 U.S.C.
   908(d)(1) was being told it now reads "SEC. 908. Reserves and retired
   members…", and 42 U.S.C. 622(b)(19) that it reads "PART E—FEDERAL PAYMENTS FOR
   FOSTER CARE…". `RE_PART_BLOCK` refuses those the same way `RE_SECTION_BLOCK`
   refuses a section, and `markSectionAdditions` now runs over replacements too.
   57 blocks across the corpus, every one checked and every one a genuine
   subdivision heading — a whole new chapter of the IRC among them. 5 of them
   were additions rather than replacements, which is why additions drawn moves
   1,761 -> 1,756 with "not on screen" 518 -> 523.

59. **A section-headed block means the OPPOSITE thing for a replacement, and I
   had just declined 134 of them.** (2026-08-08, from classifying the 188
   replacements item 58 left stranded.) Item 58 extended item 48's refusal — a
   whole SECTION is never part of another section — to the new `replace` family.
   That is right where the instruction walked INTO the provision and wrong where
   it stayed at section level, which is most of them:

   ```
   Section 45Q is amended to read as follows:
   ``SEC. 45Q. CREDIT FOR CARBON OXIDE SEQUESTRATION. ``(a) General Rule.--…

   Section 510 of the Social Security Act (42 U.S.C. 710) is amended to read
   as follows: ``SEC. 510. SEXUAL RISK AVOIDANCE EDUCATION. …
   ```

   The block IS the target, rewritten end to end. For an ADDITION a section-headed
   block cannot belong inside the provision; for a REPLACEMENT it is the provision.
   Same characters, opposite meaning, and the scope is what tells them apart:

   - scope empty (the walk stayed at the section) -> `wholeSection`
   - scope names a subsection -> `newSection`, refused as before, because
     37 U.S.C. 908(d)(1) cannot read "Sec. 908. Reserves and retired members…"
     whatever block followed the phrase

   **The case-sensitivity relaxes here, and only here.** `RE_SECTION_BLOCK` is
   case-sensitive because a bill amends a table of sections by adding lowercase
   "Sec. 45S. Employer credit." items and 223 of those must not be read as new
   sections. A scope-less replacement has no table to be confused with, and the
   Code's own style is exactly the lowercase form — "Section 218 of title 23 is
   amended to read as follows: ``Sec. 218. Alaska Highway''". 51 of the 134 are
   written that way and were matching nothing at all.

   A whole-section rewrite has **no node to mark**, because the section is not
   one, so it is stated at the top of the provision instead. Marking one
   subsection would say something narrower than the bill does. Here the whole
   provision IS the right haystack for `rewriteInForce` — for once the claim is
   about all of it — which is the mirror of item 58's rule and worth noting as
   the exception that proves it.

   Redline: replacements not on screen **188 -> 71**, with 117 stated as
   whole-section rewrites and the classification of what is left now honest:

   ```
     already in force            355
     whole section, stated       117
     marked, rewrite not matched 380
     provision not on screen      71
   ```

   Corpus does not move — these are flags on ops that already existed.
   rendertest 424 -> 428.

   **The lesson is item 54's, arriving one commit later.** Item 58 added a
   refusal and counted the additions it moved (5, all checked); it did not ask
   what the refusal did to the family it was being added FOR. The classification
   that found this took ten minutes and I ran it only because the stranded count
   looked high. Classify what a guard refuses in the population it was written
   for, not only in the one it came from.

   Left, and measured: 26 replacements whose scope names a level nowhere in the
   provision, and 8 where a shorter prefix of the scope exists — the same
   families item 34 classifies for operations generally, at a much smaller scale.

60. **A heading rewrite is not a provision rewrite — and item 58's headline fix
   never fired.** (2026-08-09, from a multi-agent adversarial audit of the
   `replace` family shipped the day before. Five investigations, each checked by
   two independent lenses.) The audit found ten defects in one day's code, seven
   of them confidently-wrong output. This entry fixes the family that four of
   them belong to; the rest are recorded in the TODO below.

   **Item 58's own named example still rendered wrong.** That entry says it
   stopped 37 U.S.C. 908(d)(1) being told it reads "Sec. 908. Reserves and
   retired members…". It did not. Two reasons, and both are this file's own
   tracked traps:

   - `markSectionAdditions()` sets `newSection` on a `replace` op and **nothing
     reads it**. `redline.js`'s `replacements` filter does not test it, and
     `render-context.js`'s `newSection` message sits inside the
     `add-at-end || after-unit` arm a replacement can never enter. That is item
     33's rule — a field the parser sets and no consumer reads is a feature that
     does not exist — broken two commits after item 59 restated it.
   - `RE_SECTION_BLOCK` stays case-SENSITIVE for a scoped replacement, because
     item 59 relaxed only the scope-less branch. The Code's own style is the
     lowercase "Sec. 908.", so the block was never even flagged.

   **The fix is not either of those.** Both are narrow tests of the BLOCK, and
   11 of the 46 blocks are a bare caption — "Grant Program", "Materiel readiness
   metrics and objectives for major weapon systems" — carrying no "SEC. N." and
   no "PART X--" at all. No test of the block's shape can ever see them. The
   instruction says it outright, in two shapes and 34 occurrences:

   ```
   (1) Section heading.--The heading of such section is amended to read as
   follows: ``Sec. 908. Reserves and retired members: acceptance of employment''
   (1) by amending the section heading to read as follows: ``Materiel readiness…''
   ```

   `RE_HEADING_REWRITE` is anchored with `$` against the text ENDING at the
   phrase, so it names the instruction introducing THIS block and not a heading
   amended earlier, and `[^.;]` forbids crossing a sentence boundary — without
   it "…amend the heading. Subsection (a) is amended to read as follows" matches.
   Asserted both ways.

   **Refused by being kept OUT of the `replacements` list, not by a flag inside
   it, and that is the load-bearing detail.** `placed()` is
   `[...work, ...additions.filter(…), ...replacements].filter(o => o.done)` — the
   replacements list is **unfiltered** — so a refusal spelled "do not mark, but
   mark done" leaves `placed()` true and the panel prints "the provision is
   marked above" about a node carrying no mark. A verifying agent patched
   `replacedAt()` the obvious way and reproduced exactly that on 2 U.S.C. 1382.
   This is the tracked invariant that has now been broken four times ("`placed()`
   must know all of them… each of the three was added separately and each broke
   this the same way"), and `coverage.mjs` tests `here(placed, o)`, so **the
   report could not have detected its own bug.** Absent from the list, every
   consumer is right for free.

   **The message has to be true.** Routing these through `newSection` would print
   "⚠ adds a whole new section, not part of this one". Not one of the 46 adds a
   section; every one renames one.

   And a replacement matched NO arm of the panel's not-placed chain — `strike`,
   `insert`, `add-at-end || after-unit` — so it printed its language and then
   said nothing at all about whether the reader would find it. It has an arm now.

   Redline, all of it withdrawal: whole-section cards 117 -> 107, node marks
   380 -> 363, so **27 false claims withdrawn**, plus 11 previously counted as
   "provision not on screen" reclassified as the refusals they are. The total
   stays 923. `coverage.mjs` gained the bucket, because lumping a deliberate
   refusal in with "not on screen" turns a wrong label into no label, which is
   not an improvement. Corpus unchanged — these are flags on ops that already
   existed. selftest 659 -> 663, rendertest 428 -> 434.

   **Two lessons from the audit, and the second is the useful one.** The first is
   item 54's again: item 58 counted the additions its new refusal moved and never
   asked what the refusal did to the family it was added for. The second is
   sharper — *I wrote a commit message naming a provision as fixed and never
   rendered it.* The audit did, in a DOM, and it was still wrong. A named example
   in a commit message is a claim; render it.

61. **What the audit found and this entry does NOT fix.** Six defects remain,
   measured and ranked, so the next pass starts from evidence rather than
   re-deriving it. In order of value against risk:

   - **`scopeReplacements()` APPENDS the block's marker where `scopeAdditions()`
     truncates.** `(b)(3)` + a block opening `(4)` becomes `(b)(3)(4)`, `reScope()`
     shortens it back to `(b)(3)`, and the pane marks the walk's provision as
     rewritten. 169 of the marked carry `scopeWidened` and 153 had exactly the
     block's own marker thrown away; 18% of replace scopes fail to deepen against
     0.2-0.6% for every other op type. The fix is two halves that must ship
     together — read the address the instruction states ("by amending subsection
     (d)(2) to read as follows"), and a replacement-only membership test in
     `reScope()`. Measured full-proposal diff: 156 marks moved, 4 gained, **0
     withdrawn**, 0 correct marks destroyed, 84 existing mis-marks repaired,
     evidenced marks 358 -> 448. Do NOT implement the phrase as a navigation step
     — that moves `steps`/`refs`, which the baseline sees.
   - **A widened replacement scope breaks the identity claim `replacedAt()` rests
     on.** State it as an identity test: the marked node's own marker must equal
     the block's leading marker. Provably exact — `reScope()`'s shorten branch
     drops from the end and `scopeReplacements()` appends at the end, so
     shortening always removes the naming marker. 170 wrong marks withdrawn, 2
     right ones kept, including 42 U.S.C. 1396a(a) (107 KB) claimed "already in
     force" for a 1,786-character block.
   - **`markRangeAdditions()` flags only `add-at-end`**, so `rangeEnd` is set on
     none of the 26 resolved et seq. replacements; 12 make a claim. Shape the
     guard by reading, not by score: 2 U.S.C. 135a and 15 U.S.C. 1701(1) are
     **correct** and a blanket refusal deletes both.
   - **`coverage.mjs` passes `flattenText(n)` where `render-context.js` passes
     `subtreeText(n)`** — so the report measures a rendering nobody sees, by
     exactly 58 ops each way. The pane's real split is 413 in force / 322 marked
     against the report's 355 / 380.
   - **`rewriteInForce()` false positive, demonstrated against shipped data.**
     26 U.S.C. 25C(d) scores 0.9624 against a provision that does not contain the
     bill's two-tier version at all. 6 of 484 in-force claims have a money or
     percentage figure absent from the provision — unigram containment cannot see
     a changed number, which is the one thing these rewrites usually change.
   - **Item 48's open hazard is live here**: 43 replacement blocks belong to a
     later instruction and 36 reach the reader. All 8 non-heading cases are
     closed by the identity test above, so the symptom goes before the cause.

   Also settled by measurement, so nobody re-derives them: **sibling quoted blocks
   are not worth building** (64 of 279 provably incoherent; the target key does
   not separate branches of the same section, and the composition path already
   covers the safe subset) — and the "better lever" that investigation proposed,
   widening `quotedRefs()` to plain inserts and strikes, **was already tried and
   reverted**, with the reason written inside the function being measured. 263 of
   its 578 addresses are exact-span duplicates of what the read-as-follows loop
   already emits. **`styleDisagrees()` is not wrong today**: it fires 12 times in
   2,630 and all 12 composed addresses reach nothing. And **`ladder` and
   `bill.sections[].division` really are dead** — a runtime tripwire recorded 0
   reads across 4,741 citations and 39.6 MB of export HTML, and `ladder` is
   additionally *stale*, disagreeing with what the pane draws in 38 of 5,773
   cases because resolution rewrites the path afterwards.

   One live bug found in passing, outside the replace family: **the anaphoric
   PREFIX**. `refContinues()` catches "of such paragraph" as a tail and nothing
   catches "such paragraph (16)" as a prefix, so a reference in new SSA 2107
   composes 42 U.S.C. 1397gg(e)(16) where 1396a(e)(16) is meant. 4 of the 2,396
   shipped inserted-law addresses.

62. **The replacement scope is the block’s own marker, and the bill often states
   it outright.** (2026-08-09, item 61’s first two entries, shipped together.)
   Three changes, and the third is the instrument.

   - ** appended where it should compose.** The walk stops
     at (b)(3), the block opens (4), and the scope became (b)(3)(4) — a paragraph
     inside a paragraph.  then shortened it back to (b)(3) and the
     pane marked the wrong sibling “rewritten in full”. 18% of replace scopes
     failed to deepen, against 0.2–0.6% for every other op type.
   - **The instruction states the address three words before the block.** “by
     amending subsection (d)(2) to read as follows:” — nothing read it, so
     7 U.S.C. 2016’s (h)(13) arrived as a bare (13) that exists nowhere. Composed
     the way a navigation step is, and it is a CLAIM:  carries
     , so a composed path naming nothing falls back to where the
     op applied before rather than being reported lost. Anchored with  at the
     phrase — 34 of 164 occurrences have no block within 20 characters, and a
     forward scan attaches those to a distant one.
   - ** keeps a replacement’s LAST marker.** Every other branch
     shortens from the end, which throws away the very marker naming the
     provision. A replacement drops INTERIOR levels instead, by exact membership
     rather than the prefix test, because  matches with .

   **And the identity guard, which is what makes any of it safe.** The marked
   node’s own marker must BE the block’s leading marker. Provable rather than
   observed:  appends at the end and ’s shorten
   branch drops from the end, so a shortened scope has always lost the naming
   marker — of 171 such claims, zero had them equal. That is how
   42 U.S.C. 1396a(a), 107,063 characters of it, came to be titled “already in
   force” for a 1,786-character block. A block with no leading marker cannot be
   tested and is left alone.

   ** was measuring a rendering nobody sees.** It passed
    where  passes  — they differ by the
   node’s heading, and the difference was 58 ops each way.  is
   exported and imported now rather than re-spelled, for the reason 
   exists.

   Redline, and this is the accounting: already in force **355 → 519**, marked
   380 → 186, not on screen 71 → 73, heading refused 38, whole section 107 —
   total unchanged at 923. **Provable mis-marks 96 → 3**, where a mis-mark is a
   marked node scoring under .95 while a DISJOINT node holds ≥ .95 of the
   block’s words. All three residuals are known and not fixable from the bill:
   10 U.S.C. 2684a and 16 U.S.C. 410aaa-75 were renumbered by the Code after
   enactment, and 12 U.S.C. 24a is an upstream navigation gap — the bill writes
   “(3) subsection (a)(3), by amending subparagraph (A)” without the “in” that
    needs.

   Corpus unchanged.  keys  on  and the
   word  does not appear in it, which is exactly why this needed
    and a mis-mark audit rather than a baseline diff.
   selftest 663, rendertest 434 → 437.

63. **Two more from item 61, and the fifth time `placed()` needed a new
   exclusion.** (2026-08-09.)

   **A rewrite that changes a figure is not in force, and unigram containment
   cannot see it.** `rewriteInForce()` matched 96% of the block's words and said
   yes — but a rewrite is a near-copy of the old provision with one clause
   altered, and the clause altered is very often a dollar amount, a percentage or
   a year. 26 U.S.C. 25C(d) scored 0.9624 against a provision that does not
   contain the bill's two-tier version at all; 26 U.S.C. 461(l)(1) matched at
   0.964 while missing "2026", the one year the Inflation Reduction Act changed.
   Every figure in the block must now be in the provision, as a whole token so
   "1,000" cannot satisfy "10,000", and asked of the block's figures only — the
   provision may carry figures the rewrite drops, which is the rewrite working.
   **97 claims move from "already in force" to the neutral mark**, which is the
   safe direction: some of the 97 may be genuine matches whose figure is
   formatted differently, and the cost of that is a weaker sentence rather than a
   false one.

   **An et seq. target answers with the section the range BEGINS at.**
   `markRangeAdditions()` flagged only `add-at-end`, so `rangeEnd` was set on none
   of the 26 resolved replacements against a range and 12 made a claim —
   15 U.S.C. 1692(a), the FDCPA's findings, marked with the text of § 814. But
   **not an outright refusal, and this is where a score would have misled**: two
   of the twelve are right. 2 U.S.C. 135a really is "National library service for
   the blind and print disabled" and the bill's new SEC. 1. is that section;
   15 U.S.C. 1701(1) reads its block verbatim. So the flag is set at parse and the
   pane declines only where the law does not already read the block. 7 refused, the
   correct ones kept.

   **`placed()` needed `replacements` filtered, for the fifth time this list has
   needed a new exclusion.** `rangeSkip` is spelled "mark done and draw nothing",
   and `placed()` filtered `additions` by it while leaving `replacements`
   unfiltered — so the panel would have said "the provision is marked above"
   about a node carrying no mark. The pattern is now explicit and worth stating
   once: **every "dealt with but deliberately not drawn" flag has to be named in
   both the decliner and `placed()`**, and `coverage.mjs` tests `here(placed, o)`,
   so the report can never catch this class of bug on its own.

   Redline after items 62 and 63 together: already in force 355 -> 422, whole
   section 117 -> 105, heading refused 38, et seq. refused 7, marked 380 -> 278,
   not on screen 71 -> 73 — 923 throughout. **Provable mis-marks 96 -> 3**, the
   three being the residuals item 61 already named as not fixable from the bill.
   Corpus unchanged. selftest 663, rendertest 437.

64. **A step must not become its own child, and a property test found it.**
   (2026-08-09.) With the known bugs cleared, `tools/proptest.mjs` went in: ten
   invariants checked over every op, citation and section the corpus produces —
   74,839 citations, 22,874 ops, 16,712 composed addresses, 9,045 sections — plus
   220 deterministic fuzz cases feeding damaged text through the whole pipeline.

   It failed on four, at two sites, and both were the same shape:

   ```
   Section 1461 of the Safe Drinking Water Act (42 U.S.C. 300j-21(3)) is
   amended-- (1) in paragraph (3), by striking …   ->  300j-21(3)(3)
   ```

   300j-21 numbers its TOP level with digits, so the parenthetical's (3) sits at
   position 0 while the unit word "paragraph" claims depth 1 — the base survives
   `place()`'s filter and the step lands underneath it. Item 34's flattening
   family, arriving through the step composer, and the composed address reaches
   nothing.

   `place()` drops the kept level where the step names the marker it already
   holds. Safe because a real path essentially never repeats a marker adjacently:
   **1 of 230,633 node paths** across fourteen shipped titles, and a composed one
   that does reaches nothing by construction. Corpus unchanged — the address is
   corrected, not added or removed.

   **What the properties are, and why they are properties rather than fixtures.**
   Each needs the whole population to be worth anything: every span round-trips;
   no two citations and no two ops of one amendment share a start; a scope is a
   marker path and nothing else; no scope or composed address repeats a marker
   adjacently; quoted blocks never overlap or invert; sections are ordered and
   inside the text; **a refused op is never reported placed** — the invariant that
   has broken five times — and a marked replacement's node marker IS the block's
   leading marker. The fuzz half mutates a real bill (truncation, stripped quote
   openers, unbalanced parens, a paren bomb, reversal) and asserts only that
   nothing throws and that offsets still round-trip, because a span that does not
   is what mis-renders the bill pane.

   Run it after any parser change. It is a test, not a report: it exits non-zero.

65. **"Re-ran clean" is not a result. A DIFFERENT sample found 27 defects.**
   (2026-08-09, from Keller: *"'re-ran clean' is not the point: the point is to
   do a different random sample and see if it works."*) He is right, and the
   correction is worth more than the entry it corrects.

   `tools/proptest.mjs` found one bug, that bug was fixed, and it then passed. I
   reported that as assurance. It is not: the test is a FIXED sample — one base
   bill (hr1719, the smallest in the corpus), one hard-coded seed, 220 cases, ten
   mutation operators. Re-running it proves the one bug is fixed and nothing else.
   **A deterministic test that has been made to pass carries no information about
   the space it does not cover.**

   Five campaigns, each deliberately a different sample: multi-seed fuzz over
   every bill including the PDFs; synthetic bills generated with the correct
   answer recorded alongside; metamorphic transformations that must not change
   the answer; hand-authored adversarial text aimed at named guards; and a
   seeded random audit of real output read against the shipped shards. 30 findings
   reported, each verified independently, 2 rejected as the test being wrong —
   **27 distinct defects**. The full report with reproductions is in
   `docs/random-testing-2026-08-09.md`; the five that put a real but wrong
   provision in front of a reader are:

   - **W1. `at the end of paragraph (N)` is parsed and thrown away.**
     `PUNCT_UNIT_TAIL` consumes the unit in a non-capturing group, so the strike
     keeps the instruction head's scope and `atEnd` takes the last position in
     whatever node it is handed. **201 ops name a unit this way, 170 draw a mark,
     163 land somewhere else — and none of the 163 is even a DESCENDANT of the
     unit named.** In 26 U.S.C. 25C(a) one card both labels (a)(3) "added by this
     bill" and strikes its terminal punctuation.
   - **W2. An amendment body is not bounded by its own bill SECTION.**
     `bodyEnd` is `min(nextHead, headEnd + MAX_AMEND_BODY, text.length)` and
     `extractAmendments` is never passed the section list. **550 relative
     citations are composed across a real section boundary on 22 of 26 bills; 296
     answer with a real provision.** The Inflation Reduction Act's SEC. 13101 runs
     543 characters into SEC. 13102 and composes seven chips about *section 48*
     onto section 45.
   - **W3. `in section 207 (12 U.S.C. 3206)` is not navigation.** `UNIT_WORDS`
     has no "section", so `RE_NAV` cannot fire and every later step keeps the
     Act-level anchor. **250 composed addresses on 10 bills; 196 would have found
     a real node at the section the instruction named** — which is already parsed
     as its own chip one position away.
   - **W4. A bill's own effective-date clause is composed into a Code address.**
     "The amendment made by subsection (a) shall apply to taxable years…" is
     definitionally about the bill. **204 addresses on 21 bills, 156 landing on a
     subsection that exists, and `internalKept = 0`** — every one displaced the
     correct internal answer. One fixed token in front of the reference is the
     tell.
   - **W5. `alreadyIn()` runs against a heading-stripped haystack.**
     `render-context.js` builds it with `flattenText`, which drops `node.heading`,
     while the bill's added block carries the heading inline — and `alreadyIn`
     matches an 80-character prefix, so it can never match. The sample bill
     renders 2 U.S.C. 901(d) **twice on one screen**, once as law and once as a
     pending addition. `subtreeText()` is the haystack it should use, and
     render-context already passes that to `replacedAt()`.

   The other 22, by title: W6 a paired insert drawn with no already-reads test ·
   W7 three popular-name entries with no `enactedAs` answering under a false
   short title · W8 a quoted block opening mid-line invisible to `quotedBlocks()`
   · W9 a wrapped reference breaking after "and"/"or" admitted as a real marker ·
   W10 `RE_INSERT`'s 400-character cap re-matching from a later opener · W11
   `markerDepth()` reading `(cc)`, `(ll)`, `(vv)` as roman · W12 `newSection`
   still unread for a replace op · W13 a malformed harvested entry making one chip
   of two Acts · W14 an unbalanced source quote swallowing the next
   sub-instruction · W15 `rewriteInForce()` one-directional, so a deletion-only
   rewrite always scores 1.0 · W16 `RE_QUOTE_CLOSE` knowing three conventions of
   four · L1 one mid-body "table of contents" mention suppressing 338 of
   hr1865's 897 sections · L2 a navigation LIST scoping to its last member only ·
   L3 "each place it appears" never crossing a node · L4 `REDESIG_LIST` omitting
   subclause and subitem · L5 only the first amendment in a rendered paragraph
   getting a block · L6 a whole-section rewrite essentially never reportable as
   in force · L7 `RE_USC_LONG` with no hyphen in its section pattern · L8 "each
   place it appears" read in a fixed 60-character window · L9 a second navigation
   step after a comma read as a bare reference · C1 a citation overrunning a
   rendered paragraph spilling body text.

   **What this says about the testing discipline here, and it is the useful
   part.** Every suite was green. The corpus baseline was clean. `coverage.mjs`
   and `impact.mjs` both looked healthy. 27 defects were live anyway, five of them
   at a scale of hundreds of wrong provisions, because **every instrument in this
   repo measures the shapes it was written for.** What found these was varying the
   input: different seeds, different bases, generated bills with known answers,
   and a random sample of real output read by hand against the Code. Vary the
   sample, not the number of runs.

66. **A bill’s own effective-date clause is not a Code address.** (2026-08-09,
   W4 of item 65.) “The amendment made by subsection (a) shall apply to taxable
   years beginning after…” is definitionally about the BILL — subsection (a) of
   this section of this Act, not of the statute being amended. Composed onto the
   target it gave 26 U.S.C. 5000A(a), 45(h), 172(a), 49 U.S.C. 22907(a): **204
   addresses across 21 bills, 156 landing on a subsection that really exists**,
   and `internalKept = 0` — every one displaced the answer `locateInternal`
   already had right.

   The tell is one fixed token in front of the reference, so the guard is a
   lookbehind and nothing else. Note that the amendment body ALSO over-reaches
   its bill section (W2, `MAX_AMEND_BODY`), and fixing that would not fix this:
   the effective-date clause usually sits inside the same section as the
   instruction it follows.

   Corpus `refs -259` and `relative -203` across the bills, the two differing
   because 56 of the withdrawn references sit on an amendment with no resolved
   target and so never became relative citations. selftest 664, rendertest 437,
   proptest clean.
67. **A heading is inside the 80-character window, and it is on one side or the
   other.** (2026-08-10, W5 of item 65, and a second defect found by looking at
   the screen after fixing it.) The Code stores a node's heading apart from its
   body; a bill writes the two together. So the same provision reads

   ```
   flattened       (d) It shall not be in order in the Senate to consider …
   heading inline  (d) Enforcement of Discretionary Spending Limits.--It shall …
   ```

   and `alreadyIn()` matches the first 80 folded characters, so the heading is
   inside the window. `render-context.js` built the haystack with `flattenText`,
   which drops it — and the sample bill drew **2 U.S.C. 901(d) twice on one
   screen**, once as law and once as a pending green insertion of the same words,
   which is the duplication every guard in this file exists to prevent.

   **Switching to `subtreeText` trades one blind spot for the other, and
   measuring is what showed it.** Some headings are enacted and some are the
   OLRC's editorial catchlines, which the bill never wrote: 15 U.S.C. 78i(a)
   "Transactions relating to purchase or sale of security", 42 U.S.C. 210-1(b)
   "Limitation", 7 U.S.C. 2009aa(4) "Alabama as participating State". Flattening
   alone missed 877 additions the law demonstrably contains; heading-inline alone
   missed 14 the other way. So `createRedline` takes the provision as an ARRAY of
   renderings and every already-happened test asks all of them. Both strings are
   true renderings of the same provision, so a match in either is evidence and
   neither is authority.

   **The FIRST entry is the provision's own text, and `stale` asks only that
   one.** The asymmetry is the point rather than a convenience: "the law contains
   this language" is POSITIVE evidence, safe to accept from any true rendering,
   while staleness is NEGATIVE — "not one thing this amendment strikes is still
   here" — and a single coincidental hit anywhere destroys it. Asking every
   rendering rescued 22 amendments from staleness and **15 were caption hits**:
   hr2-115 strikes "2018" from 7 U.S.C. 1932(b)(2) and the heading of an
   unrelated subsection (f) holds the year. The 7 genuine ones strike across the
   heading/body juncture ("Retroactive Changes in Plan.--A stock bonus") and stay
   withheld, which is the conservative direction — withholding shows nothing, and
   drawing an insertion the law already carries shows it twice.

   An **empty string is kept** in that array, and the reason is worth stating
   because tidying it away broke something silently. 9,547 shards are stubs with
   no text at all (item 47), and `stale` is `hays.length > 0 && …`, standing in
   for the old `typeof fullText === 'string'`. Filtering empties made
   `hays.length` 0 on every stub, which flipped **246 operations** out of "the
   amendment has already happened" and into "not found in the provision" on no
   evidence whatever. Caught because inline operations were supposed to move by
   zero and moved by 246.

   Audited the way this file requires — by what the change WITHDRAWS. All 877
   additions that gained "already in the law" were graded by an independent test
   (word containment, not the prefix being changed): **838 at ≥0.95, 35 at
   0.85-0.95, 3 below**, and the 3 were read against the shipped shards and are
   right — 33 U.S.C. 2310(b), 15 U.S.C. 7219(d)(3) and 16 U.S.C. 3839bb-6(2), all
   of them present, their scores depressed by later amendments rather than by a
   wrong match. Nothing moved the other way, which is the whole point of asking
   both renderings. Inline operations and whole-provision replacements are
   **byte-identical** to before: 1947 drawn / 1517 in force / 6731 withheld /
   4889 not found, and 422/105/38/7/278/73.

   **And the second defect, which only the screen could show.** With the panel
   correctly reading "✓ already in the law as it stands" for the new
   2 U.S.C. 901(d), the subsection itself sat **unmarked** a few lines below.
   `appliedNodePaths()` skipped any op whose `scope` was not a string, and an
   instruction that never navigates — "Section 251 … is amended by adding at the
   end the following" — leaves it undefined. 256 enacted additions could never
   mark the provision they created.

   Lifting that guard alone would have been much worse than the bug. The function
   read EVERY line-head marker in the block and hung each one off the base, so a
   block adding (h) also claimed the (1)s, (A)s and (i)s inside it. Off a base of
   `(c)` that is harmless — `(c)(A)` names nothing — but off an EMPTY base `(i)`
   names subsection (i), and the corpus said the trade was **451 correct marks
   against 2,334 wrong ones**: "added by this bill" written across 26 U.S.C.
   45Q(a), 25C(a), 59(i) and 91 others the bill never touched. So only the
   block's TOP level is claimed, and `parseProvision()` answers what that is
   rather than a local scan — it owns marker depth and it already steps over a
   marker that is at a line head only because the line wrapped, which is where
   most of the false ones came from ("Subject to subparagraphs\n(G) through (I)").
   Children need no mark: they are drawn inside the parent, which carries the
   rule.

   Visible node marks **1,689 → 1,865, +281 / -105**, and all 105 withdrawn were
   classified mechanically rather than sampled: **0** are descendants of a mark
   that survives, 11 are the op's own anchor, and every one of the other 94 is an
   interior cross-reference at a line head. Verified on screen: 2 U.S.C. 901(d)
   and (e) each render once, ruled in the insertion colour and titled "Added by
   this bill — already in force".

   Corpus unchanged; this is resolution and rendering. selftest 664, rendertest
   437 -> 443, proptest clean.
68. **"at the end of paragraph (2)" says which paragraph, and the phrase was
   parsed and thrown away.** (2026-08-10, W1 of item 65, plus the sibling it
   turned out to have and a message that only became visible once both were
   fixed.) The note that sat on `PUNCT_UNIT_TAIL` said the quiet part outright:

   > The unit is consumed rather than captured. The step machinery has already
   > scoped the op to the provision the instruction walked to, so a second
   > opinion here could only disagree with it.

   It does disagree, and the bill is the one that is right. An instruction of
   this shape normally never navigates — the position is written into the strike
   phrase itself — so `scopeOps()` leaves the op on the head's own address and
   `atEnd` takes the last occurrence anywhere under it. Measured: **81 of 82
   punctuation strikes disagree with the walk, and in 73 the walked scope is a
   real provision — an ANCESTOR of the one named** — so the mark lands somewhere
   real and wrong rather than nowhere.

   **The quoted form has the identical defect, and rendering the fix's own named
   example is what found it.** 26 U.S.C. 25C(f) writes the two side by side:

   ```
   by striking ``and'' at the end of paragraph (1), by
   striking the period at the end of paragraph (2) and inserting ``, and'',
   and by adding at the end the following new paragraph: ``(3) …''
   ```

   `RE_AT_THE_END` set `atEnd` and read no further, so the "and" struck from
   paragraph (1) was drawn through the "and" that closes paragraph (2). The Code
   now reads (1) …, (2) …, and (3) … — this bill removed (1)'s "and", so the
   last one under the walk is (2)'s. One card, three wrong claims, and the
   corpus could not see any of it: `opSpans` keys on `type:start-end` and a
   scope has no span.

   `scopeStatedUnits()` composes the stated address the way `scopeReplacements()`
   already does — the markers replace the walked path from the unit word's own
   depth down, so "in subsection (c) … at the end of paragraph (2)" gives (c)(2)
   — and it is a CLAIM, carrying `scopeFallback` so a level the Code does not
   have puts the op back where it applied before the phrase was read. The tail
   is read in `placeOps()` for the quoted form because the strike scan stops at
   the closing quote and the unit is written after it.

   Audited by where the marks LAND, walking the provision as render-context
   does, keyed by bill *and target* because a distributed amendment gives one op
   offset several provisions:

   ```
     withdrawn   161  every one of them outside the provision the bill named
     moved         8  every one of them INTO the provision the bill named
     gained        0
     elsewhere     0
   ```

   plus 62 inserts that replace one of those strikes and cannot be drawn without
   it. Coverage 3,464 -> 3,241 (23% -> 21%), the third time in this file a fix
   has shown up as a fall — read the marks before believing the metric.

   **And the message underneath, which the fix made common.** `op.found` in
   `main.js` is printed as "✓ found in current text" on a strike the redline did
   NOT draw, and it was a substring test against the whole provision: of course
   the word "and" is somewhere in the section. 1,267 undrawn strikes carried
   that tick. It asks the op's own scope now, and the population falls to 390,
   every one of which genuinely has its operand inside the provision it names
   (the redline declined for the `atEnd` test, not for absence). Of the 877 that
   stop claiming it, 376 move to "✓ already struck from the law" — the
   amendment having worked — and 501 to "⚠ not found verbatim", which is what
   they are.

   Verified on screen, per the rule item 60 wrote after making exactly this
   mistake: 26 U.S.C. 25C(a) now renders with **zero** marks, (3) ruled in the
   insertion colour as "Added by this bill — already in force", and both strikes
   reported "✓ already struck from the law". Before: a strikethrough through
   paragraph (2)'s "and", for an instruction naming paragraph (1).

   Corpus unchanged. selftest 664 -> 670, rendertest 443, proptest clean.

69. **"in section 293 (42 U.S.C. 293)--" is navigation, and a section is not a
   unit.** (2026-08-10, W3 of item 65, both halves shipped together as item 65's
   own note said they had to be.) `UNIT_WORDS` lists the levels *within* a
   provision — subsection, paragraph, subparagraph … — and a section is not one
   of them, so `RE_NAV` could not fire on the commonest way a bill walks from one
   section of an Act to another:

   ```
   Title VII of the Public Health Service Act (42 U.S.C. 292 et seq.) is amended--
       (1) in section 736 (42 U.S.C. 293), by striking subsection (i) …
       (2) in section 740 (42 U.S.C. 293d)--
           (A) in subsection (a), by striking ``$51,000,000 for fiscal year 2010'' …
   ```

   Everything after the phrase composed against the amendment's own target, which
   for an `et seq.` citation is the section the range BEGINS at. So the CARES
   Act's § 3401 answered "subsection (a)" with 42 U.S.C. 292(a) — the Public
   Health Service Act's statement of purpose — and struck the appropriation
   figures there. **276 composed addresses named the wrong section and 447
   operations were scoped to a path in a provision the pane never shows.**

   Nothing is inferred: the bill writes the Code address in the parenthetical,
   which is why this is narrowed to the form that carries one. Three guards, each
   measured:

   - **It must open a sub-instruction** — a dash, or a comma before the
     amendatory verb — with `isInstructionPosition()` in front of it. A bare "in
     section N" is 293 further sites and most are not navigation at all ("as
     defined in section 1245(a)(3)", "described in section 163(j)(2)"), sitting
     inside quoted operands and definitions.
   - **A note is not the section it is printed under.** 22 of the 215 sites write
     "(8 U.S.C. 1157 note)". Item 14's rule, arriving in a new place; pointing a
     walk at § 1157 because a note about it is printed there is exactly the
     confident wrong answer that rule exists to prevent.
   - **Only where the section named differs from the target.** 10 of the 215
     spell out an address the head had already given, and flagging those would
     refuse a change that really is to the provision on screen.

   The cursor is reset to the **codified** path and to nothing where the
   parenthetical states no subsection — the Act-relative "(a)" in "section
   2118(a)" is that Act's own numbering, which the codifier may already have
   folded into the section number (item 35's divergence rule), so carrying it over
   would be a guess about a provision whose real address is right there.

   **The operation half is what made this bigger than W1 or W5, and it is a
   refusal.** An op is drawn on the provision the pane RESOLVED, which is the
   target; an op scoped to a path in another section cannot be drawn there at
   all. Spelled by keeping it out of `redline.js`'s three lists rather than by a
   flag inside them, so `placed()` is right without being told — the same shape
   item 60 arrived at for a heading rewrite, and the invariant this file has
   watched break five times. The panel names the section, and the citation chip
   beside it now resolves there, so the refusal has a way out instead of being a
   dead end.

   **The step must be EMITTED, not merely recorded, and rendering is what showed
   it.** The first cut kept the move in a local variable and tagged the steps and
   refs that followed. `scopeOps()` consults *steps*, so an instruction that
   walked into another section and then changed something without navigating
   again — "in section 736 (42 U.S.C. 293), by striking subsection (i) and
   inserting the following:" — kept the head's own base and was drawn on the
   target anyway. 174 of the 447 operations, and the panel said "⚠ rewrites (i),
   which is not shown here" when (i) is in another section entirely. Every count
   was green; twelve of the thirteen rows on screen were right and the thirteenth
   was not. Emitted as an ordinary step, every consumer is right for free.

   It carries `noCite`, and that is the one thing the step must not do: the bill
   has WRITTEN the address out — the whole reason this phrase is safe to read —
   so composing a chip would duplicate the U.S. Code citation inside it, and
   `expandRelativeRefs()` drops any citation a composed one overlaps, so the real
   chip would be replaced by a derived copy of itself.

   Audited by where the marks LAND, which is the only audit that can see any of
   this:

   ```
     withdrawn   16  every one outside the provision the bill named
     moved        2  both INTO the provision the bill named
     gained       0
   ```

   plus one op reclassified from "pending change" to "already in force" by a
   corrected scope. All 16 were read against the bill: five RESPA
   "Secretary"→"Bureau" strikes belonging to §§ 2603 and 2604 were being struck
   in 12 U.S.C. 2601, the Act's congressional-findings section; four Interlocks
   Act strikes belonging to § 3206 landed in 12 U.S.C. 3201, *Definitions*; and
   the USA PATRIOT Act's new subparagraph (C) of 12 U.S.C. 3414(a)(1) was being
   added to the head of the Right to Financial Privacy Act.

   Address quality, graded against the shipped shards: of the 276 retargeted,
   **227 reach a real node against 55 before**, and "no such section" falls 105 →
   18. Four grade lower and all four are the fix working — 12 U.S.C. 3206(6) and
   3207(5) are absent because *this bill* renumbered them, 7 U.S.C. 27f(c)
   because Dodd-Frank restructured it, and each replaced a confident answer about
   a Definitions section the bill never mentions.

   `lostScope()` excludes a refused op and the panel asks the section question
   BEFORE the level question, or the reader is told "the bill addresses (c)(1),
   which is not in this provision" about a provision the bill was never
   addressing. `no such level at all` 275 → 193.

   Corpus: `steps +196` on 12 bills and **nothing else** — not citations, refs,
   relative, amendments, targeted, opSpans, diffSpans, overlaps or badOffsets.
   Accounted exactly: 196 accepted phrases, one step each, 186 naming another
   section and 10 the target itself. Coverage: inline operations 15,084 → 14,682
   and shown 3,241 → 3,226, the difference being the 447 refusals moving to a
   bucket of their own. selftest 670 → 679, rendertest 443 → 448, proptest clean.

   `extractSteps` now sorts before returning. Every pass pushes in line order and,
   within a line, in column order — but that is an accident of which pattern runs
   first, and `scopeOps()` breaks at the first step past the operation, so one
   step out of order would silently drop every scope after it. Measured at 0
   out-of-order steps across the corpus, so it is a guard rather than a change.

   Left open, and it is the natural next step rather than a defect: the pane
   shows one provision, so a reader following an instruction that walks through
   six sections of an Act sees six refusals and has to click each chip. Showing
   the named section beside the target is a feature, not a placement fix.

70. **An instruction cannot reach past the end of its own bill section.**
   (2026-08-10, W2 of item 65 and the largest of the 27 by count.) The body was
   bounded at the next amendment head or `MAX_AMEND_BODY`, whichever came first,
   and never at the bill's own section heading — `extractAmendments()` was never
   passed the sections. A section whose first amendment sits a paragraph below
   its heading therefore leaves the previous body running straight through into
   it:

   ```
   SEC. 13101 …          (the last instruction's body runs 543 characters on)
   SEC. 13102. EXTENSION AND MODIFICATION OF ENERGY CREDIT.
       (a) Extension of Credit.--The following provisions of section 48
   are each amended by striking ``January 1, 2024'' …
           (1) Subsection (a)(2)(A)(i)(II).
   ```

   Seven chips about 26 U.S.C. 48 were composed onto 26 U.S.C. 45, and
   45(c)(1)(D) renders "geothermal energy," where 48(c)(1)(D) is the linear
   generator definition the bill is talking about. **Both sections existing is
   what makes this the worst category rather than a blank.** 2,853 amendment
   bodies ended past their section.

   A bill's own section heading is an absolute boundary — no instruction spans
   one — so this is a structural fact rather than a heuristic, and the audit is
   correspondingly strong: of everything the bound removes, **975 of 975
   references, 72 of 72 steps and 282 of 282 spanned operations lie past the
   edge**, and **0 kept operations changed scope**. The other 6 removed ops are
   item 39's spanless redesignations, each produced by a "redesignat…" phrase
   that exists only in the removed tail.

   **Attributed by containment, never by proximity**, and that is the trap the
   measurement had to work around first: `parseBill` misses a run-in
   appropriations head written as a bare `Sec. 401.` line, parking later text in
   the previous section, so a head that sits in no parsed section keeps the old,
   looser bound. A missed heading costs the old behaviour rather than a wrong
   boundary.

   Of the 644 addresses withdrawn, **358 resolved to a real node** — 358
   confident wrong answers. 32 moved and 0 were added:

   - 3 to **38 U.S.C. 902**, "Enforcement and arrest authority of Department
     police officers", which is what "Section 902 of title 38, United States
     Code" means. The target had been taken from a citation past the edge and
     was 26 U.S.C. 902, which does not exist.
   - 29 off **26 U.S.C. 119**, "Meals or lodging furnished for the convenience
     of the employer", for instructions reading "Additional funding for area
     agencies on aging". "Such section 119" is MIPPA's, uncodified, printed as a
     note under 42 U.S.C. 1395b-3 — so the new address resolves to nothing, on
     purpose, and a real-but-wrong provision is replaced by an honest blank.

   Marks: **56 withdrawn, 4 gained, 0 moved.** 36 of the withdrawals are
   operations no longer parsed, 19 are the 26 U.S.C. 119 target moving, and 1 is
   the 38 U.S.C. 902 target moving (it reappears among the gains).

   **The gains are the interesting half, and they name a second-order fault this
   fixes.** An over-reaching body poisoned the STALENESS verdict: `stale` asks
   whether every strike the amendment makes is already gone, and a strike
   belonging to a *different* instruction against a *different* provision can
   never be found, so the amendment was declared live and its own insertions
   withheld. Withheld operations fall 6,457 → 6,364 and three of the four gained
   marks are that — 42 U.S.C. 1397gg(e)(1)(J), 7 U.S.C. 2023(a) and an insert in
   10 U.S.C. 2688(d)(2), each on an instruction whose head names that provision
   outright.

   Corpus, accounted to the unit: `refs -975`, `relative -642` (the 1,047 refs
   and steps removed, less the 405 sitting on an amendment with no resolved
   usc/cfr target), `steps -72`, `opSpans -282`, `ops.strike -100`,
   `ops.insert -115`, `ops.add-at-end -54`, `ops.replace -13`,
   `ops.redesignate -6`, and **`uncoveredVerbs +84`**. That last one is the cost
   and it is the honest one: 84 amendatory verbs were inside an over-reaching
   body and are now outside any parsed instruction. They were never covered —
   they were attributed to the wrong section's target — and `uncoveredVerbs`
   exists precisely so a gap is visible instead of hiding as a wrong answer.

   **The parameter is optional, so it can be forgotten, so it has a property.**
   `extractAmendments(text, citations, divisions, sections)` — every real
   consumer passes it (`main.js`, `measure.mjs`, `impact.mjs`, `coverage.mjs`,
   `proptest.mjs`), and `proptest.mjs` asserts P11: no operation, step or
   reference of an instruction lies past the end of the bill section the
   instruction is written in. **1,325 violations under the old two-argument
   call**, so a call site that omits the sections fails loudly rather than
   quietly reverting. Two of my own measurement scripts had exactly that hole
   and reported "0 changed" until they were fixed — which is the same
   measuring-a-parse-nobody-sees mistake `coverage.mjs` has now made twice.

   Coverage: inline operations 14,819 → 14,514, shown 3,226 → 3,196, additions
   3,034 → 2,983. selftest 679 → 684, rendertest 448, corpus updated.

   Rendered, per item 60's rule, on both examples the report names: the IRA's
   SEC. 13102 chips now decline with "no (c)(1)(D) appears at the head of a line
   anywhere in this section of the bill … that usually means the provision it
   refers to lives in the U.S. Code", and the TCJA's SEC. 13102 composes onto
   26 U.S.C. 448 and 447 with no trace of the 179 the previous section leaked.

   **Left open, and it is what the IRA example now asks for.** "The following
   provisions of section 48 are each amended by striking …:" is a distributed
   head — `RE_AMEND_HEAD` wants "Section N … is amended" — so those seven
   subsections reach nothing at all where the bill has plainly named 26 U.S.C.
   48. Blank beats wrong and this is the right trade today, but the address is
   written down and item 33's `distributed` flag is the half of the machinery
   that already exists.

71. **A bill that MENTIONS a table of contents is not opening one.** (2026-08-10,
   L1 of item 65 and the largest single loss in it.) `RE_TOC_ANNOUNCE` is the
   phrase "table of contents", tested against every line, and bills write it for
   two completely different reasons:

   ```
   The table of contents for this Act is as follows:      <- opens a table
   …and (2) in the table of contents of that Act, by      <- amends someone else's
   striking the part heading for part B of title IV …
   ```

   One of the second kind in the middle of the Consolidated Appropriations Act,
   2020 set `inToc`, and **nothing ever cleared it**: the loop closes the table
   only when a real body follows, and in an appropriations division the next
   non-caps line is a lowercase account heading, so `realBodyFollows` says no.
   From there to the end of the bill — 684 KB — `RE_SECTION_LOOSE` was gated off.
   **338 of hr1865's 897 sections vanished**, with no section head, no `#sec-N`
   anchor and no jump entry, and 30 divisions with them.

   Worse than missing, and this is the part no count could show: `sectionAt()`
   answered for a paragraph at offset 403,626 with "Sec. 310 @198,195" —
   **205 KB earlier** — so every "section N of this Act" in that stretch resolved
   against the wrong section, and item 21's own rule (prefer a same-number
   section sharing the citing section's outermost ancestor) was reading the wrong
   ancestor to begin with.

   **No phrasing test separates the two.** The announce wraps the 72-column
   measure ("The table of contents for\nthis Act is as follows:"), so its head is
   all a single line carries — which is exactly why the pattern is loose — and
   the clerical amendment wraps onto a line beginning with the identical words.
   Anchoring to a line head still admits 6 of the 173 mentions across the corpus,
   including this one.

   What separates them is what comes NEXT: a table is a listing, so entries
   follow it. `tocFollows()` is the same shape as `realBodyFollows()` pointed the
   other way — ambiguity now keeps us OUT of the table, which is the cheaper
   error, because a flush-left entry is not matched by `RE_SECTION_LOOSE` anyway.
   Only the free-text line is gated; a section whose own HEADING is "TABLE OF
   CONTENTS" is unambiguous and still opens the table by itself.

   Corpus: one bill moved. `sections 559 → 897 (+338)` and `divisions 101 → 131
   (+30)`. Checked before `--update`, and it is the check the report itself
   prescribed: of all 822 sections past the old suppression point, **0 are flush
   left** — none is a table-of-contents entry — 790 are indented run-in
   appropriations headings and 32 are caps heads. `opSpans -7` / `refs -8` /
   `relative -3` are item 70's section bound arriving on this bill for the first
   time: with the sections invisible, those instruction heads sat in no parsed
   section and kept the old, looser bound. 16 ops on hr1865 are dropped by the
   bound and all 16 are past their section's edge.

   Rendered, per item 60: the jump menu goes 560 → 898 entries over 89
   `<optgroup>`s, and Sec. 792 — which used to be part of Sec. 310's body —
   renders as `.sec-head.run-in` under the breadcrumb "DIVISION B — AGRICULTURE,
   RURAL DEVELOPMENT, FOOD AND DRUG ADMINISTRATION, AND RELATED AGENCIES".

   selftest 684 → 686, rendertest 448, proptest clean.

72. **(cc) is the alphabet past (z), and a whole section is still not the text
   of a subparagraph.** (2026-08-10, W11 and W12 of item 65.)

   **`markerDepth()` read a doubled c, l or v as a roman numeral.**
   `/^[ivxlc]{2,}$/` is tested before `/^[a-z]{2}$/`, so (cc), (ll) and (vv) —
   which are the alphabet continuing past (z), the same way (aa) and (bb) are —
   came back at clause depth. An added block led by (dd) was therefore scoped
   one level too shallow and drawn **inside** item (cc) of 42 U.S.C.
   1395w-102(b)(4)(C)(iii)(I), where the shard has them as siblings.

   The discrimination is data rather than taste, which is what makes it safe to
   make at all. Over all 705,678 shipped Code nodes, (cc) appears 639 times, 594
   of them at item depth and **once** as a clause; (ll) is 10 of 10 items, (vv)
   4 of 4, (LL) 2 of 2. Against which **(ii) is a clause 30,903 times of 32,809
   and (II) a subclause 10,511 of 11,074** — so i and x keep the roman reading
   and must not be touched, and neither must a mixed form (iv, vii, xl). (dd)
   and (mm) never reached the roman tests at all, because d and m are not in
   their character classes, which is why the class here is `[clv]` and not the
   whole roman alphabet: anything wider would be dead.

   Exactly TWO letters. A run of three is the alphabet overflowing a second
   time — 42 U.S.C. 1395x numbers its SUBSECTIONS (a)…(z), (aa)…(zz), (aaa)…
   (mmm) — so it can sit at any depth, and the first cut of this fix moved
   `(mmm)` to item depth and changed a fourth op scope from one wrong answer to
   a deeper wrong one. Caught by reading the fourth change rather than counting
   it: hr2617 adds a new SUBSECTION (mmm) to 42 U.S.C. 1395x and the right scope
   is the section itself.

   Blast radius, measured: **3 op scopes change and 22,590 do not**, and 0
   composed addresses move. All three verified against the shipped shards —
   1395w-102(b)(4)(C)(iii)(I) holds (aa)(bb)(cc)(dd), 7 U.S.C. 5939(f)(3)(B)(i)(I)
   holds (aa)(bb)(cc), and 15 U.S.C. 636(a)(37)(J)(iii)(I) likewise.

   **And `newSection` was still unread for a `replace` op.** Item 60 fixed the
   heading half of this and left the other half live: `markSectionAdditions()`
   has set the flag on a scoped replacement since item 58, and `redline.js`'s
   `replacements` filter never tested it. So 2 U.S.C. 1382(a)(2)(B) was told it
   now reads "SEC. 312. PAY OF THE ARCHITECT OF THE CAPITOL" — a block belonging
   to an instruction four lines later against a different Act — with `.node.
   replaced` drawn on it and "✓ the provision is marked above" beneath. That is
   item 33's rule broken two commits after item 59 restated it, and item 48's
   open hazard (a block read forward out of the next instruction) arriving where
   the guard for it was not wired.

   4 replace ops carry the flag and **2 reached a mark**; both are now refused,
   by exclusion from the list rather than by a flag inside it, so `placed()` is
   right for free. The panel says what the block actually is rather than
   "rewrites (a)(2)(B), which is not shown here", which would blame the pane for
   a block that does not belong to this provision at all. `coverage.mjs` gained
   the bucket, because lumping a deliberate refusal in with "not on screen"
   turns a wrong label into no label — the same note item 60 wrote about the
   heading bucket.

   Corpus unchanged for both: a scope is invisible to `opSpans`, which keys on
   `type:start-end`, and a refusal is a flag on an op that already existed.
   selftest 686 → 697, rendertest 448 → 453, proptest clean.

73. **Only the first member of a navigation list may scope an operation.**
   (2026-08-10, L2 of item 65.) `extractSteps` sets `current =
   resolved.addresses[0].levels` under a comment reading "Only the first address
   of a list advances the cursor" — and `emit()` pushes **every** member into
   `steps`, while `scopeOps()` binds an operation to the LAST step before it. So
   half the rule was written down and the other half did the opposite:

   ```
   Section 9063 of such title is amended--
       (A) in subsections (a) through (i), by striking ``in the Air Force''
       each place it appears and inserting ``in the Air Force and Space Force''
   ```

   Nine subsections named, and the operation was scoped to (i) — the one
   furthest from the cursor the same line had just set. The reader saw a chip
   for subsection (a), opened it, found the operand plainly there, and the panel
   said "⚠ not found verbatim" about text on the screen in front of them.

   The later members are still addresses worth a chip, so they move to `refs`
   rather than being dropped: once they are not steering the walk, a list member
   is exactly what a bare reference is. Corpus `steps -93` and `refs +93`, equal
   and opposite on every bill, which is the signature — nothing gained, nothing
   lost, 93 reclassified.

   133 op scopes changed and 0 composed addresses moved. Marks: **3 withdrawn,
   3 gained, 31 moved**, and every one of the 31 is from the list's last member
   to its first — `(i)`→`(a)`, `(d)`→`(a)`, `(g)`→`(b)`, `(4)`→`(3)`. Net zero,
   which is the honest summary: the same number of marks, on the member the
   instruction names first.

   **What this does NOT fix, and it is the interesting half.** An instruction
   that names nine subsections still marks one. Two of the three withdrawals are
   that exactly — "in paragraphs (1)(B) and (2)(B), by striking ``$1,000'' each
   place such term appears" marked (2)(B) before and marks neither now, because
   the operand as spelled is not in (1)(B). Choosing the first over the last is
   right — it is the member every other consumer already assumes, and the one
   the cursor is left on — but the bill said *all of them*. Scoping an operation
   to a SET wants `inScope()` in `redline.js` to take one, and `reScope()`,
   `scopeAdditions()` and the panel's messages all read `op.scope` as a string
   today. It is also entangled with L3 of item 65: `each place it appears`
   latches `op.done` after the first passage, so `all` cannot cross a node
   either. Those two want doing together.

   selftest 697 → 699, rendertest 453, proptest clean.
