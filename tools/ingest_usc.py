#!/usr/bin/env python3
"""Ingest U.S. Code titles into static JSON shards for Bill Companion.

There is no CORS-open API for the U.S. Code, so the site reads the Code from
pre-generated files instead. This script pulls the official USLM XML release
points from uscode.house.gov and writes one JSON file per section:

    data/usc/t42/s7401.json

A lookup in the browser is then a single static GET with no index to load first,
which is what keeps the context pane responsive.

Usage
-----
    python tools/ingest_usc.py --titles 42            # one title
    python tools/ingest_usc.py --titles 42,26,29      # several
    python tools/ingest_usc.py --titles common        # a useful default set
    python tools/ingest_usc.py --titles all           # everything (~1.5 GB, slow)

Titles already present are skipped unless --force is given.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

USLM = "{http://xml.house.gov/schemas/uslm/1.0}"
BASE = "https://uscode.house.gov/download"
DOWNLOAD_PAGE = f"{BASE}/download.shtml"

# Titles that federal bills amend most often — a pragmatic default that keeps the
# download to a few hundred MB instead of ~1.5 GB.
COMMON = ["5", "7", "10", "12", "15", "16", "18", "20", "21", "26", "29", "31", "33", "38", "42", "47", "49"]

ALL_TITLES = [str(n) for n in range(1, 55) if n != 53]  # title 53 is unassigned

# USLM level elements, outermost first. Anything not listed is not a rung on the
# subsection ladder (content, chapeau, notes, sourceCredit, ...).
LEVELS = ["subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem", "subsubitem"]
LEVEL_TAGS = {f"{USLM}{name}" for name in LEVELS}

# Container elements that give a section its place in the title.
ANCESTOR_TAGS = {"title", "subtitle", "chapter", "subchapter", "part", "subpart", "division"}

SKIP_IN_TEXT = {"notes", "note", "sourceCredit", "editorialNotes", "num", "heading"}


def log(msg: str) -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------- io
def fetch(url: str, tries: int = 3) -> bytes:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bill-companion-ingest/1.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - retry any transport failure
            last = exc
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def latest_release() -> str:
    """Scrape the download page for the newest release point, e.g. '119/102'."""
    try:
        html = fetch(DOWNLOAD_PAGE).decode("utf-8", "replace")
        found = re.findall(r"releasepoints/us/pl/(\d+)/(\d+[a-zA-Z0-9]*)", html)
        if found:
            congress, law = found[-1]
            return f"{congress}/{law}"
    except Exception as exc:  # noqa: BLE001
        log(f"  ! could not auto-detect release point ({exc}); using fallback")
    return "119/102"


# ------------------------------------------------------------------- xml utils
def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def itertext_clean(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def body_text(el: ET.Element) -> str:
    """Text belonging to this level only: excludes nested levels, notes, labels."""
    parts: list[str] = []
    if el.text:
        parts.append(el.text)

    def walk(node: ET.Element) -> None:
        for child in node:
            name = local(child.tag)
            if name in SKIP_IN_TEXT or child.tag in LEVEL_TAGS:
                if child.tail:
                    parts.append(child.tail)
                continue
            if child.text:
                parts.append(child.text)
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(el)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def marker_of(el: ET.Element) -> str:
    num = el.find(f"{USLM}num")
    if num is None:
        return ""
    raw = itertext_clean(num)
    m = re.search(r"\(([A-Za-z0-9]+)\)", raw)
    if m:
        return f"({m.group(1)})"
    val = num.get("value")
    return f"({val})" if val else raw


def heading_of(el: ET.Element) -> str:
    return itertext_clean(el.find(f"{USLM}heading"))


def build_nodes(parent: ET.Element, path: str = "") -> list[dict]:
    """Turn nested USLM level elements into the tree the front end renders."""
    out = []
    for child in parent:
        if child.tag not in LEVEL_TAGS:
            continue
        marker = marker_of(child)
        node_path = path + marker
        out.append(
            {
                "marker": marker,
                "path": node_path,
                "heading": heading_of(child),
                "text": body_text(child),
                "children": build_nodes(child, node_path),
            }
        )
    return out


def section_number(el: ET.Element) -> str:
    m = re.search(r"/s([^/]+)$", el.get("identifier") or "")
    if m:
        return m.group(1)
    num = el.find(f"{USLM}num")
    if num is not None and num.get("value"):
        return num.get("value")
    return ""


def slug(section: str) -> str:
    # Collapse every non-alphanumeric to "_". USLM spells dashed section numbers
    # with an EN DASH ("77z-3"); bills cite them with an ASCII hyphen ("77z-3").
    # Both must land on the same filename or the browser looks up a shard that
    # was written under the other spelling. Keep in step with slug() in
    # app/resolve/usc.js.
    return re.sub(r"[^a-z0-9]", "_", section.lower())


# ------------------------------------------- Act section -> Code section index
#
# An Act's own section numbers are usually NOT its codified ones: Social Security
# Act § 1861 is 42 U.S.C. 1395x, PHSA § 330 is 42 U.S.C. 254b. Bills cite the Act
# number constantly, so without a mapping "Section 1861 of the Social Security
# Act" resolves only to the head of the Act and the real provision is unreachable.
#
# The mapping does not need to be invented or downloaded: it is already in every
# shard. USLM carries a <sourceCredit>, whose FIRST clause is the enacting credit
# and names both the Act and the section number that Act gave the provision:
#
#   42 U.S.C. 1395x -> "(Aug. 14, 1935, ch. 531, title XVIII, § 1861, as added …)"
#   42 U.S.C. 254b  -> "(July 1, 1944, ch. 373, title III, § 330, as added …)"
#   20 U.S.C. 6301  -> "(Pub. L. 89–10, title I, § 1001, as added …)"
#
# Only the first clause. What follows a ';' is a later *amending* act, and reading
# those would file the section under whichever law last touched it.
ACT_DATE_CH = re.compile(r"^\(\s*([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4},\s+ch\.\s+\d+[A-Za-z]?)")
ACT_PUBLAW = re.compile(r"^\(\s*(Pub\.\s*L\.\s*\d+[-–—]\d+)")
# The bracketed form is a fourth way a credit states the Act-relative number,
# and reading only the outer one collapses a whole Act onto a single key.
#
#     15 U.S.C. 636 -> "(Pub. L. 85-536, § 2[7], July 18, 1958, 72 Stat. 387; ...)"
#
# The Small Business Act *is* section 2 of Pub. L. 85-536, so the OLRC writes
# the Act's own section 7 as "§ 2[7]". Taking the "2" filed every SBA section
# under one number, where they all collided and were dropped as ambiguous —
# which is why the Act had no index at all. Checked against provisions anyone
# can verify: SBA § 7 is 15 U.S.C. 636 (the 7(a) loan program), SBA § 8 is
# 15 U.S.C. 637 (the 8(a) program), FDIA § 3 is 12 U.S.C. 1813 (Definitions).
# 130 sections carry it.
ACT_SECNUM = re.compile(r"§{1,2}\s*([0-9][0-9A-Za-z.\-–—]*)(?:\[([0-9][0-9A-Za-z.\-–—]*)\])?")


def act_slug(name: str) -> str:
    """Filename for an Act key. Runs of punctuation collapse to ONE underscore,
    unlike slug() above which maps each character — "Pub. L. 89–10" has to reach
    the same name from the EN DASH the Code uses and the ASCII hyphen a bill
    writes. Keep in step with actSlug() in app/resolve/act-sections.js."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def act_origin(source_credit: str) -> tuple[str, str] | None:
    """(Act as enacted, section number that Act gave it), or None.

    Returns the Act exactly as the credit spells it, so the popular-names table
    can be written to match what is actually in the data.

    The FIRST section number in the enacting clause is the current one. Every
    other § in that clause is either historical or belongs to a different law,
    and the credits are consistent about the order:

        § 931, formerly § 944                                      -> 931
        § 1866E, formerly § 1866D, as added and renumbered § 1866E -> 1866E
        § 232, formerly title V, § 502, … renumbered … § 2102      -> 232
        § 1861, as added Pub. L. 89-97, title I, § 102(a)          -> 1861

    Reading the last one instead indexed the *former* number as if it were
    current, which then collided with whichever section really holds it today —
    42 U.S.C. 210 is "§ 208, formerly § 209" and was filed under 209, colliding
    with 42 U.S.C. 210b, which actually is § 209. Both were dropped as ambiguous.
    """
    if not source_credit:
        return None
    first = source_credit.split(";")[0]
    m = ACT_DATE_CH.match(first) or ACT_PUBLAW.match(first)
    if not m:
        return None
    # "§ 1 (part)" says outright that this section is one piece of an Act section
    # split across several. There is no 1:1 answer to record, and letting the
    # pieces collide would only rediscover that as a conflict.
    if re.search(r"§\s*[0-9][^,;]*\(part\)", first):
        return None
    hit = ACT_SECNUM.search(first)
    if not hit:
        return None
    # The bracketed number when there is one, else the plain one.
    num = hit.group(2) or hit.group(1)
    return re.sub(r"\s+", " ", m.group(1)), num


