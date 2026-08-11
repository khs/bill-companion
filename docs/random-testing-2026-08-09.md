# Bill Companion — pooled findings from five randomised testing campaigns

**Target:** HEAD `421c74f58`, tree clean, selftest 664 / rendertest 437 / corpus / proptest all green.
**Pooled:** 30 reported findings across 5 campaigns, each independently verified by a second agent. **2 rejected**, **28 accepted**, **1 duplicate pair** (RE_QUOTE_CLOSE found twice from opposite directions) → **27 distinct defects**.

I re-verified every source anchor cited below against the working tree, and re-derived the largest lost-answer number myself (§1, L1). Line numbers in this report are confirmed, not quoted from the campaigns.

---

## 1. Verified defects, ranked

### Tier 1 — confident wrong provision (live on shipped corpus text)

Ranked by severity-per-instance × measured frequency. Every one of these puts a real, unrelated provision, or real but wrong statutory language, in front of the reader with no hedge.

---

**W1. `at the end of paragraph (N)` is parsed and thrown away, so the strike is drawn on a provision the instruction never names**
`app/parse/citations.js:1028` (`PUNCT_UNIT_TAIL` is a non-capturing optional group — I confirmed the unit is consumed and discarded) · `:557` `RE_AT_THE_END` · `:875`

- **Repro:** hr5376-117-enr @406677 — `Section 25C(a) … is amended by striking ``and'' at the end of paragraph (1), by striking the period at the end of paragraph (2) and inserting ``, and'', and by adding at the end the following new paragraph: ``(3) … home energy audits.''`. Resolve 26 U.S.C. 25C(a), build the redline, walk the tree.
- **Wrong:** both strikes carry the instruction *head*'s scope `(a)` plus `atEnd`, so `atEnd` takes the last terminal position in whatever node `apply()` is handed. Marks land at `(a)(2)` and `(a)(3)`. `(a)(3)` is the paragraph **this bill creates** and which the app itself labels `.node.was-added` ("Added by this bill — already in force") — so one card simultaneously says the bill added the paragraph and strikes its terminal punctuation, with the panel reporting "✓ struck above".
- **Right:** the shard shows 25C(a)(1) already lacks its "and" and (a)(2) already ends ", and". The bill is enacted; the correct output is **no pending mark at all**.
- **Frequency:** **201 ops name a unit this way; 170 draw a mark; 7 land at the named unit and 163 land elsewhere.** Verified separately that **0 of the 163 is even a descendant** of the named unit, so none is the defensible "end of (2) is the end of its last subparagraph" case. 14 bills; worst hr3734 (29), hr1-115 (23), hr3590 (21). Same shape untested: a trailing `in <unit> (M)` is discarded too.

---

**W2. An amendment body is not bounded by the end of its own bill SECTION** — FIXED 2026-08-10, CLAUDE.md item 70
`app/parse/citations.js:3074-3075` — `const bodyEnd = Math.min(nextHead, h.headEnd + MAX_AMEND_BODY, text.length)`. `extractAmendments(text, citations, divisions = [])` is never passed sections.

