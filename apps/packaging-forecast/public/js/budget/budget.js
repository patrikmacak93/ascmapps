/* =========================================================
   ZÁLOŽKA "BUDGET"

   Načte obsah SQL view [FSTASCM].[pckForecast].[vw_budget]
   (backend appky: GET /api/budget -> sql-connector /budget) a
   zobrazí ho jako stromovou tabulku Obal (SAP ID) -> Projekt ->
   Materiál - stejným sdíleným enginem jako Týdenní/Roční přehled
   (viz common/pivotTable.js), jen s jedinou "obdobovou" metrikou
   MinPckPoolBalance místo PckPoolBalance/requirement_qty/...

   Zdrojová data mají jeden řádek za SAP_ID + Project + local_material
   + měsíc/rok (viz vw_budget: year, month, SAP_ID, Project,
   local_material, Disponent, MinPckPoolBalance, peak, peakCena,
   "Pro Budget budeme dokupovat", "Cena reálného dokupu").

   Peak/Peak cena/Pro Budget budeme dokupovat/Cena reálného dokupu
   nejsou vázané na období (jsou to hodnoty za celé SAP ID/Projekt),
   takže se do pivotTable.js předávají jako extraColumns a zobrazí se
   jen na SAP řádku:
   - peak/peakCena: ve view jsou už spočítané za celé SAP ID (přes
     všechny projekty najednou), takže na každém jeho řádku je stejná
     hodnota - stačí vzít první nenulovou.
   - "Pro Budget budeme dokupovat"/"Cena reálného dokupu": to jsou
     částky/množství per Projekt (z Empties, opakují se na každém
     měsíci/materiálu toho projektu) - za SAP ID se sčítají přes jeho
     jednotlivé unikátní projekty, ať se nezapočítají vícekrát.
========================================================= */
import { $, budgetUrl, appState } from "../common/zaklad.js";
import { renderPivotTable, openColumnsFilterPopover } from "../common/pivotTable.js";

const TABLE_ID = "budgetTable";

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(value) {
  return `${value.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CZK`;
}

function sumUniqueByProject(sapRows, field) {
  const perProject = new Map();
  for (const r of sapRows) {
    const project = String(r.Project ?? "").trim();
    if (!perProject.has(project)) perProject.set(project, toNumberOrNull(r[field]));
  }

  let sum = 0;
  let hasValue = false;
  for (const v of perProject.values()) {
    if (v === null) continue;
    sum += v;
    hasValue = true;
  }
  return hasValue ? sum : null;
}

function firstNonNull(sapRows, field) {
  for (const r of sapRows) {
    const v = toNumberOrNull(r[field]);
    if (v !== null) return v;
  }
  return null;
}

const EXTRA_COLUMNS = [
  { key: "peak", label: "Peak", compute: (sapRows) => firstNonNull(sapRows, "peak") },
  { key: "peakCena", label: "Peak cena", compute: (sapRows) => firstNonNull(sapRows, "peakCena"), format: formatMoney },
  { key: "proBudget", label: "Pro Budget budeme dokupovat", compute: (sapRows) => sumUniqueByProject(sapRows, "Pro Budget budeme dokupovat") },
  { key: "cenaRealna", label: "Cena reálného dokupu", compute: (sapRows) => sumUniqueByProject(sapRows, "Cena reálného dokupu"), format: formatMoney }
];

export function initBudgetTab() {
  $("loadBudgetBtn").addEventListener("click", loadBudgetData);

  const columnsBtn = $("budgetColumnsFilterBtn");
  columnsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openColumnsFilterPopover(TABLE_ID, columnsBtn);
  });
}

export async function loadBudgetData() {
  const status = $("budgetStatus");
  status.textContent = "Načítám Budget...";

  try {
    const res = await fetch(budgetUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Budget API HTTP ${res.status}: ${await res.text()}`);

    appState.budgetData = await res.json();
    if (!Array.isArray(appState.budgetData)) appState.budgetData = [];

    renderBudgetTable();
    status.textContent = `Načteno ${appState.budgetData.length} řádků Budget.`;
  } catch (err) {
    console.error(err);
    status.textContent = "Chyba při načítání Budget: " + err.message;
  }
}

export function renderBudgetTable() {
  const raw = appState.budgetData;

  const periodsMap = new Map(); // sortKey -> label
  const rowsMap = new Map(); // "SAP||Project||Materiál" -> pivot řádek (jako u Týdenního/Ročního přehledu)

  for (const r of raw) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    const label = `${String(month).padStart(2, "0")}/${year}`;
    const sortKey = year * 100 + month;
    if (!periodsMap.has(sortKey)) periodsMap.set(sortKey, label);

    const sap = String(r.SAP_ID ?? "").trim();
    const project = String(r.Project ?? "").trim();
    const material = String(r.local_material ?? "").trim();
    const key = `${sap}||${project}||${material}`;

    let row = rowsMap.get(key);
    if (!row) {
      row = { SAP_ID: sap, Project: project, Disponent: r.Disponent || "", local_material: material };
      rowsMap.set(key, row);
    }
    if (!row.Disponent && r.Disponent) row.Disponent = r.Disponent;

    row[`${label}__PckPoolBalance`] = r.MinPckPoolBalance === null || r.MinPckPoolBalance === undefined
      ? null
      : Number(r.MinPckPoolBalance);

    // peak/peakCena/"Pro Budget budeme dokupovat"/"Cena reálného dokupu" se
    // neváží na období - stačí je z posledního zpracovaného řádku přenést
    // na výsledný pivot řádek beze změny, extraColumns si je pak samy
    // přepočítají ze všech syrových řádků daného SAP ID (viz sumUniqueByProject/firstNonNull).
    row.peak = r.peak;
    row.peakCena = r.peakCena;
    row["Pro Budget budeme dokupovat"] = r["Pro Budget budeme dokupovat"];
    row["Cena reálného dokupu"] = r["Cena reálného dokupu"];
  }

  const periods = [...periodsMap.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  const rows = [...rowsMap.values()];

  renderPivotTable(TABLE_ID, periods, rows, EXTRA_COLUMNS);
}
