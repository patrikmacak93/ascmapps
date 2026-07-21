/* =========================================================
   ZÁLOŽKA "BUDGET"

   Načte a zobrazí obsah SQL view [FSTASCM].[pckForecast].[vw_budget]
   (backend appky: GET /api/budget -> sql-connector /budget).

   Tabulka je pouze pro čtení. Protože dotaz je SELECT *, nevíme
   dopředu, jaké sloupce přijdou - hlavičku i buňky proto sestavíme
   dynamicky podle klíčů z prvního řádku dat.
========================================================= */
import { $, escapeHtml, formatNumber, budgetUrl, appState } from "../common/zaklad.js";

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

  // Sloupce odvodíme z klíčů prvního řádku (SELECT * -> neznámá struktura).
  const columns = Object.keys(rows[0]);

  const headerRow = document.createElement("tr");
  headerRow.innerHTML = columns.map(c => `<th>${escapeHtml(c)}</th>`).join("");
  thead.appendChild(headerRow);

  const frag = document.createDocumentFragment();

  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.textContent = formatBudgetValue(row[col]);
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

function formatBudgetValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

