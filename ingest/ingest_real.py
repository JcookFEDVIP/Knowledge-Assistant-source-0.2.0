"""Ingest the real FEDVIP job aids (read-only) into the app's corpus format. Python standard library only.

Usage:  python -I ingest/ingest_real.py <job-aid-folder> <out-dir> [<transcriptions-dir>]

- One passage ("unit") per text shape, table row (with its header row) or SmartArt block, in slide reading order.
- Text is verbatim from the files. NOTE/IMPORTANT/EXCEPTION/DO NOT lines are copied verbatim into `conditions`;
  stand-alone note shapes are also carried to every other unit on the same slide.
- Every source is approval "pending": no owner record exists yet. Nothing is marked approved.
- Facets come from the job-aid title (source level) and from explicit affiliation wording in a unit (unit level).
"""
import hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # office_extract.py lives next to this script (self-contained project)
import office_extract as ox  # noqa: E402

SRC, OUT = sys.argv[1], sys.argv[2]
TRANS = sys.argv[3] if len(sys.argv) > 3 else None
DATE_RX = re.compile(r"(?i)^\s*(?:last\s+)?(?:revised|reviewed|updated)(?:\s+on)?:?\s*\(?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\)?\s*$")
DATE_ANY = re.compile(r"(?i)\b((?:last\s+)?(?:revised|reviewed|updated)(?:\s+on)?:?\s*\(?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\)?)")
PAGE_RX = re.compile(r"(?i)^\s*(page\s*)?\d+\s*(of|/)\s*\d+\s*$")
COND_RX = re.compile(r"(?i)^\s*(?:[-•]\s*)?(note|important|exception|reminder|do not|don't|never|only if|caution|warning)\b")
SKIP_FILES = {"desktop.ini"}
SKIP_TITLES = {"Agency and Department Keywords", "Master Agency List", "2026 Payroll Schedule"}  # large lookup tables: v1 excludes, reported

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]

def facets_from_title(t):
    f = {}
    tl = t.lower()
    usm = re.search(r"\busm\b|uniformed|\bfad\b|sponsor", tl)
    civ = re.search(r"fed civ|civilian|civ employee|\bciv\b|federal or", tl)
    if usm and not civ:           # a title naming both groups (e.g. "Federal or USM") applies to both: no scope
        f["affiliation"] = ["USM"]
    elif civ and not usm:
        f["affiliation"] = ["FED_CIV", "USPS"] if "usps" in tl else ["FED_CIV"]
    if re.search(r"\(l1\)|\bl1\b", tl):
        f["audience"] = ["L1"]
    elif re.search(r"\(supervisor\)|tl only", tl):
        f["audience"] = ["SR", "ADMIN"]
    elif re.search(r"\(l2\)|senior rep", tl):
        f["audience"] = ["SR"]
    # admin/WFM: only the aids that are about managing agents; agent-facing IEX/Webstation aids stay unscoped
    elif re.search(r"\badmins?\b|approving or denying|adherence report|scheduled hours|time utilization|csat report|downloading csat|searching agent csat|updating csat|unlocking an agent schedule|rta strategy|scheduling adjustment|attendance updates|creating automated reports|qa reminders|qa call checks|iex activity codes|iex setup for schedule review", tl):
        f["audience"] = ["ADMIN"]
    if re.search(r"post open season|after open season|steady state|outside of open season|belated|exception enrollment", tl):
        f["season"] = ["STEADY_STATE"]
    elif re.search(r"open season", tl) and not re.search(r"current plan year call", tl):
        f["season"] = ["OPEN_SEASON"]
    return f

USM_RX = re.compile(r"(?i)\b(usms?|uniformed? services?(?: members?)?|military members?|family members? of (?:an? )?(?:active[- ]duty|retired uniformed)|medal of honor|gray area reservists?)\b")  # explicit group names only
CIV_RX = re.compile(r"(?i)\b(fed ?civ|\bciv\b|federal civilians?|civilians?|federal (?:employees|annuitants)|usps|postal (?:employees?|workers?|annuitants?|service employees?)|opm annuit\w*|csrs|fers)\b")
# A first line that is a note, a cross-reference, the object of "marry", or names agencies/annuity offices next to USM
# is not ABOUT one affiliation: it never scopes the block.
NOSCOPE_RX = re.compile(r"(?i)^\W*(note|important|reminder|see )|\bmarr(y|ies|ied|ying)\b|\b(agency|agencies|annuity office|apo)\b.*\busm\b|\busm\b.*\b(agency|agencies|annuity office)\b")

