#!/usr/bin/env python3
"""
Build the static data files for the Bible study app.

Downloads open-licensed sources, converts them into small JSON files under
site/data/, and writes site/data/manifest.json describing what was built.
Runs in GitHub Actions (see .github/workflows/deploy.yml); stdlib only.

  python scripts/build_data.py                 # download + build
  python scripts/build_data.py --fixtures tests/fixtures   # offline test build

Every source is optional: if one fails, the build logs a warning, records it
in the manifest, and keeps going. The app hides features whose data is missing.
"""
import argparse
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = json.load(open(os.path.join(ROOT, "site", "books.json"), encoding="utf-8"))
BOOK_INDEX = {b["osis"]: i for i, b in enumerate(BOOKS)}

# ---------------------------------------------------------------- sources
MV = "https://raw.githubusercontent.com/midvash/bible-data/main/versions/{lang}/{slug}/{slug}.json"
EB = "https://ebible.org/Scriptures/{id}_vpl.zip"
# id, label, language code, license, kind ("mv" = midvash JSON, "vpl" = eBible VPL zip), source slug
TRANSLATIONS = [
    ("kjv", "King James Version (1769)", "en", "Public domain", "mv", "kjv"),
    ("bsb", "Berean Standard Bible", "en", "Public domain", "vpl", "engbsb"),
    ("lsv", "Literal Standard Version", "en", "© 2020 Covenant Press, CC BY-SA 4.0", "vpl", "englsv"),
    ("asv", "American Standard Version (1901)", "en", "Public domain", "mv", "asv"),
    ("web", "World English Bible", "en", "Public domain", "mv", "web"),
    ("jps", "JPS Tanakh (1917) — Jewish translation of the Hebrew Bible", "en", "Public domain", "vpl", "engjps"),
    ("met", "Masoretic English Tanakh (BSB conformed to the Leningrad Codex)", "en", "Public domain", "vpl", "engmet"),
    ("webster", "Webster Bible (1833)", "en", "Public domain", "vpl", "engwebster"),
    ("geneva", "Geneva Bible (1599)", "en", "Public domain", "mv", "geneva1599"),
    ("dra", "Douay-Rheims (Catholic)", "en", "Public domain", "mv", "dra"),
    ("aleppo", "Aleppo Codex (Hebrew, c. 930 AD)", "he", "Public domain", "mv", "aleppo"),
    ("tr", "Textus Receptus (Greek, Stephanus 1550)", "gr", "Public domain", "mv", "tr"),
    ("clem", "Clementine Vulgate (Latin)", "la", "Public domain", "mv", "clem"),
    ("svd", "Smith-Van Dyck (Arabic)", "ar", "Public domain", "mv", "svd"),
    ("cuv", "Chinese Union Version (Traditional)", "zh", "Public domain", "mv", "cuv"),
    ("cuvs", "Chinese Union Version (Simplified)", "zh", "Public domain", "mv", "cuvs"),
    ("bkr", "Bible kralická (Czech)", "cs", "Public domain", "mv", "bkr"),
    ("dutch1917", "De Heilige Schrift 1917 (Dutch)", "nl", "Public domain", "mv", "dutch1917"),
    ("lsb", "La Sankta Biblio (Esperanto)", "eo", "Public domain", "mv", "lsb"),
    ("lsg", "Louis Segond 1910 (French)", "fr", "Public domain", "mv", "lsg"),
    ("darby-fr", "Bible Darby (French)", "fr", "Public domain", "mv", "darby-fr"),
    ("martin1744", "Bible David Martin 1744 (French)", "fr", "Public domain", "mv", "martin1744"),
    ("luth1912", "Lutherbibel 1912 (German)", "de", "Public domain", "mv", "luth1912"),
    ("elb1905", "Elberfelder 1905 (German)", "de", "Public domain", "mv", "elb1905"),
    ("kar", "Károli Biblia (Hungarian)", "hu", "Public domain", "mv", "kar"),
    ("diodati", "Diodati 1649 (Italian)", "it", "Public domain", "mv", "diodati"),
    ("riveduta", "Riveduta 1927 (Italian)", "it", "Public domain", "mv", "riveduta"),
    ("bg", "Biblia Gdańska (Polish)", "pl", "Public domain", "mv", "bg"),
    ("almeida-livre", "Bíblia Livre (Portuguese)", "pt", "CC BY", "mv", "almeida-livre"),
    ("vdc", "Biblia Cornilescu (Romanian)", "ro", "Public domain", "mv", "vdc"),
    ("synodal", "Synodal Translation (Russian)", "ru", "Public domain", "mv", "synodal"),
    ("sv1917", "Bibeln 1917 (Swedish)", "sv", "Public domain", "mv", "sv1917"),
    ("kp", "Kulish-Puliui 1905 (Ukrainian)", "uk", "Public domain", "mv", "kp"),
    ("vi1934", "Kinh Thánh 1934 (Vietnamese)", "vi", "Public domain", "mv", "vi1934"),
]
MV_LANG = {"gr": "gr", "he": "he"}

