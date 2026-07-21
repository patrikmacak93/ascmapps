/* =========================
   BOOTSTRAP APLIKACE

   Tenký "spouštěč": napojí věci, které patří celé stránce (tlačítko
   "Načíst data" v hlavičce, přepínání záložek nahoře, rozbalování/
   sbalování stromu v tabulkách - to funguje stejně pro Týdenní i
   Roční přehled), a zavolá inicializaci jednotlivých záložek.

   Konkrétní chování jednotlivé záložky (Grafy, Týdenní přehled,
   Roční přehled, Empties) je v jejím vlastním souboru/složce - viz
   importy níže.
========================= */
import { $ } from "./common/zaklad.js";
import { loadFromSourceThenAll } from "./common/dataLoader.js";
import { setTableCollapseState } from "./common/pivotTable.js";
import { clearAllHover } from "./common/highlight.js";

import { initGrafyTab } from "./grafy/pareto.js";
import { initWeeklyTab } from "./tydenni-prehled/weekly.js";
import { initYearlyTab } from "./rocni-prehled/yearly.js";
import { initEmptiesTab } from "./empties/empties.js";
import { initBudgetTab } from "./budget/budget.js";

// ===== Hlavička: tlačítko "Načíst data" =====
$("loadBtn").addEventListener("click", loadFromSourceThenAll);

// ===== Inicializace jednotlivých záložek =====
initGrafyTab();
initWeeklyTab();
initYearlyTab();
initEmptiesTab();
initBudgetTab();

// ===== Sbalit/rozbalit strom (Obal/Projekt/Materiál) =====
// Společné pro Týdenní i Roční přehled - které tabulky a na jakou
// úroveň se má sbalit, poznají tlačítka podle data-atributů v HTML.
document.querySelectorAll("[data-collapse-table]").forEach(btn => {
  btn.addEventListener("click", () => {
    setTableCollapseState(btn.dataset.collapseTable, btn.dataset.collapseMode);
  });
});

// ===== Přepínání záložek =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    clearAllHover();
  }, { passive: true });
});

