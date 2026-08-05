// Jednorazowy skrypt: wgrywa strukturę ferm/kurników oraz pełną historię
// z pliku Monitoring_Ferma_Wylegarnia_2026_3.xlsx do bazy Supabase.
//
// Użycie:
//   1. W pliku .env dodaj na końcu dwie linie z Twoim loginem do appki:
//        SEED_EMAIL=twoj@email.pl
//        SEED_PASSWORD=twoje_haslo
//      (musisz mieć już założone konto przez ekran logowania appki)
//   2. npm run seed

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const DEFAULT_FARMS = [
  {
    id: "farm_lakiem", name: "Ferma za Lakiem",
    kurniki: [
      { id: "K1", name: "K1", line: "Ross 308", start: "2025-08-01", hens: 10352, roosters: 1102 },
      { id: "K2", name: "K2", line: "Ross 308", start: "2025-08-01", hens: 10352, roosters: 1102 },
      { id: "K3", name: "K3", line: "Ross 308", start: "2025-08-01", hens: 10352, roosters: 1101 },
      { id: "K4", name: "K4", line: "Ross 308", start: "2025-08-01", hens: 10364, roosters: 966 },
    ],
  },
  {
    id: "farm_w", name: "Ferma W",
    kurniki: [
      { id: "W1", name: "W1", line: "Ross 308", start: "2026-06-22", hens: 10964, roosters: 1066 },
      { id: "W2", name: "W2", line: "Ross308", start: "2026-06-22", hens: 10996, roosters: 1120 },
      { id: "w3", name: "w3", line: "Ross 308", start: "2026-06-23", hens: 10019, roosters: 1104 },
      { id: "W4", name: "W4", line: "Ross 308", start: "2026-06-23", hens: 10996, roosters: 1104 },
    ],
  },
];

