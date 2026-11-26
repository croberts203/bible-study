import { CONFIG } from "./config.js";
import { renderHebrew, hebNum, noAccents } from "./hebrew.js";
import { MODES, speak, stop as stopSpeech, speakable, availability } from "./speech.js";
import { store } from "./store.js";
import { decode } from "./morph.js";
import { compareChapter, chapterStats, level, LEVEL_LABEL, compareTexts } from "./compare.js";
import {
  BOOKS, setBooks, book, parseOsis, fmtRef, parseUserRef, lxxChapters, lxxNote, planDays, PLANS,
} from "./refs.js";

// ---------------------------------------------------------------- tiny DOM helper
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") throw new Error("no raw html");
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (s) => document.querySelector(s);
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
const main = () => $("#main");

// ---------------------------------------------------------------- data loading
const cache = new Map();
function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(path);
}
const D = "../data/";
let manifest = { translations: [], lxx: [], original: {}, xref: null, errors: [] };
let diffs = { items: [], categories: {} };
let contra = { items: [], categories: {} };
let hard = { items: [], categories: {}, stances: {} };
let history = { periods: [], books: {}, artifacts: [], scripts: [], claims: [] };
let KEYWORDS = {};

const textBook = (ver, b) => getJSON(`${D}texts/${ver}/${b}.json`);
const lxxBook = (id, b) => getJSON(`${D}lxx/${id}/${b}.json`);
const interlinear = (b, c) => getJSON(`${D}interlinear/${b}/${c}.json`);
const xrefBook = (b) => getJSON(`${D}xref/${b}.json`);
const lexGroup = (s) => getJSON(`${D}lex/${s.slice(0, 3)}.json`);
const occGroup = (s) => getJSON(`${D}occ/${s.slice(0, 3)}.json`);
const commentaryCh = (cid, b, c) => getJSON(`${D}commentary/${cid}/${b}/${c}.json`);
const comms = (t) => (manifest.commentaries || []).filter((x) => x.chapters && (!t || x[t.toLowerCase()]));
const noteSource = (t) => { const list = comms(t); return list.find((x) => x.id === settings.noteSource) || list[0] || null; };
/** Occurrence refs without the "!" negation marker, de-duplicated, in order. */
const occRefs = (list) => [...new Set((list || []).map((r) => r.replace(/^!/, "")))];

const verseIndex = new Map(); // ver -> Promise<Map("bi.c.v" -> text)>
function verseMap(ver) {
  if (!verseIndex.has(ver)) {
    verseIndex.set(ver, getJSON(`${D}search/${ver}.json`).then((rows) => {
      const m = new Map();
      for (const [bi, c, v, t] of rows || []) m.set(`${bi}.${c}.${v}`, t);
      m.rows = rows || [];
      return m;
    }));
  }
  return verseIndex.get(ver);
}
async function verseText(ver, ref) {
  const r = typeof ref === "string" ? parseOsis(ref) : ref;
  const b = r && book(r.b);
  if (!b) return "";
  const m = await verseMap(ver);
  if (!r.v) return m.get(`${b.i}.${r.c}.1`) || "";
  const end = r.v2 && (!r.c2 || r.c2 === r.c) ? Math.min(r.v2, r.v + 6) : r.v;
  const parts = [];
  for (let v = r.v; v <= end; v++) { const t = m.get(`${b.i}.${r.c}.${v}`); if (t) parts.push(t); }
  const out = parts.join(" ");
  if (!out && ver !== "kjv" && manifest.translations.some((t) => t.id === "kjv")) return verseText("kjv", r);
  return out;
}

// ---------------------------------------------------------------- settings
const SKEY = "bible-study:settings:v1";
const settings = Object.assign(
  { versionsOT: ["kjv"], versionsNT: ["kjv"], original: true, gloss: true, lxx: false, lxxeng: false, compare: false, hard: true, footnotes: true, explain: true, noteSource: "tyndale",
    script: "masoretic", rate: 0.85, size: 18, theme: "auto" },
  (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })(),
);
if (settings.versions) { settings.versionsOT = settings.versionsNT = settings.versions; delete settings.versions; }
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} applySettings(); }
function applySettings() {
  document.documentElement.style.setProperty("--fs", settings.size + "px");
  document.documentElement.dataset.theme = settings.theme;
}
const trans = (id) => manifest.translations.find((t) => t.id === id);
const primaryVer = () => [...settings.versionsNT, ...settings.versionsOT].find((v) => trans(v)?.ot && trans(v)?.nt)
  || (trans("kjv") ? "kjv" : manifest.translations[0]?.id) || "kjv";
/** Translations chosen for a testament that actually contain it. */
function chosenFor(t) {
  const list = (t === "OT" ? settings.versionsOT : settings.versionsNT).filter((x) => trans(x) && trans(x)[t.toLowerCase()]);
  if (!list.length) { const d = manifest.translations.find((x) => x[t.toLowerCase()]); if (d) list.push(d.id); }
  return list;
}
const LANG_NAME = { en: "English", he: "Hebrew", gr: "Greek", la: "Latin", ar: "Arabic", zh: "Chinese", cs: "Czech", nl: "Dutch",
  eo: "Esperanto", fr: "French", de: "German", hu: "Hungarian", it: "Italian", pl: "Polish", pt: "Portuguese", ro: "Romanian",
  ru: "Russian", sv: "Swedish", uk: "Ukrainian", vi: "Vietnamese" };
const verLabel = (id) => manifest.translations.find((t) => t.id === id)?.label || id.toUpperCase();
const hasLxx = (id) => manifest.lxx.some((l) => l.id === id);
const lxxG = () => (hasLxx(settings.lxxG) ? settings.lxxG : "lxx");
const lxxE = () => (hasLxx(settings.lxxE) ? settings.lxxE : "lxxeng");
const lxxLabel = (id) => manifest.lxx.find((l) => l.id === id)?.label || id;

// ---------------------------------------------------------------- side panel
function openPanel(title, ...content) {
  const p = $("#panel");
  fill(p, 
    h("div", { class: "panel-head" }, h("h2", {}, title),
      h("button", { class: "icon", "aria-label": "Close", onclick: closePanel }, "✕")),
    h("div", { class: "panel-body" }, ...content),
  );
  p.classList.add("open");
  document.body.classList.add("panel-open");
  p.querySelector(".panel-body").scrollTop = 0;
}
function closePanel() { $("#panel").classList.remove("open"); document.body.classList.remove("panel-open"); }
const loading = () => h("p", { class: "muted" }, "Loading…");

function refLink(ref, label) {
  const r = parseOsis(ref);
  if (!r) return h("span", {}, ref);
  return h("a", { href: `#/read/${r.b}/${r.c}${r.v ? "/" + r.v : ""}`, onclick: closePanel }, label || fmtRef(ref));
}

// ---------------------------------------------------------------- router
const routes = { read: viewRead, search: viewSearch, differences: viewDifferences, compare: viewCompare, contradictions: viewContradictions, topic: viewTopic, study: viewStudy, hard: viewHard, history: viewHistory, full: viewFull, plans: viewPlans,
  saved: viewSaved, settings: viewSettings, about: viewAbout };
function route() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const name = routes[parts[0]] ? parts[0] : "read";
  const tabOf = { compare: "study", differences: "study", contradictions: "study", topic: "study", hard: "study", history: "study", full: "read", about: "settings" };
  for (const a of document.querySelectorAll("nav a")) a.classList.toggle("active", a.dataset.r === (tabOf[name] || name));
  closePanel();
  stopSpeech();
  routes[name](parts.slice(1), new URLSearchParams(query || ""));
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- reader
const LAST = "bible-study:last";
const HL_COLORS = ["yellow", "green", "blue", "pink", "orange"];

async function viewRead([b, c, v]) {
  let bk = book(b);
  if (!bk) {
    const last = (localStorage.getItem(LAST) || "John.1").split(".");
    bk = book(last[0]) || book("John"); c = last[1] || 1;
  }
  c = Math.max(1, Math.min(bk.ch, parseInt(c, 10) || 1));
  try { localStorage.setItem(LAST, `${bk.osis}.${c}`); } catch {}
  const isOT = bk.t === "OT";
  const m = main();
  fill(m, readerToolbar(bk, c), h("div", { id: "chapter" }, loading()));

  const vers = chosenFor(bk.t);
  const lxxCh = isOT ? lxxChapters(bk.osis, c) : [];
  const ns = settings.explain ? noteSource(bk.t) : null;
  const [texts, orig, lxxG, lxxE, comm] = await Promise.all([
    Promise.all(vers.map((x) => textBook(x, bk.osis))),
    settings.original || settings.footnotes ? interlinear(bk.osis, c) : null,
    isOT && settings.lxx && hasLxx(lxxG()) ? lxxBook(lxxG(), bk.osis) : null,
    isOT && (settings.lxxeng || settings.compare) && hasLxx(lxxE()) ? lxxBook(lxxE(), bk.osis) : null,
    ns ? commentaryCh(ns.id, bk.osis, c) : null,
  ]);
  const chapterTexts = texts.map((t) => (t && t[c - 1]) || []);
  const origData = orig;
  const lxxVerses = (bookData) => {
    if (!bookData) return null;
    const out = {};
    lxxCh.forEach((lc, idx) => {
      const ch = bookData[String(lc)] || {};
      for (const [vn, t] of Object.entries(ch)) {
        const key = lxxCh.length > 1 ? `${lc}:${vn}` : vn;
        out[key] = t;
      }
      if (lxxCh.length > 1 && idx === 0) out.__split = true;
    });
    return out;
  };
  const lg = lxxVerses(lxxG), le = lxxVerses(lxxE);
  const split = lg?.__split || le?.__split;
  const compareOn = isOT && settings.compare && le;
  const nVerses = Math.max(0, ...chapterTexts.map((t) => t.length),
    ...Object.keys(orig || {}).map(Number),
    ...(!split && !compareOn ? [...Object.keys(lg || {}), ...Object.keys(le || {})].map(Number).filter(Boolean) : []));

  // automatic Hebrew <-> Septuagint comparison (KJV from the Hebrew vs Brenton from the Greek)
  const baseIdx = Math.max(0, vers.indexOf("kjv"));
  const cmp = isOT && settings.compare && le && chapterTexts[baseIdx]?.length
    ? compareChapter(chapterTexts[baseIdx], Object.fromEntries(Object.entries(le).filter(([k]) => !k.startsWith("__"))))
    : null;
  const cols = [
    ...vers.map((x, i) => ({ kind: "tr", id: x, base: Boolean(cmp) && i === baseIdx,
      label: verLabel(x).replace(/\s*\(.*\)/, "") + (cmp && i === baseIdx ? " — from the Hebrew" : ""), data: chapterTexts[i] })),
    ...(orig && settings.original ? [{ kind: "orig", label: isOT ? "Hebrew" : "Greek", data: orig }] : []),
    ...(lg && !split ? [{ kind: "lxx", label: "Septuagint (Greek)", data: lg }] : []),
    ...(cmp ? [{ kind: "lxxeng", cmp: true, label: "Septuagint (English) — matched", data: {} }]
      : le && !split ? [{ kind: "lxxeng", label: "Septuagint (English)", data: le }] : []),
  ];

  const here = diffs.items.filter((d) => [d.ot, ...(d.nt || [])].some((r) => {
    const p = parseOsis(r); return p && p.b === bk.osis && p.c === c;
  }));
  const diffByVerse = new Map();
  for (const d of here) for (const r of [d.ot, ...(d.nt || [])]) {
    const p = parseOsis(r);
    if (p && p.b === bk.osis && p.c === c) {
      if (!diffByVerse.has(p.v)) diffByVerse.set(p.v, []);
      if (!diffByVerse.get(p.v).includes(d)) diffByVerse.get(p.v).push(d);
    }
  }

  const notes = settings.footnotes || settings.explain ? buildFootnotes(bk, c, nVerses, origData, diffByVerse, comm, ns) : new Map();
  const note = isOT && (settings.lxx || settings.lxxeng) ? lxxNote(bk.osis, c) : "";
  const missing = [];
  if (settings.original && !orig && manifest.original?.hebrew) missing.push(`${isOT ? "Hebrew" : "Greek"} text`);
  if (isOT && settings.lxx && !lg) missing.push("Septuagint");
  const chapter = h("div", { id: "chapter", class: `cols-${cols.length}`, style: `--ncols:${cols.length}` },
    h("h1", { class: "ch-title" }, `${bk.name} ${c}`),
    historyStrip(bk, c),
    comm?.i ? h("details", { class: "notice chapter-intro" }, h("summary", {}, `About ${bk.name} ${c} — ${ns.name}`), h("p", {}, comm.i)) : null,
    note ? h("p", { class: "notice" }, note) : null,
    missing.length && manifest.built ? h("p", { class: "muted small" }, `Not available for this chapter: ${missing.join(", ")}.`) : null,
    (() => {
      if (!settings.hard) return null;
      const hs = hard.items.filter((x) => x.refs.some((r) => { const p = parseOsis(r); return p && p.b === bk.osis && c >= p.c && c <= (p.c2 || p.c); }));
      return hs.length ? h("p", { class: "notice hard-notice" }, "⚠ This chapter contains: ",
        hs.map((x, i) => [i ? "; " : "", h("button", { class: "linkish", onclick: () => hardPanel(x) }, x.title)])) : null;
    })(),

    h("div", { class: "col-heads" }, h("span", {}), cols.map((col) => h("span", { class: `col-head ${col.kind}` }, col.label))),
    cmp ? compareSummary(cmp, le) : null,
    ...Array.from({ length: nVerses }, (_, i) => verseRow(bk, c, i + 1, cols, notes.get(i + 1), cmp?.verses[i + 1], le)),
    notes.size ? footnoteList(bk, c, notes) : null,
    cmp?.extra.length ? extraLxxBlock(cmp.extra) : null,
    split && !cmp ? lxxSplitBlock(lxxCh, lg, le) : null,
    chapterNav(bk, c),
  );
  $("#chapter").replaceWith(chapter);
  if (v) {
    const el = document.getElementById(`v${v}`);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); }
  } else window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- outside links for readers