def unit_affiliation(text):
    """Affiliation is taken only from what a block is ABOUT: its first line, or a table's caption/header rows.
    A passing mention ("...if they have TRICARE...") in body text never scopes a passage."""
    lines = text.split("\n")
    if lines and lines[0].startswith("|"):
        # a table row: what the row is ABOUT is its caption/header and its label cell, not every cell in it
        cells = [c.strip() for c in lines[-1].strip("|").split("|")]
        label = next((c for c in cells if c and not re.fullmatch(r"\d+", c)), "")
        head = "\n".join(lines[:-1] + [label])
    else:
        head = lines[0] if lines else ""
        # prose: a short first line is a heading ("Federal Civilians / USPS employees:"); in a long first sentence only the
        # opening words say what it is about ("USMs: If the enrollee is..."), not a group mentioned later on
        if len(head) > 90:
            head = " ".join(head.split()[:10])
    # a label cell can be long prose too: only its opening words count
    if lines and lines[0].startswith("|") and len(label) > 90:
        head = "\n".join(lines[:-1] + [" ".join(label.split()[:10])])
    if NOSCOPE_RX.search(head):
        return None
    u, c = bool(USM_RX.search(head)), bool(CIV_RX.search(head))
    if u and not c:
        return ["USM"]
    if c and not u:
        return ["FED_CIV", "USPS"] if re.search(r"(?i)usps|postal", text) else ["FED_CIV"]
    return None

SR_UNIT_RX = re.compile(r"(?i)^\W*(for )?(senior rep(resentative)?s?|l2s?)( use| only)\b")
LABEL_RX = re.compile(r"^(?!.*[.!?]\s)(?!.*[.!?]$).{2,90}$")  # no sentence break, no sentence-ending punctuation
SLIDE_TITLE_RX = re.compile(r"\(\s*\d+\s*/\s*\d+\s*\)\s*$")

def is_label(t, title):
    """A short, single-line shape with no sentence punctuation (e.g. a section title) is a label, not a passage."""
    if "\n" in t or not LABEL_RX.match(t) or t.startswith("|") or COND_RX.match(t) or re.search(r"\d{3}", t):
        return False
    if re.match(r"^\s*(\d+[.)]|[-•*]|[A-Za-z][.)]\s)", t):  # numbered or bulleted list items are content, not labels
        return False
    words = [w for w in re.findall(r"[A-Za-z][\w./'-]*", t) if len(w) > 3]
    caps = sum(1 for w in words if w[0].isupper())
    return bool(words) and caps / len(words) >= 0.6  # title-like: mostly capitalized words