LXX_SOURCES = [
    ("lxx", "Septuagint – Greek (Brenton ed., Codex Vaticanus based)", "Public domain",
     ["https://ebible.org/Scriptures/grcbrent_vpl.zip"]),
    ("lxxeng", "Septuagint – English (Brenton)", "Public domain",
     ["https://ebible.org/Scriptures/eng-Brenton_vpl.zip",
      "https://ebible.org/Scriptures/englxxup_vpl.zip",
      "https://ebible.org/Scriptures/eng-lxx2012_vpl.zip"]),
]
XREF_URLS = ["https://a.openbible.info/data/cross-references.zip"]
STEP_REPO = "STEPBible/STEPBible-Data"

ATTRIBUTION = {
    "step": "Hebrew & Greek tagged texts and lexicons: STEPBible.org, based on work at "
            "Tyndale House Cambridge (CC BY 4.0).",
    "xref": "Cross references: OpenBible.info (CC BY), derived from the Treasury of Scripture Knowledge.",
    "lxx": "Septuagint Greek and English: Sir Lancelot C. L. Brenton (public domain), via eBible.org.",
    "translations": "Translations via midvash/bible-data and eBible.org; licenses listed per translation. "
                    "LSV © 2020 Covenant Press (CC BY-SA 4.0).",
}

# ---------------------------------------------------------------- helpers
def norm_key(s):
    s = s.lower().strip()
    s = re.sub(r"^(iii|third)\s+", "3", s)
    s = re.sub(r"^(ii|second)\s+", "2", s)
    s = re.sub(r"^(i|first)\s+", "1", s)
    return re.sub(r"[^a-z0-9]", "", s)

ALIASES = {
    "psalm": "Ps", "psalms": "Ps", "psa": "Ps", "pss": "Ps",
    "songofsongs": "Song", "songofsolomon": "Song", "canticles": "Song", "sng": "Song", "sos": "Song",
    "revelationofjohn": "Rev", "revelations": "Rev", "theRevelation": "Rev",
    "ezk": "Ezek", "eze": "Ezek", "jhn": "John", "jn": "John", "joh": "John",
    "mrk": "Mark", "mk": "Mark", "luk": "Luke", "lk": "Luke", "mt": "Matt", "mat": "Matt",
    "phm": "Phlm", "php": "Phil", "jol": "Joel", "nam": "Nah", "oba": "Obad",
    "jdg": "Judg", "rut": "Ruth", "jud": "Jude", "jas": "Jas", "est": "Esth", "esg": "Esth",
    "dag": "Dan", "1kingdoms": "1Sam", "2kingdoms": "2Sam", "3kingdoms": "1Kgs", "4kingdoms": "2Kgs",
    "1paralipomenon": "1Chr", "2paralipomenon": "2Chr", "qoheleth": "Eccl",
}
RESOLVE = {}
for b in BOOKS:
    for k in (b["osis"], b["sil"], b["name"]):
        RESOLVE[norm_key(k)] = b["osis"]
