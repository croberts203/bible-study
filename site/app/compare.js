// Automatic Hebrew-vs-Septuagint comparison.
//
// The Septuagint data has no word tags, so the comparison is done between two
// English translations made from each text: the KJV (translated from the
// Hebrew Masoretic text) and Brenton (translated from the Greek Septuagint).
// Both are formal, word-for-word translations in similar English, so where
// they diverge the underlying texts usually diverge too. Some highlighted
// words are only translation choices (e.g. "field" vs "plain"); the score
// ignores small words and spelling/archaic-form differences to keep that low.

const STOP = new Set(("a an the and or but of to in into on unto upon at by for from with as that which who whom whose " +
  "this these those it its is are was were be been being am shall will would should may might not no nor so " +
  "then there their them they he him his she her i me my mine we us our you your thou thee thy thine ye all " +
  "also even when what if do did does have has had o oh").split(" "));

const MAP = {
  thee: "you", thou: "you", ye: "you", thy: "your", thine: "your", hath: "has", doth: "does", saith: "says",
  art: "are", wast: "were", shalt: "shall", wilt: "will", hast: "have", dost: "do", didst: "did", unto: "to",
  gat: "got", brake: "broke", sware: "swore",
  jehovah: "lord", yahweh: "lord", lo: "behold", created: "made", create: "make", plain: "field",
  // common KJV <-> Brenton word-choice pairs that are not textual differences
  bare: "bore", firstlings: "firstborn", firstling: "firstborn", wroth: "angry", wrath: "anger",
  slew: "killed", slay: "kill", smote: "struck", smite: "strike", spoken: "said", spake: "said", spoke: "said",
  host: "army", hosts: "armies", raiment: "garment", raiments: "garments", victuals: "food",
  begat: "fathered", begot: "fathered", whither: "where", whence: "where", thereof: "of",
};
const NUMBERS = new Set(("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " +
  "sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds " +
  "thousand thousands myriad myriads first second third fourth fifth sixth seventh eighth ninth tenth twice thrice half").split(" "));