def split_units(texts, title):
    """texts: list of shape texts for one slide -> list of (heading, text). Tables become one unit per row with header.
    Labels (short title-like shapes) are not passages: the next passage on the slide takes the label as its heading,
    so the label text is still shown verbatim with the content it introduces."""
    out = []
    label = None          # current section label: applies to every following unit until the next label
    label_used = True
    for t in texts:
        t = t.strip()
        if not t or t == title or DATE_RX.match(t) or PAGE_RX.match(t) or t.startswith("[image:"):
            continue
        if re.fullmatch(r"[\d\s/.\-]+", t):
            continue  # a bare date or number (e.g. "03/10/26") is not a passage
        if SLIDE_TITLE_RX.search(t) and t.split("(")[0].strip().lower().replace("–", "-") in title.lower().replace("–", "-"):
            continue  # "Title (1/3)" repeats the job-aid title
        if is_label(t, title):
            if label and not label_used:
                out.append((title, label))  # a label followed directly by another label is content on its own
            label, label_used = t, False
            continue
        lines = [l for l in t.split("\n") if l.strip() and not PAGE_RX.match(l) and not DATE_RX.match(l)]
        if not lines:
            continue
        if all(l.startswith("|") for l in lines):
            # table: header = first row(s) until a row with >= 2 non-empty cells after a single-cell caption row
            rows = lines
            if len(rows) > 1 and all(len([c for c in r.strip("|").split("|") if c.strip()]) <= 1 for r in rows):
                # a one-column table is a captioned list: every item stands on its own under the caption
                for r in rows[1:]:
                    item = next((c.strip() for c in r.strip("|").split("|") if c.strip()), title)
                    out.append(((label + " · " + item[:90]) if label else item[:90], rows[0] + "\n" + r))
                label_used = True
                continue
            header = rows[0]
            body = rows[1:]
            if len(rows) > 1 and len([c for c in rows[0].strip("|").split("|") if c.strip()]) <= 1:
                header = rows[0] + "\n" + rows[1]; body = rows[2:]
            # A real header row has short cells. If the "header" is long prose, the table has no header:
            # every row stands on its own (otherwise every row would start with the same unrelated sentence).
            hdr_cells = [c.strip() for c in header.split("\n")[-1].strip("|").split("|") if c.strip()]
            if hdr_cells and max(len(c) for c in hdr_cells) > 45:
                caption = header.split("\n")[0] if "\n" in header else ""
                for r in ([header.split("\n")[-1]] + body):
                    cells = [c.strip() for c in r.strip("|").split("|")]
                    head = next((c for c in cells if c), title)[:90]
                    out.append(((label + " · " + head) if label else head, (caption + "\n" + r) if caption else r))
                label_used = True
                continue
            hcells = [c.strip() for c in header.split("\n")[-1].strip("|").split("|")]
            if not body:
                out.append((hcells[0] if hcells else title, header)); continue
            for r in body:
                cells = [c.strip() for c in r.strip("|").split("|")]
                head = next((c for c in cells if c), title)[:90]
                out.append(((label + " · " + head) if label else head, header + "\n" + r))
            label_used = True
            continue
        first = lines[0].lstrip("-• ").strip()
        heading = first if (len(first) <= 90 and not first.endswith(".") and len(lines) > 1) else title
        if label:
            heading = label
            label_used = True
        out.append((heading, "\n".join(lines)))
    if label and not label_used:  # a trailing label with nothing after it is still content: keep it as its own unit
        out.append((title, label))
    return out

def merge_rows(slide, title):
    """Slides built from separate text boxes laid out as a grid (e.g. the L1 ACED chart) lose their rows when read
    box by box. Boxes on the same visual row that are all short cells are joined into one row: "event | timeframe | effective"."""
    out = []
    for row in slide.get("rows") or [[t] for t in slide["texts"]]:
        cells = [t.strip() for t in row if t.strip() and t.strip() != title and not DATE_RX.match(t.strip()) and not PAGE_RX.match(t.strip()) and not t.strip().startswith("[image:")]
        if len(cells) >= 2 and all(len(c) <= 70 and "\n" not in c and not c.startswith("|") for c in cells):
            out.append(" | ".join(cells))
        else:
            out.extend(cells)
    seen = set(); dedup = []
    for t in out:
        if t not in seen:
            seen.add(t); dedup.append(t)
    return dedup

MM = 36000  # EMU per millimetre