for k, v in ALIASES.items():
    RESOLVE.setdefault(norm_key(k), v)

def resolve_book(name):
    return RESOLVE.get(norm_key(name)) if name else None

STRONG_RE = re.compile(r"([HG])0*(\d{1,5})([A-Za-z]?)")

def norm_strong(s):
    m = STRONG_RE.search(s or "")
    return f"{m.group(1)}{int(m.group(2)):04d}" if m else None

def strip_html(s):
    s = re.sub(r"<br\s*/?>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()

def log(*a):
    print("[build]", *a, flush=True)

class Fetcher:
    def __init__(self, cache_dir, fixtures=None):
        self.cache_dir = cache_dir
        self.fixtures = fixtures
        os.makedirs(cache_dir, exist_ok=True)

    def get(self, url, key=None):
        if self.fixtures:
            path = os.path.join(self.fixtures, key or os.path.basename(urllib.parse.urlparse(url).path))
            if not os.path.exists(path):
                raise FileNotFoundError(f"fixture missing: {path}")
            return open(path, "rb").read()
        fname = re.sub(r"[^A-Za-z0-9._-]", "_", url)[-180:]
        cpath = os.path.join(self.cache_dir, fname)
        if os.path.exists(cpath) and os.path.getsize(cpath) > 0:
            return open(cpath, "rb").read()
        headers = {"User-Agent": "bible-study-app-build/1.0"}
        tok = os.environ.get("GITHUB_TOKEN")
        if tok and "api.github.com" in url:
            headers["Authorization"] = f"Bearer {tok}"
        last = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                open(cpath, "wb").write(data)
                log(f"downloaded {url} ({len(data)//1024} KB)")
                return data
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(2 * (attempt + 1))
        raise last

    def first(self, urls, key=None):
        errs = []
        for u in urls:
            try:
                return self.get(u, key), u
            except Exception as e:  # noqa: BLE001
                errs.append(f"{u}: {e}")
        raise RuntimeError("; ".join(errs))

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

# ---------------------------------------------------------------- translations
def parse_midvash(data):
    """Return {osis: [[verse texts of ch1], [ch2], ...]}."""
    doc = json.loads(data.decode("utf-8-sig"))
    books = doc.get("books", doc if isinstance(doc, list) else [])
    out = {}
    unmapped = []
    for i, bk in enumerate(books):
        name = bk.get("book") or bk.get("name") or bk.get("osis") or ""
        osis = resolve_book(name) or resolve_book(str(bk.get("osis", "")))
        if not osis and len(books) == 66:
            osis = BOOKS[i]["osis"]
        if not osis:
            unmapped.append(name)
            continue
        chapters = []
        for ch in bk.get("chapters", []):
            verses = ch.get("verses", [])
            arr = []
            for j, v in enumerate(verses):
                n = v.get("number") or v.get("verse") or (j + 1)
                try:
                    n = int(n)
                except (TypeError, ValueError):
                    n = j + 1
                while len(arr) < n:
                    arr.append("")
                arr[n - 1] = (v.get("text") or "").strip()
            chapters.append(arr)
        expected = next(b["ch"] for b in BOOKS if b["osis"] == osis)
        if abs(len(chapters) - expected) > 1:
            unmapped.append(f"{name} ({len(chapters)} ch, expected {expected} for {osis})")
            continue
        out[osis] = chapters
    if unmapped:
        log("  skipped books (not in 66-book canon):", ", ".join(unmapped[:20]))
    return out

def parse_vpl_books(data):
    """VPL zip -> {osis: [[verse texts ch1], ...]} in the edition's own numbering."""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in z.namelist() if n.lower().endswith("_vpl.txt")] or \
            [n for n in z.namelist() if n.lower().endswith(".txt")]
    if not names:
        raise RuntimeError("no VPL text file in zip")
    text = z.read(names[0]).decode("utf-8-sig", errors="replace")
    sil = {b["sil"]: b["osis"] for b in BOOKS}
    books = defaultdict(lambda: defaultdict(dict))
    for line in text.splitlines():
        m = VPL_RE.match(line.strip())
        if m and m.group(1) in sil:
            books[sil[m.group(1)]][int(m.group(2))][int(m.group(3))] = m.group(4).strip()
    out = {}
    for osis, chs in books.items():
        arr = []
        for c in range(1, max(chs) + 1):
            vs = chs.get(c, {})
            arr.append([vs.get(v, "") for v in range(1, (max(vs) if vs else 0) + 1)])
        out[osis] = arr
    return out

