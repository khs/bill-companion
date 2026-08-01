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
                    log(f"    ! duplicate section number {rec['section']} - overwriting")
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
    args = ap.parse_args()

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

    have = sorted(manifest["titles"], key=lambda x: int(re.sub(r"\D", "", x) or 0))
    log(f"\nDone in {time.time() - started:.0f}s. {len(have)} title(s) available: {', '.join(have)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