def write_act_index(out_root: Path, origins: dict[str, dict[str, str]],
                    conflicts: dict[str, list[str]]) -> int:
    """One file per Act, mapping its own section numbers onto the Code's.

    One file per Act rather than one big index, for the same reason there is one
    file per section: a lookup in the browser stays a single static GET with
    nothing to load first.
    """
    adir = out_root / "acts"
    adir.mkdir(parents=True, exist_ok=True)
    # Cleared, not merged into. Everything here is derived from the shards, so a
    # file left over from an earlier build is a mapping produced by an older
    # parser with no way to tell it apart from a current one — and the first
    # rebuild after the "formerly § N" fix left ten of them behind, which is how
    # this was noticed: manifest.acts counted 2,730 writes against 2,740 files.
    # Same rule as the section manifest — the count has to describe the
    # directory, or comparing them proves nothing.
    for old in adir.glob("*.json"):
        old.unlink()
    written = 0
    for name, sections in origins.items():
        # Tombstoned entries are the ambiguous ones; they are recorded in
        # _conflicts.json and must not reach a shard, or the resolver would
        # answer an empty string for a section it cannot actually place.
        keep = {k: v for k, v in sections.items() if v}
        if not keep:
            continue
        (adir / f"{act_slug(name)}.json").write_text(
            json.dumps({"act": name, "sections": keep}, ensure_ascii=False,
                       separators=(",", ":")),
            encoding="utf-8",
        )
        written += 1
    if conflicts:
        n = sum(len(v) for v in conflicts.values())
        log(f"  ! {n} Act section(s) claimed by two Code sections - dropped, see acts/_conflicts.json")
        (adir / "_conflicts.json").write_text(json.dumps(conflicts, indent=1), encoding="utf-8")
    return written


