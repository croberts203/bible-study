// Hebrew and Greek text utilities: historical scripts, numerals, and the
// romanised spellings used for "ancient" (reconstructed) pronunciation.

const CANTILLATION = /[֑-ֽ֯׀׃׆]/g; // accents, meteg, paseq, sof pasuq, nun hafukha
const POINTS = /[ְ-ׇּֿׁׂׅׄ]/g; // vowels, dagesh, rafe, shin/sin dots

/** Masoretic text without cantillation marks (vowels kept) — what Israeli readers see in most Bibles. */
export function noAccents(s) {
  return String(s || "").replace(/\//g, "").replace(CANTILLATION, "").replace(/־/g, "־");
}

/** Consonants only, as in the Dead Sea Scrolls and Torah scrolls. */
export function consonants(s) {
  return noAccents(s).replace(POINTS, "").replace(/־/g, " ");
}

// 22 letters → Phoenician / Paleo-Hebrew block (U+10900–U+10915); final forms map to the same letter.
const PALEO = {};
"אבגדהוזחטיכלמנסעפצקרשת".split("").forEach((ch, i) => { PALEO[ch] = String.fromCodePoint(0x10900 + i); });
Object.assign(PALEO, { "ך": PALEO["כ"], "ם": PALEO["מ"], "ן": PALEO["נ"], "ף": PALEO["פ"], "ץ": PALEO["צ"] });

/** Paleo-Hebrew letters (First Temple period script), consonants only. */
export function paleo(s) {
  return [...consonants(s)].map((ch) => PALEO[ch] ?? ch).join("");
}

export function renderHebrew(s, mode) {
  if (mode === "paleo") return paleo(s);
  if (mode === "consonants") return consonants(s);
  if (mode === "plain") return noAccents(s);
  return String(s || "").replace(/\//g, "");
}

/** Hebrew numerals for verse/chapter numbers (15 = ט״ו, 16 = ט״ז). */
export function hebNum(n) {
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת"];
  let out = "";
  let x = n;
  while (x >= 400) { out += "ת"; x -= 400; }
  out += hundreds[Math.floor(x / 100)]; x %= 100;
  if (x === 15) out += "טו";
  else if (x === 16) out += "טז";
  else out += tens[Math.floor(x / 10)] + ones[x % 10];
  return out.length > 1 ? out.slice(0, -1) + "״" + out.slice(-1) : out + "׳";
}

// ---------------------------------------------------------------- reconstructed pronunciation
// Both are spelled for a Spanish voice: pure vowels, "j" = the throaty kh sound,
// "z" (Castilian) = th, and an acute accent marks the stressed syllable.

const ACUTE = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
function stressFirstVowel(syl) {
  return syl.replace(/[aeiou]/, (v) => ACUTE[v]);
}

/**
 * Biblical (Tiberian) Hebrew from STEPBible transliteration, e.g. "be./re.Shit" → "bereshít".
 * Capital letters in the source mark the stressed syllable.
 */
export function hebrewAncient(translit) {
  return String(translit || "").split(/\s+/).map((word) => word.split(/[./-]/).filter(Boolean).map((syl) => {
    const stressed = /[A-Z]/.test(syl);
    let t = syl.toLowerCase()
      .replace(/[ʼʾ'’`ʿ]/g, "")
      .replace(/ch|kh|ḥ|ḫ/g, "j")
      .replace(/sh|š/g, "sh")
      .replace(/ts|tz|ṣ/g, "ts")
      .replace(/ṭ/g, "t").replace(/q/g, "k").replace(/w/g, "u")
      .replace(/[āâ]/g, "a").replace(/[ēêĕ]/g, "e").replace(/[īî]/g, "i").replace(/[ōôŏ]/g, "o").replace(/[ūû]/g, "u")
      .replace(/ă/g, "a").replace(/ə/g, "e");
    return stressed ? stressFirstVowel(t) : t;
  }).join("")).join(" ");
}

/**
 * Ancient Greek in the Erasmian (classroom) reconstruction, e.g. "Ἐν ἀρχῇ ἦν ὁ λόγος" → "en arjé en o lógos".
 */
export function greekAncient(text) {
  const words = String(text || "").normalize("NFD").split(/(\s+)/);
  return words.map((w) => {
    if (/^\s+$/.test(w)) return w;
    // collect base letters with their accent flag
    const letters = [];
    for (const ch of w) {
      if (/[̀́͂]/.test(ch)) { if (letters.length) letters[letters.length - 1].acc = true; continue; }
      if (/[̓̔̈ͅ]/.test(ch)) continue;
      if (/[Ͱ-Ͽ]/.test(ch)) letters.push({ ch: ch.toLowerCase(), acc: false });
      else if (/[A-Za-z]/.test(ch)) letters.push({ ch: ch.toLowerCase(), acc: false });
    }
    let out = "";
    const V = (s, acc) => (acc ? s.replace(/[aeiou]/, (v) => ACUTE[v]) : s);
    for (let i = 0; i < letters.length; i++) {
      const { ch, acc } = letters[i];
      const nx = letters[i + 1]?.ch;
      const di = (a, b) => ch === a && nx === b;
      const accPair = acc || letters[i + 1]?.acc;
      if (di("ο", "υ")) { out += V("u", accPair); i++; continue; }
      if (di("α", "ι") || di("ε", "ι") || di("ο", "ι") || di("α", "υ") || di("ε", "υ") || di("η", "υ")) {
        const map = { "αι": "ai", "ει": "ei", "οι": "oi", "αυ": "au", "ευ": "eu", "ηυ": "eu" };
        out += V(map[ch + nx], accPair); i++; continue;
      }
      if (ch === "γ" && ["γ", "κ", "χ", "ξ"].includes(nx)) { out += "n"; continue; }
      const m = { α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "dz", η: "e", θ: "z", ι: "i", κ: "k", λ: "l", μ: "m",
        ν: "n", ξ: "ks", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "u", φ: "f", χ: "j", ψ: "ps", ω: "o" }[ch];
      out += m !== undefined ? V(m, acc) : ch;
    }
    return out;
  }).join("");
}
