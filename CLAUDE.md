# Bill Companion — working notes

Handoff notes for whoever picks this up. `README.md` describes what the app does
and is written for a user; this file is for changing it. Read both.

---

## Run / test / ingest

```bash
python tools/serve.py                     # http://localhost:8000  (NOT file://)
node tools/selftest.mjs                   # 534 checks, no dependencies
node tools/rendertest.mjs                 # 284 checks, needs `npm i -D linkedom`
node tools/corpus.mjs                     # 30 real bills, diffed against a baseline
node tools/impact.mjs                     # not a test — prints what one bill parses to
python tools/ingest_usc.py --titles all   # ~5 min; skips titles already present
node tools/ingest_plaw.mjs                # 25 Public Laws, 106 MB; skips those present
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
with all 63,168 shard files and all 26 corpus bills. Two steps remain:

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
11. **No visual verification has ever happened.** Colours, spacing, dark mode, the
   green/red diff — all unconfirmed by anyone but the user. The `.node.added`
   block added on 2026-08-01 is still unseen. Three more things were added on
   2026-08-02 that nobody has looked at either, and all three are *layout*
   rather than colour, which is the kind linkedom cannot check:
   - `.sec-where`, the breadcrumb inside each section head. It renders inside a
     `.sec-head`, so it has to opt out of that rule's caps and accent colour —
     if the opt-out loses, every breadcrumb SHOUTS IN ACCENT BLUE.
   - `.sec-head.run-in`, the appropriations heading that carries its own first
     sentence. Same risk in reverse: if the override loses, 648 paragraphs of
     H.J. Res. 31 render as uppercase accent-coloured headings.
   - `<optgroup>` in the jump menu. Native select styling varies by platform and
     nobody has seen it on any of them.
   And the Public Law pane added the same day is a fourth: `.card.warn` for
   "As enacted", `.prov` blocks for each section, and a `.links` row reused as a
   table of contents for up to 200 entries — which is a lot of chips in a row
   and has never been looked at.
   Ask for a screenshot of the Fiscal Responsibility Act (breadcrumbs, and the
   run-in sections in division B) and of a Public Law citation before trusting
   any of it.
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
tools/                ingest_usc.py · ingest_plaw.mjs · make-library.mjs · serve.py ·
                      selftest.mjs · rendertest.mjs ·
                      measure.mjs (shared metrics) · impact.mjs · corpus.mjs
corpus/               corpus.json + baseline.json · files/ — all tracked
data/usc/             generated shards, one JSON per section; tracked — it IS the site
data/plaw/            25 Public Laws, one JSON per section NUMBER; tracked, 106 MB
```

Citation kinds: `usc` `cfr` `publaw` `stat` `act` `internal`. Relative addresses
are `usc`/`cfr` with `relative: true` and ids prefixed `r`.