def scan_shards_for_origins(out_root: Path) -> tuple[dict, dict]:
    """Rebuild the Act index from shards already on disk (--acts-only).

    Slower than a fresh ingest, because it reads 60,000 files back rather than
    taking the credit off a section that is already in memory. It exists so the
    index can be built without re-downloading 322 MB.
    """
    origins: dict[str, dict[str, str]] = {}
    conflicts: dict[str, list[str]] = {}
    # Three regexes rather than json.loads(). Fully parsing each shard rebuilds a
    # subsection tree of up to several hundred nodes to read three scalar fields,
    # and over 60,000 files that is the difference between a minute and a quarter
    # of an hour. `title` and `section` are the first two keys written.
    f_credit = re.compile(r'"sourceCredit":\s*"((?:[^"\\]|\\.)*)"')
    f_title = re.compile(r'"title":\s*"([^"]*)"')
    f_section = re.compile(r'"section":\s*"([^"]*)"')
    n = 0
    for tdir in sorted(out_root.glob("t*")):
        if not tdir.is_dir():
            continue
        for f in tdir.iterdir():
            if f.suffix != ".json":
                continue
            try:
                raw = f.read_text(encoding="utf-8")
            except OSError:
                continue
            mc = f_credit.search(raw)
            mt = f_title.search(raw)
            ms = f_section.search(raw)
            if not (mc and mt and ms):
                continue
            rec = {"title": mt.group(1), "section": ms.group(1)}
            note_origin(origins, conflicts, rec, json.loads('"' + mc.group(1) + '"'))
            n += 1
            if n % 10000 == 0:
                log(f"    …{n} shards read")
    return origins, conflicts