def grid_units(slide, title):
    """Rebuild a chart drawn as separate text boxes plus border lines (e.g. ACED Chart (L1)) into one unit per row.
    Columns come from the header row; each column's horizontal borders give its cells; a cell that spans several rows
    (a time frame or "What do I do?" shared by rows 12-17) is attached to every row whose cell it covers.
    Returns (pairs, used_texts) or None if the slide doesn't look like such a grid. Cell text is verbatim."""
    boxes = [b for b in slide.get("boxes") or [] if b[4] and b[4] != title and not DATE_RX.match(b[4])]
    rules = [b for b in slide.get("boxes") or [] if not b[4]]
    if len(rules) < 6 or len(boxes) < 8:
        return None
    # header: the highest y-level with >= 4 short boxes side by side
    levels = {}
    for b in boxes:
        levels.setdefault(round(b[1] / (2 * MM)), []).append(b)
    header = next((sorted(v, key=lambda b: b[0]) for k, v in sorted(levels.items()) if len(v) >= 4 and all(len(b[4]) <= 30 and "\n" not in b[4] for b in v)), None)
    if not header:
        return None
    hy = max(b[1] + b[3] for b in header)
    htop = min(b[1] for b in header)
    centers = [b[0] + b[2] / 2 for b in header]
    bottom = max((r[1] + r[3] for r in rules), default=hy)
    body = [b for b in boxes if b not in header and hy - MM <= b[1] + b[3] / 2 <= bottom + MM and b[2] < 200 * MM]
    # column boundaries: the vertical border lines drawn in the header row (header labels are often not centred on
    # their column); without such lines, fall back to the nearest header label
    vx = sorted({round(r[0] / MM) for r in rules if r[2] < MM and r[3] > 2 * MM and r[1] <= hy and r[1] + r[3] >= htop})
    def col(b):
        c = b[0] + b[2] / 2
        if len(vx) >= len(centers) - 1:
            edges = [-1e12] + [x * MM for x in vx] + [1e12]
            k = next(i for i in range(len(edges) - 1) if edges[i] <= c < edges[i + 1])
            lo, hi = edges[k], edges[k + 1]
            inside = [i for i, hc in enumerate(centers) if lo <= hc < hi]
            if inside:
                return inside[0]
        return min(range(len(centers)), key=lambda i: abs(centers[i] - c))
    counts = [sum(1 for b in body if col(b) == i) for i in range(len(centers))]
    anchor_col = max(range(len(centers)), key=lambda i: counts[i])
    def cuts(i):
        cx = centers[i]
        ys = {hy}
        for x, y, w, h, _ in rules:
            if x - MM <= cx <= x + w + MM:
                ys.add(y)
                if h > MM: ys.add(y + h)
        return sorted(ys)
    def cell(i, yc):
        cs = cuts(i)
        lo = max([c for c in cs if c <= yc] or [hy]); hi = min([c for c in cs if c > yc] or [bottom])
        return lo, hi
    anchors = sorted((b for b in body if col(b) == anchor_col), key=lambda b: b[1])
    if len(anchors) < 4:
        return None
    acells = [cell(anchor_col, a[1] + a[3] / 2) for a in anchors]
    # rows with no border line between them share a bordered cell: then each row is its own box's span
    acells = [(a[1], a[1] + a[3]) if sum(1 for c in acells if c == acells[k]) > 1 else acells[k] for k, a in enumerate(anchors)]
    rows = [[[] for _ in centers] for _ in anchors]
    for k, a in enumerate(anchors):
        rows[k][anchor_col].append(a)
    for b in body:
        i = col(b)
        if i == anchor_col:
            continue
        lo, hi = cell(i, b[1] + b[3] / 2)
        # Several boxes in one bordered cell that together fill it (stacked cell boxes with no line between them,
        # e.g. "31 - 60" over rows 27-28 and "60" for row 29): each box's own height is its cell.
        mates = [m for m in body if col(m) == i and lo <= m[1] + m[3] / 2 < hi]
        if len(mates) > 1 and sum(m[3] for m in mates) >= 0.75 * (hi - lo):
            lo, hi = b[1], b[1] + b[3]
        for k, (alo, ahi) in enumerate(acells):
            if lo - MM / 2 <= (alo + ahi) / 2 <= hi + MM / 2:
                rows[k][i].append(b)
    head_line = " | ".join(b[4] for b in header)
    pairs, used = [], set(b[4] for b in header)
    for k, a in enumerate(anchors):
        cells = ["\n".join(b[4] for b in sorted(c, key=lambda b: b[1])) for c in rows[k]]
        for c in rows[k]:
            used.update(b[4] for b in c)
        lead = cells[0].split("\n")[0] if anchor_col != 0 and cells[0] else ""
        heading = (f"{lead} · " if lead else "") + a[4].split("\n")[0][:90]
        pairs.append((heading, head_line + "\n" + " | ".join(cells)))
    return pairs, used

HUB_LEN = 2000   # prose passages longer than this are split at their internal section headings
MIN_PIECE = 400
def is_subhead(line):
    """A line inside a long passage that starts a new section: short, not a bullet, and a heading by form
    ("Scenario 2: ...", "Refund Processing", "I've accepted the Deferred Resignation. What happens...?", "Manual Comment:")."""
    l = line.strip()
    if not l or len(l) > 110 or re.match(r"^[-•*–]|^\d+[.)]\s", l):
        return False
    if re.match(r"(?i)^(scenario|step|option|part|section)\s*\d+", l) or l.endswith(":") or l.endswith("?"):
        return True
    words = [w for w in re.findall(r"[A-Za-z][\w'/&-]*", l) if len(w) > 3]
    return len(l) <= 70 and not l.endswith(".") and bool(words) and sum(w[0].isupper() for w in words) / len(words) >= 0.6

