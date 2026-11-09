"""Extract a folder of job aids (.pptx/.docx/.xlsx) into the knowledge base. Stdlib only.

Usage:  python -I office_extract.py <kb-root> <job-aid-folder> [<more folders/files>...]
(.xls is not readable directly: convert to .xlsx first, e.g. via Excel, and pass the converted file/folder too)

Writes <kb-root>/job_aids/:
  <slug>.md       - full text of each job aid (slides in order, reading order within slide)
  chunks.jsonl    - retrieval records (one per job aid; long ones split by slide groups)
  index.md        - catalog of every job aid with size + screenshot-heavy flag
"""
import json, os, posixpath, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
def _q(ns):
    return lambda t: f"{{{NS[ns]}}}{t}"


A, P, R, W, S = _q("a"), _q("p"), _q("r"), _q("w"), _q("s")
ROW_TOL = 228600  # 0.25 inch in EMU: shapes within this vertical distance read as one row
CHUNK_MAX = 6000


def norm(s):
    s = s.replace(" ", " ").replace("\u000b", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(l.strip() for l in s.splitlines() if l.strip())


def rels(z, part):
    path = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
    if path not in z.namelist():
        return {}
    out = {}
    for r in ET.fromstring(z.read(path)).findall("pr:Relationship", NS):
        tgt = r.get("Target")
        if r.get("TargetMode") != "External":
            tgt = posixpath.normpath(posixpath.join(posixpath.dirname(part), tgt))
        out[r.get("Id")] = (r.get("Type", "").rsplit("/", 1)[-1], tgt, r.get("TargetMode") == "External")
    return out


# ---------------- PPTX ----------------
def para_text(p, links):
    parts = []
    for el in p.iter():
        if el.tag == A("t") and el.text:
            parts.append(el.text)
        elif el.tag == A("br"):
            parts.append("\n")
        elif el.tag == A("hlinkClick") and links is not None:
            rid = el.get(R("id"))
            if rid:
                links.add(rid)
    t = "".join(parts).strip()
    lvl = int((p.find("a:pPr", NS).get("lvl", 0) if p.find("a:pPr", NS) is not None else 0) or 0)
    bullet = p.find("a:pPr/a:buChar", NS) is not None or p.find("a:pPr/a:buAutoNum", NS) is not None
    if t and (bullet or lvl):
        t = "  " * lvl + "- " + t
    return t


def txbody_text(tb, links):
    return norm("\n".join(filter(None, (para_text(p, links) for p in tb.findall("a:p", NS)))))


def xfrm(el):
    off = el.find(".//a:off", NS)
    return (int(off.get("y")), int(off.get("x"))) if off is not None else (0, 0)


def shapes(tree, z, srels, links, out, base=(0, 0)):
    """Collect (y, x, text) from a spTree / grpSp, recursing into groups."""
    for el in tree:
        tag = el.tag.split("}")[1]
        y, x = xfrm(el)
        if tag == "sp":
            tb = el.find("p:txBody", NS)
            if tb is not None:
                t = txbody_text(tb, links)
                if t:
                    out.append((y, x, t))
        elif tag == "grpSp":
            shapes(el, z, srels, links, out)
        elif tag == "graphicFrame":
            tbl = el.find(".//a:tbl", NS)
            if tbl is not None:
                rows = []
                for tr in tbl.findall("a:tr", NS):
                    cells = [txbody_text(tc.find("a:txBody", NS), links).replace("\n", " / ")
                             if tc.find("a:txBody", NS) is not None else "" for tc in tr.findall("a:tc", NS)]
                    if any(cells):
                        rows.append("| " + " | ".join(cells) + " |")
                if rows:
                    out.append((y, x, "\n".join(rows)))
            dm = el.find(".//{http://schemas.openxmlformats.org/drawingml/2006/diagram}relIds")
            if dm is not None:
                rid = dm.get(R("dm"))
                if rid in srels:
                    d = ET.fromstring(z.read(srels[rid][1]))
                    pts = [norm("".join(t.text or "" for t in pt.iter(A("t"))))
                           for pt in d.iter("{http://schemas.openxmlformats.org/drawingml/2006/diagram}pt")]
                    pts = [t for t in pts if t]
                    if pts:
                        out.append((y, x, "\n".join("- " + t for t in pts)))
        elif tag == "pic":
            nv = el.find("p:nvPicPr/p:cNvPr", NS)
            alt = (nv.get("descr") or "").strip() if nv is not None else ""
            if alt and not re.search(r"^(A screenshot of a computer|Picture \d+|Graphical user interface)", alt, re.I):
                out.append((y, x, f"[image: {norm(alt)}]"))
            out.append((y, x, None))  # marks a picture (for screenshot-heavy detection)


def text_boxes(tree, links, out, tf=(0, 0, 1.0, 1.0)):
    """Collect text boxes with their position AND size, in slide coordinates: (x, y, w, h, text).
    Group transforms (chOff/chExt -> off/ext) are applied, so grouped boxes line up with the rest of the slide.
    Used to rebuild grid layouts (charts drawn as separate text boxes) where one box spans several rows."""
    ox, oy, sx, sy = tf
    for el in tree:
        tag = el.tag.split("}")[1]
        if tag == "sp":
            tb = el.find("p:txBody", NS)
            off, ext = el.find("p:spPr/a:xfrm/a:off", NS), el.find("p:spPr/a:xfrm/a:ext", NS)
            if off is None or ext is None:
                continue
            t = txbody_text(tb, links) if tb is not None else ""
            # shapes without text (lines, cell rectangles) are kept with text "": they are the grid's borders
            out.append((ox + int(off.get("x")) * sx, oy + int(off.get("y")) * sy, int(ext.get("cx")) * sx, int(ext.get("cy")) * sy, t or ""))
        elif tag == "grpSp":
            g = el.find("p:grpSpPr/a:xfrm", NS)
            if g is None:
                text_boxes(el, links, out, tf); continue
            off, ext, coff, cext = (g.find(f"a:{k}", NS) for k in ("off", "ext", "chOff", "chExt"))
            if None in (off, ext, coff, cext) or not int(cext.get("cx")) or not int(cext.get("cy")):
                text_boxes(el, links, out, tf); continue
            gsx, gsy = int(ext.get("cx")) / int(cext.get("cx")), int(ext.get("cy")) / int(cext.get("cy"))
            # child -> group: off + (c - chOff) * scale ; group -> slide: current transform
            nx = ox + (int(off.get("x")) - int(coff.get("x")) * gsx) * sx
            ny = oy + (int(off.get("y")) - int(coff.get("y")) * gsy) * sy
            text_boxes(el, links, out, (nx, ny, sx * gsx, sy * gsy))


def reading_order(items):
    items.sort()
    rows, cur, cy = [], [], None
    for y, x, t in items:
        if cur and y - cy > ROW_TOL:
            rows.append(cur); cur = []
        if not cur:
            cy = y
        cur.append((x, t))
    if cur:
        rows.append(cur)
    return [t for r in rows for _, t in sorted(r, key=lambda c: c[0])]


def reading_rows(items):
    """Same ordering as reading_order, but keeps visual rows: [[text, text, ...], ...] (left to right)."""
    items = sorted(items)
    rows, cur, cy = [], [], None
    for y, x, t in items:
        if cur and y - cy > ROW_TOL:
            rows.append(cur); cur = []
        if not cur:
            cy = y
        cur.append((x, t))
    if cur:
        rows.append(cur)
    return [[t for _, t in sorted(r, key=lambda c: c[0]) if t] for r in rows]


def pptx(path):
    z = zipfile.ZipFile(path)
    pres = ET.fromstring(z.read("ppt/presentation.xml"))
    prels = rels(z, "ppt/presentation.xml")
    slides, pics = [], 0
    for i, sid in enumerate(pres.findall("p:sldIdLst/p:sldId", NS), 1):
        part = prels[sid.get(R("id"))][1]
        root = ET.fromstring(z.read(part))
        if root.get("show") == "0":
            continue  # hidden slide
        srels = rels(z, part)
        links, items = set(), []
        shapes(root.find("p:cSld/p:spTree", NS), z, srels, links, items)
        n_pics = sum(1 for it in items if it[2] is None)
        pics += n_pics
        texts = [t for t in reading_order([it for it in items if it[2] is not None]) if t]
        dedup = [t for k, t in enumerate(texts) if t not in texts[:k]]
        rows = reading_rows([it for it in items if it[2] is not None])
        boxes = []
        text_boxes(root.find("p:cSld/p:spTree", NS), set(), boxes)
        notes = ""
        for typ, tgt, ext in srels.values():
            if typ == "notesSlide":
                nr = ET.fromstring(z.read(tgt))
                for sp in nr.iter(P("sp")):
                    ph = sp.find(".//p:nvPr/p:ph", NS)
                    if ph is not None and ph.get("type") == "body":
                        notes = txbody_text(sp.find("p:txBody", NS), None)
        urls = sorted({srels[l][1] for l in links if l in srels and srels[l][2]})
        slides.append({"n": i, "texts": dedup, "rows": rows, "boxes": boxes, "notes": notes, "links": urls, "pics": n_pics})
    return slides, pics


# ---------------- DOCX ----------------
def docx(path):
    z = zipfile.ZipFile(path)
    body = ET.fromstring(z.read("word/document.xml")).find("w:body", NS)
    drels = rels(z, "word/document.xml")
    out = []

    def ptext(p):
        t = "".join(x.text or "" for x in p.iter() if x.tag in (W("t"),))
        t = t.strip()
        st = p.find("w:pPr/w:pStyle", NS)
        style = st.get(W("val")) if st is not None else ""
        if t and p.find("w:pPr/w:numPr", NS) is not None:
            t = "- " + t
        elif t and style.lower().startswith("heading"):
            t = "#" * min(int(re.sub(r"\D", "", style) or 2) + 1, 4) + " " + t
        for h in p.iter(W("hyperlink")):
            rid = h.get(R("id"))
            if rid in drels and drels[rid][2]:
                t += f" (link: {drels[rid][1]})"
        return t

    for el in body:
        if el.tag == W("p"):
            t = ptext(el)
            if t:
                out.append(t)
        elif el.tag == W("tbl"):
            for tr in el.iter(W("tr")):
                cells = [" / ".join(filter(None, (ptext(p) for p in tc.iter(W("p"))))) for tc in tr.findall("w:tc", NS)]
                if any(cells):
                    out.append("| " + " | ".join(cells) + " |")
    return [{"n": 1, "texts": [norm("\n".join(out))], "notes": "", "links": [], "pics": 0}], 0


# ---------------- XLSX ----------------
def xlsx(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("s:si", NS):
            ss.append("".join(t.text or "" for t in si.iter(S("t"))))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    wrels = rels(z, "xl/workbook.xml")
    sheets = []
    for k, sh in enumerate(wb.findall("s:sheets/s:sheet", NS), 1):
        if sh.get("state") in ("hidden", "veryHidden"):
            continue
        root = ET.fromstring(z.read(wrels[sh.get(R("id"))][1]))
        rows = []
        for row in root.iter(S("row")):
            vals = []
            for c in row.findall("s:c", NS):
                v = c.find("s:v", NS)
                if c.get("t") == "s" and v is not None:
                    val = ss[int(v.text)]
                elif c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(S("t")))
                else:
                    val = v.text if v is not None else ""
                vals.append(norm(val or "").replace("\n", " / "))
            while vals and not vals[-1]:
                vals.pop()
            if any(vals):
                rows.append("| " + " | ".join(vals) + " |")
        if rows:
            sheets.append({"n": k, "title": sh.get("name"), "texts": rows, "notes": "", "links": [], "pics": 0})
    return sheets, 0


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80]