def note_origin(origins: dict, conflicts: dict, rec: dict, source_credit: str) -> None:
    """Record one section's Act-relative number, refusing to guess on a clash.

    Two Code sections claiming the same Act section means the Act was renumbered
    or the credit is ambiguous. Keeping either one would point a citation at a
    real but unrelated provision, which is the worst output this app has, so the
    entry is dropped and recorded instead.
    """
    origin = act_origin(source_credit)
    if not origin:
        return
    name, act_sec = origin
    where = f"{rec['title']}:{rec['section']}"
    table = origins.setdefault(name, {})
    prev = table.get(act_sec)
    if prev is None:
        table[act_sec] = where
    elif prev != where and prev != "":
        table[act_sec] = ""  # tombstone: known ambiguous, never resolved
        conflicts.setdefault(name, []).append(f"{act_sec} -> {prev} / {where}")


def ancestors_of(stack: list[ET.Element]) -> list[dict]:
    """Snapshot the open container chain. num/heading precede sections in USLM,
    so by the time a section closes these are already parsed and readable."""
    chain = []
    for el in stack:
        chain.append(
            {
                "type": local(el.tag),
                "num": itertext_clean(el.find(f"{USLM}num")),
                "heading": heading_of(el),
                "identifier": el.get("identifier", ""),
            }
        )
    return chain


# ------------------------------------------------------------------- ingestion
def is_code_section(el: ET.Element, title: str) -> bool:
    """Is this a section OF THE CODE, or one quoted inside a note?

    Statutory notes reproduce whole sections of the Acts they describe, and USLM
    marks them up with the same <section> element. Those quoted sections carry no
    `identifier` — only real Code sections get `/us/usc/t35/s1` — which is the
    only reliable way to tell them apart, since a quoted "SEC. 1. SHORT TITLE."
    is structurally identical to a real § 1.

    Accepting them was silently destroying real law. A note attached above
    section level closes at section depth 0, so the depth guard in the parse loop
    never saw it, and quoted sections are numbered from 1 — so they landed on
    exactly the filenames the title's own low-numbered sections use and
    overwrote them. `t35/s1.json` held § 1 of the Patents for Humanity Program
    Improvement Act, filed as 35 U.S.C. § 1 and captioned with the Code's own
    part and chapter. 245 sections across 12 titles were replaced this way, and
    the app reported every one of them as settled law.

    Verified before it was relied on: this test drops exactly the 2 phantoms in
    title 35 and removes nothing at all from titles 9 and 17, where every
    section already carries a proper identifier.
    """
    return (el.get("identifier") or "").startswith(f"/us/usc/t{title}/s")


def build_section(el: ET.Element, title: str, ancestors: list[dict], release: str) -> dict | None:
    if not is_code_section(el, title):
        return None
    num = section_number(el)
    if not num:
        return None

    notes = []
    for note in el.findall(f"{USLM}notes/{USLM}note"):
        text = itertext_clean(note)
        if text:
            notes.append({"topic": note.get("topic") or "note", "text": text[:1200]})

    return {
        "title": title,
        "section": num,
        "heading": heading_of(el),
        "lead": body_text(el),
        "tree": build_nodes(el),
        "notes": notes[:10],
        "sourceCredit": itertext_clean(el.find(f"{USLM}sourceCredit")),
        "releasePoint": release.replace("/", "-"),
        "ancestors": ancestors,
    }