async function main() {
  if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD) {
    console.error("Brak SEED_EMAIL / SEED_PASSWORD w pliku .env. Dodaj je i spróbuj ponownie.");
    process.exit(1);
  }

  console.log("Logowanie...");
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.SEED_EMAIL,
    password: process.env.SEED_PASSWORD,
  });
  if (authErr) { console.error("Błąd logowania:", authErr.message); process.exit(1); }
  console.log("Zalogowano.");

  console.log("Wgrywanie ferm i kurników...");
  for (const farm of DEFAULT_FARMS) {
    const { error } = await supabase.from("farms").upsert({ id: farm.id, name: farm.name });
    if (error) console.error("Farm error:", error.message);
    for (const k of farm.kurniki) {
      const { error: kErr } = await supabase.from("kurniki").upsert({
        id: k.id, farm_id: farm.id, name: k.name, line: k.line, start_date: k.start, hens: k.hens, roosters: k.roosters,
      });
      if (kErr) console.error("Kurnik error:", kErr.message);
    }
  }
  console.log("Fermy i kurniki gotowe.");

  const seed = JSON.parse(fs.readFileSync(new URL("../data/seed.json", import.meta.url)));

  console.log("Wgrywanie wpisów dziennych...");
  let dzienneCount = 0;
  for (const [kurnikId, entries] of Object.entries(seed.dzienne)) {
    // Zabezpieczenie: jeśli w danych źródłowych trafi się dwa wiersze na tę samą datę,
    // baza odrzuci cały pakiet (unique kurnik_id+date). Zostawiamy ostatni wpis dla danej daty.
    const byDate = new Map();
    entries.forEach((e) => byDate.set(e.date, e));
    const deduped = [...byDate.values()];

    const rows = deduped.map((e) => ({
      kurnik_id: kurnikId, date: e.date, tydz_zycia: e.tydzZycia,
      kury_zywe: e.kuryZywe, koguty_zywe: e.kogutyZywe, upadki_kury: e.upadkiKury ?? 0, upadki_koguty: e.upadkiKoguty ?? 0,
      cum_mortality: e.cumMortality, jaja_ogolem: e.jajaOgolem, jaja_wyleg: e.jajaWyleg, hatch_egg_pct: e.hatchEggPct, lay_pct: e.layPct,
      waga_jaja: e.wagaJaja, pasza_kury: e.paszaKury, pasza_kog: e.paszaKog, dose_kury: e.doseKury, dose_kog: e.doseKog,
      woda: e.woda, water_feed: e.waterFeed, temp_kurnik: e.tempKurnik, temp_magaz_jaj: e.tempMagazJaj,
      waga_kury: e.wagaKury, waga_kog: e.wagaKog, suplement: e.suplement || null, notatki: e.notatki || null,
    }));
    const { error } = await supabase.from("dzienne_entries").upsert(rows, { onConflict: "kurnik_id,date" });
    if (error) console.error(`Błąd wpisów dla ${kurnikId}:`, error.message);
    else dzienneCount += rows.length;
  }
  console.log(`Wpisy dzienne: ${dzienneCount}`);

  console.log("Wgrywanie wylęgów...");
  const wylegRows = seed.wylegarnia.map((e) => ({
    data_naladu: e.dataNaladu, data_wylegu: e.dataWylegu || null, dostawca: e.dostawca || null, nr_partii: e.nrPartii || null,
    dostawa_jaj: e.dostawaJaj, strata_magaz: e.strataMagaz ?? 0, naladu: e.naladu, niezaplodnione: e.niezaplodnione, niezapl_pct: e.niezaplPct,
    zamarle: e.zamarle, zamarle_pct: e.zamarlePct, zapl_pct: e.zaplPct, odpad: e.odpad ?? 0, nie_wyklute: e.nieWyklute ?? 0, nie_wyklute_pct: e.nieWyklutePct,
    pisklieta_zdrowe: e.pisklietaZdrowe, wyleg_naladu: e.wylegNaladu, wyleg_zapl: e.wylegZapl, uwagi: e.uwagi || null,
  }));
  const { error: wylegErr } = await supabase.from("wylegarnia").insert(wylegRows);
  if (wylegErr) console.error("Błąd wylęgów:", wylegErr.message);
  else console.log(`Wylęgi: ${wylegRows.length}`);

  console.log("Wgrywanie temperatury zarodka...");
  let tempCount = 0;
  for (const batch of seed.tempZarodka) {
    const { data, error } = await supabase.from("temp_zarodka").insert({
      data_naladu: batch.dataNaladu, dostawca: batch.dostawca || null, avg_temp: batch.avg, min_temp: batch.min, max_temp: batch.max, uwagi: batch.uwagi || null,
    }).select().single();
    if (error) { console.error("Błąd partii temp:", error.message); continue; }
    const measRows = batch.measurements.map((m) => ({ batch_id: data.id, dzien: m.dzien, temp: m.temp, nr_al: m.nrAL ? String(m.nrAL) : null, polozenie: m.polozenie || null }));
    const { error: mErr } = await supabase.from("temp_zarodka_measurements").insert(measRows);
    if (mErr) console.error("Błąd pomiarów temp:", mErr.message);
    else tempCount++;
  }
  console.log(`Partie temperatury zarodka: ${tempCount}`);

  console.log("Wgrywanie utraty masy jaja...");
  let masaCount = 0;
  for (const m of seed.utrataMasy) {
    const { data, error } = await supabase.from("utrata_masy").insert({
      data_naladu: m.dataNaladu, dostawca: m.dostawca || null, waga0: m.waga0, waga_pisklecia: m.wagaPisklecia || null, chick_pct: m.chickPct, uwagi: m.uwagi || null,
    }).select().single();
    if (error) { console.error("Błąd pomiaru masy:", error.message); continue; }
    const cpRows = (m.checkpoints || []).filter((c) => c.waga !== "" && c.waga !== null).map((c) => ({ measurement_id: data.id, day: c.day, waga: c.waga, nr_al: c.nrAL ? String(c.nrAL) : null, loss: c.loss }));
    if (cpRows.length) {
      const { error: cErr } = await supabase.from("utrata_masy_checkpoints").insert(cpRows);
      if (cErr) console.error("Błąd checkpointów:", cErr.message);
    }
    masaCount++;
  }
  console.log(`Pomiary utraty masy: ${masaCount}`);

  console.log("\nGotowe! Odśwież appkę — dane powinny być widoczne.");
  process.exit(0);
}

main();
