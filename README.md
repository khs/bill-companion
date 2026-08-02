# Bill Companion

Drop in a bill — PDF or raw text — and read it beside the law it actually touches.

Built by [Keller Scholl](https://kellerscholl.com). MIT licensed
([`LICENSE`](LICENSE)); the vendored pdf.js is Apache 2.0 and the bill texts are
works of the U.S. Government, not subject to copyright — see [`NOTICE`](NOTICE).

Left pane: the bill, with every citation it makes turned into a chip you can click.
Right pane: the provision that citation points at, **shown with the levels above it**,
because a subsection like `42 U.S.C. 1395x(s)(2)(B)` is meaningless without the
lead-in language of `(s)` and `(2)` that governs it.

There is no build step and no server-side application. It is plain ES modules and
static files — open it and it runs.

```
python tools/ingest_usc.py --titles common    # one-time, a few minutes
python tools/serve.py                         # → http://localhost:8000
```

Then click **Load sample** to see it working on the Fiscal Responsibility Act of 2023.

---

## What it does

**Finds the citations.** U.S. Code — both `42 U.S.C. 7401` / `42 USC § 1395x(s)(2)(B)`
and the positive-law form bills prefer, `section 801(a)(2)(A) of title 5, United States
Code` — plus CFR (`40 CFR 60.1`, `45 C.F.R. part 160`), Public Laws, Statutes at
Large, ~46 Acts referenced by popular name, and internal cross-references
(`section 4 of this Act`).

**Follows internal cross-references.** The commonest citation in a modern bill
isn't to the Code at all — it's `subparagraph (C)`, `clause (ii)`, `paragraph
(3)`, pointing somewhere else inside the same block of text. Clicking one scrolls
the bill to the provision it names and marks it.

Which one it names is the whole problem. A bare `(ii)` occurs dozens of times in
a section, so the search is scoped to the *enclosing provision*: the unit word
gives the depth (`clause` is the fourth level down), the marker style gives each
line's depth — `(a)`, `(1)`, `(A)`, `(i)`, `(I)`, `(aa)` — and the reference's
parent is the nearest line above it that is shallower. In `(B) ASSOCIATED PERSON
OF A DEALER — (i) IN GENERAL. Except as provided in clause (ii)`, that finds the
dealer's own `(ii)`, not the identically-numbered one belonging to the *broker*
subparagraph a few lines up. Depth has to come from the marker style because
indentation does not survive PDF extraction — every line comes back flush left.
A path descends: `clause (iii)(I)` finds `(I)` inside clause `(iii)`, not the
nearest stray `(I)`. Where a provision genuinely repeats an outline, the pane
says the match is the nearest of several rather than asserting it.

**Reads amendatory instructions.** The thing bills mostly *are*:

> Section 1861(s)(2) of the Social Security Act (42 U.S.C. 1395x(s)(2)) is amended
> by striking "widget" and inserting "gadget".

It pulls out the target, the operations (strike / insert / redesignate / add-at-end /
repeal), and then checks the struck language against the provision's *current* text —
so you can see whether an amendment still lines up with the law as it stands.
Quoted operands are read in all four conventions in the wild: govinfo's typewriter
``like this'', the doubled singles ‘‘like this’’ that GPO's typeset PDFs use,
curly “like this”, and straight "like this".

One instruction can carry many targets. `Each of the following provisions of law
is amended by striking X and inserting Y:` followed by a lettered list becomes one
labelled amendment per listed provision, each resolving its own citation — four
changes to four different statutes, rather than one entry naming whichever
provision happened to come first.

**Resolves relative navigation.** Nested instructions address the target by
position, and the address is spread across the lines above:

> Section 40007(a) of the ... Act (49 U.S.C. 44504) is amended—
>   (1) in paragraph (3)(B)—
>     (A) in clause (iv), by inserting "and sustainable aviation fuel" ...

`clause (iv)` alone is meaningless. Composed with `paragraph (3)(B)` above it and
the instruction's target above that, it is **49 U.S.C. 44504(a)(3)(B)(iv)** — and
that's what clicking it opens. Depth comes from the unit word (`subsection` <
`paragraph` < `subparagraph` < `clause`), so a step back *up* the hierarchy
truncates the path instead of extending it: a later `subsection (c)` is
`801(c)`, never `801(a)(2)(A)(c)`. Composed addresses are marked `↳` with a
dashed underline, and the pane shows the derivation so the jump is auditable.

All the shapes bills actually use are read, including the inside-out order and
the plural forms that are easy to miss:

