// Personal data: notes, highlights, bookmarks, reading-plan progress, and
// verdicts on textual differences. Always saved in this browser; when Supabase
// is configured (config.js) and the user signs in, it also syncs to the
// `user_data` table so it follows them across devices.

import { CONFIG } from "./config.js";

const KINDS = ["notes", "highlights", "bookmarks", "plans", "verdicts"];
const LS = "bible-study:data:v1";
const DIRTY = "bible-study:dirty:v1";

let data = load(LS, {});
let dirty = load(DIRTY, []);
for (const k of KINDS) data[k] ||= {};

let sb = null;
let user = null;
const listeners = new Set();

function load(key, dflt) {
  try { return JSON.parse(localStorage.getItem(key)) ?? dflt; } catch { return dflt; }
}
function persist() {
  try {
    localStorage.setItem(LS, JSON.stringify(data));
    localStorage.setItem(DIRTY, JSON.stringify(dirty));
  } catch { /* storage full or blocked: keep in memory */ }
}
function emit() { for (const f of listeners) f(); }

export const store = {
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  all(kind) { return data[kind]; },
  get(kind, key) { return data[kind][key]?.v; },
  set(kind, key, value) {
    const t = Date.now();
    if (value === null || value === undefined || value === "") delete data[kind][key];
    else data[kind][key] = { v: value, t };
    dirty = dirty.filter((d) => !(d.kind === kind && d.key === key));
    dirty.push({ kind, key, t });
    persist();
    emit();
    pushDirty();
  },
  exportJSON() { return JSON.stringify(data, null, 1); },
  importJSON(text) {
    const inc = JSON.parse(text);
    for (const k of KINDS) for (const [key, rec] of Object.entries(inc[k] || {})) {
      const cur = data[k][key];
      if (!cur || (rec.t || 0) > (cur.t || 0)) {
        data[k][key] = rec;
        dirty.push({ kind: k, key, t: rec.t || Date.now() });
      }
    }
    persist(); emit(); pushDirty();
  },
  get cloudEnabled() { return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey); },
  get user() { return user; },
  async signIn(email) {
    await ensureClient();
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.href.split("#")[0] },
    });
    if (error) throw error;
  },
  async signOut() { if (sb) await sb.auth.signOut(); user = null; emit(); },
  async init() {
    if (!this.cloudEnabled) return;
    try {
      await ensureClient();
      const { data: s } = await sb.auth.getSession();
      user = s?.session?.user || null;
      sb.auth.onAuthStateChange((_e, session) => {
        const was = user?.id;
        user = session?.user || null;
        emit();
        if (user && user.id !== was) pull();
      });
      if (user) await pull();
      emit();
    } catch (e) {
      console.warn("Cloud sync unavailable:", e);
    }
  },
};

async function ensureClient() {
  if (sb) return;
  if (!store.cloudEnabled) throw new Error("Cloud sync is not configured (see app/config.js).");
  const mod = await import("https://esm.sh/@supabase/supabase-js@2");
  sb = mod.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
}

async function pull() {
  if (!sb || !user) return;
  const { data: rows, error } = await sb.from("user_data").select("kind,key,value,updated_at");
  if (error) { console.warn(error); return; }
  for (const r of rows) {
    if (!KINDS.includes(r.kind)) continue;
    const t = Date.parse(r.updated_at) || 0;
    const cur = data[r.kind][r.key];
    const pending = dirty.some((d) => d.kind === r.kind && d.key === r.key && d.t > t);
    if (!pending && (!cur || t >= (cur.t || 0))) data[r.kind][r.key] = { v: r.value, t };
  }
  persist(); emit();
  await pushDirty();
}

let pushing = false;
async function pushDirty() {
  if (!sb || !user || pushing || !dirty.length) return;
  pushing = true;
  try {
    for (const d of [...dirty]) {
      const rec = data[d.kind][d.key];
      const q = rec
        ? sb.from("user_data").upsert({ user_id: user.id, kind: d.kind, key: d.key, value: rec.v,
            updated_at: new Date(rec.t).toISOString() })
        : sb.from("user_data").delete().match({ user_id: user.id, kind: d.kind, key: d.key });
      const { error } = await q;
      if (error) { console.warn("sync failed, will retry", error); break; }
      dirty = dirty.filter((x) => x !== d);
      persist();
    }
  } finally { pushing = false; }
}

window.addEventListener("online", () => pushDirty());
