/**
 * XDROB Tracker — Import z Excela do Supabase
 * Użycie: node import-excel.js [ścieżka_do_pliku.xlsx]
 * Domyślna ścieżka: ./Monitoring_Ferma_Wylegarnia_2026_4.xlsx
 *
 * Wymaga: npm install xlsx @supabase/supabase-js dotenv
 * (uruchom raz w folderze projektu)
 */

import { readFileSync } from "fs";
import { read, utils } from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_EMAIL = process.env.SEED_EMAIL || process.env.SUPABASE_EMAIL;
const SUPABASE_PASSWORD = process.env.SEED_PASSWORD || process.env.SUPABASE_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY w pliku .env");
  process.exit(1);
}
if (!SUPABASE_EMAIL || !SUPABASE_PASSWORD) {
  console.error("❌ Brak SEED_EMAIL lub SEED_PASSWORD w pliku .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Log in as app user so RLS policies are satisfied
const { error: loginErr } = await supabase.auth.signInWithPassword({
  email: SUPABASE_EMAIL,
  password: SUPABASE_PASSWORD,
});
if (loginErr) {
  console.error("❌ Logowanie do Supabase nieudane:", loginErr.message);
  process.exit(1);
}
console.log("✅ Zalogowano do Supabase\n");
const xlsxPath = process.argv[2] || path.join(__dirname, "Monitoring_Ferma_Wylegarnia_2026_4.xlsx");

// ─── helpers ────────────────────────────────────────────────────────────────

const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    // DD,MM,YYYY or DD.MM.YYYY
    const m = v.trim().match(/^(\d{1,2})[,.](\d{1,2})[,.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    // YYYY-MM-DD passthrough
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }
  if (typeof v === "number") {
    // Excel serial number
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return null;
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (n, d = 2) => (n === null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

// ─── load workbook ───────────────────────────────────────────────────────────

console.log(`\n📂 Wczytuję: ${xlsxPath}\n`);
const wb = read(readFileSync(xlsxPath), { type: "buffer", cellDates: true });

// ─── fetch kurniki from Supabase ─────────────────────────────────────────────

const { data: farms, error: farmsErr } = await supabase.from("farms").select("id, name");
if (farmsErr) { console.error("❌ Błąd przy pobieraniu farm:", farmsErr.message); process.exit(1); }

const { data: kurniki, error: kurnikErr } = await supabase.from("kurniki").select("id, farm_id, name, hens, roosters");
if (kurnikErr) { console.error("❌ Błąd przy pobieraniu kurników:", kurnikErr.message); process.exit(1); }

if (!kurniki || kurniki.length === 0) {
  console.error("❌ Brak kurników w Supabase — upewnij się że dodałeś kurniki w aplikacji");
  process.exit(1);
}

const kurnikByName = {};
for (const k of kurniki) kurnikByName[k.name?.trim().toLowerCase()] = k;

console.log("📋 Kurniki znalezione w Supabase:");
for (const k of kurniki) console.log(`   • "${k.name}"`);
console.log();

// ─── DZIENNE entries ──────────────────────────────────────────────────────────

let dzienneInserted = 0, dzienneSkipped = 0, dzienneMissing = [];

for (let i = 1; i <= 12; i++) {
  const sheetName = `Dzienne ${i}`;
  if (!wb.SheetNames.includes(sheetName)) continue;

  const ws = wb.Sheets[sheetName];
  const rows = utils.sheet_to_json(ws, { header: 1, defval: null });

  const flockName = rows[0]?.[2];
  if (!flockName) continue;

  const normalizedName = String(flockName).trim().replace(/^ferma za la[kś]iem\s+/i, "").trim();
  const kurnik = kurnikByName[normalizedName.toLowerCase()] || kurnikByName[String(flockName).trim().toLowerCase()];
  if (!kurnik) {
    dzienneMissing.push(flockName);
    continue;
  }

  // Total start for cum_mortality calculation
  const totalStart = (kurnik.hens || 0) + (kurnik.roosters || 0);

  // Fetch existing entries for this kurnik to avoid duplicates
  const { data: existing } = await supabase
    .from("dzienne_entries")
    .select("date")
    .eq("kurnik_id", kurnik.id);
  const existingDates = new Set((existing || []).map((e) => e.date));

  // Find header row (row index with "Data" in first cell)
  let headerIdx = rows.findIndex((r) => r[0] === "Data");
  if (headerIdx < 0) continue;

  // Build cumulative death map from existing entries
  const { data: priorEntries } = await supabase
    .from("dzienne_entries")
    .select("date, upadki_kury, upadki_koguty")
    .eq("kurnik_id", kurnik.id)
    .order("date", { ascending: true });

  // Accumulate deaths for all dates not in this Excel (so we can continue correctly)
  let priorDeaths = 0;
  // We'll recalculate cum_mortality per-row as we go through sorted data rows

  const dataRows = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[0]) continue; // empty date = end of data
    dataRows.push(row);
  }
  // Sort by date
  dataRows.sort((a, b) => {
    const da = toDate(a[0]), db = toDate(b[0]);
    return da < db ? -1 : da > db ? 1 : 0;
  });

  // Seed prior deaths from existing entries that come BEFORE the first Excel row date
  const firstExcelDate = toDate(dataRows[0]?.[0]);
  let cumDeaths = 0;
  for (const pe of (priorEntries || [])) {
    if (pe.date < firstExcelDate) {
      cumDeaths += (pe.upadki_kury || 0) + (pe.upadki_koguty || 0);
    }
  }

  // Deduplicate by date — keep last occurrence per date
  const deduped = new Map();
  for (const row of dataRows) {
    const d = toDate(row[0]);
    if (d) deduped.set(d, row);
  }
  const toUpsert = [];
  for (const row of deduped.values()) {
    const date = toDate(row[0]);
    if (!date) continue;

    const upadkiKury = num(row[4]) ?? 0;
    const upadkiKoguty = num(row[5]) ?? 0;
    cumDeaths += upadkiKury + upadkiKoguty;
    const cumMortality = totalStart > 0 ? round((cumDeaths / totalStart) * 100, 2) : null;

    const jajaOgolem = num(row[7]);
    const kuryZywe = num(row[2]);
    const jajaWyleg = num(row[8]);
    const layPct = jajaOgolem !== null && kuryZywe ? round((jajaOgolem / kuryZywe) * 100, 1) : null;
    const hatchEggPct = jajaWyleg !== null && jajaOgolem ? round((jajaWyleg / jajaOgolem) * 100, 1) : null;
    const paszaKury = num(row[12]);
    const paszaKog = num(row[13]);
    const woda = num(row[16]);

    toUpsert.push({
      kurnik_id: kurnik.id,
      date,
      tydz_zycia: num(row[1]),
      kury_zywe: kuryZywe,
      koguty_zywe: num(row[3]),
      upadki_kury: upadkiKury,
      upadki_koguty: upadkiKoguty,
      cum_mortality: cumMortality,
      jaja_ogolem: jajaOgolem,
      jaja_wyleg: jajaWyleg,
      hatch_egg_pct: hatchEggPct,
      lay_pct: layPct,
      waga_jaja: num(row[11]),
      pasza_kury: paszaKury,
      pasza_kog: paszaKog,
      dose_kury: paszaKury && kuryZywe ? round((paszaKury * 1000) / kuryZywe, 1) : null,
      dose_kog: paszaKog && num(row[3]) ? round((paszaKog * 1000) / num(row[3]), 1) : null,
      woda: woda,
      water_feed: woda && (paszaKury || 0) + (paszaKog || 0) > 0
        ? round(woda / ((paszaKury || 0) + (paszaKog || 0)), 2) : null,
      temp_kurnik: num(row[18]),
      temp_magaz_jaj: num(row[19]),
      waga_kury: num(row[20]),
      waga_kog: num(row[21]),
      suplement: row[22] ? String(row[22]) : null,
      notatki: row[23] ? String(row[23]) : null,
    });
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("dzienne_entries")
      .upsert(toUpsert, { onConflict: "kurnik_id,date" });
    if (error) {
      console.error(`❌ Błąd przy ${sheetName}:`, error.message);
    } else {
      const newCount = toUpsert.filter((r) => !existingDates.has(r.date)).length;
      const updCount = toUpsert.length - newCount;
      console.log(`✅ ${sheetName} (${flockName}): ${newCount} nowych, ${updCount} zaktualizowanych wpisów`);
      dzienneInserted += newCount;
    }
  } else {
    console.log(`⏭  ${sheetName} (${flockName}): brak danych`);
  }
}

if (dzienneMissing.length > 0) {
  console.warn(`\n⚠️  Nie znaleziono kurników w Supabase dla: ${dzienneMissing.join(", ")}`);
  console.warn("   Sprawdź czy nazwy stad w Excelu dokładnie odpowiadają nazwom kurników w aplikacji.\n");
}

// ─── WYLĘGARNIA ───────────────────────────────────────────────────────────────

const wsWyleg = wb.Sheets["Wylęgarnia"];
const wylegRows = utils.sheet_to_json(wsWyleg, { header: 1, defval: null });

// Find header row
let wylegHeader = wylegRows.findIndex((r) => r[0] === "Data nakładu");
if (wylegHeader < 0) wylegHeader = 1; // fallback

// Fetch existing for duplicate check
const { data: existingWyleg } = await supabase
  .from("wylegarnia")
  .select("data_naladu, dostawca, nr_partii");
const existingWylegSet = new Set(
  (existingWyleg || []).map((e) => `${e.data_naladu}|${e.dostawca}|${e.nr_partii}`)
);

let wylegInserted = 0;
const wylegToInsert = [];

for (let r = wylegHeader + 1; r < wylegRows.length; r++) {
  const row = wylegRows[r];
  if (!row[0]) continue;
  const dataNaladu = toDate(row[0]);
  if (!dataNaladu) continue;
  const dostawca = row[2] ? String(row[2]) : null;
  const nrPartii = row[3] ? String(row[3]) : null;

  const key = `${dataNaladu}|${dostawca}|${nrPartii}`;
  if (existingWylegSet.has(key)) continue; // already exists

  const dostawaJaj = num(row[5]);
  const strataMagaz = num(row[6]) ?? 0;
  const naladu = dostawaJaj !== null ? (dostawaJaj - strataMagaz) : num(row[7]);
  const niezaplodnione = num(row[8]);
  const niezaplPct = naladu && niezaplodnione !== null ? round((niezaplodnione / naladu) * 100, 2) : num(row[9]);
  const zamarle = num(row[10]);
  const zamarlePct = naladu && zamarle !== null ? round((zamarle / naladu) * 100, 2) : num(row[11]);
  const zaplPct = naladu && niezaplodnione !== null ? round(100 - (niezaplPct ?? 0), 2) : num(row[12]);
  const odpad = num(row[13]) ?? 0;
  const nieWyklute = num(row[15]) ?? 0;
  const doKlujnika = naladu !== null ? (naladu - (niezaplodnione ?? 0) - (zamarle ?? 0) - odpad) : num(row[14]);
  const nieWyklutePct = doKlujnika && nieWyklute ? round((nieWyklute / doKlujnika) * 100, 2) : num(row[16]);
  const piskleta = num(row[17]);
  const wylegNaladu = naladu && piskleta !== null ? round((piskleta / naladu) * 100, 2) : num(row[18]);
  const wylegZapl = naladu && zaplPct && piskleta !== null
    ? round((piskleta / ((naladu * zaplPct) / 100)) * 100, 2) : num(row[19]);

  wylegToInsert.push({
    data_naladu: dataNaladu,
    data_wylegu: toDate(row[1]),
    dostawca,
    nr_partii: nrPartii,
    dostawa_jaj: dostawaJaj,
    strata_magaz: strataMagaz,
    naladu,
    niezaplodnione,
    niezapl_pct: niezaplPct,
    zamarle,
    zamarle_pct: zamarlePct,
    zapl_pct: zaplPct,
    odpad,
    nie_wyklute: nieWyklute,
    nie_wyklute_pct: nieWyklutePct,
    pisklieta_zdrowe: piskleta,
    wyleg_naladu: wylegNaladu,
    wyleg_zapl: wylegZapl,
    uwagi: row[22] ? String(row[22]) : null,
  });
}

if (wylegToInsert.length > 0) {
  const { error } = await supabase.from("wylegarnia").insert(wylegToInsert);
  if (error) {
    console.error("❌ Błąd przy wylęgarni:", error.message);
  } else {
    wylegInserted = wylegToInsert.length;
    console.log(`✅ Wylęgarnia: ${wylegInserted} nowych nakładów`);
  }
} else {
  console.log("⏭  Wylęgarnia: brak nowych wpisów");
}

// ─── UTRATA MASY ──────────────────────────────────────────────────────────────

const wsMasa = wb.Sheets["Utrata Masy Jaja"];
const masaRows = utils.sheet_to_json(wsMasa, { header: 1, defval: null });

let masaHeader = masaRows.findIndex((r) => r[0] === "Nr" && r[1] && String(r[1]).includes("Data"));
if (masaHeader < 0) masaHeader = 2;

const { data: existingMasa } = await supabase
  .from("utrata_masy")
  .select("data_naladu, dostawca, waga0");
const existingMasaSet = new Set(
  (existingMasa || []).map((e) => `${e.data_naladu}|${e.dostawca}|${e.waga0}`)
);

// Checkpoint days in Excel column order: 4, 8, 12, 16, 18
// Columns (0-indexed): 0=Nr, 1=Date, 2=Dostawca, 3=Waga0, 4=nrAL0
// 5=Waga4, 6=Loss4%, 7=nrAL4
// 8=Waga8, 9=Loss8%, 10=nrAL8
// 11=Waga12, 12=Loss12%, 13=nrAL12
// 14=Waga16, 15=Loss16%, 16=nrAL16
// 17=Waga18, 18=Loss18%, 19=nrAL18
// 20=WagaPisklecia(g/szt), 21=ChickPct%, 22=nrAL, 23=Uwagi

const DAYS = [
  { day: 4,  wagaCol: 5,  lossCol: 6,  nrAlCol: 7  },
  { day: 8,  wagaCol: 8,  lossCol: 9,  nrAlCol: 10 },
  { day: 12, wagaCol: 11, lossCol: 12, nrAlCol: 13 },
  { day: 16, wagaCol: 14, lossCol: 15, nrAlCol: 16 },
  { day: 18, wagaCol: 17, lossCol: 18, nrAlCol: 19 },
];

let masaInserted = 0;
for (let r = masaHeader + 1; r < masaRows.length; r++) {
  const row = masaRows[r];
  if (!row[0]) continue;
  const dataNaladu = toDate(row[1]);
  if (!dataNaladu) continue;
  const dostawca = row[2] ? String(row[2]) : null;
  const waga0 = num(row[3]);

  const key = `${dataNaladu}|${dostawca}|${waga0}`;
  if (existingMasaSet.has(key)) continue;

  // waga_pisklecia: Excel is g/szt, app expects kg/150szt
  const wagaPiskleciaGSzt = num(row[20]);
  const wagaPisklecia = wagaPiskleciaGSzt !== null ? round((wagaPiskleciaGSzt * 150) / 1000, 3) : null;
  const chickPct = num(row[21]); // already calculated in Excel as %

  // Insert main record
  const { data: masaRecord, error: masaErr } = await supabase
    .from("utrata_masy")
    .insert({
      data_naladu: dataNaladu,
      dostawca,
      waga0,
      waga_pisklecia: wagaPisklecia,
      chick_pct: chickPct,
      uwagi: row[23] ? String(row[23]) : null,
    })
    .select()
    .single();

  if (masaErr) {
    console.error(`❌ Błąd utrata_masy wiersz ${r + 1}:`, masaErr.message);
    continue;
  }

  // Insert checkpoints
  const checkpoints = [];
  for (const cp of DAYS) {
    const waga = num(row[cp.wagaCol]);
    if (waga === null) continue;
    const loss = waga0 && waga ? round(((waga0 - waga) / waga0) * 100, 2) : num(row[cp.lossCol]);
    checkpoints.push({
      measurement_id: masaRecord.id,
      day: cp.day,
      waga,
      nr_al: row[cp.nrAlCol] ? String(row[cp.nrAlCol]) : null,
      loss,
    });
  }

  if (checkpoints.length > 0) {
    const { error: cpErr } = await supabase.from("utrata_masy_checkpoints").insert(checkpoints);
    if (cpErr) console.error(`❌ Błąd checkpointów wiersz ${r + 1}:`, cpErr.message);
  }

  masaInserted++;
}

if (masaInserted > 0) {
  console.log(`✅ Utrata masy: ${masaInserted} nowych wpisów`);
} else {
  console.log("⏭  Utrata masy: brak nowych wpisów");
}

// ─── TEMPERATURA ZARODKA ──────────────────────────────────────────────────────

const wsTemp = wb.Sheets["Temperatura zarodka"];
const tempRows = utils.sheet_to_json(wsTemp, { header: 1, defval: null });

let tempHeader = tempRows.findIndex((r) => r[0] === "Nr" && r[2] === "Dostawca");
if (tempHeader < 0) tempHeader = 2;

const { data: existingTemp } = await supabase
  .from("temp_zarodka")
  .select("id, data_naladu, dostawca");
const existingTempSet = new Set((existingTemp || []).map((e) => `${e.data_naladu}|${e.dostawca}`));

// Group rows by (data_naladu, dostawca) — each Excel row is one measurement
const tempGroups = {};
for (let r = tempHeader + 1; r < tempRows.length; r++) {
  const row = tempRows[r];
  if (!row[0]) continue;
  const dataNaladu = toDate(row[1]);
  if (!dataNaladu) continue;
  const dostawca = row[2] ? String(row[2]) : null;
  const key = `${dataNaladu}|${dostawca}`;

  if (existingTempSet.has(key)) continue;

  if (!tempGroups[key]) {
    tempGroups[key] = { dataNaladu, dostawca, measurements: [], uwagi: null };
  }

  // Columns: Dz.p1=3, T1=4, nrAL=5, Połoz=6 ... up to 10 measurements
  for (let m = 0; m < 10; m++) {
    const base = 3 + m * 4;
    const dzien = num(row[base]);
    const temp = num(row[base + 1]);
    if (temp === null) continue;
    tempGroups[key].measurements.push({
      dzien,
      temp,
      nr_al: row[base + 2] ? String(row[base + 2]) : null,
      polozenie: row[base + 3] ? String(row[base + 3]) : null,
    });
  }

  if (row[46]) tempGroups[key].uwagi = String(row[46]);
}

let tempInserted = 0;
for (const group of Object.values(tempGroups)) {
  if (!group.measurements.length) continue;
  const temps = group.measurements.map((m) => m.temp).filter(Boolean);
  const avg = temps.length ? round(temps.reduce((a, b) => a + b, 0) / temps.length, 2) : null;
  const minT = temps.length ? round(Math.min(...temps), 2) : null;
  const maxT = temps.length ? round(Math.max(...temps), 2) : null;

  const { data: batchRec, error: bErr } = await supabase
    .from("temp_zarodka")
    .insert({ data_naladu: group.dataNaladu, dostawca: group.dostawca, avg_temp: avg, min_temp: minT, max_temp: maxT, uwagi: group.uwagi })
    .select()
    .single();

  if (bErr) {
    console.error("❌ Błąd temp_zarodka:", bErr.message);
    continue;
  }

  const mRows = group.measurements.map((m) => ({ batch_id: batchRec.id, ...m }));
  const { error: mErr } = await supabase.from("temp_zarodka_measurements").insert(mRows);
  if (mErr) console.error("❌ Błąd temp_measurements:", mErr.message);
  else tempInserted++;
}

if (tempInserted > 0) {
  console.log(`✅ Temperatura zarodka: ${tempInserted} nowych partii`);
} else {
  console.log("⏭  Temperatura zarodka: brak nowych wpisów");
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

console.log(`
─────────────────────────────────────
📊 Import zakończony
   Dzienne:          ${dzienneInserted} nowych wpisów
   Wylęgarnia:       ${wylegInserted} nowych nakładów
   Utrata masy:      ${masaInserted} nowych wpisów
   Temperatura:      ${tempInserted} nowych partii
─────────────────────────────────────
`);