function hubSlug(osis) {
  if (osis === "Song") return "songs";
  if (osis === "Ps") return "psalms";
  return (book(osis)?.name || osis).toLowerCase().replace(/\s+/g, "_");
}
function extLink(href, label) { return h("a", { href, target: "_blank", rel: "noopener", class: "ext" }, label, " ↗"); }
/** Links to read one passage on other Bible sites. */
function passageLinks(ref) {
  const p = parseOsis(ref);
  if (!p) return null;
  const v = p.v || 1;
  return h("div", { class: "ext-links small" },
    extLink(`https://www.biblegateway.com/passage/?search=${encodeURIComponent(fmtRef(ref))}&version=KJV;NIV;ESV;NRSVUE`, "Compare translations"),
    extLink(`https://biblehub.com/${hubSlug(p.b)}/${p.c}-${v}.htm`, "Commentaries (BibleHub)"),
    extLink(`https://biblehub.com/interlinear/${hubSlug(p.b)}/${p.c}-${v}.htm`, "Interlinear"),
    extLink(`https://www.stepbible.org/?q=reference=${p.b}.${p.c}.${v}`, "STEP Bible"));
}
/** "Learn more" links: curated Wikipedia articles plus searches for both sides of the debate. */
function learnMore(title, refs, wiki, kind) {
  const q = `${title} ${refs.slice(0, 2).map((r) => fmtRef(r)).join(" ")}`;
  const ddg = (extra) => `https://duckduckgo.com/?q=${encodeURIComponent(`${q} ${extra}`)}`;
  return [h("h3", {}, "Learn more"),
    h("ul", { class: "ext-list" },
      (wiki || []).map((u) => h("li", {}, extLink(u, `Wikipedia: ${decodeURIComponent(u.split("/wiki/")[1]).replace(/_/g, " ")}`))),
      h("li", {}, extLink(`https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`, "Scholarly articles (Google Scholar)")),
      h("li", {}, extLink(ddg(kind === "morality" ? "Christian explanation" : "explanation apologetics"), "How Christian writers explain it")),
      h("li", {}, extLink(ddg(kind === "morality" ? "moral problem critique" : "contradiction skeptic"), "Skeptical and critical views")),
      kind === "history" ? h("li", {}, extLink(ddg("archaeology evidence"), "Archaeology and historical evidence")) : null),
    h("p", { class: "muted tiny" }, "Links open outside sites. Search results are not checked or endorsed by this app.")];
}

