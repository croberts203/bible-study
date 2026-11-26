// Book list, reference parsing/formatting, Psalm numbering, reading plans.
// Pure functions (no DOM) so they can be tested in Node.

export let BOOKS = [];
const RESOLVE = new Map();

const ALIASES = {
  psalm: "Ps", psalms: "Ps", psa: "Ps", pss: "Ps", song: "Song", songofsongs: "Song", songofsolomon: "Song",
  sos: "Song", canticles: "Song", revelations: "Rev", jn: "John", jhn: "John", mk: "Mark", mrk: "Mark",
  lk: "Luke", luk: "Luke", mt: "Matt", mat: "Matt", phm: "Phlm", philemon: "Phlm", php: "Phil",
  phil: "Phil", jdg: "Judg", jud: "Jude", eze: "Ezek", ezk: "Ezek", jol: "Joel", nam: "Nah",
};

export function normKey(s) {
  return String(s).toLowerCase().trim()
    .replace(/^(iii|third)\s+/, "3").replace(/^(ii|second)\s+/, "2").replace(/^(i|first)\s+/, "1")
    .replace(/[^a-z0-9]/g, "");
}

export function setBooks(list) {
  BOOKS = list;
  RESOLVE.clear();
  list.forEach((b, i) => {
    b.i = i;
    for (const k of [b.osis, b.sil, b.name]) RESOLVE.set(normKey(k), b);
  });
  for (const [k, v] of Object.entries(ALIASES)) if (!RESOLVE.has(k)) RESOLVE.set(k, book(v));
}

export function book(osisOrName) {
  if (!osisOrName) return null;
  const k = normKey(osisOrName);
  if (RESOLVE.has(k)) return RESOLVE.get(k);
  if (k.length >= 2) {
    // unique prefix of a name, e.g. "gen", "deut", "1cor"
    const hits = BOOKS.filter((b) => normKey(b.name).startsWith(k) || normKey(b.osis).startsWith(k));
    if (hits.length === 1 || (hits.length > 1 && k.length >= 3)) return hits[0];
  }
  return null;
}

/** "Gen.1.1" | "John.1.1-John.1.3" -> {b, c, v, c2?, v2?} */
export function parseOsis(ref) {
  const [a, z] = String(ref).split("-");
  const m = /^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/.exec(a || "");
  if (!m) return null;
  const out = { b: m[1], c: +m[2], v: m[3] ? +m[3] : null };
  if (z) {
    const n = /^(?:([1-3]?[A-Za-z]+)\.)?(\d+)(?:\.(\d+))?$/.exec(z);
    if (n) {
      out.b2 = n[1] || out.b;
      if (n[3]) { out.c2 = +n[2]; out.v2 = +n[3]; } else { out.c2 = out.c; out.v2 = +n[2]; }
    }
  }
  return out;
}

export function fmtRef(ref) {
  const r = typeof ref === "string" ? parseOsis(ref) : ref;
  if (!r) return String(ref);
  const name = r.b === "Ps" ? "Psalm" : book(r.b)?.name || r.b;
  let s = `${name} ${r.c}${r.v ? ":" + r.v : ""}`;
  if (r.v2) {
    if (r.b2 && r.b2 !== r.b) s += ` – ${book(r.b2)?.name || r.b2} ${r.c2}:${r.v2}`;
    else if (r.c2 !== r.c) s += `–${r.c2}:${r.v2}`;
    else if (r.v2 !== r.v) s += `–${r.v2}`;
  }
  return s;
}

/** Free-typed reference: "John 3:16", "1 cor 13", "gen 1:1-5", "Ps 23". */
export function parseUserRef(text) {
  const m = /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d+)?(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/.exec(text || "");
  if (!m) return null;
  const b = book(m[1]);
  if (!b) return null;
  // "Jude 3" in a one-chapter book means verse 3
  if (b.ch === 1 && m[2] && !m[3] && +m[2] > 1) return { b: b.osis, c: 1, v: +m[2], v2: null };
  const c = m[2] ? +m[2] : 1;
  if (c < 1 || c > b.ch) return null;
  return { b: b.osis, c, v: m[3] ? +m[3] : null, v2: m[4] ? +m[4] : null };
}

/** Hebrew/English psalm number -> Septuagint psalm number(s). */
export function lxxPsalm(mt) {
  if (mt <= 8) return [mt];
  if (mt === 9 || mt === 10) return [9];
  if (mt <= 113) return [mt - 1];
  if (mt === 114 || mt === 115) return [113];
  if (mt === 116) return [114, 115];
  if (mt <= 146) return [mt - 1];
  if (mt === 147) return [146, 147];
  return [mt];
}

/** Map an OT chapter in English/Hebrew numbering to the LXX chapter(s) to show. */
export function lxxChapters(osis, c) {
  if (osis === "Ps") return lxxPsalm(c);
  return [c];
}

/** Parse "Ps.39.7" written in LXX numbering. */
export const lxxNote = (osis, c) => {
  if (osis === "Ps") {
    const l = lxxPsalm(c);
    return l.length === 1 && l[0] === c ? "" : `Septuagint numbering: Psalm ${l.join(" + ")}`;
  }
  if (osis === "Jer" && c >= 25) return "From Jeremiah 25 on, the Septuagint orders chapters differently; verses may not line up.";
  return "";
};

// ---------------------------------------------------------------- plans
export function allChapters(filter = () => true) {
  const out = [];
  for (const b of BOOKS) if (filter(b)) for (let c = 1; c <= b.ch; c++) out.push(`${b.osis}.${c}`);
  return out;
}
function spread(list, days) {
  const out = Array.from({ length: days }, () => []);
  list.forEach((x, i) => out[Math.floor((i * days) / list.length)].push(x));
  return out;
}
export function planDays(id) {
  switch (id) {
    case "year": return spread(allChapters(), 365);
    case "ot-nt": {
      const ot = spread(allChapters((b) => b.t === "OT" && b.osis !== "Ps" && b.osis !== "Prov"), 365);
      const wis = spread(allChapters((b) => b.osis === "Ps" || b.osis === "Prov"), 365);
      const nt = spread(allChapters((b) => b.t === "NT"), 365);
      return ot.map((d, i) => [...d, ...wis[i], ...nt[i]]);
    }
    case "nt90": return spread(allChapters((b) => b.t === "NT"), 90);
    case "gospels30": return spread(allChapters((b) => ["Matt", "Mark", "Luke", "John"].includes(b.osis)), 30);
    case "ps-prov": return spread(allChapters((b) => b.osis === "Ps" || b.osis === "Prov"), 31);
    case "torah": return spread(allChapters((b) => b.i < 5), 60);
    default: return [];
  }
}
export const PLANS = [
  { id: "year", name: "Whole Bible in a year", days: 365 },
  { id: "ot-nt", name: "Old & New Testament together, one year", days: 365 },
  { id: "nt90", name: "New Testament in 90 days", days: 90 },
  { id: "gospels30", name: "The four Gospels in 30 days", days: 30 },
  { id: "torah", name: "Torah (Genesis–Deuteronomy) in 60 days", days: 60 },
  { id: "ps-prov", name: "Psalms & Proverbs in a month", days: 31 },
];