def split_hub(heading, text):
    """Split a long prose passage into sections at its subheadings. Lines are kept verbatim and in order; a piece
    shorter than MIN_PIECE stays with its neighbour so no fragment is created."""
    if len(text) <= HUB_LEN or text.startswith("|"):
        return [(heading, text)]
    lines = text.split("\n")
    pieces = [[lines[0]]]
    for l in lines[1:]:
        if is_subhead(l) and sum(len(x) for x in pieces[-1]) >= MIN_PIECE:
            pieces.append([l])
        else:
            pieces[-1].append(l)
    if len(pieces) > 1 and sum(len(x) for x in pieces[-1]) < MIN_PIECE:
        pieces[-2].extend(pieces.pop())
    if len(pieces) == 1:
        return [(heading, text)]
    out = []
    for k, p in enumerate(pieces):
        h = heading if k == 0 else p[0].strip().rstrip(":")[:90]
        out.append((h, "\n".join(p)))
    return out

GRID_AIDS = {"ACED Chart (L1)"}  # charts drawn as text boxes + border lines, verified to rebuild correctly

def conditions_of(text):
    return [l.strip().lstrip("-• ").strip() for l in text.split("\n") if COND_RX.match(l)]

sources, skipped = [], []
# Job aids may sit in subfolders ("L1 Job Aids", "SME Job Aids", ...): the folder decides which roles see them
# (content/real/roles.json). `file` is the path relative to the job-aid folder; `folders` lists the top-level subfolders
# that hold this file ("" = loose in the main folder). The same file placed in two folders is one job aid in both.
files = []
for root, dirs, names in os.walk(SRC):
    dirs[:] = sorted(d for d in dirs if not d.startswith("."))
    for n in names:
        if n.lower().endswith((".pptx", ".docx", ".xlsx")) and not n.startswith("~$"):
            files.append(os.path.relpath(os.path.join(root, n), SRC).replace(os.sep, "/"))
