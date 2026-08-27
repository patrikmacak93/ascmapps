/* =========================================================
   NAČTENÍ DAT (tlačítko "Aktualizovat data" v hlavičce appky)

   Stáhne najednou data pro všechny záložky (PckPoolBalance,
   Týdenní přehled, Roční přehled, Pareto graf, Empties) z backendu
   appky (server.js) a uloží je do sdíleného stavu (viz common/zaklad.js),
   odkud si je pak vezme vykreslování v jednotlivých záložkách.
   Tlačítko jen čte data ze SQL - zápis (import z Excelu do SQL)
   řeší appka Reports.
========================================================= */
import { $, apiUrl, weeklyOverviewUrl, yearlyOverviewUrl, emptiesUrl, projectsUrl, appState } from "./zaklad.js";
import { renderPivotTable } from "./pivotTable.js";
import { initParetoControls, renderParetoFromCache } from "../grafy/pareto.js";
import { renderEmptiesTable } from "../empties/empties.js";

export async function loadAllData() {
  const status = $("status");
  status.textContent = "Načítám data...";

  try {
    // Empties + projekty tahame tady rovnou, abychom mohli Empties tabulku
    // i VYKRESLIT (viz renderEmptiesTable nize). Projekty jsou potreba pro
    // dropdown ve sloupci Projekt; jdou z cache (force-cache), takze levne.
    const [mainRes, weeklyRes, yearlyRes, emptiesRes, projectsRes] = await Promise.all([
      fetch(apiUrl, { cache: "no-store" }),
      fetch(weeklyOverviewUrl, { cache: "no-store" }),
      fetch(yearlyOverviewUrl, { cache: "no-store" }),
      fetch(emptiesUrl, { cache: "no-store" }),
      fetch(projectsUrl, { cache: "force-cache" })
    ]);

    if (!mainRes.ok) throw new Error(`Hlavní API HTTP ${mainRes.status}: ${await mainRes.text()}`);
    if (!weeklyRes.ok) throw new Error(`Týdenní přehled API HTTP ${weeklyRes.status}: ${await weeklyRes.text()}`);
    if (!yearlyRes.ok) throw new Error(`Roční přehled API HTTP ${yearlyRes.status}: ${await yearlyRes.text()}`);
    if (!emptiesRes.ok) throw new Error(`Empties API HTTP ${emptiesRes.status}: ${await emptiesRes.text()}`);
    if (!projectsRes.ok) throw new Error(`Projects API HTTP ${projectsRes.status}: ${await projectsRes.text()}`);

    const mainData = await mainRes.json();
    appState.mainDataCache = Array.isArray(mainData) ? mainData : [];
    appState.paretoPeriodRows = appState.mainDataCache.filter(x => String(x.period_type).toLowerCase() === "week");

    const weeklyOverviewData = await weeklyRes.json();
    const yearlyOverviewData = await yearlyRes.json();

    appState.emptiesData = await emptiesRes.json();
    if (!Array.isArray(appState.emptiesData)) appState.emptiesData = [];
    appState.projectOptions = await projectsRes.json();
    if (!Array.isArray(appState.projectOptions)) appState.projectOptions = [];

    renderPivotTable("weeklyTable", weeklyOverviewData.periods || [], weeklyOverviewData.rows || []);
    renderPivotTable("yearlyTable", yearlyOverviewData.periods || [], yearlyOverviewData.rows || []);

    initParetoControls();
    renderParetoFromCache();

    // Vykresleni editovatelne tabulky Empties (data i projektove volby uz
    // mame v appState vyse). Diky tomu se Empties zobrazi i pri auto-loadu,
    // aniz bychom museli volat loadEmptiesData zvlast (zadne dvojite cteni).
    renderEmptiesTable();

    if ($("emptiesStatus")) {
      $("emptiesStatus").textContent = `Načteno ${appState.emptiesData.length} řádků Empties.`;
    }

    status.textContent = `Načteno ${appState.mainDataCache.length} řádků + kontingenční tabulky + Empties.`;
  } catch (err) {
    console.error(err);
    status.textContent = "Chyba při načítání dat: " + err.message;
  }
}