def build_translations(F, out, manifest):
    for vid, label, lang, lic, kind, slug in TRANSLATIONS:
        try:
            if kind == "mv":
                url = MV.format(lang=MV_LANG.get(lang, lang), slug=slug)
                data, used = F.first([url], key=f"{vid}.json")
                books = parse_midvash(data)
            else:
                data, used = F.first([EB.format(id=slug)], key=f"{vid}_vpl.zip")
                books = parse_vpl_books(data)
            if len(books) < 20:
                raise RuntimeError(f"only {len(books)} books parsed")
            search = []
            for osis, chs in books.items():
                write_json(os.path.join(out, "texts", vid, f"{osis}.json"), chs)
                bi = BOOK_INDEX[osis]
                for c, verses in enumerate(chs, 1):
                    for v, t in enumerate(verses, 1):
                        if t:
                            search.append([bi, c, v, t])
            search.sort()
            write_json(os.path.join(out, "search", f"{vid}.json"), search)
            manifest["translations"].append({"id": vid, "label": label, "lang": lang, "license": lic,
                                             "rtl": lang in ("he", "ar"), "books": len(books),
                                             "ot": any(BOOK_INDEX[b] < 39 for b in books),
                                             "nt": any(BOOK_INDEX[b] >= 39 for b in books), "source": used})
            log(f"translation {vid}: {len(books)} books, {len(search)} verses")
        except Exception as e:  # noqa: BLE001
            manifest["errors"].append(f"translation {vid}: {e}")
            log(f"WARNING translation {vid} failed: {e}")

# ---------------------------------------------------------------- septuagint (VPL)
VPL_RE = re.compile(r"^([1-4A-Z]{3})\s+(\d+):(\d+)\s+(.*)$")

def parse_vpl_zip(data):
    """Return {osis: {ch: {v: text}}} using the edition's own (LXX) numbering."""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in z.namelist() if n.lower().endswith("_vpl.txt")] or \
            [n for n in z.namelist() if n.lower().endswith(".txt")]
    if not names:
        raise RuntimeError("no VPL text file in zip")
    text = z.read(names[0]).decode("utf-8-sig", errors="replace")
    books = defaultdict(lambda: defaultdict(dict))
    alt = defaultdict(lambda: defaultdict(dict))  # ESG/DAG fallbacks
    for line in text.splitlines():
        m = VPL_RE.match(line.strip())
        if not m:
            continue
        code, c, v, t = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        if code in ("ESG", "DAG"):
            alt[resolve_book(code)][c][v] = t
            continue
        osis = next((b["osis"] for b in BOOKS if b["sil"] == code), None)
        if osis and BOOK_INDEX[osis] < 39:
            books[osis][c][v] = t
    for osis, chs in alt.items():
        if osis and osis not in books:
            books[osis] = chs
    return {k: {c: dict(vs) for c, vs in v.items()} for k, v in books.items()}