// ---------------------------------------------------------------- footnotes
const FN_ICON = { context: "✎", word: "א", aramaic: "𐡀", diff: "⚑", contra: "⚖", hard: "⚠", claim: "🏛", artifact: "🏺" };
const FN_KIND = { context: "Explanation", word: "Original language", aramaic: "Aramaic", diff: "Text difference", contra: "Contradiction", hard: "Hard passage", claim: "History check", artifact: "Archaeology" };
function letterFor(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(97 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
const covers = (refs, b, c, v) => refs.some((r) => refCovers(r, b, c, v));

function buildFootnotes(bk, c, nVerses, words, diffByVerse, comm, ns) {
  const out = new Map();
  const seenWord = new Set();
  let aramaicDone = false, n = 0;
  const heb = bk.t === "OT";
  for (let v = 1; v <= nVerses; v++) {
    const list = [];
    const ctext = comm?.v?.[String(v)];
    if (ctext) list.push({ kind: "context", label: `Explanation — ${ns.name}`, short: ctext, open: () => contextPanel(bk, c, v) });
    if (!settings.footnotes) { if (list.length) { list.forEach((x) => (x.letter = letterFor(n++))); out.set(v, list); } continue; }
    const ws = words?.[String(v)] || [];
    ws.forEach((w, i) => {
      const kw = KEYWORDS[w[3]];
      if (kw && !seenWord.has(w[3])) {
        seenWord.add(w[3]);
        list.push({ kind: "word", label: `${heb ? renderHebrew(w[0], "plain") : w[0]} — ${kw.word}`, short: kw.note,
          open: () => wordPanel(w, heb, `${bk.osis}.${c}.${v}`, i) });
      }
      if (heb && !aramaicDone && /^A/.test(w[4] || "")) {
        aramaicDone = true;
        list.push({ kind: "aramaic", label: "This passage is in Aramaic", short: history.aramaic || "", open: () => openPanel("Aramaic", h("p", {}, history.aramaic || "")) });
      }
    });
    for (const d of diffByVerse.get(v) || []) list.push({ kind: "diff", label: d.title, short: `Hebrew: ${d.mt} · Septuagint: ${d.lxx}`, open: () => diffPanel(d) });
    for (const x of contra.items) if (covers(x.passages.map((p) => p.ref), bk.osis, c, v)) list.push({ kind: "contra", label: x.title, short: x.passages.map((p) => `${fmtRef(p.ref)}: ${p.says}`).join(" / "), open: () => contraPanel(x) });
    if (settings.hard) for (const x of hardFor(bk.osis, c, v)) list.push({ kind: "hard", label: x.title, short: x.what, open: () => hardPanel(x) });
    for (const x of history.claims || []) if (covers(x.refs, bk.osis, c, v)) list.push({ kind: "claim", label: `${x.claim} — ${history.claimStatus?.[x.status] || x.status}`, short: x.evidence, open: () => claimPanel(x), status: x.status });
    for (const x of history.artifacts) if (covers(x.refs, bk.osis, c, v)) list.push({ kind: "artifact", label: `${x.name} (${x.date})`, short: x.what, open: () => artifactPanel(x) });
    if (list.length) { list.forEach((x) => (x.letter = letterFor(n++))); out.set(v, list); }
  }
  return out;
}
function footnoteList(bk, c, notes) {
  return h("section", { class: "footnotes" },
    h("h2", {}, "Notes"),
    h("p", { class: "muted small" }, "Tap a letter in the text, or a note below, for the full explanation. ",
      Object.entries(FN_KIND).map(([k, l]) => h("span", { class: `fn-legend fn-${k}` }, `${FN_ICON[k]} ${l}`))),
    h("ol", { class: "fn-list" }, [...notes.entries()].flatMap(([v, list]) => list.map((n) =>
      h("li", { class: `fn-${n.kind}` },
        h("span", { class: "fn-letter" }, n.letter),
        h("div", {},
          h("button", { class: "linkish fn-title", onclick: n.open }, `${FN_ICON[n.kind]} ${n.label}`),
          h("span", { class: "muted small" }, ` · v. ${v}`),
          h("div", { class: "small fn-short" }, n.short.length > 220 ? n.short.slice(0, 220) + "…" : n.short)))))));
}
async function contextPanel(bk, c, v) {
  const list = comms(bk.t);
  const ref = `${bk.osis}.${c}.${v}`;
  const body = h("div", {}, loading());
  let current = noteSource(bk.t)?.id || list[0]?.id;
  openPanel(`Explanation — ${fmtRef(ref)}`, body);
  const draw = async () => {
    const meta = list.find((x) => x.id === current);
    const ch = meta ? await commentaryCh(meta.id, bk.osis, c) : null;
    let text = ch?.v?.[String(v)], from = v;
    if (!text && ch?.v) {   // commentaries often comment on a passage at its first verse
      for (let back = v - 1; back >= Math.max(1, v - 8); back--) if (ch.v[String(back)]) { text = ch.v[String(back)]; from = back; break; }
    }
    const verseEng = await verseText(primaryVer(), ref);
    fill(body,
      h("p", { class: "verse-quote" }, verseEng),
      h("div", { class: "chips" }, list.map((x) => h("button", { class: `chip${x.id === current ? " on" : ""}`, onclick: () => { current = x.id; draw(); } },
        x.name.replace(/ Bible Commentary| Commentary on the Whole Bible| Commentary/, "")))),
      meta ? h("p", { class: "muted small" }, meta.about) : null,
      text ? [from !== v ? h("p", { class: "muted small" }, `Note on ${fmtRef(`${bk.osis}.${c}.${from}`)}, which covers this verse:`) : null,
        h("div", { class: "commentary-text" }, text.split(/\n+/).map((p) => h("p", {}, p)))]
        : h("p", { class: "muted" }, ch ? "No note on this verse in this commentary — try another." : "This commentary isn't available for this chapter."),
      ch?.i ? h("details", {}, h("summary", {}, "Introduction to this chapter"), h("p", { class: "small" }, ch.i)) : null,
      meta ? h("p", { class: "muted tiny" }, "Source: ", meta.name, " via the HelloAO Free Use Bible API. ", meta.license ? h("a", { href: meta.license, target: "_blank", rel: "noopener" }, "License") : null,
        meta.licenseNotes ? ` — ${meta.licenseNotes}` : "") : null);
  };
  draw();
}
function claimPanel(x) {
  openPanel("History check",
    h("p", {}, h("strong", {}, x.claim)),
    h("p", {}, h("span", { class: `claim-status cs-${x.status}` }, history.claimStatus?.[x.status] || x.status)),
    h("h3", {}, "The biblical text"), h("ul", {}, x.refs.map((r) => h("li", {}, refLink(r)))),
    h("h3", {}, "Outside evidence"), h("p", {}, x.evidence),
    x.other ? [h("h3", {}, "Other views"), h("p", {}, x.other)] : null,
    x.refs.map((r) => [h("div", { class: "small" }, fmtRef(r)), passageLinks(r)]),
    learnMore(x.claim, x.refs, x.wiki, "history"),
    h("p", {}, h("a", { href: "#/history?tab=claims", onclick: closePanel }, "All history checks ›")));
}

function diffTokens(toks, side) {
  return toks.map((x) => (x.word && x.show ? h("mark", { class: `only-${side}`, title: side === "mt" ? "Not in the Septuagint here" : "Not in the Hebrew here" }, x.t) : x.t));
}
function compareSummary(cmp, le) {
  const st = chapterStats(cmp);
  return h("div", { class: "notice cmp-summary" },
    h("strong", {}, "Hebrew ↔ Septuagint: "),
    st.major + st.minor + st.missing + st.extra === 0 ? "the two texts say the same thing throughout this chapter. "
      : [st.major ? `${st.major} major difference${st.major > 1 ? "s" : ""}, ` : "",
         st.minor ? `${st.minor} smaller difference${st.minor > 1 ? "s" : ""}, ` : "",
         st.missing ? `${st.missing} verse${st.missing > 1 ? "s" : ""} not in the Septuagint, ` : "",
         st.extra ? `${st.extra} Septuagint verse${st.extra > 1 ? "s" : ""} with no Hebrew match. ` : ""],
    h("div", { class: "legend small" },
      h("mark", { class: "only-mt" }, "only in the Hebrew"), " ", h("mark", { class: "only-lxx" }, "only in the Septuagint"),
      " — compared through two literal English translations (KJV from the Hebrew, Brenton from the Greek), so a few highlights are just different word choices. ",
      h("button", { class: "linkish", onclick: () => { settings.compare = false; saveSettings(); route(); } }, "Turn off")));
}
function extraLxxBlock(extra) {
  return h("section", { class: "lxx-block" }, h("h3", {}, "Only in the Septuagint"),
    h("p", { class: "muted small" }, "These Septuagint verses in this chapter didn't match any verse of the Hebrew text (Septuagint numbering)."),
    extra.map((x) => h("div", { class: "verse lxxsplit" }, h("span", { class: "vnum static" }, x.key),
      h("div", { class: "cell lxxeng" }, h("mark", { class: "only-lxx" }, x.text)))));
}

function verseRow(bk, c, v, cols, fns, cv, le) {
  const ref = `${bk.osis}.${c}.${v}`;
  const hlist = settings.hard ? hardFor(bk.osis, c, v) : [];
  const hl = store.get("highlights", ref);
  const hasNote = Boolean(store.get("notes", ref));
  const bm = Boolean(store.get("bookmarks", ref));
  return h("div", { class: `verse${hl ? " hl-" + hl : ""}${hlist.length ? " hard" : ""}`, id: `v${v}` },
    h("button", { class: "vnum", title: "Verse tools", onclick: () => versePanel(bk, c, v) }, v,
      hasNote ? h("span", { class: "dot note" }, "✎") : null, bm ? h("span", { class: "dot" }, "★") : null),
    ...cols.map((col, ci) => {
      const marks = ci === 0 && fns?.length ? h("span", { class: "fn-marks" }, fns.map((n) =>
        h("button", { class: `fn-mark fn-${n.kind}`, title: n.label, onclick: n.open }, n.letter))) : null;
      if (col.kind === "orig") return origCell(bk, col.data[String(v)] || [], ref);
      if (col.base && cv) return h("div", { class: "cell tr", lang: "en" }, diffTokens(cv.a, "mt"), marks);
      if (col.cmp) {
        if (!cv || cv.missingB) return h("div", { class: "cell lxxeng missing" }, cv ? "— not in the Septuagint —" : "");
        const k = cv.lxxKey;
        const shown = k !== String(v) ? h("span", { class: "lxxnum" }, `LXX ${k.includes(":") ? k.replace(":", ".") : "v. " + k} `) : null;
        return h("div", { class: "cell lxxeng", lang: "en" }, shown, diffTokens(cv.b, "lxx"));
      }
      const t = Array.isArray(col.data) ? col.data[v - 1] : col.data[String(v)];
      const tinfo = col.kind === "tr" ? trans(col.id) : null;
      const lang = col.kind === "lxx" ? "grc" : tinfo?.lang || "en";
      return h("div", { class: `cell ${col.kind}${tinfo?.rtl ? " rtl" : ""}`, lang, dir: tinfo?.rtl ? "rtl" : null }, t || "", marks);
    }),
    ["major", "minor", "missing-lxx"].includes(level(cv)) ? h("div", { class: "diff-badges" },
      h("span", { class: `lvl lvl-${level(cv)}` }, LEVEL_LABEL[level(cv)])) : null,
  );
}

function origCell(bk, words, ref) {
  const heb = bk.t === "OT";
  return h("div", { class: `cell orig ${heb ? "heb" : "grk"} script-${heb ? settings.script : "greek"}`, dir: heb ? "rtl" : "ltr", lang: heb ? "hbo" : "grc" },
    words.map((w, i) => h("button", { class: "w", onclick: () => wordPanel(w, heb, ref, i) },
      h("span", { class: "wt" }, heb ? renderHebrew(w[0], settings.script) : w[0]),
      settings.gloss ? h("span", { class: "wg", dir: "ltr" }, w[2].replace(/\//g, " ").replace(/\s+/g, " ").trim()) : null)));
}

function lxxSplitBlock(lxxCh, lg, le) {
  const rows = [];
  for (const lc of lxxCh) {
    const keys = Object.keys(lg || le || {}).filter((k) => k.startsWith(`${lc}:`));
    rows.push(h("h3", {}, `Septuagint Psalm ${lc}`));
    for (const k of keys) {
      const vn = k.split(":")[1];
      rows.push(h("div", { class: "verse lxxsplit" }, h("span", { class: "vnum static" }, vn),
        lg ? h("div", { class: "cell lxx", lang: "grc" }, lg[k] || "") : null,
        le ? h("div", { class: "cell lxxeng" }, le[k] || "") : null));
    }
  }
  return h("section", { class: "lxx-block" },
    h("p", { class: "notice" }, "In the Septuagint this psalm is divided differently, so it is shown separately in its own numbering."),
    rows);
}

function readerToolbar(bk, c) {
  const bookSel = h("select", { "aria-label": "Book", onchange: (e) => (location.hash = `#/read/${e.target.value}/1`) },
    h("optgroup", { label: "Old Testament" }, BOOKS.filter((b) => b.t === "OT").map((b) =>
      h("option", { value: b.osis, selected: b.osis === bk.osis }, b.name))),
    h("optgroup", { label: "New Testament" }, BOOKS.filter((b) => b.t === "NT").map((b) =>
      h("option", { value: b.osis, selected: b.osis === bk.osis }, b.name))));
  const chSel = h("select", { "aria-label": "Chapter", onchange: (e) => (location.hash = `#/read/${bk.osis}/${e.target.value}`) },
    Array.from({ length: bk.ch }, (_, i) => h("option", { value: i + 1, selected: i + 1 === c }, i + 1)));
  const toggle = (key, label, enabled = true, hint = "") => enabled ? h("label", { class: "picker-item" },
    h("input", { type: "checkbox", checked: settings[key], onchange: (e) => { settings[key] = e.target.checked; saveSettings(); route(); } }),
    h("span", {}, label, hint ? h("span", { class: "muted small" }, ` — ${hint}`) : null)) : null;
  const key = bk.t === "OT" ? "versionsOT" : "versionsNT";
  const avail = manifest.translations.filter((t) => t[bk.t.toLowerCase()]);
  const langs = [...new Set(avail.map((t) => t.lang || "en"))];
  const chosen = chosenFor(bk.t);
  const verChips = h("details", { class: "picker" },
    h("summary", { class: "chip" }, "Translations: ",
      h("strong", {}, chosen.map((x) => x.toUpperCase()).join(", ") || "none"), " ▾"),
    h("div", { class: "picker-body" },
      h("p", { class: "muted small" }, `Pick any translations for the ${bk.t === "OT" ? "Old" : "New"} Testament; they show side by side. ` +
        `The ${bk.t === "OT" ? "New" : "Old"} Testament keeps its own choice.`),
      langs.map((lg) => h("div", { class: "picker-group" }, h("div", { class: "picker-lang" }, LANG_NAME[lg] || lg),
        avail.filter((t) => (t.lang || "en") === lg).map((t) => h("label", { class: "picker-item" },
          h("input", { type: "checkbox", checked: chosen.includes(t.id), onchange: (e) => {
            const cur = chosenFor(bk.t);
            settings[key] = e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id);
            saveSettings(); route();
          } }), h("span", {}, t.label), h("span", { class: "muted small" }, ` · ${t.license}`)))))));
  const scriptSel = bk.t === "OT" && settings.original && manifest.original?.hebrew ? h("label", { class: "picker-item" }, "Hebrew script: ",
    h("select", { onchange: (e) => { settings.script = e.target.value; saveSettings(); route(); } },
      [["masoretic", "Masoretic, with accents (AD 1008)"], ["plain", "Vowels only (modern Bibles)"],
       ["consonants", "Consonants (Dead Sea Scrolls)"], ["paleo", "Paleo-Hebrew (First Temple)"]]
        .map(([v, l]) => h("option", { value: v, selected: settings.script === v }, l)))) : null;
  const fullLink = (manifest.original?.hebrew || manifest.original?.greek)
    ? h("a", { class: "chip", href: `#/full/${bk.osis}/${c}` }, "🔊 Listen", h("span", { class: "hide-sm" }, bk.t === "OT" ? " · full Hebrew" : " · full Greek")) : null;
  const hasOrig = Boolean(manifest.original?.hebrew || manifest.original?.greek);
  const display = h("details", { class: "picker" },
    h("summary", { class: "chip" }, "⚙ Display ▾"),
    h("div", { class: "picker-body right" },
      h("div", { class: "picker-lang" }, "Original language"),
      toggle("original", bk.t === "OT" ? "Hebrew text" : "Greek text", hasOrig, "tap any word for its meaning"),
      toggle("gloss", "English under each word", hasOrig),
      scriptSel,
      h("div", { class: "picker-lang" }, "Notes"),
      toggle("explain", "Explanation footnotes", comms(bk.t).length > 0, "context for each verse"),
      comms(bk.t).length > 1 ? h("label", { class: "picker-item" }, "Explanations from: ",
        h("select", { onchange: (e) => { settings.noteSource = e.target.value; saveSettings(); route(); } },
          comms(bk.t).map((x) => h("option", { value: x.id, selected: noteSource(bk.t)?.id === x.id }, x.name)))) : null,
      toggle("footnotes", "Study footnotes", true, "Hebrew/Greek words, history, differences"),
      toggle("hard", "Mark hard passages", hard.items.length > 0),
      bk.t === "OT" ? [h("div", { class: "picker-lang" }, "Septuagint (Greek Old Testament)"),
        toggle("lxx", "Septuagint in Greek", hasLxx(lxxG())),
        toggle("lxxeng", "Septuagint in English", hasLxx(lxxE())),
        toggle("compare", "Highlight Hebrew ↔ Septuagint differences", hasLxx(lxxE())),
        ...[["lxxG", (l) => !/English/.test(l.label), "Greek edition"], ["lxxE", (l) => /English/.test(l.label), "English edition"]].map(([key, f, lab]) => {
          const opts = manifest.lxx.filter(f);
          return opts.length > 1 ? h("label", { class: "picker-item" }, `${lab}: `, h("select", { onchange: (e) => { settings[key] = e.target.value; saveSettings(); route(); } },
            opts.map((l) => h("option", { value: l.id, selected: (key === "lxxG" ? lxxG() : lxxE()) === l.id }, l.label.replace(/^Septuagint – /, ""))))) : null;
        }),
        hasLxx(lxxE()) ? h("a", { class: "picker-item", href: `#/compare/${bk.osis}` }, `Scan all of ${bk.name} for differences ›`) : null] : null));
  return h("div", { class: "toolbar" },
    h("div", { class: "nav-row" },
      h("a", { class: "btn", href: prevHref(bk, c), "aria-label": "Previous chapter" }, "‹"),
      bookSel, chSel,
      h("a", { class: "btn", href: nextHref(bk, c), "aria-label": "Next chapter" }, "›")),
    h("div", { class: "chips" }, verChips, fullLink, display));
}
function prevHref(bk, c) {
  if (c > 1) return `#/read/${bk.osis}/${c - 1}`;
  const p = BOOKS[bk.i - 1]; return p ? `#/read/${p.osis}/${p.ch}` : `#/read/${bk.osis}/1`;
}
function nextHref(bk, c) {
  if (c < bk.ch) return `#/read/${bk.osis}/${c + 1}`;
  const n = BOOKS[bk.i + 1]; return n ? `#/read/${n.osis}/1` : `#/read/${bk.osis}/${c}`;
}
function chapterNav(bk, c) {
  return h("div", { class: "chapter-nav" },
    h("a", { class: "btn", href: prevHref(bk, c) }, "‹ Previous"),
    h("a", { class: "btn", href: nextHref(bk, c) }, "Next ›"));
}

// ---------------------------------------------------------------- verse panel
async function versePanel(bk, c, v) {
  const ref = `${bk.osis}.${c}.${v}`;
  const ver = primaryVer();
  const noteBox = h("textarea", { rows: 4, placeholder: "Your note on this verse…" }, store.get("notes", ref)?.body || "");
  const saveNote = () => { store.set("notes", ref, noteBox.value.trim() ? { body: noteBox.value.trim() } : null); route2(); };
  const route2 = () => { const scroll = window.scrollY; viewRead([bk.osis, c]).then(() => window.scrollTo(0, scroll)); };
  const xrefBox = h("div", {}, loading());
  const dlist = diffs.items.filter((d) => [d.ot, ...(d.nt || [])].includes(ref));
  const ws = (await interlinear(bk.osis, c))?.[String(v)] || [];
  const heb = bk.t === "OT";
  const ps = periodsFor(bk.osis, c);
  const ctxBox = ws.length ? h("section", { class: "verse-context" },
    h("div", { class: "muted small" }, `${heb ? "The Hebrew" : "The Greek"} of this verse${ps.length ? ` · ${ps[0].name}, ${ps[0].dates.replace(/^Traditional:\s*/, "")}` : ""}`),
    h("p", { class: `ctx ${heb ? "heb" : "grk"} script-${heb ? settings.script : "greek"}`, dir: heb ? "rtl" : "ltr" },
      ws.map((w, i) => [i ? " " : "", h("button", { class: `fw${KEYWORDS[w[3]] ? " kw" : ""}`, onclick: () => wordPanel(w, heb, ref, i) },
        heb ? renderHebrew(w[0], settings.script) : w[0])])),
    h("p", { class: "small" }, ws.map((w) => w[2].replace(/\//g, " ")).join(" · ")),
    ws.filter((w) => KEYWORDS[w[3]]).map((w) => h("p", { class: "small" }, h("strong", {}, `${KEYWORDS[w[3]].word}: `), KEYWORDS[w[3]].note)),
    h("div", { class: "row" },
      h("button", { class: "btn small", onclick: () => speak(heb ? "he-modern" : "el-modern", [{ text: speakable(heb ? "he-modern" : "el-modern", { words: ws }) }], { rate: settings.rate }).catch((e) => alert(e.message)) }, "🔊 Modern"),
      h("button", { class: "btn small", onclick: () => speak(heb ? "he-ancient" : "el-ancient", [{ text: speakable(heb ? "he-ancient" : "el-ancient", { words: ws }) }], { rate: settings.rate }).catch((e) => alert(e.message)) }, heb ? "🔊 Biblical" : "🔊 Ancient"))) : null;
  openPanel(fmtRef(ref),
    h("p", { class: "verse-quote" }, await verseText(ver, ref)),
    ctxBox,
    comms(bk.t).length ? h("button", { class: "btn", onclick: () => contextPanel(bk, c, v) }, "✎ Explanations & commentary") : null,
    passageLinks(ref),
    h("div", { class: "hl-row" }, "Highlight: ",
      HL_COLORS.map((col) => h("button", { class: `swatch hl-${col}`, "aria-label": col,
        onclick: () => { store.set("highlights", ref, store.get("highlights", ref) === col ? null : col); route2(); } })),
      h("button", { class: "btn small", onclick: () => { store.set("highlights", ref, null); route2(); } }, "Clear")),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => {
        store.set("bookmarks", ref, store.get("bookmarks", ref) ? null : { created: new Date().toISOString() }); route2(); closePanel();
      } }, store.get("bookmarks", ref) ? "★ Remove bookmark" : "☆ Bookmark"),
      h("button", { class: "btn", onclick: async () => {
        const t = `${fmtRef(ref)} (${ver.toUpperCase()}) ${await verseText(ver, ref)}`;
        try { await navigator.clipboard.writeText(t); } catch {}
      } }, "Copy")),
    h("h3", {}, "Note"), noteBox, h("button", { class: "btn primary", onclick: saveNote }, "Save note"),
    dlist.length ? [h("h3", {}, "Textual differences"), dlist.map((d) =>
      h("button", { class: `badge cat-${d.cat}`, onclick: () => diffPanel(d) }, "⚑ ", d.title))] : null,
    h("h3", {}, "Cross references"), xrefBox);
  const xb = await xrefBook(bk.osis);
  const list = (xb && xb[`${c}.${v}`]) || [];
  if (!list.length) { fill(xrefBox, h("p", { class: "muted" }, xb ? "None listed." : "Cross references aren't available.")); return; }
  const here = await verseText(ver, ref);
  let flagged = 0;
  const items = await Promise.all(list.map(async ([to, votes], idx) => {
    const text = await verseText(ver, to);
    const flags = await xrefProblems(ref, to, votes, idx < 25);
    if (flags.length) flagged++;
    const cmpBox = h("div", {});
    return h("li", { class: flags.length ? "xref-flagged" : "" },
      refLink(to), h("span", { class: "muted small" }, ` · ${votes} vote${votes === 1 ? "" : "s"}`),
      flags.length ? h("div", { class: "xflags" }, flags.map((f) => f.open
        ? h("button", { class: `xflag xf-${f.kind}`, onclick: f.open }, f.label)
        : h("span", { class: `xflag xf-${f.kind}`, title: f.title || "" }, f.label))) : null,
      h("div", { class: "small" }, text),
      h("button", { class: "linkish small", onclick: () => {
        if (cmpBox.childNodes.length) { fill(cmpBox); return; }
        const c = compareTexts(here, text);
        fill(cmpBox, h("div", { class: "cmp-pair small" },
          h("div", {}, h("div", { class: "muted" }, fmtRef(ref)), diffTokens(c.a, "mt")),
          h("div", {}, h("div", { class: "muted" }, fmtRef(to)), diffTokens(c.b, "lxx"))));
      } }, "Compare wording"), cmpBox);
  }));
  fill(xrefBox,
    flagged ? h("p", { class: "notice small" }, `⚠ ${flagged} of ${list.length} cross references have a problem flagged below.`) : null,
    h("ol", { class: "xrefs" }, items),
    h("p", { class: "muted small" }, "Ranked by OpenBible.info community votes. Flags: weak link (few votes), textual difference or contradiction on file, Hebrew and Septuagint differ at the target verse, or the verse doesn't exist in this translation."));
}

/** Find problems with one cross reference. */
async function xrefProblems(from, to, votes, deep) {
  const flags = [];
  const r = parseOsis(to);
  const b = r && book(r.b);
  if (!b) return [{ kind: "bad", label: "Unrecognized reference" }];
  if (r.c > b.ch) return [{ kind: "bad", label: "Chapter doesn't exist" }];
  const target = await verseText(primaryVer(), to);
  if (!target) flags.push({ kind: "bad", label: `Not in ${primaryVer().toUpperCase()} (numbering differs?)` });
  if (votes < 5) flags.push({ kind: "weak", label: "Weak link", title: "Few readers voted this a useful cross reference" });
  const inRange = (x) => {
    const p = parseOsis(x);
    if (!p || p.b !== r.b) return false;
    const endC = r.c2 || r.c, endV = r.v2 || r.v;
    return (p.c > r.c || (p.c === r.c && p.v >= r.v)) && (p.c < endC || (p.c === endC && p.v <= endV));
  };
  const fromP = parseOsis(from);
  const touches = (refs) => refs.some((x) => inRange(x));
  for (const d of diffs.items) {
    const refs = [d.ot, ...(d.nt || [])];
    if (touches(refs)) flags.push({ kind: "diff", label: `⚑ ${d.title}`, open: () => diffPanel(d) });
  }
  for (const x of contra.items) {
    const refs = x.passages.map((p) => p.ref);
    const hitTo = refs.some((rr) => { const p = parseOsis(rr); return p && p.b === r.b && p.c === r.c && (!r.v || !p.v || (p.v <= (r.v2 || r.v) && r.v <= (p.v2 || p.v))); });
    const hitFrom = refs.some((rr) => { const p = parseOsis(rr); return p && fromP && p.b === fromP.b && p.c === fromP.c && p.v <= fromP.v && fromP.v <= (p.v2 || p.v); });
    if (hitTo && hitFrom) flags.push({ kind: "contra", label: `⚠ Contradiction: ${x.title}`, open: () => contraPanel(x) });
    else if (hitTo) flags.push({ kind: "contra", label: `⚠ ${x.title}`, open: () => contraPanel(x) });
  }
  for (const x of hard.items) {
    if (x.refs.some((rr) => { const p = parseOsis(rr); return p && p.b === r.b && r.v && refCovers(rr, r.b, r.c, r.v); }))
      flags.push({ kind: "hard", label: `⚠ Hard passage: ${x.title}`, open: () => hardPanel(x) });
  }
  if (deep && b.t === "OT" && hasLxx(lxxE()) && settings.compare && target) {
    const lx = await lxxBook(lxxE(), b.osis);
    const chs = lxxChapters(b.osis, r.c);
    let best = null;
    for (const lc of chs) for (const dv of [0, -1, 1]) {
      const t = lx?.[String(lc)]?.[String((r.v || 1) + dv)];
      if (!t) continue;
      const c = compareTexts(target, t);
      if (!best || c.score > best.score) best = c;
    }
    const lvl = best ? level(best) : "missing-lxx";
    if (lvl === "major" || lvl === "missing-lxx") flags.push({ kind: "lxx", label: lvl === "major" ? "Septuagint differs here" : "Not in the Septuagint",
      open: () => { closePanel(); location.hash = `#/read/${b.osis}/${r.c}/${r.v || 1}`; } });
  }
  return flags;
}

// ---------------------------------------------------------------- word panel
async function wordPanel(w, heb, ref, idx) {
  const [text, translit, gloss, strong, morph, editions] = w;
  const body = h("div", {}, loading());
  openPanel(text.replace(/\//g, ""), body);
  const lex = strong ? (await lexGroup(strong))?.[strong] : null;
  const occ = strong ? occRefs((await occGroup(strong))?.[strong]) : [];
  const ver = primaryVer();
  const occList = h("ol", { class: "occ" });
  let shown = 0;
  const more = h("button", { class: "btn small" }, "Show more");
  async function showMore() {
    const next = occ.slice(shown, shown + 25);
    shown += next.length;
    const items = await Promise.all(next.map(async (r) => h("li", { class: r === ref ? "current" : "" },
      refLink(r), " ", h("span", { class: "small" }, await verseText(ver, r)))));
    occList.append(...items);
    if (shown >= occ.length) more.remove();
  }
  more.onclick = showMore;
  const rp = parseOsis(ref);
  const verseWords = rp ? (await interlinear(rp.b, rp.c))?.[String(rp.v)] || [] : [];
  const sayBtn = (mode, label, words) => h("button", { class: "btn small", onclick: async (e) => {
    try { await speak(mode, [{ text: speakable(mode, { words }) }], { rate: settings.rate }); }
    catch (err) { e.target.textContent = err.message; }
  } }, "🔊 ", label);
  const aramaic = heb && /^A/.test(morph || "");
  fill(body,
    h("div", { class: "row" },
      sayBtn(heb ? "he-modern" : "el-modern", "Modern", [w]), sayBtn(heb ? "he-ancient" : "el-ancient", heb ? "Biblical" : "Ancient", [w])),
    aramaic ? h("p", { class: "notice small" }, "Aramaic, not Hebrew. ", history.aramaic || "") : null,
    KEYWORDS[strong] ? h("section", { class: "kw-box" },
      h("h3", {}, `${KEYWORDS[strong].word}: meaning in context`), h("p", {}, KEYWORDS[strong].note),
      KEYWORDS[strong].context ? h("p", {}, h("strong", {}, "In its ancient setting: "), KEYWORDS[strong].context) : null,
      KEYWORDS[strong].scholars ? [h("h4", {}, "Scholars"), h("ul", { class: "small" }, KEYWORDS[strong].scholars.map((x) => h("li", {}, x)))] : null) : null,
    verseWords.length ? h("section", { class: "verse-context" },
      h("div", { class: "muted small" }, `The whole verse — ${fmtRef(ref)}`),
      h("p", { class: `ctx ${heb ? "heb" : "grk"} script-${heb ? settings.script : "greek"}`, dir: heb ? "rtl" : "ltr" },
        verseWords.map((vw, i) => [i ? " " : "", h("span", { class: i === idx ? "ctx-hit" : "" }, heb ? renderHebrew(vw[0], settings.script) : vw[0])])),
      h("p", { class: "small" }, verseWords.map((vw, i) => [i ? " " : "", h("span", { class: i === idx ? "ctx-hit" : "" }, vw[2].replace(/\//g, " "))])),
      h("div", { class: "row" }, sayBtn(heb ? "he-modern" : "el-modern", "Verse, modern", verseWords),
        sayBtn(heb ? "he-ancient" : "el-ancient", heb ? "Verse, Biblical" : "Verse, ancient", verseWords))) : null,
    h("dl", { class: "word-facts" },
      h("dt", {}, "Transliteration"), h("dd", {}, translit || "—"),
      h("dt", {}, "Gloss here"), h("dd", {}, gloss.replace(/\//g, " ") || "—"),
      h("dt", {}, "Grammar"), h("dd", {}, decode(morph, heb) || "—", h("span", { class: "muted small" }, ` (${morph || "—"})`)),
      h("dt", {}, "Strong's"), h("dd", {}, strong ? h("a", { href: `#/search?q=${strong}`, onclick: closePanel }, strong) : "—"),
      editions ? [h("dt", {}, "Found in"), h("dd", {}, editionLabel(editions))] : null),
    lex ? h("section", { class: "lex" },
      h("h3", {}, h("span", { lang: heb ? "hbo" : "grc" }, lex[0]), " ", h("span", { class: "muted" }, lex[1])),
      h("p", { class: "gloss" }, lex[3]),
      lex[4] ? h("p", { class: "def" }, lex[4]) : null,
      h("p", { class: "muted small" }, "Lexicon: STEPBible.org / Tyndale House (CC BY)."))
      : h("p", { class: "muted" }, strong ? "No lexicon entry loaded." : ""),
    occ.length ? [h("h3", {}, `Used in ${occ.length} verse${occ.length > 1 ? "s" : ""}`), occList, more] : null,
  );
  if (occ.length) showMore();
}
function editionLabel(ed) {
  const names = { NA28: "Nestle-Aland 28", NA27: "NA27", Tyn: "Tyndale House GNT", SBL: "SBLGNT", WH: "Westcott-Hort",
    Treg: "Tregelles", TR: "Textus Receptus", Byz: "Byzantine" };
  const has = ed.split("+").map((x) => x.trim());
  const missing = Object.keys(names).filter((k) => !has.includes(k));
  return `${has.map((x) => names[x] || x).join(", ")}${missing.length ? ` — not in: ${missing.map((x) => names[x]).join(", ")}` : ""}`;
}

// ---------------------------------------------------------------- differences
const CAT_SHORT = { "nt-lxx": "NT follows Septuagint", "nt-mt": "NT follows Hebrew", "nt-neither": "NT matches neither",
  "mt-lxx": "Hebrew ≠ Septuagint", narrative: "NT vs OT account", book: "Whole book" };
const VERDICTS = ["", "Septuagint reading likely original", "Hebrew (MT) reading likely original",
  "NT author quoting accurately from a different text", "NT author paraphrasing / interpreting", "Error in the NT text",
  "Error in the Hebrew text", "Error in the Septuagint", "Unresolved"];

function viewDifferences(_parts, q) {
  const cat = q.get("cat") || "";
  const bk = q.get("book") || "";
  const items = diffs.items.filter((d) => (!cat || d.cat === cat) &&
    (!bk || [d.ot, ...(d.nt || [])].some((r) => parseOsis(r)?.b === bk)));
  const chip = (id, label) => h("a", { class: `chip${cat === id ? " on" : ""}`, href: `#/differences${id ? "?cat=" + id : ""}` }, label);
  fill(main(), 
    h("h1", {}, "Where the texts differ"),
    h("p", { class: "lead" },
      "A side-by-side cross-section of places where the Hebrew (Masoretic) text, the Greek Septuagint, and New Testament quotations don't say the same thing. ",
      "Each entry states the facts; your own verdict and notes are saved with it."),
    h("div", { class: "chips" }, chip("", `All (${diffs.items.length})`),
      Object.keys(diffs.categories).map((k) => chip(k, `${CAT_SHORT[k] || k} (${diffs.items.filter((d) => d.cat === k).length})`))),
    h("p", {}, h("a", { class: "btn", href: "#/compare/Gen" }, "Scan any book: Hebrew vs Septuagint, verse by verse ›")),
    bk ? h("p", { class: "notice" }, `Showing ${book(bk)?.name || bk} only. `, h("a", { href: "#/differences" }, "Show all")) : null,
    h("div", { class: "table-wrap" }, h("table", { class: "xsection" },
      h("thead", {}, h("tr", {}, h("th", {}, "Passage"), h("th", {}, "Hebrew (MT)"), h("th", {}, "Septuagint (LXX)"),
        h("th", {}, "New Testament"), h("th", {}, "Your verdict"))),
      h("tbody", {}, items.map((d) => h("tr", { class: `cat-${d.cat}` },
        h("td", {}, h("button", { class: "linkish", onclick: () => diffPanel(d) }, d.title),
          h("div", { class: `tag cat-${d.cat}` }, CAT_SHORT[d.cat] || d.cat),
          h("div", { class: "small" }, refLink(d.ot), d.nt?.length ? [" → ", d.nt.map((r, i) => [i ? ", " : "", refLink(r)])] : null)),
        h("td", {}, d.mt || ""), h("td", {}, d.lxx || ""), h("td", {}, d.ntr || "—"),
        h("td", {}, store.get("verdicts", d.id)?.verdict || h("span", { class: "muted" }, "—"))))))),
    h("p", { class: "muted small" }, "Abbreviations: ", Object.entries(diffs.abbrev || {}).map(([k, v]) => `${k} = ${v}`).join(" · ")),
  );
}

async function diffPanel(d) {
  const ver = primaryVer();
  const verdict = store.get("verdicts", d.id) || {};
  const sel = h("select", {}, VERDICTS.map((x) => h("option", { value: x, selected: verdict.verdict === x }, x || "— choose —")));
  const notes = h("textarea", { rows: 3, placeholder: "Your reasoning…" }, verdict.note || "");
  const texts = h("div", {}, loading());
  openPanel(d.title,
    h("div", { class: `tag cat-${d.cat}` }, diffs.categories[d.cat] || d.cat),
    h("table", { class: "readings" },
      h("tr", {}, h("th", {}, "Hebrew (MT)"), h("td", {}, d.mt || "—")),
      h("tr", {}, h("th", {}, "Septuagint"), h("td", {}, d.lxx || "—")),
      d.ntr ? h("tr", {}, h("th", {}, "New Testament"), h("td", {}, d.ntr)) : null),
    d.note ? h("p", { class: "def" }, d.note) : null,
    d.scholars ? [h("h3", {}, "Scholars"), h("ul", { class: "small" }, d.scholars.map((x) => h("li", {}, x)))] : null,
    learnMore(d.title, [d.ot, ...(d.nt || [])], d.wiki, "contradiction"),
    h("h3", {}, "The texts"), texts,
    h("h3", {}, "Your verdict"), sel, notes,
    h("button", { class: "btn primary", onclick: () => {
      store.set("verdicts", d.id, sel.value || notes.value.trim() ? { verdict: sel.value, note: notes.value.trim() } : null);
      if (location.hash.startsWith("#/differences")) route(); else closePanel();
    } }, "Save verdict"));

  const blocks = [];
  const ot = parseOsis(d.ot);
  if (ot) {
    blocks.push(h("h4", {}, refLink(d.ot), ` — ${verLabel(ver)} (translated from the Hebrew)`),
      h("p", {}, await verseText(ver, d.ot)));
    const il = await interlinear(ot.b, ot.c);
    if (il?.[String(ot.v)]) blocks.push(h("div", { class: "cell orig heb", dir: "rtl", lang: "hbo" },
      il[String(ot.v)].map((w) => h("span", { class: "w static" }, h("span", { class: "wt" }, w[0].replace(/\//g, "")),
        h("span", { class: "wg", dir: "ltr" }, w[2])))));
    const lref = d.lxxref ? parseOsis(d.lxxref) : { ...ot, c: lxxChapters(ot.b, ot.c)[0] };
    for (const id of [lxxG(), lxxE()]) {
      if (!hasLxx(id)) continue;
      const bkData = await lxxBook(id, lref.b);
      const t = bkData?.[String(lref.c)]?.[String(lref.v)];
      if (t) blocks.push(h("h4", {}, `${lxxLabel(id)} — ${fmtRef(lref)} in LXX numbering`),
        h("p", { lang: /English/.test(lxxLabel(id)) ? "en" : "grc" }, t));
    }
  }
  for (const r of d.nt || []) {
    const p = parseOsis(r);
    blocks.push(h("h4", {}, refLink(r), ` — ${verLabel(ver)}`), h("p", {}, await verseText(ver, r)));
    const il = p && (await interlinear(p.b, p.c));
    if (il?.[String(p.v)]) blocks.push(h("div", { class: "cell orig grk", lang: "grc" },
      il[String(p.v)].map((w) => h("span", { class: "w static" }, h("span", { class: "wt" }, w[0]), h("span", { class: "wg" }, w[2])))));
  }
  fill(texts, ...blocks);
}

// ---------------------------------------------------------------- hard passages
function refCovers(range, b, c, v) {
  const p = parseOsis(range);
  if (!p || p.b !== b) return false;
  const c2 = p.c2 || p.c, v2 = p.v2 || p.v;
  if (c < p.c || c > c2) return false;
  if (c === p.c && v < p.v) return false;
  if (c === c2 && v > v2) return false;
  return true;
}
const hardFor = (b, c, v) => hard.items.filter((x) => x.refs.some((r) => refCovers(r, b, c, v)));
const HARD_SHORT = { god: "God's actions", sexual: "Sexual violence", massacre: "Mass killing", children: "Children", slavery: "Slavery", law: "Harsh laws", women: "Women", harm: "Used to justify harm" };
const HARD_VERDICTS = ["", "The text condemns it", "The text commands or approves it", "Reported without judgment",
  "Wrong, whatever the text intends", "Justified in its context", "Hyperbole or imagery, not literal", "Unresolved"];

function viewHard(_p, q) {
  const cat = q.get("cat") || "";
  const items = hard.items.filter((x) => !cat || x.cat === cat);
  const chip = (id, label) => h("a", { class: `chip${cat === id ? " on" : ""}`, href: `#/hard${id ? "?cat=" + id : ""}` }, label);
  fill(main(),
    h("h1", {}, "Morality: hard passages"),
    h("p", { class: "lead" }, "Passages describing or commanding sexual violence, mass killing, violence against children, slavery and harsh punishments — and texts later used to justify harm. Each entry says what happens (without graphic detail), how the text itself presents it, and the main ways readers interpret it. These verses are marked in the reader."),
    h("div", { class: "chips" }, chip("", `All (${hard.items.length})`),
      Object.keys(hard.categories).map((k) => chip(k, `${HARD_SHORT[k] || k} (${hard.items.filter((x) => x.cat === k).length})`))),
    h("div", { class: "table-wrap" }, h("table", { class: "xsection" },
      h("thead", {}, h("tr", {}, h("th", {}, "Passage"), h("th", {}, "What happens"), h("th", {}, "How the text presents it"), h("th", {}, "Your verdict"))),
      h("tbody", {}, items.map((x) => h("tr", {},
        h("td", {}, h("button", { class: "linkish", onclick: () => hardPanel(x) }, x.title),
          h("div", { class: "tag hard-tag" }, HARD_SHORT[x.cat] || x.cat),
          h("div", { class: "small" }, x.refs.map((r, i) => [i ? "; " : "", refLink(r)]))),
        h("td", { class: "small" }, x.what),
        h("td", {}, h("span", { class: `stance st-${x.stance}` }, hard.stances[x.stance] || x.stance)),
        h("td", {}, store.get("verdicts", "h:" + x.id)?.verdict || h("span", { class: "muted" }, "—"))))))));
}

async function hardPanel(x) {
  const ver = primaryVer();
  const key = "h:" + x.id;
  const cur = store.get("verdicts", key) || {};
  const sel = h("select", {}, HARD_VERDICTS.map((v) => h("option", { value: v, selected: cur.verdict === v }, v || "— choose —")));
  const notes = h("textarea", { rows: 3, placeholder: "Your thoughts…" }, cur.note || "");
  const body = h("div", {}, loading());
  openPanel(x.title, body);
  const texts = await Promise.all(x.refs.map((r) => verseText(ver, r)));
  fill(body,
    h("div", { class: "tag hard-tag" }, hard.categories[x.cat] || x.cat),
    h("p", {}, x.what),
    h("p", {}, h("strong", {}, "How the text presents it: "), h("span", { class: `stance st-${x.stance}` }, hard.stances[x.stance] || x.stance)),
    x.refs.map((r, i) => h("div", { class: "con-passage" }, h("h4", {}, refLink(r), h("span", { class: "muted small" }, ` · ${ver.toUpperCase()}`)),
      h("p", { class: "verse-quote" }, texts[i] || h("em", { class: "muted" }, "Text not loaded.")), passageLinks(r))),
    x.views?.length ? [h("h3", {}, "How readers interpret it"), h("ul", {}, x.views.map((v) => h("li", {}, v)))] : null,
    learnMore(x.title, x.refs, x.wiki, "morality"),
    h("h3", {}, "Your verdict"), sel, notes,
    h("button", { class: "btn primary", onclick: () => {
      store.set("verdicts", key, sel.value || notes.value.trim() ? { verdict: sel.value, note: notes.value.trim() } : null);
      if (location.hash.startsWith("#/hard")) route(); else closePanel();
    } }, "Save verdict"));
}

// ---------------------------------------------------------------- study hub
function viewStudy() {
  const card = (href, icon, title, text) => h("a", { class: "card study-card", href }, h("div", { class: "study-icon" }, icon),
    h("div", {}, h("strong", {}, title), h("p", { class: "small muted" }, text)));
  fill(main(), h("h1", {}, "Study"),
    h("p", { class: "lead" }, "Tools for digging deeper. Everything here is also linked from the footnotes as you read."),
    h("div", { class: "study-grid" },
      card("#/contradictions", "⚖", "Contradictions", `${contra.items.length} passages that appear to conflict — numbers, events, teachings — with explanations, evidence and links.`),
      card("#/hard", "⚠", "Morality: hard passages", `${hard.items.length} passages on violence, sexual abuse, slavery, harsh laws, treatment of women and God's own actions — with links to both sides.`),
      card("#/topic", "🔍", "Topic: find contradictions", "Enter any subject. See what the whole Bible says, in Hebrew, Greek and translation, and where it seems to disagree."),
      card("#/differences", "⚑", "Hebrew, Septuagint & New Testament", `${diffs.items.length} places where the Hebrew, the Greek Old Testament and New Testament quotes differ.`),
      card("#/compare/Gen", "⇄", "Hebrew vs Septuagint scanner", "Every Old Testament verse compared automatically, with differences highlighted."),
      card("#/history", "🏛", "History & archaeology", "Timeline, background to every book, archaeological finds, and how the Hebrew text was written down."),
      card("#/history?tab=claims", "📜", "Bible vs the historical record", `${(history.claims || []).length} claims rated against inscriptions, archaeology and science.`),
      
      card(`#/full/Gen/1`, "🔊", "Listen in Hebrew or Greek", "Full chapters in the original language, read aloud in modern or ancient pronunciation.")));
}

// ---------------------------------------------------------------- history
function periodRanges(p) {
  return (p.ranges || []).map((r) => { const m = /^(\w+)\.(\d+)-(\d+)$/.exec(r); return m && { b: m[1], c1: +m[2], c2: +m[3] }; }).filter(Boolean);
}
function periodsFor(b, c) {
  const direct = history.periods.filter((p) => periodRanges(p).some((r) => r.b === b && c >= r.c1 && c <= r.c2));
  if (direct.length) return direct;
  return (history.books[b]?.periods || []).map((id) => history.periods.find((p) => p.id === id)).filter(Boolean);
}
const artifactsFor = (b, c) => history.artifacts.filter((a) => a.refs.some((r) => { const p = parseOsis(r); return p && p.b === b && p.c === c; }));

function historyStrip(bk, c) {
  if (!history.periods.length) return null;
  const ps = periodsFor(bk.osis, c);
  const arts = artifactsFor(bk.osis, c);
  return h("div", { class: "history-strip" },
    h("span", { class: "hs-label" }, "History:"),
    ps.map((p) => h("button", { class: "chip", onclick: () => periodPanel(p) }, `${p.name} · ${p.dates.replace(/^Traditional:\s*/, "")}`)),
    h("button", { class: "chip", onclick: () => bookPanel(bk) }, `About ${bk.name}`),
    arts.map((a) => h("button", { class: "chip artifact", onclick: () => artifactPanel(a) }, "🏺 ", a.name)));
}
function periodPanel(p) {
  const books = BOOKS.filter((b) => (history.books[b.osis]?.periods || []).includes(p.id));
  openPanel(p.name,
    h("p", {}, h("strong", {}, p.dates)), h("p", { class: "muted" }, p.scholarly), h("p", {}, p.summary),
    books.length ? [h("h3", {}, "Books set in or written in this period"), h("p", {}, books.map((b, i) => [i ? ", " : "", h("a", { href: `#/read/${b.osis}/1`, onclick: closePanel }, b.name)]))] : null,
    (() => { const arts = history.artifacts.filter((a) => a.refs.some((r) => periodsFor(parseOsis(r).b, parseOsis(r).c).includes(p)));
      return arts.length ? [h("h3", {}, "Archaeology"), h("ul", {}, arts.map((a) => h("li", {}, h("button", { class: "linkish", onclick: () => artifactPanel(a) }, a.name), ` (${a.date})`)))] : null; })(),
    h("p", {}, h("a", { href: "#/history", onclick: closePanel }, "Full timeline ›")));
}
function bookPanel(bk) {
  const info = history.books[bk.osis] || {};
  const ps = (info.periods || []).map((id) => history.periods.find((p) => p.id === id)).filter(Boolean);
  openPanel(bk.name,
    h("h3", {}, "When and by whom"), h("p", {}, info.written || "—"),
    ps.length ? [h("h3", {}, "Historical setting"), ps.map((p) => h("p", {}, h("button", { class: "linkish", onclick: () => periodPanel(p) }, p.name), ` — ${p.dates}`))] : null,
    h("p", { class: "muted small" }, "Traditional and scholarly dates are both shown where they differ."));
}
function artifactPanel(a) {
  openPanel(a.name,
    h("p", {}, h("strong", {}, a.date), " · ", h("span", { class: "muted" }, a.where)),
    h("p", {}, a.what),
    h("h3", {}, "Related passages"), h("ul", {}, a.refs.map((r) => h("li", {}, refLink(r)))));
}
function claimsSection(filter) {
  const groups = history.claimGroups || {};
  const st = history.claimStatus || {};
  const items = (history.claims || []).filter((x) => !filter || x.status === filter);
  const chip = (id, label) => h("a", { class: `chip${(filter || "") === id ? " on" : ""}`, href: `#/history?tab=claims${id ? "&status=" + id : ""}` }, label);
  return h("section", { id: "claims" },
    h("h2", {}, "The Bible and the historical record"),
    h("p", {}, "Biblical statements about people, events, places and human origins, checked against inscriptions, archaeology, ancient historians, genetics and geology. Ratings reflect mainstream scholarship; other views are given."),
    h("div", { class: "chips" }, chip("", `All (${(history.claims || []).length})`),
      Object.entries(st).map(([k, l]) => chip(k, `${l} (${(history.claims || []).filter((x) => x.status === k).length})`))),
    Object.entries(groups).map(([g, gl]) => {
      const list = items.filter((x) => x.group === g);
      return list.length ? [h("h3", {}, gl), h("div", { class: "table-wrap" }, h("table", { class: "xsection" },
        h("thead", {}, h("tr", {}, h("th", {}, "The Bible says"), h("th", {}, "Rating"), h("th", {}, "Outside evidence"))),
        h("tbody", {}, list.map((x) => h("tr", {},
          h("td", {}, h("button", { class: "linkish", onclick: () => claimPanel(x) }, x.claim), h("div", { class: "small" }, x.refs.map((r, i) => [i ? "; " : "", refLink(r)]))),
          h("td", {}, h("span", { class: `claim-status cs-${x.status}` }, st[x.status] || x.status)),
          h("td", { class: "small" }, x.evidence))))))] : null;
    }));
}
function viewHistory(_p, q) {
  if (q?.get("tab") === "claims") {
    fill(main(), h("p", {}, h("a", { href: "#/history" }, "‹ History")), claimsSection(q.get("status") || ""));
    return;
  }
  const gen = "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ";
  const sample = { paleo: renderHebrew(gen, "paleo"), square: renderHebrew(gen, "consonants"), masoretic: gen };
  fill(main(),
    h("h1", {}, "History"),
    h("p", { class: "lead" }, "Where each part of the Bible fits in time, what archaeology has found, and how the Hebrew text itself came down to us."),
    h("h2", {}, "Timeline"),
    h("ol", { class: "timeline" }, history.periods.map((p) => {
      const firstRange = periodRanges(p)[0];
      const books = BOOKS.filter((b) => (history.books[b.osis]?.periods || []).includes(p.id));
      return h("li", {}, h("div", { class: "tl-dates" }, p.dates.replace(/^Traditional:\s*/, "")),
        h("div", { class: "tl-body" }, h("h3", {}, h("button", { class: "linkish", onclick: () => periodPanel(p) }, p.name)),
          h("p", {}, p.summary), h("p", { class: "muted small" }, p.scholarly),
          h("p", { class: "small" }, books.map((b, i) => [i ? " · " : "", h("a", { href: `#/read/${b.osis}/${firstRange && firstRange.b === b.osis ? firstRange.c1 : 1}` }, b.name)]))));
    })),
    h("p", {}, h("a", { class: "btn", href: "#/history?tab=claims" }, `🏛 Check the Bible against the historical record (${(history.claims || []).length} claims) ›`)),
    h("h2", {}, "Archaeology and the Bible"),
    h("div", { class: "cards" }, history.artifacts.map((a) => h("div", { class: "card" },
      h("strong", {}, h("button", { class: "linkish", onclick: () => artifactPanel(a) }, a.name)),
      h("div", { class: "muted small" }, `${a.date} · ${a.where}`), h("p", { class: "small" }, a.what),
      h("div", { class: "small" }, a.refs.map((r, i) => [i ? "; " : "", refLink(r)]))))),
    h("h2", {}, "How the Hebrew text came down to us"),
    h("p", {}, "Genesis 1:1 as it would have looked in each era. In the reader, the Hebrew script menu switches the whole text."),
    history.scripts.map((sc) => h("div", { class: "card script-card" },
      h("h3", {}, sc.name), h("div", { class: "muted small" }, sc.dates),
      h("p", { class: `script-sample heb script-${sc.id === "square" ? "consonants" : sc.id}`, dir: "rtl" }, sample[sc.id]),
      h("p", {}, sc.what))),
    history.aramaic ? [h("h2", {}, "Aramaic in the Bible"), h("p", {}, history.aramaic)] : null);
}

// ---------------------------------------------------------------- full original-language text with audio
async function viewFull([b, c]) {
  const bk = book(b) || book("Gen");
  c = Math.max(1, Math.min(bk.ch, parseInt(c, 10) || 1));
  const heb = bk.t === "OT";
  const modeKey = heb ? "audioHe" : "audioEl";
  const mode = settings[modeKey] || (heb ? "he-modern" : "el-modern");
  const ver = chosenFor(bk.t)[0] || primaryVer();
  fill(main(), h("div", { id: "full" }, loading()));
  const [words, tb] = await Promise.all([interlinear(bk.osis, c), textBook(ver, bk.osis)]);
  const eng = tb?.[c - 1] || [];
  const avail = await availability();
  const showEng = settings.fullEnglish !== false;
  const nums = Object.keys(words || {}).map(Number).sort((x, y) => x - y);
  const modeSel = h("select", { "aria-label": "Pronunciation", onchange: (e) => { settings[modeKey] = e.target.value; saveSettings(); } },
    (heb ? ["he-modern", "he-ancient"] : ["el-modern", "el-ancient"]).map((m) =>
      h("option", { value: m, selected: m === mode }, MODES[m].label + (avail[m] ? "" : " — no voice installed"))));
  const rate = h("input", { type: "range", min: 0.5, max: 1.3, step: 0.05, value: settings.rate, "aria-label": "Speed",
    oninput: (e) => { settings.rate = +e.target.value; saveSettings(); } });
  const status = h("span", { class: "muted small" });
  const play = (from = nums[0]) => {
    const segs = nums.filter((n) => n >= from).map((n) => ({ id: n, text: speakable(modeSel.value, { words: words[String(n)] }) }));
    status.textContent = "";
    speak(modeSel.value, segs, { rate: settings.rate,
      onSegment: (n) => { document.querySelectorAll(".fv.reading").forEach((x) => x.classList.remove("reading"));
        const el = document.getElementById(`fv${n}`); if (el) { el.classList.add("reading"); el.scrollIntoView({ block: "center", behavior: "smooth" }); } },
      onDone: () => document.querySelectorAll(".fv.reading").forEach((x) => x.classList.remove("reading")) })
      .catch((err) => { status.textContent = err.message + (avail.supported ? " On Android: Settings → Text-to-speech → install the voice data." : ""); });
  };
  const prev = c > 1 ? `#/full/${bk.osis}/${c - 1}` : (BOOKS[bk.i - 1] ? `#/full/${BOOKS[bk.i - 1].osis}/${BOOKS[bk.i - 1].ch}` : null);
  const next = c < bk.ch ? `#/full/${bk.osis}/${c + 1}` : (BOOKS[bk.i + 1] ? `#/full/${BOOKS[bk.i + 1].osis}/1` : null);
  fill($("#full"),
    h("div", { class: "toolbar" },
      h("div", { class: "nav-row" },
        prev ? h("a", { class: "btn", href: prev }, "‹") : null,
        h("strong", {}, `${bk.name} ${c}`),
        next ? h("a", { class: "btn", href: next }, "›") : null,
        h("a", { class: "btn small", href: `#/read/${bk.osis}/${c}` }, "Back to parallel view")),
      h("div", { class: "chips" },
        h("button", { class: "btn primary", onclick: () => play() }, "▶ Read aloud"),
        h("button", { class: "btn", onclick: () => stopSpeech() }, "■ Stop"),
        modeSel, h("label", { class: "chip" }, "Speed ", rate),
        heb ? h("label", { class: "chip" }, "Script ", h("select", { onchange: (e) => { settings.script = e.target.value; saveSettings(); route(); } },
          [["masoretic", "Masoretic"], ["plain", "Vowels only"], ["consonants", "Consonants"], ["paleo", "Paleo-Hebrew"]]
            .map(([v, l]) => h("option", { value: v, selected: settings.script === v }, l)))) : null,
        h("label", { class: "chip" }, h("input", { type: "checkbox", checked: showEng, onchange: (e) => { settings.fullEnglish = e.target.checked; saveSettings(); route(); } }),
          ` ${ver.toUpperCase()} under each verse`)),
      status,
      h("p", { class: "muted small" }, MODES[mode].label.includes("reconstructed") || MODES[mode].label.includes("Erasmian")
        ? "Ancient pronunciation is a scholarly reconstruction read by a Spanish voice (for its pure vowels); treat it as an approximation."
        : `Uses the ${heb ? "Hebrew" : "Greek"} voice on this device.`)),
    historyStrip(bk, c),
    !words ? h("p", { class: "muted" }, "The original-language text for this chapter isn't available.")
      : h("article", { class: `full-text ${heb ? "heb" : "grk"} script-${heb ? settings.script : "greek"}`, dir: heb ? "rtl" : "ltr", lang: heb ? "hbo" : "grc" },
        h("h1", { class: "full-title" }, heb ? `${bk.name} · פרק ${hebNum(c)}` : `${bk.name} ${c}`),
        nums.map((n) => h("span", { class: "fv", id: `fv${n}` },
          h("button", { class: "fvn", title: "Read from here", onclick: () => play(n) }, heb ? hebNum(n) : n),
          " ",
          words[String(n)].map((w, i) => [i ? " " : "", h("button", { class: "fw", onclick: () => wordPanel(w, heb, `${bk.osis}.${c}.${n}`, i) },
            heb ? renderHebrew(w[0], settings.script) : w[0])]),
          showEng && eng[n - 1] ? h("span", { class: "fe", dir: "ltr", lang: "en" }, eng[n - 1]) : null,
          " "))));
}

// ---------------------------------------------------------------- topic study: find contradictions on a subject
const NEG_WORDS = {
  en: ["not", "no", "never", "neither", "nor", "none", "nothing", "cannot", "can't", "nay", "nobody", "without"],
  de: ["nicht", "kein", "keine", "keinen", "nie", "niemals", "weder", "noch", "niemand", "nichts"],
  fr: ["ne", "pas", "point", "jamais", "aucun", "aucune", "ni", "personne", "rien"],
  es: ["no", "nunca", "jamás", "ni", "nadie", "nada", "ninguno"], pt: ["não", "nunca", "jamais", "nem", "ninguém", "nada", "nenhum"],
  it: ["non", "mai", "né", "nessuno", "niente"], nl: ["niet", "geen", "nooit", "noch", "niemand", "niets"],
  ru: ["не", "нет", "ни", "никогда", "никто", "ничего"], uk: ["не", "ні", "ніколи", "ніхто"], pl: ["nie", "nigdy", "ani", "nikt", "nic"],
  cs: ["ne", "nikdy", "ani", "nikdo", "nic"], sv: ["inte", "icke", "ej", "aldrig", "ingen", "inget"], ro: ["nu", "niciodată", "nici", "nimeni"],
  hu: ["nem", "soha", "sem", "senki", "semmi"], la: ["non", "nec", "neque", "nemo", "nihil", "numquam", "ne"],
  eo: ["ne", "neniam", "nek", "neniu", "nenio"], vi: ["không", "chẳng", "chớ", "đừng"], gr: ["οὐ", "οὐκ", "οὐχ", "μή", "οὐδείς", "οὐδέ"],
  he: ["לא", "אל", "אין", "בלי"], ar: ["لا", "لم", "لن", "ليس", "ما"], zh: ["不", "没", "沒", "非", "無", "无", "莫", "勿", "未"],
};
const STOPWORDS = new Set("the and of to in that he she it his her him they them their a an is was be for with as by on unto upon i me my thou thee thy ye you your we us our not shall will which who what this these those from at or but have had hath said lord god".split(" "));
const lc = (s) => s.toLocaleLowerCase();
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function negatedNear(text, term, lang) {
  const neg = NEG_WORDS[lang] || NEG_WORDS.en;
  const t = lc(text);
  if (lang === "zh") { const i = t.indexOf(lc(term)); return i > 0 && neg.some((n) => t.slice(Math.max(0, i - 4), i).includes(n)); }
  const tokens = t.split(/[^\p{L}\p{M}']+/u);
  const tl = lc(term);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith(tl) && tokens.slice(Math.max(0, i - 4), i).some((w) => neg.includes(w))) return true;
  }
  return false;
}

async function viewTopic(_p, q) {
  const query = (q.get("q") || "").trim();
  const ver = q.get("v") || primaryVer();
  const tinfo = trans(ver);
  const input = h("input", { type: "search", value: query, placeholder: "A subject, e.g. tempt, see God, divorce, Sabbath, faith, Satan…", "aria-label": "Subject" });
  const verSel = h("select", { "aria-label": "Translation to search" }, manifest.translations.map((t) =>
    h("option", { value: t.id, selected: t.id === ver }, `${t.id.toUpperCase()} — ${LANG_NAME[t.lang] || t.lang || "English"}`)));
  const out = h("div", {});
  fill(main(), h("h1", {}, "Topic: find contradictions"),
    h("p", { class: "lead" }, "Enter a subject. The app gathers what the whole Bible says about it — in the Hebrew and Greek words themselves and in the translation you choose (type the subject in that translation's language) — then separates verses that affirm it from verses that deny it and pairs them up as possible contradictions."),
    h("form", { class: "search-form", onsubmit: (e) => { e.preventDefault(); location.hash = `#/topic?q=${encodeURIComponent(input.value.trim())}&v=${verSel.value}`; } },
      input, verSel, h("button", { class: "btn primary" }, "Find")),
    out);
  if (!query) {
    fill(out, h("p", { class: "muted" }, "Try: ", ["tempt", "repent", "see God", "faith", "divorce", "swear", "judge", "peace"].map((x, i) =>
      [i ? " · " : "", h("a", { href: `#/topic?q=${encodeURIComponent(x)}&v=${ver}` }, x)])));
    return;
  }
  fill(out, loading());
  const terms = query.split(/\s+/).filter((w) => w.length > 1);
  const key = lc(terms.reduce((a, b) => (b.length > a.length ? b : a), terms[0] || query));
  const stemmed = key.length > 4 ? key.replace(/(ed|es|s|ing|eth|est)$/, "") : key;

  // 1. curated material that mentions the subject
  const hay = (o) => lc(JSON.stringify(o));
  const known = [
    ...contra.items.filter((x) => (x.topics || []).some((t) => terms.some((q2) => lc(t).startsWith(lc(q2)))) || hay([x.title, x.passages]).includes(stemmed))
      .map((x) => ({ kind: "Contradiction", title: x.title, open: () => contraPanel(x), refs: x.passages.map((p) => p.ref) })),
    ...diffs.items.filter((x) => hay([x.title, x.mt, x.lxx, x.ntr]).includes(stemmed))
      .map((x) => ({ kind: "Text difference", title: x.title, open: () => diffPanel(x), refs: [x.ot, ...(x.nt || [])] })),
    ...hard.items.filter((x) => hay([x.title, x.what]).includes(stemmed))
      .map((x) => ({ kind: "Hard passage", title: x.title, open: () => hardPanel(x), refs: x.refs })),
    ...(history.claims || []).filter((x) => hay([x.claim, x.evidence]).includes(stemmed))
      .map((x) => ({ kind: "History check", title: `${x.claim} — ${history.claimStatus?.[x.status] || ""}`, open: () => claimPanel(x), refs: x.refs })),
  ];

  // 2. Hebrew & Greek words whose meaning matches (English glosses)
  const lexIndex = (await getJSON(`${D}lexindex.json`)) || [];
  const re = new RegExp(`(^|[^a-z])${escRe(stemmed)}`, "i");
  const words = lexIndex.filter(([, , , gloss]) => re.test(gloss || "")).sort((a, b) => b[4] - a[4]).slice(0, 16);

  // 3. verses: original-language occurrences (with negation flags) + translation text search
  const verses = new Map(); // ref -> {neg, via:Set}
  const add = (ref, neg, via) => {
    const cur = verses.get(ref) || { neg: false, via: new Set() };
    cur.neg = cur.neg || neg; cur.via.add(via); verses.set(ref, cur);
  };
  for (const [strong, lemma] of words) {
    const list = (await occGroup(strong))?.[strong] || [];
    for (const r of list.slice(0, 400)) add(r.replace(/^!/, ""), r.startsWith("!"), `${lemma} (${strong})`);
  }
  const m = await verseMap(ver);
  let textHits = 0;
  const tl = lc(stemmed);
  for (const [bi, c, v, t] of m.rows) {
    if (lc(t).includes(tl) && terms.every((x) => lc(t).includes(lc(x).slice(0, Math.max(3, lc(x).length - 2))))) {
      add(`${BOOKS[bi].osis}.${c}.${v}`, negatedNear(t, stemmed, tinfo?.lang || "en"), `“${stemmed}” in ${ver.toUpperCase()}`);
      if (++textHits > 800) break;
    }
  }
  const refs = [...verses.keys()].sort((x, y) => {
    const a2 = parseOsis(x), b2 = parseOsis(y); return book(a2.b).i - book(b2.b).i || a2.c - b2.c || a2.v - b2.v;
  });
  const texts = new Map(await Promise.all(refs.slice(0, 700).map(async (r) => [r, await verseText(ver, r)])));
  // English/other-language polarity for verses found only through the originals
  for (const r of refs) { const v = verses.get(r); if (!v.neg && texts.get(r) && negatedNear(texts.get(r), stemmed, tinfo?.lang || "en")) v.neg = true; }
  const aff = refs.filter((r) => !verses.get(r).neg), neg = refs.filter((r) => verses.get(r).neg);

  // 4. possible contradictions: pair each denying verse with the most similar affirming verse
  const content = (t) => new Set(lc(t || "").split(/[^\p{L}]+/u).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !w.startsWith(tl)));
  const pairs = [];
  for (const n of neg.slice(0, 200)) {
    const cn = content(texts.get(n));
    let best = null;
    for (const a of aff.slice(0, 600)) {
      const ca = content(texts.get(a));
      let shared = 0; for (const w of cn) if (ca.has(w)) shared++;
      if (shared && (!best || shared > best.shared)) best = { a, n, shared };
    }
    if (best) pairs.push(best);
  }
  pairs.sort((x, y) => y.shared - x.shared);

  const mark = (t) => {
    const negs = NEG_WORDS[tinfo?.lang || "en"] || [];
    const reAll = new RegExp(`(${[escRe(stemmed) + "\\p{L}*", ...negs.map((n) => `(?<![\\p{L}])${escRe(n)}(?![\\p{L}])`)].join("|")})`, "giu");
    return (t || "").split(reAll).map((part, i) => i % 2 ? h("mark", { class: lc(part).startsWith(tl) ? "topic-term" : "topic-neg" }, part) : part);
  };
  const verseLi = (r) => h("li", {}, refLink(r), " ", h("span", { class: "small" }, mark(texts.get(r))),
    h("div", { class: "muted tiny" }, [...verses.get(r).via].join(" · ")));
  const comparePair = (p) => {
    const c2 = compareTexts(texts.get(p.a) || "", texts.get(p.n) || "");
    openPanel("Possible contradiction",
      h("p", { class: "muted small" }, `Paired automatically because both mention “${stemmed}” and share ${p.shared} other key word${p.shared > 1 ? "s" : ""}; one affirms, the other negates.`),
      h("h4", {}, refLink(p.a), " — affirms"), h("p", { class: "verse-quote" }, diffTokens(c2.a, "mt")),
      h("h4", {}, refLink(p.n), " — negates"), h("p", { class: "verse-quote" }, diffTokens(c2.b, "lxx")),
      h("p", { class: "muted small" }, "Highlighted words appear in only one of the two verses. Check the context: many apparent conflicts disappear in context, some don't."));
  };
  fill(out,
    known.length ? h("section", {}, h("h2", {}, `Known contradictions and issues (${known.length})`),
      h("ul", { class: "saved" }, known.map((k) => h("li", {}, h("span", { class: "tag" }, k.kind), " ",
        h("button", { class: "linkish", onclick: k.open }, k.title), " — ", h("span", { class: "small" }, k.refs.map((r, i) => [i ? "; " : "", refLink(r)]))))))
      : h("p", { class: "muted" }, "No curated contradictions on this subject yet; see the automatic results below."),
    words.length ? h("section", {}, h("h2", {}, "Hebrew and Greek words for this subject"),
      h("div", { class: "chips" }, words.map(([s2, lemma, tr, gloss, n]) => h("a", { class: "chip", href: `#/search?q=${s2}` },
        h("span", { lang: s2[0] === "H" ? "hbo" : "grc", class: s2[0] === "H" ? "heb-inline" : "" }, lemma), ` ${tr} · “${gloss}” · ${s2} · ${n}×`))))
      : h("p", { class: "muted small" }, "No Hebrew or Greek lexicon match (the lexicon glosses are in English, so try an English word for the original-language search)."),
    pairs.length ? h("section", {}, h("h2", {}, `Possible contradictions to examine (${Math.min(pairs.length, 20)})`),
      h("ol", { class: "pairs" }, pairs.slice(0, 20).map((p) => h("li", {},
        h("div", { class: "pair" },
          h("div", {}, h("span", { class: "pol aff" }, "Affirms"), " ", refLink(p.a), h("div", { class: "small" }, mark(texts.get(p.a)))),
          h("div", {}, h("span", { class: "pol neg" }, "Negates"), " ", refLink(p.n), h("div", { class: "small" }, mark(texts.get(p.n))))),
        h("button", { class: "linkish small", onclick: () => comparePair(p) }, "Compare side by side")))),
      h("p", { class: "muted small" }, "Found automatically (affirming vs. negating verses that share key words). They are leads to check, not conclusions.")) : null,
    h("section", {}, h("h2", {}, `All verses (${refs.length}${refs.length > 700 ? ", first 700 shown" : ""})`),
      h("div", { class: "pair cols" },
        h("div", {}, h("h3", {}, h("span", { class: "pol aff" }, "Affirms"), ` ${aff.length}`), h("ol", { class: "occ" }, aff.slice(0, 350).map(verseLi))),
        h("div", {}, h("h3", {}, h("span", { class: "pol neg" }, "Negates"), ` ${neg.length}`), h("ol", { class: "occ" }, neg.slice(0, 350).map(verseLi))))));
}

// ---------------------------------------------------------------- contradictions between passages
const CON_SHORT = { numbers: "Samuel/Kings vs Chronicles", history: "Old Testament accounts", gospels: "Gospels", acts: "Acts", teaching: "Teachings" };

function viewContradictions(_p, q) {
  const cat = q.get("cat") || "";
  const items = contra.items.filter((x) => !cat || x.cat === cat);
  const chip = (id, label) => h("a", { class: `chip${cat === id ? " on" : ""}`, href: `#/contradictions${id ? "?cat=" + id : ""}` }, label);
  fill(main(),
    h("h1", {}, "Contradictions"),
    h("p", { class: "lead" }, "Passages that appear to conflict with each other: parallel accounts with different numbers, names or details. Open one to see the passages side by side with the differing words highlighted, the usual explanations, and the manuscript evidence. Record your own verdict on each."),
    h("div", { class: "chips" }, chip("", `All (${contra.items.length})`),
      Object.keys(contra.categories).map((k) => chip(k, `${CON_SHORT[k] || k} (${contra.items.filter((x) => x.cat === k).length})`))),
    h("p", {}, h("a", { href: "#/differences" }, "Where the Hebrew, Septuagint and New Testament quotations differ ›")),
    h("div", { class: "table-wrap" }, h("table", { class: "xsection" },
      h("thead", {}, h("tr", {}, h("th", {}, "Question"), h("th", {}, "Passage A"), h("th", {}, "Passage B"), h("th", {}, "Your verdict"))),
      h("tbody", {}, items.map((x) => h("tr", {},
        h("td", {}, h("button", { class: "linkish", onclick: () => contraPanel(x) }, x.title), h("div", { class: "tag" }, CON_SHORT[x.cat] || x.cat)),
        h("td", {}, h("div", {}, refLink(x.passages[0].ref)), h("div", { class: "small" }, x.passages[0].says)),
        h("td", {}, x.passages.slice(1).map((p) => h("div", { class: "small-gap" }, h("div", {}, refLink(p.ref)), h("div", { class: "small" }, p.says)))),
        h("td", {}, store.get("verdicts", "c:" + x.id)?.verdict || h("span", { class: "muted" }, "—"))))))));
}

const CON_VERDICTS = ["", "Copying (scribal) error", "Both accurate — they can be harmonized", "Different events or counts",
  "Genuine contradiction", "Different sources combined", "Theological emphasis, not a factual claim", "Unresolved"];

async function contraPanel(x) {
  const ver = primaryVer();
  const key = "c:" + x.id;
  const cur = store.get("verdicts", key) || {};
  const sel = h("select", {}, CON_VERDICTS.map((v) => h("option", { value: v, selected: cur.verdict === v }, v || "— choose —")));
  const notes = h("textarea", { rows: 3, placeholder: "Your reasoning…" }, cur.note || "");
  const body = h("div", {}, loading());
  openPanel(x.title, body);
  const texts = await Promise.all(x.passages.map((p) => verseText(ver, p.ref)));
  // highlight each passage against the first one (same translation, so highlights are real wording differences)
  const base = texts[0];
  const blocks = x.passages.map((p, i) => {
    let content = texts[i] || h("em", { class: "muted" }, "Text not loaded.");
    if (texts[i] && texts.length > 1) {
      const cmp = compareTexts(i === 0 ? texts[0] : base, i === 0 ? (texts[1] || "") : texts[i]);
      content = diffTokens(i === 0 ? cmp.a : cmp.b, i === 0 ? "mt" : "lxx");
    }
    return h("div", { class: "con-passage" }, h("h4", {}, refLink(p.ref), h("span", { class: "muted small" }, ` · ${ver.toUpperCase()}`)),
      h("p", { class: "small muted" }, p.says), h("p", { class: "verse-quote" }, content), passageLinks(p.ref));
  });
  fill(body,
    h("div", { class: "tag" }, contra.categories[x.cat] || x.cat),
    h("div", { class: "legend small" }, h("mark", { class: "only-mt" }, "wording only in the first passage"), " ",
      h("mark", { class: "only-lxx" }, "wording only in this passage")),
    blocks,
    x.explanations?.length ? [h("h3", {}, "Common explanations"), h("ul", {}, x.explanations.map((e) => h("li", {}, e)))] : null,
    learnMore(x.title, x.passages.map((p) => p.ref), x.wiki, "contradiction"),
    x.note ? [h("h3", {}, "Manuscript evidence"), h("p", { class: "def" }, x.note)] : null,
    h("h3", {}, "Your verdict"), sel, notes,
    h("button", { class: "btn primary", onclick: () => {
      store.set("verdicts", key, sel.value || notes.value.trim() ? { verdict: sel.value, note: notes.value.trim() } : null);
      if (location.hash.startsWith("#/contradictions")) route(); else closePanel();
    } }, "Save verdict"));
}

// ---------------------------------------------------------------- whole-book Hebrew vs Septuagint scan
async function viewCompare([b]) {
  const ot = BOOKS.filter((x) => x.t === "OT");
  const bk = book(b) || ot[0];
  const sel = h("select", { "aria-label": "Book", onchange: (e) => (location.hash = `#/compare/${e.target.value}`) },
    ot.map((x) => h("option", { value: x.osis, selected: x.osis === bk.osis }, x.name)));
  fill(main(), h("h1", {}, "Hebrew Bible vs Septuagint"),
    h("p", { class: "lead" }, "Every verse of a book compared automatically: the Hebrew (Masoretic) text, through the KJV, against the Septuagint, through Brenton's translation. Verses are ranked by how much they differ."),
    h("div", { class: "row" }, "Book: ", sel, h("a", { href: "#/differences" }, "Curated list of key differences ›")),
    h("div", { id: "cmp-out" }, loading()));
  if (!hasLxx(lxxE()) || bk.t !== "OT") { fill($("#cmp-out"), h("p", { class: "muted" }, "The Septuagint text isn't available.")); return; }
  const base = manifest.translations.some((t) => t.id === "kjv") ? "kjv" : primaryVer();
  const [mt, lxx] = await Promise.all([textBook(base, bk.osis), lxxBook(lxxE(), bk.osis)]);
  if (!mt || !lxx) { fill($("#cmp-out"), h("p", { class: "muted" }, "This book isn't available in both texts.")); return; }
  const rows = [], perCh = [];
  for (let c = 1; c <= bk.ch; c++) {
    const lc = lxxChapters(bk.osis, c);
    const lv = {};
    lc.forEach((n) => Object.entries(lxx[String(n)] || {}).forEach(([vn, t]) => (lv[lc.length > 1 ? `${n}:${vn}` : vn] = t)));
    const cmp = compareChapter(mt[c - 1] || [], lv);
    perCh.push([c, chapterStats(cmp)]);
    for (const [v, cv] of Object.entries(cmp.verses)) {
      const lvl = level(cv);
      if (lvl === "major" || lvl === "missing-lxx" || lvl === "minor") rows.push({ c, v: +v, cv, lvl });
    }
  }
  const rank = { "missing-lxx": 0, major: 1, minor: 2 };
  rows.sort((x, y) => rank[x.lvl] - rank[y.lvl] || x.cv.score - y.cv.score);
  const totals = perCh.reduce((a, [, s]) => ({ major: a.major + s.major, minor: a.minor + s.minor, missing: a.missing + s.missing, extra: a.extra + s.extra }), { major: 0, minor: 0, missing: 0, extra: 0 });
  const filt = h("select", { onchange: () => draw() },
    h("option", { value: "big" }, "Major differences and missing verses"), h("option", { value: "all" }, "All differences"));
  const list = h("div", {});
  const draw = () => {
    const show = rows.filter((r) => filt.value === "all" || r.lvl !== "minor").slice(0, 300);
    fill(list, show.length ? show.map((r) => h("div", { class: "cmp-row" },
      h("div", { class: "cmp-head" }, refLink(`${bk.osis}.${r.c}.${r.v}`), " ", h("span", { class: `lvl lvl-${r.lvl}` }, LEVEL_LABEL[r.lvl]),
        r.cv.lxxKey && r.cv.lxxKey !== String(r.v) ? h("span", { class: "muted small" }, ` · LXX ${lxxChapters(bk.osis, r.c).length > 1 ? r.cv.lxxKey : r.c + ":" + r.cv.lxxKey}`) : null),
      h("div", { class: "cmp-pair" },
        h("div", {}, h("div", { class: "muted small" }, "Hebrew (KJV)"), diffTokens(r.cv.a, "mt")),
        h("div", {}, h("div", { class: "muted small" }, "Septuagint (Brenton)"), r.cv.missingB ? h("em", { class: "muted" }, "not in the Septuagint") : diffTokens(r.cv.b, "lxx")))))
      : h("p", { class: "muted" }, "No differences found at this level."));
  };
  fill($("#cmp-out"),
    h("p", { class: "notice" }, h("strong", {}, bk.name), `: ${totals.major} major differences, ${totals.minor} smaller ones, ${totals.missing} verses not in the Septuagint, ${totals.extra} Septuagint verses with no Hebrew match.`),
    h("div", { class: "legend small" }, h("mark", { class: "only-mt" }, "only in the Hebrew"), " ", h("mark", { class: "only-lxx" }, "only in the Septuagint"),
      " — a few highlights are only different English word choices."),
    h("details", {}, h("summary", {}, "By chapter"), h("div", { class: "table-wrap" }, h("table", { class: "xsection narrow" },
      h("thead", {}, h("tr", {}, ["Chapter", "Major", "Smaller", "Missing in LXX", "Only in LXX"].map((x) => h("th", {}, x)))),
      h("tbody", {}, perCh.map(([c, s]) => h("tr", {}, h("td", {}, h("a", { href: `#/read/${bk.osis}/${c}` }, `${bk.name} ${c}`)),
        h("td", {}, s.major || ""), h("td", {}, s.minor || ""), h("td", {}, s.missing || ""), h("td", {}, s.extra || ""))))))),
    h("div", { class: "row" }, "Show: ", filt), list);
  draw();
}

// ---------------------------------------------------------------- search
async function viewSearch(_p, q) {
  const query = (q.get("q") || "").trim();
  const ver = q.get("v") || primaryVer();
  const input = h("input", { type: "search", value: query, placeholder: "Words, a reference (John 3:16), or Strong's (H7225, G26)", "aria-label": "Search" });
  const verSel = h("select", { "aria-label": "Translation" }, manifest.translations.map((t) => h("option", { value: t.id, selected: t.id === ver }, t.id.toUpperCase())));
  const results = h("div", { id: "results" });
  const form = h("form", { class: "search-form", onsubmit: (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(input.value.trim())}&v=${verSel.value}`;
  } }, input, verSel, h("button", { class: "btn primary" }, "Search"));
  fill(main(), h("h1", {}, "Search"), form, results);
  if (!query) { results.append(h("p", { class: "muted" }, "Tip: tap any Hebrew or Greek word in the reader to search for every place it's used.")); return; }

  const ref = parseUserRef(query);
  if (ref && /\d/.test(query)) { location.hash = `#/read/${ref.b}/${ref.c}${ref.v ? "/" + ref.v : ""}`; return; }

  const sm = /^([HG])0*(\d{1,5})$/i.exec(query);
  results.append(loading());
  if (sm) {
    const strong = `${sm[1].toUpperCase()}${String(+sm[2]).padStart(4, "0")}`;
    const [lex, occ] = await Promise.all([lexGroup(strong).then((g) => g?.[strong]), occGroup(strong).then((g) => occRefs(g?.[strong]))]);
    const items = await Promise.all(occ.slice(0, 300).map(async (r) => h("li", {}, refLink(r), " ", h("span", { class: "small" }, await verseText(ver, r)))));
    fill(results, 
      lex ? h("div", { class: "lex" }, h("h2", {}, lex[0], " ", h("span", { class: "muted" }, `${lex[1]} · ${strong}`)), h("p", { class: "gloss" }, lex[3]), lex[4] ? h("p", { class: "def" }, lex[4]) : null) : h("h2", {}, strong),
      h("p", {}, `${occ.length} verse${occ.length === 1 ? "" : "s"}${occ.length > 300 ? " (first 300 shown)" : ""}`),
      h("ol", { class: "occ" }, items));
    return;
  }

  const m = await verseMap(ver);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const phrase = /^".*"$/.test(query) ? query.slice(1, -1).toLowerCase() : null;
  const hits = [];
  for (const [bi, c, v, t] of m.rows) {
    const lt = t.toLowerCase();
    if (phrase ? lt.includes(phrase) : terms.every((x) => lt.includes(x))) {
      hits.push([bi, c, v, t]);
      if (hits.length >= 1000) break;
    }
  }
  const mark = (t) => {
    const words = phrase ? [phrase] : terms;
    const re = new RegExp(`(${words.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
    return t.split(re).map((part, i) => (i % 2 ? h("mark", {}, part) : part));
  };
  fill(results, 
    h("p", {}, `${hits.length}${hits.length >= 1000 ? "+" : ""} verse${hits.length === 1 ? "" : "s"} in ${ver.toUpperCase()}`),
    h("ol", { class: "occ" }, hits.slice(0, 500).map(([bi, c, v, t]) => {
      const r = `${BOOKS[bi].osis}.${c}.${v}`;
      return h("li", {}, refLink(r), " ", h("span", { class: "small" }, mark(t)));
    })));
}

// ---------------------------------------------------------------- plans
function viewPlans(parts) {
  const id = parts[0];
  const plans = store.all("plans");
  if (!id) {
    fill(main(), h("h1", {}, "Reading plans"),
      h("ul", { class: "cards" }, PLANS.map((p) => {
        const st = plans[p.id]?.v;
        const done = st ? Object.keys(st.done || {}).length : 0;
        return h("li", { class: "card" }, h("a", { href: `#/plans/${p.id}` }, h("strong", {}, p.name)),
          h("div", { class: "muted small" }, st ? `${done} of ${p.days} days done · started ${st.start}` : `${p.days} days`),
          st ? h("progress", { max: p.days, value: done }) : null);
      })));
    return;
  }
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) { location.hash = "#/plans"; return; }
  const days = planDays(id);
  const st = plans[id]?.v;
  const today = st ? Math.min(days.length, Math.max(1, Math.floor((Date.now() - Date.parse(st.start)) / 864e5) + 1)) : 1;
  const setDone = (d, on) => {
    const cur = store.get("plans", id) || { start: new Date().toISOString().slice(0, 10), done: {} };
    const done = { ...cur.done };
    if (on) done[d] = new Date().toISOString().slice(0, 10); else delete done[d];
    store.set("plans", id, { ...cur, done });
    viewPlans(parts);
  };
  const label = (chs) => {
    const groups = [];
    for (const r of chs) {
      const [b, c] = r.split(".");
      const last = groups[groups.length - 1];
      if (last && last.b === b && last.c2 === +c - 1) last.c2 = +c; else groups.push({ b, c: +c, c2: +c });
    }
    return groups.map((g, i) => [i ? "; " : "", h("a", { href: `#/read/${g.b}/${g.c}` },
      `${book(g.b).name} ${g.c}${g.c2 !== g.c ? "–" + g.c2 : ""}`)]);
  };
  fill(main(), 
    h("p", {}, h("a", { href: "#/plans" }, "‹ All plans")),
    h("h1", {}, plan.name),
    st ? h("p", {}, `Started ${st.start}. Today is day ${today}. `,
      h("button", { class: "btn small", onclick: () => { if (confirm("Reset progress for this plan?")) { store.set("plans", id, null); viewPlans(parts); } } }, "Reset"))
      : h("button", { class: "btn primary", onclick: () => { store.set("plans", id, { start: new Date().toISOString().slice(0, 10), done: {} }); viewPlans(parts); } }, "Start this plan today"),
    h("ol", { class: "plan-days" }, days.map((chs, i) => {
      const d = i + 1;
      return h("li", { class: `${st?.done?.[d] ? "done" : ""}${st && d === today ? " today" : ""}`, id: `day${d}` },
        h("label", {}, h("input", { type: "checkbox", checked: Boolean(st?.done?.[d]), onchange: (e) => setDone(d, e.target.checked) }),
          h("strong", {}, `Day ${d}`)), " ", label(chs));
    })));
  if (st) document.getElementById(`day${today}`)?.scrollIntoView({ block: "center" });
}

// ---------------------------------------------------------------- saved
async function viewSaved() {
  const ver = primaryVer();
  const sortRefs = (keys) => keys.sort((a, b) => {
    const pa = parseOsis(a), pb = parseOsis(b);
    return (book(pa.b).i - book(pb.b).i) || (pa.c - pb.c) || (pa.v - pb.v);
  });
  const section = async (title, kind, render) => {
    const keys = sortRefs(Object.keys(store.all(kind)).filter((k) => parseOsis(k)));
    if (!keys.length) return h("section", {}, h("h2", {}, title), h("p", { class: "muted" }, "Nothing yet."));
    return h("section", {}, h("h2", {}, `${title} (${keys.length})`),
      h("ul", { class: "saved" }, await Promise.all(keys.map(async (k) => h("li", {}, refLink(k), " ", await render(k))))));
  };
  const verdictKeys = Object.keys(store.all("verdicts"));
  fill(main(), h("h1", {}, "Saved"), loading());
  const parts = await Promise.all([
    section("Notes", "notes", async (k) => h("div", { class: "note-body" }, store.get("notes", k).body)),
    section("Bookmarks", "bookmarks", async (k) => h("span", { class: "small" }, await verseText(ver, k))),
    section("Highlights", "highlights", async (k) => h("span", { class: `small hl-${store.get("highlights", k)}` }, await verseText(ver, k))),
  ]);
  const fileIn = h("input", { type: "file", accept: "application/json", onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { store.importJSON(await f.text()); viewSaved(); } catch { alert("That file couldn't be read."); }
  } });
  fill(main(), h("h1", {}, "Saved"), ...parts,
    h("section", {}, h("h2", {}, `Your verdicts on differences and contradictions (${verdictKeys.length})`),
      verdictKeys.length ? h("ul", { class: "saved" }, verdictKeys.map((k) => {
        const isC = k.startsWith("c:"), isH = k.startsWith("h:");
        const d = isC ? contra.items.find((x) => "c:" + x.id === k) : isH ? hard.items.find((x) => "h:" + x.id === k) : diffs.items.find((x) => x.id === k);
        const v = store.get("verdicts", k);
        return h("li", {}, h("button", { class: "linkish", onclick: () => d && (isC ? contraPanel(d) : isH ? hardPanel(d) : diffPanel(d)) }, d?.title || k), ` — ${v.verdict || ""}`,
          v.note ? h("div", { class: "note-body" }, v.note) : null);
      })) : h("p", { class: "muted" }, "Nothing yet.")),
    h("section", {}, h("h2", {}, "Backup"),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => {
          const a = h("a", { href: URL.createObjectURL(new Blob([store.exportJSON()], { type: "application/json" })), download: "bible-notes-backup.json" });
          a.click();
        } }, "Download backup"),
        h("label", { class: "btn" }, "Restore from file", fileIn))));
  fileIn.style.display = "none";
}

// ---------------------------------------------------------------- settings & account
function viewSettings() {
  const email = h("input", { type: "email", placeholder: "you@example.com", "aria-label": "Email" });
  const msg = h("p", { class: "muted small" });
  const voiceBox = h("p", { class: "small muted" }, "Checking voices…");
  availability().then((av) => fill(voiceBox, !av.supported ? "This browser can't speak text." :
    Object.entries(MODES).map(([k, m]) => h("div", {}, av[k] ? "✓ " : "✗ ", m.label, av[k] ? "" : " — no voice installed (Android: Settings → System → Text-to-speech → install voice data)"))));
  fill(main(), h("h1", {}, "More"),
    h("section", {}, h("h2", {}, "About & sources"), h("p", {}, h("a", { href: "#/about" }, `About ${CONFIG.appName}, translations and data sources ›`))),
    h("section", {}, h("h2", {}, "Audio"), voiceBox),
    h("section", {}, h("h2", {}, "Reading"),
      h("label", { class: "field" }, "Text size ",
        h("input", { type: "range", min: 14, max: 28, value: settings.size, oninput: (e) => { settings.size = +e.target.value; saveSettings(); } })),
      h("label", { class: "field" }, "Theme ",
        h("select", { onchange: (e) => { settings.theme = e.target.value; saveSettings(); } },
          ["auto", "light", "dark", "sepia"].map((t) => h("option", { value: t, selected: settings.theme === t }, t))))),
    h("section", {}, h("h2", {}, "Sync across devices"),
      !store.cloudEnabled
        ? h("p", { class: "muted" }, "Cloud sync isn't set up yet. Your notes and highlights are saved in this browser — use Saved → Download backup to move them.")
        : store.user
          ? [h("p", {}, `Signed in as ${store.user.email}. Notes, highlights, bookmarks, plans and verdicts sync automatically.`),
             h("button", { class: "btn", onclick: async () => { await store.signOut(); viewSettings(); } }, "Sign out")]
          : [h("p", {}, "Sign in with your email to keep your notes on every device. We'll email you a sign-in link."),
             h("form", { class: "row", onsubmit: async (e) => {
               e.preventDefault(); msg.textContent = "Sending…";
               try { await store.signIn(email.value.trim()); msg.textContent = "Check your email for the sign-in link."; }
               catch (err) { msg.textContent = `Couldn't send the link: ${err.message || err}`; }
             } }, email, h("button", { class: "btn primary" }, "Email me a link")), msg]),
  );
}

function viewAbout() {
  const a = manifest.attribution || {};
  fill(main(), h("h1", {}, `About ${CONFIG.appName}`),
    h("p", {}, "Read the Bible alongside the Hebrew, the Greek New Testament and the Septuagint, with word-by-word glosses, grammar, a lexicon, and cross references — and see where the ancient texts differ."),
    h("h2", {}, "Texts and data"),
    h("ul", {}, manifest.translations.map((t) => h("li", {}, `${t.label} — ${t.license}`)),
      manifest.lxx.map((t) => h("li", {}, `${t.label} — ${t.license}`)),
      Object.values(a).map((x) => h("li", {}, x))),
    h("p", { class: "muted small" }, `Data built ${manifest.built || "—"}.`),
    manifest.errors?.length ? h("details", {}, h("summary", {}, "Build warnings"), h("ul", {}, manifest.errors.map((e) => h("li", { class: "small" }, e)))) : null);
}

// ---------------------------------------------------------------- boot
async function boot() {
  applySettings();
  const [books, man, dif, con, hp, hi] = await Promise.all([getJSON("../books.json"), getJSON(`${D}manifest.json`), getJSON("../differences.json"),
    getJSON("../contradictions.json"), getJSON("../hard-passages.json"), getJSON("../history.json")]);
  if (hi) history = hi;
  KEYWORDS = (await getJSON("../keywords.json")) || {};
  if (con) contra = con;
  if (hp) hard = hp;
  setBooks(books || []);
  if (man) manifest = man;
  else fill($("#banner"), h("p", { class: "notice" }, "The Bible data hasn't been built yet. It's generated automatically when the site is deployed (see README)."));
  if (dif) diffs = dif;
  document.title = CONFIG.appName;
  $("#brand").textContent = CONFIG.appName;
  $("#quick").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    e.target.q.blur();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
    if (e.target.matches("input,textarea,select") || !location.hash.match(/^#\/read|^$|^#?$/)) return;
    if (e.key === "ArrowLeft") $(".nav-row a")?.click();
    if (e.key === "ArrowRight") document.querySelectorAll(".nav-row a")[1]?.click();
  });
  store.onChange(() => { /* panels re-render on demand */ });
  route();
  store.init();
  try {
    if (!localStorage.getItem("bible-study:welcomed")) {
      localStorage.setItem("bible-study:welcomed", "1");
      openPanel("Welcome to " + CONFIG.appName,
        h("p", {}, "Read the Bible in English (or 30+ other languages) beside the original Hebrew and Greek."),
        h("ul", { class: "welcome" },
          h("li", {}, h("strong", {}, "Tap a Hebrew or Greek word"), " to see what it means, its grammar, and every other place it's used."),
          h("li", {}, h("strong", {}, "Tap a verse number"), " for cross references, notes, highlights and the verse in Hebrew."),
          h("li", {}, h("strong", {}, "Small letters in the text"), " are footnotes: key words, history, archaeology and textual differences."),
          h("li", {}, h("strong", {}, "Swipe"), " left or right to change chapter. ", h("strong", {}, "Translations"), " and ", h("strong", {}, "⚙ Display"), " are at the top.")),
        h("div", { class: "row" },
          h("a", { class: "btn primary", href: "#/read/Gen/1", onclick: closePanel }, "Genesis 1 in Hebrew"),
          h("a", { class: "btn", href: "#/read/John/1", onclick: closePanel }, "John 1 in Greek"),
          h("a", { class: "btn", href: "#/study", onclick: closePanel }, "Study tools")));
    }
  } catch {}
  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.picker[open]")) if (!d.contains(e.target)) d.open = false;
  });
  let tx = 0, ty = 0;
  $("#main").addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  $("#main").addEventListener("touchend", (e) => {
    if (!/^#\/(read|full)/.test(location.hash || "#/read") && location.hash) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 90 || Math.abs(dy) > 60 || e.target.closest(".table-wrap, .picker-body")) return;
    const links = document.querySelectorAll(".nav-row a.btn");
    if (dx > 0) links[0]?.click(); else links[1]?.click();
  }, { passive: true });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
