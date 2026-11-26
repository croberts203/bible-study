// Decode STEPBible grammar codes into plain English.
// Hebrew/Aramaic codes follow the OSHB scheme (e.g. "HVqp3ms", "HR/Ncfsa").
// Greek codes follow the Robinson scheme (e.g. "V-AAI-3S", "N-NSF").

const H_STEM = { q: "Qal", N: "Niphal", p: "Piel", P: "Pual", h: "Hiphil", H: "Hophal", t: "Hithpael",
  o: "Polel", O: "Polal", r: "Hithpolel", m: "Poel", M: "Poal", k: "Palel", K: "Pulal", Q: "Qal passive",
  l: "Pilpel", L: "Polpal", f: "Hithpalpel", D: "Nithpael", j: "Pealal", i: "Pilel", u: "Hothpaal",
  c: "Tiphil", v: "Hishtaphel", w: "Nithpalel", y: "Nithpoel", z: "Hithpoel" };
const A_STEM = { q: "Peal", Q: "Peil", u: "Hithpeel", p: "Pael", P: "Ithpaal", M: "Hithpaal", a: "Aphel",
  h: "Haphel", s: "Saphel", e: "Shaphel", H: "Hophal", i: "Ithpeel", t: "Hishtaphel", v: "Ishtaphel",
  w: "Hithaphel", o: "Polel", z: "Ithpoel", r: "Hithpolel", f: "Hithpalpel", b: "Hephal", c: "Tiphel",
  m: "Poel", l: "Palpel", L: "Ithpalpel", O: "Ithpolel", G: "Ittaphal" };
const H_TYPE = { p: "perfect", q: "sequential perfect", i: "imperfect", w: "sequential imperfect (wayyiqtol)",
  h: "cohortative", j: "jussive", v: "imperative", r: "participle (active)", s: "participle (passive)",
  a: "infinitive absolute", c: "infinitive construct" };
const PERSON = { 1: "1st person", 2: "2nd person", 3: "3rd person" };
const GENDER = { m: "masculine", f: "feminine", b: "both genders", c: "common" };
const NUMBER = { s: "singular", p: "plural", d: "dual" };
const STATE = { a: "absolute", c: "construct", d: "determined" };

function hebSegment(seg, lang) {
  const pos = seg[0], r = seg.slice(1);
  const pgn = (s) => [PERSON[s[0]], GENDER[s[1]], NUMBER[s[2]]].filter(Boolean).join(" ");
  switch (pos) {
    case "N": {
      const t = { c: "noun", g: "gentilic noun", p: "proper noun", x: "noun" }[r[0]] || "noun";
      return [t, GENDER[r[1]], NUMBER[r[2]], STATE[r[3]]].filter(Boolean).join(", ");
    }
    case "A": {
      const t = { a: "adjective", c: "cardinal number", g: "gentilic adjective", o: "ordinal number" }[r[0]] || "adjective";
      return [t, GENDER[r[1]], NUMBER[r[2]], STATE[r[3]]].filter(Boolean).join(", ");
    }
    case "V": {
      const stem = (lang === "A" ? A_STEM : H_STEM)[r[0]] || r[0];
      const type = H_TYPE[r[1]] || "";
      const rest = r.slice(2);
      let desc;
      if (r[1] === "r" || r[1] === "s") desc = [GENDER[rest[0]], NUMBER[rest[1]], STATE[rest[2]]];
      else if (r[1] === "a" || r[1] === "c") desc = [];
      else desc = [pgn(rest)];
      return ["verb", stem, type, ...desc].filter(Boolean).join(", ");
    }
    case "P": {
      const t = { d: "demonstrative pronoun", f: "indefinite pronoun", i: "interrogative pronoun",
        p: "personal pronoun", r: "relative pronoun" }[r[0]] || "pronoun";
      return [t, pgn(r.slice(1))].filter(Boolean).join(", ");
    }
    case "R": return r[0] === "d" ? "preposition with article" : "preposition";
    case "C": return "conjunction";
    case "D": return "adverb";
    case "T": return ({ a: "particle of affirmation", d: "definite article", e: "exhortation particle",
      i: "interrogative particle", j: "interjection", m: "demonstrative particle", n: "negative particle",
      o: "direct object marker", r: "relative particle" }[r[0]] || "particle");
    case "S": {
      const t = { d: "directional he", h: "paragogic he", n: "paragogic nun", p: "pronominal suffix" }[r[0]] || "suffix";
      return [t, pgn(r.slice(1))].filter(Boolean).join(", ");
    }
    default: return seg;
  }
}