files.sort(key=lambda r: (r.rsplit("/", 1)[-1], r))
for rel in files:
    fn = rel.rsplit("/", 1)[-1]
    folder = rel.split("/", 1)[0] if "/" in rel else ""
    title = fn.rsplit(".", 1)[0].strip()
    path = os.path.join(SRC, *rel.split("/"))
    if fn in SKIP_FILES or title in SKIP_TITLES:
        skipped.append({"file": fn, "reason": "large lookup table (not passage content in v1)"}); continue
    ext = fn.rsplit(".", 1)[1].lower()
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    same = next((x for x in sources if x["title"] == title and x["fileSha256"] == sha), None)
    if same:
        if folder not in same["folders"]:
            same["folders"].append(folder)
        continue
    try:
        units, _ = {"pptx": ox.pptx, "docx": ox.docx, "xlsx": ox.xlsx}[ext](path)
    except Exception as e:  # noqa: BLE001
        skipped.append({"file": fn, "reason": f"extract failed: {e!r}"}); continue
    alltext = "\n".join("\n".join(u["texts"]) for u in units)
    m = DATE_ANY.search(alltext)
    printed = m.group(1).strip() if m else "(no revision date printed)"
    slides = []
    seen_by_source = set()
    for u in units:
        n = u["n"]
        stitle = (u.get("title") or (u["texts"][0].split("\n")[0] if u["texts"] else title))[:120]
        grid = grid_units(u, title) if ext == "pptx" and title in GRID_AIDS else None
        if grid:
            # grid rows, plus whatever is outside the grid (title box, footnotes) read the usual way
            rest = [t for t in u["texts"] if t not in grid[1]]
            pairs = grid[0] + split_units(rest, title)
        else:
            pairs = split_units(merge_rows(u, title) if ext == "pptx" else u["texts"], title)
        # long prose passages -> one passage per section; each section keeps the parent's situation tags (a section of a
        # USM-only scenario is still USM-only) unless its own first line names a different group
        split = []
        for h, t in pairs:
            parent = (unit_affiliation(t), bool(SR_UNIT_RX.match(t)))
            pieces = split_hub(h, t)
            first = pieces[0][1].split("\n")[0]
            lead = first.strip().rstrip(":")[:60] if len(pieces) > 1 and is_subhead(first) else (h if h != title else "")
            for k, (ph, pt) in enumerate(pieces):
                split.append((f"{lead} · {ph}" if k and lead else ph, pt, parent))
        pairs = [(h, t) for h, t, _ in split]
        parents = {id(t): par for _, t, par in split}
        # slide-level carried notes: stand-alone units that are themselves a note
        carried = [t for h, t in pairs if COND_RX.match(t) and "\n" not in t.strip()]
        out_units = []
        seen_texts = seen_by_source
        for h, t in pairs:
            conds = conditions_of(t)
            for c in carried:
                cc = c.strip().lstrip("-• ").strip()
                if cc not in conds and t != c:
                    conds.append(cc)
            if re.fullmatch(r"[\d\s|./:-]*", t) or (len(re.findall(r"[A-Za-z]{2,}", t)) < 2 or t.strip().lower() in ("job aid", "examples:", "popout icon")) and not re.search(r"[\d@]", t):
                continue  # layout fragment ("Job Aid", "B | C"), not guidance
            key = re.sub(r"\s+", " ", t).strip().lower()
            if key in seen_texts:
                continue  # the same passage repeated on another slide of this job aid: keep the first copy
            seen_texts.add(key)
            unit = {"heading": h, "text": t, "conditions": conds}
            paff, psr = parents.get(id(t), (None, False))
            aff = unit_affiliation(t) or paff
            if aff:
                unit.setdefault("facets", {})["affiliation"] = aff
            if SR_UNIT_RX.match(t) or psr:
                unit.setdefault("facets", {})["audience"] = ["SR"]
            out_units.append(unit)
        if out_units:
            slides.append({"n": n, "title": stitle if ext != "xlsx" else f"Sheet: {u.get('title', n)}", "units": out_units})
    if TRANS:
        tp = os.path.join(TRANS, slug(title) + ".md")
        if os.path.exists(tp):
            ttext = open(tp, encoding="utf-8").read().strip()
            slides.append({"n": (slides[-1]["n"] + 1) if slides else 1, "title": "Transcribed from image (not original text)", "transcribed": True,
                           "units": [{"heading": "Transcription of image content", "text": ttext, "conditions": []}]})
    if not slides:
        skipped.append({"file": fn, "reason": "no extractable text"}); continue
    sid = slug(title)
    if any(x["id"] == sid for x in sources):
        sid = f"{sid}-{ext}"  # same title in two formats (e.g. .pptx and .xlsx)
    if any(x["id"] == sid for x in sources):
        # same title, different file contents in two folders: two versions of one job aid
        dup = next(x for x in sources if x["id"] == sid)
        print(f"WARNING: '{rel}' and '{dup['file']}' have the same title but different contents; keep one version", file=sys.stderr)
        sid = f"{sid}-{slug(folder) or 'main'}"
    sources.append({
        "id": sid, "title": title, "file": rel, "folders": [folder], "fileSha256": sha, "format": ext, "printedRevision": printed,
        "approval": "pending", "lifecycle": "current", "riskCategory": "standard",
        "facets": facets_from_title(title), "slides": slides,
    })

# Where an L1 version of a job aid exists ("X (L1)" / "X L1"), the full version is the Senior Rep version.
def base_title(t):
    return re.sub(r"\s+", " ", re.sub(r"(?i)\(l1\)|\bl1\b", "", t)).strip().lower()
l1_bases = {base_title(s["title"]) for s in sources if (s["facets"].get("audience") or []) == ["L1"]}
for s in sources:
    if "audience" not in s["facets"] and base_title(s["title"]) in l1_bases:
        s["facets"]["audience"] = ["SR"]
L1_WITHOUT_SR_VERSION = {"Canceling ACH Payments (L1)"}
for s in sources:
    if s["title"] in L1_WITHOUT_SR_VERSION:
        s["facets"].pop("audience", None)

os.makedirs(OUT, exist_ok=True)
corpus = {
    "_notice": "REAL job-aid text extracted verbatim, read-only, from the files listed. No owner approval records exist yet: every source is 'pending'. Do not distribute to agents.",
    "program": "FEDVIP (BENEFEDS) job aids",
    "knowledgeVersion": "jobaids-preview-" + hashlib.sha256("".join(s["fileSha256"] for s in sources).encode()).hexdigest()[:10],
    "defaultSeason": "STEADY_STATE",
    "owners": [],
    "sources": sources,
    "skipped": skipped,
}
json.dump(corpus, open(os.path.join(OUT, "corpus.base.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
n_units = sum(len(sl["units"]) for s in sources for sl in s["slides"])
print(json.dumps({"sources": len(sources), "slides": sum(len(s["slides"]) for s in sources), "units": n_units, "skipped": skipped}, indent=1))
