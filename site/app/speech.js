// Text-to-speech with the voices built into the phone or computer (Web Speech API).
//  modern Hebrew  → an Israeli Hebrew voice reading the pointed text
//  modern Greek   → a Greek voice reading the text as Greeks read it today
//  ancient Hebrew → reconstructed Biblical (Tiberian) Hebrew, spelled for a Spanish voice
//  ancient Greek  → Erasmian (classroom) Greek, spelled for a Spanish voice
// No voice exists for ancient pronunciation, so those are approximations.

import { noAccents, hebrewAncient, greekAncient } from "./hebrew.js";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let voiceList = [];
const ready = new Promise((resolve) => {
  if (!synth) return resolve([]);
  const load = () => { voiceList = synth.getVoices(); if (voiceList.length) resolve(voiceList); };
  load();
  synth.addEventListener?.("voiceschanged", load);
  setTimeout(() => resolve(synth.getVoices()), 1500);
});

function pick(prefixes) {
  for (const p of prefixes) {
    const vs = voiceList.filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith(p));
    if (vs.length) return vs.find((v) => /google|natural|enhanced|premium/i.test(v.name)) || vs[0];
  }
  return null;
}

export const MODES = {
  "he-modern": { label: "Modern Hebrew", langs: ["he", "iw"] },
  "he-ancient": { label: "Biblical Hebrew (reconstructed)", langs: ["es-es", "es", "it"] },
  "el-modern": { label: "Modern Greek", langs: ["el"] },
  "el-ancient": { label: "Ancient Greek (Erasmian)", langs: ["es-es", "es", "it"] },
};

export async function availability() {
  await ready;
  const out = {};
  for (const [k, m] of Object.entries(MODES)) out[k] = Boolean(pick(m.langs));
  out.supported = Boolean(synth);
  return out;
}

/**
 * Turn a verse into speakable text for a mode.
 * words: interlinear words [text, translit, gloss, strong, morph]; fallbackText: plain text (e.g. Septuagint).
 */
export function speakable(mode, { words, text }) {
  if (mode === "he-modern") return noAccents(words ? words.map((w) => w[0]).join(" ") : text).replace(/־/g, " ");
  if (mode === "he-ancient") return words ? hebrewAncient(words.map((w) => w[1]).join(" ")) : "";
  if (mode === "el-modern") return words ? words.map((w) => w[0]).join(" ") : text;
  if (mode === "el-ancient") return greekAncient(words ? words.map((w) => w[0]).join(" ") : text);
  return text || "";
}

let queue = [];
let stopped = false;

export function stop() { stopped = true; queue = []; synth?.cancel(); }

/**
 * Speak a list of segments in order. segments: [{ text, id }]. Calls onSegment(id) as each starts.
 */
export async function speak(mode, segments, { rate = 0.85, onSegment, onDone } = {}) {
  if (!synth) throw new Error("This browser can't speak text.");
  await ready;
  const voice = pick(MODES[mode].langs);
  if (!voice) throw new Error(`No ${MODES[mode].label} voice is installed on this device.`);
  stop();
  stopped = false;
  queue = segments.filter((s) => s.text && s.text.trim());
  const next = () => {
    if (stopped) return;
    const seg = queue.shift();
    if (!seg) { onDone?.(); return; }
    const u = new SpeechSynthesisUtterance(seg.text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    u.onstart = () => onSegment?.(seg.id);
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  next();
}