- **Repro:** hr5376-117-enr, last amendment of SEC. 13101 (target 26 U.S.C. 45) has `start` 308682, `end` 310595 against a section end of 310052 — 543 characters into SEC. 13102, which reads *"The following provisions of **section 48** are each amended…"*.
- **Wrong:** seven chips composed onto 26 U.S.C. 45 — `(c)(1)(D)` renders "geothermal energy,". Also verified: hr1-115 SEC. 13101→13102 composes `26 U.S.C. 179(d)(2)`; hr1865 SEC. 126→127 composes four refs onto `26 U.S.C. 30D(g)`; hr6395 SEC. 1633→1634 composes a freestanding study section's own "subsection (a)" onto `10 U.S.C. 492a(a)`.
- **Right:** 26 U.S.C. 48(c)(1)(D) = "The term 'linear generator assembly' does not include any assembly which contains rotating parts." Both sections exist, which is what makes this the worst category rather than a blank.
- **Frequency:** strictest measurement (head genuinely inside a parsed section AND a literal `SEC. N.` heading at that section's end): **550 relative citations composed across a real section boundary on 22 of 26 bills; 296 answer with a real provision.** Worst hr6395 (96), hr2617 (78), hr3684 (73), hr2 (51). 2,853 amendment bodies end past their section overall.
- **Trap for the fix:** attributing by *position* overcounts. `parseBill` misses run-in appropriations heads written as a bare `Sec. 401.` line (hr1865 @~1564376), parking later text in the previous section. Attribute via `viaAmendment` and require the head to sit inside a parsed section.

---

**W3. `in section 207 (12 U.S.C. 3206)` is not navigation — `UNIT_WORDS` has no "section"**
`app/parse/citations.js:1261` — `const UNIT_WORDS = '(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem)s?'` (confirmed verbatim). `RE_NAV` therefore cannot fire and `expandRelativeRefs` keeps spreading the amendment's Act-level anchor over every step.

- **Repro:** hr4173-111-enr @567532 — `The Depository Institution Management Interlocks Act (12 U.S.C. 3201 et seq.) is amended-- (1) in section 207 (12 U.S.C. 3206)-- (A) in paragraph (1), by inserting before the comma at the end the following: ``and Federal savings associations (the deposits of which are insured by the FDIC)'';`
- **Wrong:** every chip composes onto the Act anchor — `12 U.S.C. 3201(1)`–`(4)`, the DIMIA definitions, unhedged. Also: `in section 4 (12 U.S.C. 1843) — (A) in subsection (i)` → `12 U.S.C. 1841(i)` "Thrift Institution" instead of 1843(i) "Acquisition of savings associations"; CARES `in section 736 (42 U.S.C. 293), by striking subsection (i)` → `292(i)`, which does not exist.
- **Right:** 12 U.S.C. 3206(1) reads "…national banks **and Federal savings associations (the deposits of which are insured by the Federal Deposit Insurance Corporation)**," — verbatim the language being inserted. The correct section is **already parsed as its own chip one position away**.
- **Frequency:** **250 composed addresses across 10 bills; 61 land on a node that exists at the wrong section; 196 would have found a real node at the section the instruction named.** hr4173 (177), hr2617 (14), hr3590 (14), hr3734 (12).

---

**W4. A bill's own effective-date clause is composed into a Code address**
Same `MAX_AMEND_BODY` over-reach as W2, but *within* one bill section — so fixing W2 will **not** fix this.

- **Repro:** `SEC. 11001. … (a) In General.--Section 5000A(c) … is amended by striking ``2.5 percent''… (b) Effective Date.--The amendment made by subsection (a) shall apply to taxable years…`
- **Wrong:** "subsection (a)" becomes a chip resolving to `26 U.S.C. 5000A(a)`. Hand-checked live: hr5376 §13101(k)(2) → `26 U.S.C. 45(h)` (bill's own (h) is "Credit Reduced for Tax-exempt Bonds"); hr748 §2303(d)(1) → `26 U.S.C. 172(a)`; hr1892 → `42 U.S.C. 673b(a)`; hr3684 → `49 U.S.C. 22907(a)`.
- **Right:** "the amendment(s) made by <bill subdivision>" is *definitionally* about the bill. `locateInternal` answers it correctly and is being displaced.
- **Frequency:** **204 composed addresses across 21 bills; 201 resolve; 156 land on a subsection that actually exists.** `internalKept = 0` — every one displaced the correct internal answer. The tell is one fixed token in front of the reference.

---

**W5. An addition's "already in the law" test runs against a heading-stripped haystack**
`app/ui/render-context.js:29` — `[res.lead || '', ...res.tree.map(flattenText)]`. `flattenText` emits `marker + text` and drops `node.heading`; `subtreeText()` (which render-context already passes to `replacedAt()`) keeps it. `alreadyIn()` matches an 80-character folded prefix, and a bill's added block carries its heading inline, so the prefix can never match.

- **Repro:** samples/sample-bill.txt (hr3746-118-enr) @14970 — the addition of 2 U.S.C. 901(d), "Revised Discretionary Spending Limits for Fiscal Year 2024".
- **Wrong:** the rendered pane emits three nodes — `(d) Revised discretionary…2024`, `(e) …2025`, and `[added] (d) Revised Discretionary…2024`. **Subsection (d) appears twice on one screen, once as law and once in the insertion colour.** This is exactly the duplication the tracked invariant exists to prevent.
- **Right:** the `.node.was-added` mark, "Added by this bill — already in force" (item 36's state).
- **Frequency:** **777 of the 1,756 additions drawn as pending (44%) are already in the law once the heading is restored.** Shard-verified samples: 42 U.S.C. 1395w-28(h), 7 U.S.C. 1508b(f), 49 U.S.C. 5312(b)(4), 16 U.S.C. 3822(c)(2), 12 U.S.C. 3351(h), 42 U.S.C. 1395ddd(i).
- **Note:** this is the largest single move in the report and it changes what colour provisions are drawn in. It wants item 54's withdrawal audit, not a count.

---

**W6. A paired insert is drawn with no test that the law already reads it** — FIXED 2026-08-10, CLAUDE.md item 75
`app/ui/redline.js:457` (the `op.replaces` branch) has no `alreadyThere` test; `:485` (the `op.anchor` branch) does. Confirmed by reading both branches.

- **Repro:** hr5376-117-enr @257339 — `Section 1860D-14(a) … (2) in paragraph (2)-- (B) in subparagraph (D), by striking ``The substitution'' and inserting ``Subject to paragraph (6), the substitution'';`
- **Wrong:** `42 U.S.C. 1395w-114(a)(2)(D)` renders `Subject to paragraph (6), [STRIKE>the substitution<]{+INS>Subject to paragraph (6), the substitution<+} for the beneficiary coinsurance…`. The strike operand survives *inside* the inserted phrase, so `isStale()` is false and nothing suppresses the draw. Also 10 U.S.C. 9781(a)(2): `Department of the [STRIKE>Air Force<]{+INS>Department of the Air Force<+}`.
- **Right:** the shard already reads the amended text; the correct mark is `was` (already in force) or nothing.
- **Frequency:** **188 of 304 drawn paired inserts of 24+ characters already sit in the node they are drawn into (62%), across 19 bills.** The anchored branch, which has the guard, duplicates in **13 of 169** — that asymmetry names the cause. Treat 188 as an upper bound (the test is plain containment); the hand-read cases are unambiguous.

---

**W7. Three hand-authored popular-name entries with no `enactedAs` answer with an unrelated section under a false sentence** — FIXED 2026-08-10, CLAUDE.md item 78
`app/resolve/popular-names.js:83` — `{ name: 'National Defense Authorization Act', pattern: '…(?:\\s+for\\s+Fiscal\\s+Year\\s+\\d{4})?', title: '10', section: '101', range: 'varies' }` (confirmed verbatim).

- **Repro:** any sentence naming an NDAA → `extractCitations` + `resolve`.
- **Wrong:** card reads "National Defense Authorization Act — Definitions", then **"Shown below is its first section"**, then 10 U.S.C. 101(a). That sentence is false: 101's own source credit is `(Aug. 10, 1956, ch. 1041, 70A Stat. 3; …)` — the title 10 codification act, not any NDAA. One generic pattern swallows 20+ distinct Public Laws.
- **Right:** an outbound link, or the `data/plaw` text. (The *sectioned* form is fine — all 174 "section N of the FY20XX NDAA (Public Law X-Y)" citations correctly reach `data/plaw`.)
- **Frequency:** **180 citations across 6 bills** (hr6395 98, hr4346 40, hr2617 26). **Wider than reported:** the same shape holds for "Inflation Reduction Act of 2022" → 26 U.S.C. 1 "Tax imposed", and "Infrastructure Investment and Jobs Act" → 23 U.S.C. 101 "Definitions", each under the same false sentence. The contrast that makes these wrong rather than merely vague: 20 U.S.C. 6301 genuinely *is* ESEA §1001, so the identical sentence is true there (see R2).

---

**W8. A quoted block whose opener sits mid-line is invisible to `quotedBlocks()`** — FIXED 2026-08-10, CLAUDE.md item 76
`app/parse/outline.js:116` — `RE_BLOCK_OPEN = /^[ \t]*(``|‘‘|[“"])/` requires the opener to start the line. `readAddedBlock` on the op side has no such requirement, so the two spellings of "where new law begins" disagree.

- **Repro:** `(C) by adding at the end the following: ``The Secretary may waive subparagraph (A) if…''`. Moving the opener to the head of the next line (the control) makes the block visible and the reference correctly declines.
- **Wrong:** `cite.inserted` is never set, so `locateInternal` widens to the whole bill section and answers a statutory cross-reference with **the bill's own drafting instruction**. Live: hr2617-117-enr @2751812 — "subparagraph (A)", meaning 26 U.S.C. 408A(e)(1)(A), is answered with "(A) by striking the period at the end of subparagraph (B)", under the unhedged heading "The only (A) inside the enclosing provision."
- **Right:** the reference is inside inserted law and must be bounded by it — composed against the provision the block joins, or declined. This is item 41's bug reached through a formatting door.
- **Frequency:** **45 internal refs inside an op-delimited block that `quotedBlocks()` cannot see, across 9 bills — 16 unhedged, 11 guessed, 18 declined.**

---

**W9. A wrapped cross-reference breaking after "and"/"or" is admitted as a real outline marker** — FIXED 2026-08-10, CLAUDE.md item 76
`isWrappedMarkerLine` asks only whether the previous line ends in a unit word; a list separator at the break leaves it ending in "and", which the module reads as evidence of a *real* marker (item 53 states that premise outright).

- **Repro:** `…the requirements of paragraphs (3) and\n(4) of subsection (b) of section 9 of the Small Business Act.` → `outline()` reports a paragraph-level marker mid-sentence.
- **Wrong:** the phantom becomes a sibling, `locateInternal` picks the nearest match, and the highlight lands mid-sentence reported as "The only (6) inside the enclosing provision". Live unhedged: hr5376 "paragraph (6)" @6772 → @6627 (mid "…under paragraph (5) or\n(6) of section 469(c)"); s2938 "paragraph (8)" @5204/@5859/@5954. Both consumers are affected (`internal.js` and `render-bill.js:75`), so the same phantom also splits the sentence in the left pane.
- **Right:** nothing at that offset is a provision. A second tell is available and is what the measurement keys on: **an outline marker is never followed by "of section/subsection/…"**.
- **Frequency:** **104 phantoms admitted across 19 bills; 63 already correctly rejected; 18 internal refs resolve onto one, 4 unhedged.**

---

**W10. `RE_INSERT`'s 400-character operand cap does not truncate — it re-matches from a later opener** — FIXED 2026-08-10, CLAUDE.md item 77
`app/parse/citations.js:959`. The lazy run cannot reach the closer from the first opener, the match fails there, and the engine advances the gap and succeeds from a later quote opener.

- **Repro:** hr1892-115-enr SEC. 40402(b)(1) — `Section 25D(a) is amended by striking ``the sum of--'' and all that follows and inserting ``the sum of the applicable percentages of-- ``(1) the qualified solar electric property expenditures, … ''.`
- **Wrong:** op recorded with length 376, text beginning `(1) the qualified solar electric property expenditures,`. **The words "the sum of the applicable percentages of--" are absent** — and `render-context.js` prints a plain insert as `“${flat(op.text)}”` verbatim, so the panel states the new law starting mid-sentence, reading as 100% of the expenditures.
- **Right:** the shard reads "…an amount equal to **the sum of the applicable percentages of**—". The dropped clause *is* the operative change.
- **Frequency:** **16 across the corpus, every recorded length 344–399** (the cap's signature). Two named knock-ons: hr1892 drops `(4) for fiscal year 2019, $900,000,000;` so the block now leads with (5), moving `scopeAdditions()` placement; s47-116-enr drops `SEC. 711. JUNIPER FLATS.` from the block head, **defeating item 48's `newSection` guard**, since `RE_SECTION_BLOCK` tests exactly the text that was truncated away.
- This is item 36's documented mechanism, unfixed in the sibling shape. `readAddedBlock()` is the right instrument; a character budget is not.

---

**W11. `markerDepth()` reads `(cc)`, `(ll)`, `(vv)`, `(CC)`, `(LL)`, `(VV)` as roman numerals** — FIXED 2026-08-10, CLAUDE.md item 72
`app/resolve/internal.js:46-49` — confirmed: `/^[IVXLC]{2,}$/` (subclause) and `/^[ivxlc]{2,}$/` (clause) are tested **before** `/^[a-z]{2}$/` (item) and `/^[A-Z]{2}$/` (subitem).

- **Repro:** identical instruction, one character different in the block's leading marker: lead `(cc)` → add-at-end scope `(a)(37)(J)`; lead `(dd)` → scope `(a)(37)(J)(iii)(I)` (correct).
- **Wrong (shard-verified, 3 live):** hr1319 scopes to `(a)(37)(J)` where 15 U.S.C. 636(a)(37)(J)(iii)(I) holds items (aa),(bb),(cc); hr2 scopes to `(f)(3)(B)` where 7 U.S.C. 5939(f)(3)(B)(i)(I) holds (aa),(bb),(cc); **hr5376 draws new item (dd) *inside* item (cc)** of 42 U.S.C. 1395w-102(b)(4)(C)(iii)(I), where the shard has (dd) as (cc)'s sibling.
- **Right:** ground truth over all 705,678 shipped Code nodes — `(cc)` 639 uses, 594 at item depth, **1** at clause depth; `(ll)` 10/0 clauses; `(vv)` 4/0; `(LL)` 2/0. Against which `(ii)` is a clause 30,903 times of 32,809 and `(II)` a subclause 10,511 of 11,074 — **so the current default is right for the genuinely ambiguous ii/xx/II/XX and must be left alone.**
- **Frequency:** 10 of 52 doubled-letter styles broken (enumerated exhaustively). Blast radius of the narrow fix, measured: **4 op scopes change, 22,848 unchanged.** Second consumer affected: `scopeUnitInserts()` produces a path with a hole, and where the *added* marker is one of these the op never gets `placement: 'after-unit'` at all.
- **Correction:** Campaign 2's headline case (hr6201 / 42 U.S.C. 1395l → `additionsAt("(b)")`) is real but **not caused by this bug** — (b) is at depth 0 and survives either reading. hr5376 is the instance they missed.

---

**W12. `newSection` is unread for a `replace` op** — FIXED 2026-08-10, CLAUDE.md item 72
`app/ui/redline.js:335` — `.filter((o) => o.type === 'replace' && … && !o.scopeLost && !o.headingOnly)` (confirmed: no `newSection` test), while `:524` for additions does test `op.rangeEnd || op.newSection`. `replacedAt()` skips the leading-marker identity test because a block headed `SEC. 1.` has no leading `(x)` marker.

- **Repro:** hr1865-116-enr @762061 — instruction (C) amends 2 U.S.C. 1382(a)(2)(B); the block belongs to instruction (D) four lines later, which amends 2 U.S.C. 1802 (a different Act).
- **Wrong:** 2 U.S.C. 1382(a)(2)(B) gets `.node.replaced` + "This bill rewrites this provision in full", and the panel prints the Architect of the Capitol's pay section as its new text, with "✓ the provision is marked above". Second live case: hr1892 @588268 marks `PART E--FEDERAL PAYMENTS FOR FOSTER CARE…` on 42 U.S.C. 622(b)(19) with `inLaw=true`.
- **Right:** nothing should be marked. A whole section — or a PART heading — is never the text of a subparagraph, which is exactly what `markSectionAdditions()` set the flag to say. Item 60 fixed the heading half and left this live.
- **Frequency:** **4 replace ops carry `newSection`; 2 reach a mark.** Low count, worst kind, in a family two consecutive CLAUDE.md items claim closed.

---

**W13. A malformed harvested popular-name entry makes one chip out of two Acts** — FIXED 2026-08-10, CLAUDE.md item 78
`app/resolve/popular-names.js:288` — confirmed verbatim: `name: 'Consumer Financial Protection Act of 2010, and under the Federal Trade Commission Act'`, `title: '15', section: '41'`.

- **Repro:** the Dodd-Frank §1027 sentence at hr4173-111-enr @2325790.
- **Wrong:** one 84-character `act` chip **opening on the words "Consumer Financial Protection Act of 2010"** and resolving to 15 U.S.C. 41, "Federal Trade Commission established; membership; vacancies; seal".
- **Right:** the CFPA is 12 U.S.C. 5481 et seq.; the FTC Act named later in the same sentence is a second, separate Act with its own correct entry at line 139.
- **Frequency:** **8 of 185 entries are not short titles, 25 firings across the corpus — but only this one produces a wrong provision.** The other 7 (National Emergencies Act, Securities Exchange Act ×2, FFDCA ch. IV, ESA, ICA 1940, ISDEAA) resolve to the correct Act and are *span overreach* — the chip covers words outside the Act's name. Two of the eight are a section heading plus its run-in body opening, harvested as one name. Item 32's substring hazard, mirrored.

---

**W14. An unbalanced quote in the source swallows the next sub-instruction**

- **Repro:** hr3162-107-enr line 6301 (USA PATRIOT Act §814(c)) — the govinfo rendition of Pub. L. 107-56 writes `by striking ``and' at the end;` with **two backticks and one apostrophe**, a genuine defect at source.
- **Wrong:** the strike operand runs 148 characters across the next sub-instruction; the navigation to subparagraph (B) disappears; two op spans overlap by 79 characters; and `render-context.js` prints the 148-character instruction fragment as language struck from 18 U.S.C. 1030(c)(2)(A) beneath "⚠ not found verbatim".
- **Right:** the same text with `` ``and'' `` gives strike text "and" at `(c)(2)(A)` and insert at `(c)(2)(B)`.
- **Frequency:** **1 site in 34 MB — the only overlapping op pair in 22,874 ops.** Nothing is drawn today (18 U.S.C. 1030 was restructured after 2001) so the whole amendment lands in `unplaced()`; the wrong scope is in the data the panel reports from.

---

**W15. `rewriteInForce()` is one-directional containment, so a deletion-only rewrite always scores 1.0** — MEASURED AND DECLINED 2026-08-10, CLAUDE.md item 74 *(structural; 0 corpus incidence for a reason worth reading)*
`app/ui/redline.js:801-824`.

- **Repro:** `Section 428(a)(2)(A) of the Higher Education Act of 1965 (20 U.S.C. 1078(a)(2)(A)) is amended to read as follows:` followed by the shipped text of that provision **with clause (iii) removed** — the ordinary way a bill repeals a requirement.
- **Wrong:** block ⊆ provision → containment 1.0, `inLaw = true`, node drawn `.replaced.in-force` titled "Rewritten by this bill — already in force", panel says "✓ already in force". The figure guard (item 63) cannot help: a subset introduces no new figure.
- **Right:** the rewrite has *not* happened — 1078(a)(2)(A)(iii) is still on disk and rendered a few lines below the mark. The comparison has to be symmetric.
- **Frequency:** **0 observable in the corpus, and that is the point.** All 422 in-force replacement claims come from enacted bills, so the corpus is structurally blind here. This bites exactly the pending bills the app exists for. See §4.

---

**W16. `RE_QUOTE_CLOSE` knows three of the four quote conventions** *(found independently by two campaigns; 0 shipped incidence, paste path only)*
`app/parse/citations.js:1592` — `/''|’’|[”]/`, against `:1588` `RE_QUOTED_LINE = /^\s*(?:``|‘‘|["“])/` and `:949-950` `QO`/`QC`, **both of which include the straight double**. Confirmed verbatim.

- **Repro:** any two-sub-instruction amendment, QO/QC substituted. govinfo / GPO / curly all give steps=2 and scopes `[(c)(2), (c)(2), (b)]`; straight doubles give steps=1 and `[(b), (b), (b)]`.
- **Wrong:** `inQuotedBlock` latches true at the first quoted line and can never clear, so `extractSteps` skips every remaining line as inserted law and each later op keeps the previous walk's scope — a different provision, not a blank. Re-spelling real bills: hr1319 steps 57→34 with 39 op scopes changed; sample-bill.txt 22→12 with 19 changed; hr2 steps 898→436 with 623 of 2,307 matched ops changing scope.
- **Right:** the tracked invariant is explicit. GPO and curly are byte-identical to govinfo on every bill, which isolates the cause to this one character class.
- **Frequency:** **0 in any shipped fixture** (all 26 corpus bills and both samples use ``…''; all three PDFs come out of pdf.js as ‘‘…’’). Exposure is `app/main.js` `ingest()` — text pasted from a web page, word processor, or Congress.gov HTML. **Caveat on the fix:** adding `"` to the class is not sufficient alone — with a symmetric delimiter the opening line of a multi-paragraph block would also close it. The state machine needs to be pair-aware, as `quotedBlocks()` in outline.js already is.

---

### Tier 2 — robustness

**R0. `-{2,}\s*` in `AMEND_BOUNDARY` makes `extractAmendments` quadratic in the length of a hyphen run**
`app/parse/citations.js:351` (confirmed).

- 2,000 hyphens 60 ms · 4,000 167 ms · 8,000 741 ms · 16,000 3,100 ms · 32,000 13,116 ms — exactly ×4 per doubling. Character-specific: 16,000 of `=`, `.`, `x`, `_` cost 0–1 ms. Removing that alternative: 32,000 hyphens in 1 ms vs 2,958 ms. Four patterns share `AMEND_BOUNDARY`, hence ~4× the pipeline cost.
- **Not a crash and not a mis-answer.** The reported "crash" severity is wrong. Longest hyphen run in 34 MB of corpus is 113 characters; `-{2,}` cannot cross a newline; a realistic 1 MB ASCII-table document costs ~390 ms per pattern. Requires tens of thousands of hyphens contiguous on one line. Real regex defect, negligible exposure, on a synchronous paste path.

---

### Tier 3 — lost answers

**L1. One mid-body "table of contents" mention suppresses 338 of hr1865's 897 sections** — FIXED 2026-08-10, CLAUDE.md item 71 — *largest single loss; I re-derived this myself*
`app/parse/bill.js:73` `RE_TOC_ANNOUNCE = /table\s+of\s+contents/i`, `:233` sets `inToc` on any line, `:145` then gates `RE_SECTION_LOOSE` on `!inToc`.

- **Repro (offset-preserving, verified this session):** hr1865-116-enr @198407 contains a *clerical amendment* — `…and (2) in the table of contents of that Act, by striking the part heading for part B of title IV…`. Replacing that phrase with an equal-length string: **sections 559 → 897, 338 regained, 0 of them flush-left** (i.e. none is a table-of-contents entry; all 338 are real indented appropriations headings).
- **Wrong:** 338 provisions get no section head, no `#sec-N` anchor, no jump-menu entry. Worse, `sectionAt(bill, 403626)` reports "Sec. 310 @198195" for a paragraph whose real section is "Sec. 792 @403586" — **205 KB earlier** — so every "section N of this Act" reference in that stretch resolves against the wrong section. Suppression runs 198,592 → 882,756 (684 KB).
- **Right:** the announce test should require the line to actually announce a table, or be gated to front matter. Nothing resets `inToc` here because in an appropriations division the next non-caps line is a lowercase account heading and `realBodyFollows` returns false.
- **Frequency:** 101 mid-body mentions across 20 of 26 bills; this is the one that lands, and it lands on the Consolidated Appropriations Act, 2020.

**L2. A navigation LIST scopes the operation to its last member only** — PARTLY FIXED 2026-08-10, CLAUDE.md item 73 (first member now scopes; scoping to a SET is still open, with L3) — `extractSteps` sets `current = resolved.addresses[0].levels` under a comment saying "Only the first address of a list advances the cursor", but `emit()` pushes **every** address into `steps` and `scopeOps()` binds the op to the last one. `in subsections (a) through (i), by striking … each place it appears` → scope `(i)`: nine subsections named, one marked. **95 list-member steps, 139 ops, 13 bills.** Reader consequence driven end to end (hr6395 §924 / 10 U.S.C. 9063): the app draws a chip for subsection (a), the reader clicks it, the operand is visibly present, nothing is marked, and the panel prints "⚠ not found verbatim".

**L3. "Each place it appears" never crosses a node** — `app/ui/redline.js` sets `op.done = true` after the first passage the strike lands in, while `render-context.js` builds one redline per provision and calls `apply()` per node. So `all` can only ever widen *within* one node. hr5376 §13903(b)(1) on 26 U.S.C. 461(l)(1): both (A) and (B) contain "January 1, 2027"; one mark drawn. **10 strikes corpus-wide where the operand is in more than one in-scope node** — worst is 7 U.S.C. 136w-8, operand present in **10 nodes, one mark**. The fix must be scoped to `all` only: `op.done` deliberately prevents double-drawing, and `atEnd` should stay latched.

**L4. `REDESIG_LIST` omits "subclause" and "subitem"** — FIXED 2026-08-10, CLAUDE.md item 74 — `app/parse/citations.js:1227` (confirmed). `redesignating subclause (III) as subclause (IV)` produces **no op**; the same sentence with "clause" works. Written vs produced across the corpus: subsection 300/235, paragraph 474/328, subparagraph 340/239, clause 144/118, item 3/2, **subclause 45/0**, subitem 0/0. All 45 are real instructions in 8 bills. `UNIT_DEPTH` already lists both and item 39 already built the consumer — the shape is supported everywhere except this alternation.

**L5. Only the first amendment beginning in a rendered paragraph gets a block** — FIXED 2026-08-10, CLAUDE.md item 79 — `app/ui/render-bill.js:187` `amendments.find(…)` (confirmed). Any later amendment starting in the same paragraph contributes no `▸ amends …` tag and no op chips. **6 lost blocks in 8,451 amendments across 3 of 30 bills** (hjres31 29/27, hr1865 332/329, hr2617 843/842), all the appropriations proviso-chain shape item 2 taught `AMEND_BOUNDARY` to see. `rendertest.mjs:271` already asserts this identity exactly — **it just runs on one fixture where amendments never share a paragraph.** Correction to the original report: the redline is *not* unreachable; `amendmentFor()` still links the target chip back. What is lost is the announcement.

**L6. A whole-section rewrite can essentially never be reported "already in force"** — FIXED 2026-08-10, CLAUDE.md item 74 — `app/ui/redline.js:822` applies `figures(s) = s.match(/\d[\d,.]*/g)` to the whole block, which for a whole-section rewrite includes the `6102` of its own `SEC. 6102.` caption, and a section number never appears in the provision body. **106 whole-section replacement ops, 105 open "SEC. N."; 68 pass the word test at ≥0.95 and all 68 fail the figure test; 38 pass once the caption line is excluded.** Verified: 20 U.S.C. 7402 word share 0.977, sole missing figure "6102", provision reads the block verbatim. Item 63's guard is right; it needs to skip the caption line the same way `BLOCK_OPENERS` is already stripped before the word test. **Safe direction** — a weaker true sentence, never a false one — which is why it has been invisible.

**L7. `RE_USC_LONG` has no hyphen in its section pattern** — FIXED 2026-08-10, CLAUDE.md item 74 — `app/parse/citations.js:43` (confirmed). `Section 949p-4 of title 10, United States Code, is amended` produces **no citation of any kind** and therefore no target, so the pane reports the bill changes nothing. `RE_USC` twenty lines above already carries `(\d+[A-Za-z]*(?:[–—-]\s*\d+[A-Za-z]*)?)` with a comment explaining exactly this. **0 of the corpus's 3,540 long-form citations has a hyphenated section** — but the form is written almost entirely for positive-law titles (t10 772, t49 522, t18 248), and `data/usc/t10.idx.json` holds `s949p_1`…`s949p_7`.

**L8. "Each place it appears" is read in a fixed 60-character window** — `const after = text.slice(op.end, op.end + 60)`. Whether the flag is set depends on the continuation indent: `all=true` at 4 and 8 spaces, `false` at 12, 16, 20. **3 real corpus occurrences, not the 10 first reported** (the original gap filter chained across the following instruction, where the phrase belongs to a later strike that does get the flag), and **0 demonstrated reader-visible cost** — driven node-by-node, none of the three changes a mark. Latent robustness defect with a clean repro.

**L9. A second navigation step after a comma is read as a bare reference** — `isInstructionPosition` excludes the comma deliberately (a bare unit reference after a comma is usually a mention), so `in subsection (l), in paragraph (3), by inserting …` scopes the op to `(l)`. **1 genuine instance in 34 MB** (hr2 amending 7 U.S.C. 7333(l)(3)) against 4,403 `in <unit> (m), by <verb>` mentions the guard protects. **The "wrong-provision" severity does not hold:** both anchors occur exactly once in the whole of (l), so the mark lands in (l)(3) anyway. Latent widened scope only.

---

### Tier 4 — cosmetic

**C1. A citation overrunning a rendered paragraph boundary spills body text into the paragraph that starts it** — a citation is drawn whole by the paragraph that *starts* it (the "one chip per citation" invariant), so hr4173 @622376 renders `p.sec-head` as "…SEC. 376. SECURITIES EXCHANGE ACT OF 1934. The Securities Exchange Act of 1934" and the next paragraph begins " (15 U.S.C. 78a et seq.) is amended--". **12 overrun paragraphs across 8 of 30 bills; 2 leave the following paragraph rendering a lone "."; 2 corrupt a section heading.** No text lost or duplicated; 0 located internal references land in the vanished prefix.
**Worth more than the cosmetic label:** the same mechanism makes rendertest's *"rendered text preserves the source exactly"* identity **false on 4 of the 30 plain-text bills** (hr6395 +2, hr3590 +2, hr2617 +1, hr3734 +1 characters). It passes today only because it runs on one fixture. Note the hr4173 instance is downstream of W13.

---

## 2. What each campaign actually covered

| | Method | Sample | Findings | Yield |
|---|---|---|---|---|
| **C1** | Mutation fuzz + property assertions | 2,150 cases, 80 seeds, 31 bases, 34 operators | 5 | 4 came from **undamaged** text |
| **C2** | Synthetic bills with ground truth by construction | 2,850 bills, seeds 300000–840049 | 5 | 2 have 0 corpus incidence |
| **C3** | Metamorphic transformation of real bills | 6 families, deterministic (no seeds), 26 bills | 6 (1 rejected) | highest severity density |
| **C4** | Hand-authored adversarial text against named guards | ~20 bills | 7 | **7 for 7 accepted** |
| **C5** | Uniform random sampling of real output, hand-read | 110 items, seed 8675309 | 7 (1 rejected) | 4 tier-1 defects |

**Campaign 1 — broad, and the breadth bought almost nothing.** 2,150 mutation cases across 34 operators produced **0 throws, 0 crashes, 0 hangs**, and four of its five findings were found on *undamaged* corpus text. The mutation half is a strong negative result about robustness (NUL bytes, lone surrogates, astral characters, 500-deep paren bombs, whole-bill reversal, bill splicing — nothing broke; 694,237 citation spans and 191,624 op spans all round-tripped) and produced essentially no correctness findings. Its real value was elsewhere: **running rendertest's own identities over all 31 bills instead of one fixture** (which is where L5 and C1 came from), and four genuinely clean metamorphic negatives — quote-convention offset invariance (0 divergences), forward-reading independence (93 cuts, 0 changes), determinism (0 differences), and citation-overlap (0 in 81,745).

**Campaign 2 — large case count, narrow relevance.** 2,850 generated bills sounds like heavy coverage; it is coverage of *shapes the generator writes*. The generator's own author flagged that L9 is "a generator artefact rather than a pattern" (43 of 44 scope failures in one early run, 1 real instance in 34 MB), and two of five findings (W16, L7) have **zero corpus incidence**. The one live defect it found (W11) came not from the 2,850 random bills but from the **exhaustive enumeration** of 52 doubled-letter marker styles — a 52-case exercise. Its clean results are worth having and are genuinely strong where they rest on exhaustion (marker styles below item level 34/34, inserted-law composition 1,756/1,756, whole-provision replacements 8/8), and weak where they rest on the generator (wrapping invariance 1,730/1,750 is real, but on synthetic instructions).

**Campaign 3 — best severity-per-case in the automated set.** Six deterministic transformation families over 26 real bills produced three tier-1 defects (W2, W10, W16) and two lost answers. No seeds, because nothing is random — the space is the cross product, which is honest. Its strongest clean result is **re-wrapping: over 10 bills and ~9,600 composed addresses, at columns 72 and 100, the number of composed addresses that CHANGED was 0** — items 24 and 55 hold. Two self-corrections in its own writeup are the most useful methodological content in the whole pool (measuring the redline over flattened section text instead of per node; a straight-quote transform that repeats the opener on every paragraph models no real source). Note its biggest finding, W2, was discovered **by accident** when its harness misclassified an amendment — not by any of the six designed transformations.

**Campaign 4 — smallest sample, highest yield, and that should be uncomfortable.** ~20 hand-authored bills, **7 findings, 7 accepted, 0 rejected**, including the largest lost answer in the pool (L1). Reading the source and writing text to defeat a named guard beat 5,000 generated cases. This is not assurance about anything — 20 cases explore nothing — but it is strong evidence about *where to spend the next hour*. Its "notFound" list is also the most valuable negative in the pool because it names six **latent** hazards with 0 corpus occurrences (wrapped anaphor prefix, `RE_HEADING_REWRITE`'s 140-character window, a table-of-sections item claimed as a whole-section rewrite, `stealsMarker` admitting "as"/"of", the reverse direction of `isWrappedMarkerLine`, `unitPairs()` describing "(1) through (3) and (7)" as the range (1)–(7)).

**Campaign 5 — the most informative, and its sample sizes are tiny.** It enumerated populations exhaustively (14,423 composed addresses, 2,391 inserted-law addresses, 11,167 Act citations, 1,756 drawn additions, 806 replacements) and then **hand-read 110 of them**. Every one of its four tier-1 findings was invisible to spans, scopes, marker paths and counts, and none moves `opSpans` — CLAUDE.md's "counts are not enough" rule producing five defects in one pass.
**Be blunt about the n's.** Its per-population error rates rest on 8–20 items each. "0/20 inserted-law addresses wrong" has a 95% upper bound of about 14% — it is encouraging, not proof. "0/10 already-in-force claims wrong" is weaker still. The populations where it found nothing (Act resolution 0/14, Public Law 0/12) are the least-covered claims in this report, and should not be read as clearance.

**What no campaign reached at all:**
- **CFR resolution** (live eCFR) — untouched by all five.
- **`export.js` and `share.js`** — untouched.
- **The PDF path** beyond incidental inclusion as fuzz bases; no campaign read a PDF bill's redline.
- **A real browser.** Every render check ran under linkedom. CLAUDE.md item 11 says to screenshot after any UI change and before believing a metric; five campaigns produced 27 defects, several of them purely visual in consequence (W5's duplicated subsection on one screen, W1's self-contradictory card, C1's corrupted `.sec-head`), and **nobody looked at the screen**. That is the same gap item 11 was written to close.
- **The decline populations**, except partially by C4. Item 49's lesson — sample what the guards refuse, not what they accept — was applied inconsistently across the five.
- **Pending bills.** See §4; this is the structural one.

---

## 3. Rejected findings, and corrected claims

### Rejected outright (2)

**R1 — "Every character budget is calibrated to govinfo's 72-column layout" (C3-F6).** Rejected. The transforms that produce it (add 4 spaces to every indented line; re-wrap at column 100) are mechanical mutations of one source's typography, not another source's output — and the two transforms that *do* model a real alternative source (GPO doubled-singles, curly doubles) came out exactly invariant. The reported outcome is *fewer* ops/steps/refs, i.e. declines, which this project prefers to wrong answers; no wrong output is demonstrated anywhere in the entry. And it is not distinct: the two budgets with a real wrong-output consequence are already W10 (`RE_INSERT`'s 400) and L8 (`placeOps`' 60), and `MAX_AMEND_BODY`'s wrong-answer face is W2/W4. The residue is documented in CLAUDE.md with the bug each budget exists to prevent. The campaign itself ranked it last and labelled it an observation.

**R2 — "The bill states the U.S.C. section in the parenthetical and the head-of-Act fallback does not use it" (C5-F6).** Rejected as a defect; accepted as an enhancement. The population is real (4,489 checked, 272 disagree, 24 where our section lacks the subsection), but **the pane does not present a wrong provision.** Rendered through the real `renderContext`, "section 9101(26) of the Elementary and Secondary Education Act of 1965" gives *"Whole Act — This looks like the entire law, not a single provision. Shown below is its first section"* over 20 U.S.C. 6301, which genuinely **is** ESEA §1001 — so that sentence is true, unlike the NDAA case in W7, which is why one was accepted and this rejected. The claimed extra harm is absent: grepping the rendered DOM for the "no such paragraph / renumbered or repealed" caveat returns nothing. **The "20 U.S.C. 6301(26)" string in the report is the measurement script's own formatting**, not anything the pane displays. For two of the three named examples the pane goes further and prints a "Numbering caveat" card telling the reader to use the parenthetical — which is itself a correct chip beside it. The 24th case (hjres31 → 25 U.S.C. 2505(f)) is the app correctly following the Code's own source credit, states its derivation in prose, and hedges the missing subsection.

### Accepted but with the reported claim corrected — do not repeat these

| Claim as reported | Correction |
|---|---|
| W13: "8 malformed entries produce a wrong Act" | **1** produces a wrong provision; the other 7 resolve to the correct Act and are span overreach |
| L5: "the redline is unreachable from any control" | `amendmentFor()` still links the target chip back; what is lost is the announcement |
| W14: "the redline draws it inside (A)" | Nothing is drawn in either arm; the wrong scope is in the reported data only |
| R0: severity "crash" | Nothing crashes, nothing is mis-answered, no realistic document triggers it |
| W11: headline case hr6201 / 42 U.S.C. 1395l | Real output bug, **not caused by this defect** — (b) survives either depth reading. hr5376 is the instance that was missed |
| L9: severity "wrong provision" | The anchors are unique in the wider scope; the mark lands correctly. Latent only |
| L8: "10 real strikes across 4 bills" | **3**, in 2 bills; the gap filter chained across a following instruction. And 0 demonstrated mark change |
| W2: "509 instructions read past their section" | 2,853 bodies end past their section; the defensible reader-facing number is 550 composed citations / 296 real wrong provisions |
| W7: "NDAA only" | Same shape confirmed on the IRA and IIJA entries |

Two measurement caveats to carry forward: W6's 188 is an **upper bound** (plain containment can be satisfied by a coincidental occurrence elsewhere in the node), and W2's frequency must be measured via `viaAmendment` with the head required to sit inside a parsed section, because `parseBill` misses run-in appropriations heads and position-based attribution overcounts.

---

## 4. The single most valuable next campaign

**Build a pending-bill corpus and re-run the enacted/pending guards against it.**

Every one of the five campaigns drew from the same 26 enrolled bills plus 4 fixtures. **All of them are enacted.** That is a shared blind spot in exactly the dimension this app's hardest machinery operates in, and it is already producing false negatives you can name:

- **W15 could not be shown on real data at all** — `rewriteInForce()` is structurally broken for a deletion-only rewrite, and all 422 in-force claims in the corpus come from enacted bills whose rewrites really did happen. C5 hand-read 10 of them and found 10 correct, which is true and tells you nothing about the pending case.
- **W5 (777 additions), W6 (188 inserts), L3, L6 and the whole `was` / `ins` / `keep` distinction** are guards whose only job is to separate "this already happened" from "this will happen". Every corpus case exercises one branch.
- CLAUDE.md itself states the expected split — "~75% of a pending bill's amendments and ~20% of an enacted one's" — and **no campaign has ever measured the 75% side.**
- The corpus is deliberately parse-only and blind to resolution, so it cannot see any of this even in principle.

**Concrete design.** Take 15–20 bills as *introduced* or *reported* from the current Congress (not enrolled), spanning the shapes that matter: one tax bill, one appropriations bill, one authorisation, one omnibus, one short single-purpose bill, and at least one PDF-sourced print so the doubled-single convention is exercised. Then:

1. Run `tools/coverage.mjs` and split its single number the way item 44 split the internal-reference counter — drawn-as-pending / drawn-as-already-in-force / withheld-as-stale / declined / unplaced — per bill. On a pending corpus the in-force column should be **near zero**, and every non-zero entry is a candidate W15.
2. Hand-read a stratified sample of the `was` and `.node.was-added` marks specifically. On enacted bills those are usually right; on pending bills each one is a claim that the bill has already taken effect, which is false by construction.
3. Sample the **declines** as well as the accepts (item 49's rule, applied consistently this time — C5 sampled 8 withheld replacements out of 381).
4. Add a second, cheaper axis while you are there: **paste-path realism.** W16 has zero shipped incidence purely because no fixture uses straight quotes. Feed two of the pending bills through the shapes a human actually pastes — Congress.gov HTML, a word-processor round trip, a PDF copy-paste — and re-run. That is one afternoon and it converts W16 from a theoretical hole in a tracked invariant into a measured one, or retires it.

**Runner-up, if the pending corpus is too much work to assemble:** open a browser. Item 11 says the tooling reaches `localhost:8000` and that the first screenshot ever taken found an entire chain of bugs in two minutes. Five campaigns, 27 defects, and every render check ran under linkedom. W5 renders subsection (d) **twice on one screen**, W1 renders a card that contradicts itself, and C1 corrupts a section heading — three defects whose severity is a matter of what the page looks like, verified by nobody looking at the page.

**Not worth doing next:** more mutation fuzzing. C1 ran 2,150 cases across 34 operators and 80 seeds and found zero crashes, zero span-integrity failures and zero correctness bugs from the mutations themselves. That space is covered.
---

## Status, 2026-08-10 — W5, W1 fixed; W3 measured and scoped

Two of the 27 fixed and pushed today, each with the withdrawal audit this repo
requires. CLAUDE.md items 67 and 68 carry the reasoning; this section records
what the next pass needs and, for W3, the measurement so it does not have to be
re-derived.

### Done

- **W5** — `alreadyIn()` ran against a heading-stripped haystack. Fixed by
  giving `createRedline` the provision in BOTH renderings, because the heading
  is on one side or the other: flattening alone missed 877 additions the law
  contains, heading-inline alone missed 14 the other way. Positive evidence asks
  every rendering; `stale` asks only the first, because a caption hit destroys
  negative evidence (22 amendments rescued from staleness, 15 of them captions).
  Additions already in the law 782 → 1,659. Commit `2a4871cc2`.
- **A second defect W5 exposed**, found by looking at the screen once W5 was
  fixed: `appliedNodePaths()` skipped any op whose `scope` was not a string, so
  256 enacted additions could never mark the provision they created — and
  lifting that guard alone would have added 451 correct marks and 2,334 wrong
  ones, because the function read EVERY line-head marker in the block. Only the
  block's top level is claimed now, via `parseProvision()`. Marks 1,689 → 1,865;
  all 105 withdrawn are the op's own anchor or an interior cross-reference.
- **W1** — `at the end of paragraph (N)`. The unit is captured now, in BOTH the
  named-mark form (`PUNCT_UNIT_TAIL`) and the quoted form (`RE_AT_THE_END`), and
  composed by `scopeStatedUnits()` the way `scopeReplacements()` composes a
  stated address. 161 marks withdrawn, every one outside the provision the bill
  named; 8 moved, every one into it; 0 gained. Commit `4a22f2219`.
- **A misleading message W1 exposed**: `op.found` is printed as "✓ found in
  current text" on a strike the redline did NOT draw, and was a substring test
  against the whole provision. It asks the op's own scope now; 1,267 ticks fall
  to 390 true ones.

The quoted half of W1 was found by RENDERING the example W1's own report names,
not by measuring — item 60's rule, and it paid twice today.

### W3, BUILT 2026-08-10 — see CLAUDE.md item 69

Both halves shipped together, as the note below said they had to be. 276
composed addresses retargeted (227 of them now reaching a real node against 55
before) and 447 operations refused rather than drawn on the wrong provision:
16 marks withdrawn, every one outside the provision the bill named, 2 moved
into it, 0 gained. The measurement that follows is what the build was sized
from; it is kept because the *shape* of it is the reusable part.

One thing it got wrong, worth keeping visible: the plan was to record the
section move on the side and tag the steps after it. `scopeOps()` consults
steps, so an instruction that walks into a section and then changes something
without navigating again kept the head's base — 174 of the 447 — and only
rendering the panel showed it. The move is emitted as a step now.

#### The measurement

`UNIT_WORDS` has no "section", so `RE_NAV` cannot fire on
`in section 599D (8 U.S.C. 1157 note)--` and everything after it composes onto
the amendment's target, which is a different section.

Narrowed to the subset that needs no inference — the bill writes the Code
address itself and the phrase opens a sub-instruction (a dash, or a comma before
an amendatory verb):

```
215 sites   of which 22 name a note (not section N) and 10 are already the target
132 sites with something after them
    377 navigation steps and 295 references composed on the WRONG section
  1054 operations sit after such a phrase
```

Concentrated: hr4173 (Dodd-Frank) 118, hr2617 28, hr3734 23, hr6395 12. The
shape, from H.R. 748:

```
Section 292 of the Public Health Service Act … is amended--
    in section 293 (42 U.S.C. 293)--        <- navigation into a DIFFERENT section
        (A) in subsection (a), by striking …    <- composed onto 292(a)
```

**Why it was not built today, and what it needs.** The citation half is clean
and additive: give a step an optional `secTitle`/`secSection`, reset the running
path from the parenthetical's own subsection, and have `expandRelativeRefs()`
override `title`/`section` when the step carries them. 672 addresses move to the
section the bill named, and nothing is guessed — the address is written down.

The OPERATION half is what makes this bigger than W1 or W5. 1,054 ops sit after
such a phrase, and an op is drawn on the provision the pane resolved, which is
the TARGET. An op scoped to a path belonging to another section cannot be drawn
there and must be refused — which means a fourth flag through `placed()`, the
invariant this file records as having broken five separate times, plus its own
withdrawal audit and a `coverage.mjs` bucket so a deliberate refusal is not
counted as "not on screen". Do the two halves together or the pane will show a
chip naming 42 U.S.C. 293(a) beside a mark drawn in 292.

Two guards to carry over from today's work:

- **A note is not the section.** 22 of the 215 write `(8 U.S.C. 1157 note)`, and
  a note is uncodified law printed beneath a section — item 14's rule. Skip
  them; they keep the Act-relative path they already have.
- **The phrase must open a sub-instruction.** A bare `in section N` with no
  parenthetical is 293 further sites, and most are not navigation at all —
  "as defined in section 1245(a)(3)", "described in section 163(j)(2)" — sitting
  inside quoted operands and definitions. The dash-or-verb requirement and
  `isInstructionPosition` together are what separate them.

### Still unfixed

W6–10, W13, W14, W16, L3, L5, L8, L9, C1 — 15 of the 27 open (W1–W5, W11, W12, L1, L4, L6, L7 done; L2 partly; W15 declined). W2 remains the largest by count (550
citations across a real section boundary) and carries its own trap, recorded in
its section above: attribute via `viaAmendment` and require the head to sit
inside a parsed section, because positional attribution overcounts wherever
`parseBill` misses a bare `Sec. 401.` run-in head.

---

## Status, 2026-08-10 (second pass) — 12 of the 27 closed

Nine defects fixed, one measured and declined, one partly fixed. CLAUDE.md items
69–74 carry the reasoning and the audits; this is the index.

```
  W1  fixed  item 68   at the end of paragraph (N)
  W2  fixed  item 70   an instruction stops at its own bill section
  W3  fixed  item 69   in section N (T U.S.C. S) is navigation
  W4  fixed  item 66   an effective-date clause is not a Code address
  W5  fixed  item 67   the heading is inside the 80-character window
  W11 fixed  item 72   (cc) is the alphabet past (z)
  W12 fixed  item 72   newSection unread for a replace op
  W15 DECLINED item 74 symmetric containment costs 42 true claims for 0 false
  L1  fixed  item 71   a mention of a table of contents is not an announcement
  L2  partly item 73   the first list member scopes; scoping to a SET is open
  L4  fixed  item 74   REDESIG_LIST omitted subclause and subitem
  L6  fixed  item 74   a whole-section rewrite's caption broke the figure guard
  L7  fixed  item 74   RE_USC_LONG had no hyphen
```

**Still open: W6–W10, W13, W14, W16, L3, L5, L8, L9, C1 — 14, plus L2's other
half.** Nothing in the list above changed their measurements.

Two entangled pairs worth doing together rather than serially:

- **L2's remaining half with L3.** An instruction naming nine subsections still
  marks one, and `each place it appears` latches `op.done` after the first
  passage so `all` cannot cross a node either. Both want `inScope()` to take a
  SET, and `reScope()`, `scopeAdditions()` and the panel's messages all read
  `op.scope` as a string today.
- **W16 with the paste path.** Adding `"` to `RE_QUOTE_CLOSE` is not sufficient
  alone — with a symmetric delimiter the opening line of a multi-paragraph block
  also closes it, so the state machine has to become pair-aware the way
  `quotedBlocks()` in outline.js already is. 0 shipped incidence; the exposure is
  `ingest()`.

**Two things to carry into any of them**, both learned the hard way today:

- **A measurement script that calls `extractAmendments(text, cites)` measures a
  parse the app does not run.** Two of mine did, and reported "0 changed" for a
  change that moved 644 addresses. Pass `parsed.divisions, parsed.sections`.
  `proptest.mjs` P11 catches the same omission in the app: 1,325 violations under
  the two-argument call.
- **Render the named example.** It paid twice more today. W3's first cut recorded
  the section move on the side instead of emitting a step, and twelve of the
  thirteen rows on screen were right; the thirteenth is what showed it. Every
  count was green.


---

## Status, 2026-08-10 (third pass) — 19 of the 27 closed

Seven more fixed. CLAUDE.md items 75–79 carry the reasoning and the audits.

```
  W6  fixed  item 75   a replacement the law already made is not pending
  W7  fixed  item 78   an Act with no head must not be given one
  W8  fixed  item 76   a block opener need not begin the line
  W9  fixed  item 76   a marker followed by "of section" is not a provision
  W10 fixed  item 77   an operand budget that re-matches instead of truncating
  W13 fixed  item 78   a harvested name that runs into its own sentence
  L5  fixed  item 79   every amendment beginning in a paragraph announces itself
```

**Still open: W14, W16, L3, L8, L9, C1 — 6, plus L2's other half.**

Ranked by what they cost a reader:

- **C1** is labelled cosmetic and is worth more than that: the same mechanism
  makes rendertest's "rendered text preserves the source exactly" identity FALSE
  on 4 of 30 plain-text bills. It passes today only because it runs on one
  fixture. 12 overrun paragraphs across 8 bills; 2 corrupt a section heading.
- **L2's remaining half with L3**, still entangled and still wanting `inScope()`
  to take a SET — `reScope()`, `scopeAdditions()` and the panel all read
  `op.scope` as a string.
- **W16 with the paste path**: adding `"` to `RE_QUOTE_CLOSE` alone is not
  enough, because with a symmetric delimiter the opening line of a
  multi-paragraph block also closes it. The state machine has to become
  pair-aware the way `quotedBlocks()` already is. 0 shipped incidence.
- **W14** is one site in 34 MB — an unbalanced quote in the govinfo rendition of
  Pub. L. 107-56 — and nothing is drawn from it today.
- **L8** and **L9** are latent: measured at 3 and 1 occurrences with 0
  demonstrated reader-visible cost.

**Three things to carry into any of them**, on top of the two the second pass
recorded:

- **Audit what a change WITHDRAWS, and classify it rather than sampling it.**
  W8 withdrew 58 answers; splitting them into "answered from the bill's own
  drafting instructions" (31) and "answered from a sibling quoted block" (27)
  is what made the trade decidable. A count of 58 says nothing either way.
- **A geometric test beats a textual one where position is the evidence.** W6's
  first cut asked whether the new phrase sat at one END of the struck span,
  which fires on any insert sharing a word with the operand — and it withdrew
  BOTH marks, which is worse than the bug it fixed. Requiring the phrase to span
  the struck words and reach past them cannot be fooled that way.
- **The corpus is blind to a span REPLACEMENT.** `opSpans` is the size of a
  `type:start-end` key set, so W10's 14 corrected spans moved it by zero. Diff
  the keys, not the count.
