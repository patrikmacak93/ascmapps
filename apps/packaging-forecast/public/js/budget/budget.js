/* =========================================================
   ZÁLOŽKA "BUDGET"

   Načte obsah SQL view [FSTASCM].[pckForecast].[vw_budget]
   (backend appky: GET /api/budget -> sql-connector /budget) a
   zobrazí ho jako pivot tabulku podobnou Ročnímu přehledu:
   řádky = SAP ID, sloupce = měsíc/rok, hodnota = MinPckPoolBalance.

   Zdrojová data mají jeden řádek za SAP_ID + Project + měsíc/rok
   (viz vw_budget: year, month, SAP_ID, Project, MinPckPoolBalance).
   Když má jedno SAP ID víc projektů, do buňky jde nejmenší
   (nejhorší) hodnota ze všech jeho projektů pro dané období - stejná
   konvence jako u sloupce PckPoolBalance v Týdenním/Ročním přehledu
   (viz common/pivotTable.js).
========================================================= */
import { $, formatNumber, budgetUrl, appState, tableFilters } from "../common/zaklad.js";
import { openTextFilterPopover, rowPassesTextFilter } from "../common/filters.js";

function getBudgetSapText(row) {
  return String(row.SAP_ID ?? "").trim();
}

export function initBudgetTab() {
  $("loadBudgetBtn").addEventListener("click", loadBudgetData);
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
  const table = $("budgetTable");
  const thead = table.tHead || table.createTHead();
  const tbody = table.tBodies[0] || table.createTBody();
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const rows = appState.budgetData;
  if (!rows.length) return;

  // ---- Sloupce (období) ----
  const periodsMap = new Map(); // sortKey -> label
  for (const r of rows) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    const sortKey = year * 100 + month;
    if (!periodsMap.has(sortKey)) periodsMap.set(sortKey, `${String(month).padStart(2, "0")}/${year}`);
  }
  const periods = [...periodsMap.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);

  // ---- Řádky (SAP ID) - napříč projekty se do buňky bere MIN ----
  const sapMap = new Map(); // SAP_ID -> Map(periodLabel -> hodnota | null)

  for (const r of rows) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    const sap = String(r.SAP_ID ?? "").trim();
    const label = `${String(month).padStart(2, "0")}/${year}`;
    const value = r.MinPckPoolBalance === null || r.MinPckPoolBalance === undefined ? null : Number(r.MinPckPoolBalance);

    let periodValues = sapMap.get(sap);
    if (!periodValues) {
      periodValues = new Map();
      sapMap.set(sap, periodValues);
    }

    const current = periodValues.get(label);
    if (value !== null && Number.isFinite(value)) {
      periodValues.set(label, current === undefined || current === null ? value : Math.min(current, value));
    } else if (current === undefined) {
      periodValues.set(label, null);
    }
  }

  const allSapIds = [...sapMap.keys()].sort((a, b) => a.localeCompare(b, "cs"));

  const sapSelected = tableFilters.budgetTable.sapSelected;
  const sapSet = sapSelected ? new Set(sapSelected) : null;
  const sapIds = allSapIds.filter(sap => rowPassesTextFilter({ SAP_ID: sap }, sapSet, getBudgetSapText));

  // ---- Hlavička ----
  const headerRow = document.createElement("tr");
  const thSap = document.createElement("th");
  thSap.className = "category-cell";

  const thFlex = document.createElement("div");
  thFlex.className = "th-flex";

  const thTitle = document.createElement("span");
  thTitle.textContent = "SAP ID";

  const filterBtn = document.createElement("button");
  filterBtn.className = "filter-btn";
  filterBtn.type = "button";
  filterBtn.title = "Filtrovat SAP ID";
  filterBtn.textContent = "▾";
  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTextFilterPopover({
      tableId: "budgetTable",
      anchorEl: filterBtn,
      flatRows: rows,
      noteText: "Tip: filtruje se podle textu ve sloupci SAP ID.",
      selectedKey: "sapSelected",
      extractor: getBudgetSapText,
      onApply: renderBudgetTable
    });
  });

  thFlex.append(thTitle, filterBtn);
  thSap.appendChild(thFlex);
  headerRow.appendChild(thSap);

  for (const label of periods) {
    const th = document.createElement("th");
    th.className = "value-cell";
    th.textContent = label;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // ---- Tělo ----
  function rowValueClass(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "zero";
    return n > 0 ? "pos" : "neg";
  }

  const frag = document.createDocumentFragment();

  for (const sap of sapIds) {
    const tr = document.createElement("tr");

    const tdSap = document.createElement("td");
    tdSap.className = "category-cell";
    tdSap.textContent = sap;
    tr.appendChild(tdSap);

    const periodValues = sapMap.get(sap);
    for (const label of periods) {
      const value = periodValues.has(label) ? periodValues.get(label) : null;
      const td = document.createElement("td");
      td.className = "num value-cell";
      if (value !== null) td.classList.add(rowValueClass(value));
      td.textContent = value === null ? "" : formatNumber(value);
      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