def build_lxx(F, out, manifest):
    for vid, label, lic, urls in LXX_SOURCES:
        try:
            data, used = F.first(urls, key=f"{vid}_vpl.zip")
            books = parse_vpl_zip(data)
            if len(books) < 30:
                raise RuntimeError(f"only {len(books)} OT books parsed")
            for osis, chs in books.items():
                write_json(os.path.join(out, "lxx", vid, f"{osis}.json"), chs)
            manifest["lxx"].append({"id": vid, "label": label, "license": lic,
                                    "books": len(books), "source": used})
            log(f"septuagint {vid}: {len(books)} books")
        except Exception as e:  # noqa: BLE001
            manifest["errors"].append(f"septuagint {vid}: {e}")
            log(f"WARNING septuagint {vid} failed: {e}")

# ---------------------------------------------------------------- STEPBible
# Negation words in the original languages (Strong's numbers): Hebrew lo', 'al, 'ayin, beli, bilti, bal;
# Greek ou, me, oudeis, oude, medeis, oute, mede, oukete, meketi.
NEG = {"H3808", "H0408", "H0369", "H1097", "H1115", "H1077", "G3756", "G3361", "G3762", "G3761", "G3367",
       "G3777", "G3366", "G3765", "G3371", "G3383"}
REF_RE = re.compile(r"^([1-3]?[A-Za-z]{2,5})\.(\d+)\.(\d+)[^#\t]*#(\d+)")

def step_file_list(F):
    info = json.loads(F.get(f"https://api.github.com/repos/{STEP_REPO}", key="step_repo.json"))
    branch = info.get("default_branch", "master")
    tree = json.loads(F.get(f"https://api.github.com/repos/{STEP_REPO}/git/trees/{branch}?recursive=1",
                            key="step_tree.json"))
    files = {}
    for item in tree.get("tree", []):
        p = item.get("path", "")
        base = os.path.basename(p)
        if item.get("type") != "blob" or not base.lower().endswith(".txt"):
            continue
        if re.search(r"(^|/)(old|archive|older)[^/]*/", p, re.I):
            continue
        for prefix in ("TAHOT", "TAGNT", "TBESH", "TBESG"):
            if base.upper().startswith(prefix):
                files.setdefault(prefix, {})
                # keep the shortest path for each distinct file name
                if base not in files[prefix] or len(p) < len(files[prefix][base]):
                    files[prefix][base] = p
    return branch, files

def step_download(F, branch, path):
    url = f"https://raw.githubusercontent.com/{STEP_REPO}/{branch}/" + urllib.parse.quote(path)
    return F.get(url, key="step/" + os.path.basename(path)).decode("utf-8-sig", errors="replace")

def col_index(header, *keys, default=None):
    for i, h in enumerate(header):
        hl = h.lower()
        if all(k in hl for k in keys):
            return i
    return default

def parse_tagged(text, kind):
    """Parse TAHOT (kind='heb') or TAGNT (kind='grk').
    Yields (osis, ch, v, word) where word = [text, translit, gloss, strong, morph, extra]."""
    header = None
    for raw in text.splitlines():
        if not raw.strip():
            continue
        cols = raw.split("\t")
        first = cols[0].strip()
        if first.lower().startswith(("eng (heb) ref", "word & type", "ref")) and len(cols) > 3:
            header = [c.strip() for c in cols]
            continue
        m = REF_RE.match(first)
        if not m:
            continue
        osis = resolve_book(m.group(1))
        if not osis:
            continue
        c, v = int(m.group(2)), int(m.group(3))
        g = lambda i: cols[i].strip() if i is not None and i < len(cols) else ""  # noqa: E731
        h = header or []
        if kind == "heb":
            word = g(col_index(h, "hebrew", default=1))
            translit = g(col_index(h, "transliteration", default=2))
            gloss = g(col_index(h, "translation", default=3))
            dstr = g(col_index(h, "dstrong", default=4))
            morph = g(col_index(h, "grammar", default=5))
            braces = re.findall(r"\{([^}]*)\}", dstr)
            cands = [norm_strong(x) for x in (braces or re.findall(r"[HG]\d+[A-Za-z]?", dstr))]
            cands = [x for x in cands if x and not x.startswith("H9")]
            strong = cands[-1] if cands else norm_strong(dstr)
            extra = ""
        else:
            gk = g(col_index(h, "greek", default=1))
            mm = re.match(r"^(.*?)\s*\((.*)\)\s*$", gk)
            word, translit = (mm.group(1), mm.group(2)) if mm else (gk, "")
            gloss = g(col_index(h, "english", default=2))
            sg = g(col_index(h, "dstrong", default=3))
            parts = sg.split("=", 1)
            strong = norm_strong(parts[0])
            morph = parts[1].strip() if len(parts) > 1 else ""
            ed = g(col_index(h, "edition", default=None))
            extra = ed if ed and not all(x in ed for x in ("NA28", "TR", "Byz")) else ""
        if not word:
            continue
        yield osis, c, v, [word, translit, gloss, strong or "", morph, extra]

