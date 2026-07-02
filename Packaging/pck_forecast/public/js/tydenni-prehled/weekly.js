/* =========================
   ZÁLOŽKA "TÝDENNÍ PŘEHLED"

   Vykreslování samotné tabulky (stromová struktura Obal/Projekt/
   Materiál) řeší sdílený modul common/pivotTable.js - je to stejný
   engine jako pro Roční přehled (viz ../rocni-prehled/yearly.js),
   proto je v common. Tady je jen to, co je specifické pro tuhle
   konkrétní záložku: checkboxy "Potřeby - materiál" / "Potřeby - obaly".
========================= */
import { $, needsToggles } from "../common/zaklad.js";
import { renderPivotTableById } from "../common/pivotTable.js";

const TABLE_ID = "weeklyTable";

export function initWeeklyTab() {
  $("weeklyNeedsMaterialToggle").addEventListener("change", (e) => {
    needsToggles[TABLE_ID].material = !!e.target.checked;
    renderPivotTableById(TABLE_ID);
  });

  $("weeklyNeedsPackagingToggle").addEventListener("change", (e) => {
    needsToggles[TABLE_ID].packaging = !!e.target.checked;
    renderPivotTableById(TABLE_ID);
  });
}