export function decodeHebrew(code) {
  if (!code) return "";
  const lang = code[0] === "A" ? "A" : "H";
  const body = /^[HA]/.test(code) ? code.slice(1) : code;
  const parts = body.split("/").filter(Boolean).map((s) => hebSegment(s, lang));
  return (lang === "A" ? "Aramaic: " : "") + parts.join(" + ");
}

const G_CASE = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const G_NUM = { S: "singular", P: "plural" };
const G_GEN = { M: "masculine", F: "feminine", N: "neuter" };
const G_TENSE = { P: "present", I: "imperfect", F: "future", A: "aorist", R: "perfect", L: "pluperfect",
  "2A": "second aorist", "2F": "second future", "2R": "second perfect", "2L": "second pluperfect" };
const G_VOICE = { A: "active", M: "middle", P: "passive", E: "middle or passive", D: "middle deponent",
  O: "passive deponent", N: "middle or passive deponent", Q: "impersonal active", X: "no voice" };
const G_MOOD = { I: "indicative", S: "subjunctive", O: "optative", M: "imperative", N: "infinitive", P: "participle", R: "imperative participle" };
const G_POS = { N: "noun", A: "adjective", T: "article", R: "relative pronoun", C: "reciprocal pronoun",
  D: "demonstrative pronoun", K: "correlative pronoun", I: "interrogative pronoun", X: "indefinite pronoun",
  Q: "correlative or interrogative pronoun", F: "reflexive pronoun", S: "possessive pronoun", P: "personal pronoun" };
const G_WORD = { ADV: "adverb", CONJ: "conjunction", PREP: "preposition", PRT: "particle", INJ: "interjection",
  COND: "conditional particle", HEB: "Hebrew word", ARAM: "Aramaic word", ARAMAIC: "Aramaic word" };

function cng(s) {
  const out = [];
  if (G_CASE[s[0]]) out.push(G_CASE[s[0]]);
  if (G_NUM[s[1]]) out.push(G_NUM[s[1]]);
  if (G_GEN[s[2]]) out.push(G_GEN[s[2]]);
  return out;
}

export function decodeGreek(code) {
  if (!code) return "";
  const parts = code.split("-");
  const head = parts[0];
  if (G_WORD[head]) {
    const extra = { N: "negative", I: "interrogative" }[parts[1]];
    return [G_WORD[head], extra].filter(Boolean).join(", ");
  }
  if (head === "V") {
    const m = /^(2?[PIFARL])([A-Z])([A-Z])$/.exec(parts[1] || "");
    if (!m) return "verb " + (parts[1] || "");
    const out = ["verb", G_TENSE[m[1]], G_VOICE[m[2]], G_MOOD[m[3]]];
    const t = parts[2] || "";
    if (m[3] === "P" || m[3] === "R") out.push(...cng(t));
    else if (/^[123]/.test(t)) out.push(PERSON[t[0]], G_NUM[t[1]]);
    return out.filter(Boolean).join(", ");
  }
  if (G_POS[head]) {
    const out = [G_POS[head]];
    let t = parts[1] || "";
    if (/^[123]/.test(t)) { out.push(PERSON[t[0]]); t = t.slice(1); }
    if (t === "PRI") out.push("indeclinable proper name");
    else if (t === "NUI") out.push("indeclinable number");
    else if (t === "LI" || t === "OI") out.push("indeclinable");
    else out.push(...cng(t));
    if (parts[2] === "C") out.push("comparative");
    if (parts[2] === "S") out.push("superlative");
    if (parts[2] === "ATT") out.push("Attic form");
    return out.filter(Boolean).join(", ");
  }
  return code;
}

export function decode(code, isHebrew) {
  try { return isHebrew ? decodeHebrew(code) : decodeGreek(code); } catch { return code; }
}