def main():
    root, sources = sys.argv[1], sys.argv[2:]
    out_dir = os.path.join(root, "job_aids")
    os.makedirs(out_dir, exist_ok=True)
    index, chunks, failed = [], [], []
    pairs = []
    for src in sources:
        if os.path.isfile(src):
            pairs.append((src, os.path.dirname(src), [os.path.basename(src)]))
        else:
            pairs += [(src, d, f) for d, _, f in os.walk(src)]
    converted = {os.path.basename(f).rsplit(".", 1)[0] for _, _, fs in pairs for f in fs if f.lower().endswith(".xlsx")}
    for src, dirpath, files in pairs:
        for fn in sorted(files):
            if fn.lower().endswith(".xls") and fn.rsplit(".", 1)[0] in converted:
                continue  # captured via its converted .xlsx
            ext = fn.rsplit(".", 1)[-1].lower()
            if ext not in ("pptx", "docx", "xlsx"):
                if ext not in ("ini",):
                    failed.append((fn, "unsupported format (." + ext + ")"))
                continue
            title = fn.rsplit(".", 1)[0].strip()
            try:
                units, pics = {"pptx": pptx, "docx": docx, "xlsx": xlsx}[ext](os.path.join(dirpath, fn))
            except Exception as e:
                failed.append((fn, repr(e))); continue
            rel = os.path.relpath(os.path.join(dirpath, fn), os.path.dirname(os.path.normpath(src)))
            md = [f"# {title}", "", f"Source file: {rel}", ""]
            blocks = []
            for u in units:
                label = f"Sheet: {u['title']}" if ext == "xlsx" else (f"Slide {u['n']}" if ext == "pptx" else "")
                b = []
                if label:
                    b.append(f"## {label}")
                b += u["texts"]
                if u["notes"]:
                    b.append("Speaker notes: " + u["notes"])
                if u["links"]:
                    b.append("Links: " + ", ".join(u["links"]))
                if len(b) > (1 if label else 0):
                    blocks.append("\n".join(b))
            slug = slugify(title)
            # hand transcriptions of image-only content live in <kb-root>/transcriptions/<slug>.md
            tr = os.path.join(root, "transcriptions", slug + ".md")
            transcribed = os.path.exists(tr)
            if transcribed:
                blocks.append(open(tr, encoding="utf-8").read().strip())
            md += [b + "\n" for b in blocks]
            open(os.path.join(out_dir, slug + ".md"), "w", encoding="utf-8").write("\n".join(md))
            text_len = sum(len(b) for b in blocks)
            rv = re.search(r"(?i)\b(?:revised|reviewed|updated)(?: on)?:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})", "\n".join(blocks))
            revised = rv.group(1) if rv else ""
            n_units = len(units)
            heavy = ext == "pptx" and pics >= n_units and text_len / max(n_units, 1) < 250
            index.append({"title": title, "file": fn, "slug": slug, "units": n_units, "chars": text_len, "pics": pics, "heavy": heavy and not transcribed, "transcribed": transcribed, "revised": revised})
            # chunks: whole aid if small, else consecutive slide groups
            cur, part = [], 1
            def flush():
                nonlocal cur, part
                if cur:
                    chunks.append({"source_type": "job_aid", "source": title, "file": fn, "revised": revised,
                                   "part": part, "text": f"Job aid: {title}\n\n" + "\n\n".join(cur)})
                    part += 1; cur = []
            for b in blocks:
                if cur and sum(map(len, cur)) + len(b) > CHUNK_MAX:
                    flush()
                cur.append(b)
            flush()

    with open(os.path.join(out_dir, "chunks.jsonl"), "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    with open(os.path.join(out_dir, "index.md"), "w", encoding="utf-8") as f:
        f.write(f"# Job aid catalog ({len(index)} captured)\n\n"
                "Screenshot-heavy = most meaning is in images; extracted text may be thin.\n\n"
                "| Job aid | Slides/sheets | Text chars | Images | Screenshot-heavy |\n|---|---|---|---|---|\n")
        for i in sorted(index, key=lambda i: i["title"].lower()):
            f.write(f"| [{i['title']}]({i['slug']}.md) | {i['revised']} | {i['units']} | {i['chars']} | {i['pics']} | {'YES' if i['heavy'] else ('transcribed' if i['transcribed'] else '')} |\n")
        if failed:
            f.write("\n## Not captured\n\n" + "".join(f"- {fn}: {why}\n" for fn, why in failed))
    print(json.dumps({"captured": len(index), "chunks": len(chunks), "screenshot_heavy": sum(i["heavy"] for i in index),
                      "empty": [i["title"] for i in index if i["chars"] < 80], "failed": failed}, indent=1))


if __name__ == "__main__":
    main()