def parse_lexicon(text):
    out = {}
    for raw in text.splitlines():
        cols = [c.strip() for c in raw.split("\t")]
        if not cols or not re.match(r"^[HG]\d{4}", cols[0]):
            continue
        key = norm_strong(cols[0])
        if not key or key in out:
            continue
        lemma_i = next((i for i, c in enumerate(cols[1:], 1)
                        if re.search(r"[֐-׿Ͱ-Ͽἀ-῿]", c)), None)
        if lemma_i is None:
            continue
        lemma = cols[lemma_i]
        translit = cols[lemma_i + 1] if lemma_i + 1 < len(cols) else ""
        rest = cols[lemma_i + 2:]
        morph = rest[0] if rest and ":" in rest[0] and len(rest[0]) < 20 else ""
        tail = rest[1:] if morph else rest
        gloss = tail[0] if tail else ""
        meaning = max(tail[1:], key=len) if len(tail) > 1 else ""
        out[key] = [lemma, translit, morph, strip_html(gloss), strip_html(meaning)[:4000]]
    return out

def build_step(F, out, manifest):
    try:
        branch, files = step_file_list(F)
    except Exception as e:  # noqa: BLE001
        manifest["errors"].append(f"STEPBible file list: {e}")
        log(f"WARNING STEPBible listing failed: {e}")
        return
    log("STEPBible files:", {k: sorted(v) for k, v in files.items()})
    occ = defaultdict(set)
    for prefix, kind, tag in (("TAHOT", "heb", "hebrew"), ("TAGNT", "grk", "greek")):
        chapters = defaultdict(lambda: defaultdict(list))
        count = 0
        for base, path in sorted(files.get(prefix, {}).items()):
            try:
                text = step_download(F, branch, path)
            except Exception as e:  # noqa: BLE001
                manifest["errors"].append(f"{base}: {e}")
                continue
            for osis, c, v, word in parse_tagged(text, kind):
                chapters[(osis, c)][str(v)].append(word)
                count += 1
        # occurrences; "!" marks a use with a negation word just before it (for topic polarity)
        for (osis, c), verses in chapters.items():
            for v, ws in verses.items():
                for j, w in enumerate(ws):
                    if w[3]:
                        neg = any(ws[k][3] in NEG for k in range(max(0, j - 3), j))
                        occ[w[3]].add(("!" if neg else "") + f"{osis}.{c}.{v}")
        for (osis, c), verses in chapters.items():
            write_json(os.path.join(out, "interlinear", osis, f"{c}.json"), verses)
        if count:
            manifest["original"][tag] = {"words": count, "chapters": len(chapters)}
            log(f"{prefix}: {count} words in {len(chapters)} chapters")
        else:
            manifest["errors"].append(f"{prefix}: no words parsed")
    # occurrence index, grouped by first 3 chars (H00 .. G56)
    groups = defaultdict(dict)
    def ref_key(r):
        b, c, v = r.lstrip("!").split(".")
        return (BOOK_INDEX.get(b, 99), int(c), int(v))
    for s, refs in occ.items():
        groups[s[:3]][s] = sorted(refs, key=ref_key)
    for gname, d in groups.items():
        write_json(os.path.join(out, "occ", f"{gname}.json"), d)
    lexcount = 0
    lexindex = []
    for prefix in ("TBESH", "TBESG"):
        lex = {}
        for base, path in sorted(files.get(prefix, {}).items()):
            try:
                lex.update({k: v for k, v in parse_lexicon(step_download(F, branch, path)).items()
                            if k not in lex})
            except Exception as e:  # noqa: BLE001
                manifest["errors"].append(f"{base}: {e}")
        lg = defaultdict(dict)
        for k, v in lex.items():
            lg[k[:3]][k] = v
            lexindex.append([k, v[0], v[1], v[3][:80], len({r.lstrip("!") for r in occ.get(k, ())})])
        for gname, d in lg.items():
            write_json(os.path.join(out, "lex", f"{gname}.json"), d)
        lexcount += len(lex)
    manifest["original"]["lexicon_entries"] = lexcount
    if lexindex:
        write_json(os.path.join(out, "lexindex.json"), lexindex)

