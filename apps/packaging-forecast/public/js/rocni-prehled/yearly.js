/* =========================
   ZÁLOŽKA "ROČNÍ PŘEHLED"

   Stejný princip jako u Týdenního přehledu (viz
   ../tydenni-prehled/weekly.js) - vykreslování tabulky je ve
   sdíleném common/pivotTable.js, tady je jen to specifické pro tuhle
   záložku: checkboxy "Potřeby - materiál" / "Potřeby - obaly".
========================= */
import { $, needsToggles } from "../common/zaklad.js";
import { renderPivotTableById, openColumnsFilterPopover } from "../common/pivotTable.js";

const TABLE_ID = "yearlyTable";

export function initYearlyTab() {
  $("yearlyNeedsMaterialToggle").addEventListener("change", (e) => {
    needsToggles[TABLE_ID].material = !!e.target.checked;
    renderPivotTableById(TABLE_ID);
  });

  $("yearlyNeedsPackagingToggle").addEventListener("change", (e) => {
    needsToggles[TABLE_ID].packaging = !!e.target.checked;
    renderPivotTableById(TABLE_ID);
  });

  $("yearlyPoolSimToggle").addEventListener("change", (e) => {
    needsToggles[TABLE_ID].poolSim = !!e.target.checked;
    renderPivotTableById(TABLE_ID);
  });

  const columnsBtn = $("yearlyColumnsFilterBtn");
  columnsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openColumnsFilterPopover(TABLE_ID, columnsBtn);
  });
}
