/* =========================================================
   NAČTENÍ DAT (tlačítko "Načíst data" v hlavičce appky)

   Stáhne najednou data pro všechny záložky (PckPoolBalance,
   Týdenní přehled, Roční přehled, Pareto graf) z backendu appky
   (server.js) a uloží je do sdíleného stavu (viz common/zaklad.js),
   odkud si je pak vezme vykreslování v jednotlivých záložkách.
   Tlačítko jen čte data ze SQL - zápis (import z Excelu do SQL)
   řeší appka Reports.
========================================================= */
import { $, apiUrl, weeklyOverviewUrl, yearlyOverviewUrl, emptiesUrl, appState } from "./zaklad.js";
import { renderPivotTable } from "./pivotTable.js";
import { initParetoControls, renderParetoFromCache } from "../grafy/pareto.js";

export async function loadAllData() {
  const status = $("status");
  status.textContent = "Načítám data...";

  try {
    const [mainRes, weeklyRes, yearlyRes, emptiesRes] = await Promise.all([
      fetch(apiUrl, { cache: "no-store" }),
      fetch(weeklyOverviewUrl, { cache: "no-store" }),
      fetch(yearlyOverviewUrl, { cache: "no-store" }),
      fetch(emptiesUrl, { cache: "no-store" })
    ]);

    if (!mainRes.ok) throw new Error(`Hlavní API HTTP ${mainRes.status}: ${await mainRes.text()}`);
    if (!weeklyRes.ok) throw new Error(`Týdenní přehled API HTTP ${weeklyRes.status}: ${await weeklyRes.text()}`);
    if (!yearlyRes.ok) throw new Error(`Roční přehled API HTTP ${yearlyRes.status}: ${await yearlyRes.text()}`);
    if (!emptiesRes.ok) throw new Error(`Empties API HTTP ${emptiesRes.status}: ${await emptiesRes.text()}`);

    const mainData = await mainRes.json();
    appState.mainDataCache = Array.isArray(mainData) ? mainData : [];
    appState.paretoPeriodRows = appState.mainDataCache.filter(x => String(x.period_type).toLowerCase() === "week");

    const weeklyOverviewData = await weeklyRes.json();
    const yearlyOverviewData = await yearlyRes.json();

    appState.emptiesData = await emptiesRes.json();
    if (!Array.isArray(appState.emptiesData)) appState.emptiesData = [];

    renderPivotTable("weeklyTable", weeklyOverviewData.periods || [], weeklyOverviewData.rows || []);
    renderPivotTable("yearlyTable", yearlyOverviewData.periods || [], yearlyOverviewData.rows || []);

    initParetoControls();
    renderParetoFromCache();

    if ($("emptiesStatus")) {
      $("emptiesStatus").textContent = `Načteno ${appState.emptiesData.length} řádků Empties.`;
    }

    status.textContent = `Načteno ${appState.mainDataCache.length} řádků + kontingenční tabulky + Empties.`;
  } catch (err) {
    console.error(err);
    status.textContent = "Chyba při načítání dat: " + err.message;
  }
}