# ---------------------------------------------------------------- cross references
def parse_ref(s):
    """'Gen.1.1' or 'Prov.8.22-Prov.8.30' -> normalized 'Prov.8.22-Prov.8.30' with OSIS books."""
    parts = s.strip().split("-")
    outp = []
    for p in parts:
        m = re.match(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$", p.strip())
        if not m:
            return None
        b = resolve_book(m.group(1))
        if not b:
            return None
        outp.append(f"{b}.{int(m.group(2))}.{int(m.group(3))}")
    return "-".join(outp)

def build_xrefs(F, out, manifest):
    try:
        data, used = F.first(XREF_URLS, key="cross-references.zip")
        z = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        text = z.read(name).decode("utf-8-sig", errors="replace")
        per_book = defaultdict(lambda: defaultdict(list))
        n = 0
        for line in text.splitlines():
            cols = line.split("\t")
            if len(cols) < 3 or cols[0].lower().startswith("from"):
                continue
            fr, to = parse_ref(cols[0]), parse_ref(cols[1])
            if not fr or not to or "-" in fr:
                continue
            try:
                votes = int(cols[2])
            except ValueError:
                votes = 0
            b, c, v = fr.split(".")
            per_book[b][f"{c}.{v}"].append([to, votes])
            n += 1
        for b, verses in per_book.items():
            trimmed = {}
            for k, lst in verses.items():
                lst.sort(key=lambda x: -x[1])
                trimmed[k] = [x for x in lst if x[1] >= 0][:40]
            write_json(os.path.join(out, "xref", f"{b}.json"), trimmed)
        manifest["xref"] = {"count": n, "source": used}
        log(f"cross references: {n}")
    except Exception as e:  # noqa: BLE001
        manifest["errors"].append(f"cross references: {e}")
        log(f"WARNING cross references failed: {e}")

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "site", "data"))
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache"))
    ap.add_argument("--fixtures", default=None, help="offline test: read sources from this folder")
    args = ap.parse_args()
    F = Fetcher(args.cache, args.fixtures)
    manifest = {"built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "translations": [], "lxx": [], "original": {}, "xref": None,
                "attribution": ATTRIBUTION, "errors": []}
    build_translations(F, args.out, manifest)
    build_lxx(F, args.out, manifest)
    build_step(F, args.out, manifest)
    build_xrefs(F, args.out, manifest)
    write_json(os.path.join(args.out, "manifest.json"), manifest)
    if manifest["errors"]:
        log("finished with warnings:\n  " + "\n  ".join(manifest["errors"]))
    else:
        log("finished with no errors")
    if not manifest["translations"]:
        log("FATAL: no translation could be built")
        sys.exit(1)

if __name__ == "__main__":
    main()