/** Proper names are spelled differently in the two traditions (Gath/Geth, Zion/Sion, Isaiah/Esaias). */
function nameLike(a, b) {
  if (!a || !b || a[0] !== b[0] || Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= Math.max(1, Math.floor(a.length / 4));
}

export function stem(w) {
  let s = w.toLowerCase().replace(/[’']s$/, "").replace(/[^a-z]/g, "");
  s = MAP[s] || s;
  if (s.length > 5 && s.endsWith("eth")) s = s.slice(0, -3);
  else if (s.length > 5 && s.endsWith("est")) s = s.slice(0, -3);
  else if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

/** Split text into display tokens: [{t: "Cain", k: "cain", word: true}, {t: " ", word: false}, ...] */
export function tokens(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/([A-Za-z’']+(?:-[A-Za-z’']+)*)|([^A-Za-z’']+)/g)) {
    if (m[1]) out.push({ t: m[1], k: stem(m[1]), word: true });
    else out.push({ t: m[2], word: false });
  }
  return out;
}

/** Longest-common-subsequence over word keys. Returns sets of matched word indexes. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ma = new Set(), mb = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ma.add(i); mb.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return [ma, mb];
}

/**
 * Compare two verse texts.
 * Returns { score: 0..1 similarity of meaningful words, a: tokens, b: tokens }
 * where each word token gets .diff = true if it has no counterpart on the other side.
 */
export function compareTexts(textA, textB) {
  const a = tokens(textA), b = tokens(textB);
  const wa = a.filter((x) => x.word), wb = b.filter((x) => x.word);
  const [ma, mb] = lcs(wa.map((x) => x.k), wb.map((x) => x.k));
  // second pass: words that appear on both sides but in a different order count as matched (not highlighted)
  const restB = new Map();
  wb.forEach((x, j) => { if (!mb.has(j)) restB.set(x.k, (restB.get(x.k) || 0) + 1); });
  wa.forEach((x, i) => {
    if (ma.has(i)) return;
    const c = restB.get(x.k);
    if (c) { x.moved = true; restB.set(x.k, c - 1); }
  });
  const restA = new Map();
  wa.forEach((x, i) => { if (!ma.has(i) && !x.moved) restA.set(x.k, (restA.get(x.k) || 0) + 1); });
  const restA2 = new Map();
  wa.forEach((x, i) => { if (!ma.has(i)) restA2.set(x.k, (restA2.get(x.k) || 0) + 1); });
  wb.forEach((x, j) => {
    if (mb.has(j)) return;
    const c = restA2.get(x.k);
    if (c) { x.moved = true; restA2.set(x.k, c - 1); }
  });
  wa.forEach((x, i) => { x.diff = !ma.has(i) && !x.moved; x.stop = STOP.has(x.k) || x.k.length < 2; });
  wb.forEach((x, j) => { x.diff = !mb.has(j) && !x.moved; x.stop = STOP.has(x.k) || x.k.length < 2; });
  // capitalised names spelled differently count as the same word
  for (const x of wa) {
    if (!x.diff || !/^[A-Z]/.test(x.t)) continue;
    const y = wb.find((z) => z.diff && /^[A-Z]/.test(z.t) && nameLike(x.k, z.k));
    if (y) { x.diff = false; y.diff = false; x.name = y.name = true; }
  }
  // runs of 3+ unmatched words = material added on one side (highlight small words inside them too)
  const runs = (ws) => {
    let best = 0, cur = [];
    const flush = () => { if (cur.length >= 3) cur.forEach((x) => (x.inRun = true)); best = Math.max(best, cur.length); cur = []; };
    for (const x of ws) { if (x.diff) cur.push(x); else flush(); }
    flush();
    return best;
  };
  var runA = runs(wa), runB = runs(wb);
  var numDiff = [...wa, ...wb].some((x) => x.diff && NUMBERS.has(x.k));
  for (const x of [...wa, ...wb]) x.show = x.diff && (!x.stop || x.inRun || NUMBERS.has(x.k));
  const content = (ws) => ws.filter((x) => !x.stop);
  const ca = content(wa), cb = content(wb);
  const same = ca.filter((x) => !x.diff).length + cb.filter((x) => !x.diff).length;
  const total = ca.length + cb.length;
  const score = total ? same / total : 1;
  return { score, a, b, run: Math.max(runA, runB), numDiff,
    onlyA: ca.filter((x) => x.diff).length, onlyB: cb.filter((x) => x.diff).length };
}

/** Classify a comparison for badges. */
export function level(cmp) {
  if (!cmp) return null;
  if (cmp.missingB) return "missing-lxx";
  if (cmp.missingA) return "only-lxx";
  if (cmp.score < 0.35 || cmp.run >= 6) return "major";
  if (cmp.score < 0.75 || cmp.run >= 4 || cmp.numDiff) return "minor";
  return "close";
}

export const LEVEL_LABEL = {
  "missing-lxx": "Not in the Septuagint",
  "only-lxx": "Only in the Septuagint",
  major: "Major difference",
  minor: "Some difference",
  close: "Same sense",
};

/**
 * Compare a whole chapter.
 * mtVerses: array of KJV verse strings (index 0 = verse 1).
 * lxx: object {verseNumber: text} for the corresponding LXX chapter(s), keys may be "n" or "ch:n".
 * Because verse numbering sometimes differs, each Hebrew-side verse is matched to the LXX verse
 * with the same number, or a neighbour up to 2 away if that matches clearly better.
 */
export function compareChapter(mtVerses, lxx) {
  const lxxKeys = Object.keys(lxx || {}).filter((k) => !k.startsWith("__"));
  const used = new Set();
  const results = {};
  const keyFor = (n) => lxxKeys.find((k) => k === String(n) || k.endsWith(`:${n}`));
  mtVerses.forEach((t, i) => {
    const v = i + 1;
    if (!t) return;
    let best = null;
    for (const d of [0, -1, 1, -2, 2]) {
      const k = keyFor(v + d);
      if (!k || used.has(k)) continue;
      const c = compareTexts(t, lxx[k]);
      c.lxxKey = k;
      // prefer the same verse number unless a neighbour is much closer
      if (!best || c.score > best.score + (d === 0 ? 0 : 0.25) && c.score > best.score) best = c;
      if (d === 0 && c.score >= 0.75) break;
    }
    if (best && best.score >= 0.2) { results[v] = best; used.add(best.lxxKey); }
    else results[v] = { score: 0, missingB: true, a: tokens(t), b: [] };
  });
  const extra = lxxKeys.filter((k) => !used.has(k) && lxx[k]).map((k) => ({ key: k, text: lxx[k] }));
  // LXX verses that matched nothing: if they match no Hebrew verse at all, they are LXX-only material
  return { verses: results, extra };
}

export function chapterStats(cmp) {
  const vs = Object.values(cmp.verses);
  return {
    major: vs.filter((c) => level(c) === "major").length,
    minor: vs.filter((c) => level(c) === "minor").length,
    missing: vs.filter((c) => c.missingB).length,
    extra: cmp.extra.length,
    total: vs.length,
  };
}
