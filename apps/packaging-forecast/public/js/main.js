/* =========================
   BOOTSTRAP APLIKACE

   Tenký "spouštěč": napojí věci, které patří celé stránce (tlačítko
   "Aktualizovat data" v hlavičce, přepínání záložek nahoře,
   rozbalování/sbalování stromu v tabulkách - to funguje stejně pro
   Týdenní i Roční přehled), a zavolá inicializaci jednotlivých záložek.

   Data se načítají AUTOMATICKY při otevření appky (viz refreshAll na
   konci). Uživatel tedy nemusí na nic klikat; jediné tlačítko
   "Aktualizovat data" vpravo nahoře slouží k ručnímu obnovení.

   Konkrétní chování jednotlivé záložky (Grafy, Týdenní přehled,
   Roční přehled, Empties, Budget) je v jejím vlastním souboru/složce -
   viz importy níže.
========================= */
import { $ } from "./common/zaklad.js";
import { loadAllData } from "./common/dataLoader.js";
import { loadBudgetData } from "./budget/budget.js";
import { setTableCollapseState } from "./common/pivotTable.js";
import { clearAllHover } from "./common/highlight.js";

import { initGrafyTab } from "./grafy/pareto.js";
import { initWeeklyTab } from "./tydenni-prehled/weekly.js";
import { initYearlyTab } from "./rocni-prehled/yearly.js";
import { initEmptiesTab } from "./empties/empties.js";
import { initBudgetTab } from "./budget/budget.js";

/* Načtení VŠECH dat najednou (hlavní data + Týdenní/Roční přehled +
   Empties přes loadAllData, a Budget přes loadBudgetData). Obě funkce
   si samy řeší stavové hlášky i chyby, takže při výpadku SQL se jen
   zobrazí chybová hláška a appka zůstane funkční. */
async function refreshAll() {
  await Promise.all([loadAllData(), loadBudgetData()]);
}

// ===== Hlavička: tlačítko "Aktualizovat data" =====
$("loadBtn").addEventListener("click", refreshAll);

// ===== Inicializace jednotlivých záložek =====
initGrafyTab();
initWeeklyTab();
initYearlyTab();
initEmptiesTab();
initBudgetTab();

// ===== Automatické načtení všech dat při spuštění appky =====
refreshAll();

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