| Written | Resolves to |
|---|---|
| `in paragraph (3)(B)` then `in clause (iv)` | `…(3)(B)`, then `…(3)(B)(iv)` |
| `in subparagraph (C) of paragraph (2) of subsection (a)` | `(a)(2)(C)` |
| `in subparagraphs (A) and (B)` | two addresses, not one |
| `clauses (i) through (iii)` | `(i)` and `(iii)` |
| `by redesignating clauses (ii) and (iii)` | resolved, cursor unmoved |

Navigation (`in X —`) moves the cursor; a bare mention (`after clause (i)`,
`by redesignating clauses (ii) and (iii)`) resolves against it without moving it.
That distinction matters: a cross-reference sitting inside quoted *inserted* text
— `a projection described in subparagraph (A)` — would otherwise reparent every
instruction after it, so navigation is only recognised at the head of an
instruction.

**Reads the IRC by section number.** `section 45K(c)(3) of the Internal Revenue
Code of 1986` opens **26 U.S.C. 45K(c)(3)**, because the IRC's own section
numbers are the Code's. It is the only Act whose numbering can be *assumed* that
way.

**And reads the Acts whose numbering doesn't match, by looking it up.** Social
Security Act § 1861 is 42 U.S.C. 1395x; PHSA § 330 is 42 U.S.C. 254b; Commodity
Exchange Act § 4 is 7 U.S.C. 6. There is no offset and no rule — Congress
codifies a section wherever it fits — so `section 1861 of the Social Security
Act` used to resolve only to the head of the Act, and the provision the bill was
actually changing stayed out of reach.

It is a lookup table, and the Code supplies it. Every section prints a source
credit naming the Act that enacted it and the number that Act gave it:

> 42 U.S.C. 1395x — *(Aug. 14, 1935, ch. 531, title XVIII, § 1861, as added …)*

The ingester inverts those credits into `data/usc/acts/`, so the lookup is a
single static GET like every other. The pane shows the derivation rather than
asserting it — what the bill wrote, where it is codified, and the credit that
says so — because landing on a section with a different number looks like an
error until you can see why it isn't.

Only Acts explicitly bound to their enacting credit resolve this way, and a miss
is never guessed at: a section repealed out of the Code, or one that two Code
sections both claim, resolves to nothing and keeps the numbering caveat.

**Goes up sub-levels.** The context pane's ladder (`§ 1395x` · `(s)` · `(s)(2)` · `(s)(2)(B)`)
widens the view one level at a time. Above that sits the structural breadcrumb —
Title › Chapter › Subchapter › Part — from the source's own hierarchy.

**Redlines the law.** The bill says «by striking ``widget'' and inserting
``gadget''». That is precise and nearly unreadable — to know what the law will
say you have to find "widget" in the provision yourself and do the substitution
in your head. So the diff is drawn into the **current text of the law**, in the
right-hand pane: widget struck through in red, gadget in green where it stands.
Red is language leaving the statute book, green is language entering it.

Placement comes from the connective the bill used — `striking A and inserting B`
puts B where A was, `inserting B after ``Y''` anchors to Y, `striking A each
place it appears` marks every occurrence, and `striking ``and'' at the end`
takes the last one rather than the first. Matching is done on a folded copy of
both texts, because the bill and the Code never spell a passage identically: the
bill quotes with ``…'' or ‘‘…’’, the Code has curly doubles, and a PDF bill wraps
its operand across a line. Whole words only — bills strike operands as short as
`or`, and a substring match would draw a line through the middle of "for".

Marks land only in the provision the instruction actually walked to. `in
subsection (d) — in paragraph (2) — in subparagraph (A), by striking ``or'' at
the end` strikes an "or" in (d)(2)(A) and nowhere else; searching the whole
section instead drew a line through a sentence three subsections away.

**Shows the law a bill adds.** The commonest thing a bill does is not edit an
existing sentence but write a new provision onto the end of one:

> Section 4c(a) of the Commodity Exchange Act (7 U.S.C. 6c(a)) is amended—
>   (1) in paragraph (3)—
>     (C) by adding at the end the following:
> "(D) a contract of sale of a digital commodity."

The new subparagraph (D) is read out of the bill and drawn into the law in the
right-hand pane, after (A), (B) and (C) — in the insertion colour, keeping the
outline the drafter wrote. Where it goes is decided by its own marker rather than
by where the instruction's walk happened to stop: `(D)` is a subparagraph, so it
joins the subparagraphs of paragraph (3) instead of being tucked inside
subparagraph (C), which is merely the last provision the instruction mentioned. A
new `(iv)` lands beside clause (iii); a new `(f)` lands at the end of the section.

