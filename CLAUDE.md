# Bill Companion — working notes

Handoff notes for whoever picks this up. `README.md` describes what the app does
and is written for a user; this file is for changing it. Read both.

---

## Run / test / ingest

```bash
python tools/serve.py                     # http://localhost:8000  (NOT file://)
node tools/selftest.mjs                   # 344 checks, no dependencies
node tools/rendertest.mjs                 # 178 checks, needs `npm i -D linkedom`
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
  `corpus/files/` is **tracked** now, and `serve.py` still 404s `/corpus/` — so
  it is out of the way locally but a Pages deploy does serve it, since Pages
  serves whatever is in the repo. That is a deliberate trade for a
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
node tools/selftest.mjs     # all 344 checks passed
node tools/rendertest.mjs   # all 178 render checks passed
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

---

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
3. **Appropriations sections are recovered; the headings *inside* them are
   not.** (Was: "appropriations acts lose almost all their sections." Fixed
   2026-08-02 — see the invariant above.) H.J. Res. 31 now yields 659 sections
   against 11, and 2,139 sections were recovered across the corpus with no
   other metric moving on any bill. What is still missing is the layer *between*
   a division and its sections: appropriations acts write a bare `TITLE I` on
   one line with its heading on the next (`DEPARTMENTAL MANAGEMENT, OPERATIONS,
   INTELLIGENCE, AND OVERSIGHT`), which `RE_DIVISION` cannot match because it
   requires a separator on the same line. Those titles, and the account headings
   under them (`Office of the Secretary and Executive Management`), are the
   real navigational structure of an appropriations act and are still invisible.
   Also unresolved: `heading` for a run-in section is the provision's own first
   clause, because there is no heading to have — honest, but it makes for a
   repetitive jump menu.
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
7. **Hyphenated headings stay broken** (`CAT-` + `ASTROPHIC`) — but they are no
   longer *truncated*: a wrapped heading is now rejoined, so H.R. 3633's title I
   reads `DEFINITIONS; RULE-MAKING; EXPEDITED REG-ISTRATION` rather than
   stopping at `RULE-`. Closing the seam is what remains, and it is not obviously
   safe: `PAY-` + `AS-YOU-GO` must keep its hyphen where `REG-` + `ISTRATION`
   must lose it, and nothing in the text says which is which. Documented in
   README as a known limit.
8. **CFR part views cap at 40 sections**, silently beyond that.
9. **Popular names cover ~46 Acts**, not the full OLRC table. The Commodity
   Exchange Act was missing until the CLARITY Act pass, where it was the single
   most-cited Act in the bill — 52 cites resolving to nothing. When a sample
   leans on an Act, check the table first.
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
12. **`inserting after subparagraph (C) the following` has the sibling problem
   `scopeAdditions` just fixed for additions.** Same shape — the new provision is
   a sibling of the one named, not a child — but insert ops carry anchors and
   placement metadata that additions don't, so the fix is not the same code and
   would move more metrics. Left deliberately; do it as its own pass, with the
   corpus diff explained separately from the add-at-end one.
13. **An addition is drawn only when the provision it follows is on screen.** An
   op scoped to `(a)(3)` renders nothing if the pane is showing `(b)`. The panel
   says "⚠ the provision it follows is not shown", which is honest but is a
   dead end for the reader — the useful behaviour would be to offer to widen the
   scope to the level that does contain it.

---

## Layout

```
index.html            UI + boot diagnostic (classic script, runs when modules fail)
embed-example.html    host page for trying the iframe embed; not part of the app
app/main.js           wiring; ingest() is the single entry point for bill text
app/share.js          fragment-encoded share links (deflate + base64url)
app/parse/            pdf.js · bill.js · citations.js · outline.js  (extraction)
app/resolve/          cfr.js (live eCFR) · usc.js (local shards) ·
                      plaw.js (Public Law text) · act-sections.js ·
                      internal.js (refs within the bill) · provision-tree.js ·
                      popular-names.js · data-base.js · index.js (dispatch)
app/ui/               render-bill.js · render-context.js · redline.js · style.css
tools/                ingest_usc.py · ingest_plaw.mjs · serve.py ·
                      selftest.mjs · rendertest.mjs ·
                      measure.mjs (shared metrics) · impact.mjs · corpus.mjs
corpus/               corpus.json + baseline.json · files/ — all tracked
data/usc/             generated shards, one JSON per section; tracked — it IS the site
data/plaw/            25 Public Laws, one JSON per section NUMBER; tracked, 106 MB
```

Citation kinds: `usc` `cfr` `publaw` `stat` `act` `internal`. Relative addresses
are `usc`/`cfr` with `relative: true` and ids prefixed `r`.