def ingest_title(title: str, release: str, out_root: Path, force: bool) -> dict:
    tdir = out_root / f"t{title}"
    if tdir.exists() and not force:
        existing = len(list(tdir.glob("s*.json")))
        if existing:
            log(f"  title {title}: already present ({existing} sections) — skipping (--force to redo)")
            return {"sections": existing, "skipped": True}

    rp = release.replace("/", "-")
    # Release-point filenames zero-pad the title to two digits: usc01, usc05, usc42.
    padded = title.zfill(2) if title.isdigit() else title
    url = f"{BASE}/releasepoints/us/pl/{release}/xml_usc{padded}@{rp}.zip"
    log(f"  title {title}: downloading")
    try:
        blob = fetch(url)
    except RuntimeError as exc:
        log(f"  ! title {title}: {exc}")
        return {"sections": 0, "error": str(exc)}

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.endswith(".xml")]
        if not names:
            log(f"  ! title {title}: no XML in archive")
            return {"sections": 0, "error": "no xml"}
        raw = zf.read(names[0])

    log(f"  title {title}: parsing {len(raw) / 1_048_576:.0f} MB")

    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True, exist_ok=True)

    stack: list[ET.Element] = []
    section_depth = 0
    count = 0
    written: set[str] = set()
    duplicates: list[str] = []

    # Single streaming pass. Completed sections are written, cleared, and
    # detached from their parent so peak memory stays near one chapter's worth
    # rather than the whole 112 MB title.
    for event, el in ET.iterparse(io.BytesIO(raw), events=("start", "end")):
        name = local(el.tag)

        if event == "start":
            if name == "section":
                section_depth += 1
            elif name in ANCESTOR_TAGS and section_depth == 0:
                stack.append(el)
            continue

        if name == "section":
            section_depth -= 1
            # Notes embed quoted <section> elements from other acts; only a
            # section closing at depth 0 is a real Code section.
            if section_depth != 0:
                continue
            rec = build_section(el, title, ancestors_of(stack), release)
            if rec:
                name = f"s{slug(rec['section'])}.json"
                # The Code really does contain a handful of duplicate section
                # numbers — two different Public Laws each adding a "§ 3598" —
                # plus the odd combined range ("§§ 2891, 2892"). One shard per
                # number means the second wins and the first is lost. That is
                # seven sections in 60,000 and inherent to addressing sections by
                # number, but it must not be silent: this is exactly how the far
                # larger note-quoting bug hid for so long.
                if name in written:
                    duplicates.append(rec["section"])
                    # ASCII only: this script does not reconfigure stdout, and a
                    # cp1252 console cannot encode an em dash.
                    log(f"    ! duplicate section number {rec['section']} - keeping both")
                    # Both are real law. Overwriting meant 5 U.S.C. 3598 showed
                    # whichever Public Law happened to come second in the XML and
                    # the other was simply gone, with nothing on screen to say so.
                    # The later ones ride along under `also`, so the shard shape
                    # is unchanged for the other 60,429 sections and only these
                    # seven carry the extra key.
                    prior = json.loads((tdir / name).read_text(encoding="utf-8"))
                    prior.setdefault("also", []).append(rec)
                    rec = prior
                written.add(name)
                (tdir / name).write_text(
                    json.dumps(rec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
                )
                count += 1
                if count % 1000 == 0:
                    log(f"    …{count} sections")
            el.clear()
            if stack:
                try:
                    stack[-1].remove(el)
                except ValueError:
                    pass

        elif name in ANCESTOR_TAGS and section_depth == 0:
            if stack and stack[-1] is el:
                stack.pop()
            el.clear()
            if stack:
                try:
                    stack[-1].remove(el)
                except ValueError:
                    pass

    # `count` is writes; `written` is files. They differ only by the duplicates,
    # and the manifest records the file count so that comparing it against the
    # directory is a meaningful check rather than a permanent off-by-N.
    log(
        f"  title {title}: wrote {len(written)} sections"
        + (f" ({len(duplicates)} duplicate number(s): {', '.join(duplicates)})" if duplicates else "")
    )
    res = {"sections": len(written)}
    if duplicates:
        res["duplicates"] = duplicates
    return res


# ------------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--titles", default="common",
                    help="comma-separated title numbers, or 'common' or 'all' (default: common)")
    ap.add_argument("--release", default=None, help="release point like 119/102 (default: auto-detect)")
    ap.add_argument("--out", default=None, help="output dir (default: <repo>/data/usc)")
    ap.add_argument("--force", action="store_true", help="re-ingest titles already present")
    ap.add_argument("--acts-only", action="store_true",
                    help="rebuild data/usc/acts/ from shards already on disk; downloads nothing")
    args = ap.parse_args()

    if args.acts_only:
        root = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "data" / "usc"
        log(f"Rebuilding the Act index from shards in {root} (no download)")
        t0 = time.time()
        origins, conflicts = scan_shards_for_origins(root)
        n = write_act_index(root, origins, conflicts)
        # The manifest count has to follow, or `manifest.acts` describes the
        # previous build and the directory comparison stops meaning anything.
        mp = root / "manifest.json"
        if mp.exists():
            try:
                mf = json.loads(mp.read_text(encoding="utf-8"))
                mf["acts"] = n
                mp.write_text(json.dumps(mf, indent=1), encoding="utf-8")
            except json.JSONDecodeError:
                pass
        log(f"Done in {time.time() - t0:.0f}s. {n} Act(s) indexed.")
        return 0

    if args.titles == "all":
        titles = ALL_TITLES
    elif args.titles == "common":
        titles = COMMON
    else:
        titles = [t.strip() for t in args.titles.split(",") if t.strip()]

    out_root = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "data" / "usc"
    out_root.mkdir(parents=True, exist_ok=True)

    release = args.release or latest_release()
    log(f"Release point: {release}")
    log(f"Output:        {out_root}")
    log(f"Titles:        {', '.join(titles)}\n")

    manifest_path = out_root / "manifest.json"
    manifest: dict = {"releasePoint": release.replace("/", "-"), "titles": {}}
    if manifest_path.exists():
        try:
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["titles"] = prev.get("titles", {})
        except json.JSONDecodeError:
            pass

    started = time.time()
    for t in titles:
        res = ingest_title(t, release, out_root, args.force)
        if res.get("sections"):
            entry = {"sections": res["sections"], "releasePoint": release.replace("/", "-")}
            if res.get("duplicates"):
                entry["duplicates"] = res["duplicates"]
            manifest["titles"][t] = entry
        manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    # Always rebuilt from every shard on disk, never from just the titles this
    # run happened to fetch.
    #
    # Accumulating credits during the walk is free, and was how this worked until
    # `--titles 51 --force` wrote an index describing one title over an index
    # describing all 53 — `manifest.acts` said 0 while the directory held 2,740.
    # That is the same shape as the bug the manifest's section count exists to
    # catch: a count that describes writes rather than files. An Act's sections
    # are also spread across titles, so a subset ingest cannot see a whole Act
    # even in principle. One extra pass over the shards is a small price.
    log("\nBuilding the Act index from every shard on disk")
    origins, conflicts = scan_shards_for_origins(out_root)
    acts = write_act_index(out_root, origins, conflicts)
    manifest["acts"] = acts
    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    have = sorted(manifest["titles"], key=lambda x: int(re.sub(r"\D", "", x) or 0))
    log(f"\nDone in {time.time() - started:.0f}s. {len(have)} title(s) available: {', '.join(have)}")
    log(f"Act index: {acts} Act(s) in {out_root / 'acts'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