Added blocks run from a single sentence to a whole new chapter — the largest in
the test corpus is a 59,000-character section — and all four quote conventions
are read. Where the block can't be delimited, the pane says an addition happens
without claiming to know what it says.

An instruction whose language can't be placed is *listed and labelled*, never
guessed at: either the bill named no position, or it named one whose anchor text
isn't in the provision as it now stands.

That last case is common and worth understanding. The U.S. Code here is
**current**, so an *enacted* bill has usually already been applied to it — its
struck words are gone and its inserted words are already there. Drawing the
change anyway would show the same language twice, one copy coloured as an edit.
So the redline checks the claims the bill makes about the text before trusting
them: "at the end" must really be at the end, an insertion already sitting at its
anchor is not drawn, and an amendment none of whose strikes can be found is
treated as already applied and drawn not at all. Expect a redline on roughly
three quarters of a *pending* bill's amendments and a fifth of an enacted one's.

The redline is reached from the citation too, not only from the amendment's own
`▸ amends …` tag. Clicking the composed address `clause (iv)` is the likeliest
click of all — you press it *because* you want to see what happens to clause
(iv) — and it opens that clause with the change already drawn on it.

**Shares by link.** *Copy link* puts the bill's text in the URL **fragment**,
which browsers never transmit to a server — the link can be pasted around
without the text being logged by whatever host serves these files, and there is
nothing stored server-side to expire. Only extracted text is encoded, never the
source PDF. Text deflates roughly 3× (a 117 KB bill becomes a 35 KB link); past
~8 KB the status line warns that some chat and mail clients will wrap it.

**Links out generously.** Every provision carries links to eCFR, Cornell LII,
the OLRC, and govinfo.

**Embeds in another page.** It is a static page, so an iframe is the whole
mechanism:

```html
<iframe src="https://your-host/bill-companion/"
        title="Bill Companion"
        width="100%" height="800"
        allow="fullscreen" loading="lazy"></iframe>
```

`allow="fullscreen"` is worth getting right. Framed, the toolbar grows a `⛶`
button — an embed is usually a few hundred pixels tall and two panes of statute
need more than that. With the attribute, that button fills the screen; without
it the browser refuses the Fullscreen API, so the button opens the app in a new
tab instead rather than appearing broken.

Two other things change when framed: the share link is copied to the clipboard
but not written to the address bar, because there isn't one; and if the
clipboard is unavailable the status line says so instead of pointing at an
address bar that doesn't exist.

`embed-example.html` is a host page standing in for a real one, so the embed can
be tried end to end — including deleting the `allow` attribute to see the
fallback. The **?** button in the toolbar carries the same snippet, ready to copy.

Bills are parsed entirely in your browser. Nothing is uploaded.

---

## Where the law comes from

