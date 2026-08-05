import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { supabase } from "./supabaseClient";

/* ============================== STAŁE / HELPERY ============================== */
const SUPPLIERS = [
  "Kujawski Wiktor 12.03.2025 stare",
  "Kujawski Wiktor 24.07.2025 śred",
  "Kujawski Wiktor 04.12.2025 młode",
  "Merchel",
  "Ferma za Laskiem ściółka",
  "Urbaś Cobb+",
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const weeksBetween = (start, date) => {
  if (!start || !date) return "";
  const d1 = new Date(start), d2 = new Date(date);
  return Math.max(0, Math.floor((d2 - d1) / (7 * 86400000)));
};
const round = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const pct = (num, den) => (den ? (num / den) * 100 : null);
const fmt = (v, suffix = "") => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v}${suffix}`);
const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

function getAllKurniki(farms) {
  return farms.flatMap((f) => f.kurniki.map((k) => ({ ...k, farmId: f.id, farmName: f.name })));
}
function dostawcaOptions(farms) {
  return [...getAllKurniki(farms).map((k) => k.name), ...SUPPLIERS];
}

/* ============================== AUTH (Supabase) ============================== */
function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    (async () => {
      let { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (!data) {
        const { data: created } = await supabase
          .from("profiles")
          .insert({ id: session.user.id, email: session.user.email, role: "worker" })
          .select()
          .maybeSingle();
        data = created;
      }
      setProfile(data);
    })();
  }, [session]);

  const logout = () => supabase.auth.signOut();

  return { session, profile, authReady, logout };
}

/* ============================== WARSTWA DANYCH (Supabase) ============================== */
function useSupabaseData(session) {
  const [farms, setFarms] = useState([]);
  const [dzienne, setDzienne] = useState({});
  const [wylegarnia, setWylegarnia] = useState([]);
  const [tempZarodka, setTempZarodka] = useState([]);
  const [utrataMasy, setUtrataMasy] = useState([]);
  const [ready, setReady] = useState(false);

  const reload = async () => {
    const [farmsRes, kurnikiRes, dzienneRes, wylegRes, tempRes, tempMeasRes, masaRes, masaCpRes] = await Promise.all([
      supabase.from("farms").select("*").order("name"),
      supabase.from("kurniki").select("*").order("name"),
      supabase.from("dzienne_entries").select("*").order("date"),
      supabase.from("wylegarnia").select("*").order("data_naladu"),
      supabase.from("temp_zarodka").select("*").order("data_naladu"),
      supabase.from("temp_zarodka_measurements").select("*"),
      supabase.from("utrata_masy").select("*").order("data_naladu"),
      supabase.from("utrata_masy_checkpoints").select("*"),
    ]);

    const farmRows = farmsRes.data || [];
    const kurnikRows = kurnikiRes.data || [];
    const farmsAssembled = farmRows.map((f) => ({
      id: f.id,
      name: f.name,
      kurniki: kurnikRows
        .filter((k) => k.farm_id === f.id)
        .map((k) => ({ id: k.id, name: k.name, line: k.line, start: k.start_date, hens: k.hens, roosters: k.roosters })),
    }));

    const dzienneAssembled = {};
    (dzienneRes.data || []).forEach((r) => {
      const list = dzienneAssembled[r.kurnik_id] || (dzienneAssembled[r.kurnik_id] = []);
      list.push({
        date: r.date, tydzZycia: r.tydz_zycia, kuryZywe: r.kury_zywe, kogutyZywe: r.koguty_zywe,
        upadkiKury: r.upadki_kury, upadkiKoguty: r.upadki_koguty, cumMortality: r.cum_mortality,
        jajaOgolem: r.jaja_ogolem, jajaWyleg: r.jaja_wyleg, hatchEggPct: r.hatch_egg_pct, layPct: r.lay_pct,
        wagaJaja: r.waga_jaja, paszaKury: r.pasza_kury, paszaKog: r.pasza_kog, doseKury: r.dose_kury, doseKog: r.dose_kog,
        woda: r.woda, waterFeed: r.water_feed, tempKurnik: r.temp_kurnik, tempMagazJaj: r.temp_magaz_jaj,
        wagaKury: r.waga_kury, wagaKog: r.waga_kog, suplement: r.suplement, notatki: r.notatki,
        ts: new Date(r.date).getTime(),
      });
    });

    const wylegAssembled = (wylegRes.data || []).map((r) => ({
      id: r.id, dataNaladu: r.data_naladu, dataWylegu: r.data_wylegu, dostawca: r.dostawca, nrPartii: r.nr_partii,
      dostawaJaj: r.dostawa_jaj, strataMagaz: r.strata_magaz, naladu: r.naladu,
      niezaplodnione: r.niezaplodnione, niezaplPct: r.niezapl_pct, zamarle: r.zamarle, zamarlePct: r.zamarle_pct,
      zaplPct: r.zapl_pct, odpad: r.odpad, nieWyklute: r.nie_wyklute, nieWyklutePct: r.nie_wyklute_pct,
      pisklietaZdrowe: r.pisklieta_zdrowe, wylegNaladu: r.wyleg_naladu, wylegZapl: r.wyleg_zapl, uwagi: r.uwagi,
      ts: new Date(r.data_naladu).getTime(),
    }));

    const tempMeasRows = tempMeasRes.data || [];
    const tempAssembled = (tempRes.data || []).map((r) => ({
      id: r.id, dataNaladu: r.data_naladu, dostawca: r.dostawca, avg: r.avg_temp, min: r.min_temp, max: r.max_temp,
      uwagi: r.uwagi, ts: new Date(r.data_naladu).getTime(),
      measurements: tempMeasRows.filter((m) => m.batch_id === r.id).map((m) => ({ dzien: m.dzien, temp: m.temp, nrAL: m.nr_al, polozenie: m.polozenie })),
    }));

    const masaCpRows = masaCpRes.data || [];
    const masaAssembled = (masaRes.data || []).map((r) => ({
      id: r.id, dataNaladu: r.data_naladu, dostawca: r.dostawca, waga0: r.waga0, wagaPisklecia: r.waga_pisklecia,
      chickPct: r.chick_pct, uwagi: r.uwagi, ts: new Date(r.data_naladu).getTime(),
      checkpoints: [4, 8, 12, 16, 18].map((day) => {
        const cp = masaCpRows.find((c) => c.measurement_id === r.id && c.day === day);
        return cp ? { day, waga: cp.waga, nrAL: cp.nr_al, loss: cp.loss } : { day, waga: "", nrAL: "", loss: null };
      }),
    }));

    setFarms(farmsAssembled);
    setDzienne(dzienneAssembled);
    setWylegarnia(wylegAssembled);
    setTempZarodka(tempAssembled);
    setUtrataMasy(masaAssembled);
    setReady(true);
  };

  useEffect(() => {
    if (session) reload();
  }, [session]);

  return { farms, store: { dzienne, wylegarnia, tempZarodka, utrataMasy }, ready, reload };
}

/* ============================== MUTACJE (zapis do Supabase) ============================== */
async function addDzienneEntry(kurnikId, entry) {
  const { error } = await supabase.from("dzienne_entries").upsert(
    {
      kurnik_id: kurnikId, date: entry.date, tydz_zycia: entry.tydzZycia,
      kury_zywe: numOrNull(entry.kuryZywe), koguty_zywe: numOrNull(entry.kogutyZywe),
      upadki_kury: numOrNull(entry.upadkiKury) ?? 0, upadki_koguty: numOrNull(entry.upadkiKoguty) ?? 0,
      cum_mortality: entry.cumMortality, jaja_ogolem: numOrNull(entry.jajaOgolem), jaja_wyleg: numOrNull(entry.jajaWyleg),
      hatch_egg_pct: entry.hatchEggPct, lay_pct: entry.layPct, waga_jaja: numOrNull(entry.wagaJaja),
      pasza_kury: numOrNull(entry.paszaKury), pasza_kog: numOrNull(entry.paszaKog), dose_kury: entry.doseKury, dose_kog: entry.doseKog,
      woda: numOrNull(entry.woda), water_feed: entry.waterFeed, temp_kurnik: numOrNull(entry.tempKurnik), temp_magaz_jaj: numOrNull(entry.tempMagazJaj),
      waga_kury: numOrNull(entry.wagaKury), waga_kog: numOrNull(entry.wagaKog), suplement: entry.suplement || null, notatki: entry.notatki || null,
    },
    { onConflict: "kurnik_id,date" }
  );
  return error;
}

async function addWylegarniaEntry(entry) {
  const { error } = await supabase.from("wylegarnia").insert({
    data_naladu: entry.dataNaladu, data_wylegu: entry.dataWylegu || null, dostawca: entry.dostawca || null,
    nr_partii: entry.nrPartii || null, dostawa_jaj: numOrNull(entry.dostawaJaj), strata_magaz: numOrNull(entry.strataMagaz) ?? 0,
    naladu: entry.naladu, niezaplodnione: numOrNull(entry.niezaplodnione), niezapl_pct: entry.niezaplPct,
    zamarle: numOrNull(entry.zamarle), zamarle_pct: entry.zamarlePct, zapl_pct: entry.zaplPct,
    odpad: numOrNull(entry.odpad) ?? 0, nie_wyklute: numOrNull(entry.nieWyklute) ?? 0, nie_wyklute_pct: entry.nieWyklutePct,
    pisklieta_zdrowe: numOrNull(entry.pisklietaZdrowe), wyleg_naladu: entry.wylegNaladu, wyleg_zapl: entry.wylegZapl,
    uwagi: entry.uwagi || null,
  });
  return error;
}

async function addTempZarodkaEntry(entry) {
  const { data, error } = await supabase
    .from("temp_zarodka")
    .insert({ data_naladu: entry.dataNaladu, dostawca: entry.dostawca || null, avg_temp: entry.avg, min_temp: entry.min, max_temp: entry.max, uwagi: entry.uwagi || null })
    .select()
    .single();
  if (error) return error;
  if (entry.measurements?.length) {
    const rows = entry.measurements.map((m) => ({
      batch_id: data.id, dzien: numOrNull(m.dzien), temp: numOrNull(m.temp), nr_al: m.nrAL ? String(m.nrAL) : null, polozenie: m.polozenie || null,
    }));
    const { error: mErr } = await supabase.from("temp_zarodka_measurements").insert(rows);
    if (mErr) return mErr;
  }
  return null;
}

async function addUtrataMasyEntry(entry) {
  const { data, error } = await supabase
    .from("utrata_masy")
    .insert({ data_naladu: entry.dataNaladu, dostawca: entry.dostawca || null, waga0: numOrNull(entry.waga0), waga_pisklecia: numOrNull(entry.wagaPisklecia), chick_pct: entry.chickPct, uwagi: entry.uwagi || null })
    .select()
    .single();
  if (error) return error;
  const rows = (entry.checkpoints || [])
    .filter((c) => c.waga !== "" && c.waga !== null && c.waga !== undefined)
    .map((c) => ({ measurement_id: data.id, day: c.day, waga: numOrNull(c.waga), nr_al: c.nrAL ? String(c.nrAL) : null, loss: c.loss }));
  if (rows.length) {
    const { error: cErr } = await supabase.from("utrata_masy_checkpoints").insert(rows);
    if (cErr) return cErr;
  }
  return null;
}

async function addFarmDb(name) {
  const { error } = await supabase.from("farms").insert({ id: `farm_${Date.now()}`, name });
  return error;
}
async function renameFarmDb(id, name) {
  const { error } = await supabase.from("farms").update({ name }).eq("id", id);
  return error;
}
async function removeFarmDb(id) {
  const { error } = await supabase.from("farms").delete().eq("id", id);
  return error;
}
async function addKurnikDb(farmId, kurnik) {
  const { error } = await supabase.from("kurniki").insert({
    id: kurnik.id, farm_id: farmId, name: kurnik.name, line: kurnik.line || null,
    start_date: kurnik.start || null, hens: numOrNull(kurnik.hens) ?? 0, roosters: numOrNull(kurnik.roosters) ?? 0,
  });
  return error;
}
async function updateKurnikDb(kurnik) {
  const { error } = await supabase
    .from("kurniki")
    .update({ name: kurnik.name, line: kurnik.line || null, start_date: kurnik.start || null, hens: numOrNull(kurnik.hens) ?? 0, roosters: numOrNull(kurnik.roosters) ?? 0 })
    .eq("id", kurnik.id);
  return error;
}
async function removeKurnikDb(id) {
  const { error } = await supabase.from("kurniki").delete().eq("id", id);
  return error;
}

/* ============================== EKSPORT DANYCH ============================== */
function download(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
function flattenDzienne(store, farms) {
  const all = getAllKurniki(farms);
  return Object.entries(store.dzienne).flatMap(([kid, list]) =>
    list.map((e) => ({ kurnik: all.find((k) => k.id === kid)?.name || kid, ferma: all.find((k) => k.id === kid)?.farmName || "", ...e }))
  );
}

/* ============================== UI PRYMITYWY ============================== */
function Field({ label, children, hint }) {
  return (
    <label className="field-block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
function NumInput({ value, onChange, placeholder = "0", step = "any" }) {
  return (
    <input type="number" inputMode="decimal" step={step} className="input" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
  );
}
function TextInput({ value, onChange, placeholder = "" }) {
  return <input type="text" className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
function Select({ value, onChange, options }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Wybierz…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Stat({ label, value, tone = "neutral" }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
function TopBar({ title, subtitle, onBack }) {
  return (
    <div className="topbar">
      {onBack && <button className="back-btn" onClick={onBack} aria-label="Wstecz">←</button>}
      <div>
        <div className="topbar-title">{title}</div>
        {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
function ConfirmButton({ className, label, confirmLabel = "Na pewno? Usuń", onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <button type="button" className={confirming ? `${className} confirming` : className}
      onClick={(e) => { e.stopPropagation(); if (confirming) { onConfirm(); setConfirming(false); } else setConfirming(true); }}>
      {confirming ? confirmLabel : label}
    </button>
  );
}

/* ============================== LOGOWANIE ============================== */
function AuthGate() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setInfo("");
    if (password.length < 6) { setError("Hasło musi mieć min. 6 znaków."); return; }
    if (mode === "register" && password !== password2) { setError("Hasła nie są identyczne."); return; }
    setLoading(true);
    try {
      if (mode === "register") {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) { setError(err.message); return; }
        if (data.user && !data.session) {
          setInfo("Konto utworzone. Jeśli włączone jest potwierdzanie e-mail, sprawdź skrzynkę, a potem się zaloguj.");
          setMode("login");
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) { setError(err.message); return; }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen role-screen">
      <div className="brand">
        <div className="brand-mark">XD</div>
        <div><div className="brand-title">XDROB Tracker</div><div className="brand-sub">Monitoring ferm i wylęgarni</div></div>
      </div>
      <div className="auth-card">
        <div className="tabs">
          <button className={`tab ${mode === "login" ? "tab-active" : ""}`} onClick={() => { setMode("login"); setError(""); setInfo(""); }}>Zaloguj się</button>
          <button className={`tab ${mode === "register" ? "tab-active" : ""}`} onClick={() => { setMode("register"); setError(""); setInfo(""); }}>Utwórz konto</button>
        </div>
        <Field label="Adres e-mail"><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ty@xdrob.pl" /></Field>
        <Field label="Hasło"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 6 znaków" /></Field>
        {mode === "register" && <Field label="Powtórz hasło"><input type="password" className="input" value={password2} onChange={(e) => setPassword2(e.target.value)} /></Field>}
        {error && <div className="ai-error">{error}</div>}
        {info && <div className="added-confirm">{info}</div>}
        <button className="btn btn-primary btn-block" disabled={loading || !email || !password} onClick={submit}>
          {loading ? "Chwila…" : mode === "login" ? "Zaloguj się" : "Utwórz konto"}
        </button>
      </div>
    </div>
  );
}

/* ============================== WYBÓR ROLI ============================== */
function ModeSelect({ onPick, user, onLogout }) {
  return (
    <div className="screen role-screen">
      <div className="brand">
        <div className="brand-mark">XD</div>
        <div><div className="brand-title">XDROB Tracker</div><div className="brand-sub">Monitoring ferm i wylęgarni</div></div>
      </div>
      <div className="session-bar"><span>Zalogowano jako <b>{user}</b></span><button className="logout-link" onClick={onLogout}>Wyloguj</button></div>
      <div className="role-list">
        <button className="role-card" onClick={() => onPick("admin")}>
          <span className="role-icon">🛠</span>
          <span className="role-text"><span className="role-name">Wersja administratora</span><span className="role-desc">Podgląd, eksport, zarządzanie fermami</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("worker")}>
          <span className="role-icon">📋</span>
          <span className="role-text"><span className="role-name">Wersja pracownika</span><span className="role-desc">Tylko wprowadzanie dzisiejszych danych</span></span>
        </button>
      </div>
    </div>
  );
}
function AdminRoleSelect({ onPick, onBack }) {
  return (
    <div className="screen">
      <TopBar title="Panel administratora" subtitle="Wybierz widok" onBack={onBack} />
      <div className="role-list">
        <button className="role-card" onClick={() => onPick("farm")}>
          <span className="role-icon">🐔</span>
          <span className="role-text"><span className="role-name">Wpis danych fermy</span><span className="role-desc">Dzienny wpis dla wybranego kurnika</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("hatchery")}>
          <span className="role-icon">🥚</span>
          <span className="role-text"><span className="role-name">Wpis danych wylęgarni</span><span className="role-desc">Wylęgi, temperatura zarodka, utrata masy</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("hatcheryView")}>
          <span className="role-icon">🔍</span>
          <span className="role-text"><span className="role-name">Podgląd danych wylęgarni</span><span className="role-desc">Wszystkie partie, pomiary i statystyki</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("owner")}>
          <span className="role-icon">📊</span>
          <span className="role-text"><span className="role-name">Panel zarządczy</span><span className="role-desc">Podgląd, eksport danych</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("manage")}>
          <span className="role-icon">🏗</span>
          <span className="role-text"><span className="role-name">Fermy i kurniki</span><span className="role-desc">Dodawaj i edytuj strukturę gospodarstwa</span></span>
        </button>
      </div>
    </div>
  );
}
function WorkerRoleSelect({ onPick, onBack }) {
  return (
    <div className="screen">
      <TopBar title="Wprowadzanie danych" subtitle="Wersja pracownika" onBack={onBack} />
      <div className="role-list">
        <button className="role-card" onClick={() => onPick("farm")}>
          <span className="role-icon">🐔</span>
          <span className="role-text"><span className="role-name">Dane fermy</span><span className="role-desc">Wybierz kurnik i wprowadź dzisiejszy wpis</span></span>
        </button>
        <button className="role-card" onClick={() => onPick("hatchery")}>
          <span className="role-icon">🥚</span>
          <span className="role-text"><span className="role-name">Dane wylęgarni</span><span className="role-desc">Wylęgi, temperatura zarodka, utrata masy</span></span>
        </button>
      </div>
    </div>
  );
}

/* ============================== SIATKA KURNIKÓW ============================== */
function KurnikGrid({ farms, statusMap, selected, onSelect }) {
  return (
    <div className="kurnik-groups">
      {farms.map((farm) => (
        <div key={farm.id} className="farm-group">
          <div className="farm-group-title">{farm.name}</div>
          <div className="egg-tray">
            {farm.kurniki.length === 0 && <span className="helper-text">Brak kurników w tej fermie.</span>}
            {farm.kurniki.map((k) => {
              const s = statusMap[k.id];
              return (
                <button key={k.id} onClick={() => onSelect(k.id)}
                  className={["egg-cup", selected === k.id ? "egg-cup-selected" : "", s ? `egg-cup-${s.tone}` : ""].join(" ")}>
                  <span className="egg-cup-label">{k.name}</span>
                  {s && <span className="egg-cup-metric">{s.metric}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {farms.length === 0 && <p className="helper-text">Brak ferm. Dodaj fermę w panelu administratora.</p>}
    </div>
  );
}

/* ============================== WPIS DZIENNY ============================== */
const STEPS = ["Stado", "Produkcja jaj", "Pasza i woda", "Środowisko"];

function DailyEntryWizard({ flock, entries, onSave, onBack }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    date: todayISO(), kuryZywe: "", kogutyZywe: "", upadkiKury: "", upadkiKoguty: "",
    jajaOgolem: "", jajaWyleg: "", wagaJaja: "", paszaKury: "", paszaKog: "", woda: "",
    tempKurnik: "", tempMagazJaj: "", wagaKury: "", wagaKog: "", suplement: "", notatki: "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const priorDeaths = useMemo(() => (entries || [])
    .filter((e) => e.date < form.date)
    .reduce((sum, e) => sum + (Number(e.upadkiKury) || 0) + (Number(e.upadkiKoguty) || 0), 0), [entries, form.date]);

  const totalStart = flock.hens + flock.roosters;
  const cumMortality = round(pct(priorDeaths + (Number(form.upadkiKury) || 0) + (Number(form.upadkiKoguty) || 0), totalStart), 2);
  const layPct = round(pct(Number(form.jajaOgolem), Number(form.kuryZywe)), 1);
  const hatchEggPct = round(pct(Number(form.jajaWyleg), Number(form.jajaOgolem)), 1);
  const doseKury = round((Number(form.paszaKury) * 1000) / (Number(form.kuryZywe) || 1), 1);
  const doseKog = round((Number(form.paszaKog) * 1000) / (Number(form.kogutyZywe) || 1), 1);
  const waterFeed = round(Number(form.woda) / ((Number(form.paszaKury) || 0) + (Number(form.paszaKog) || 0) || 1), 2);
  const tydz = weeksBetween(flock.start, form.date);

  const canNext = step < STEPS.length - 1;
  const canPrev = step > 0;

  const submit = async () => {
    setSaving(true); setError("");
    const err = await addDzienneEntry(flock.id, { ...form, tydzZycia: tydz, cumMortality, layPct, hatchEggPct, doseKury, doseKog, waterFeed });
    setSaving(false);
    if (err) { setError("Błąd zapisu: " + err.message); return; }
    onSave();
  };

  return (
    <div className="screen">
      <TopBar title={`${flock.farmName} — ${flock.name}`} subtitle={`Wpis dzienny — tydz. życia ${tydz}`} onBack={onBack} />
      <div className="progress-dots">{STEPS.map((s, i) => <div key={s} className={`dot ${i === step ? "dot-active" : i < step ? "dot-done" : ""}`} />)}</div>
      <div className="step-title">{STEPS[step]}</div>
      <div className="form-body">
        {step === 0 && (
          <>
            <Field label="Data"><input type="date" className="input" value={form.date} onChange={(e) => set("date")(e.target.value)} /></Field>
            <div className="grid-2">
              <Field label="Kury żywe"><NumInput value={form.kuryZywe} onChange={set("kuryZywe")} /></Field>
              <Field label="Koguty żywe"><NumInput value={form.kogutyZywe} onChange={set("kogutyZywe")} /></Field>
              <Field label="Upadki kury"><NumInput value={form.upadkiKury} onChange={set("upadkiKury")} /></Field>
              <Field label="Upadki koguty"><NumInput value={form.upadkiKoguty} onChange={set("upadkiKoguty")} /></Field>
            </div>
            <div className="calc-row">Upadki % skum.: <b>{fmt(cumMortality, "%")}</b></div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="grid-2">
              <Field label="Jaja ogółem"><NumInput value={form.jajaOgolem} onChange={set("jajaOgolem")} /></Field>
              <Field label="Jaja wylęgowe"><NumInput value={form.jajaWyleg} onChange={set("jajaWyleg")} /></Field>
              <Field label="Waga jaja (g)"><NumInput value={form.wagaJaja} onChange={set("wagaJaja")} /></Field>
            </div>
            <div className="calc-row">% nieśności: <b>{fmt(layPct, "%")}</b> &nbsp;·&nbsp; % jaj wylęg.: <b>{fmt(hatchEggPct, "%")}</b></div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="grid-2">
              <Field label="Pasza kury (kg)"><NumInput value={form.paszaKury} onChange={set("paszaKury")} /></Field>
              <Field label="Pasza koguty (kg)"><NumInput value={form.paszaKog} onChange={set("paszaKog")} /></Field>
              <Field label="Woda (l)"><NumInput value={form.woda} onChange={set("woda")} /></Field>
            </div>
            <div className="calc-row">Dawka kura: <b>{fmt(doseKury, "g")}</b> &nbsp;·&nbsp; Dawka kog.: <b>{fmt(doseKog, "g")}</b> &nbsp;·&nbsp; Woda:pasza: <b>{fmt(waterFeed)}</b></div>
          </>
        )}
        {step === 3 && (
          <>
            <div className="grid-2">
              <Field label="Temp. kurnika (°C)"><NumInput value={form.tempKurnik} onChange={set("tempKurnik")} /></Field>
              <Field label="Temp. magaz. jaj (°C)"><NumInput value={form.tempMagazJaj} onChange={set("tempMagazJaj")} /></Field>
              <Field label="Waga kury (g)"><NumInput value={form.wagaKury} onChange={set("wagaKury")} /></Field>
              <Field label="Waga koguta (g)"><NumInput value={form.wagaKog} onChange={set("wagaKog")} /></Field>
            </div>
            <Field label="Suplementacja / leczenie"><TextInput value={form.suplement} onChange={set("suplement")} placeholder="np. AviD3 1l..." /></Field>
            <Field label="Notatki weterynaryjne"><TextInput value={form.notatki} onChange={set("notatki")} /></Field>
          </>
        )}
      </div>
      {error && <div className="ai-error">{error}</div>}
      <div className="wizard-nav">
        {canPrev && <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>Wstecz</button>}
        {canNext
          ? <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Dalej</button>
          : <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? "Zapisuję…" : "Zapisz wpis"}</button>}
      </div>
      {entries?.length > 0 && (
        <div className="recent-log">
          <div className="recent-title">Ostatnie wpisy</div>
          {entries.slice(-3).reverse().map((e, i) => (
            <div key={i} className="log-row"><span>{e.date}</span><span>Nieśność {fmt(e.layPct, "%")}</span><span>Upadki {fmt(e.cumMortality, "%")}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function FarmRole({ store, farms, reload, onBack }) {
  const [kurnikId, setKurnikId] = useState(null);
  const allKurniki = useMemo(() => getAllKurniki(farms), [farms]);
  const status = useMemo(() => {
    const s = {};
    allKurniki.forEach((k) => {
      const list = store.dzienne[k.id] || [];
      if (!list.length) return;
      const last = list[list.length - 1];
      let tone = "ok";
      if (last.layPct !== null && last.layPct < 50) tone = "alert";
      else if (last.layPct !== null && last.layPct < 65) tone = "watch";
      s[k.id] = { tone, metric: fmt(last.layPct, "%") };
    });
    return s;
  }, [store, allKurniki]);

  if (!kurnikId) {
    return (
      <div className="screen">
        <TopBar title="Wybierz kurnik" subtitle="Wpis dzienny" onBack={onBack} />
        <KurnikGrid farms={farms} statusMap={status} selected={kurnikId} onSelect={setKurnikId} />
        <p className="helper-text">Stuknij kurnik, aby dodać dzisiejszy wpis.</p>
      </div>
    );
  }
  const kurnik = allKurniki.find((k) => k.id === kurnikId);
  return (
    <DailyEntryWizard flock={kurnik} entries={store.dzienne[kurnikId] || []} onBack={() => setKurnikId(null)}
      onSave={async () => { await reload(); setKurnikId(null); }} />
  );
}

/* ============================== WYLĘGARNIA: FORMULARZE ============================== */
function WylegarniaForm({ list, options, onSaved }) {
  const [f, setF] = useState({ dataNaladu: todayISO(), dataWylegu: "", dostawca: "", nrPartii: "", dostawaJaj: "", strataMagaz: "", niezaplodnione: "", zamarle: "", odpad: "", nieWyklute: "", pisklietaZdrowe: "", uwagi: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const naladu = (Number(f.dostawaJaj) || 0) - (Number(f.strataMagaz) || 0);
  const niezaplPct = round(pct(Number(f.niezaplodnione), naladu), 2);
  const zamarlePct = round(pct(Number(f.zamarle), naladu), 2);
  const zaplPct = round(100 - (niezaplPct || 0), 2);
  const doKlujnika = naladu - (Number(f.niezaplodnione) || 0) - (Number(f.zamarle) || 0) - (Number(f.odpad) || 0);
  const nieWyklutePct = round(pct(Number(f.nieWyklute), doKlujnika), 2);
  const wylegNaladu = round(pct(Number(f.pisklietaZdrowe), naladu), 2);
  const wylegZapl = round(pct(Number(f.pisklietaZdrowe), (naladu * (zaplPct || 0)) / 100), 2);

  const submit = async () => {
    setSaving(true); setError("");
    const err = await addWylegarniaEntry({ ...f, naladu, niezaplPct, zamarlePct, zaplPct, nieWyklutePct, wylegNaladu, wylegZapl });
    setSaving(false);
    if (err) { setError("Błąd zapisu: " + err.message); return; }
    setF({ dataNaladu: todayISO(), dataWylegu: "", dostawca: "", nrPartii: "", dostawaJaj: "", strataMagaz: "", niezaplodnione: "", zamarle: "", odpad: "", nieWyklute: "", pisklietaZdrowe: "", uwagi: "" });
    onSaved();
  };

  return (
    <div className="form-body">
      <div className="grid-2">
        <Field label="Data nałożenia"><input type="date" className="input" value={f.dataNaladu} onChange={(e) => set("dataNaladu")(e.target.value)} /></Field>
        <Field label="Data wylęgu"><input type="date" className="input" value={f.dataWylegu} onChange={(e) => set("dataWylegu")(e.target.value)} /></Field>
      </div>
      <Field label="Dostawca / Stado"><Select value={f.dostawca} onChange={set("dostawca")} options={options} /></Field>
      <Field label="Nr partii"><TextInput value={f.nrPartii} onChange={set("nrPartii")} /></Field>
      <div className="grid-2">
        <Field label="Dostawa jaj"><NumInput value={f.dostawaJaj} onChange={set("dostawaJaj")} /></Field>
        <Field label="Strata magazynowa"><NumInput value={f.strataMagaz} onChange={set("strataMagaz")} /></Field>
        <Field label="Niezapłodnione"><NumInput value={f.niezaplodnione} onChange={set("niezaplodnione")} /></Field>
        <Field label="Zamarłe"><NumInput value={f.zamarle} onChange={set("zamarle")} /></Field>
        <Field label="Odpad"><NumInput value={f.odpad} onChange={set("odpad")} /></Field>
        <Field label="Nie wyklute"><NumInput value={f.nieWyklute} onChange={set("nieWyklute")} /></Field>
        <Field label="Pisklęta zdrowe"><NumInput value={f.pisklietaZdrowe} onChange={set("pisklietaZdrowe")} /></Field>
      </div>
      <div className="calc-grid">
        <Stat label="Jaja nałożone" value={fmt(naladu)} />
        <Stat label="Zapłodnienie %" value={fmt(zaplPct, "%")} />
        <Stat label="Zamarłe %" value={fmt(zamarlePct, "%")} />
        <Stat label="Wylęg z nał. %" value={fmt(wylegNaladu, "%")} tone={wylegNaladu > 80 ? "good" : wylegNaladu > 65 ? "watch" : "alert"} />
        <Stat label="Wylęg z zapł. %" value={fmt(wylegZapl, "%")} />
        <Stat label="Nie wyklute %" value={fmt(nieWyklutePct, "%")} />
      </div>
      <Field label="Uwagi"><TextInput value={f.uwagi} onChange={set("uwagi")} /></Field>
      {error && <div className="ai-error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={saving} onClick={submit}>{saving ? "Zapisuję…" : "Zapisz partię"}</button>
      {list.length > 0 && (
        <div className="recent-log">
          <div className="recent-title">Ostatnie partie</div>
          {list.slice(-3).reverse().map((e) => <div key={e.id} className="log-row"><span>{e.dataNaladu}</span><span>{e.dostawca}</span><span>Wylęg {fmt(e.wylegNaladu, "%")}</span></div>)}
        </div>
      )}
    </div>
  );
}

function TempZarodkaForm({ list, options, onSaved }) {
  const [header, setHeader] = useState({ dataNaladu: todayISO(), dostawca: "", uwagi: "" });
  const [measurements, setMeasurements] = useState([]);
  const [m, setM] = useState({ dzien: "", temp: "", nrAL: "", polozenie: "środek" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addMeasurement = () => { if (m.temp === "") return; setMeasurements((arr) => [...arr, m]); setM({ dzien: "", temp: "", nrAL: "", polozenie: "środek" }); };
  const temps = measurements.map((x) => Number(x.temp)).filter((n) => !Number.isNaN(n));
  const avg = temps.length ? round(temps.reduce((a, b) => a + b, 0) / temps.length, 1) : null;
  const min = temps.length ? Math.min(...temps) : null;
  const max = temps.length ? Math.max(...temps) : null;

  const submit = async () => {
    setSaving(true); setError("");
    const err = await addTempZarodkaEntry({ ...header, measurements, avg, min, max });
    setSaving(false);
    if (err) { setError("Błąd zapisu: " + err.message); return; }
    setHeader({ dataNaladu: todayISO(), dostawca: "", uwagi: "" });
    setMeasurements([]);
    onSaved();
  };

  return (
    <div className="form-body">
      <div className="grid-2">
        <Field label="Data nałożenia"><input type="date" className="input" value={header.dataNaladu} onChange={(e) => setHeader((s) => ({ ...s, dataNaladu: e.target.value }))} /></Field>
        <Field label="Dostawca / Stado"><Select value={header.dostawca} onChange={(v) => setHeader((s) => ({ ...s, dostawca: v }))} options={options} /></Field>
      </div>
      <div className="measure-add">
        <div className="grid-3">
          <Field label="Dz. pomiaru"><NumInput value={m.dzien} onChange={(v) => setM((s) => ({ ...s, dzien: v }))} /></Field>
          <Field label="T °F"><NumInput value={m.temp} onChange={(v) => setM((s) => ({ ...s, temp: v }))} /></Field>
          <Field label="Nr AL"><NumInput value={m.nrAL} onChange={(v) => setM((s) => ({ ...s, nrAL: v }))} /></Field>
        </div>
        <Field label="Położenie wózka"><Select value={m.polozenie} onChange={(v) => setM((s) => ({ ...s, polozenie: v }))} options={["środek", "góra", "dół", "brzeg"]} /></Field>
        <button className="btn btn-ghost btn-block" onClick={addMeasurement}>+ Dodaj pomiar</button>
      </div>
      {measurements.length > 0 && (
        <div className="measure-list">{measurements.map((x, i) => <div key={i} className="log-row"><span>Dz.{x.dzien || "—"}</span><span>{x.temp}°F</span><span>AL {x.nrAL || "—"}</span></div>)}</div>
      )}
      <div className="calc-grid">
        <Stat label="Śr. °F" value={fmt(avg)} tone={avg && avg > 99.5 && avg < 100.5 ? "good" : "watch"} />
        <Stat label="Min °F" value={fmt(min)} />
        <Stat label="Max °F" value={fmt(max)} />
      </div>
      <Field label="Uwagi"><TextInput value={header.uwagi} onChange={(v) => setHeader((s) => ({ ...s, uwagi: v }))} /></Field>
      {error && <div className="ai-error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={!measurements.length || saving} onClick={submit}>{saving ? "Zapisuję…" : "Zapisz pomiary"}</button>
      {list.length > 0 && (
        <div className="recent-log">
          <div className="recent-title">Ostatnie partie</div>
          {list.slice(-3).reverse().map((e) => <div key={e.id} className="log-row"><span>{e.dataNaladu}</span><span>{e.dostawca}</span><span>Śr. {fmt(e.avg, "°F")}</span></div>)}
        </div>
      )}
    </div>
  );
}

const CHECKPOINT_DAYS = [4, 8, 12, 16, 18];

function UtrataMasyForm({ list, options, onSaved }) {
  const [f, setF] = useState({ dataNaladu: todayISO(), dostawca: "", waga0: "", wagaPisklecia: "", uwagi: "" });
  const [checkpoints, setCheckpoints] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setCp = (day, key, v) => setCheckpoints((s) => ({ ...s, [day]: { ...s[day], [key]: v } }));

  const w0 = Number(f.waga0) || null;
  const rows = CHECKPOINT_DAYS.map((day) => {
    const cp = checkpoints[day] || {};
    const w = Number(cp.waga);
    const loss = w0 && w ? round(((w0 - w) / w0) * 100, 2) : null;
    return { day, waga: cp.waga || "", nrAL: cp.nrAL || "", loss };
  });
  const chickPct = w0 && f.wagaPisklecia ? round((Number(f.wagaPisklecia) / w0) * 100, 1) : null;

  const submit = async () => {
    setSaving(true); setError("");
    const err = await addUtrataMasyEntry({ ...f, checkpoints: rows, chickPct });
    setSaving(false);
    if (err) { setError("Błąd zapisu: " + err.message); return; }
    setF({ dataNaladu: todayISO(), dostawca: "", waga0: "", wagaPisklecia: "", uwagi: "" });
    setCheckpoints({});
    onSaved();
  };

  return (
    <div className="form-body">
      <div className="grid-2">
        <Field label="Data nałożenia"><input type="date" className="input" value={f.dataNaladu} onChange={(e) => setF((s) => ({ ...s, dataNaladu: e.target.value }))} /></Field>
        <Field label="Dostawca"><Select value={f.dostawca} onChange={(v) => setF((s) => ({ ...s, dostawca: v }))} options={options} /></Field>
      </div>
      <Field label="Waga dz. 0 (g)"><NumInput value={f.waga0} onChange={(v) => setF((s) => ({ ...s, waga0: v }))} /></Field>
      {rows.map((r) => (
        <div className="checkpoint-row" key={r.day}>
          <div className="checkpoint-day">Dz. {r.day}</div>
          <NumInput value={r.waga} onChange={(v) => setCp(r.day, "waga", v)} placeholder="waga (g)" />
          <NumInput value={r.nrAL} onChange={(v) => setCp(r.day, "nrAL", v)} placeholder="nr AL" />
          <span className="checkpoint-loss">{fmt(r.loss, "%")}</span>
        </div>
      ))}
      <Field label="Waga pisklęcia (g)"><NumInput value={f.wagaPisklecia} onChange={(v) => setF((s) => ({ ...s, wagaPisklecia: v }))} /></Field>
      <div className="calc-row">Pisklę/jajo %: <b>{fmt(chickPct, "%")}</b></div>
      <Field label="Uwagi"><TextInput value={f.uwagi} onChange={(v) => setF((s) => ({ ...s, uwagi: v }))} /></Field>
      {error && <div className="ai-error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={!w0 || saving} onClick={submit}>{saving ? "Zapisuję…" : "Zapisz pomiar"}</button>
      {list.length > 0 && (
        <div className="recent-log">
          <div className="recent-title">Ostatnie pomiary</div>
          {list.slice(-3).reverse().map((e) => <div key={e.id} className="log-row"><span>{e.dataNaladu}</span><span>{e.dostawca}</span><span>Pisklę {fmt(e.chickPct, "%")}</span></div>)}
        </div>
      )}
    </div>
  );
}

function HatcheryRole({ store, farms, reload, onBack }) {
  const [tab, setTab] = useState("wyleg");
  const options = useMemo(() => dostawcaOptions(farms), [farms]);
  return (
    <div className="screen">
      <TopBar title="Wylęgarnia" subtitle="Wpis danych" onBack={onBack} />
      <div className="tabs">
        <button className={`tab ${tab === "wyleg" ? "tab-active" : ""}`} onClick={() => setTab("wyleg")}>Wylęgi</button>
        <button className={`tab ${tab === "temp" ? "tab-active" : ""}`} onClick={() => setTab("temp")}>Temp. zarodka</button>
        <button className={`tab ${tab === "masa" ? "tab-active" : ""}`} onClick={() => setTab("masa")}>Utrata masy</button>
      </div>
      {tab === "wyleg" && <WylegarniaForm list={store.wylegarnia} options={options} onSaved={reload} />}
      {tab === "temp" && <TempZarodkaForm list={store.tempZarodka} options={options} onSaved={reload} />}
      {tab === "masa" && <UtrataMasyForm list={store.utrataMasy} options={options} onSaved={reload} />}
    </div>
  );
}

/* ============================== FERMY I KURNIKI ============================== */
function AddKurnikForm({ onAdd }) {
  const [name, setName] = useState("");
  const [line, setLine] = useState("Ross 308");
  const [start, setStart] = useState(todayISO());
  const [hens, setHens] = useState("");
  const [roosters, setRoosters] = useState("");
  const [justAdded, setJustAdded] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd({ id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), line: line.trim(), start, hens: Number(hens) || 0, roosters: Number(roosters) || 0 });
    setSaving(false);
    setName(""); setHens(""); setRoosters("");
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1800);
  };

  return (
    <div className="kurnik-add-form">
      <div className="grid-2">
        <Field label="Nazwa kurnika"><TextInput value={name} onChange={setName} placeholder="np. K5" /></Field>
        <Field label="Linia genetyczna"><TextInput value={line} onChange={setLine} placeholder="Ross 308" /></Field>
        <Field label="Data wstawienia"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Kury wstawione"><NumInput value={hens} onChange={setHens} /></Field>
        <Field label="Koguty wstawione"><NumInput value={roosters} onChange={setRoosters} /></Field>
      </div>
      <button className="btn btn-ghost btn-block" disabled={!name.trim() || saving} onClick={submit}>{saving ? "Dodaję…" : "+ Dodaj kurnik"}</button>
      {justAdded && <div className="added-confirm">✓ Dodano kurnik</div>}
    </div>
  );
}

function EditKurnikForm({ kurnik, onSave, onCancel }) {
  const [name, setName] = useState(kurnik.name);
  const [line, setLine] = useState(kurnik.line || "");
  const [start, setStart] = useState(kurnik.start || todayISO());
  const [hens, setHens] = useState(kurnik.hens ?? "");
  const [roosters, setRoosters] = useState(kurnik.roosters ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ ...kurnik, name: name.trim(), line: line.trim(), start, hens: Number(hens) || 0, roosters: Number(roosters) || 0 });
    setSaving(false);
  };

  return (
    <div className="kurnik-add-form">
      <div className="grid-2">
        <Field label="Nazwa kurnika"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Linia genetyczna"><TextInput value={line} onChange={setLine} /></Field>
        <Field label="Data wstawienia"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Kury wstawione"><NumInput value={hens} onChange={setHens} /></Field>
        <Field label="Koguty wstawione"><NumInput value={roosters} onChange={setRoosters} /></Field>
      </div>
      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onCancel}>Anuluj</button>
        <button className="btn btn-primary" disabled={!name.trim() || saving} onClick={submit}>{saving ? "Zapisuję…" : "Zapisz zmiany"}</button>
      </div>
    </div>
  );
}

function FarmManager({ farms, reload, onBack }) {
  const [newFarmName, setNewFarmName] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [editingKurnikId, setEditingKurnikId] = useState(null);
  const [renamingFarmId, setRenamingFarmId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [viewing, setViewing] = useState(null);

  const addFarm = async () => { if (!newFarmName.trim()) return; await addFarmDb(newFarmName.trim()); setNewFarmName(""); await reload(); };
  const removeFarm = async (id) => { await removeFarmDb(id); await reload(); };
  const submitRename = async (id) => { if (!renameValue.trim()) return; await renameFarmDb(id, renameValue.trim()); setRenamingFarmId(null); await reload(); };
  const addKurnikTo = async (farmId, kurnik) => { await addKurnikDb(farmId, kurnik); await reload(); };
  const updateKurnik = async (updated) => { await updateKurnikDb(updated); setEditingKurnikId(null); await reload(); };
  const removeKurnik = async (id) => { await removeKurnikDb(id); await reload(); };

  if (viewing) {
    return <KurnikDetail kurnik={viewing} entries={viewing.entries} onBack={() => setViewing(null)} />;
  }

  return (
    <div className="screen">
      <TopBar title="Fermy i kurniki" subtitle="Zarządzanie strukturą gospodarstwa" onBack={onBack} />
      <div className="manage-add-farm">
        <Field label="Nazwa nowej fermy"><TextInput value={newFarmName} onChange={setNewFarmName} placeholder="np. Ferma Gorzewo" /></Field>
        <button className="btn btn-primary btn-block" disabled={!newFarmName.trim()} onClick={addFarm}>+ Dodaj fermę</button>
      </div>
      {farms.map((farm) => (
        <div key={farm.id} className="farm-manage-card">
          <div className="farm-manage-header" onClick={() => setExpanded(expanded === farm.id ? null : farm.id)}>
            {renamingFarmId === farm.id ? (
              <div className="farm-rename-row" onClick={(e) => e.stopPropagation()}>
                <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                <button className="mini-btn-ok" onClick={() => submitRename(farm.id)}>✓</button>
                <button className="mini-btn" onClick={() => setRenamingFarmId(null)}>✕</button>
              </div>
            ) : (
              <>
                <span className="farm-name-row">{farm.name}<button className="mini-edit" onClick={(e) => { e.stopPropagation(); setRenamingFarmId(farm.id); setRenameValue(farm.name); }}>✎</button></span>
                <span className="farm-manage-count">{farm.kurniki.length} kurników {expanded === farm.id ? "▲" : "▼"}</span>
              </>
            )}
          </div>
          {expanded === farm.id && (
            <div className="farm-manage-body">
              {farm.kurniki.map((k) => (
                editingKurnikId === k.id ? (
                  <EditKurnikForm key={k.id} kurnik={k} onCancel={() => setEditingKurnikId(null)} onSave={updateKurnik} />
                ) : (
                  <div key={k.id} className="kurnik-manage-row">
                    <span className="kmr-info">{k.name} · {k.line || "—"} · {k.hens + k.roosters} szt.</span>
                    <span className="kmr-actions">
                      <button className="mini-btn" onClick={() => setEditingKurnikId(k.id)} title="Edytuj">✎</button>
                      <ConfirmButton className="mini-btn mini-btn-danger" label="✕" onConfirm={() => removeKurnik(k.id)} />
                    </span>
                  </div>
                )
              ))}
              <AddKurnikForm onAdd={(kurnik) => addKurnikTo(farm.id, kurnik)} />
              <ConfirmButton className="mini-btn-text" label="Usuń fermę" confirmLabel="Na pewno usunąć fermę? Kliknij ponownie" onConfirm={() => removeFarm(farm.id)} />
            </div>
          )}
        </div>
      ))}
      {farms.length === 0 && <p className="helper-text">Brak ferm. Dodaj pierwszą powyżej.</p>}
    </div>
  );
}

/* ============================== SZCZEGÓŁY KURNIKA ============================== */
function KurnikDetail({ kurnik, entries, onBack }) {
  const sortedDesc = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const sortedAsc = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const chartData = sortedAsc.map((e) => ({ date: e.date.slice(5), Nieśność: e.layPct, Upadki: e.cumMortality }));
  const layVals = entries.map((e) => e.layPct).filter((v) => v !== null && v !== undefined);
  const totalEggs = entries.reduce((sum, e) => sum + (Number(e.jajaOgolem) || 0), 0);
  const last = sortedDesc[0];

  return (
    <div className="screen">
      <TopBar title={`${kurnik.farmName} — ${kurnik.name}`} subtitle={`${kurnik.line || "—"} · wstawiono ${kurnik.start || "—"}`} onBack={onBack} />
      <div className="calc-grid">
        <Stat label="Nieśność (ostatnia)" value={fmt(last?.layPct, "%")} tone={last?.layPct > 65 ? "good" : last?.layPct > 50 ? "watch" : "alert"} />
        <Stat label="Upadki skum." value={fmt(last?.cumMortality, "%")} tone={last?.cumMortality > 5 ? "alert" : "good"} />
        <Stat label="Nieśność min / max" value={layVals.length ? `${fmt(round(Math.min(...layVals), 1))} / ${fmt(round(Math.max(...layVals), 1))}` : "—"} />
        <Stat label="Jaja łącznie" value={fmt(totalEggs)} />
      </div>
      {chartData.length > 0 ? (
        <div className="chart-card">
          <div className="chart-title">Pełny trend — nieśność i upadki skumulowane</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#423A30" />
              <XAxis dataKey="date" stroke="#A89A85" fontSize={11} />
              <YAxis stroke="#A89A85" fontSize={11} />
              <Tooltip contentStyle={{ background: "#2A241E", border: "1px solid #423A30", color: "#F2EDE4" }} />
              <Line type="monotone" dataKey="Nieśność" stroke="#E8A33D" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Upadki" stroke="#B5443A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="helper-text">Brak jeszcze wpisów dla tego kurnika.</p>}
      <div className="section-title">Wszystkie wpisy ({entries.length})</div>
      <div className="entry-list">
        {sortedDesc.map((e, i) => (
          <div key={i} className="entry-card">
            <div className="entry-card-header"><span className="entry-date">{e.date}</span><span className="entry-week">tydz. życia {e.tydzZycia}</span></div>
            <div className="entry-grid">
              <div><span className="entry-label">Nieśność</span><span className="entry-value">{fmt(e.layPct, "%")}</span></div>
              <div><span className="entry-label">Upadki skum.</span><span className="entry-value">{fmt(e.cumMortality, "%")}</span></div>
              <div><span className="entry-label">Jaja ogółem</span><span className="entry-value">{fmt(e.jajaOgolem)}</span></div>
              <div><span className="entry-label">Jaja wylęg.</span><span className="entry-value">{fmt(e.jajaWyleg)}</span></div>
              <div><span className="entry-label">Waga jaja</span><span className="entry-value">{fmt(e.wagaJaja, "g")}</span></div>
              <div><span className="entry-label">Kury / koguty żywe</span><span className="entry-value">{fmt(e.kuryZywe)} / {fmt(e.kogutyZywe)}</span></div>
              <div><span className="entry-label">Pasza K / Kog</span><span className="entry-value">{fmt(e.paszaKury, "kg")} / {fmt(e.paszaKog, "kg")}</span></div>
              <div><span className="entry-label">Woda</span><span className="entry-value">{fmt(e.woda, "l")}</span></div>
              <div><span className="entry-label">Temp. kurnik / magaz.</span><span className="entry-value">{fmt(e.tempKurnik)}° / {fmt(e.tempMagazJaj)}°C</span></div>
            </div>
            {(e.suplement || e.notatki) && <div className="entry-notes">{e.suplement && <div>💊 {e.suplement}</div>}{e.notatki && <div>📝 {e.notatki}</div>}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== PODGLĄD WYLĘGARNI ============================== */
function HatcheryDataView({ store, onBack }) {
  const [tab, setTab] = useState("wyleg");
  const [filterDostawca, setFilterDostawca] = useState("");
  const [expandedNaklad, setExpandedNaklad] = useState(null);

  const dostawcy = useMemo(() => {
    const set = new Set();
    [...store.wylegarnia, ...store.tempZarodka, ...store.utrataMasy].forEach((e) => e.dostawca && set.add(e.dostawca));
    return Array.from(set).sort();
  }, [store]);

  const wylegList = useMemo(() => { const l = [...store.wylegarnia].sort((a, b) => (a.dataNaladu < b.dataNaladu ? 1 : -1)); return filterDostawca ? l.filter((e) => e.dostawca === filterDostawca) : l; }, [store, filterDostawca]);
  const tempList = useMemo(() => { const l = [...store.tempZarodka].sort((a, b) => (a.dataNaladu < b.dataNaladu ? 1 : -1)); return filterDostawca ? l.filter((e) => e.dostawca === filterDostawca) : l; }, [store, filterDostawca]);
  const masaList = useMemo(() => { const l = [...store.utrataMasy].sort((a, b) => (a.dataNaladu < b.dataNaladu ? 1 : -1)); return filterDostawca ? l.filter((e) => e.dostawca === filterDostawca) : l; }, [store, filterDostawca]);

  // Grupowanie po "nakładzie" — jedna data nałożenia = jedna partia produkcyjna,
  // złożona z jaj od kilku dostawców/kurników wstawionych do klujnika razem.
  const groupByNaklad = (list, valueKey, wagaKey) => {
    const groups = {};
    list.forEach((e) => { (groups[e.dataNaladu] || (groups[e.dataNaladu] = [])).push(e); });
    return Object.entries(groups)
      .map(([date, entries]) => ({ date, entries, count: entries.length }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  };

  const wylegNaklady = useMemo(() => {
    return groupByNaklad(wylegList).map((g) => {
      const totalNaladu = g.entries.reduce((s, e) => s + (Number(e.naladu) || 0), 0);
      const totalPiskleta = g.entries.reduce((s, e) => s + (Number(e.pisklietaZdrowe) || 0), 0);
      const zaplW = g.entries.reduce((s, e) => s + (Number(e.zaplPct) || 0) * (Number(e.naladu) || 0), 0);
      const wylegW = g.entries.reduce((s, e) => s + (Number(e.wylegNaladu) || 0) * (Number(e.naladu) || 0), 0);
      return {
        ...g, totalNaladu, totalPiskleta,
        avgZapl: totalNaladu ? round(zaplW / totalNaladu, 1) : null,
        avgWyleg: totalNaladu ? round(wylegW / totalNaladu, 1) : null,
        dataWylegu: g.entries[0]?.dataWylegu || "",
      };
    });
  }, [wylegList]);

  const masaNaklady = useMemo(() => {
    return groupByNaklad(masaList).map((g) => {
      const chick = g.entries.map((e) => e.chickPct).filter((v) => v !== null && v !== undefined);
      return { ...g, avgChickPct: chick.length ? round(chick.reduce((a, b) => a + b, 0) / chick.length, 1) : null };
    });
  }, [masaList]);

  const wylegStats = useMemo(() => {
    if (!wylegList.length) return null;
    const zapl = wylegList.map((e) => e.zaplPct).filter((v) => v !== null && v !== undefined);
    const wylegN = wylegList.map((e) => e.wylegNaladu).filter((v) => v !== null && v !== undefined);
    const totalPiskleta = wylegList.reduce((s, e) => s + (Number(e.pisklietaZdrowe) || 0), 0);
    return { naklady: wylegNaklady.length, count: wylegList.length, avgZapl: zapl.length ? round(zapl.reduce((a, b) => a + b, 0) / zapl.length, 1) : null, avgWyleg: wylegN.length ? round(wylegN.reduce((a, b) => a + b, 0) / wylegN.length, 1) : null, totalPiskleta };
  }, [wylegList, wylegNaklady]);

  const tempStats = useMemo(() => {
    if (!tempList.length) return null;
    const avgs = tempList.map((e) => e.avg).filter((v) => v !== null && v !== undefined);
    const outOfRange = tempList.filter((e) => e.avg !== null && (e.avg < 99 || e.avg > 100.5)).length;
    return { count: tempList.length, avgOverall: avgs.length ? round(avgs.reduce((a, b) => a + b, 0) / avgs.length, 1) : null, outOfRange };
  }, [tempList]);

  const masaStats = useMemo(() => {
    if (!masaList.length) return null;
    const chick = masaList.map((e) => e.chickPct).filter((v) => v !== null && v !== undefined);
    return { naklady: masaNaklady.length, count: masaList.length, avgChickPct: chick.length ? round(chick.reduce((a, b) => a + b, 0) / chick.length, 1) : null };
  }, [masaList, masaNaklady]);

  return (
    <div className="screen">
      <TopBar title="Wylęgarnia" subtitle="Podgląd wg nakładów" onBack={onBack} />
      <div className="tabs">
        <button className={`tab ${tab === "wyleg" ? "tab-active" : ""}`} onClick={() => setTab("wyleg")}>Wylęgi</button>
        <button className={`tab ${tab === "temp" ? "tab-active" : ""}`} onClick={() => setTab("temp")}>Temp. zarodka</button>
        <button className={`tab ${tab === "masa" ? "tab-active" : ""}`} onClick={() => setTab("masa")}>Utrata masy</button>
      </div>
      <Field label="Filtruj wg dostawcy / stada"><Select value={filterDostawca} onChange={setFilterDostawca} options={dostawcy} /></Field>
      {filterDostawca && <button className="mini-btn-text" onClick={() => setFilterDostawca("")}>✕ wyczyść filtr</button>}

      {tab === "wyleg" && (
        <>
          {wylegStats && (
            <div className="calc-grid">
              <Stat label="Nakładów" value={wylegStats.naklady} />
              <Stat label="Partii łącznie" value={wylegStats.count} />
              <Stat label="Śr. wylęg z nał." value={fmt(wylegStats.avgWyleg, "%")} tone={wylegStats.avgWyleg > 80 ? "good" : wylegStats.avgWyleg > 65 ? "watch" : "alert"} />
              <Stat label="Pisklęta łącznie" value={fmt(wylegStats.totalPiskleta)} />
            </div>
          )}
          <div className="naklad-list">
            {wylegNaklady.length === 0 && <p className="helper-text">Brak nakładów do wyświetlenia.</p>}
            {wylegNaklady.map((g) => (
              <div key={g.date} className="naklad-card">
                <div className="naklad-header" onClick={() => setExpandedNaklad(expandedNaklad === g.date ? null : g.date)}>
                  <div>
                    <div className="naklad-date">Nakład {g.date}{g.dataWylegu ? ` → wylęg ${g.dataWylegu}` : ""}</div>
                    <div className="naklad-sub">{g.count} {g.count === 1 ? "źródło" : "źródeł"} · {fmt(g.totalNaladu)} jaj · {fmt(g.totalPiskleta)} piskląt</div>
                  </div>
                  <div className="naklad-summary">
                    <span className="naklad-pct" data-tone={g.avgWyleg > 80 ? "good" : g.avgWyleg > 65 ? "watch" : "alert"}>{fmt(g.avgWyleg, "%")}</span>
                    <span className="naklad-arrow">{expandedNaklad === g.date ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedNaklad === g.date && (
                  <div className="naklad-body">
                    {g.entries.map((e) => (
                      <div key={e.id} className="entry-card entry-card-nested">
                        <div className="entry-card-header"><span className="entry-date">{e.dostawca}</span><span className="entry-week">{e.nrPartii ? `partia ${e.nrPartii}` : ""}</span></div>
                        <div className="entry-grid">
                          <div><span className="entry-label">Jaja nałożone</span><span className="entry-value">{fmt(e.naladu)}</span></div>
                          <div><span className="entry-label">Zapłodnienie</span><span className="entry-value">{fmt(e.zaplPct, "%")}</span></div>
                          <div><span className="entry-label">Zamarłe</span><span className="entry-value">{fmt(e.zamarlePct, "%")}</span></div>
                          <div><span className="entry-label">Nie wyklute</span><span className="entry-value">{fmt(e.nieWyklutePct, "%")}</span></div>
                          <div><span className="entry-label">Wylęg z nał.</span><span className="entry-value">{fmt(e.wylegNaladu, "%")}</span></div>
                          <div><span className="entry-label">Wylęg z zapł.</span><span className="entry-value">{fmt(e.wylegZapl, "%")}</span></div>
                          <div><span className="entry-label">Pisklęta zdrowe</span><span className="entry-value">{fmt(e.pisklietaZdrowe)}</span></div>
                        </div>
                        {e.uwagi && <div className="entry-notes"><div>📝 {e.uwagi}</div></div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "temp" && (
        <>
          {tempStats && <div className="calc-grid"><Stat label="Partii" value={tempStats.count} /><Stat label="Śr. °F ogółem" value={fmt(tempStats.avgOverall)} tone={tempStats.avgOverall > 99 && tempStats.avgOverall < 100.5 ? "good" : "watch"} /><Stat label="Poza normą" value={tempStats.outOfRange} tone={tempStats.outOfRange > 0 ? "alert" : "good"} /></div>}
          <div className="entry-list">
            {tempList.length === 0 && <p className="helper-text">Brak partii do wyświetlenia.</p>}
            {tempList.map((e) => (
              <div key={e.id} className="entry-card">
                <div className="entry-card-header"><span className="entry-date">Nakład {e.dataNaladu}</span><span className="entry-week">{e.dostawca}</span></div>
                <div className="entry-grid">
                  <div><span className="entry-label">Śr. °F</span><span className="entry-value">{fmt(e.avg, "°F")}</span></div>
                  <div><span className="entry-label">Min / Max</span><span className="entry-value">{fmt(e.min)} / {fmt(e.max)}</span></div>
                  <div><span className="entry-label">Liczba pomiarów</span><span className="entry-value">{e.measurements?.length || 0}</span></div>
                </div>
                {e.measurements?.length > 0 && <div className="measure-list" style={{ marginTop: "8px" }}>{e.measurements.map((m, i) => <div key={i} className="log-row"><span>Dz.{m.dzien || "—"}</span><span>{m.temp}°F</span><span>{m.polozenie}</span></div>)}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "masa" && (
        <>
          {masaStats && <div className="calc-grid"><Stat label="Nakładów" value={masaStats.naklady} /><Stat label="Pomiarów łącznie" value={masaStats.count} /><Stat label="Śr. pisklę/jajo" value={fmt(masaStats.avgChickPct, "%")} /></div>}
          <div className="naklad-list">
            {masaNaklady.length === 0 && <p className="helper-text">Brak nakładów do wyświetlenia.</p>}
            {masaNaklady.map((g) => (
              <div key={g.date} className="naklad-card">
                <div className="naklad-header" onClick={() => setExpandedNaklad(expandedNaklad === `masa-${g.date}` ? null : `masa-${g.date}`)}>
                  <div>
                    <div className="naklad-date">Nakład {g.date}</div>
                    <div className="naklad-sub">{g.count} {g.count === 1 ? "pomiar" : "pomiarów"}</div>
                  </div>
                  <div className="naklad-summary">
                    <span className="naklad-pct">{fmt(g.avgChickPct, "%")}</span>
                    <span className="naklad-arrow">{expandedNaklad === `masa-${g.date}` ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedNaklad === `masa-${g.date}` && (
                  <div className="naklad-body">
                    {g.entries.map((e) => (
                      <div key={e.id} className="entry-card entry-card-nested">
                        <div className="entry-card-header"><span className="entry-date">{e.dostawca}</span></div>
                        <div className="entry-grid">
                          <div><span className="entry-label">Waga dz.0</span><span className="entry-value">{fmt(e.waga0, "g")}</span></div>
                          {e.checkpoints?.filter((c) => c.loss !== null).map((c) => <div key={c.day}><span className="entry-label">Utrata dz.{c.day}</span><span className="entry-value">{fmt(c.loss, "%")}</span></div>)}
                          <div><span className="entry-label">Waga pisklęcia</span><span className="entry-value">{fmt(e.wagaPisklecia, "g")}</span></div>
                        </div>
                        {e.uwagi && <div className="entry-notes"><div>📝 {e.uwagi}</div></div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== PANEL ZARZĄDCZY ============================== */
function OwnerDashboard({ store, farms, onBack }) {
  const [detailId, setDetailId] = useState(null);
  const [showHatchery, setShowHatchery] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const allKurniki = useMemo(() => getAllKurniki(farms), [farms]);

  const status = useMemo(() => {
    const s = {};
    allKurniki.forEach((k) => {
      const list = store.dzienne[k.id] || [];
      if (!list.length) return;
      const last = list[list.length - 1];
      let tone = "ok";
      if (last.layPct !== null && last.layPct < 50) tone = "alert";
      else if (last.layPct !== null && last.layPct < 65) tone = "watch";
      s[k.id] = { tone, metric: fmt(last.layPct, "%") };
    });
    return s;
  }, [store, allKurniki]);

  const activeKurniki = allKurniki.filter((k) => (store.dzienne[k.id] || []).length > 0);
  const avgLay = round(activeKurniki.reduce((sum, k) => sum + store.dzienne[k.id][store.dzienne[k.id].length - 1].layPct, 0) / (activeKurniki.length || 1), 1);
  const alerts = Object.values(status).filter((s) => s.tone === "alert").length;
  const lastHatch = store.wylegarnia.length ? store.wylegarnia[store.wylegarnia.length - 1] : null;

  if (detailId) {
    const k = allKurniki.find((kk) => kk.id === detailId);
    return <KurnikDetail kurnik={k} entries={store.dzienne[detailId] || []} onBack={() => setDetailId(null)} />;
  }
  if (showHatchery) return <HatcheryDataView store={store} onBack={() => setShowHatchery(false)} />;

  return (
    <div className="screen">
      <TopBar title="Panel zarządczy" subtitle="XDROB — wszystkie fermy i wylęgarnia" onBack={onBack} />
      <div className="calc-grid">
        <Stat label="Aktywne kurniki" value={activeKurniki.length} />
        <Stat label="Śr. nieśność" value={fmt(avgLay, "%")} tone={avgLay > 65 ? "good" : "watch"} />
        <Stat label="Alerty" value={alerts} tone={alerts > 0 ? "alert" : "good"} />
        <Stat label="Ostatni wylęg" value={lastHatch ? fmt(lastHatch.wylegNaladu, "%") : "—"} />
      </div>
      <button className="kurnik-detail-link" onClick={() => setShowHatchery(true)}>🥚 Zobacz pełne dane wylęgarni</button>
      <div className="section-title">Fermy</div>
      <p className="helper-text">Stuknij kurnik, aby zobaczyć pełną historię wpisów.</p>
      <KurnikGrid farms={farms} statusMap={status} selected={null} onSelect={(id) => setDetailId(id)} />

      <div className="section-title">Ostatnia aktywność</div>
      <div className="recent-log">
        {[
          ...Object.entries(store.dzienne).flatMap(([kid, list]) => list.map((e) => ({ type: "Dziennie", label: allKurniki.find((k) => k.id === kid)?.name, date: e.date, ts: e.ts }))),
          ...store.wylegarnia.map((e) => ({ type: "Wylęg", label: e.dostawca, date: e.dataNaladu, ts: e.ts })),
          ...store.tempZarodka.map((e) => ({ type: "Temp. zarodka", label: e.dostawca, date: e.dataNaladu, ts: e.ts })),
          ...store.utrataMasy.map((e) => ({ type: "Utrata masy", label: e.dostawca, date: e.dataNaladu, ts: e.ts })),
        ].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8).map((e, i) => (
          <div key={i} className="log-row"><span className="log-type">{e.type}</span><span>{e.label}</span><span>{e.date}</span></div>
        ))}
        {Object.keys(store.dzienne).length === 0 && store.wylegarnia.length === 0 && <p className="helper-text">Brak wpisów. Dodaj dane w widoku fermy lub wylęgarni.</p>}
      </div>

      <div className="section-title">Panel administratora</div>
      <div className="admin-actions">
        <button className="btn btn-ghost btn-block" onClick={() => download(`xdrob_dane_${todayISO()}.json`, JSON.stringify(store, null, 2))}>⬇ Pobierz wszystkie dane (JSON)</button>
        <button className="btn btn-ghost btn-block" onClick={() => { const rows = flattenDzienne(store, farms); if (!rows.length) return; download(`xdrob_wpisy_dzienne_${todayISO()}.csv`, toCSV(rows), "text/csv"); }}>⬇ Wpisy dzienne (CSV)</button>
        <button className="btn btn-ghost btn-block" onClick={() => setShowRaw((s) => !s)}>{showRaw ? "Ukryj surowe dane" : "👁 Pokaż surowe dane"}</button>
        {showRaw && <pre className="raw-json">{JSON.stringify(store, null, 2)}</pre>}
      </div>

      <div className="ai-panel">
        <button className="btn btn-ghost btn-block" disabled title="Wymaga własnego backendu z kluczem API — do zrobienia w kolejnym kroku">🔒 Analiza AI (wymaga dodatkowej konfiguracji)</button>
      </div>
    </div>
  );
}

/* ============================== APP ROOT ============================== */
export default function App() {
  const { session, profile, authReady, logout } = useAuth();
  const { farms, store, ready, reload } = useSupabaseData(session);
  const [mode, setMode] = useState(null);
  const [screen, setScreen] = useState(null);

  const backToMode = () => { setScreen(null); setMode(null); };
  const backToRoleMenu = () => setScreen(null);

  useEffect(() => {
    if (profile?.role === "worker") setMode("worker");
  }, [profile]);

  let body;
  if (!authReady) {
    body = <div className="screen"><p className="helper-text">Wczytywanie…</p></div>;
  } else if (!session) {
    body = <AuthGate />;
  } else if (!profile || !ready) {
    body = <div className="screen"><p className="helper-text">Wczytywanie danych…</p></div>;
  } else if (!mode) {
    body = <ModeSelect onPick={setMode} user={session.user.email} onLogout={logout} />;
  } else if (mode === "admin" && !screen) {
    body = <AdminRoleSelect onPick={setScreen} onBack={backToMode} />;
  } else if (mode === "worker" && !screen) {
    body = <WorkerRoleSelect onPick={setScreen} onBack={profile.role === "admin" ? backToMode : undefined} />;
  } else if (screen === "farm") {
    body = <FarmRole store={store} farms={farms} reload={reload} onBack={backToRoleMenu} />;
  } else if (screen === "hatchery") {
    body = <HatcheryRole store={store} farms={farms} reload={reload} onBack={backToRoleMenu} />;
  } else if (screen === "hatcheryView") {
    body = <HatcheryDataView store={store} onBack={backToRoleMenu} />;
  } else if (screen === "owner") {
    body = <OwnerDashboard store={store} farms={farms} onBack={backToRoleMenu} />;
  } else if (screen === "manage") {
    body = <FarmManager farms={farms} reload={reload} onBack={backToRoleMenu} />;
  }

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .app-root {
          --bg: #1C1917; --surface: #2A241E; --surface-2: #362F27;
          --accent: #E8A33D; --accent-2: #B5443A; --success: #7A9B6E;
          --text: #F2EDE4; --text-muted: #A89A85; --border: #423A30;
          background: var(--bg); color: var(--text); font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100vh; width: 100%; padding-bottom: 32px; box-sizing: border-box;
        }
        .app-shell { max-width: 480px; margin: 0 auto; }
        .screen { padding: 20px 16px 8px; }
        .brand { display: flex; align-items: center; gap: 12px; padding: 24px 4px 8px; }
        .brand-mark { width: 48px; height: 48px; border-radius: 10px; background: var(--accent); color: #1C1917; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 18px; display: flex; align-items: center; justify-content: center; letter-spacing: 0.5px; }
        .brand-title { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 22px; letter-spacing: 0.3px; }
        .brand-sub { color: var(--text-muted); font-size: 13px; margin-top: 2px; }
        .role-list { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
        .role-card { display: flex; align-items: center; gap: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; text-align: left; cursor: pointer; color: var(--text); }
        .role-card:active { background: var(--surface-2); }
        .role-icon { font-size: 26px; }
        .role-text { display: flex; flex-direction: column; gap: 2px; }
        .role-name { font-family: 'Oswald', sans-serif; font-size: 16px; font-weight: 600; }
        .role-desc { font-size: 12.5px; color: var(--text-muted); }
        .auth-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 14px; margin-top: 20px; }
        .session-bar { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--text-muted); margin: 10px 2px 4px; }
        .session-bar b { color: var(--text); font-family: 'IBM Plex Mono', monospace; }
        .logout-link { background: transparent; border: none; color: var(--accent-2); font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: underline; }
        .topbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .back-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); width: 36px; height: 36px; border-radius: 9px; font-size: 16px; cursor: pointer; }
        .topbar-title { font-family: 'Oswald', sans-serif; font-size: 19px; font-weight: 600; }
        .topbar-subtitle { font-size: 12.5px; color: var(--text-muted); }
        .kurnik-groups { display: flex; flex-direction: column; gap: 18px; margin-top: 10px; }
        .farm-group-title { font-family: 'Oswald', sans-serif; font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .egg-tray { display: flex; flex-wrap: wrap; gap: 8px; }
        .egg-cup { width: 76px; height: 78px; border-radius: 6px 6px 40% 40%; background: var(--surface); border: 1.5px solid var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; color: var(--text); padding: 4px; }
        .egg-cup-selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(232,163,61,0.35); }
        .egg-cup-ok { background: rgba(122,155,110,0.15); border-color: var(--success); }
        .egg-cup-watch { background: rgba(232,163,61,0.15); border-color: var(--accent); }
        .egg-cup-alert { background: rgba(181,68,58,0.18); border-color: var(--accent-2); }
        .egg-cup-label { font-size: 11px; font-weight: 600; text-align: center; line-height: 1.2; }
        .egg-cup-metric { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-muted); }
        .helper-text { color: var(--text-muted); font-size: 13px; margin-top: 14px; text-align: center; }
        .progress-dots { display: flex; gap: 6px; margin-bottom: 6px; }
        .dot { height: 4px; flex: 1; border-radius: 2px; background: var(--border); }
        .dot-active { background: var(--accent); }
        .dot-done { background: var(--success); }
        .step-title { font-family: 'Oswald', sans-serif; font-size: 15px; font-weight: 600; color: var(--accent); margin: 10px 0 14px; }
        .form-body { display: flex; flex-direction: column; gap: 14px; }
        .field-block { display: flex; flex-direction: column; gap: 6px; }
        .field-label { font-size: 12.5px; color: var(--text-muted); font-weight: 500; }
        .field-hint { font-size: 11px; color: var(--text-muted); }
        .input { background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 12px 12px; color: var(--text); font-size: 15px; font-family: 'IBM Plex Mono', monospace; width: 100%; box-sizing: border-box; }
        .input:focus { outline: none; border-color: var(--accent); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .calc-row { background: var(--surface); border: 1px dashed var(--border); border-radius: 9px; padding: 10px 12px; font-size: 13px; color: var(--text-muted); }
        .calc-row b { color: var(--accent); font-family: 'IBM Plex Mono', monospace; }
        .wizard-nav { display: flex; gap: 10px; margin-top: 18px; }
        .btn { border: none; border-radius: 10px; padding: 13px 18px; font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 14.5px; cursor: pointer; letter-spacing: 0.3px; }
        .btn-primary { background: var(--accent); color: #1C1917; flex: 1; }
        .btn-primary:disabled { opacity: 0.4; }
        .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
        .btn-ghost:disabled { opacity: 0.4; }
        .btn-block { width: 100%; }
        .recent-log { margin-top: 22px; border-top: 1px solid var(--border); padding-top: 12px; }
        .recent-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; }
        .log-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; padding: 7px 0; border-bottom: 1px solid var(--surface-2); font-family: 'IBM Plex Mono', monospace; }
        .log-type { color: var(--accent); font-family: 'IBM Plex Sans', sans-serif; font-weight: 600; }
        .tabs { display: flex; gap: 6px; margin-bottom: 18px; background: var(--surface); padding: 4px; border-radius: 10px; }
        .tab { flex: 1; background: transparent; border: none; color: var(--text-muted); padding: 9px 4px; border-radius: 7px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .tab-active { background: var(--accent); color: #1C1917; }
        .calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0; }
        .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
        .stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 19px; font-weight: 600; }
        .stat-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .stat-good .stat-value { color: var(--success); }
        .stat-watch .stat-value { color: var(--accent); }
        .stat-alert .stat-value { color: var(--accent-2); }
        .measure-add { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .measure-list { display: flex; flex-direction: column; gap: 4px; }
        .checkpoint-row { display: grid; grid-template-columns: 52px 1fr 1fr 50px; gap: 8px; align-items: center; }
        .checkpoint-day { font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .checkpoint-loss { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: var(--accent); text-align: right; }
        .section-title { font-family: 'Oswald', sans-serif; font-size: 14px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; margin: 22px 0 10px; }
        .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-top: 10px; }
        .chart-title { font-size: 12.5px; color: var(--text-muted); margin-bottom: 8px; }
        .admin-actions { display: flex; flex-direction: column; gap: 8px; }
        .raw-json { background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 12px; font-size: 10.5px; font-family: 'IBM Plex Mono', monospace; color: var(--text-muted); max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
        .ai-panel { margin-top: 14px; }
        .ai-error { color: var(--accent-2); font-size: 13px; margin-top: 10px; }
        .kurnik-detail-link { background: transparent; border: 1px solid var(--accent); color: var(--accent); border-radius: 9px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 10px; }
        .manage-add-farm { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .farm-manage-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
        .farm-manage-header { display: flex; justify-content: space-between; align-items: center; padding: 14px; cursor: pointer; font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 15px; }
        .farm-manage-count { font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; font-weight: 500; color: var(--text-muted); flex-shrink: 0; }
        .farm-name-row { display: flex; align-items: center; gap: 8px; }
        .farm-rename-row { display: flex; align-items: center; gap: 6px; flex: 1; }
        .farm-rename-row .input { padding: 8px 10px; font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; }
        .mini-edit { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 2px 4px; }
        .mini-edit:hover { color: var(--accent); }
        .mini-btn-ok { background: transparent; border: 1px solid var(--success); color: var(--success); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 12px; flex-shrink: 0; }
        .farm-manage-body { border-top: 1px solid var(--border); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
        .kurnik-manage-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; padding: 8px 0; border-bottom: 1px solid var(--surface-2); }
        .kmr-info { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kmr-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .mini-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 12px; flex-shrink: 0; }
        .mini-btn-danger { border-color: var(--accent-2); color: var(--accent-2); }
        .mini-btn-danger.confirming { background: var(--accent-2); color: #fff; width: auto; padding: 0 8px; font-size: 10.5px; font-weight: 600; }
        .mini-btn-text { background: transparent; border: none; color: var(--accent-2); font-size: 12.5px; cursor: pointer; margin-top: 6px; align-self: flex-start; text-decoration: underline; }
        .mini-btn-text.confirming { color: #fff; background: var(--accent-2); text-decoration: none; padding: 6px 10px; border-radius: 6px; font-weight: 600; }
        .kurnik-add-form { background: var(--surface-2); border-radius: 9px; padding: 10px; display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
        .added-confirm { color: var(--success); font-size: 12.5px; font-weight: 600; text-align: center; }
        .entry-list { display: flex; flex-direction: column; gap: 10px; }
        .entry-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
        .entry-card-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .entry-date { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 15px; }
        .entry-week { font-size: 11.5px; color: var(--text-muted); }
        .entry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
        .entry-grid > div { display: flex; justify-content: space-between; gap: 6px; }
        .entry-label { font-size: 11.5px; color: var(--text-muted); }
        .entry-value { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; font-weight: 600; }
        .entry-notes { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; }
        .naklad-list { display: flex; flex-direction: column; gap: 10px; }
        .naklad-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .naklad-header { display: flex; justify-content: space-between; align-items: center; padding: 14px; cursor: pointer; gap: 10px; }
        .naklad-date { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 14.5px; }
        .naklad-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }
        .naklad-summary { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .naklad-pct { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 15px; }
        .naklad-pct[data-tone="good"] { color: var(--success); }
        .naklad-pct[data-tone="watch"] { color: var(--accent); }
        .naklad-pct[data-tone="alert"] { color: var(--accent-2); }
        .naklad-arrow { color: var(--text-muted); font-size: 11px; }
        .naklad-body { border-top: 1px solid var(--border); padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
        .entry-card-nested { background: var(--surface-2); }

        /* ============ SZEROKIE EKRANY (desktop) ============ */
        @media (min-width: 860px) {
          .app-shell { max-width: 1120px; }
          .screen { padding: 36px 48px 24px; }
          .brand { padding: 8px 4px 24px; }
          .brand-title { font-size: 28px; }
          .brand-sub { font-size: 14px; }

          /* Ekrany wyboru / logowania: karty obok siebie zamiast w kolumnie */
          .role-screen .role-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; max-width: 900px; }
          .auth-card { max-width: 440px; margin: 24px 0 0; }

          /* Statystyki: 4 w rzędzie zamiast 2 */
          .calc-grid { grid-template-columns: repeat(4, 1fr); gap: 14px; }
          .stat { padding: 16px; }
          .stat-value { font-size: 23px; }

          /* Siatka kurników i wpisy: więcej miejsca, karty obok siebie */
          .kurnik-groups { gap: 24px; }
          .egg-tray { gap: 12px; }
          .egg-cup { width: 92px; height: 94px; }
          .entry-list, .naklad-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; align-items: start; }
          .recent-log { max-width: 720px; }

          /* Formularze: nie rozciągaj na całą szerokość, trzymaj czytelną kolumnę */
          .form-body, .manage-add-farm, .kurnik-add-form, .admin-actions, .ai-panel, .measure-add { max-width: 640px; }
          .wizard-nav, .btn-block { max-width: 640px; }

          /* Panel zarządczy: dwie kolumny — lewa węższa (akcje), prawa szersza (przegląd) — realizujemy prościej: szersze karty w gridzie */
          .chart-card { max-width: 720px; }

          .role-card { padding: 22px; }
          .role-icon { font-size: 30px; }
          .role-name { font-size: 17px; }

          .kurnik-detail-link, .kurnik-groups + .helper-text { max-width: 720px; }
        }

        /* Bardzo szerokie ekrany: jeszcze trochę więcej powietrza */
        @media (min-width: 1300px) {
          .app-shell { max-width: 1320px; }
          .egg-tray { gap: 14px; }
        }
      `}</style>
      <div className="app-shell">{body}</div>
    </div>
  );
}