| Source | How | Why |
|---|---|---|
| **CFR** | Live [eCFR API](https://www.ecfr.gov/developers/documentation/api/v1) | Serves `access-control-allow-origin: *`, so the browser calls it directly. Always current — no snapshot to go stale. Nothing to pre-ingest. |
| **U.S. Code** | Pre-ingested from [uscode.house.gov](https://uscode.house.gov/download/download.shtml) USLM XML | No CORS-open API exists for the Code, so it has to be local. |
| **Public Laws** | The Code's own source credits, then an outbound link | "Section 12306 of Public Law 113-79" resolves to 7 U.S.C. 1632c, because the Code says so on the section itself. 1,737 Public Laws are indexed this way. A section that was never codified — most of an appropriations act — still gets the link. |
| **Statutes at Large** | Outbound links | govinfo and congress.gov both refuse cross-origin browser requests. |

You expected the CFR would need pre-ingesting. It doesn't, and shouldn't — eCFR is
CORS-open and live, and the full CFR is several GB that would be wrong the week
after you downloaded it. The U.S. Code is the opposite case, and that's what the
ingester is for.

### Ingesting the Code

```bash
python tools/ingest_usc.py --titles 42          # one title
python tools/ingest_usc.py --titles 42,26,29    # several
python tools/ingest_usc.py --titles common      # 17 most-amended titles (default)
python tools/ingest_usc.py --titles all         # all 53 — 60,436 sections, 322 MB, ~5 min
```

It auto-detects the current release point, writes one JSON file per section
(`data/usc/t42/s7401.json`), and skips titles already present unless `--force`.
A lookup in the browser is then a single static GET with no index to load first.

It then reads every shard's source credit back and writes `data/usc/acts/` —
2,730 files, 0.7 MB — the Act-section → Code-section index described above.
`--acts-only` rebuilds just that, from shards already on disk, downloading
nothing.

Roughly 11 titles ≈ 24,000 sections ≈ 130 MB on disk; all 53 is 60,436 sections
and 322 MB, and took about five minutes on a 2026 desktop.

Citing an un-ingested title isn't an error — the pane says so, shows the exact
command to fix it, and still gives you the outbound links.

---

## Layout

```
index.html              the whole UI
embed-example.html      a host page, for trying the iframe embed
app/
  main.js               wiring
  parse/
    pdf.js              PDF → text (pdf.js; strips marginal line numbers, re-joins hyphens)
    bill.js             bill structure: sections, divisions, short title
    citations.js        citation + amendatory-instruction extraction
  resolve/
    cfr.js              live eCFR
    usc.js              local shards, graceful fallback
    internal.js         cross-references within the bill → an offset to scroll to
    provision-tree.js   flat paragraphs → nested subsection tree
    popular-names.js    Act name → U.S. Code location
  ui/
    render-bill.js      left pane
    render-context.js   right pane
    redline.js          applies an amendment to the law, for the right pane
    style.css
samples/
  sample-bill.txt       Fiscal Responsibility Act of 2023 (H.R. 3746, enrolled text)
  hr9925-frontier-act-119th.pdf   FRONTIER Act (H.R. 9925, 119th) — PDF-path fixture
  hr3633*               CLARITY Act (H.R. 3633) — house-passed and senate-reported
                        prints, and the senate substitute text
tools/
  ingest_usc.py         U.S. Code ingester
  serve.py              static dev server
  selftest.mjs          logic tests (no dependencies)
  rendertest.mjs        DOM tests (needs linkedom)
  measure.mjs           the metric definitions impact and corpus share
  impact.mjs            end-to-end report: what a bill actually parses to
  corpus.mjs            regression corpus: many bills, diffed against a baseline
corpus/                 corpus.json + baseline.json, and files/ — the bills
vendor/                 pdf.js, vendored so the app works offline
data/usc/               the ingested Code: 60,436 sections + acts/, generated
data/plaw/              25 Public Laws, sharded per section number, generated
.nojekyll               tells GitHub Pages to serve the tree as-is
```

Everything except `node_modules/` is committed, including the 322 MB of ingested
Code. It is generated, but it is also *the site* — a deploy without it resolves
nothing — so it lives here rather than being fetched at build time.

## Tests

```bash
node tools/selftest.mjs       # 344 checks: parsing, PDF extraction, citations, tree, share links, live eCFR, local data
npm i -D linkedom             # once, for the DOM tests
node tools/rendertest.mjs     # 185 checks: both panes, the redline, additions, resolvers, fallback states, wiring
node tools/corpus.mjs         # 30 real bills, every metric diffed against a recorded baseline
node tools/impact.mjs         # not a test: prints what one bill parses to, resolution included
```

(`bun` should work too — `bun add -d linkedom`, `bun tools/selftest.mjs` — though
only Node has been run since the last portability fix. Node on Windows needed
that fix: its ESM loader rejects a bare `C:\…` path in a dynamic `import()`,
which bun accepts, so three of the four tools ran only under bun. `linkedom` is
a dev-only dependency — the app itself has none.)

The DOM tests earn their keep. They catch an element id in `main.js` that doesn't
exist in `index.html` — otherwise a blank page on load — and they bound the
amendment-block count on *both* sides, which is how a bug that rendered one block
for eleven amendments got caught.

The PDF test earns its keep the same way. Both sample bills used to be plain
text, so nothing exercised the PDF path, and it was quietly broken for *every*
introduced bill: the line-number gutter was assumed to sit in the leftmost 8% of
the page, which is true of enrolled PDFs and false of the introduced and
committee-draft ones, where the whole text block is indented. Numbers stayed
glued to their lines, no `SEC.` heading matched, and the app reported a bill with
zero sections rather than an error. The fixture is `samples/hr9925-frontier-act-119th.pdf`
(H.R. 9925, 119th Congress), which has the layout that broke: right-aligned line
numbers a fifth of the way across the page, and baselines on odd integers.

That fixture left one gap of its own: the FRONTIER Act is freestanding and amends
nothing, so no test ever read an *amendment* out of a PDF. It turned out none
could. The Government Publishing Office typesets quoted language as `‘‘like
this’’`, the operand matchers knew only `` `like this' `` and `"like this"`, and
so not one struck or inserted phrase was extracted from any PDF bill — the diff
preview, which is most of the point, came up empty on every one of them while the
plain-text path looked healthy. The CLARITY Act (H.R. 3633) fixtures cover that
path now: the house-passed print for the PDF side and the senate substitute for
the text side, the two largest and most structurally complex bills here.

`tools/impact.mjs` is the companion to all of this and is not a pass/fail test.
It prints what one bill actually parses to — sections, citations by kind,
amendments, navigation steps, how many internal references got composed into real
addresses, and how many resolved targets exist in the Code. Diff it against the
previous run after touching extraction: every bug above showed up there as a
number that was obviously wrong long before anyone could name the cause.

`tools/corpus.mjs` is the same idea at scale. The test suites assert fixed
numbers about four fixtures that ship with the app; the corpus runs thirty real
bills — the Infrastructure Act, the CARES Act, the Bipartisan Budget Act and
others, too large to ship — and diffs every metric against a recorded baseline.
Its question is not "is this right?" but "did that change do anything I didn't
intend?", on bills nobody wrote assertions for. It earned its place on the first
run, turning up 93 amendatory instructions that were being silently skipped
across four bills; three systematic causes accounted for 77 of them. The bills
live in `corpus/files/`. The dev server refuses to serve them, and nothing in the
app links to them; they are committed so a fresh checkout can run the corpus
without a fetch step first.

---

## Known limits

- **Act section numbers ≠ codified section numbers**, and only some Acts are
  mapped. Four are — the Social Security Act, the Public Health Service Act, the
  Immigration and Nationality Act and the Commodity Exchange Act — via the
  source-credit index described above. For every other Act, a bill that gives
  only the Act-relative number and no parenthetical U.S.C. cite still resolves
  to the head of the Act, with a caveat rather than a guess. Adding one is a
  single `enactedAs` field in `app/resolve/popular-names.js`, but it has to be
  the Act as the Code's credits spell it, checked against a real shard.
- **Scanned PDFs need OCR first.** Text extraction requires a text layer.
- **A hyphenated heading keeps a visible seam.** A heading too long for the
  measure now carries its continuation — `DEFINITIONS; RULE-MAKING; EXPEDITED
  REG-ISTRATION` rather than stopping at `RULE-` — but the hyphen the typesetter
  broke the word on is kept rather than closed up. Body text rejoins cleanly
  because the continuation is lowercase; headings are set in caps, where that
  signal is gone and `COST-` + `EFFECTIVE` is indistinguishable from `CAT-` +
  `ASTROPHIC`. Keeping the hyphen shows a seam; removing it would invent words.
- **An added block that closes twice is read only as far as its first close.**
  A bill adding several provisions at once normally opens each paragraph with a
  quote mark and closes once at the very end; a few write each added
  subparagraph as its own closed quote instead, and only the first is shown. Two
  cases in 3,253 across the test corpus — it shows less than the bill adds,
  rather than something the bill doesn't say.
- **An addition is drawn only when the provision it follows is on screen.** A new
  subparagraph of paragraph (3) needs paragraph (3) in view; otherwise it is
  listed in the panel with a note rather than drawn.
- **CFR part views are capped at 40 sections** to keep rendering responsive.
- **Popular-name coverage is ~46 Acts**, not the full OLRC popular-names table.
- **A few unusual amendatory phrasings are still missed** — 16 across the nine
  bills in the regression corpus, in 14 distinct shapes, each appearing once or
  twice. A Public Law cited as the direct target, "the sixth sentence of section
  7(m) of title 4", "the table in subclause (II) of section 430(h)(2)(C)(iv)".
  The systematic forms are handled; what remains is a long tail.
- **Seven section numbers in the U.S. Code are duplicates**, because two Public
  Laws each added a section with the same number (5 U.S.C. 3598 and 5757,
  10 U.S.C. 130g and 2892, 28 U.S.C. 1932, 38 U.S.C. 1167, 40 U.S.C. 3318). One
  file per section number means only one of each pair is shown. The ingester
  reports them and records them in the manifest rather than losing them quietly.
  Adding one is a single entry in `app/resolve/popular-names.js`.
- The eCFR API occasionally rate-limits; the pane surfaces the error and keeps the
  outbound links working.
